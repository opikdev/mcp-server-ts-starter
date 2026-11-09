import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { serveHttp } from '../../src/http/serve.ts';
import { freePort } from '../helpers.ts';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function env(extra: Record<string, string> = {}) {
  return { MCP_AUTH_MODE: 'none', LOG_LEVEL: 'silent', PORT: String(await freePort()), ...extra };
}

async function connect(port: string, era: 'auto' | 'legacy' = 'auto') {
  const client = new Client(
    { name: 'serve-test', version: '1.0.0' },
    era === 'auto' ? { versionNegotiation: { mode: 'auto' } } : {},
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`)));
  cleanups.push(() => client.close().catch(() => undefined));
  return client;
}

async function hangingApi() {
  const server: Server = createServer(() => undefined).listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('HTTP server shutdown', () => {
  it('ends an open subscriptions/listen stream instead of waiting for it', async () => {
    const settings = await env();
    const running = await serveHttp(settings);
    const client = await connect(settings.PORT);
    const subscription = await client.listen({ toolsListChanged: true });
    await running.close();
    expect(await subscription.closed).not.toBe('local');
  });

  it('cuts off a request still running after the deadline', async () => {
    const settings = await env({
      UPSTREAM_API_URL: await hangingApi(),
      UPSTREAM_API_TOKEN: 'token',
      UPSTREAM_TIMEOUT_MS: '60000',
    });
    const running = await serveHttp(settings, 100);
    const client = await connect(settings.PORT, 'legacy');
    client.callTool({ name: 'list_notes', arguments: {} }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const started = Date.now();
    await running.close();
    expect(Date.now() - started).toBeLessThan(2000);
    await expect(fetch(`http://localhost:${settings.PORT}/healthz`)).rejects.toThrow();
  });

  it('exits cleanly on SIGTERM with a stream open', async () => {
    const settings = await env({ LOG_LEVEL: 'info' });
    const child = spawn(process.execPath, ['src/cli.ts', '--http'], {
      env: { PATH: process.env.PATH ?? '', ...settings },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    cleanups.push(async () => child.kill('SIGKILL'));
    let stderr = '';
    await new Promise<void>((resolve) => {
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
        if (stderr.includes('MCP server listening')) resolve();
      });
    });
    const client = await connect(settings.PORT);
    await client.listen({ toolsListChanged: true });
    child.kill('SIGTERM');
    const [code] = await once(child, 'exit');
    expect(code).toBe(0);
    expect(stderr).toContain('Shutting down');
  });
});
