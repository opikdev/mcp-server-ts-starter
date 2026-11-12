import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

export interface FakeIssuer {
  issuer: string;
  sign: (claims?: Record<string, unknown>) => Promise<string>;
  exchanges: URLSearchParams[];
  close: () => Promise<void>;
}

/** A minimal authorization server: metadata, signing keys, and an RFC 8693 token endpoint. */
export async function startFakeIssuer(
  audience: string,
  exchangedToken = 'exchanged-token',
): Promise<FakeIssuer> {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' };
  const exchanges: URLSearchParams[] = [];
  let issuer = '';
  const server: Server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/.well-known/oauth-authorization-server') {
      response.end(
        JSON.stringify({
          issuer,
          jwks_uri: `${issuer}/jwks`,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          response_types_supported: ['code'],
        }),
      );
    } else if (request.url === '/jwks') {
      response.end(JSON.stringify({ keys: [jwk] }));
    } else if (request.url === '/token' && request.method === 'POST') {
      let body = '';
      request.on('data', (chunk) => {
        body += String(chunk);
      });
      request.on('end', () => {
        exchanges.push(new URLSearchParams(body));
        response.end(
          JSON.stringify({ access_token: exchangedToken, token_type: 'Bearer', expires_in: 300 }),
        );
      });
    } else {
      response.statusCode = 404;
      response.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    issuer,
    exchanges,
    sign: (claims = {}) =>
      new SignJWT({ scope: 'mcp', client_id: 'agent-7', ...claims })
        .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
        .setIssuer(issuer)
        .setAudience(String(claims.aud ?? audience))
        .setExpirationTime('5m')
        .sign(privateKey),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
