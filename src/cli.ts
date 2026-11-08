#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ConfigError, loadLogLevel } from './config.ts';
import { serveHttp } from './http/serve.ts';
import { createLogger } from './logger.ts';
import { createServer } from './server.ts';
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
    await serveHttp();
  } else {
    const logger = createLogger(loadLogLevel());
    serveStdio(() => createServer({ transport: 'stdio' }));
    logger.info({ version: serverVersion }, 'MCP server ready on stdio');
  }
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  process.exit(1);
}
