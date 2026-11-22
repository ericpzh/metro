# `tools/` Index

Categorized inventory of active directories and scripts under `tools/`. Run all
scripts from the repository root. For full benchmark invocations see
[perf-benchmarks.md](perf-benchmarks.md); for domain rules follow the owning
skill linked in each section.

## Subdirectories

| Directory | Purpose | Owning skill |
| --- | --- | --- |
| `tools/demo-video/` | Demo-video modules (`plan.mjs`, `capture.mjs`, `record.mjs`, `media.mjs`, `design.mjs`, `audio.mjs`, `montage.mjs`, `catalogue.mjs`); entrypoint `tools/demo-video.mjs`. | [metro-video](../../metro-video/SKILL.md) |
| `tools/unity-assets/` | Three.js/model → glTF → Unity 6 URP exporters (`export-*.mjs`), WebGL proofs (`check-web*.mjs`, `prove-*.ps1`), promotion (`promote-*.ps1`), Editor review/import (`Review*.cs`, `InstallGltf.cs`, `ImportPassengerLibrary.cs`), and LOD inventory writer (`write-model-lod-inventory.mjs`). | [metro-unity-assets](../../metro-unity-assets/SKILL.md) |
| `tools/unity-web/` | Unity WebGL/Windows build, pack, stage, local serve, and verification (`start-unity.mjs`, `build-windows.mjs`, `pack*.mjs`, `stage-deploy.mjs`, `local-worker.mjs`, `serve-latest-pack.mjs`, `verify-station-game.mjs`, `smoke*.mjs`). | [metro-unity-web](../../metro-unity-web/SKILL.md) |
| `tools/unity-editor-ui/` | .NET WebView2 desktop/Editor UI host (`MetroEditorWebView.csproj`, `Program.cs`) bridging the React shell to native Unity. | [metro-unity-web](../../metro-unity-web/SKILL.md) |
| `tools/unity-windows-bundle/` | Self-contained portable Windows launcher (`StationDesignerLauncher.csproj`, `Program.cs`, `StationDesigner.ico`) packed by `pack-windows-exe.mjs`. | [metro-unity-web](../../metro-unity-web/SKILL.md) |
| `tools/unity-parity/` | TypeScript oracle recorders (`record-*.mjs`), Zoo/Tianhe/save checks (`check-*-gate.mjs`, `check-save-web.mjs`, `save-roundtrip.mjs`), capture diff (`compare-captures.mjs`), and compile check (`check-unity-compile.ps1`). | [metro-unity](../../metro-unity/SKILL.md) |
| `tools/unity-baseline/` | Unity WebGL startup baseline probe (`startup.mjs`). | [metro-unity](../../metro-unity/SKILL.md) |
| `tools/unity-feasibility/` | Headless tick, graph export, render, and startup comparison probes (`Build.cs`, `CheckFixedTicks.cs`, `check-fixed-ticks.mjs`, `export-graph.mjs`, `measure-*.mjs`, `profile-startup.mjs`). | [metro-unity](../../metro-unity/SKILL.md) |
| `tools/sign-icons-source/` | Source pictogram bitmaps (`accessible`, `escalator`, `lift`, `restroom`, `stairs`, `train`) for `prep-sign-icons.py`. | [metro-game-render](../../metro-game-render/SKILL.md) |
| `tools/sign-icons-report/` | Generated pictogram contact sheets (`board.png`, `contact-sheet.png`) from `sign-icons-sheet.py`. | [metro-game-render](../../metro-game-render/SKILL.md) |

## Dev Orchestration, Preview & Audits

