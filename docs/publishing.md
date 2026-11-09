# Publish a release

Pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`. It runs `pnpm verify` and `pnpm test:e2e` first, and publishes nothing unless they pass.

| Target | Runs when | Setup |
|---|---|---|
| Docker image on GHCR, for amd64 and arm64 | Always | None |
| npm package | The repo variable `NPM_PUBLISH` is `true` | Configure npm trusted publishing for this repo and the `release.yml` workflow |
| MCP Registry | The repo variable `MCP_REGISTRY_PUBLISH` is `true` | npm publishing must work first, because the registry checks `mcpName` in the published package |

## Release

1. Bump `version` in `package.json`, and both `version` fields in `server.json`.
2. Add the release to `CHANGELOG.md`.
3. Run `pnpm verify` and `pnpm test:e2e`.
4. Merge the change through a pull request, because `main` only accepts pull requests.
5. Tag the merge commit on `main` and push the tag:

   ```sh
   git switch main && git pull
   git tag -a v0.2.0 -m v0.2.0
   git push origin v0.2.0
   ```

The registry name is `io.github.<owner>/<name>`, and GitHub OIDC proves you own it. `test/unit/package.test.ts` fails if `server.json` and `package.json` disagree.
