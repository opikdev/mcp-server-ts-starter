import { isIP } from 'node:net';
import { z } from 'zod';

const list = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const envSchema = z.object({
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MCP_PUBLIC_URL: z.url().optional(),
  MCP_ALLOWED_HOSTS: list,
  MCP_AUTH_MODE: z.enum(['oauth', 'token', 'none']).optional(),
  MCP_AUTH_TOKENS: list,
  MCP_AUTH_ISSUER: z.url().optional(),
  MCP_AUTH_JWKS_URL: z.url().optional(),
  MCP_AUTH_SCOPES: z.string().default('mcp'),
});

export type AuthConfig =
  | { mode: 'oauth'; issuer: string; jwksUrl: string | undefined; scopes: string[] }
  | { mode: 'token'; tokens: string[]; scopes: string[] }
  | { mode: 'none' };

export interface HttpConfig {
  logLevel: string;
  host: string;
  port: number;
  publicUrl: URL;
  allowedHosts: string[];
  auth: AuthConfig;
}

const minTokenLength = 16;
const localhostNames = ['localhost', '127.0.0.1', '[::1]'];

export class ConfigError extends Error {}

function isLoopback(host: string): boolean {
  if (host === 'localhost') return true;
  const bare = host.replace(/^\[|\]$/g, '');
  return isIP(bare) !== 0 && (bare === '::1' || bare.startsWith('127.'));
}

function parse(env: NodeJS.ProcessEnv) {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new ConfigError(`Invalid environment: ${fields.join('; ')}`);
  }
  return result.data;
}

export function loadLogLevel(env: NodeJS.ProcessEnv = process.env): string {
  return parse(env).LOG_LEVEL;
}

export function loadHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  const data = parse(env);
  const publicUrl = new URL(data.MCP_PUBLIC_URL ?? `http://localhost:${data.PORT}/mcp`);
  const scopes = data.MCP_AUTH_SCOPES.split(/\s+/).filter(Boolean);

  let auth: AuthConfig;
  switch (data.MCP_AUTH_MODE) {
    case 'oauth':
      if (!data.MCP_AUTH_ISSUER) {
        throw new ConfigError(
          'MCP_AUTH_MODE=oauth needs MCP_AUTH_ISSUER, the authorization server URL.',
        );
      }
      auth = {
        mode: 'oauth',
        issuer: data.MCP_AUTH_ISSUER,
        jwksUrl: data.MCP_AUTH_JWKS_URL,
        scopes,
      };
      break;
    case 'token':
      if (data.MCP_AUTH_TOKENS.length === 0) {
        throw new ConfigError(
          'MCP_AUTH_MODE=token needs MCP_AUTH_TOKENS, a comma-separated list of tokens.',
        );
      }
      if (data.MCP_AUTH_TOKENS.some((token) => token.length < minTokenLength)) {
        throw new ConfigError(
          `Every token in MCP_AUTH_TOKENS must have at least ${minTokenLength} characters.`,
        );
      }
      auth = { mode: 'token', tokens: data.MCP_AUTH_TOKENS, scopes };
      break;
    case 'none':
      if (!isLoopback(data.HOST)) {
        throw new ConfigError(
          `MCP_AUTH_MODE=none is only allowed when HOST is a loopback address, not ${data.HOST}.`,
        );
      }
      auth = { mode: 'none' };
      break;
    default:
      throw new ConfigError(
        'Set MCP_AUTH_MODE to oauth, token, or none before serving over HTTP. See docs/auth.md.',
      );
  }

  const allowedHosts =
    data.MCP_ALLOWED_HOSTS.length > 0
      ? data.MCP_ALLOWED_HOSTS
      : [...new Set([...localhostNames, publicUrl.hostname])];

  return {
    logLevel: data.LOG_LEVEL,
    host: data.HOST,
    port: data.PORT,
    publicUrl,
    allowedHosts,
    auth,
  };
}
