import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadHttpConfig, loadUpstreamConfig } from '../../src/config.ts';

const token = 'a-token-of-sixteen+';

describe('loadHttpConfig', () => {
  it('refuses to start without an auth mode', () => {
    expect(() => loadHttpConfig({})).toThrow(/Set MCP_AUTH_MODE/);
  });

  it('defaults to a localhost bind and URL', () => {
    const config = loadHttpConfig({ MCP_AUTH_MODE: 'token', MCP_AUTH_TOKENS: token });
    expect(config.host).toBe('127.0.0.1');
    expect(config.publicUrl.href).toBe('http://localhost:3000/mcp');
    expect(config.allowedHosts).toEqual(['localhost', '127.0.0.1', '[::1]']);
    expect(config.allowedOrigins).toEqual(['http://localhost:3000']);
    expect(config.auth).toEqual({ mode: 'token', tokens: [token], scopes: ['mcp'] });
    expect(config.drainMs).toBe(5000);
    expect(config.shutdownTimeoutMs).toBe(30_000);
    expect(config.telemetry).toBe(false);
  });

  it('allows the public URL host and custom scopes', () => {
    const config = loadHttpConfig({
      MCP_AUTH_MODE: 'oauth',
      MCP_AUTH_ISSUER: 'https://auth.example.com',
      MCP_PUBLIC_URL: 'https://mcp.example.com/mcp',
      MCP_AUTH_SCOPES: 'mcp:read mcp:write',
    });
    expect(config.allowedHosts).toContain('mcp.example.com');
    expect(config.auth).toMatchObject({ mode: 'oauth', scopes: ['mcp:read', 'mcp:write'] });
  });

  it('reads shutdown timing, allowed origins, and the telemetry endpoint', () => {
    const config = loadHttpConfig({
      MCP_AUTH_MODE: 'none',
      MCP_ALLOWED_ORIGINS: 'https://app.example.com, http://localhost:6274',
      SHUTDOWN_DRAIN_SECONDS: '0',
      SHUTDOWN_TIMEOUT_SECONDS: '2.5',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
    });
    expect(config.allowedOrigins).toEqual(['https://app.example.com', 'http://localhost:6274']);
    expect(config.drainMs).toBe(0);
    expect(config.shutdownTimeoutMs).toBe(2500);
    expect(config.telemetry).toBe(true);
  });

  it.each([
    [
      'an http issuer',
      { MCP_AUTH_ISSUER: 'http://auth.example.com' },
      'MCP_AUTH_ISSUER must use https://',
    ],
    [
      'an http public URL',
      { MCP_PUBLIC_URL: 'http://mcp.example.com/mcp' },
      'MCP_PUBLIC_URL must use https://',
    ],
  ])('refuses %s with oauth outside loopback', (_label, env, message) => {
    expect(() =>
      loadHttpConfig({
        MCP_AUTH_MODE: 'oauth',
        MCP_AUTH_ISSUER: 'https://auth.example.com',
        MCP_PUBLIC_URL: 'https://mcp.example.com/mcp',
        ...env,
      }),
    ).toThrow(message);
  });

  it.each(['http://localhost:8080/realms/mcp', 'http://127.0.0.1:8080', 'http://[::1]:8080'])(
    'allows an http issuer on loopback, %s',
    (issuer) => {
      expect(
        loadHttpConfig({ MCP_AUTH_MODE: 'oauth', MCP_AUTH_ISSUER: issuer }).auth,
      ).toMatchObject({ mode: 'oauth', issuer });
    },
  );

  it('uses explicit allowed hosts as given', () => {
    const config = loadHttpConfig({
      MCP_AUTH_MODE: 'token',
      MCP_AUTH_TOKENS: token,
      MCP_ALLOWED_HOSTS: 'a.example, b.example',
    });
    expect(config.allowedHosts).toEqual(['a.example', 'b.example']);
  });

  it.each([
    ['oauth without an issuer', { MCP_AUTH_MODE: 'oauth' }, 'MCP_AUTH_ISSUER'],
    ['token without tokens', { MCP_AUTH_MODE: 'token' }, 'MCP_AUTH_TOKENS'],
    ['a short token', { MCP_AUTH_MODE: 'token', MCP_AUTH_TOKENS: 'short' }, 'at least 16'],
    ['none on a public interface', { MCP_AUTH_MODE: 'none', HOST: '0.0.0.0' }, 'loopback'],
    ['an unknown mode', { MCP_AUTH_MODE: 'magic' }, 'MCP_AUTH_MODE'],
    ['an empty mode', { MCP_AUTH_MODE: '' }, 'Set MCP_AUTH_MODE'],
    ['a bad port', { MCP_AUTH_MODE: 'none', PORT: '99999' }, 'PORT'],
    [
      'an origin with a path',
      { MCP_AUTH_MODE: 'none', MCP_ALLOWED_ORIGINS: 'https://a.example/x' },
      'MCP_ALLOWED_ORIGINS',
    ],
    [
      'a bare host as origin',
      { MCP_AUTH_MODE: 'none', MCP_ALLOWED_ORIGINS: 'a.example' },
      'MCP_ALLOWED_ORIGINS',
    ],
    [
      'a negative drain',
      { MCP_AUTH_MODE: 'none', SHUTDOWN_DRAIN_SECONDS: '-1' },
      'SHUTDOWN_DRAIN_SECONDS',
    ],
  ])('rejects %s', (_label, env, message) => {
    expect(() => loadHttpConfig(env)).toThrow(ConfigError);
    expect(() => loadHttpConfig(env)).toThrow(message);
  });

  it('loads .env.example as shipped', () => {
    const env = parseEnv(readFileSync('.env.example', 'utf8'));
    expect(loadHttpConfig(env).auth).toEqual({
      mode: 'token',
      tokens: ['dev-token-change-me-0123'],
      scopes: ['mcp'],
    });
    expect(loadUpstreamConfig(env)).toBeNull();
  });

  it('treats empty values as unset', () => {
    const config = loadHttpConfig({
      MCP_AUTH_MODE: 'none',
      PORT: '',
      MCP_PUBLIC_URL: '',
      MCP_AUTH_SCOPES: '',
    });
    expect(config.port).toBe(3000);
    expect(config.publicUrl.href).toBe('http://localhost:3000/mcp');
  });

  it.each(['127.0.0.1', 'localhost', '::1', '[::1]', '127.0.0.5'])('allows none on %s', (host) => {
    expect(loadHttpConfig({ MCP_AUTH_MODE: 'none', HOST: host }).auth).toEqual({ mode: 'none' });
  });
});

