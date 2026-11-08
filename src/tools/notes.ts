import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { type NotesClient, UpstreamError } from '../upstream/notes-client.ts';

const noteOutput = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
});

function failure(error: unknown) {
  if (!(error instanceof UpstreamError)) throw error;
  return { isError: true, content: [{ type: 'text' as const, text: error.message }] };
}

export function registerNotesTools(server: McpServer, notes: NotesClient) {
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
      outputSchema: z.object({ notes: z.array(noteOutput), nextCursor: z.string().nullable() }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ limit, cursor }) => {
      try {
        const page = await notes.list({ limit, cursor });
        const lines = page.data.map((note) => `- ${note.title} (${note.id})`);
        const text =
          page.data.length === 0
            ? 'No notes.'
            : `${page.data.length} note(s):\n${lines.join('\n')}`;
        return {
          content: [{ type: 'text', text }],
          structuredContent: { notes: page.data, nextCursor: page.meta.nextCursor },
        };
      } catch (error) {
        return failure(error);
      }
    },
  );

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
      outputSchema: noteOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const note = await notes.create(input);
        return {
          content: [{ type: 'text', text: `Created "${note.title}" (${note.id}).` }],
          structuredContent: note,
        };
      } catch (error) {
        return failure(error);
      }
    },
  );
}
