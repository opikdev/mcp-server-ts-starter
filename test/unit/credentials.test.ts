import type { AuthInfo } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { createUpstreamCredential } from '../../src/upstream/credentials.ts';
import { UpstreamError } from '../../src/upstream/errors.ts';
import { capturingLogger, silentLogger } from '../helpers.ts';

const exchange = {
  url: 'https://auth.example.com/token',
  clientId: 'mcp-server',
  clientSecret: 'exchange-secret-value',
  audience: 'notes-api',
};

const caller = (token: string): AuthInfo => ({ token, clientId: 'mcp-client', scopes: ['mcp'] });

function tokenEndpoint(reply: (form: URLSearchParams) => Response) {
  const calls: { form: URLSearchParams; authorization: string | null }[] = [];
  const fetcher = (async (_input, init) => {
    const form = new URLSearchParams(String(init?.body));
    calls.push({ form, authorization: new Headers(init?.headers).get('authorization') });
    return reply(form);
  }) as typeof fetch;
  return { calls, fetcher };
}

const issued = (form: URLSearchParams, expiresIn = 300) =>
  Response.json({
    access_token: `exchanged-for-${form.get('subject_token')}`,
    issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    token_type: 'Bearer',
    expires_in: expiresIn,
  });

describe('static credential', () => {
  it('sends the service token for every caller', async () => {
    const credential = createUpstreamCredential(
      { mode: 'static', token: 'service-token' },
      { timeoutMs: 1000, logger: silentLogger() },
    );
    expect(await credential(undefined)).toBe('service-token');
    expect(await credential(caller('user-token'))).toBe('service-token');
  });
});

describe('token exchange credential', () => {
  function setup(reply: (form: URLSearchParams) => Response = (form) => issued(form)) {
    const endpoint = tokenEndpoint(reply);
    const { logger, logs } = capturingLogger();
    const credential = createUpstreamCredential(
      { mode: 'exchange', exchange },
      { timeoutMs: 1000, logger, fetch: endpoint.fetcher },
    );
    return { ...endpoint, credential, logs };
  }

  it('exchanges the caller token per RFC 8693, authenticating as the exchange client', async () => {
    const { calls, credential } = setup();
    expect(await credential(caller('user-token-1'))).toBe('exchanged-for-user-token-1');
    expect(Object.fromEntries(calls[0]?.form ?? [])).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: 'user-token-1',
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      audience: 'notes-api',
    });
    expect(calls[0]?.authorization).toBe(
      `Basic ${Buffer.from('mcp-server:exchange-secret-value').toString('base64')}`,
    );
  });

  it('caches each exchanged token per caller token', async () => {
    const { calls, credential } = setup();
    await credential(caller('user-token-1'));
    await credential(caller('user-token-1'));
    await credential(caller('user-token-2'));
    expect(calls.map((call) => call.form.get('subject_token'))).toEqual([
      'user-token-1',
      'user-token-2',
    ]);
  });

  it('exchanges again when the cached token is about to expire', async () => {
    const { calls, credential } = setup((form) => issued(form, 20));
    await credential(caller('user-token-1'));
    await credential(caller('user-token-1'));
    expect(calls).toHaveLength(2);
  });

  it.each([
    ['rejects the exchange', () => Response.json({ error: 'invalid_grant' }, { status: 400 })],
    ['returns no token', () => Response.json({ token_type: 'Bearer' })],
  ])(
    'fails with a clear error, and an audit log without tokens, when the server %s',
    async (_label, reply) => {
      const { credential, logs } = setup(reply);
      const error = await credential(caller('user-token-secret')).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(UpstreamError);
      expect((error as UpstreamError).kind).toBe('credential');
      expect((error as UpstreamError).message).toBe(
        'Couldn’t get access to the notes API for this user, so nothing was changed. Ask the operator to check the token exchange settings.',
      );
      expect(logs()).toContain('"event":"token_exchange"');
      expect(logs()).toContain('"clientId":"mcp-client"');
      expect(logs()).not.toContain('user-token-secret');
      expect(logs()).not.toContain('exchange-secret-value');
    },
  );

  it('logs the OAuth error code of a rejected exchange', async () => {
    const { credential, logs } = setup(() =>
      Response.json({ error: 'invalid_grant' }, { status: 400 }),
    );
    await credential(caller('user-token-1')).catch(() => undefined);
    expect(logs()).toContain('"error":"invalid_grant"');
  });

  it('fails when the token endpoint is unreachable', async () => {
    const { logger } = capturingLogger();
    const credential = createUpstreamCredential(
      { mode: 'exchange', exchange },
      { timeoutMs: 1000, logger, fetch: async () => Promise.reject(new TypeError('fetch failed')) },
    );
    await expect(credential(caller('user-token-1'))).rejects.toMatchObject({ kind: 'credential' });
  });

  it('refuses a call without a signed-in caller', async () => {
    const { calls, credential } = setup();
    await expect(credential(undefined)).rejects.toMatchObject({ kind: 'credential' });
    expect(calls).toHaveLength(0);
  });
});
