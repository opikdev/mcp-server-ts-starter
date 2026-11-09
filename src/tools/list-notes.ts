import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Logger } from '../logger.ts';
import { catchToolErrors } from '../tool-errors.ts';
import { type NotesClient, noteSchema } from '../upstream/notes-client.ts';

export function registerListNotesTool(server: McpServer, logger: Logger, notes: NotesClient) {
  server.registerTool(
    'list_notes',
    {
      title: 'List notes',
      description:
        'Lists notes from the notes API, newest first. Pass nextCursor from a result to get the next page.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).default(10).describe('Notes per page.'),
        cursor: z.string().max(100).optional().describe('nextCursor from a previous result.'),
      }),
      outputSchema: z.object({ notes: z.array(noteSchema), nextCursor: z.string().nullable() }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    catchToolErrors(logger, async ({ limit, cursor }) => {
      const page = await notes.list({ limit, cursor });
      const lines = page.data.map((note) => `- ${note.title} (${note.id})`);
      const text =
        page.data.length === 0 ? 'No notes.' : `${page.data.length} note(s):\n${lines.join('\n')}`;
      return {
        content: [{ type: 'text', text }],
        structuredContent: { notes: page.data, nextCursor: page.meta.nextCursor },
      };
    }),
  );
}
