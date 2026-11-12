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

const seconds = (fallback: number, max: number) =>
  z.coerce.number().min(0).max(max).default(fallback);

const envSchema = z.object({
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MCP_PUBLIC_URL: z.url().optional(),
  MCP_ALLOWED_HOSTS: list,
  MCP_ALLOWED_ORIGINS: list,
  MCP_AUTH_MODE: z.enum(['oauth', 'token', 'none']).optional(),
  MCP_AUTH_TOKENS: list,
  MCP_AUTH_ISSUER: z.url().optional(),
  MCP_AUTH_JWKS_URL: z.url().optional(),
  MCP_AUTH_SCOPES: z.string().default('mcp'),
  SHUTDOWN_DRAIN_SECONDS: seconds(5, 300),
  SHUTDOWN_TIMEOUT_SECONDS: seconds(30, 600),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  UPSTREAM_API_URL: z.url().optional(),
  UPSTREAM_API_TOKEN: z.string().optional(),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5000),
  UPSTREAM_AUTH: z.enum(['static', 'exchange']).default('static'),
  UPSTREAM_AUDIENCE: z.string().optional(),
  TOKEN_EXCHANGE_URL: z.url().optional(),
  TOKEN_EXCHANGE_CLIENT_ID: z.string().optional(),
  TOKEN_EXCHANGE_CLIENT_SECRET: z.string().optional(),
});

export interface TokenExchangeConfig {
  url: string;
  clientId: string;
  clientSecret: string;
  audience: string;
}

export type UpstreamAuthConfig =
  | { mode: 'static'; token: string }
  | { mode: 'exchange'; exchange: TokenExchangeConfig };

export interface UpstreamConfig {
  baseUrl: string;
  timeoutMs: number;
  auth: UpstreamAuthConfig;
}

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
  allowedOrigins: string[];
  auth: AuthConfig;
  drainMs: number;
  shutdownTimeoutMs: number;
  telemetry: boolean;
}

const minTokenLength = 16;
const localhostNames = ['localhost', '127.0.0.1', '[::1]'];

export class ConfigError extends Error {}

function isLoopback(host: string): boolean {
  if (host === 'localhost') return true;
  const bare = host.replace(/^\[|\]$/g, '');
  return isIP(bare) !== 0 && (bare === '::1' || bare.startsWith('127.'));
}

function requireHttps(name: string, value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !isLoopback(url.hostname)) {
    throw new ConfigError(`${name} must use https:// outside localhost, not ${value}.`);
  }
}

function parse(env: NodeJS.ProcessEnv) {
  const set = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = envSchema.safeParse(set);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new ConfigError(`Invalid environment: ${fields.join('; ')}`);
  }
  return result.data;
}

export function loadLogLevel(env: NodeJS.ProcessEnv = process.env): string {
  return parse(env).LOG_LEVEL;
}

export function loadTelemetryEndpoint(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return parse(env).OTEL_EXPORTER_OTLP_ENDPOINT;
}

function upstreamAuth(data: ReturnType<typeof parse>): UpstreamAuthConfig {
  if (data.UPSTREAM_AUTH === 'static') {
    if (!data.UPSTREAM_API_TOKEN) {
      throw new ConfigError('UPSTREAM_API_URL is set, so UPSTREAM_API_TOKEN is required too.');
    }
    return { mode: 'static', token: data.UPSTREAM_API_TOKEN };
  }
  if (data.MCP_AUTH_MODE !== 'oauth') {
    throw new ConfigError(
      'UPSTREAM_AUTH=exchange needs MCP_AUTH_MODE=oauth, because it exchanges the caller’s access token.',
    );
  }
  const missing = [
    'TOKEN_EXCHANGE_URL',
    'TOKEN_EXCHANGE_CLIENT_ID',
    'TOKEN_EXCHANGE_CLIENT_SECRET',
    'UPSTREAM_AUDIENCE',
  ] as const;
  const unset = missing.filter((name) => !data[name]);
  if (unset.length > 0) {
    throw new ConfigError(`UPSTREAM_AUTH=exchange needs ${unset.join(', ')}.`);
  }
  const url = data.TOKEN_EXCHANGE_URL as string;
  requireHttps('TOKEN_EXCHANGE_URL', url);
  return {
    mode: 'exchange',
    exchange: {
      url,
      clientId: data.TOKEN_EXCHANGE_CLIENT_ID as string,
      clientSecret: data.TOKEN_EXCHANGE_CLIENT_SECRET as string,
      audience: data.UPSTREAM_AUDIENCE as string,
    },
  };
}

export function loadUpstreamConfig(env: NodeJS.ProcessEnv = process.env): UpstreamConfig | null {
  const data = parse(env);
  if (!data.UPSTREAM_API_URL) return null;
  return {
    baseUrl: data.UPSTREAM_API_URL,
    timeoutMs: data.UPSTREAM_TIMEOUT_MS,
    auth: upstreamAuth(data),
  };
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
      requireHttps('MCP_AUTH_ISSUER', data.MCP_AUTH_ISSUER);
      requireHttps('MCP_PUBLIC_URL', publicUrl.href);
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

  const allowedOrigins =
    data.MCP_ALLOWED_ORIGINS.length > 0 ? data.MCP_ALLOWED_ORIGINS : [publicUrl.origin];
  for (const origin of allowedOrigins) {
    if (!URL.canParse(origin) || new URL(origin).origin !== origin) {
      throw new ConfigError(
        `MCP_ALLOWED_ORIGINS must list origins like https://app.example.com, not ${origin}.`,
      );
    }
  }

  return {
    logLevel: data.LOG_LEVEL,
    host: data.HOST,
    port: data.PORT,
    publicUrl,
    allowedHosts,
    allowedOrigins,
    auth,
    drainMs: data.SHUTDOWN_DRAIN_SECONDS * 1000,
    shutdownTimeoutMs: data.SHUTDOWN_TIMEOUT_SECONDS * 1000,
    telemetry: data.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined,
  };
}
