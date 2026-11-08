# 003. Build before publishing

- **Status**: accepted
- **Context**: Node runs TypeScript directly, but not from `node_modules`. A published package run with `npx` would fail on `.ts` files.
- **Decision**: Run `src/` directly in development, and compile to `dist/` with `tsc` for the npm package and the Docker image.
- **Consequences**:
  - `npx mcp-server-ts-starter` works, and `test/e2e/package.test.ts` proves it from a packed tarball.
  - Relative imports keep their `.ts` extensions, which `tsc` rewrites to `.js`.
