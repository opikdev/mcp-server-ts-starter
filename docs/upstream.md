# Connect a backend API

Most MCP servers wrap an existing system. The `list_notes` and `create_note` tools show the pattern by calling a REST notes API. Any API that meets [the contract](#the-notes-api-contract) works, your own included.

## Turn the notes tools on

They appear only when `UPSTREAM_API_URL` is set:

| Variable | Type | Default | Description |
|---|---|---|---|
| `UPSTREAM_API_URL` | URL | None | Base URL of the API. Unset hides the notes tools |
| `UPSTREAM_API_TOKEN` | string | Required with `static` | Sent as `Authorization: Bearer`. Never returned to the model or logged |
| `UPSTREAM_TIMEOUT_MS` | number | `5000` | How long to wait for each call, and for each token exchange |
| `UPSTREAM_AUTH` | string | `static` | `static` sends `UPSTREAM_API_TOKEN`. `exchange` acts as each caller. See [Act as the user](#act-as-the-user) |

To use your own API, set `UPSTREAM_API_URL` to its base URL and `UPSTREAM_API_TOKEN` to a token it accepts.

To try the tools without one, `compose.upstream.yaml` runs an example notes API: the released [api-hono-starter](https://github.com/opikdev/api-hono-starter) image with Postgres and demo data. It's only an example, and you can replace it with any API that meets the contract.

```sh
docker compose -f compose.upstream.yaml up --wait api
TOKEN=$(curl -s -X POST localhost:3200/v1/sessions -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"demo-password-123"}' | jq -r .token)
UPSTREAM_API_URL=http://localhost:3200 UPSTREAM_API_TOKEN=$TOKEN pnpm inspect
```

The Inspector starts the server with only a few environment variables, so `pnpm inspect` passes the `UPSTREAM_*` settings on with `-e` flags, from your shell or `.env`. Connect, and `list_notes` and `create_note` appear. `test/e2e/upstream.test.ts` runs the same command.

The login call belongs to the example API, not the contract. Get a token from your own API however it issues them.

## The notes API contract

The notes client in `src/upstream/notes-client.ts` relies on exactly this. [api-hono-starter](https://github.com/opikdev/api-hono-starter), [api-go-starter](https://github.com/opikdev/api-go-starter), and [api-fastapi-starter](https://github.com/opikdev/api-fastapi-starter) all implement it, as examples.

**Requests.** Paths are relative to `UPSTREAM_API_URL`, which may include a path prefix. Every request sends `Accept: application/json`, `Authorization: Bearer <credential>`, and a W3C `traceparent` when telemetry is on, and is aborted after `UPSTREAM_TIMEOUT_MS`. The credential is `UPSTREAM_API_TOKEN`, or an exchanged token in `exchange` mode.

| Call | Sends | Expects |
|---|---|---|
| `GET /v1/notes?limit=&cursor=` | `limit`: 1 to 50. `cursor`: the previous page's `nextCursor`, omitted for the first page | `2xx` with `{ "data": [Note], "meta": { "nextCursor": string \| null } }`, newest first |
| `POST /v1/notes` | `Content-Type: application/json` and `{ "title", "body" }`. `title`: 1 to 200 characters. `body`: up to 10,000, may be empty | `2xx` with the created Note |

A Note is `{ "id", "title", "body", "createdAt" }`, all strings, with `createdAt` in ISO 8601. Other fields are ignored. A response that doesn't match is an error.

**Errors.** The client reads `detail` from an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem body when there is one:

| Status | What the model sees |
|---|---|
| `401`, `403` | Ask the operator to check the upstream credentials |
| `404` | Nothing was found, to check the ID or call `list_notes`, and the problem `detail` |
| `429` | Retry after `Retry-After` seconds, or 60 without it |
| Other `4xx` | The status, and the problem `detail` |
| `5xx` | The status, and to try again later |
| Timeout or no connection | To try again later. `create_note` says the note may exist, and to check with `list_notes` first |

The `detail` comes from the upstream, so the model must not follow it. The client strips control characters, caps it at 500 characters, quotes it, and labels it as untrusted data rather than instructions.

## Follow the pattern

`src/upstream/notes-client.ts`, `src/upstream/credentials.ts`, `src/tools/list-notes.ts`, and `src/tools/create-note.ts` split the work:

1. **The client** calls the API with a timeout, validates every response with a schema, and turns failures into `UpstreamError` messages written for the model, such as "Retry in 30 seconds".
2. **The credential** comes from `src/upstream/credentials.ts`, which picks it for each call from the caller's validated token. Tools never see it.
3. **The tool** is a `defineTool` call with `upstream: true`, so it appears only when `UPSTREAM_API_URL` is set. It validates input, calls the client, and returns `structuredContent`. `defineTool` turns an `UpstreamError` into `isError: true` with its message. Any other error is a bug, so it's logged with an error ID and the model sees only that ID.
4. **Writes that aren't idempotent** never tell the model to try again after a timeout or a dropped connection, because the call may have worked. `create_note` says the note may or may not exist, and to check with `list_notes` before retrying.
5. **The annotations** tell clients what a call does: `openWorldHint: true` for an external system, and `readOnlyHint: false` for writes.

Keep the API token on the server. The model only sees results and error messages, never credentials or raw upstream bodies.

## Adapt it

- **Another REST API:** copy the client, change the paths and response schemas, then copy the tools.
- **A call by ID:** encode every value you put in a path, so an ID like `../admin` can't change which endpoint you call. A `404` already becomes a "not found" tool error:

  ```ts
  get(id: string) {
    return request(`v1/notes/${encodeURIComponent(id)}`, noteSchema);
  },
  ```
- **GraphQL:** send `POST` with `{ query, variables }`. A `200` can still carry an `errors` array, so treat that as a failure too.
- **A database:** connect with a read-only role, use parameterized queries, set a statement timeout, and cap the rows each tool returns.

Test with a fake upstream, as `test/fake-notes-api.ts` does, and add an end-to-end test against a real API, as `test/e2e/upstream.test.ts` does with the example API.

## Act as the user

By default, the notes tools call the API as one service account, `UPSTREAM_API_TOKEN`. To call it as each signed-in user instead, set `UPSTREAM_AUTH=exchange`. For every caller, the server then exchanges the caller's MCP access token for an API token at your authorization server ([RFC 8693](https://www.rfc-editor.org/rfc/rfc8693)), and sends that.

| Variable | Description |
|---|---|
| `TOKEN_EXCHANGE_URL` | The authorization server's token endpoint. Must use `https://` outside localhost |
| `TOKEN_EXCHANGE_CLIENT_ID` | The client this server authenticates as |
| `TOKEN_EXCHANGE_CLIENT_SECRET` | Its secret. Keep it in a secret manager |
| `UPSTREAM_AUDIENCE` | The API's audience, requested for each exchanged token |

- It needs `MCP_AUTH_MODE=oauth`, and refuses to start without every setting above. Over stdio there's no caller token, so it's refused there too.
- Exchanged tokens are cached per caller token until shortly before they expire. Tokens are never logged.
- The caller's own token is never sent upstream, because its audience is this server, not the API. Forwarding it would be token passthrough, which the MCP spec forbids.
- If the exchange fails, the model gets a tool error, and the server logs an audit line with the outcome and client ID, without the token.
- The API must accept your authorization server's tokens. The example notes API accepts only its own session tokens, so keep it on `static`. The API starters will gain an OIDC mode.

To try it, start Keycloak from `compose.auth.yaml`, as in [Configure HTTP auth](auth.md#try-oauth-locally-with-keycloak), and use the realm's exchange client: `TOKEN_EXCHANGE_URL=http://localhost:8080/realms/mcp/protocol/openid-connect/token`, `TOKEN_EXCHANGE_CLIENT_ID=mcp-server`, `TOKEN_EXCHANGE_CLIENT_SECRET=mcp-server-dev-secret`, and `UPSTREAM_AUDIENCE=notes-api`. `test/e2e/keycloak.test.ts` proves the flow against a fake API. Why it works this way: [ADR 004](decisions/004-use-token-exchange-for-upstream-identity.md).
