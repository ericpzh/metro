# Benchmarks & profiling commands

Verified commands and protocols for Web (Three.js) and Unity 6 URP performance
measurement. See [performance.md](performance.md) for engineering rules,
[perf-web.md](perf-web.md) for web contracts, and
[perf-unity.md](perf-unity.md) for Unity contracts.

## Capture protocol

- **Isolate runs**: Run production builds (`npm --prefix game run build` or
  Unity `Release` builds) with zero concurrent builds, tests, or profilers.
- **Hardware GPU**: Use hardware GPU rendering (`METRO_BROWSER_GPU=hardware` for
  Unity WebGL verifiers; default hardware ANGLE for web browser benchmarks).
  Never publish `--software-gpu`, profiled, or incomplete captures to shared
  matrices.
- **Separate instrumentation**: Collect clean timings, CPU profiles, and Chrome
  traces in separate runs.
- **Shared playback presets** (`bench-sim-stalls.mjs`, `/benchmark`, and
  `/game/unity/benchmark`): 30 s at 16× speed, 2/3 camera-distance factor —
  Regular Zoo (ground hidden at `−15 m`, TOP/N/W corner), Regular Tanwei
  (default opening level, Hide UI), Regular Tianhe (`−5 m` concourse, isometric
  camera).

## Web (Three.js) commands

### Deterministic tests & tool smoke checks

| Purpose | Command |
| --- | --- |
| Performance/LOD/batching/cache unit pins | `npm run test:perf` |
| Train LOD table & swap pins | `node --test game/test/train-lod.test.mjs` |
| Sparse routing & Tianhe departure pins | `node --test game/test/sparse-routing.test.mjs` |
| Chrome CDP profiler & trace smoke check | `npm run check:perf-tools` |
| WebGL catalogue High/Low contact sheets | `npm run check:equipment-lod` |
| Geometry detail & passenger LOD checks | `npm run check:geometry-detail`, `npm run check:passenger-lod` |
| Cross-module batching & multi-draw fallback | `npm run check:render-batching` (direct: `node tools/check-render-batching.mjs --no-multi-draw`) |
| Single-pick, snapping, city & exploded checks | `node tools/check-tool-picking.mjs`, `node tools/check-geometry-snapping.mjs`, `node tools/check-city-styles.mjs`, `node tools/check-exploded-view.mjs` |

### Simulation & browser benchmarks

| Workload | Command & key options |
| --- | --- |
| Headless sim across all 3 demos | `npm run bench:sim` (`BENCH_TICKS`, `BENCH_EDITS`, `BENCH_STATION`) |
| Node V8 CPU profile of sim | `npm run profile:sim` (writes `.cpuprofile` under `.preview/perf/`) |
| Sparse vs legacy routing comparison | `node tools/bench-crowd-routing.mjs --sparse` / `--legacy` (`BENCH_OUTPUT`) |
| Production browser FPS & edits (3 demos) | `npm run bench:browser` / `npm run profile:browser` (`BENCH_SECONDS`, `BENCH_EDITS`, `BENCH_STATION`) |
| Playback 1% low & frame tails | `npm run bench:sim-stalls` (`BENCH_DEMO=zoo\|tanwei\|tianhe`, `BENCH_MODE=regular\|explode`, `BENCH_QUALITY=low\|high`, `BENCH_SPEED=1\|4\|16\|64`, `BENCH_SECONDS`, `BENCH_CANVAS_SIZE=w,h`, `BENCH_PIXEL_RATIO`, `BENCH_PROFILE=1`, `BENCH_TRACE=1`, `BENCH_ABLATE=plates\|atlas\|render\|crowd\|chunks\|modules\|station`) |
| Station open + exploded view & memory | `npm run bench:demo-load` (`BENCH_DEMOS`, `BENCH_QUALITY`, `BENCH_ABLATE=trains\|buildViews`, `BENCH_PROFILE=1`) |
| Editor action matrix (API-to-render) | `npm run bench:editor-actions` (`--list`, `--record-only`, `--profile`, `--software-gpu`; `BENCH_DEMO`, `BENCH_CASE`, `BENCH_SAMPLES`, `BENCH_MATRIX_UPDATE=0`, `BENCH_RESUME=1`) |
| Real-pointer placement & block commits | `npm run bench:placement`, `npm run bench:block`, `npm run bench:block-edits`, `npm run bench:block-drag` |
| Road, stair, level & usage-tour probes | `npm run bench:road`, `npm run bench:stair`, `npm run bench:levels`, `npm run bench:usage-tour` |
| Fence, outdoor surface, tree & audits | `node tools/bench-fence-drag.mjs`, `node tools/bench-outdoor-surfaces.mjs`, `node tools/bench-tree-placement.mjs`, `node tools/bench-settings-audit.mjs`, `node tools/bench-preview-audit.mjs` |
| Exploded snapshot, generation & memory | `npm run bench:explode`, `node --expose-gc tools/bench-explode-snapshot.mjs <save>`, `node tools/bench-explode-generation.mjs <save>`, `./tools/bench-explode-memory.ps1 <save>` |

