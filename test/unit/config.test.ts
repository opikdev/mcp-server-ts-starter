import { describe, expect, it } from 'vitest';
import { ConfigError, loadHttpConfig } from '../../src/config.ts';

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
    expect(config.auth).toEqual({ mode: 'token', tokens: [token], scopes: ['mcp'] });
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
    ['a bad port', { MCP_AUTH_MODE: 'none', PORT: '99999' }, 'PORT'],
  ])('rejects %s', (_label, env, message) => {
    expect(() => loadHttpConfig(env)).toThrow(ConfigError);
    expect(() => loadHttpConfig(env)).toThrow(message);
  });

  it.each(['127.0.0.1', 'localhost', '::1', '[::1]', '127.0.0.5'])('allows none on %s', (host) => {
    expect(loadHttpConfig({ MCP_AUTH_MODE: 'none', HOST: host }).auth).toEqual({ mode: 'none' });
  });
});
