---
name: metro-wasm-experiment
description: Reproduce or review Metro's opt-in Rust/WebAssembly A* routing experiment and verify its exclusion from normal web builds.
---

# Metro WASM routing experiment

The reported benchmark outcome was no FPS improvement. Keep the prototype for
local comparison. Normal startup, web builds, and deployment use TypeScript.
Only the explicit Vite mode `wasm-experiment` includes the kernel. Its build
goes to `game/dist-wasm` while Cloudflare serves `game/dist`.

Use `npm --prefix game run dev:wasm` for dev or
`npm --prefix game run build:game:wasm` followed by
`npm --prefix game run preview:wasm`. On localhost `/benchmark`, run both
backends with the same settings. A usable WASM result requires a positive
search count and no fallback. Compare tick progression alongside frame timing.
Use the repo performance reference for measurements.

Only uncached A* moved. TypeScript owns the world, graph construction, live
costs, queue, budget, and cache. The kernel uses the host's `Math.hypot` to
preserve tie behavior. A failed search retries in TypeScript in the same worker.
Run `npm --prefix game run test:wasm` for seeded parity and
`node tools/check-wasm-routing.mjs` against the experimental preview for
worker and fallback checks.

To verify release isolation, leave generated bindings in place, run the normal
game build, and inspect `game/dist` for routing WASM binaries and loader chunks.
The normal benchmark should hide the backend picker even on localhost.
