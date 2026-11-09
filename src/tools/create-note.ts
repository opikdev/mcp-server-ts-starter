import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { requireScope } from '../auth/scopes.ts';
import type { Logger } from '../logger.ts';
import { catchToolErrors, toolError } from '../tool-errors.ts';
import {
  type Note,
  type NotesClient,
  noteSchema,
  UpstreamError,
} from '../upstream/notes-client.ts';

const unknownOutcome = {
  timeout:
    "The notes API didn't answer in time, so the note may or may not exist. Call list_notes to check before retrying.",
  unreachable:
    'The connection to the notes API failed, so the note may or may not exist. Call list_notes to check before retrying.',
};

export const notesWriteScope = 'notes:write';

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
    catchToolErrors(logger, async (input, ctx) => {
      const denied = requireScope(ctx.http?.authInfo, notesWriteScope, 'create notes');
      if (denied) return denied;
      let note: Note;
      try {
        note = await notes.create(input);
      } catch (error) {
        if (error instanceof UpstreamError && error.kind !== 'response') {
          return toolError(unknownOutcome[error.kind]);
        }
        throw error;
      }
      return {
        content: [{ type: 'text', text: `Created "${note.title}" (${note.id}).` }],
        structuredContent: note,
      };
    }),
  );
}
