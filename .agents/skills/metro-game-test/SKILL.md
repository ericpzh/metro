---
name: metro-game-test
description: Run, extend, and debug the Node test suite in game/test/ and headless Chrome verification scripts in tools/check-*.mjs for Station Designer. Use when adding unit or regression tests for game/src, fixing failing suites, guarding sim/render/placement/LOD/city-style invariants, or choosing between Node tests and browser checks.
---

# Game test suite (`game/test/`)

The game's deterministic test suite runs on Node's built-in `node:test` runner
directly against TypeScript sources in `game/src/`. `game/test/README.md` is the
in-repo reference for suite rules and coverage notes; use the focused references
below for the complete file inventory and browser checks:

- [Suite and support map](references/suite-map.md) — every `*.test.mjs` file in
  `game/test/`, `test:perf` membership, `test/support/` harnesses, and fixtures.
- [Browser and visual checks](references/browser-checks.md) — root `npm run check:*`
  scripts and headless Chrome/Edge verification in `tools/check-*.mjs`.

## Commands

Run from the repository root or `game/`:

```powershell
# From repository root
npm run test:game          # Full suite (npm --prefix game test)
npm run test:perf          # Curated perf/geometry/LOD/preview gate + V8 coverage
npm --prefix game run typecheck   # tsc --noEmit (4096 MB heap)

# From game/
npm test                                                  # node --test "test/**/*.test.mjs"
node --test --test-isolation=none test/openings.test.mjs  # Single file while iterating
node --test --test-isolation=none "test/**/*.test.mjs"    # Single-process fallback (spawn EPERM)
node --test --test-isolation=none --experimental-test-coverage "test/**/*.test.mjs"
npm run coverage:global-stats                             # Focused global-stats coverage
npm run test:wasm                                         # Opt-in Rust/WASM parity (wasm-routing.mjs)
```

Flags such as `--experimental-test-coverage` and `--test-isolation=none` must
**precede** test paths or globs; appending a flag after a glob does not enable
coverage. Node V8 percentages measure loaded TypeScript lines only — they do not
prove WebGL/GPU execution or React `.tsx` behavior.

## How the harness works

- **Direct TypeScript imports**: Suites use `node:test` and `node:assert/strict`
  and import `../src/**/*.ts` directly via Node's native type stripping — no build
  step, no bundler, no `dist/`.
- **DOM-free production layers**: Tests exercise `src/sim/` in-process, `src/build/`
  placement/validation logic, `src/persistence/` save/load, pure `src/render/`
  geometry/drawing/scene helpers, and DOM-free `src/app/` tools and Zustand store
  actions (`app/store.ts`).
- **Shared helpers (`game/test/support/`)**:
  - `scenario-station.ts` — controlled 3-storey Wusi Square rig for sim suites.
  - `stub-canvas.mjs` / `tracking-canvas.mjs` — recording and transform-tracking
    2D contexts for sign, banner, and display pixel assertions.
  - `pictograms.mjs` — reads shipped `src/assets/pictograms/*.png` off disk.
  - `camera-rig.mjs` — headless `CameraSystem` + DOM-shaped `OrbitControls` stub.
  - `palette-models.mjs` — `SINGLE_MODEL_OPTIONS` for full-catalogue sweeps.
- **Architectural guards**:
  - `layering.test.mjs` enforces the one-way dependency rule
    (`app/ -> render/ -> sim/`): `sim/` imports nothing outside `sim/` and never
    references DOM, `three`, or React; `render/` never imports `app/`; `build/`
    imports neither `render/` nor `app/`.
  - `scene-wiring.test.mjs` inspects `SceneRenderer.ts`, `SceneSystem` classes,
    and `Viewport.tsx` as source text so every definite-assignment sibling claim
    (`name!: Type`) is wired and fast paths (demand frames, population edits,
    pointer coalescing, sign-only/chunk skips, camera aim) remain intact.

## Rules for adding or fixing tests

1. **Import the source, never a copy or `dist/`.** If a module is hard to test in
   Node, split the arithmetic into a pure DOM/GL-free helper and test it directly.
2. **Pin concrete values with spec-like messages.** Prefer explicit numbers and
   reasons (`assert.equal(height, 1.02, 'turnstile is 1020 mm')`) over loose
   truthiness assertions.
3. **Test the silent failure.** Guard bugs that do not throw: buried TV panes,
   blank plates, broken boarding, stale cache hits, missing geometry/material
   disposal, or unreachable doors.
4. **Keep unit tests strictly deterministic.** Zero sleeps, zero network access,
   zero on-disk golden snapshots. Use seeded RNG (`rng.test.mjs`,
   `determinism.test.mjs`) and fake timers for drag/preview schedulers.
