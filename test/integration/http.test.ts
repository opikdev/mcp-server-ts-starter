import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJwtVerifier, discoverJwksUrl, remoteKeys } from '../../src/auth/jwt.ts';
import { createTokenVerifier } from '../../src/auth/token.ts';
import { createHttpApp } from '../../src/http/app.ts';
import { config, connect, devToken, silentLogger, track } from '../helpers.ts';

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

describe('token auth', () => {
  const app = () =>
    track(
      createHttpApp({
        config: config(),
        logger: silentLogger(),
        verifier: createTokenVerifier([devToken], ['mcp']),
      }),
    );

  it('rejects a request without a token, with a bearer challenge', async () => {
    const response = await post(app());
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toMatch(/^Bearer/);
  });

  it('rejects a wrong token', async () => {
    expect((await post(app(), { Authorization: 'Bearer wrong-token-0123456789' })).status).toBe(
      401,
    );
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

  it('serves health without a token', async () => {
    const response = await app().app.request('http://localhost:3000/healthz', {
      headers: { Host: 'localhost:3000' },
    });
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('blocks a DNS rebinding attempt', async () => {
    const response = await post(app(), { Authorization: `Bearer ${devToken}` }, 'evil.example.com');
    expect(response.status).toBe(403);
  });

  it('has no protected resource metadata, because it is not OAuth', async () => {
    const response = await app().app.request(
      'http://localhost:3000/.well-known/oauth-protected-resource/mcp',
      {
        headers: { Host: 'localhost:3000' },
      },
    );
    expect(response.status).toBe(404);
  });
});

describe('no auth on localhost', () => {
  it('serves tools to any local client', async () => {
    const cfg = config({ MCP_AUTH_MODE: 'none' });
    const http = track(createHttpApp({ config: cfg, logger: silentLogger(), verifier: null }));
    const client = await connect(http, cfg.publicUrl);
    const result = await client.callTool({ name: 'whoami', arguments: {} });
    expect(result.structuredContent).toEqual({ transport: 'http', clientId: null, scopes: [] });
  });
});

describe('OAuth', () => {
  const publicUrl = 'http://localhost:3000/mcp';
  let issuer: string;
  let authServer: Server;
  let privateKey: CryptoKey;
  let http: ReturnType<typeof createHttpApp>;

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256');
    privateKey = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256' };
    authServer = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/.well-known/oauth-authorization-server') {
        response.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
      } else if (request.url === '/jwks') {
        response.end(JSON.stringify({ keys: [jwk] }));
      } else {
        response.statusCode = 404;
        response.end('{}');
      }
    });
    await new Promise<void>((resolve) => authServer.listen(0, '127.0.0.1', resolve));
    issuer = `http://127.0.0.1:${(authServer.address() as AddressInfo).port}`;

    const cfg = config({
      MCP_AUTH_MODE: 'oauth',
      MCP_AUTH_ISSUER: issuer,
      MCP_PUBLIC_URL: publicUrl,
    });
    const keys = remoteKeys(await discoverJwksUrl(issuer));
    http = createHttpApp({
      config: cfg,
      logger: silentLogger(),
      verifier: createJwtVerifier({ issuer, audience: publicUrl, keys }),
    });
  });

  afterAll(async () => {
    await http.close();
    await new Promise((resolve) => authServer.close(resolve));
  });

  const sign = (claims: Record<string, unknown> = {}) =>
    new SignJWT({ scope: 'mcp', client_id: 'agent-7', ...claims })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuer(issuer)
      .setAudience(String(claims.aud ?? publicUrl))
      .setExpirationTime('5m')
      .sign(privateKey);

  it('publishes protected resource metadata', async () => {
    const response = await http.app.request(
      'http://localhost:3000/.well-known/oauth-protected-resource/mcp',
      {
        headers: { Host: 'localhost:3000' },
      },
    );
    expect(await response.json()).toEqual({
      resource: publicUrl,
      authorization_servers: [issuer],
      scopes_supported: ['mcp'],
      bearer_methods_supported: ['header'],
    });
  });

  it('points clients at the metadata in the 401 challenge', async () => {
    const response = await post(http);
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain(
      'resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it('serves a client with a valid access token', async () => {
    const client = await connect(http, new URL(publicUrl), { token: await sign() });
    const result = await client.callTool({ name: 'whoami', arguments: {} });
    expect(result.structuredContent).toEqual({
      transport: 'http',
      clientId: 'agent-7',
      scopes: ['mcp'],
    });
  });

  it('rejects a token issued for another resource', async () => {
    const response = await post(http, {
      Authorization: `Bearer ${await sign({ aud: 'http://other.example/mcp' })}`,
    });
    expect(response.status).toBe(401);
  });

  it('rejects a token without the mcp scope', async () => {
    const response = await post(http, {
      Authorization: `Bearer ${await sign({ scope: 'email' })}`,
    });
    expect(response.status).toBe(403);
  });
});
