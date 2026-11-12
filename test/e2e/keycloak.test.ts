import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Hono } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveHttp } from '../../src/http/serve.ts';
import { freePort } from '../helpers.ts';

const keycloakPort = process.env.E2E_KEYCLOAK_PORT ?? '3180';
const issuer = `http://localhost:${keycloakPort}/realms/mcp`;
const tokenUrl = `${issuer}/protocol/openid-connect/token`;
let publicUrl: string;
let running: Awaited<ReturnType<typeof serveHttp>>;
let upstream: Server;
const received: { authorization: string | undefined; audience: unknown; azp: unknown }[] = [];

function compose(...args: string[]) {
  return execFileSync('docker', ['compose', '-f', 'compose.auth.yaml', ...args], {
    env: {
      ...process.env,
      KEYCLOAK_PORT: keycloakPort,
      MCP_PUBLIC_URL: publicUrl,
      COMPOSE_PROJECT_NAME: 'mcp-server-ts-starter-auth-e2e',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function fakeUpstream() {
  const keys = createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`));
  const app = new Hono();
  app.get('/v1/notes', async (c) => {
    const authorization = c.req.header('authorization');
    const token = authorization?.replace(/^Bearer /, '') ?? '';
    const { payload } = await jwtVerify(token, keys, { issuer, audience: 'notes-api' });
    received.push({ authorization, audience: payload.aud, azp: payload.azp });
    return c.json({ data: [], meta: { nextCursor: null } });
  });
  return app;
}

async function signIn(scope: string): Promise<string> {
  const response = await fetch(tokenUrl, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'mcp-client',
      username: 'demo',
      password: 'demo-password-123',
      scope,
    }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function connect(token: string, responses: Response[] = []) {
  const client = new Client(
    { name: 'keycloak-e2e', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(publicUrl), {
      authProvider: { token: async () => token },
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        responses.push(response.clone());
        return response;
      },
    }),
  );
  return client;
}

beforeAll(async () => {
  const port = await freePort();
  publicUrl = `http://localhost:${port}/mcp`;
  compose('down', '--remove-orphans');
  compose('up', '--detach', '--wait', 'keycloak');

  upstream = serve({ fetch: fakeUpstream().fetch, port: 0, hostname: '127.0.0.1' }) as Server;
  await once(upstream, 'listening');
  running = await serveHttp({
    PORT: String(port),
    LOG_LEVEL: 'silent',
    SHUTDOWN_DRAIN_SECONDS: '0',
    MCP_AUTH_MODE: 'oauth',
    MCP_AUTH_ISSUER: issuer,
    MCP_PUBLIC_URL: publicUrl,
    UPSTREAM_API_URL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
    UPSTREAM_AUTH: 'exchange',
    UPSTREAM_AUDIENCE: 'notes-api',
    TOKEN_EXCHANGE_URL: tokenUrl,
    TOKEN_EXCHANGE_CLIENT_ID: 'mcp-server',
    TOKEN_EXCHANGE_CLIENT_SECRET: 'mcp-server-dev-secret',
  });
});

afterAll(async () => {
  await running?.close();
  await new Promise((resolve) => upstream?.close(resolve));
  compose('down', '--remove-orphans');
});

describe('OAuth and token exchange with the Keycloak profile', () => {
  it('accepts a Keycloak token, and calls the upstream with an exchanged token only', async () => {
    const token = await signIn('openid mcp notes:read');
    const client = await connect(token);
    try {
      const whoami = await client.callTool({ name: 'whoami', arguments: {} });
      expect(whoami.structuredContent).toMatchObject({
        clientId: 'mcp-client',
        scopes: expect.arrayContaining(['mcp', 'notes:read']),
      });
      const listed = await client.callTool({ name: 'list_notes', arguments: {} });
      expect(listed.isError).toBeFalsy();
    } finally {
      await client.close();
    }
    expect(received).toEqual([
      { authorization: expect.any(String), audience: 'notes-api', azp: 'mcp-server' },
    ]);
    expect(received[0]?.authorization).not.toContain(token);
  });

  it('challenges a write without notes:write with the scope it needs', async () => {
    const responses: Response[] = [];
    const client = await connect(await signIn('openid mcp notes:read'), responses);
    try {
      await expect(
        client.callTool({ name: 'create_note', arguments: { title: 'Denied' } }),
      ).rejects.toThrow();
    } finally {
      await client.close();
    }
    const challenge = responses.find((response) => response.status === 403);
    expect(challenge?.headers.get('www-authenticate')).toBe(
      `Bearer error="insufficient_scope", error_description="Insufficient scope", scope="notes:write", resource_metadata="${new URL('/.well-known/oauth-protected-resource/mcp', publicUrl)}"`,
    );
  });
});
