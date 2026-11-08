import { describe, expect, it } from 'vitest';
import { createNotesClient, UpstreamError } from '../../src/upstream/notes-client.ts';
import { createFakeNotesApi, upstreamToken } from '../fake-notes-api.ts';

function setup(options: { timeoutMs?: number; fetch?: typeof fetch; baseUrl?: string } = {}) {
  const api = createFakeNotesApi();
  const client = createNotesClient({
    baseUrl: options.baseUrl ?? 'http://notes.test',
    token: upstreamToken,
    timeoutMs: options.timeoutMs ?? 1000,
    fetch: options.fetch ?? (async (input, init) => api.app.request(new Request(input, init))),
  });
  return { api, client };
}

describe('notes client', () => {
  it('lists a page and sends the token', async () => {
    const { api, client } = setup();
    const page = await client.list({ limit: 2 });
    expect(page.data.map((note) => note.id)).toEqual(['note_3', 'note_2']);
    expect(page.meta.nextCursor).toBe('note_2');
    expect(api.requests[0]?.headers.get('authorization')).toBe(`Bearer ${upstreamToken}`);
    expect(new URL(api.requests[0]?.url ?? '').search).toBe('?limit=2');
  });

  it('follows a cursor', async () => {
    const { client } = setup();
    expect((await client.list({ limit: 2, cursor: 'note_2' })).data.map((note) => note.id)).toEqual(
      ['note_1'],
    );
  });

  it('keeps a base path', async () => {
    const { api, client } = setup({ baseUrl: 'http://notes.test/api' });
    await client.list({ limit: 1 }).catch(() => undefined);
    expect(new URL(api.requests[0]?.url ?? '').pathname).toBe('/api/v1/notes');
  });

  it('creates a note', async () => {
    const { client } = setup();
    expect(await client.create({ title: 'New', body: 'x' })).toMatchObject({
      id: 'note_4',
      title: 'New',
    });
  });

  it.each([
    [401, {}, {}, 'rejected this server’s credentials'],
    [403, {}, {}, 'rejected this server’s credentials'],
    [429, {}, { 'Retry-After': '17' }, 'Retry in 17 seconds'],
    [400, { detail: 'title is too long' }, {}, 'refused the request: title is too long'],
    [404, 'not json', {}, 'refused the request: HTTP 404'],
    [503, {}, {}, 'failed with HTTP 503'],
  ])('turns HTTP %i into a clear error', async (status, body, headers, message) => {
    const { api, client } = setup();
    api.failNext(status, body, headers);
    const error = await client.list({ limit: 1 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as UpstreamError).message).toContain(message);
    expect((error as UpstreamError).status).toBe(status);
    expect((error as UpstreamError).message).not.toContain(upstreamToken);
  });

  it('times out a slow API', async () => {
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
      );
    const { client } = setup({ timeoutMs: 100, fetch: hang });
    await expect(client.list({ limit: 1 })).rejects.toThrow('didn’t answer within 0.1 seconds');
  });

  it('reports an unreachable API', async () => {
    const { client } = setup({ fetch: async () => Promise.reject(new TypeError('fetch failed')) });
    await expect(client.list({ limit: 1 })).rejects.toThrow('Couldn’t reach the notes API');
  });

  it.each([
    ['an unexpected shape', Response.json({ items: [] })],
    ['a body that is not JSON', new Response('<html>', { status: 200 })],
  ])('rejects %s', async (_label, response) => {
    const { client } = setup({ fetch: async () => response });
    await expect(client.list({ limit: 1 })).rejects.toThrow('doesn’t understand');
  });
});
