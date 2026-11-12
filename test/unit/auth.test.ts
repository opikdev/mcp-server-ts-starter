import { OAuthError } from '@modelcontextprotocol/server';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createJwtVerifier, discoverAuthorizationServer, jwksUrlOf } from '../../src/auth/jwt.ts';
import { createTokenVerifier } from '../../src/auth/token.ts';

const issuer = 'https://auth.example.com';
const audience = 'https://mcp.example.com/mcp';

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let verifier: ReturnType<typeof createJwtVerifier>;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'key-1', alg: 'RS256' };
  verifier = createJwtVerifier({ issuer, audience, keys: createLocalJWKSet({ keys: [jwk] }) });
});

function sign(
  claims: Record<string, unknown> = {},
  options: { key?: CryptoKey; expires?: string } = {},
) {
  return new SignJWT({ scope: 'mcp other', client_id: 'cli-1', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
    .setIssuer(String(claims.iss ?? issuer))
    .setAudience(String(claims.aud ?? audience))
    .setSubject('user-1')
    .setIssuedAt()
    .setExpirationTime(options.expires ?? '5m')
    .sign(options.key ?? privateKey);
}

describe('JWT verifier', () => {
  it('accepts a valid token and reads its claims', async () => {
    const auth = await verifier.verifyAccessToken(await sign());
    expect(auth).toMatchObject({
      clientId: 'cli-1',
      scopes: ['mcp', 'other'],
      extra: { subject: 'user-1' },
    });
    expect(auth.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it('reads scopes from an scp array', async () => {
    const auth = await verifier.verifyAccessToken(await sign({ scope: undefined, scp: ['mcp'] }));
    expect(auth.scopes).toEqual(['mcp']);
  });

  it('falls back to azp, then sub, for the client', async () => {
    expect(
      (await verifier.verifyAccessToken(await sign({ client_id: undefined, azp: 'app-2' })))
        .clientId,
    ).toBe('app-2');
    expect((await verifier.verifyAccessToken(await sign({ client_id: undefined }))).clientId).toBe(
      'user-1',
    );
  });

  it.each([
    ['another issuer', () => sign({ iss: 'https://evil.example.com' })],
    ['another audience', () => sign({ aud: 'https://other.example.com/mcp' })],
    ['an expired token', () => sign({}, { expires: '-1m' })],
    ['a wrong signature', () => sign({}, { key: otherKey })],
    [
      'an unsigned token',
      async () =>
        `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ iss: issuer, aud: audience })).toString('base64url')}.`,
    ],
    ['garbage', async () => 'not-a-jwt'],
  ])('rejects %s', async (_label, make) => {
    await expect(verifier.verifyAccessToken(await make())).rejects.toBeInstanceOf(OAuthError);
  });
});

describe('JWT algorithm allowlist', () => {
  it('rejects a signature algorithm outside the allowlist, even with a valid key', async () => {
    const pair = await generateKeyPair('RS512');
    const looseKey = { ...(await exportJWK(pair.publicKey)), kid: 'loose' };
    const loose = createJwtVerifier({
      issuer,
      audience,
      keys: createLocalJWKSet({ keys: [looseKey] }),
    });
    const token = await new SignJWT({ scope: 'mcp' })
      .setProtectedHeader({ alg: 'RS512', kid: 'loose' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime('5m')
      .sign(pair.privateKey);
    await expect(loose.verifyAccessToken(token)).rejects.toThrow('ERR_JOSE_ALG_NOT_ALLOWED');
  });
});

describe('authorization server discovery', () => {
  const respond = (routes: Record<string, unknown>) =>
    (async (input: string | URL | Request) => {
      const body = routes[String(input)];
      return body === undefined ? new Response('not found', { status: 404 }) : Response.json(body);
    }) as typeof fetch;

  it('reads OAuth metadata, and its jwks_uri', async () => {
    const fetcher = respond({
      'https://auth.example.com/.well-known/oauth-authorization-server': {
        issuer,
        jwks_uri: 'https://auth.example.com/keys',
      },
    });
    const metadata = await discoverAuthorizationServer(issuer, fetcher);
    expect(jwksUrlOf(metadata, undefined)).toBe('https://auth.example.com/keys');
  });

  it('falls back to OpenID metadata, keeping the issuer path', async () => {
    const tenant = 'https://auth.example.com/realms/acme';
    const fetcher = respond({
      'https://auth.example.com/realms/acme/.well-known/openid-configuration': {
        issuer: tenant,
        jwks_uri: 'https://auth.example.com/certs',
      },
    });
    const metadata = await discoverAuthorizationServer(tenant, fetcher);
    expect(jwksUrlOf(metadata, undefined)).toBe('https://auth.example.com/certs');
  });

  it('prefers MCP_AUTH_JWKS_URL over the published jwks_uri', () => {
    expect(jwksUrlOf({ issuer, jwks_uri: 'https://a/keys' } as never, 'https://b/keys')).toBe(
      'https://b/keys',
    );
  });

  it('rejects metadata for another issuer', async () => {
    const fetcher = respond({
      'https://auth.example.com/.well-known/oauth-authorization-server': {
        issuer: 'https://evil.example.com',
        jwks_uri: 'x',
      },
    });
    await expect(discoverAuthorizationServer(issuer, fetcher)).rejects.toThrow('names issuer');
  });

  it('fails when the issuer publishes no metadata', async () => {
    await expect(discoverAuthorizationServer(issuer, respond({}))).rejects.toThrow(
      `Couldn't find authorization server metadata for ${issuer}`,
    );
  });

  it('explains how to fix missing signing keys', () => {
    expect(() => jwksUrlOf({ issuer } as never, undefined)).toThrow('MCP_AUTH_JWKS_URL');
  });
});

describe('token verifier', () => {
  const tokens = createTokenVerifier(
    ['first-token-0123456789', 'second-token-0123456789'],
    ['mcp'],
  );

  it('accepts each configured token, with the scopes it is given', async () => {
    expect(await tokens.verifyAccessToken('second-token-0123456789')).toMatchObject({
      clientId: 'token-2',
      scopes: ['mcp'],
    });
  });

  it.each(['wrong-token-0123456789', '', 'first-token-012345678'])('rejects %j', async (token) => {
    await expect(tokens.verifyAccessToken(token)).rejects.toBeInstanceOf(OAuthError);
  });
});
