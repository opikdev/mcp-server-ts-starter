import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const server = JSON.parse(readFileSync('server.json', 'utf8'));

describe('publishing metadata', () => {
  it('keeps server.json in step with package.json', () => {
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    expect(server.packages).toEqual([
      {
        registryType: 'npm',
        identifier: pkg.name,
        version: pkg.version,
        transport: { type: 'stdio' },
      },
    ]);
  });

  it('ships only the built server, runnable with npx', () => {
    expect(pkg.files).toEqual(['dist']);
    expect(pkg.bin[pkg.name]).toBe('dist/cli.js');
  });
});
