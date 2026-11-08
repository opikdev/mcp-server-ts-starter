import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, describe, expect, it } from 'vitest';

let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function connectStdio(era: 'auto' | 'legacy') {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['src/cli.ts'],
    env: { PATH: process.env.PATH ?? '', LOG_LEVEL: 'info' },
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
  it('serves tools from a real process', async () => {
    const c = await connectStdio(era);
    const { tools } = await c.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['get_time', 'search_docs', 'whoami']);
    const result = await c.callTool({ name: 'whoami', arguments: {} });
    expect(result.structuredContent).toEqual({ transport: 'stdio', clientId: null, scopes: [] });
  });
});
