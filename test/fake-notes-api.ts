import { Hono } from 'hono';

export const upstreamToken = 'upstream-secret-token-0123456789';

export interface FakeNotesApi {
  app: Hono;
  failNext: (status: number, body?: unknown, headers?: Record<string, string>) => void;
  requests: Request[];
}

export function createFakeNotesApi(): FakeNotesApi {
  const notes = [
    { id: 'note_3', title: 'Third', body: 'c', createdAt: '2026-11-08T03:00:00.000Z' },
    { id: 'note_2', title: 'Second', body: 'b', createdAt: '2026-11-08T02:00:00.000Z' },
    { id: 'note_1', title: 'First', body: 'a', createdAt: '2026-11-08T01:00:00.000Z' },
  ];
  let failure: { status: number; body: unknown; headers: Record<string, string> } | null = null;
  const requests: Request[] = [];
  const app = new Hono();

  app.use(async (c, next) => {
    requests.push(c.req.raw.clone());
    if (failure) {
      const { status, body, headers } = failure;
      failure = null;
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/problem+json', ...headers },
      });
    }
    if (c.req.header('authorization') !== `Bearer ${upstreamToken}`) {
      return c.json({ type: 'urn:problem:unauthorized', detail: 'bad token' }, 401);
    }
    await next();
  });

  app.get('/v1/notes', (c) => {
    const limit = Number(c.req.query('limit') ?? 20);
    const cursor = c.req.query('cursor');
    const start = cursor ? notes.findIndex((note) => note.id === cursor) + 1 : 0;
    const data = notes.slice(start, start + limit);
    const nextCursor = start + limit < notes.length ? (data.at(-1)?.id ?? null) : null;
    return c.json({ data, meta: { limit, nextCursor } });
  });

  app.post('/v1/notes', async (c) => {
    const input = (await c.req.json()) as { title: string; body: string };
    const note = {
      id: `note_${notes.length + 1}`,
      ...input,
      createdAt: '2026-11-08T04:00:00.000Z',
    };
    notes.unshift(note);
    return c.json({ ...note, version: 1, updatedAt: note.createdAt }, 201);
  });

  return {
    app,
    requests,
    failNext: (status, body = {}, headers = {}) => {
      failure = { status, body, headers };
    },
  };
}
