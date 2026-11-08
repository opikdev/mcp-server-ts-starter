# Changelog

All notable changes to this repo are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
