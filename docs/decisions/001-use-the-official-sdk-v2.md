# 001. Use the official MCP SDK v2

- **Status**: accepted
- **Context**: The 2026-07-28 spec made MCP stateless and removed the `initialize` handshake. FastMCP for TypeScript still builds on the v1 SDK, which implements the older protocol.
- **Decision**: Build on `@modelcontextprotocol/server` v2, with its Hono adapter for HTTP.
- **Consequences**:
  - The server speaks the current protocol, and still serves clients on the older handshake.
  - Stateless HTTP needs no session store, so instances scale horizontally.
  - There's less magic than FastMCP, so each tool states its schemas and annotations explicitly.
