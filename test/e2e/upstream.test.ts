import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const port = process.env.E2E_API_PORT ?? '3210';
const apiUrl = `http://localhost:${port}`;
const env = {
  ...process.env,
  API_PORT: port,
  COMPOSE_PROJECT_NAME: 'mcp-server-ts-starter-upstream-e2e',
};
let client: Client;
let token: string;

function compose(...args: string[]) {
  return execFileSync('docker', ['compose', '-f', 'compose.upstream.yaml', ...args], {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

beforeAll(async () => {
  compose('down', '--volumes', '--remove-orphans');
  compose('up', '--detach', '--wait', 'api');
  const login = await fetch(`${apiUrl}/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@example.com', password: 'demo-password-123' }),
  });
  ({ token } = (await login.json()) as { token: string });

  client = new Client({ name: 'upstream-e2e', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['dist/cli.js'],
      env: { PATH: process.env.PATH ?? '', UPSTREAM_API_URL: apiUrl, UPSTREAM_API_TOKEN: token },
    }),
  );
});

afterAll(async () => {
  await client?.close();
  compose('down', '--volumes', '--remove-orphans');
});

describe('notes tools against the example notes API', () => {
  it('lists the seeded notes', async () => {
    const result = await client.callTool({ name: 'list_notes', arguments: {} });
    const titles = (result.structuredContent as { notes: { title: string }[] }).notes.map(
      (note) => note.title,
    );
    expect(titles).toEqual(expect.arrayContaining(['Welcome', 'Try the API']));
  });

  it('creates a note the API stores', async () => {
    const created = await client.callTool({
      name: 'create_note',
      arguments: { title: 'Made by MCP', body: 'e2e' },
    });
    expect(created.isError).toBeFalsy();
    const listed = await client.callTool({ name: 'list_notes', arguments: { limit: 1 } });
    expect(listed.structuredContent).toMatchObject({ notes: [{ title: 'Made by MCP' }] });
  });
});

describe('the documented Inspector quick start', () => {
  function inspect(...args: string[]) {
    const output = execFileSync('pnpm', ['inspect', '--cli', '--format', 'json', ...args], {
      env: { ...process.env, UPSTREAM_API_URL: apiUrl, UPSTREAM_API_TOKEN: token },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(output.slice(output.indexOf('{'))).result;
  }

  it('passes the upstream settings to the server, so the notes tools appear and work', () => {
    const { tools } = inspect('--method', 'tools/list');
    expect(tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining(['list_notes', 'create_note']),
    );
    const listed = inspect('--method', 'tools/call', '--tool-name', 'list_notes');
    expect(listed.isError).toBeFalsy();
    expect(JSON.stringify(listed.structuredContent)).toContain('Welcome');
  });
});
