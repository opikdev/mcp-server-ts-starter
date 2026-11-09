import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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

describe.each(['auto', 'legacy'] as const)('stdio, for a %s client', (era) => {
  it('serves the sample tools from a real process', async () => {
    const c = await connectStdio(era);
    const { tools } = await c.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['get_time', 'search_docs', 'whoami']);
    const result = await c.callTool({ name: 'whoami', arguments: {} });
    expect(result.structuredContent).toEqual({ transport: 'stdio', clientId: null, scopes: [] });
  });

  it('calls every tool, including the notes tools, with an upstream', async () => {
    const c = await connectStdio(era, {
      UPSTREAM_API_URL: apiUrl,
      UPSTREAM_API_TOKEN: upstreamToken,
    });
    const calls = {
      get_time: { timezone: 'UTC' },
      search_docs: { query: 'oauth' },
      whoami: {},
      list_notes: { limit: 1 },
      create_note: { title: 'Over stdio' },
    };
    const { tools } = await c.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(Object.keys(calls));
    for (const [name, args] of Object.entries(calls)) {
      const result = await c.callTool({ name, arguments: args });
      expect(result.isError, name).toBeFalsy();
    }
  });
});
