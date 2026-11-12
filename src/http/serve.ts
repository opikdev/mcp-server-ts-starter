import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { serve } from '@hono/node-server';
import {
  createJwtVerifier,
  discoverAuthorizationServer,
  jwksUrlOf,
  remoteKeys,
} from '../auth/jwt.ts';
import { createTokenVerifier } from '../auth/token.ts';
import { type HttpConfig, loadHttpConfig, loadUpstreamConfig } from '../config.ts';
import { createLogger, type Logger } from '../logger.ts';
import { supportedScopes } from '../tools/index.ts';
import { createUpstreamCredential } from '../upstream/credentials.ts';
import { notesClientFor } from '../upstream/notes-client.ts';
import { createHttpApp } from './app.ts';

async function authFor(config: HttpConfig, upstream: boolean) {
  const { auth } = config;
  if (auth.mode === 'token') {
    return { verifier: createTokenVerifier(auth.tokens, supportedScopes(auth.scopes, upstream)) };
  }
  if (auth.mode === 'oauth') {
    const authorizationServer = await discoverAuthorizationServer(auth.issuer);
    const verifier = createJwtVerifier({
      issuer: auth.issuer,
      audience: config.publicUrl.href,
      keys: remoteKeys(jwksUrlOf(authorizationServer, auth.jwksUrl)),
    });
    return { verifier, authorizationServer };
  }
  return { verifier: null };
}

async function shutdown(
  server: Server,
  http: ReturnType<typeof createHttpApp>,
  config: HttpConfig,
  logger: Logger,
) {
  http.readiness.draining = true;
  await sleep(config.drainMs);
  const closed = new Promise((resolve) => server.close(resolve));
  const deadline = sleep(config.shutdownTimeoutMs).then(() => false);
  if (!(await Promise.race([http.inFlight.idle().then(() => true), deadline]))) {
    logger.warn({ inFlight: http.inFlight.active }, 'Cutting off requests still running');
  }
  await http.close();
  // Keep-alive sockets go idle as their last responses finish; close each one as soon as it does.
  const reaper = setInterval(() => server.closeIdleConnections(), 50);
  server.closeIdleConnections();
  if (!(await Promise.race([closed.then(() => true), deadline]))) server.closeAllConnections();
  await closed;
  clearInterval(reaper);
}

export async function serveHttp(env: NodeJS.ProcessEnv = process.env) {
  const config = loadHttpConfig(env);
  const logger = createLogger(config.logLevel);
  const upstream = loadUpstreamConfig(env);
  const notes = upstream
    ? notesClientFor(
        upstream,
        createUpstreamCredential(upstream.auth, { timeoutMs: upstream.timeoutMs, logger }),
      )
    : null;
  const http = createHttpApp({ config, logger, notes, ...(await authFor(config, notes !== null)) });

  const server = serve({
    fetch: http.app.fetch,
    port: config.port,
    hostname: config.host,
  }) as Server;
  await once(server, 'listening');
  http.readiness.ready = true;
  const { port } = server.address() as AddressInfo;
  logger.info({ port, url: config.publicUrl.href, auth: config.auth.mode }, 'MCP server listening');

  return { logger, close: () => shutdown(server, http, config, logger) };
}
