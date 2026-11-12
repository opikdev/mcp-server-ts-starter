# 005. Challenge for missing scopes

- **Status**: accepted
- **Context**: Tools need their own scopes, such as `notes:read` and `notes:write`. A tool error for a missing scope tells the model, but not the client, which can't then ask the user for more access. Hand-kept scope lists also drift from the tools.
- **Decision**: Each tool declares its scope in its `defineTool` call. Over HTTP with OAuth, the SDK's `scopeChallenge` answers a call without the scope with `403` and `WWW-Authenticate: Bearer error="insufficient_scope", scope=…, resource_metadata=…`, as the MCP authorization spec describes. `scopes_supported` and the tool list come from the same registrations.
- **Consequences**:
  - Clients can step up: they read the challenge, reauthorize with the scope, and retry. The upstream is never called without it.
  - A token missing the base scope `mcp` gets the same `403` challenge on every request, before any tool runs.
  - Over stdio, with static tokens, and with `none`, the caller holds every scope, so there's no challenge.
  - Adding `notes:read` for `list_notes` is breaking: OAuth tokens need the new scope.
