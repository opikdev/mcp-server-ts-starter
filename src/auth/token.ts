import { createHash, timingSafeEqual } from 'node:crypto';
import type { AuthInfo, OAuthTokenVerifier } from '@modelcontextprotocol/server';
import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';

const digest = (value: string) => createHash('sha256').update(value).digest();

// The SDK requires an expiry on every token, and static tokens never expire, so report a short rolling one.
const rollingExpirySeconds = 300;

export function createTokenVerifier(tokens: string[], scopes: string[]): OAuthTokenVerifier {
  const expected = tokens.map(digest);
  return {
    async verifyAccessToken(token): Promise<AuthInfo> {
      const actual = digest(token);
      const index = expected.findIndex((candidate) => timingSafeEqual(candidate, actual));
      if (index === -1)
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'The token is not valid.');
      const expiresAt = Math.floor(Date.now() / 1000) + rollingExpirySeconds;
      return { token, clientId: `token-${index + 1}`, scopes, expiresAt };
    },
  };
}
