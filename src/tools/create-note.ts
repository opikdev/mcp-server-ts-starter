import { z } from 'zod';
import { UpstreamError } from '../upstream/errors.ts';
import { type Note, noteSchema } from '../upstream/notes-client.ts';
import { defineTool, toolError } from './tool.ts';

const unknownOutcome = {
  timeout:
    "The notes API didn't answer in time, so the note may or may not exist. Call list_notes to check before retrying.",
  unreachable:
    'The connection to the notes API failed, so the note may or may not exist. Call list_notes to check before retrying.',
};

export const notesWriteScope = 'notes:write';

export const createNoteTool = defineTool({
  name: 'create_note',
  scope: notesWriteScope,
  upstream: true,
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
  handler:
    ({ notes }) =>
    async (input) => {
      let note: Note;
      try {
        note = await notes.create(input);
      } catch (error) {
        if (
          error instanceof UpstreamError &&
          (error.kind === 'timeout' || error.kind === 'unreachable')
        ) {
          return toolError(unknownOutcome[error.kind]);
        }
        throw error;
      }
      return {
        content: [{ type: 'text', text: `Created "${note.title}" (${note.id}).` }],
        structuredContent: note,
      };
    },
});
