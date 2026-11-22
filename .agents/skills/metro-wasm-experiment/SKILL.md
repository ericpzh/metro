---
name: metro-wasm-experiment
description: Build, test, and review the opt-in Rust/WebAssembly A* routing prototype in game/wasm/, and verify its exclusion from normal web builds and Cloudflare deploys.
---

# Metro WASM Routing Experiment

Opt-in local comparison prototype offloading uncached A* searches to
Rust/WebAssembly. Normal dev, builds (`npm --prefix game run build`), and
Cloudflare deploys (`game/wrangler.jsonc` serves `./dist`) use pure TypeScript
and exclude all routing WASM assets.

Only Vite mode `wasm-experiment` compiles and loads the kernel, emitting to
`game/dist-wasm`. `game/generated/wasm/`, `game/wasm/target/`, and
`game/dist-wasm/` are gitignored.

## Toolchain & Commands

Requires Rust `1.90.0` with `wasm32-unknown-unknown`
(`game/wasm/rust-toolchain.toml`) and `wasm-pack 0.13.1` (enforced by
`game/scripts/build-wasm.mjs`).

| Command | Purpose |
| --- | --- |
| `npm --prefix game run build:wasm` | Build `metro-routing` (`wasm-pack --target web --release -- --locked`) to `game/generated/wasm/`. |
| `npm --prefix game run dev:wasm` | Build WASM and start Vite dev (`:5174`, `--mode wasm-experiment`). |
| `npm --prefix game run build:game:wasm` | Build WASM, typecheck, and emit `game/dist-wasm/`. |
| `npm --prefix game run preview:wasm` | Serve `game/dist-wasm/` at `http://localhost:4174` (`vite preview --mode wasm-experiment`). |
| `npm --prefix game run test:wasm` | Build WASM and run `node --test test/wasm-routing.mjs` (skipped by `npm --prefix game test`). |
| `node tools/check-wasm-routing.mjs [url]` | Headless Chrome probe, playback, edit, autosave, and fallback check (default `http://localhost:4174`, `METRO_WASM_DEBUG_PORT` default `9335`). |

### Release Isolation Check

Leave `game/generated/wasm/` on disk and run `npm --prefix game run build`:

1. Confirm `game/dist/` has no `metro_routing*`, `workerWasm*`, or `.wasm`
   assets (`worker.ts` gates the dynamic import on
   `import.meta.env.MODE === 'wasm-experiment'`, tree-shaking `workerWasm.ts`
   and its `import.meta.glob` targets).
2. Confirm normal `/benchmark` hides the backend picker even on `localhost`.

## Architecture & Invariants

- **Offload boundary**: Only uncached `PathFinder.astar()` runs in Rust
  (`Router::search` / `Router::route`). TypeScript owns `World`, graph build,
  live congestion/wait/gate forecasts, queue, budget, and cache.
- **Tie-break parity**: `lib.rs` calls JS `Math.hypot` via `inline_js` so
  heuristic rounding matches TypeScript heap ordering.
- **Sparse routing**: Attaching `WasmRouting` sets `world.path.routeSearch`,
  making `World.useSparseRouting()` return `false` so searches run through
  `PathFinder.astar()` instead of `SparseRouter`.
- **Activation & fallback**: `SimSlice.ts` and `BenchmarkRoute.tsx` require
  `MODE === 'wasm-experiment'` and a loopback host (`localhost`, `127.0.0.1`,
  `[::1]`). Enable via `/benchmark` selector or `?sim=wasm` (optional
  `?wasmFault=missing|search`). On load error, bad output, or trap,
  `PathFinder.astar()` clears `routeSearch`, calls `onSearchFailure` (disposing
  the kernel and posting `RoutingDiagnostic` `{ backend: 'ts', status: 'fallback' }`),
  and retries in TypeScript.
- **Preserved contracts**: `metro-save` v1, 6-float passenger stride
  (`World.writeTransfer`), and `routeToken` preview sequencing.
- **Benchmarking**: On localhost `/benchmark`, match settings across backends,
  require positive WASM searches with no fallback, and compare ticks with FPS.
  Record results in [performance.md](../metro-repo/references/performance.md).

## Code Boundaries

| Area | Files & Symbols |
| --- | --- |
| Rust kernel | `game/wasm/Cargo.toml`, `rust-toolchain.toml`, `src/lib.rs` (`metro-routing`, `wasm-bindgen =0.2.104`, `wasm-opt = false`; `Router`, `probe() -> 42`, `trap_search()`). |
| Build & deploy | `game/scripts/build-wasm.mjs`, `game/vite.config.ts` (`dist-wasm` vs `dist`), `game/package.json`, `game/wrangler.jsonc` (`./dist`). |
| Adapter & loader | `game/src/sim/wasmRouting.ts` (`WasmRouting`), `game/src/sim/workerWasm.ts` (`loadWasmRouting`). |
| Worker & protocol | `game/src/sim/worker.ts` (`enableWasm`, `attachRouting`, `routingFailure`), `game/src/sim/protocol.ts` (`RoutingDiagnostic`, `RoutingFault`). |
| Sim hooks | `game/src/sim/station.ts` (`PathFinder.routeSearch`, `onSearchFailure`), `game/src/sim/world/World.ts` (`useSparseRouting`). |
| App & benchmark | `game/src/app/store/slices/SimSlice.ts` (`ensureClient`, `prepareBenchmarkWorker`, `benchmarkRoutingDiagnostic`, `window.__metroRouting`), `game/src/app/benchmark/BenchmarkRoute.tsx`, `benchmarkCopy.ts`. |
| Verification | `game/test/wasm-routing.mjs`, `tools/check-wasm-routing.mjs`. |

## Related Skills

- [`metro-game-sim`](../metro-game-sim/SKILL.md) — pure simulation, `PathFinder`, and `SparseRouter`.
- [`metro-game`](../metro-game/SKILL.md) — `game/` architecture, worker protocol, saves, and app shell.
