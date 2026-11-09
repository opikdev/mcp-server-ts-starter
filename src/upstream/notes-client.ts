import { z } from 'zod';

export const noteSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
});

const pageSchema = z.object({
  data: z.array(noteSchema),
  meta: z.object({ nextCursor: z.string().nullable() }),
});

const problemSchema = z.object({ type: z.string().optional(), detail: z.string().optional() });

export type Note = z.infer<typeof noteSchema>;
export type NotePage = z.infer<typeof pageSchema>;

export class UpstreamError extends Error {
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    status: number | null = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface NotesClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export interface NotesClient {
  list(options: { limit: number; cursor?: string | undefined }): Promise<NotePage>;
  create(input: { title: string; body: string }): Promise<Note>;
}

async function problemDetail(response: Response): Promise<string | undefined> {
  try {
    return problemSchema.parse(await response.json()).detail;
  } catch {
    return undefined;
  }
}

async function toError(response: Response): Promise<UpstreamError> {
  const detail = await problemDetail(response);
  const retryAfter = Number(response.headers.get('retry-after'));
  switch (response.status) {
    case 401:
    case 403:
      return new UpstreamError(
        'The notes API rejected this server’s credentials. Ask the operator to check UPSTREAM_API_TOKEN.',
        response.status,
      );
    case 429:
      return new UpstreamError(
        `The notes API is rate limiting requests. Retry in ${retryAfter || 60} seconds.`,
        429,
        retryAfter || 60,
      );
    default:
      if (response.status >= 400 && response.status < 500) {
        return new UpstreamError(
          `The notes API refused the request: ${detail ?? `HTTP ${response.status}`}`,
          response.status,
        );
      }
      return new UpstreamError(
        `The notes API failed with HTTP ${response.status}. Try again later.`,
        response.status,
      );
  }
}

export function createNotesClient({
  baseUrl,
  token,
  timeoutMs,
  fetch: fetcher = fetch,
}: NotesClientOptions): NotesClient {
  const root = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(new URL(path, root), {
        ...init,
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new UpstreamError(
          `The notes API didn’t answer within ${timeoutMs / 1000} seconds. Try again later.`,
        );
      }
      throw new UpstreamError('Couldn’t reach the notes API. Try again later.');
    }

    if (!response.ok) throw await toError(response);
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success)
      throw new UpstreamError('The notes API sent a response this server doesn’t understand.');
    return parsed.data;
  }

  return {
    list({ limit, cursor }) {
      const query = new URLSearchParams({ limit: String(limit) });
      if (cursor) query.set('cursor', cursor);
      return request(`v1/notes?${query}`, pageSchema);
    },
    create(input) {
      return request('v1/notes', noteSchema, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
    },
  };
}
