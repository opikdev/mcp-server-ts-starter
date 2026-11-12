import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { serve } from '@hono/node-server';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { serveHttp } from '../../src/http/serve.ts';
import { createFakeNotesApi, upstreamToken } from '../fake-notes-api.ts';
import { freePort } from '../helpers.ts';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function env(extra: Record<string, string> = {}) {
  return {
    MCP_AUTH_MODE: 'none',
    LOG_LEVEL: 'silent',
    PORT: String(await freePort()),
    SHUTDOWN_DRAIN_SECONDS: '0',
    ...extra,
  };
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

async function listen(server: Server) {
  await once(server, 'listening');
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function hangingApi() {
  return listen(createServer(() => undefined).listen(0, '127.0.0.1'));
}

async function slowApi(delayMs: number) {
  const api = createFakeNotesApi();
  let received: () => void = () => undefined;
  const arrived = new Promise<void>((resolve) => {
    received = resolve;
  });
  const server = serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (request) => {
      received();
      await sleep(delayMs);
      return api.app.fetch(request);
    },
  }) as Server;
  return { url: await listen(server), arrived, api };
}

describe('HTTP server shutdown', () => {
  it('ends an open subscriptions/listen stream instead of waiting for it', async () => {
    const settings = await env();
    const running = await serveHttp(settings);
    const client = await connect(settings.PORT);
    const subscription = await client.listen({ toolsListChanged: true });
    const started = Date.now();
    await running.close();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(await subscription.closed).not.toBe('local');
  });

  it.each(['auto', 'legacy'] as const)(
    'lets a slow tool call from a %s client finish, and the client gets its result',
    async (era) => {
      const upstream = await slowApi(500);
      const settings = await env({
        UPSTREAM_API_URL: upstream.url,
        UPSTREAM_API_TOKEN: upstreamToken,
      });
      const running = await serveHttp(settings);
      const client = await connect(settings.PORT, era);
      const call = client.callTool({ name: 'create_note', arguments: { title: 'In flight' } });
      await upstream.arrived;
      await running.close();
      const result = await call;
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ title: 'In flight' });
    },
  );

  it('fails readiness during the drain, while still serving', async () => {
    const settings = await env({ SHUTDOWN_DRAIN_SECONDS: '0.5' });
    const running = await serveHttp(settings);
    const base = `http://localhost:${settings.PORT}`;
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
    const closing = running.close();
    await sleep(100);
    expect((await fetch(`${base}/readyz`)).status).toBe(503);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    await closing;
    await expect(fetch(`${base}/healthz`)).rejects.toThrow();
  });

  it('cuts off a request still running after the deadline', async () => {
    const settings = await env({
      UPSTREAM_API_URL: await hangingApi(),
      UPSTREAM_API_TOKEN: 'token',
      UPSTREAM_TIMEOUT_MS: '60000',
      SHUTDOWN_TIMEOUT_SECONDS: '0.1',
    });
    const running = await serveHttp(settings);
    const client = await connect(settings.PORT, 'legacy');
    client.callTool({ name: 'list_notes', arguments: {} }).catch(() => undefined);
    await sleep(100);
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
