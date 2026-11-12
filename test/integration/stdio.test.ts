import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { tools } from '../../src/tools/index.ts';
import { createFakeNotesApi, upstreamToken } from '../fake-notes-api.ts';

let client: Client | undefined;
let api: Server;
let apiUrl: string;

beforeAll(async () => {
  api = serve({ fetch: createFakeNotesApi().app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
  await once(api, 'listening');
  apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => api.close(resolve));
});

afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function connectStdio(era: 'auto' | 'legacy', env: Record<string, string> = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['src/cli.ts'],
    env: { PATH: process.env.PATH ?? '', LOG_LEVEL: 'info', ...env },
    stderr: 'pipe',
  });
  client = new Client(
    { name: 'stdio-test', version: '1.0.0' },
    era === 'auto' ? { versionNegotiation: { mode: 'auto' } } : {},
  );
  await client.connect(transport);
  return client;
}

const sampleCalls: Record<string, Record<string, unknown>> = {
  get_time: { timezone: 'UTC' },
  search_docs: { query: 'oauth' },
  whoami: {},
  list_notes: { limit: 1 },
  create_note: { title: 'Over stdio' },
};

describe.each(['auto', 'legacy'] as const)('stdio, for a %s client', (era) => {
  it('serves the tools that need no upstream from a real process', async () => {
    const c = await connectStdio(era);
    const listed = (await c.listTools()).tools;
    expect(listed.map((tool) => tool.name)).toEqual(
      tools.filter((tool) => !tool.upstream).map((tool) => tool.name),
    );
    const result = await c.callTool({ name: 'whoami', arguments: {} });
    expect(result.structuredContent).toEqual({
      transport: 'stdio',
      clientId: null,
      scopes: ['mcp'],
    });
  });

  it('calls every tool, including the notes tools, with an upstream', async () => {
    const c = await connectStdio(era, {
      UPSTREAM_API_URL: apiUrl,
      UPSTREAM_API_TOKEN: upstreamToken,
    });
    const listed = (await c.listTools()).tools.map((tool) => tool.name);
    expect(listed).toEqual(tools.map((tool) => tool.name));
    expect(Object.keys(sampleCalls).sort()).toEqual([...listed].sort());
    for (const [name, args] of Object.entries(sampleCalls)) {
      const result = await c.callTool({ name, arguments: args });
      expect(result.isError, name).toBeFalsy();
    }
    const whoami = await c.callTool({ name: 'whoami', arguments: {} });
    expect(whoami.structuredContent).toMatchObject({
      scopes: ['mcp', 'notes:read', 'notes:write'],
    });
  });
});

describe('stdio startup', () => {
  it('refuses token exchange, because no caller signs in over stdio', () => {
    const result = spawnSync(process.execPath, ['src/cli.ts'], {
      env: {
        PATH: process.env.PATH ?? '',
        MCP_AUTH_MODE: 'oauth',
        UPSTREAM_API_URL: 'https://api.example.com',
        UPSTREAM_AUTH: 'exchange',
        UPSTREAM_AUDIENCE: 'notes-api',
        TOKEN_EXCHANGE_URL: 'https://auth.example.com/token',
        TOKEN_EXCHANGE_CLIENT_ID: 'mcp-server',
        TOKEN_EXCHANGE_CLIENT_SECRET: 'secret',
      },
      encoding: 'utf8',
      input: '',
    });
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe(
      'UPSTREAM_AUTH=exchange works only over HTTP, where callers sign in.',
    );
  });
});
