# Connect a client

## Claude Code

```sh
claude mcp add mcp-server-ts-starter -- npx -y mcp-server-ts-starter
```

For a server you run over HTTP:

```sh
claude mcp add --transport http mcp-server-ts-starter http://localhost:3000/mcp \
  --header "Authorization: Bearer <YOUR_TOKEN>"
```

## Claude Desktop, Cursor, and VS Code

Add this to the client's MCP config file:

```json
{
  "mcpServers": {
    "mcp-server-ts-starter": {
      "command": "npx",
      "args": ["-y", "mcp-server-ts-starter"]
    }
  }
}
```

While developing, replace the command with `node` and the args with the absolute path to `src/cli.ts`.

## MCP Inspector

Run `pnpm inspect` to open the Inspector against your working copy. List the tools, call them, and read the `docs://` resources.
