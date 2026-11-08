# Engineering

- Prefers a self-built core with no dependency on third-party engines or frameworks. Confidence: 0.9
- Prioritizes speed, a lightweight footprint, and ease of use in the software they build. Confidence: 0.9
- Wants the runtime to stay free of third-party dependencies ("dependency-free" as a hard contract): tooling, testing, linting, and type checking must be built on Node built-ins (node:test, node:assert, node --check, --experimental-strip-types) rather than added devDependencies. Confidence: 0.9
- Treats "never loosen existing tests" as a hard rule: no deleting assertions, raising timeouts, or removing benchmarks to make things pass; fixes must address root causes and gate thresholds are separate tooling knobs. Confidence: 0.8
- Prefers safe refactoring that preserves behavior: when restructuring large files, keeps the original file intact and adds new complementary tests rather than risky in-place rewrites. Confidence: 0.7
- When test expectations fail, treats the mismatch as a wrong assumption in the test, not a bug in the engine, and re-writes tests against the real API. Confidence: 0.7
- Accepts fake-API contract tests for GPU-dependent modules (fake GL context / fake GPU device) instead of requiring real hardware in CI: green Node tests verify renderer contracts, with hardware-soak reserved as the real GPU proof. Confidence: 0.6
