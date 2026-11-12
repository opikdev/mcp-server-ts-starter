import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveHttp } from '../../src/http/serve.ts';
import { type FakeIssuer, startFakeIssuer } from '../fake-issuer.ts';
import { createFakeNotesApi, upstreamToken } from '../fake-notes-api.ts';
import { freePort } from '../helpers.ts';

let issuer: FakeIssuer;
let api: ReturnType<typeof createFakeNotesApi>;
let apiServer: Server;
let running: Awaited<ReturnType<typeof serveHttp>>;
let publicUrl: string;

beforeAll(async () => {
  const port = await freePort();
  publicUrl = `http://localhost:${port}/mcp`;
  issuer = await startFakeIssuer(publicUrl, upstreamToken);
  api = createFakeNotesApi();
  apiServer = serve({ fetch: api.app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
  await once(apiServer, 'listening');
  running = await serveHttp({
    PORT: String(port),
    LOG_LEVEL: 'silent',
    SHUTDOWN_DRAIN_SECONDS: '0',
    MCP_AUTH_MODE: 'oauth',
    MCP_AUTH_ISSUER: issuer.issuer,
    MCP_PUBLIC_URL: publicUrl,
    UPSTREAM_API_URL: `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`,
    UPSTREAM_AUTH: 'exchange',
    UPSTREAM_AUDIENCE: 'notes-api',
    TOKEN_EXCHANGE_URL: `${issuer.issuer}/token`,
    TOKEN_EXCHANGE_CLIENT_ID: 'mcp-server',
    TOKEN_EXCHANGE_CLIENT_SECRET: 'exchange-secret',
  });
});

afterAll(async () => {
  await running?.close();
  await new Promise((resolve) => apiServer?.close(resolve));
  await issuer?.close();
});

describe('token exchange mode', () => {
  it('calls the upstream with the exchanged token, never the caller’s own', async () => {
    const callerToken = await issuer.sign({ scope: 'mcp notes:read' });
    const client = new Client(
      { name: 'exchange-test', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(publicUrl), {
        authProvider: { token: async () => callerToken },
      }),
    );
    try {
      const result = await client.callTool({ name: 'list_notes', arguments: { limit: 1 } });
      expect(result.isError).toBeFalsy();
    } finally {
      await client.close();
    }

    expect(issuer.exchanges.map((form) => Object.fromEntries(form))).toEqual([
      expect.objectContaining({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: callerToken,
        audience: 'notes-api',
      }),
    ]);
    const sent = api.requests.map((request) => request.headers.get('authorization'));
    expect(sent).toEqual([`Bearer ${upstreamToken}`]);
    expect(sent.join()).not.toContain(callerToken);
  });
});