| Script | Purpose |
| --- | --- |
| `dev-services.mjs` | `npm start` / `npm run dev:all`: launches `web` (`:5173`), `game` (`:5174`), and `stats` (`:5176`), reusing listening ports; `npm start unity` delegates to `tools/unity-web/start-unity.mjs`. |
| `preview.mjs` | `npm run preview:local` (`:4173`): serves `web/dist` at `/` (`/en/`) and `game/dist` at `/game/` (`/game/en/`, demo routes) on one origin; exports `createPreview()` for `check-demos.mjs`. |
| `serve.mjs` | Static file server (default port `4173`) for viewing generated SVG sheets in a browser. |
| `browser-harness.mjs` | Shared headless-Chrome CDP + static-server driver (`serveDir`, `withPage`, `waitFor`, `loadExampleStation`). |
| `audit-i18n.mjs` | `npm run audit:i18n`: TS-AST audit over `game/src/` and `web/src/` flagging inline human-readable JSX, attribute, `fillText`/`strokeText`, and `drawModelText` strings. |
| `prepare-brand-icon.mjs` | Regenerates `web/src/assets/brand/`, `game/src/assets/brand/`, `stats/favicon.js`, and `stats/brand-mark.js` from `design/icon/station-designer-blue-bold.png`. |
| `demo-video.mjs` | `npm run video:plan` / `npm run video:demo`: CLI entrypoint for the demo-video pipeline (`tools/demo-video/`). |
| `setup-trellis.mjs` | Downloads and SHA-256-verifies local TRELLIS.2 GGUF weights into gitignored `.cache/trellis/models/`. |

## Concept Sheets & Artwork Captures

Owned by [metro-web](../../metro-web/SKILL.md) (and [metro-model](../../metro-model/SKILL.md) for passenger art refreshes).

| Script(s) | Purpose |
| --- | --- |
| `gen-art.mjs`, `iso.mjs` | Regenerates the 11 active bilingual concept sheets (`01`–`07`, `09`, `11`–`13`) under `art/*.svg` (`--en` / `--en-only` writes `*-en.svg`). `iso.mjs` provides the isometric projection and SVG drawing kit. |
| `sheet-i18n.mjs` | English copy table for concept sheets (reuses `game/src/sim/i18n/messages.ts` for exact UI labels; maps `<text>`, Sheet `06` slider `aria-label`s, and live-readout literals). Paired with `--lang en` game captures for sheets `06`, `07`, and `09`. |
| `sheet-01-hero-banded.mjs`, `sheet-01-hero.mjs`, `sheets-a.mjs`, `sheet-03-blocks.mjs`, `sheet-04-modules.mjs` | Generators for sheets `01` (active: `sheet-01-hero-banded.mjs`), `02`, `03`, and `04`. |
| `sheet-05-trains.mjs`, `sheet-06-demand.mjs`, `demand-animation.mjs`, `sheet-07-interface.mjs`, `sheets-c.mjs` | Generators for sheets `05`, `06` (with interactive demand curve), `07`, and `09`. |
| `sheet-11-trains3d.mjs`, `sheets-e.mjs`, `sheet-13-two-line.mjs` | Generators for sheets `11`, `12`, and `13`. |
| `sheet-png.mjs`, `svg-to-png.mjs`, `zoom.mjs` | `sheet-png.mjs` rasterizes one SVG in headless Chrome (`--at <s>`); `svg-to-png.mjs` batch-renders `art/*.svg` → `png/*.png` at 300 DPI via `sharp`; `zoom.mjs` writes a cropped `*-zoom.svg`. |
| `shots.mjs`, `sheet-plan.mjs` | Whole-sheet demo-station screenshot composer and panel layout definitions. |
| `render-piece-views.mjs`, `station-piece-images.mjs`, `piece-views.mjs` | Captures game equipment/circulation models on isometric axes. `--hero --scale 4` writes `.preview/hero-piece-views/` consumed by **both** sheets `01` and `13` (`station-piece-images.mjs`); default writes `.preview/piece-views/` (`piece-views.mjs`). |
| `render-piece-elevations.mjs`, `station-elevations.mjs` | Square-on piece elevations for Sheet `02`. |
| `render-block-cards.mjs`, `render-module-cards.mjs` | Headless-Chrome renders of real game blocks (Sheet `03`) and module cards (Sheet `04`). |
| `render-train-cards.mjs`, `train-cards.mjs`, `train-iso.mjs` | Static `buildTrain` captures and isometric placement helpers for sheets `02`, `05`, `11`, `12`, `13`. |
| `render-train-animation.mjs`, `train-animation.mjs` | Animated door/headlight captures (`.preview/train-animation/`) and placement helpers. |
| `render-ui-shots.mjs`, `render-view-shots.mjs` | Headless-Chrome captures of game UI regions (Sheets `06` & `07`) and camera presets (Sheet `09`). Pass `--lang en` to write `.preview/ui-shots-en/` and `.preview/view-shots-en/` for English sidecars. |
| `render-passenger-cards.mjs`, `passenger-cards.mjs`, `test-passenger-animation.mjs` | Captures clothed passenger sprites for sheets `01`, `02`, `12`, `13` and verifies animated SVG gait frames. |
| `refresh-model-art.mjs` | `npm run art:models`: end-to-end passenger bake → captures → bilingual sheets `01`/`02`/`07`/`12`/`13` → PNG previews → `web` build. |
| `render-menu-thumbnails.mjs`, `game-tiles.mjs` | Generates checked-in 132 px build-rail PNGs (`game/public/module-thumbnails/`) and writes review tiles to `.preview/game-tiles/`. |
| `render-sign-panel.mjs`, `render-tv-plate.mjs` | Renders production sign-board and TV service-plate canvases to PNG for visual inspection. |

