# Browser & Visual Verification (`tools/check-*.mjs`)

Node tests in `game/test/` intentionally omit real WebGL contexts, mounted React `.tsx` views, and Vite `import.meta.glob` loaders. Headless Chrome/Edge scripts in `tools/check-*.mjs` verify those production paths.

## Shared harness (`tools/browser-harness.mjs`)

- Launches Chrome or Edge in `--headless=new --mute-audio` mode over CDP (`findChrome`, `serveDir`, `withPage`, `waitFor`, `loadExampleStation`).
- Override browser path with `CHROME_PATH`; set `METRO_BROWSER_GPU=hardware` to disable SwiftShader where supported. Scripts that test WebGL fallbacks accept `--software-gpu` and/or `--no-multi-draw`.
- Reports, JSON diagnostics, and review screenshots write to gitignored `.preview/` directories.
- Browser checks establish functional/GPU parity and visual evidence only — they **do not** contribute to Node V8 coverage and are **not** hardware-dependent FPS gates. For latency/FPS benchmarks (`npm run bench:*`, `npm run profile:*`), see [the shared performance reference](../../metro-repo/references/performance.md).

## Root `npm run check:*` scripts

Verified against root `package.json` (each builds its required bundle unless noted):

| Root script | Command / target | What it verifies |
|---|---|---|
| `npm run check:demos` | Builds `web/` + `game/`, runs `tools/check-demos.mjs` | Unified preview server (`tools/preview.mjs`): demo picker triggers, deep links (`/game/{zoo,tanwei,tianhe}`, `/game/en/…`), redirects, 390 px nav |
| `npm run check:equipment-lod` | `tools/check-equipment-lod.mjs` (embedded Vite dev server) | Full palette High/Low GPU renders, submissions, blank-pixel checks, contact sheets |
| `npm run check:geometry-detail` | Builds `game/`, runs `tools/check-geometry-detail.mjs` | Wheel zoom detail swaps, batch identity, settings quality controls, Hide UI (`--no-multi-draw` supported) |
| `npm run check:info-panel` | Builds `game/`, runs `tools/check-info-panel.mjs` | Selected-module info panel layout, actions drawer, lift door dialog & undo |
| `npm run check:passenger-lod` | Builds `game/`, runs `tools/check-passenger-lod.mjs` | High vs Low passenger GPU silhouette comparison across appearances, ages, gaits |
| `npm run check:perf-tools` | `tools/check-perf-tools.mjs` (`data:` page smoke check) | Chrome CDP V8 `Profiler` CPU profile export and `Tracing` stream capture |
| `npm run check:render-batching` | Builds `game/`, runs `tools/check-render-batching.mjs` | Production GLSL/WebGL compilation, draw reduction, open/closed train triangles (`--no-multi-draw`, `--software-gpu`) |
| `npm run check:roads` | Builds `game/`, runs `tools/check-road-placement.mjs` | Live pointer road node placement, 1 pick/press, preview handles, commit |
| `npm run check:stats:reports` | `tools/check-stats-reports.mjs` (local `stats/` Worker + temp D1) | Public feedback/bug/save-share board end-to-end against isolated local D1 |
| `npm run check:tutorial` | Builds `game/`, runs `tools/check-game-tutorial.mjs` | Bilingual tutorial flow, controls, music toggle, spotlights, keycaps, reload/opt-out |

Other root verification helpers: `npm run audit:i18n` (`tools/audit-i18n.mjs`), `npm run bench:*` / `npm run profile:*` (interactive latency and sim/GPU profiling).

## Complete `tools/check-*.mjs` inventory

Scripts serving `game/dist` require `npm --prefix game run build` first unless run through an `npm run check:*` wrapper. Scripts serving `model/dist` require `npm --prefix model run build`.

### Rendering, batching, LOD & GPU pixels

| Script | Launch | Focus |
|---|---|---|
| `check-render-batching.mjs` | `game/dist` | Production GLSL, multi-draw batching, train open/closed geometry (`--no-multi-draw`, `--software-gpu`) |
| `check-static-rendering.mjs` | `game/dist` | Static outdoor/chunk rendering cache and fallback (`--no-multi-draw`) |
| `check-equipment-lod.mjs` | Vite dev (`game/`) | Full-catalogue source-builder High/Low GPU contact sheets and budgets |
| `check-geometry-detail.mjs` | `game/dist` | Zoom distance detail swaps, settings menu, Hide UI (`--no-multi-draw`) |
| `check-preview-lod.mjs` | `game/dist` | Wall picks, preview-to-placement LOD parity (`--no-multi-draw`) |
| `check-transport-lod.mjs` | `game/dist` | Rolling stock batching, moving doors, and both roof power modes |
| `check-panel-atlas.mjs` | Inline Vite build | Real WebGL `PanelAtlas` pixel readback, color/orientation, gutters, restore |
| `check-level-retention.mjs` | `game/dist` | Storey switch chunk retention and ownership counts |
| `check-exploded-view.mjs` | `game/dist` | Exploded floor selection, drag, deselection, reset, guides, buffer identity |
| `check-perf-tools.mjs` | `data:` page | CDP V8 CPU profiler and trace stream export smoke check |

### Geometry, snapping, picking & editing interactions

