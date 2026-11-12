#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ConfigError, loadLogLevel, loadTelemetryEndpoint, loadUpstreamConfig } from './config.ts';
import { serveHttp } from './http/serve.ts';
import { createLogger } from './logger.ts';
import { createServer } from './server.ts';
import { createUpstreamCredential } from './upstream/credentials.ts';
import { notesClientFor } from './upstream/notes-client.ts';
import { serverName, serverVersion } from './version.ts';

const usage = `Usage: ${serverName} [--http]

Without flags, serves MCP over stdio for a client that launches this process.
With --http, serves Streamable HTTP. See docs/auth.md for the required settings.`;

const args = process.argv.slice(2);

async function startTelemetry(): Promise<() => Promise<void>> {
  if (!loadTelemetryEndpoint()) return async () => undefined;
  const telemetry = await import('./telemetry.ts');
  return telemetry.startTelemetry();
}

try {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage);
  } else if (args.includes('--version')) {
    console.log(serverVersion);
  } else if (args.includes('--http')) {
    const stopTelemetry = await startTelemetry();
    const { logger, close } = await serveHttp();
    for (const signal of ['SIGTERM', 'SIGINT']) {
      process.once(signal, async () => {
        logger.info({ signal }, 'Shutting down');
        await close();
        await stopTelemetry();
        process.exit(0);
      });
    }
  } else {
    const logger = createLogger(loadLogLevel());
    const upstream = loadUpstreamConfig();
    if (upstream?.auth.mode === 'exchange') {
      throw new ConfigError('UPSTREAM_AUTH=exchange works only over HTTP, where callers sign in.');
    }
    const stopTelemetry = await startTelemetry();
    const notes = upstream
      ? notesClientFor(
          upstream,
          createUpstreamCredential(upstream.auth, { timeoutMs: upstream.timeoutMs, logger }),
        )
      : null;
    serveStdio(() => createServer({ transport: 'stdio', logger, notes }));
    process.once('beforeExit', () => void stopTelemetry());
    logger.info(
      { version: serverVersion, upstream: upstream?.baseUrl ?? null },
      'MCP server ready on stdio',
    );
  }
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  process.exit(1);
}