## Asset Bakes, Audio & City Branding

| Script(s) | Purpose | Owning skill |
| --- | --- | --- |
| `bake-soft-passengers.mjs`, `passenger-source-lf.mjs` | `npm run bake:passengers`: bakes the 440 soft-human walking/activity atlases (`game/src/assets/passenger-approved.json`, `passenger-activities.json`) and normalizes provenance hashes. | [metro-model](../../metro-model/SKILL.md) |
| `bake-passengers.mjs`, `measure-passenger-assets.mjs` | CC0 base passenger baker (`passenger-human.json`) and packed/GPU byte-budget inventory tool. | [metro-model](../../metro-model/SKILL.md) |
| `passenger-{anime,bake-geometry,capture-plan,hair,low-topology}.mjs` | Shared geometry, hair, Low-LOD topology, and capture-batch helpers for passenger bakes. | [metro-model](../../metro-model/SKILL.md) |
| `bake-demo-station.mjs` | Re-bakes `game/src/data/demo-station.json` from an authored `metro-save` envelope. | [metro-game](../../metro-game/SKILL.md) |
| `bake-street-tree.mjs`, `bake-street-tree-lod.mjs` | Bakes street ash tree geometry and derived Low LOD under `game/src/assets/trees/`. | [metro-game](../../metro-game/SKILL.md) |
| `prepare-game-audio.mjs`, `collect-game-music.py` | Bakes interaction WAVs (`game/public/audio/`) and collects full background music MP3s + manifests (`game/public/audio/music/`). | [metro-model](../../metro-model/SKILL.md) / [metro-game](../../metro-game/SKILL.md) |
| `prep-posters.py`, `prep-sign-icons.py`, `sign-icons-sheet.py` | Prepares deterministic WebP poster catalogues and sign-board pictograms + contact sheet. | [metro-game-render](../../metro-game-render/SKILL.md) |
| `trace-{chengdu,chongqing,nanjing,wuhan}-branding.py` | Traces city transit emblem references into vector contours for city-style branding. | [metro-game-render](../../metro-game-render/SKILL.md) |

## Headless Browser Checks (`check-*.mjs`)

Owned by [metro-game-test](../../metro-game-test/SKILL.md) unless noted. Most require `npm --prefix game run build` first.

