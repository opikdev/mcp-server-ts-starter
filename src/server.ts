import { type AuthInfo, McpServer } from '@modelcontextprotocol/server';
import type { Logger } from './logger.ts';
import { registerDocs } from './resources/docs.ts';
import { enabledTools, supportedScopes } from './tools/index.ts';
import type { NotesClientFor } from './upstream/notes-client.ts';
import { serverName, serverVersion } from './version.ts';

export const defaultScopes = ['mcp'];

export interface ServerContext {
  transport: 'stdio' | 'http';
  logger: Logger;
  authInfo?: AuthInfo | undefined;
  now?: () => Date;
  notes?: NotesClientFor | null;
  baseScopes?: string[];
}

export function createServer({
  transport,
  logger,
  authInfo,
  now = () => new Date(),
  notes = null,
  baseScopes = defaultScopes,
}: ServerContext): McpServer {
  const server = new McpServer(
    { name: serverName, version: serverVersion },
    {
      instructions:
        'Use search_docs to find answers about this server, then read the linked docs:// resources.',
    },
  );
  const upstream = notes !== null;
  const deps = {
    logger,
    now,
    transport,
    notes: notes?.(authInfo) ?? null,
    allScopes: supportedScopes(baseScopes, upstream),
  };
  for (const tool of enabledTools(upstream)) tool.register(server, deps);
  registerDocs(server);
  return server;
}
