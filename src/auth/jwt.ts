import type { AuthInfo, OAuthMetadata, OAuthTokenVerifier } from '@modelcontextprotocol/server';
import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import { createRemoteJWKSet, errors, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from 'jose';

const algorithms = ['RS256', 'PS256', 'ES256', 'EdDSA'];
const discoveryTimeoutMs = 5000;

interface JwtVerifierOptions {
  issuer: string;
  audience: string;
  keys: JWTVerifyGetKey;
}

function scopesOf(payload: JWTPayload): string[] {
  if (typeof payload.scope === 'string') return payload.scope.split(' ').filter(Boolean);
  if (Array.isArray(payload.scp)) return payload.scp.filter((scope) => typeof scope === 'string');
  return [];
}

function clientOf(payload: JWTPayload): string {
  for (const claim of ['client_id', 'azp', 'sub']) {
    const value = payload[claim];
    if (typeof value === 'string' && value) return value;
  }
  return 'unknown';
}

export function createJwtVerifier({
  issuer,
  audience,
  keys,
}: JwtVerifierOptions): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token): Promise<AuthInfo> {
      try {
        const { payload } = await jwtVerify(token, keys, { issuer, audience, algorithms });
        return {
          token,
          clientId: clientOf(payload),
          scopes: scopesOf(payload),
          ...(payload.exp === undefined ? {} : { expiresAt: payload.exp }),
          extra: { subject: payload.sub },
        };
      } catch (error) {
        if (error instanceof errors.JOSEError) {
          throw new OAuthError(
            OAuthErrorCode.InvalidToken,
            `The token is not valid: ${error.code}`,
          );
        }
        throw error;
      }
    },
  };
}

function metadataUrls(issuer: string): string[] {
  const url = new URL(issuer);
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  return [
    `${url.origin}/.well-known/oauth-authorization-server${path}`,
    `${url.origin}${path}/.well-known/openid-configuration`,
  ];
}

/** Fetches the issuer's authorization server metadata (RFC 8414, or OpenID discovery). */
export async function discoverAuthorizationServer(
  issuer: string,
  fetcher: typeof fetch = fetch,
): Promise<OAuthMetadata> {
  for (const address of metadataUrls(issuer)) {
    const response = await fetcher(address, { signal: AbortSignal.timeout(discoveryTimeoutMs) });
    if (!response.ok) continue;
    const metadata = (await response.json()) as OAuthMetadata;
    if (metadata.issuer !== issuer) {
      throw new Error(
        `Authorization server metadata at ${address} names issuer ${metadata.issuer}, not ${issuer}`,
      );
    }
    return metadata;
  }
  throw new Error(`Couldn't find authorization server metadata for ${issuer}.`);
}

export function jwksUrlOf(metadata: OAuthMetadata, override: string | undefined): string {
  const jwksUrl = override ?? metadata.jwks_uri;
  if (typeof jwksUrl !== 'string')
    throw new Error(`${metadata.issuer} publishes no jwks_uri. Set MCP_AUTH_JWKS_URL.`);
  return jwksUrl;
}

export function remoteKeys(jwksUrl: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUrl));
}
