# Releasing ExiEngine

Publishing is an owner action (it needs the npm account that owns the package name).
Everything up to `npm publish` is automated and checked by the test suite.

## Checklist

1. Make sure `main` contains the release and CI is green.
2. Pick the version (0.x: bump the minor for features or API changes, the patch for fixes) and
   update it in **three places** — `npm test` fails if they disagree:
   - `package.json` → `"version"`
   - `tools/exi-mcp-server.mjs` → `SERVER_VERSION`
   - `CHANGELOG.md` → a `## [x.y.z]` section (replace "unreleased" with the date)
3. Run the gates locally:

   ```bash
   npm run verify
   ```

   ```bash
   npm run test:e2e:examples
   ```

4. Inspect the tarball (it must contain `src/`, `dist/`, `index.d.ts`, README, API, LICENSE and
   no demo, tests or tools):

   ```bash
   npm pack --dry-run
   ```

5. Check that the package name is free or yours (`exi-engine`), log in and publish:

   ```bash
   npm view exi-engine name
   ```

   ```bash
   npm login
   ```

   ```bash
   npm publish --access public
   ```

   `prepack` runs `npm run build`, so `dist/` is always fresh.
6. Tag the release and push the tag:

   ```bash
   git tag v0.3.0
   ```

   ```bash
   git push origin v0.3.0
   ```

7. CDNs serve the published files automatically, for example
   `https://cdn.jsdelivr.net/npm/exi-engine@0.3.0/dist/exi-engine.js`.

If the name `exi-engine` is taken, publish under a scope (`@your-name/exi-engine`): change
`"name"` in `package.json` and the install line in the README.
