# ADR-001 — Choice of programming language and graphics API

Status: **Accepted (implemented in code)** · Date: 2026-08-17 · Phase: Architecture & Tech Stack Selection

## Decision

1. **Language:** TypeScript/JavaScript. The runtime ships as dependency-free ES modules
   (`src/index.js`); the type surface of the public API is carried by the hand-written
   `index.d.ts`. Node.js is only used for the dev/test/MCP server; it is not needed in the
   browser runtime.
2. **Graphics API:** **WebGPU (primary) + WebGL2 (fallback)**. Each backend lives in its own file
   (`src/render/webgpu-renderer.js`, `src/render/webgl2-renderer.js`); shared pipeline modules
   (`batch.js`, `instanced.js`, `clear.js`, `scissor.js`, `post-process.js`) feed both.

## Alternatives considered and rejected

| Candidate | Why it was rejected |
| --- | --- |
| C++ + Vulkan/OpenGL/Direct3D | Cannot run in the browser. The PRD target is web-first (canvas); native APIs cannot reach the browser canvas. It also breaks the dependency-free, agent-first MCP loop. |
| Rust + Vulkan/OpenGL/wgpu (native) | Same native-access barrier; the Rust→wasm path (like bevy_macroquad) adds a build toolchain and a WASM runtime dependency. |
| Rust→wasm (Bevy style) | Adds a build step and a wasm toolchain; the reflection manifest (`exi_api`) is built on reading JS own-property descriptors, and porting it to native/wasm is costly. |
| WebGL2 alone | Gives up the WebGPU compute/indirect culling advantage (see gap: GPU culling); falls behind on newer devices. |
| WebGPU alone | Safari/older device support is incomplete; without a WebGL2 fallback the audience shrinks. |
| An external graphics library such as Three.js / PixiJS | Violates the "zero runtime dependencies" contract; conflicts with the decision that the core manages its own backends. |

## Rationale (against the PRD goals)

1. **The target platform is the browser.** PRD §2: modern browsers + WebGPU/WebGL2. Only JS
   (directly) and WASM (indirectly) run in the browser. Native APIs (Vulkan/OpenGL/Direct3D)
   are categorically not applicable — this is a platform constraint, not a tradeoff.
2. **Zero runtime dependencies** (PRD §4). JS can talk to the browser's global `WebGPU`/`WebGL2`
   APIs without any npm dependency; no external library is needed.
3. **Agent-first API** (PRD §4, differentiator #1). The `exi_api` reflection manifest reads JS
   own properties/descriptors without running getters — direct in JS, hard in native/wasm. When the
   agent loop (scaffold → preview → verify) shares one language, the toolchain stays uniform.
4. **Deterministic, bounded core** (PRD §4). Fixed-step ordering and bounded buffers can be
   implemented in JS; heavy work is moved to the GPU (WebGPU compute culling).

## Tradeoffs and consequences

- **Performance:** JS is slower than native C++/Rust; the balance is accepted given the 2D scope
  and GPU-side work (WebGPU compute, indirect draw). The benchmark gates (`npm run bench`, `npm run verify`) protect hot paths.
- **No native distribution:** console/desktop binaries are not possible (gap #10). Accepted for a
  web-first PRD.
- **WebGPU support gap:** mitigated for older browsers with the WebGL2 fallback (dual backend).
- **Type safety:** hand-written `index.d.ts`; drift is locked by `npm run test:static`.

## Evidence

- `src/render/webgl2-renderer.js`, `src/render/webgpu-renderer.js`
- `src/index.js` (public export surface), `index.d.ts` (type declarations)
- `package.json`: `"description": "A dependency-free 2D WebGL2/WebGPU renderer core."`
- `AI_ENGINE_GUIDE.md`: "The engine is not imported into another game engine; the core manages
  its own WebGL2/WebGPU backends."