5. **Respect single-process isolation.** Under `--test-isolation=none`, the live
   Zustand store and globals (`Worker`, `self`, `document`) are shared across
   files. Arrange state inside each test rather than top-level `beforeEach` hooks
   unless the file owns and restores that state; restore global stubs between
   cases even under `test:perf` (`--test-concurrency=2`).
6. **Enforce single-verdict & preview/commit agreement.** Previews, clicks, drags,
   moves, and undo/redo must query one placement/snapping/occlusion verdict with
   one scene raycast per pointer dispatch (`validation`, `geometry-snap`,
   `placement-surface`, `tool-picking`, `preview-pipeline`, `multi-place-drag`).
7. **Guard performance with work counts, not wall-clock timers.** In `game/test/`
   and `test:perf`, pin bounded scans, zero remote rebuilds, buffer/material
   retention, cache equivalence vs fresh builds, immutable snapshot invalidation,
   and exact disposal. Keep hardware-dependent latency/FPS measurements in
   `npm run bench:*` and
   [the shared performance reference](../metro-repo/references/performance.md).
8. **Measure actual geometry, snapping, and LOD budgets.** Assert real mesh
   bounds, raycasts, and UV/material retention — never infer snaps from nominal
   storey bands alone. Every reducible palette option must meet `<10%` Low
   triangles (or its explicit minimum-shape floor in
   `tools/equipment-low-budgets.mjs`) before and after batching, with full High
   restoration (`model-detail`, `geometry-detail`, `preview-lod`, `train-lod`,
   `passenger-lod`).
9. **Keep city-style ownership complete.** Changes to city saves, palettes,
   entrance/pylon/cab marks, supplied line maps, or menu PNGs must align
   `city-style`, `module-build`, `train-cab`, `train-lod`, `line-map`,
   `model-detail`, `menu-thumbnails`, and `nonstructural-updates`, paired with
   the matching `tools/check-*-style.mjs` production browser check.
10. **Keep palette, zone, and 5 m profile contracts aligned.** Preserve the single
    5 m storey profile (`storey`, `storey-height`, `covered-clearance`,
    `catenary-model`, `three-storey-ramps`) and update `rail-families`,
    `rail-folders`, `zonetool`, `zones`, and `editor-action-benchmark` whenever
    palette items, discrete settings, or room brushes change.

### Completion gate

- Run focused suites while iterating, then run the **full**
  `npm --prefix game test` and `npm --prefix game run typecheck` before claiming
  completion.
- A focused file, V8 percentage, Vite build, or browser check does not substitute
  for the full Node suite.
- If the full suite surfaces an unrelated failure, preserve and report it
  explicitly rather than modifying unrelated code to force green.
- Add every new `.test.mjs` file to `game/test/README.md` and `game/README.md`.

## What is deliberately not tested in Node

| Untested layer | Why it is excluded from `game/test/` | Where to verify it |
|---|---|---|
| Real WebGL / GPU | No GL context in Node; arithmetic and buffer ownership live in Node instead | `npm run check:render-batching`, `check:equipment-lod`, `check:passenger-lod`, `tools/check-panel-atlas.mjs` |
| Mounted React `.tsx` views | No `.tsx` imports (`Viewport`, `ViewCube`, `AppShell`, `app/windows/**`); store/controllers + text contracts run in Node | `npm run check:tutorial`, `npm run check:info-panel`, `tools/check-game-themes.mjs`, `tools/check-sign-preview.mjs` |
| Vite `import.meta.glob` loaders | `adArt.ts`, `pictograms.ts`, `lineMapArt.ts`, live `SceneRenderer`; art caches stubbed in Node | Production bundle checks in [browser-checks.md](references/browser-checks.md) |
| Browser entry points & FPS | `/lab`, `boot.tsx`, `mobile.ts`, and hardware-dependent frame timings | `npm run check:demos`, `npm run bench:*`, [performance.md](../metro-repo/references/performance.md) |

## Related skills and docs

- [Game architecture, builder, save & app](../metro-game/SKILL.md)
- [Pure simulation (`game/src/sim/`)](../metro-game-sim/SKILL.md)
- [Three.js renderer (`game/src/render/`)](../metro-game-render/SKILL.md)
- [Unity runtime & parity](../metro-unity/SKILL.md)
- [Shared performance reference](../metro-repo/references/performance.md)
- [Opt-in Rust/WASM routing experiment](../metro-wasm-experiment/SKILL.md)
- In-repo guides: [`game/test/README.md`](../../../game/test/README.md) and [`game/README.md`](../../../game/README.md)
