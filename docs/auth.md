# Configure HTTP auth

Over stdio, the client starts the server as a local process, so there's no token. Pass any secrets your tools need as environment variables in the client config.

Over HTTP, set `MCP_AUTH_MODE`. The server won't start without it.

| Mode | Use it for | Settings |
|---|---|---|
| `oauth` | Production. Follows the MCP authorization spec | `MCP_AUTH_ISSUER`, optionally `MCP_AUTH_JWKS_URL` |
| `token` | Internal services and local development | `MCP_AUTH_TOKENS`, a comma-separated list |
| `none` | Local experiments only. Refused unless `HOST` is a loopback address | None |

## Use OAuth

Point the server at your authorization server, such as Auth0, Okta, Keycloak, or Entra ID:

```sh
MCP_AUTH_MODE=oauth
MCP_AUTH_ISSUER=https://auth.example.com
MCP_PUBLIC_URL=https://mcp.example.com/mcp
```

Both URLs must use `https://`, except on `localhost` and loopback addresses for development. The server then:

1. Publishes protected resource metadata at `/.well-known/oauth-protected-resource/mcp`, with CORS, so clients can find your authorization server and the scopes it can grant.
2. Answers a request without a token with `401` and `WWW-Authenticate: Bearer scope="mcp", resource_metadata="<metadata URL>"`. A token it rejects gets `error="invalid_token"` too.
3. Accepts only signed JWT access tokens from your issuer, for `MCP_PUBLIC_URL` as the audience ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)), with every scope in `MCP_AUTH_SCOPES`, and an expiry.

It finds the signing keys through your issuer's metadata. Set `MCP_AUTH_JWKS_URL` if your issuer doesn't publish it. For provider notes, see [Deploy](deploy.md#match-the-token-audience).

## Try OAuth locally with Keycloak

`compose.auth.yaml` runs Keycloak with a demo realm: a public client `mcp-client` for MCP clients, a confidential client `mcp-server` for [token exchange](upstream.md#act-as-the-user), the user `demo` with password `demo-password-123`, and the `mcp`, `notes:read`, and `notes:write` scopes. Tokens carry `MCP_PUBLIC_URL` as their audience. It's for development only: its secrets are fixed, and it allows the password grant.

1. Start Keycloak, then the server:

   ```sh
   docker compose -f compose.auth.yaml up --wait keycloak
   MCP_AUTH_MODE=oauth MCP_AUTH_ISSUER=http://localhost:8080/realms/mcp pnpm dev
   ```

2. Get a token for the demo user:

   ```sh
   TOKEN=$(curl -s localhost:8080/realms/mcp/protocol/openid-connect/token \
     -d grant_type=password -d client_id=mcp-client \
     -d username=demo -d password=demo-password-123 \
     -d 'scope=openid mcp notes:read notes:write' | jq -r .access_token)
   ```

3. Connect a client with it, for example Claude Code:

   ```sh
   claude mcp add --transport http my-mcp http://localhost:3000/mcp --header "Authorization: Bearer $TOKEN"
   ```

   Tokens last 5 minutes. Clients that sign in themselves, such as the MCP Inspector, can use the client ID `mcp-client` instead.

Leave out `notes:write` in step 2 to see the scope challenge when you call `create_note`.

## Require scopes per tool

Every token needs the scopes in `MCP_AUTH_SCOPES` to connect at all. On top of that, some tools require their own scope. Each tool declares it in its `defineTool` call, and `scopes_supported` in the metadata lists the base scopes plus every enabled tool's scope:

| Tool | Scope |
|---|---|
| `list_notes` | `notes:read` |
| `create_note` | `notes:write` |
| Every other tool | Only `MCP_AUTH_SCOPES` |

With `oauth`, a call to a tool whose scope the token lacks gets `403` and `WWW-Authenticate: Bearer error="insufficient_scope", scope="<scope>", resource_metadata="<metadata URL>"`, and the tool doesn't run. Clients can then ask the user for the scope and retry. `whoami` reports the scopes the token really has. See [ADR 005](decisions/005-challenge-for-missing-scopes.md).

With `token` or `none`, and over stdio, the caller has every scope, and `whoami` lists them all. Only use those where every caller may do everything.

## Use static tokens

```sh
MCP_AUTH_MODE=token
MCP_AUTH_TOKENS=<A_LONG_RANDOM_TOKEN>
```

Generate a token with `openssl rand -hex 32`. Each one must be at least 16 characters. Clients send it as `Authorization: Bearer <token>`.

## Settings

An empty value, such as `MCP_AUTH_ISSUER=`, counts as unset.

| Variable | Type | Default | Description |
|---|---|---|---|
| `HOST` | string | `127.0.0.1` | Interface to bind. The Docker image uses `0.0.0.0` |
| `PORT` | number | `3000` | Port to listen on |
| `MCP_PUBLIC_URL` | URL | `http://localhost:<PORT>/mcp` | URL clients use, and the expected OAuth audience |
| `MCP_ALLOWED_HOSTS` | list | Localhost and the `MCP_PUBLIC_URL` host | `Host` headers to accept |
| `MCP_ALLOWED_ORIGINS` | list | The `MCP_PUBLIC_URL` origin | Browser origins to accept, such as `https://app.example.com`. A request with another `Origin` gets `403`. Requests without one, as non-browser clients send, are accepted |
| `MCP_AUTH_MODE` | string | Required | `oauth`, `token`, or `none` |
| `MCP_AUTH_ISSUER` | URL | None | OAuth issuer |
| `MCP_AUTH_JWKS_URL` | URL | Discovered | OAuth signing keys |
| `MCP_AUTH_TOKENS` | list | None | Static tokens |
| `MCP_AUTH_SCOPES` | string | `mcp` | Space-separated scopes every token needs |
| `SHUTDOWN_DRAIN_SECONDS` | number | `5` | After `SIGTERM`, how long `/readyz` fails before the server stops accepting connections |
| `SHUTDOWN_TIMEOUT_SECONDS` | number | `30` | Then, how long requests in flight may run before they're cut off |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | URL | None | Turns on OpenTelemetry traces and metrics over OTLP. See [Deploy](deploy.md#telemetry) |
| `LOG_LEVEL` | string | `info` | `debug`, `info`, `warn`, `error`, or `silent` |
