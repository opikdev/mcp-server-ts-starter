# Changelog

All notable changes to this repo are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.4.0] - 2026-11-12

### Security

- **Breaking:** `list_notes` now requires the `notes:read` scope in OAuth mode. A tool call without its scope gets `403` with a `WWW-Authenticate: Bearer error="insufficient_scope"` challenge from the SDK's `scopeChallenge`, instead of a tool error, so clients can step up.
- A `401` for a missing token carries `scope="mcp"` and `resource_metadata`, and no `error` code. A rejected token gets `error="invalid_token"`.
- **Breaking:** HTTP requests with an `Origin` outside `MCP_ALLOWED_ORIGINS`, which defaults to the `MCP_PUBLIC_URL` origin, get `403`.
- **Breaking:** in OAuth mode, `MCP_AUTH_ISSUER` and `MCP_PUBLIC_URL` must use `https://`, except on localhost and loopback addresses.
- Upstream error text reaches the model capped at 500 characters, without control characters, and labeled as untrusted data.
- Base images are pinned by digest, and Renovate keeps the pins with a 3-day minimum release age. The runtime image drops npm.
- The release scans the image with Trivy before pushing it, and pushes it with an SBOM, `mode=max` provenance, and a build provenance attestation. CI scans the image too, and the SBOM job only reads the repo.

### Added

- The README explains how to start a project with `pik new` or GitHub's **Use this template**. `pik new` removes that section from the project it creates.
- `UPSTREAM_AUTH=exchange`: the notes tools call the API as each user, by exchanging the caller's token at `TOKEN_EXCHANGE_URL` (RFC 8693), with cached tokens and audit logs. `static`, the service account, stays the default. See [ADR 004](docs/decisions/004-use-token-exchange-for-upstream-identity.md).
- `compose.auth.yaml`: a local Keycloak with a demo realm, for OAuth and token exchange, and an end-to-end test against it.
- OpenTelemetry traces and metrics over OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set: HTTP and tool call spans, request and tool call durations by tool and error, `traceparent` on upstream calls, and `trace_id` and `span_id` in logs.
- `SHUTDOWN_DRAIN_SECONDS` and `SHUTDOWN_TIMEOUT_SECONDS`, and `/readyz`, which fails while starting or draining.
- `server.json` lists the GHCR image as an `oci` package, and describes every setting, with secrets marked. The image carries the `io.modelcontextprotocol.server.name` label.
- `docs/deploy.md`: proxy and TLS, rate limiting, token audience per provider, secrets, shutdown, telemetry, and remotes. ADRs for token exchange, the scope challenge, and rate limiting at the proxy.

### Changed

- **Breaking:** tools are defined with `defineTool` in `src/tools/tool.ts` and listed in `src/tools/index.ts`. Scopes, `scopes_supported`, and enabled tools come from that list. `requireScope`, `src/auth/scopes.ts`, `catchToolErrors`, and `src/tool-errors.ts` are gone.
- `whoami` reports the scopes the caller really has. Over stdio, with static tokens, and with `none`, that's every scope.
- `pnpm inspect` pins the Inspector to 2.14.0 and passes the `UPSTREAM_*` settings to the server, so the documented notes quick start shows the notes tools.
- A `404` from the notes API becomes a "not found" tool error. `docs/upstream.md` shows how to encode an ID in a path.
- `--version` and `--help` print to stdout.
- Dependencies are at their latest releases.

- `docs/upstream.md` documents the notes API contract the notes tools rely on: endpoints, fields, auth, errors, and timeouts. Any API that meets it works. `compose.upstream.yaml` is labeled as an optional example backend and now runs `api-hono-starter:0.4.0`.
- `compose.upstream.yaml` runs the hardened `api-hono-starter:0.5.0` on a read-only filesystem. The notes client already relied only on `Retry-After` and the problem `detail`, so its rate-limit headers and error changes need nothing else.

### Fixed

