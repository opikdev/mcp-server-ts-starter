# MCP server TS starter

A production-ready Model Context Protocol server in TypeScript, ready to customize with coding agents. It runs over stdio for local clients and Streamable HTTP for remote ones, with OAuth, tests through real MCP clients, and a release pipeline.

[![CI](https://github.com/opikdev/mcp-server-ts-starter/actions/workflows/ci.yml/badge.svg)](https://github.com/opikdev/mcp-server-ts-starter/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Features

- **Current protocol:** built on the official MCP SDK v2, for the 2026-07-28 spec, while still serving older clients.
- **Two transports:** stdio for Claude Code, Claude Desktop, and Cursor, plus stateless Streamable HTTP that scales horizontally.
- **Secure HTTP:** OAuth per the MCP authorization spec, with per-tool scope challenges, or static tokens. It won't start without an auth mode, and it checks `Host` and `Origin` headers.
- **Sample tools:** `get_time`, `search_docs`, and `whoami`, with input and output schemas, annotations, and readable errors, plus `docs://` resources.
- **Backend integration:** `list_notes` and `create_note` call a REST API with timeouts, validated responses, and errors the model can act on, as a service account or as each user through token exchange. See [Connect a backend API](docs/upstream.md).
- **Production-ready:** graceful drain on shutdown, readiness checks, and OpenTelemetry traces and metrics. See [Deploy](docs/deploy.md).
- **Real tests:** every tool is called through a real MCP client over HTTP and stdio, on both protocol eras.
- **Publishing:** releases to npm, the MCP Registry, and GHCR, with a scanned, attested image and a test that keeps `server.json` and `package.json` in step.
- **Agent-ready:** `AGENTS.md`, skills, and checks that run on every commit.

## Quick start

You need Node 26 or later and pnpm:

```sh
git clone https://github.com/opikdev/mcp-server-ts-starter
cd mcp-server-ts-starter
pnpm install
pnpm inspect
```

The MCP Inspector opens in your browser. Connect, list the tools, and call `get_time`. To try the notes tools too, see [Connect a backend API](docs/upstream.md#turn-the-notes-tools-on).

To run it over HTTP in Docker instead:

```sh
docker compose up --build --wait mcp
```

The server is now at `http://localhost:3000/mcp`, with the dev token `dev-token-change-me-0123`.

## Start your own project

Create a renamed copy with [pik](https://github.com/opikdev/pik). It downloads this starter's latest release, then sets your project name and GitHub owner:

```sh
pik new mcp-server-ts-starter my-mcp-server
```

Or select **Use this template** on GitHub. That copy keeps the name `mcp-server-ts-starter` and the owner `opikdev`, so follow `pik.yaml` by hand: swap the `replace` text, delete the `exclude` paths, and run the `setup` commands.

## Usage

| Task | Command |
|---|---|
| Try the tools in the MCP Inspector | `pnpm inspect` |
| Serve over HTTP on your machine | `cp .env.example .env`, then `pnpm dev` |
| Run lint, types, tests, and repo checks | `pnpm verify` |
| Test the built package and Docker image | `pnpm test:e2e` |
| Build the npm package | `pnpm build` |

To use the server from Claude Code, Claude Desktop, Cursor, or VS Code, see [Connect a client](docs/clients.md). Before you serve over HTTP outside your machine, read [Configure HTTP auth](docs/auth.md) and [Deploy](docs/deploy.md). To ship a release, see [Publish a release](docs/publishing.md).

To add a tool:

1. Create a file in `src/tools/` with `defineTool`, like `src/tools/time.ts`. Give it a `scope` if it reads or changes data that needs one.
2. Add it to the list in `src/tools/index.ts`.
3. Test it through a real client in `test/integration/`, like `tools.test.ts`.
4. Add a call to it in `test/integration/stdio.test.ts`.

## Project structure

| Path | Purpose |
|---|---|
| `src/tools/` | One file per tool, and the tool list in `index.ts` |
| `src/resources/` | Resources and their data |
| `src/upstream/` | Clients for backend APIs the tools call, and the credential they send |
| `src/http/` | The HTTP app, auth gate, and server startup |
| `src/auth/` | OAuth and static token verifiers |
| `test/` | Unit, integration, and end-to-end tests |
| `keycloak/` | The demo realm for `compose.auth.yaml` |
| `docs/` | [Architecture](docs/architecture.md), guides, and [decisions](docs/decisions/) |

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and follow the [code of conduct](CODE_OF_CONDUCT.md).

## Security

Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

## License

Released under the [MIT License](LICENSE).
