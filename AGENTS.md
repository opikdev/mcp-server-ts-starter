# Agent guide

A production-ready MCP server in TypeScript, built on the official MCP SDK v2. It serves stdio for local clients and Streamable HTTP with OAuth for remote ones. `get_time`, `search_docs`, `whoami`, the `docs://` resources, and the `list_notes` and `create_note` tools that call a backend API are samples to copy or replace.

| Path | Purpose |
|---|---|
| [docs/architecture.md](docs/architecture.md) | How requests flow, and where tools live |
| [docs/auth.md](docs/auth.md) | HTTP auth modes and settings |
| [docs/clients.md](docs/clients.md) | How to connect Claude Code, Claude Desktop, Cursor, and VS Code |
| [docs/upstream.md](docs/upstream.md) | The notes API contract, and how tools call a backend API |
| [docs/deploy.md](docs/deploy.md) | Running in production: proxy, audience, secrets, shutdown, and telemetry |
| [docs/publishing.md](docs/publishing.md) | Releasing to npm, the MCP Registry, and GHCR |
| [docs/decisions/](docs/decisions/) | Why it's built this way |
| `.agents/skills/` | Step-by-step guides for recurring tasks |
| `.mcp.json` | MCP servers for working on this project |

## Commands

| Task | Command |
|---|---|
| Try the tools in the MCP Inspector | `pnpm inspect` |
| Serve over HTTP on your machine | `cp .env.example .env`, then `pnpm dev` |
| Run all gates | `pnpm verify` |
| Test the built package and Docker image | `pnpm test:e2e` |

## Rules

- Don't commit until `pnpm verify` passes. For changes to packaging, Docker, or entry points, run `pnpm test:e2e` too. If they can't run, stop and report that instead of committing.
- If the check blocks you, fix the cause. Never edit `.agents/check.sh`, `.githooks/`, or the harness workflow to get past it, and never use `--no-verify`. If the request can't be done without that, stop and ask.
- After cloning, run `git config core.hooksPath .githooks` once to turn on the hook.
- Add each tool in its own file in `src/tools/` with `defineTool`, add it to the list in `src/tools/index.ts`, and test it through a real client in `test/integration/` on both protocol eras, like `tools.test.ts`. Add a call to it in `stdio.test.ts`.
- Give every tool a title, a one-line description, an input schema, an output schema, `structuredContent`, and all four annotation hints. A test in `test/integration/tools.test.ts` checks every registered tool. Report expected failures with `isError: true` and a message the model can act on.
- Every tool that reads or changes user data declares its scope in `defineTool`, which answers a call without it with a `403` scope challenge. List the scope in [docs/auth.md](docs/auth.md).
- Let `defineTool` handle errors. It turns an `UpstreamError` into a tool error, and logs anything else with an error ID that the model sees instead of the error.
- Call backends through a client in `src/upstream/` with a timeout and response schema. Turn failures into `UpstreamError` messages, pass upstream text through `untrusted()`, and never return credentials or raw upstream bodies to the model.
- Get upstream credentials only from `src/upstream/credentials.ts`. Never forward the caller's own token upstream.
- Never write to stdout outside the SDK, because stdio uses it for protocol messages. Log with the logger, which writes to stderr.
- Keep `server.json` in step with `package.json`. A test enforces this.
- Don't edit files listed in `.baseline.sha256`. They come from [opikdev/starters](https://github.com/opikdev/starters).
- Fix any doc your change makes wrong, in the same change.
- Record significant decisions with the `record-decision` skill.
