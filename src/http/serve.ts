import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { createJwtVerifier, discoverJwksUrl, remoteKeys } from '../auth/jwt.ts';
import { createTokenVerifier } from '../auth/token.ts';
import { type HttpConfig, loadHttpConfig, loadUpstreamConfig } from '../config.ts';
import { createLogger } from '../logger.ts';
import { createNotesClient } from '../upstream/notes-client.ts';
import { createHttpApp } from './app.ts';

const shutdownTimeoutMs = 5000;

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

export async function serveHttp(
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = shutdownTimeoutMs,
) {
  const config = loadHttpConfig(env);
  const logger = createLogger(config.logLevel);
  const upstream = loadUpstreamConfig(env);
  const notes = upstream ? createNotesClient(upstream) : null;
  const http = createHttpApp({ config, logger, verifier: await verifierFor(config), notes });

  const server = serve({
    fetch: http.app.fetch,
    port: config.port,
    hostname: config.host,
  }) as Server;
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  logger.info({ port, url: config.publicUrl.href, auth: config.auth.mode }, 'MCP server listening');

  return {
    logger,
    async close() {
      await http.close();
      const force = setTimeout(() => server.closeAllConnections(), timeoutMs);
      await new Promise((resolve) => server.close(resolve));
      clearTimeout(force);
    },
  };
}
