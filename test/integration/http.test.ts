import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createJwtVerifier,
  discoverAuthorizationServer,
  jwksUrlOf,
  remoteKeys,
} from '../../src/auth/jwt.ts';
import { createTokenVerifier } from '../../src/auth/token.ts';
import { createHttpApp } from '../../src/http/app.ts';
import { type FakeIssuer, startFakeIssuer } from '../fake-issuer.ts';
import {
  capturingLogger,
  config,
  connect,
  devToken,
  fakeNotes,
  silentLogger,
  track,
} from '../helpers.ts';

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'curl', version: '1' },
  },
};

function post(
  http: ReturnType<typeof createHttpApp>,
  headers: Record<string, string> = {},
  host = 'localhost:3000',
) {
  return http.app.request('http://localhost:3000/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Host: host,
      ...headers,
    },
    body: JSON.stringify(initialize),
  });
}

function get(http: ReturnType<typeof createHttpApp>, path: string, init: RequestInit = {}) {
  return http.app.request(`http://localhost:3000${path}`, {
    ...init,
    headers: { Host: 'localhost:3000', ...init.headers },
  });
}

describe('token auth', () => {
  const app = (env: Record<string, string> = {}) =>
    track(
      createHttpApp({
        config: config(env),
        logger: silentLogger(),
        verifier: createTokenVerifier([devToken], ['mcp']),
      }),
    );

  it('challenges a request without a token, without an error code', async () => {
    const response = await post(app());
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer scope="mcp"');
  });

  it('rejects a wrong token as invalid_token', async () => {
    const response = await post(app(), { Authorization: 'Bearer wrong-token-0123456789' });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toMatch(/^Bearer error="invalid_token"/);
  });

  it('accepts the configured token', async () => {
    expect((await post(app(), { Authorization: `Bearer ${devToken}` })).status).toBe(200);
  });

  it('refuses a token without the required scope', async () => {
    const strict = track(
      createHttpApp({
        config: config({ MCP_AUTH_SCOPES: 'mcp admin' }),
        logger: silentLogger(),
        verifier: createTokenVerifier([devToken], ['mcp']),
      }),
    );
    expect((await post(strict, { Authorization: `Bearer ${devToken}` })).status).toBe(403);
  });

  it('serves health without a token, even for an unlisted Host', async () => {
    const response = await get(app(), '/healthz', { headers: { Host: '10.0.0.7:3000' } });
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('is not ready until the server says so, and not while draining', async () => {
    const http = app();
    expect((await get(http, '/readyz')).status).toBe(503);
    http.readiness.ready = true;
    expect(await (await get(http, '/readyz')).json()).toEqual({ status: 'ready' });
    http.readiness.draining = true;
    const draining = await get(http, '/readyz');
    expect(draining.status).toBe(503);
    expect(await draining.json()).toEqual({ status: 'draining' });
  });

  it('blocks a DNS rebinding attempt', async () => {
    const response = await post(app(), { Authorization: `Bearer ${devToken}` }, 'evil.example.com');
    expect(response.status).toBe(403);
  });

  it('has no protected resource metadata, because it is not OAuth', async () => {
    const response = await get(app(), '/.well-known/oauth-protected-resource/mcp');
    expect(response.status).toBe(404);
  });
});

describe('Origin validation', () => {
  const app = (env: Record<string, string>) =>
    track(
      createHttpApp({
        config: config(env),
        logger: silentLogger(),
        verifier: createTokenVerifier([devToken], ['mcp']),
      }),
    );
  const auth = { Authorization: `Bearer ${devToken}` };

  it.each([
    ['a loopback bind', {}],
    ['a public bind, as in Docker', { HOST: '0.0.0.0' }],
  ])('rejects a foreign Origin with a valid token on %s', async (_label, env) => {
    const response = await post(app(env), { ...auth, Origin: 'https://evil.example.com' });
    expect(response.status).toBe(403);
  });

  it('accepts the MCP_PUBLIC_URL origin by default', async () => {
    const response = await post(app({ HOST: '0.0.0.0' }), {
      ...auth,
      Origin: 'http://localhost:3000',
    });
    expect(response.status).toBe(200);
  });

  it('accepts a request without an Origin, as non-browser clients send', async () => {
    expect((await post(app({ HOST: '0.0.0.0' }), auth)).status).toBe(200);
  });

  it('accepts only the exact origins in MCP_ALLOWED_ORIGINS', async () => {
    const http = app({ HOST: '0.0.0.0', MCP_ALLOWED_ORIGINS: 'https://app.example.com' });
    expect((await post(http, { ...auth, Origin: 'https://app.example.com' })).status).toBe(200);
    expect((await post(http, { ...auth, Origin: 'http://app.example.com' })).status).toBe(403);
    expect((await post(http, { ...auth, Origin: 'https://app.example.com:8443' })).status).toBe(
      403,
    );
    expect((await post(http, { ...auth, Origin: 'http://localhost:3000' })).status).toBe(403);
  });
});

describe('request IDs and access logs', () => {
  function setup() {
    const { logger, logs } = capturingLogger();
    const http = track(
      createHttpApp({
        config: config(),
        logger,
        verifier: createTokenVerifier([devToken], ['mcp']),
      }),
    );
    const entries = () =>
      logs()
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .filter((entry) => entry.msg === 'HTTP request');
    return { http, logs, entries };
  }

  it.each([
    ['an accepted request', { Authorization: `Bearer ${devToken}` }, 'localhost:3000', 200],
    ['a request without a token', {}, 'localhost:3000', 401],
    ['a DNS rebinding attempt', { Authorization: `Bearer ${devToken}` }, 'evil.example.com', 403],
  ])('returns X-Request-Id on %s', async (_label, headers, host, status) => {
    const response = await post(setup().http, headers, host);
    expect(response.status).toBe(status);
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('logs each request with its ID and client, but never the token', async () => {
    const { http, logs, entries } = setup();
    const accepted = await post(http, { Authorization: `Bearer ${devToken}` });
    const rejected = await post(http);
    expect(entries()).toEqual([
      expect.objectContaining({
        requestId: accepted.headers.get('x-request-id'),
        method: 'POST',
        path: '/mcp',
        status: 200,
        durationMs: expect.any(Number),
        clientId: 'token-1',
      }),
      expect.objectContaining({
        requestId: rejected.headers.get('x-request-id'),
        status: 401,
      }),
    ]);
    expect(entries()[1]).not.toHaveProperty('clientId');
    expect(logs()).not.toContain(devToken);
  });
});

describe('no auth on localhost', () => {
  it('serves tools to any local client, with every scope', async () => {
    const cfg = config({ MCP_AUTH_MODE: 'none' });
    const http = track(createHttpApp({ config: cfg, logger: silentLogger(), verifier: null }));
    const client = await connect(http, cfg.publicUrl);
    const result = await client.callTool({ name: 'whoami', arguments: {} });
    expect(result.structuredContent).toEqual({
      transport: 'http',
      clientId: null,
      scopes: ['mcp'],
    });
  });
});

describe('OAuth', () => {
  const publicUrl = 'http://localhost:3000/mcp';
  const metadataUrl = 'http://localhost:3000/.well-known/oauth-protected-resource/mcp';
  let fake: FakeIssuer;
  let issuer: string;
  let http: ReturnType<typeof createHttpApp>;
  let notesApi: ReturnType<typeof fakeNotes>['api'];
  const sign = (claims: Record<string, unknown> = {}) => fake.sign(claims);

  beforeAll(async () => {
    fake = await startFakeIssuer(publicUrl);
    issuer = fake.issuer;
    const cfg = config({
      MCP_AUTH_MODE: 'oauth',
      MCP_AUTH_ISSUER: issuer,
      MCP_PUBLIC_URL: publicUrl,
    });
    const authorizationServer = await discoverAuthorizationServer(issuer);
    const keys = remoteKeys(jwksUrlOf(authorizationServer, undefined));
    const notes = fakeNotes();
    notesApi = notes.api;
    http = createHttpApp({
      config: cfg,
      logger: silentLogger(),
      verifier: createJwtVerifier({ issuer, audience: publicUrl, keys }),
      authorizationServer,
      notes: notes.notes,
    });
  });

  afterAll(async () => {
    await http.close();
    await fake.close();
  });

  it('publishes protected resource metadata, with every scope', async () => {
    const response = await get(http, '/.well-known/oauth-protected-resource/mcp');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toEqual({
      resource: publicUrl,
      authorization_servers: [issuer],
      scopes_supported: ['mcp', 'notes:read', 'notes:write'],
    });
  });

  it('answers a CORS preflight for the metadata, from any origin', async () => {
    const response = await get(http, '/.well-known/oauth-protected-resource/mcp', {
      method: 'OPTIONS',
      headers: { Origin: 'https://inspector.example.com' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('serves the authorization server metadata for older clients', async () => {
    const response = await get(http, '/.well-known/oauth-authorization-server');
    expect(await response.json()).toMatchObject({ issuer, token_endpoint: `${issuer}/token` });
  });

  it('challenges a request without a token with the metadata and base scope only', async () => {
    const response = await post(http);
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer scope="mcp", resource_metadata="${metadataUrl}"`,
    );
  });

  it('rejects a token issued for another resource as invalid_token', async () => {
    const response = await post(http, {
      Authorization: `Bearer ${await sign({ aud: 'http://other.example/mcp' })}`,
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"');
    expect(response.headers.get('www-authenticate')).toContain(
      `resource_metadata="${metadataUrl}"`,
    );
  });

  it('reports the scopes the token really has', async () => {
    const client = await connect(http, new URL(publicUrl), {
      token: await sign({ scope: 'mcp notes:read' }),
    });
    const result = await client.callTool({ name: 'whoami', arguments: {} });
    expect(result.structuredContent).toEqual({
      transport: 'http',
      clientId: 'agent-7',
      scopes: ['mcp', 'notes:read'],
    });
  });

  it.each([
    ['auto', 'create_note', { title: 'No' }, 'notes:write'],
    ['legacy', 'create_note', { title: 'No' }, 'notes:write'],
    ['auto', 'list_notes', {}, 'notes:read'],
    ['legacy', 'list_notes', {}, 'notes:read'],
  ] as const)(
    'answers a %s client calling %s without its scope with a 403 scope challenge',
    async (era, name, args, scope) => {
      const responses: Response[] = [];
      const client = await connect(http, new URL(publicUrl), {
        token: await sign(),
        era,
        responses,
      });
      const before = notesApi.requests.length;
      await expect(client.callTool({ name, arguments: args })).rejects.toThrow();
      const challenge = responses.find((response) => response.status === 403);
      expect(challenge?.headers.get('www-authenticate')).toBe(
        `Bearer error="insufficient_scope", error_description="Insufficient scope", scope="${scope}", resource_metadata="${metadataUrl}"`,
      );
      expect(notesApi.requests.length).toBe(before);
    },
  );

  it('allows a write tool to a token with its scope', async () => {
    const token = await sign({ scope: 'mcp notes:write' });
    const client = await connect(http, new URL(publicUrl), { token });
    const result = await client.callTool({ name: 'create_note', arguments: { title: 'Yes' } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ title: 'Yes' });
  });

  it('allows a read tool to a token with notes:read', async () => {
    const client = await connect(http, new URL(publicUrl), {
      token: await sign({ scope: 'mcp notes:read' }),
    });
    expect((await client.callTool({ name: 'list_notes', arguments: {} })).isError).toBeFalsy();
  });

  it('allows tools without their own scope with only the base scope', async () => {
    const client = await connect(http, new URL(publicUrl), { token: await sign() });
    expect((await client.callTool({ name: 'get_time', arguments: {} })).isError).toBeFalsy();
  });

  it('rejects a token without the mcp scope', async () => {
    const response = await post(http, {
      Authorization: `Bearer ${await sign({ scope: 'email' })}`,
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('www-authenticate')).toContain('error="insufficient_scope"');
  });
});