- `SIGTERM` no longer aborts requests in flight. The server fails `/readyz`, drains, stops accepting, and lets requests finish before it closes the MCP handler. Before, a `create_note` in flight got an empty `499` while the note was still created.
- An unknown `docs://` URI returns JSON-RPC `-32602` with `data.uri`, as the 2026-07-28 spec requires.
- The protected resource metadata answers CORS preflights, so browser clients can read it.
- OAuth tokens with a space-separated `scp` claim, as Microsoft Entra ID issues, keep their scopes.

## [0.3.0] - 2026-11-09

### Added

- A dev container with Node 26, pnpm, and jq, so `pnpm verify` and `.agents/check.sh` run inside it.
- HTTP request IDs and access logs. Every response, including `401` and `403` rejections, carries `X-Request-Id`, and each request is logged with its ID, method, path, status, duration, and authenticated client ID.
- A contract test over every registered tool, with the notes tools on: a title, a one-line description, input and output schemas, and all four annotation hints.
- **Breaking:** per-tool scopes. `create_note` requires `notes:write`, checked with `requireScope` from `src/auth/scopes.ts`, and OAuth metadata lists it in `scopes_supported`. With OAuth, a token without it gets a tool error. With static tokens, with `none`, and over stdio, the caller has every scope.

### Changed

- The notes tools are tested on both protocol eras, and every tool is called over stdio too, so the README's testing claim holds. `AGENTS.md` lists the notes tools as samples.
- Every sample tool sets all four annotation hints explicitly.
- `list_notes` and `create_note` each live in their own file, `src/tools/list-notes.ts` and `src/tools/create-note.ts`, like every other tool.
- **Breaking:** `createServer` takes a `logger`, and `serveHttp` returns `{ logger, close }` while `src/cli.ts` handles signals. Every tool handler is wrapped in `catchToolErrors`, which logs an unexpected error with an error ID and shows the model only `The server failed unexpectedly. Report error ID <id> to its operator.` Before, the model saw the raw error message, and nothing was logged.
- The agent harness is v0.3.0. Its check also fails when the harness workflow or pre-commit hook is missing or no longer runs the check.
- `renovate.json` belongs to the project and extends the shared baseline preset. Generated projects extend only `config:recommended`.

### Fixed

- The release workflow runs `pnpm verify` and `pnpm test:e2e` before it publishes to GHCR or npm.
- HTTP shutdown no longer hangs on an open SSE stream. It closes the MCP handler first, then the server, and cuts off connections still open after 5 seconds. `src/http/serve.ts` is now covered by tests.
- After a timeout or dropped connection, `create_note` says the note may or may not exist and to check with `list_notes` before retrying, instead of telling the model to try again and risking a duplicate.
- Empty settings, such as `MCP_AUTH_ISSUER=` in `.env.example`, count as unset, so `cp .env.example .env && pnpm dev` starts. An empty `MCP_AUTH_SCOPES` now means the default, `mcp`.

## [0.2.2] - 2026-11-08

### Fixed

- Projects created with `pik new` are formatted after renaming, so a longer name can't fail `pnpm verify`.

## [0.2.1] - 2026-11-08

### Fixed

- Projects created with `pik new` and an owner get README clone and `cd` commands with their own name.
- The SBOM job and the MCP Registry publisher download retry after a GitHub download error.

## [0.2.0] - 2026-11-08

### Added

- `list_notes` and `create_note`, which call a REST API with timeouts, response validation, and readable errors. They appear when `UPSTREAM_API_URL` is set.
- `docs/upstream.md`, on adapting the pattern to other APIs, GraphQL, and databases.
- An end-to-end test against a real api-hono-starter.

## [0.1.0] - 2026-11-08

### Added

- MCP server on the official SDK v2, serving both the 2026-07-28 protocol and older clients.
- stdio for local clients, and Streamable HTTP with OAuth, static tokens, and DNS rebinding protection.
- Sample tools with schemas and annotations, plus `docs://` resources.
- Tests through real MCP clients over HTTP and stdio, plus end-to-end tests of the npm package and Docker image.
- Release workflow for GHCR, npm, and the MCP Registry, with `server.json`.
- `pik.yaml`, so `pik new mcp-server-ts-starter` can create projects from this starter.
