import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Logger } from '../logger.ts';
import { catchToolErrors } from '../tool-errors.ts';
import { type NotesClient, noteSchema } from '../upstream/notes-client.ts';

export function registerCreateNoteTool(server: McpServer, logger: Logger, notes: NotesClient) {
  server.registerTool(
    'create_note',
    {
      title: 'Create a note',
      description:
        'Creates a note in the notes API. Each call creates a new note, so call it once per note.',
      inputSchema: z.object({
        title: z.string().trim().min(1).max(200).describe('Short title.'),
        body: z.string().max(10_000).default('').describe('Note text.'),
      }),
      outputSchema: noteSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    catchToolErrors(logger, async (input) => {
      const note = await notes.create(input);
      return {
        content: [{ type: 'text', text: `Created "${note.title}" (${note.id}).` }],
        structuredContent: note,
      };
    }),
  );
}