| Script | Launch | Focus |
|---|---|---|
| `check-geometry-snapping.mjs` | `game/dist` | Pointer slab/hanger/wall-mount placement & low-angle beam picks across bases |
| `check-tool-picking.mjs` | `game/dist` | Picking, occlusion, ceiling-sign click, delete/undo (1 raycast/dispatch) |
| `check-editor-move-caches.mjs` | `game/dist` | Move/undo/redo GPU batch parity vs forced fresh aggregation (`--software-gpu`) |
| `check-ceiling-floor.mjs` | `game/dist` | Active floor visibility across Hide Ceiling, ramp carves, and level changes |
| `check-ceiling-wall-faces.mjs` | `game/dist` | Wall faces, geometry retention, and ledge heights under Hide Ceiling |
| `check-tanwei-raised-floors.mjs` | `game/dist` | WebGL draw callbacks for Tanwei raised platforms across ceiling tags/levels |
| `check-wall-cuts.mjs` | `game/dist` | Live pointer thin-wall-corner joining a half wall in the same cell |
| `check-ramp-fit.mjs` | `game/dist` | Continuous terrain contact under wide runs across delete/restore commits |
| `check-ramp-block-placement.mjs` | `game/dist` | Real-pointer block placement beside multi-storey ramps on saved fixture |

### City styles (production selection, artwork, posters & reload)

| Script | Launch | Focus |
|---|---|---|
| `check-city-styles.mjs` | `game/dist` | Multi-city keyboard selection, redraws, retained models, reload |
| `check-shanghai-style.mjs` | `game/dist` | Shanghai preset selection, artwork, and rendering |
| `check-beijing-style.mjs` | `game/dist` | Beijing station/cab marks, overlapping decal depth, synchronized signs, poster |
| `check-chengdu-style.mjs` | `game/dist` | Chengdu selection, retained artwork, supplied poster, High/Low views |
| `check-chongqing-style.mjs` | `game/dist` | Chongqing sealed glass sides, closed pylons, retained line badges, High/Low |
| `check-wuhan-style.mjs` | `game/dist` | Wuhan selector, lazy poster decode, live recoloring, undo/reload, High/Low |
| `check-nanjing-style.mjs` | `game/dist` | Nanjing selection, retained side artwork, lazy supplied poster, High/Low |

### Game UI, demos, audio, themes & signage

| Script | Launch | Focus |
|---|---|---|
| `check-demos.mjs` | `web/dist` + `game/dist` | Site demo picker, deep links, trailing-slash redirects, mobile nav |
| `check-game-tutorial.mjs` | `game/dist` | Bilingual tutorial, spotlights, music control, live tools, reload/opt-out |
| `check-game-themes.mjs` | `game/dist` | Early loading shell (blocked bundle), theme switching, scene void, reload |
| `check-info-panel.mjs` | `game/dist` | Inspector details/actions layout, 32 px controls, lift doors & undo |
| `check-game-audio.mjs` | `game/dist` | Pointer cue routing, 1 pick/action, bilingual sliders, mute, ambient sources |
| `check-game-music.mjs` | Vite dev (`game/`) | Isolated React `MusicSetting.tsx` + `gameMusic` audit without station GPU |
| `check-sign-preview.mjs` | `game/dist` | Sign editor drag-to-trash, hit targets, plate parity, narrow-width scaling |
| `check-sign-history.mjs` | `game/dist` | Sign editor history panel two-row tile layout without overflow/scroll |
| `check-sign-save.mjs` | `game/dist` | Read-only sign diagnostic against a supplied station save |

### Passengers & road traffic (game build)

| Script | Launch | Focus |
|---|---|---|
| `check-passenger-lod.mjs` | `game/dist` | High/Low passenger GPU silhouette comparison across appearances, ages, gaits |
| `check-game-passenger-library.mjs` | `game/dist` | Exhaustive recipe/age capture plus live Zoo crowd load |
| `check-game-passenger-activities.mjs` | `game/dist` | High/Low activity shaders, adult/child, pause, doors, sinks, skirts |
| `check-game-passenger-handedness.mjs` | `game/dist` | GPU pixel difference for free-hand preferences vs bag-held override |
| `check-game-ramp-animation.mjs` | `game/dist` | Real `World` transfer stream into instanced High/Low ramp draws |
| `check-approved-crowd.mjs` | Live server (`:4270`) | Live crowd screenshot, triangle count, 1 draw, zero shader errors |
| `check-game-passenger-size.mjs` | Live server (`:5174`) | `?capture-passengers` adult/child size lineup and shader error check |
| `check-road-placement.mjs` | `game/dist` | Live road node press/drag previews, 1 pick/press, commit |
| `check-road-network.mjs` | `game/dist` | Right-hand road network, stop lines, wide/T junction markings |
| `check-road-vehicles.mjs` | `game/dist` | `?capture-road-vehicles` High/Low vehicle GPU views and counts |

### Model studio, cross-package & pure-Node checks

| Script | Launch / owner | Focus |
|---|---|---|
| `check-soft-human.mjs` | `model/dist` (`metro-model`) | Soft-human motion-study preview smoke check |
| `check-soft-arm-poses.mjs` | `model/dist` (`metro-model`) | Soft-human arm pose renders |
| `check-soft-escalator-pose.mjs` | `model/dist` (`metro-model`) | Natural escalator posture and equipment clearance renders |
| `check-soft-human-activities.mjs` | `model/dist` (`metro-model`) | Activity animation clips in soft-human studio |
| `check-soft-human-casual.mjs` | `model/dist` (`metro-model`) | Casual wardrobe outfit coverage renders |
| `check-soft-human-clearance.mjs` | `model/dist` (`metro-model`) | Equipment and strap clearance renders |
| `check-sound-preview.mjs` | `model/dist` (`metro-model`) | `model/sounds.html` decoding, live mute, lifecycle, responsive layout |
| `check-stats-reports.mjs` | `stats/` (`metro-stats`) | Feedback board & save-share flow against temporary local D1 |
| `check-wasm-routing.mjs` | Preview server (`:4174`, `metro-wasm-experiment`) | Opt-in WASM routing bundle check in headless browser |
| `check-platform-floor.mjs` | Pure Node (no browser) | Seeded Tanwei simulation replay verifying passenger PSD wall containment |
