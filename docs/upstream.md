# Connect a backend API

Most MCP servers wrap an existing system. The `list_notes` and `create_note` tools show the pattern by calling a REST notes API. Any API that meets [the contract](#the-notes-api-contract) works, your own included.

## Turn the notes tools on

They appear only when `UPSTREAM_API_URL` is set:

| Variable | Type | Default | Description |
|---|---|---|---|
| `UPSTREAM_API_URL` | URL | None | Base URL of the API. Unset hides the notes tools |
| `UPSTREAM_API_TOKEN` | string | Required with the URL | Sent as `Authorization: Bearer`. Never returned to the model or logged |
| `UPSTREAM_TIMEOUT_MS` | number | `5000` | How long to wait for each call |

To use your own API, set `UPSTREAM_API_URL` to its base URL and `UPSTREAM_API_TOKEN` to a token it accepts.

To try the tools without one, `compose.upstream.yaml` runs an example notes API: the released [api-hono-starter](https://github.com/opikdev/api-hono-starter) image with Postgres and demo data. It's only an example, and you can replace it with any API that meets the contract.

```sh
docker compose -f compose.upstream.yaml up --wait api
TOKEN=$(curl -s -X POST localhost:3200/v1/sessions -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"demo-password-123"}' | jq -r .token)
UPSTREAM_API_URL=http://localhost:3200 UPSTREAM_API_TOKEN=$TOKEN pnpm inspect
```

The login call belongs to the example API, not the contract. Get a token from your own API however it issues them.

## The notes API contract

The notes client in `src/upstream/notes-client.ts` relies on exactly this. [api-hono-starter](https://github.com/opikdev/api-hono-starter), [api-go-starter](https://github.com/opikdev/api-go-starter), and [api-fastapi-starter](https://github.com/opikdev/api-fastapi-starter) all implement it, as examples.

**Requests.** Paths are relative to `UPSTREAM_API_URL`, which may include a path prefix. Every request sends `Accept: application/json` and `Authorization: Bearer <UPSTREAM_API_TOKEN>`, and is aborted after `UPSTREAM_TIMEOUT_MS`.

| Call | Sends | Expects |
|---|---|---|
| `GET /v1/notes?limit=&cursor=` | `limit`: 1 to 50. `cursor`: the previous page's `nextCursor`, omitted for the first page | `2xx` with `{ "data": [Note], "meta": { "nextCursor": string \| null } }`, newest first |
| `POST /v1/notes` | `Content-Type: application/json` and `{ "title", "body" }`. `title`: 1 to 200 characters. `body`: up to 10,000, may be empty | `2xx` with the created Note |

A Note is `{ "id", "title", "body", "createdAt" }`, all strings, with `createdAt` in ISO 8601. Other fields are ignored. A response that doesn't match is an error.

**Errors.** The client reads `detail` from an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem body when there is one:

| Status | What the model sees |
|---|---|
| `401`, `403` | Ask the operator to check `UPSTREAM_API_TOKEN` |
| `429` | Retry after `Retry-After` seconds, or 60 without it |
| Other `4xx` | The problem `detail`, or the status |
| `5xx` | The status, and to try again later |
| Timeout or no connection | To try again later. `create_note` says the note may exist, and to check with `list_notes` first |

## Follow the pattern

`src/upstream/notes-client.ts`, `src/tools/list-notes.ts`, and `src/tools/create-note.ts` split the work:

1. **The client** calls the API with a timeout, validates every response with a schema, and turns failures into `UpstreamError` messages written for the model, such as "Retry in 30 seconds".
2. **The tool** validates input, calls the client, and returns `structuredContent`. Its handler is wrapped in `catchToolErrors` from `src/tool-errors.ts`, which turns an `UpstreamError` into `isError: true` with its message. Any other error is a bug, so the wrapper logs it with an error ID and shows the model only that ID.
3. **Writes that aren't idempotent** never tell the model to try again after a timeout or a dropped connection, because the call may have worked. `create_note` says the note may or may not exist, and to check with `list_notes` before retrying.
4. **The annotations** tell clients what a call does: `openWorldHint: true` for an external system, and `readOnlyHint: false` for writes.

Keep the API token on the server. The model only sees results and error messages, never credentials or raw upstream bodies.

## Adapt it

- **Another REST API:** copy the client, change the paths and response schemas, then copy the tools.
- **GraphQL:** send `POST` with `{ query, variables }`. A `200` can still carry an `errors` array, so treat that as a failure too.
- **A database:** connect with a read-only role, use parameterized queries, set a statement timeout, and cap the rows each tool returns.

Test with a fake upstream, as `test/fake-notes-api.ts` does, and add an end-to-end test against a real API, as `test/e2e/upstream.test.ts` does with the example API.

## Act as the user

These tools call the API as one service account. To act as each user, exchange the caller's MCP access token for an API token ([RFC 8693](https://www.rfc-editor.org/rfc/rfc8693)) with your authorization server. Don't forward the MCP token itself, because its audience is this server, not the API.