| Family | Scripts |
| --- | --- |
| City styles | `check-city-styles.mjs`, `check-beijing-style.mjs`, `check-chengdu-style.mjs`, `check-chongqing-style.mjs`, `check-nanjing-style.mjs`, `check-shanghai-style.mjs`, `check-wuhan-style.mjs` |
| Geometry, ceilings, slicing & walls | `check-ceiling-floor.mjs`, `check-ceiling-wall-faces.mjs`, `check-exploded-view.mjs`, `check-level-retention.mjs`, `check-platform-floor.mjs`, `check-tanwei-raised-floors.mjs`, `check-wall-cuts.mjs` |
| Snapping, picking & ramps | `check-geometry-snapping.mjs`, `check-ramp-block-placement.mjs`, `check-ramp-fit.mjs`, `check-tool-picking.mjs` |
| LOD, batching, atlas & static rendering | `check-editor-move-caches.mjs`, `check-equipment-lod.mjs`, `check-geometry-detail.mjs`, `check-panel-atlas.mjs`, `check-passenger-lod.mjs`, `check-preview-lod.mjs`, `check-render-batching.mjs`, `check-static-rendering.mjs`, `check-transport-lod.mjs` |
| Game passengers & ramp animation | `check-approved-crowd.mjs`, `check-game-passenger-activities.mjs`, `check-game-passenger-handedness.mjs`, `check-game-passenger-library.mjs`, `check-game-passenger-size.mjs`, `check-game-ramp-animation.mjs` |
| Soft-human & sound studio ([metro-model](../../metro-model/SKILL.md)) | `check-soft-arm-poses.mjs`, `check-soft-escalator-pose.mjs`, `check-soft-human.mjs`, `check-soft-human-activities.mjs`, `check-soft-human-casual.mjs`, `check-soft-human-clearance.mjs`, `check-sound-preview.mjs` |
| Roads & signs | `check-road-network.mjs`, `check-road-placement.mjs`, `check-road-vehicles.mjs`, `check-sign-history.mjs`, `check-sign-preview.mjs`, `check-sign-save.mjs` |
| UI, audio, themes, demos & perf tools | `check-demos.mjs`, `check-game-audio.mjs`, `check-game-music.mjs`, `check-game-themes.mjs`, `check-game-tutorial.mjs`, `check-info-panel.mjs`, `check-perf-tools.mjs` |
| Stats & WASM checks | `check-stats-reports.mjs` ([metro-stats](../../metro-stats/SKILL.md)), `check-wasm-routing.mjs` ([metro-wasm-experiment](../../metro-wasm-experiment/SKILL.md)) |

## Benchmarks & Profiling (`bench-*.mjs`, `profile-sim.mjs`)

See [perf-benchmarks.md](perf-benchmarks.md) for flags, environment variables, and hardware capture rules.

| Family | Scripts |
| --- | --- |
| Simulation & routing | `bench-demos.mjs`, `bench-sim.mjs`, `bench-crowd-routing.mjs`, `bench-passenger-activities.mjs`, `profile-sim.mjs` |
| Playback, demo load & exploded view | `bench-browser.mjs`, `bench-sim-stalls.mjs`, `bench-demo-load.mjs`, `bench-exploded-view.mjs`, `bench-explode-generation.mjs`, `bench-explode-snapshot.mjs`, `bench-explode-memory.ps1`, `bench-usage-tour.mjs` |
| Action matrix & placement latency | `bench-editor-actions.mjs`, `bench-placement-latency.mjs`, `bench-drag-latency.mjs`, `bench-block-commit.mjs`, `bench-block-drag.mjs`, `bench-block-edit-audit.mjs` |
| Tool drags & specialized audits | `bench-curtain-preview.mjs`, `bench-fence-drag.mjs`, `bench-level-switch.mjs`, `bench-menu-thumbnails.mjs`, `bench-outdoor-surfaces.mjs`, `bench-passenger-lod.mjs`, `bench-population-edit.mjs`, `bench-preview-audit.mjs`, `bench-road-drag.mjs`, `bench-roof-drag.mjs`, `bench-settings-audit.mjs`, `bench-stair-drag.mjs`, `bench-transport-lod.mjs`, `bench-tree-placement.mjs` |
| Shared perf helpers & budgets | `equipment-low-budgets.mjs`, `perf-fixture.mjs`, `perf-stats.mjs`, `placement-benchmark-targets.mjs`, `update-editor-action-matrix.mjs` |

## Tracked Scratch Helpers (`_*.mjs`)

`_crop.mjs`, `_fill.mjs`, `_poly.mjs`, `_probe-sweep.mjs`, `_strings.mjs` —
ad-hoc SVG/DOM inspection and geometry probing helpers.
