# Contributing to ExiEngine

Agent and human contribution rules live in [AI_ENGINE_GUIDE.md](AI_ENGINE_GUIDE.md). The short version:

Public runtime and MCP usage is documented in [API.md](API.md); client setup snippets are in [MCP.md](MCP.md).

```powershell
npm run doctor
npm test
npm run verify
```

The runtime has no dependencies. Public JavaScript changes must stay aligned with [index.d.ts](index.d.ts), a focused smoke test, and the security/lifecycle contracts in [SECURITY.md](SECURITY.md).