describe('loadUpstreamConfig', () => {
  const exchange = {
    UPSTREAM_API_URL: 'https://api.example.com',
    UPSTREAM_AUTH: 'exchange',
    MCP_AUTH_MODE: 'oauth',
    TOKEN_EXCHANGE_URL: 'https://auth.example.com/token',
    TOKEN_EXCHANGE_CLIENT_ID: 'mcp-server',
    TOKEN_EXCHANGE_CLIENT_SECRET: 'exchange-secret',
    UPSTREAM_AUDIENCE: 'notes-api',
  };

  it('is off by default', () => {
    expect(loadUpstreamConfig({})).toBeNull();
  });

  it('reads the API, a static token, and the timeout by default', () => {
    expect(
      loadUpstreamConfig({
        UPSTREAM_API_URL: 'http://api:3000',
        UPSTREAM_API_TOKEN: 'secret',
        UPSTREAM_TIMEOUT_MS: '2500',
      }),
    ).toEqual({
      baseUrl: 'http://api:3000',
      timeoutMs: 2500,
      auth: { mode: 'static', token: 'secret' },
    });
  });

  it('requires a token when the API is set', () => {
    expect(() => loadUpstreamConfig({ UPSTREAM_API_URL: 'http://api:3000' })).toThrow(
      'UPSTREAM_API_TOKEN is required',
    );
  });

  it('reads token exchange settings, without needing a static token', () => {
    expect(loadUpstreamConfig(exchange)?.auth).toEqual({
      mode: 'exchange',
      exchange: {
        url: 'https://auth.example.com/token',
        clientId: 'mcp-server',
        clientSecret: 'exchange-secret',
        audience: 'notes-api',
      },
    });
  });

  it.each([
    ['without OAuth', { MCP_AUTH_MODE: 'token' }, 'needs MCP_AUTH_MODE=oauth'],
    [
      'without a client secret',
      { TOKEN_EXCHANGE_CLIENT_SECRET: '' },
      'TOKEN_EXCHANGE_CLIENT_SECRET',
    ],
    ['without an audience', { UPSTREAM_AUDIENCE: '' }, 'UPSTREAM_AUDIENCE'],
    [
      'over http to a remote host',
      { TOKEN_EXCHANGE_URL: 'http://auth.example.com/token' },
      'TOKEN_EXCHANGE_URL must use https://',
    ],
  ])('refuses exchange %s', (_label, env, message) => {
    expect(() => loadUpstreamConfig({ ...exchange, ...env })).toThrow(message);
  });

  it.each(['50', '120000', 'soon'])('rejects a timeout of %s', (value) => {
    expect(() =>
      loadUpstreamConfig({
        UPSTREAM_API_URL: 'http://api:3000',
        UPSTREAM_API_TOKEN: 's',
        UPSTREAM_TIMEOUT_MS: value,
      }),
    ).toThrow('UPSTREAM_TIMEOUT_MS');
  });
});
