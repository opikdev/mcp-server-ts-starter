import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const server = JSON.parse(readFileSync('server.json', 'utf8'));
const dockerfile = readFileSync('Dockerfile', 'utf8');

interface EnvironmentVariable {
  name: string;
  description?: string;
  isSecret?: boolean;
}

const packageOf = (registryType: string) =>
  server.packages.find((entry: { registryType: string }) => entry.registryType === registryType);

describe('publishing metadata', () => {
  it('keeps server.json in step with package.json', () => {
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    expect(server.packages.map((entry: { registryType: string }) => entry.registryType)).toEqual([
      'npm',
      'oci',
    ]);
    expect(packageOf('npm')).toMatchObject({
      identifier: pkg.name,
      version: pkg.version,
      transport: { type: 'stdio' },
    });
  });

  it('lists the GHCR image at the release version, served over HTTP', () => {
    const repository = pkg.mcpName.replace(/^io\.github\./, '');
    expect(packageOf('oci')).toMatchObject({
      identifier: `ghcr.io/${repository}:${pkg.version}`,
      transport: { type: 'streamable-http' },
    });
    expect(packageOf('oci')).not.toHaveProperty('version');
  });

  it('labels the image with the server name, so the registry can verify it', () => {
    expect(dockerfile).toContain(`LABEL io.modelcontextprotocol.server.name="${server.name}"`);
  });

  it.each(['npm', 'oci'])('describes every %s setting, and marks secrets', (registryType) => {
    const variables: EnvironmentVariable[] = packageOf(registryType).environmentVariables;
    expect(variables.map((variable) => variable.name)).toEqual(
      expect.arrayContaining(['UPSTREAM_API_URL', 'UPSTREAM_API_TOKEN', 'UPSTREAM_TIMEOUT_MS']),
    );
    for (const variable of variables) {
      expect(variable.description, variable.name).toBeTruthy();
      expect(variable.isSecret === true, variable.name).toBe(
        /TOKEN$|TOKENS$|SECRET$/.test(variable.name),
      );
    }
  });

  it('lists the auth and token exchange settings for the HTTP image', () => {
    const names = packageOf('oci').environmentVariables.map(
      (variable: EnvironmentVariable) => variable.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'MCP_AUTH_MODE',
        'MCP_AUTH_TOKENS',
        'MCP_AUTH_ISSUER',
        'MCP_PUBLIC_URL',
        'UPSTREAM_AUTH',
        'UPSTREAM_AUDIENCE',
        'TOKEN_EXCHANGE_URL',
        'TOKEN_EXCHANGE_CLIENT_ID',
        'TOKEN_EXCHANGE_CLIENT_SECRET',
      ]),
    );
  });

  it('adds no remotes until the server is hosted', () => {
    expect(server).not.toHaveProperty('remotes');
  });

  it('ships only the built server, runnable with npx', () => {
    expect(pkg.files).toEqual(['dist']);
    expect(pkg.bin[pkg.name]).toBe('dist/cli.js');
  });
});
