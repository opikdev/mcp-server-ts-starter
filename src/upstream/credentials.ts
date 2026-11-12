import { createHash } from 'node:crypto';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { TokenExchangeConfig, UpstreamAuthConfig } from '../config.ts';
import type { Logger } from '../logger.ts';
import { UpstreamError } from './errors.ts';

export type UpstreamCredential = (caller: AuthInfo | undefined) => Promise<string>;

const exchangeResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().positive().optional(),
});

const oauthErrorSchema = z.object({ error: z.string().max(100) });

const expirySkewMs = 30_000;
const maxCachedTokens = 1000;

const exchangeFailed = () =>
  new UpstreamError(
    'Couldn’t get access to the notes API for this user, so nothing was changed. Ask the operator to check the token exchange settings.',
    'credential',
  );

interface ExchangeOptions extends TokenExchangeConfig {
  timeoutMs: number;
  logger: Logger;
  fetch?: typeof fetch;
}

function basicAuth(clientId: string, clientSecret: string): string {
  const pair = `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`;
  return `Basic ${Buffer.from(pair).toString('base64')}`;
}

async function oauthErrorCode(response: Response): Promise<string | undefined> {
  const parsed = oauthErrorSchema.safeParse(await response.json().catch(() => undefined));
  return parsed.success ? parsed.data.error : undefined;
}

/** Exchanges the caller's access token for one the upstream accepts (RFC 8693), and caches it. */
export function exchangeCredential({
  url,
  clientId,
  clientSecret,
  audience,
  timeoutMs,
  logger,
  fetch: fetcher = fetch,
}: ExchangeOptions): UpstreamCredential {
  const cache = new Map<string, { token: string; expiresAt: number }>();

  async function exchange(caller: AuthInfo): Promise<{ token: string; expiresAt: number }> {
    const audit = { event: 'token_exchange', clientId: caller.clientId, audience };
    let response: Response;
    try {
      response = await fetcher(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: basicAuth(clientId, clientSecret),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: caller.token,
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          audience,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      logger.warn(
        { ...audit, outcome: 'unreachable', reason: String(error) },
        'Token exchange failed',
      );
      throw exchangeFailed();
    }
    if (!response.ok) {
      const error = await oauthErrorCode(response);
      logger.warn(
        { ...audit, outcome: 'rejected', status: response.status, error },
        'Token exchange failed',
      );
      throw exchangeFailed();
    }
    const parsed = exchangeResponseSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      logger.warn({ ...audit, outcome: 'invalid_response' }, 'Token exchange failed');
      throw exchangeFailed();
    }
    logger.info({ ...audit, outcome: 'issued' }, 'Token exchanged');
    const lifetimeMs = (parsed.data.expires_in ?? 0) * 1000;
    return { token: parsed.data.access_token, expiresAt: Date.now() + lifetimeMs - expirySkewMs };
  }

  return async (caller) => {
    if (!caller) {
      throw new UpstreamError(
        'The notes API needs a signed-in user, and this call has none.',
        'credential',
      );
    }
    const key = createHash('sha256').update(caller.token).digest('base64url');
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    cache.delete(key);

    const issued = await exchange(caller);
    if (issued.expiresAt > Date.now()) {
      if (cache.size >= maxCachedTokens) cache.delete(cache.keys().next().value as string);
      cache.set(key, issued);
    }
    return issued.token;
  };
}

/** Decides which credential each upstream call sends. Tools never see it. */
export function createUpstreamCredential(
  auth: UpstreamAuthConfig,
  options: { timeoutMs: number; logger: Logger; fetch?: typeof fetch },
): UpstreamCredential {
  if (auth.mode === 'static') return async () => auth.token;
  return exchangeCredential({ ...auth.exchange, ...options });
}
