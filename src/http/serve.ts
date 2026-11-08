import { serve } from '@hono/node-server';
import { createJwtVerifier, discoverJwksUrl, remoteKeys } from '../auth/jwt.ts';
import { createTokenVerifier } from '../auth/token.ts';
import { type HttpConfig, loadHttpConfig, loadUpstreamConfig } from '../config.ts';
import { createLogger } from '../logger.ts';
import { createNotesClient } from '../upstream/notes-client.ts';
import { createHttpApp } from './app.ts';

async function verifierFor(config: HttpConfig) {
  const { auth } = config;
  if (auth.mode === 'token') return createTokenVerifier(auth.tokens, auth.scopes);
  if (auth.mode === 'oauth') {
    const jwksUrl = auth.jwksUrl ?? (await discoverJwksUrl(auth.issuer));
    return createJwtVerifier({
      issuer: auth.issuer,
      audience: config.publicUrl.href,
      keys: remoteKeys(jwksUrl),
    });
  }
  return null;
}

export async function serveHttp() {
  const config = loadHttpConfig();
  const logger = createLogger(config.logLevel);
  const upstream = loadUpstreamConfig();
  const notes = upstream ? createNotesClient(upstream) : null;
  const { app, close } = createHttpApp({
    config,
    logger,
    verifier: await verifierFor(config),
    notes,
  });

  const server = serve(
    { fetch: app.fetch, port: config.port, hostname: config.host },
    ({ port }) => {
      logger.info(
        { port, url: config.publicUrl.href, auth: config.auth.mode },
        'MCP server listening',
      );
    },
  );

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      close().finally(() => process.exit(0));
    });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