### Interactive web benchmark route & WASM comparison

- Open `/benchmark` (Chinese) or `/benchmark/en` (English) — under `/game/` in
  production (`https://stationdesigner.com/game/benchmark`).
- For the opt-in Rust/WASM A* routing comparison, build with
  `npm --prefix game run build:game:wasm`, serve with
  `npm --prefix game run preview:wasm`, and toggle TypeScript vs WebAssembly on
  localhost `/benchmark`.

## Unity 6 URP commands

### Live Editor EditMode & PlayMode performance suites

Run via `unity/scripts/metro-editor.ps1 test -Mode <EditMode|PlayMode> -TestFilter <Filter>`:

| Suite / filter | Mode | Coverage |
| --- | --- | --- |
| `StationSparseRoutingTests` | EditMode | Tianhe Park sparse vs legacy routing & cold-start departure |
| `StationServiceFrameTests` | EditMode | Peak-rush simulation & route profile (`TianheParkPeakRushSimulationAndRouteProfile`) |
| `StationLocalEditTests` | EditMode | Local edit latency, fallbacks & renderer inventory |
| `StationExplodedLayoutTests` | EditMode | Exploded-view build time, renderer count & round-trip memory |
| `StationExplodedViewPlayTests` | PlayMode | Interactive exploded-view open/select/close round trip |
| `StationVisibilityTests` | EditMode | Incremental Q/E level switches & non-active storey LODs |
| `StationModelLodTests` | EditMode | 3-tier profiles, non-active step-down & train/rail LOD ranges |
| `StationFsrSettingsTests` | EditMode | Runtime FSR 1.0 settings & bridge persistence |
| `StationCrowdStateTests` | EditMode | Crowd animation skipping & fixed `localBounds` |
| `StationBenchmarkRecorderTests` | EditMode | Native frame recorder commands & `-benchmark` route parsing |
| `StationRoadTests` | EditMode | Lane-scaled traffic signals & capacity-metered arrivals |

### WebGL Release build, verify & benchmark route

```powershell
# Build public WebGL pack (StationGameLocal.unity)
npm run build:unity -- --scene StationGameLocal

# Stage Brotli-compressed <=20 MiB chunks & deploy /game/unity/* (/game/unity/benchmark)
npm run stage:unity
npm run deploy:unity
npm run test:unity

# Hardware-GPU WebGL verifier (model-detail playback & optional load-probe markers)
$env:METRO_BROWSER_GPU = 'hardware'
$env:METRO_STATIC_SERVER = '1'
node tools/unity-web/verify-station-game.mjs .preview/unity/<run> --packed <pack-dir> `
  --demo zoo --locale en --timeout-ms 180000 --only model-detail-performance
# Add --load-probe for allocation/Wasm-growth markers; add --sample-speed 16 --sample-profile low
# to isolate a single Tianhe Park sample in a fresh browser session.
```

### Windows standalone `.exe` & automated hardware benchmark

```powershell
# Build single-file portable Windows player (.preview/unity/StationDesigner.exe)
npm run build:unity:windows

# Launch interactive in-app benchmark UI directly (uses StationBenchmarkRecorder)
".preview/unity/StationDesigner.exe" -benchmark          # add --en for English; -metroLoadProbe for load markers

# Automated hardware block-edit & model-detail playback suite via live Editor CLI
unity --no-banner --no-pager --format json command --project-path "$PWD/unity" --timeout 20 `
  metro player_benchmark_start --exe <path-to-MetroStation.exe> `
  --out-path .preview/unity/<report>.json --demos zoo,tanwei,tianhe --model-detail true
```

### Unity LOD inventory regeneration

```powershell
unity --no-banner --no-pager --format json command --project-path "$PWD/unity" --timeout 180 metro model_lod_inventory
node tools/unity-assets/write-model-lod-inventory.mjs --strict
```
