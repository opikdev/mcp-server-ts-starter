import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-package-'));
  execFileSync('npm', ['pack', '--silent', '--pack-destination', dir], { encoding: 'utf8' });
  const tarball = readdirSync(dir).find((file) => file.endsWith('.tgz')) as string;
  execFileSync('npm', ['init', '-y'], { cwd: dir, stdio: 'ignore' });
  execFileSync('npm', ['install', '--silent', '--no-audit', '--no-fund', join(dir, tarball)], {
    cwd: dir,
    stdio: 'ignore',
  });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the published package', () => {
  it('contains only built JavaScript', () => {
    const files = readdirSync(join(dir, 'node_modules/mcp-server-ts-starter/dist'), {
      recursive: true,
      encoding: 'utf8',
    });
    expect(files).toContain('cli.js');
    expect(files.filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))).toEqual([]);
  });

  it('starts from its bin and serves tools over stdio', async () => {
    const stderr: string[] = [];
    const transport = new StdioClientTransport({
      command: join(dir, 'node_modules/.bin/mcp-server-ts-starter'),
      env: { PATH: process.env.PATH ?? '' },
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk) => stderr.push(String(chunk)));
    const client = new Client({ name: 'package-test', version: '1.0.0' });
    await client.connect(transport);
    try {
      const result = await client.callTool({ name: 'get_time', arguments: { timezone: 'UTC' } });
      expect(result.isError).toBeFalsy();
      expect(client.getServerVersion()?.name).toBe('mcp-server-ts-starter');
    } finally {
      await client.close();
    }
    expect(stderr.join('')).toContain('MCP server ready on stdio');
  });

  it('prints its version', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const result = spawnSync(join(dir, 'node_modules/.bin/mcp-server-ts-starter'), ['--version'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe(pkg.version);
    expect(result.stdout).toBe('');
  });
});
