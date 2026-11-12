import { spawnSync } from 'node:child_process';

const inspector = '@modelcontextprotocol/inspector@2.14.0';
const forwarded = ['UPSTREAM_API_URL', 'UPSTREAM_API_TOKEN', 'UPSTREAM_TIMEOUT_MS'];

// The Inspector starts the server with only a few variables, so pass the upstream settings on.
const env = forwarded
  .filter((name) => process.env[name])
  .flatMap((name) => ['-e', `${name}=${process.env[name]}`]);

const { status } = spawnSync(
  'pnpm',
  ['dlx', inspector, ...process.argv.slice(2), ...env, 'node', 'src/cli.ts'],
  { stdio: 'inherit' },
);
process.exit(status ?? 1);
