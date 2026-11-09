#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ConfigError, loadLogLevel, loadUpstreamConfig } from './config.ts';
import { serveHttp } from './http/serve.ts';
import { createLogger } from './logger.ts';
import { createServer } from './server.ts';
import { createNotesClient } from './upstream/notes-client.ts';
import { serverName, serverVersion } from './version.ts';

const usage = `Usage: ${serverName} [--http]

Without flags, serves MCP over stdio for a client that launches this process.
With --http, serves Streamable HTTP. See docs/auth.md for the required settings.`;

const args = process.argv.slice(2);

try {
  if (args.includes('--help') || args.includes('-h')) {
    console.error(usage);
  } else if (args.includes('--version')) {
    console.error(serverVersion);
  } else if (args.includes('--http')) {
    const { logger, close } = await serveHttp();
    for (const signal of ['SIGTERM', 'SIGINT']) {
      process.once(signal, async () => {
        logger.info({ signal }, 'Shutting down');
        await close();
        process.exit(0);
      });
    }
  } else {
    const logger = createLogger(loadLogLevel());
    const upstream = loadUpstreamConfig();
    const notes = upstream ? createNotesClient(upstream) : null;
    serveStdio(() => createServer({ transport: 'stdio', logger, notes }));
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
