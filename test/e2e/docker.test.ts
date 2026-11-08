import { execFileSync } from 'node:child_process';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const port = process.env.E2E_PORT ?? '3110';
const token = 'e2e-token-0123456789abcdef';
const env = {
  ...process.env,
  PORT: port,
  MCP_AUTH_TOKENS: token,
  COMPOSE_PROJECT_NAME: 'mcp-server-ts-starter-e2e',
};
const url = new URL(`http://localhost:${port}/mcp`);

function compose(...args: string[]) {
  return execFileSync('docker', ['compose', ...args], {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

beforeAll(() => {
  compose('down', '--remove-orphans');
  compose('up', '--build', '--detach', '--wait', 'mcp');
});

afterAll(() => {
  compose('down', '--remove-orphans');
});

describe('the Docker image', () => {
  it('serves a client over HTTP with a token', async () => {
    const client = new Client(
      { name: 'docker-test', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(url, { authProvider: { token: async () => token } }),
    );
    try {
      const result = await client.callTool({ name: 'whoami', arguments: {} });
      expect(result.structuredContent).toEqual({
        transport: 'http',
        clientId: 'token-1',
        scopes: ['mcp'],
      });
    } finally {
      await client.close();
    }
  });

  it('rejects a request without a token', async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{}}',
    });
    expect(response.status).toBe(401);
  });

  it('is healthy and runs as a non-root user', () => {
    expect(JSON.parse(compose('ps', 'mcp', '--format', 'json')).Health).toBe('healthy');
    expect(compose('exec', '-T', 'mcp', 'id', '-u').trim()).not.toBe('0');
  });
});
