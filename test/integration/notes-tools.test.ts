import { describe, expect, it } from 'vitest';
import { createTokenVerifier } from '../../src/auth/token.ts';
import { createHttpApp } from '../../src/http/app.ts';
import { createNotesClient, type NotesClient } from '../../src/upstream/notes-client.ts';
import { upstreamToken } from '../fake-notes-api.ts';
import { capturingLogger, config, connect, devToken, fakeNotes, track } from '../helpers.ts';

function setup(override?: NotesClient | null) {
  const { api, client } = fakeNotes();
  const { logger, logs } = capturingLogger();
  const cfg = config();
  const http = track(
    createHttpApp({
      config: cfg,
      logger,
      verifier: createTokenVerifier([devToken], ['mcp']),
      notes: override === undefined ? client : override,
    }),
  );
  return { api, http, url: cfg.publicUrl, logs };
}

describe.each(['auto', 'legacy'] as const)('notes tools, for a %s client', (era) => {
  it('are hidden without an upstream', async () => {
    const { http, url } = setup(null);
    const { tools } = await (await connect(http, url, { token: devToken, era })).listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['get_time', 'search_docs', 'whoami']);
  });

  it('lists notes, then the next page', async () => {
    const { http, url } = setup();
    const client = await connect(http, url, { token: devToken, era });
    const first = await client.callTool({ name: 'list_notes', arguments: { limit: 2 } });
    const page = first.structuredContent as { notes: { id: string }[]; nextCursor: string | null };
    expect(page.notes.map((note) => note.id)).toEqual(['note_3', 'note_2']);
    const second = await client.callTool({
      name: 'list_notes',
      arguments: { limit: 2, cursor: page.nextCursor },
    });
    expect(second.structuredContent).toMatchObject({ notes: [{ id: 'note_1' }], nextCursor: null });
  });

  it('creates a note the API then lists', async () => {
    const { http, url } = setup();
    const client = await connect(http, url, { token: devToken, era });
    const created = await client.callTool({
      name: 'create_note',
      arguments: { title: 'From MCP', body: 'hi' },
    });
    expect(created.structuredContent).toEqual({
      id: 'note_4',
      title: 'From MCP',
      body: 'hi',
      createdAt: '2026-11-08T04:00:00.000Z',
    });
    const listed = await client.callTool({ name: 'list_notes', arguments: { limit: 1 } });
    expect(listed.structuredContent).toMatchObject({ notes: [{ title: 'From MCP' }] });
  });

  it('rejects bad input before calling the API', async () => {
    const { api, http, url } = setup();
    const client = await connect(http, url, { token: devToken, era });
    const result = await client.callTool({ name: 'create_note', arguments: { title: '' } });
    expect(result.isError).toBe(true);
    expect(api.requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  });

  it('turns API failures into messages the model can act on, without leaking the token', async () => {
    const { api, http, url, logs } = setup();
    const client = await connect(http, url, { token: devToken, era });
    api.failNext(429, {}, { 'Retry-After': '30' });
    const result = await client.callTool({ name: 'list_notes', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'The notes API is rate limiting requests. Retry in 30 seconds.' },
    ]);
    expect(JSON.stringify(result)).not.toContain(upstreamToken);
    expect(logs()).not.toContain(upstreamToken);
  });

  it('logs an unexpected error with an ID, and shows the model only the ID', async () => {
    const broken: NotesClient = {
      list: async () => {
        throw new Error('connection to db:5432 failed for user notes_app');
      },
      create: async () => {
        throw new Error('unused');
      },
    };
    const { http, url, logs } = setup(broken);
    const client = await connect(http, url, { token: devToken, era });
    const result = await client.callTool({ name: 'list_notes', arguments: {} });
    expect(result.isError).toBe(true);
    const text = (result.content as { text: string }[])[0]?.text ?? '';
    const errorId = /error ID ([0-9a-f-]{36})/.exec(text)?.[1];
    expect(text).toBe(
      `The server failed unexpectedly. Report error ID ${errorId} to its operator.`,
    );
    expect(logs()).toContain(`"errorId":"${errorId}"`);
    expect(logs()).toContain('connection to db:5432 failed');
  });

  it.each([
    [
      'times out',
      ((_input, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
        )) as typeof fetch,
      "The notes API didn't answer in time, so the note may or may not exist. Call list_notes to check before retrying.",
    ],
    [
      'drops the connection',
      (async () => Promise.reject(new TypeError('fetch failed'))) as typeof fetch,
      'The connection to the notes API failed, so the note may or may not exist. Call list_notes to check before retrying.',
    ],
  ])('says a create may have happened when the API %s', async (_label, fetch, message) => {
    const notes = createNotesClient({
      baseUrl: 'http://notes.test',
      token: 't',
      timeoutMs: 100,
      fetch,
    });
    const { http, url } = setup(notes);
    const client = await connect(http, url, { token: devToken, era });
    const result = await client.callTool({ name: 'create_note', arguments: { title: 'Maybe' } });
    expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: message }] });
  });
});
