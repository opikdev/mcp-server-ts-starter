import { httpInstrumentationMiddleware } from '@hono/otel';
import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import {
  type AuthInfo,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  type OAuthMetadata,
  type OAuthTokenVerifier,
  oauthMetadataResponse,
  requireBearerAuth,
} from '@modelcontextprotocol/server';
import { Hono } from 'hono';
import { type RequestIdVariables, requestId } from 'hono/request-id';
import type { HttpConfig } from '../config.ts';
import type { Logger } from '../logger.ts';
import { createServer } from '../server.ts';
import { supportedScopes } from '../tools/index.ts';
import type { NotesClientFor } from '../upstream/notes-client.ts';
import { createInFlight } from './in-flight.ts';

type Env = { Variables: RequestIdVariables & { clientId?: string; parsedBody?: unknown } };

export interface Readiness {
  ready: boolean;
  draining: boolean;
}

interface HttpAppOptions {
  config: HttpConfig;
  logger: Logger;
  verifier: OAuthTokenVerifier | null;
  authorizationServer?: OAuthMetadata;
  now?: () => Date;
  notes?: NotesClientFor | null;
}

const healthPaths = new Set(['/healthz', '/readyz']);

function isListen(body: unknown): boolean {
  return (body as { method?: unknown } | undefined)?.method === 'subscriptions/listen';
}

function problem(
  status: number,
  title: string,
  detail: string,
  headers: Record<string, string> = {},
) {
  return Response.json(
    { type: 'about:blank', title, status, detail },
    { status, headers: { 'Content-Type': 'application/problem+json', ...headers } },
  );
}

export function createHttpApp({
  config,
  logger,
  verifier,
  authorizationServer,
  now,
  notes = null,
}: HttpAppOptions) {
  const { auth } = config;
  const baseScopes = auth.mode === 'none' ? undefined : auth.scopes;
  const handler = createMcpHandler(
    (ctx) =>
      createServer({
        transport: 'http',
        logger,
        authInfo: ctx.authInfo,
        notes,
        ...(baseScopes ? { baseScopes } : {}),
        ...(now ? { now } : {}),
      }),
    { onerror: (err) => logger.warn({ err }, 'MCP request failed') },
  );
  const readiness: Readiness = { ready: false, draining: false };
  const inFlight = createInFlight();
  const app = new Hono<Env>();

  if (config.telemetry) {
    const instrumentation = httpInstrumentationMiddleware();
    app.use((c, next) => (healthPaths.has(c.req.path) ? next() : instrumentation(c, next)));
  }
  app.use(requestId(), async (c, next) => {
    const started = performance.now();
    await next();
    // requestId() sets the header before the route runs, and Hono drops it when a route returns its own Response.
    c.header('X-Request-Id', c.get('requestId'));
    if (readiness.draining) c.header('Connection', 'close');
    logger[healthPaths.has(c.req.path) ? 'debug' : 'info'](
      {
        requestId: c.get('requestId'),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - started),
        clientId: c.get('clientId'),
      },
      'HTTP request',
    );
  });

  app.get('/healthz', (c) => c.json({ status: 'ok' }));
  app.get('/readyz', (c) =>
    readiness.ready && !readiness.draining
      ? c.json({ status: 'ready' })
      : c.json({ status: readiness.draining ? 'draining' : 'starting' }, 503),
  );

  const metadataUrl = getOAuthProtectedResourceMetadataUrl(config.publicUrl);
  if (auth.mode === 'oauth') {
    if (!authorizationServer) throw new Error('OAuth needs the authorization server metadata.');
    const metadata = {
      oauthMetadata: authorizationServer,
      resourceServerUrl: config.publicUrl,
      scopesSupported: supportedScopes(auth.scopes, notes !== null),
      // config.ts already refuses an http:// issuer outside loopback.
      dangerouslyAllowInsecureIssuerUrl: new URL(auth.issuer).protocol === 'http:',
    };
    app.use(async (c, next) => oauthMetadataResponse(c.req.raw, metadata) ?? next());
  }

  const allowedOriginHosts = config.allowedOrigins.map((origin) => new URL(origin).hostname);
  app.route(
    '/',
    createMcpHonoApp({
      host: config.host,
      allowedHosts: config.allowedHosts,
      allowedOrigins: allowedOriginHosts,
    }),
  );
  app.use(async (c, next) => {
    const origin = c.req.header('origin');
    if (origin !== undefined && !config.allowedOrigins.includes(origin)) {
      return problem(403, 'Forbidden', `Origin ${origin} is not allowed. See MCP_ALLOWED_ORIGINS.`);
    }
    return next();
  });

  const challengeScope = auth.mode === 'none' ? '' : auth.scopes.join(' ');
  const resourceMetadata = auth.mode === 'oauth' ? `, resource_metadata="${metadataUrl}"` : '';
  const gate =
    auth.mode === 'none' || !verifier
      ? null
      : requireBearerAuth({
          verifier,
          requiredScopes: auth.scopes,
          ...(auth.mode === 'oauth' ? { resourceMetadataUrl: metadataUrl } : {}),
        });

  async function authenticate(request: Request): Promise<AuthInfo | Response | undefined> {
    if (!gate) return undefined;
    if (!request.headers.has('authorization')) {
      return problem(401, 'Unauthorized', 'Send an access token as Authorization: Bearer.', {
        'WWW-Authenticate': `Bearer scope="${challengeScope}"${resourceMetadata}`,
      });
    }
    return gate(request);
  }

  app.all(config.publicUrl.pathname, async (c) => {
    const authInfo = await authenticate(c.req.raw);
    if (authInfo instanceof Response) return authInfo;
    if (authInfo) c.set('clientId', authInfo.clientId);
    const parsedBody = c.get('parsedBody');
    const options = {
      ...(authInfo ? { authInfo } : {}),
      ...(parsedBody === undefined ? {} : { parsedBody }),
    };
    if (isListen(parsedBody)) return handler.fetch(c.req.raw, options);
    return inFlight.track(() => handler.fetch(c.req.raw, options));
  });

  return {
    app,
    readiness,
    inFlight,
    close: () => handler.close(),
  };
}
