import { describe, expect, it } from 'vitest';
import { createTokenVerifier } from '../../src/auth/token.ts';
import { createHttpApp } from '../../src/http/app.ts';
import { config, connect, devToken, fixedNow, silentLogger, track } from '../helpers.ts';

function app() {
  const cfg = config();
  const http = track(
    createHttpApp({
      config: cfg,
      logger: silentLogger(),
      verifier: createTokenVerifier([devToken], ['mcp']),
      now: fixedNow,
    }),
  );
  return { http, url: cfg.publicUrl };
}

describe.each(['auto', 'legacy'] as const)('tools, for a %s client', (era) => {
  async function client() {
    const { http, url } = app();
    return connect(http, url, { token: devToken, era });
  }

  it('negotiates the expected protocol era', async () => {
    expect((await client()).getProtocolEra()).toBe(era === 'auto' ? 'modern' : 'legacy');
  });

  it('lists tools in a stable order with schemas and annotations', async () => {
    const { tools } = await (await client()).listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['get_time', 'search_docs', 'whoami']);
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });

  it('returns the time in a time zone', async () => {
    const result = await (await client()).callTool({
      name: 'get_time',
      arguments: { timezone: 'Asia/Jakarta' },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      iso: '2026-11-08T09:30:00.000Z',
      timezone: 'Asia/Jakarta',
      local: 'Sunday, November 8, 2026 at 4:30:00 PM GMT+7',
    });
  });

  it('defaults to UTC', async () => {
    const result = await (await client()).callTool({ name: 'get_time', arguments: {} });
    expect(result.structuredContent).toMatchObject({ timezone: 'UTC' });
  });

  it('reports an unknown time zone as a tool error the model can read', async () => {
    const result = await (await client()).callTool({
      name: 'get_time',
      arguments: { timezone: 'Mars/Olympus' },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'Unknown time zone "Mars/Olympus". Use an IANA name, such as Europe/Berlin.',
      },
    ]);
  });

  it('finds docs and links to them', async () => {
    const result = await (await client()).callTool({
      name: 'search_docs',
      arguments: { query: 'oauth token' },
    });
    const { results } = result.structuredContent as { results: { slug: string; uri: string }[] };
    expect(results[0]?.slug).toBe('authentication');
    expect(result.content).toContainEqual(
      expect.objectContaining({ type: 'resource_link', uri: 'docs://authentication' }),
    );
  });

  it('respects the result limit', async () => {
    const result = await (await client()).callTool({
      name: 'search_docs',
      arguments: { query: 'tools server', limit: 1 },
    });
    expect((result.structuredContent as { results: unknown[] }).results).toHaveLength(1);
  });

  it('says so when nothing matches', async () => {
    const result = await (await client()).callTool({
      name: 'search_docs',
      arguments: { query: 'kubernetes' },
    });
    expect(result.structuredContent).toEqual({ results: [] });
    expect(JSON.stringify(result.content)).toContain('No docs match');
  });

  it.each([
    ['an empty query', { query: '   ' }],
    ['a limit over 10', { query: 'x', limit: 11 }],
    ['a wrong type', { query: 42 }],
  ])('rejects %s', async (_label, args) => {
    const result = await (await client()).callTool({ name: 'search_docs', arguments: args });
    expect(result.isError).toBe(true);
  });

  it('reports the authenticated client', async () => {
    const result = await (await client()).callTool({ name: 'whoami', arguments: {} });
    expect(result.structuredContent).toEqual({
      transport: 'http',
      clientId: 'token-1',
      scopes: ['mcp'],
    });
  });

  it('lists and reads docs resources', async () => {
    const c = await client();
    const { resources } = await c.listResources();
    expect(resources.map((resource) => resource.uri)).toEqual([
      'docs://getting-started',
      'docs://authentication',
      'docs://adding-tools',
    ]);
    const read = await c.readResource({ uri: 'docs://adding-tools' });
    expect(read.contents[0]).toMatchObject({
      mimeType: 'text/markdown',
      text: expect.stringContaining('# Adding tools'),
    });
  });

  it('fails clearly for an unknown doc', async () => {
    await expect((await client()).readResource({ uri: 'docs://missing' })).rejects.toThrow(
      /No doc at docs:\/\/missing/,
    );
  });
});
