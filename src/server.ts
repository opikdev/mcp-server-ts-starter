import { type AuthInfo, McpServer } from '@modelcontextprotocol/server';
import type { Logger } from './logger.ts';
import { registerDocs } from './resources/docs.ts';
import { registerNotesTools } from './tools/notes.ts';
import { registerSearchDocsTool } from './tools/search-docs.ts';
import { registerTimeTool } from './tools/time.ts';
import { registerWhoamiTool } from './tools/whoami.ts';
import type { NotesClient } from './upstream/notes-client.ts';
import { serverName, serverVersion } from './version.ts';

export interface ServerContext {
  transport: 'stdio' | 'http';
  logger: Logger;
  authInfo?: AuthInfo | undefined;
  now?: () => Date;
  notes?: NotesClient | null;
}

export function createServer({
  transport,
  logger,
  authInfo,
  now = () => new Date(),
  notes = null,
}: ServerContext): McpServer {
  const server = new McpServer(
    { name: serverName, version: serverVersion },
    {
      instructions:
        'Use search_docs to find answers about this server, then read the linked docs:// resources.',
    },
  );
  registerTimeTool(server, logger, now);
  registerSearchDocsTool(server, logger);
  registerWhoamiTool(server, logger, transport, authInfo);
  if (notes) registerNotesTools(server, logger, notes);
  registerDocs(server);
  return server;
}
