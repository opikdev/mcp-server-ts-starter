import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import {
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  type OAuthTokenVerifier,
  requireBearerAuth,
} from '@modelcontextprotocol/server';
import { Hono } from 'hono';
import { type RequestIdVariables, requestId } from 'hono/request-id';
import type { HttpConfig } from '../config.ts';
import type { Logger } from '../logger.ts';
import { createServer } from '../server.ts';
import { notesWriteScope } from '../tools/create-note.ts';
import type { NotesClient } from '../upstream/notes-client.ts';

type Env = { Variables: RequestIdVariables & { clientId?: string } };

interface HttpAppOptions {
  config: HttpConfig;
  logger: Logger;
  verifier: OAuthTokenVerifier | null;
  now?: () => Date;
  notes?: NotesClient | null;
}

export function createHttpApp({ config, logger, verifier, now, notes = null }: HttpAppOptions) {
  const handler = createMcpHandler(
    (ctx) =>
      createServer({
        transport: 'http',
        logger,
        authInfo: ctx.authInfo,
        notes,
        ...(now ? { now } : {}),
      }),
    { onerror: (err) => logger.warn({ err }, 'MCP request failed') },
  );
  const app = new Hono<Env>();
  const { auth } = config;

  app.use(requestId(), async (c, next) => {
    const started = performance.now();
    await next();
    // requestId() sets the header before the route runs, and Hono drops it when a route returns its own Response.
    c.header('X-Request-Id', c.get('requestId'));
    logger.info(
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
  app.route('/', createMcpHonoApp({ host: config.host, allowedHosts: config.allowedHosts }));

  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  const metadataUrl = getOAuthProtectedResourceMetadataUrl(config.publicUrl);
  if (auth.mode === 'oauth') {
    app.get(new URL(metadataUrl).pathname, (c) =>
      c.json({
        resource: config.publicUrl.href,
        authorization_servers: [auth.issuer],
        scopes_supported: notes ? [...auth.scopes, notesWriteScope] : auth.scopes,
        bearer_methods_supported: ['header'],
      }),
    );
  }

  const gate =
    auth.mode === 'none' || !verifier
      ? null
      : requireBearerAuth({
          verifier,
          requiredScopes: auth.scopes,
          ...(auth.mode === 'oauth' ? { resourceMetadataUrl: metadataUrl } : {}),
        });

  app.all(config.publicUrl.pathname, async (c) => {
    if (!gate) return handler.fetch(c.req.raw);
    const authInfo = await gate(c.req.raw);
    if (authInfo instanceof Response) return authInfo;
    c.set('clientId', authInfo.clientId);
    return handler.fetch(c.req.raw, { authInfo });
  });

  return { app, close: () => handler.close() };
}
