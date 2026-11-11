# Changelog

All notable changes to this repo are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- The README explains how to start a project with `pik new` or GitHub's **Use this template**. `pik new` removes that section from the project it creates.

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
