# ExiEngine agent instructions

Read `AI_ENGINE_GUIDE.md` before editing. It is the canonical, tool-agnostic project contract for Codex, OpenCode and other coding agents.

Fast path:

1. `npm run doctor`
2. Inspect callers before editing shared runtime code.
3. Run `npm test`; run `npm run verify` before release claims.

Keep the runtime dependency-free, update `index.d.ts` with public API changes, preserve security/lifecycle bounds, and never weaken tests to hide a failure.
