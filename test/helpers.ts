import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach } from 'vitest';
import { type HttpConfig, loadHttpConfig } from '../src/config.ts';
import type { createHttpApp } from '../src/http/app.ts';
import { createLogger } from '../src/logger.ts';

export const devToken = 'dev-token-0123456789abcdef';
export const fixedNow = () => new Date('2026-11-08T09:30:00.000Z');

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

export function config(env: Record<string, string> = {}): HttpConfig {
  return loadHttpConfig({
    MCP_AUTH_MODE: 'token',
    MCP_AUTH_TOKENS: devToken,
    LOG_LEVEL: 'silent',
    ...env,
  });
}

export type HttpApp = ReturnType<typeof createHttpApp>;

export function silentLogger() {
  return createLogger('silent');
}

interface ConnectOptions {
  token?: string;
  era?: 'legacy' | 'auto';
}

export async function connect(
  http: HttpApp,
  url: URL,
  { token, era = 'auto' }: ConnectOptions = {},
) {
  const transport = new StreamableHTTPClientTransport(url, {
    fetch: async (input, init) => {
      const request = new Request(input, init);
      request.headers.set('Host', new URL(request.url).host);
      return http.app.request(request);
    },
    ...(token ? { authProvider: { token: async () => token } } : {}),
  });
  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    era === 'auto' ? { versionNegotiation: { mode: 'auto' } } : {},
  );
  await client.connect(transport);
  cleanups.push(() => client.close());
  return client;
}

export function track(http: HttpApp): HttpApp {
  cleanups.push(() => http.close());
  return http;
}
