# Changelog

All notable changes to this repo are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- A contract test over every registered tool, with the notes tools on: a title, a one-line description, input and output schemas, and all four annotation hints.
- Per-tool scopes. `create_note` requires `notes:write`, checked with `requireScope` from `src/auth/scopes.ts`, and OAuth metadata lists it in `scopes_supported`. With OAuth, a token without it gets a tool error. With static tokens, with `none`, and over stdio, the caller has every scope.

### Changed

- Every sample tool sets all four annotation hints explicitly.
- `list_notes` and `create_note` each live in their own file, `src/tools/list-notes.ts` and `src/tools/create-note.ts`, like every other tool.
- **Breaking:** `createServer` takes a `logger`. Every tool handler is wrapped in `catchToolErrors`, which logs an unexpected error with an error ID and shows the model only `The server failed unexpectedly. Report error ID <id> to its operator.` Before, the model saw the raw error message, and nothing was logged.

### Fixed

- After a timeout or dropped connection, `create_note` says the note may or may not exist and to check with `list_notes` before retrying, instead of telling the model to try again and risking a duplicate.
- Empty settings, such as `MCP_AUTH_ISSUER=` in `.env.example`, count as unset, so `cp .env.example .env && pnpm dev` starts. An empty `MCP_AUTH_SCOPES` now means the default, `mcp`.

## [0.2.2] - 2026-11-08

### Fixed

- After a timeout or dropped connection, `create_note` says the note may or may not exist and to check with `list_notes` before retrying, instead of telling the model to try again and risking a duplicate.
- Projects created with `pik new` are formatted after renaming, so a longer name can't fail `pnpm verify`.

## [0.2.1] - 2026-11-08

### Fixed

- After a timeout or dropped connection, `create_note` says the note may or may not exist and to check with `list_notes` before retrying, instead of telling the model to try again and risking a duplicate.
- Projects created with `pik new` and an owner get README clone and `cd` commands with their own name.
- The SBOM job and the MCP Registry publisher download retry after a GitHub download error.

## [0.2.0] - 2026-11-08

### Added

- A contract test over every registered tool, with the notes tools on: a title, a one-line description, input and output schemas, and all four annotation hints.
- `list_notes` and `create_note`, which call a REST API with timeouts, response validation, and readable errors. They appear when `UPSTREAM_API_URL` is set.
- `docs/upstream.md`, on adapting the pattern to other APIs, GraphQL, and databases.
- An end-to-end test against a real api-hono-starter.

## [0.1.0] - 2026-11-08

### Added

- A contract test over every registered tool, with the notes tools on: a title, a one-line description, input and output schemas, and all four annotation hints.
- MCP server on the official SDK v2, serving both the 2026-07-28 protocol and older clients.
- stdio for local clients, and Streamable HTTP with OAuth, static tokens, and DNS rebinding protection.
- Sample tools with schemas and annotations, plus `docs://` resources.
- Tests through real MCP clients over HTTP and stdio, plus end-to-end tests of the npm package and Docker image.
- Release workflow for GHCR, npm, and the MCP Registry, with `server.json`.
- `pik.yaml`, so `pik new mcp-server-ts-starter` can create projects from this starter.
