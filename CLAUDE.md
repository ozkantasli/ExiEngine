# ExiEngine Claude Code instructions

Read `AI_ENGINE_GUIDE.md` before making changes. Treat it as the canonical project memory; do not duplicate or silently override its rules here.

Use `npm run doctor` for the fast environment/API check, `npm test` after code changes, and `npm run verify` for the full release gate. Keep runtime dependencies at zero and preserve the WebGL2/WebGPU, security, abort, destroy, and TypeScript contracts.
