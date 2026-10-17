# Performance work in metro

## Reproduce the reported interaction

Measure the actual event sequence before choosing an optimization. For a drag,
separate hover, pointer-down, first movement, continued movement, release and
cancel. Compare the first invocation with warmed repetitions. A smooth steady
drag can hide a long initialization stall; placement-helper timings alone do not
measure the pointer handler or the first rendered frame.

Use the supplied station through `BENCH_STATION` without replacing the shipped
demo. `node tools/bench-stair-drag.mjs` drives real browser input and counts
raycasts on initial stair-block pickup. `bench:sim` measures CPU helpers and
simulation; `bench:browser` measures the app, worker and rendered frames.

Record work counts alongside time: raycasts per event, graph/model rebuilds,
allocations, uploads and cache hits. The stair-block regression came from
`modules.find(m => m.id === pickModule(...))`: a miss repeated a full scene
raycast for every document entry. Pick once, then find the document entry by ID.
Test both a miss and a hit near the end of a realistically large module list.

## Keep interactive work bounded

- Hoist event-invariant queries out of loops and predicates. Reuse the hit,
  camera aim and document indexes throughout the event.
- Keep previews out of undo/commit and worker routing paths. Stair-block previews
  are explicitly visual-only; validate on release and commit the accepted run
  once. Other tools retain their existing preview/refusal agreement unless a
  behavior change is authorized.
- Coalesce replaceable pointer previews per frame; flush before release and
  cancel stale callbacks on cancellation, tool changes or unmount. Preserve all
  samples for deletion sweeps and touch gestures that depend on the path.
- Retain unaffected geometry and GPU allocations. Move pickup/cancel masks the
  lifted piece and restores neighbours without rebuilding the station.
- Key prepared data by immutable document inputs and test invalidation. Bound
  caches that retain GPU resources and verify disposal on eviction and teardown.
- Preserve picking IDs, storey visibility, material ownership, animation and
  geometry. Hidden drawing must not change simulation ticks, RNG, train dispatch,
  routes or passenger identity.

## Collect comparable evidence

Run benchmarks sequentially, without builds, tests or other profilers competing
for the host. Use distinct `BENCH_OUTPUT` paths for baseline, final and profiled
runs. Record fixture counts, population, seed, hardware, browser, viewport, storey,
duration, edit count and GPU backend. Changed assets or camera/population are not
a controlled FPS comparison; use the browser harness's paired batching mode for
that question.

Separate CPU submission, asynchronous GPU time and presentation delay. CPU
sampling and Chrome tracing are separate collectors. Discard disjoint or stale
GPU queries. Buffer upload counters exclude textures and uniforms. Capture
console/shader/runtime failures rather than accepting timings from a broken render.

Use `profile:sim` for V8 CPU samples and `profile:browser` for Chrome CPU/trace
exports and GPU diagnostics. Separate application startup, opening a save, cold
resource creation and cache reuse; local HTTP startup is not a WAN measurement.

### Per-model geometry detail inventory

Triangle counts below are for one model built from each palette option's default configuration. High is the full model geometry; Low uses the renderer's reduced geometry wherever that model part has a supported approximation, and keeps unsupported parts at full detail. These are model triangles, not totals across all placed copies. Width, length, style and material controls can create additional variants; the table lists the 117 shipped palette options.

Regenerate with `node tools/model-triangle-inventory.mjs`; the JSON and Markdown
table go to ignored `.preview/perf/model-triangles.{json,md}`. The authored Low
variants remove shelf stock, cubicle interiors and fine hardware; keep simplified
sink/CCTV/AC silhouettes, track sleepers/rails, ramp bands, lift doors and stair
surfaces. Source picks and rigs stay exact. `model-detail` guards per-model triangle
budgets, batching, restoration, finish colours and disposal. Update this table and
`game/PERFORMANCE.md` together after changing models or the detail policy.

| Equipment / decor model name | Low triangles | High triangles |
|---|---:|---:|
| tree | 1353 | 18432 |
| shelf-cooler | 420 | 9852 |
| shelf-cooler-dark | 420 | 9852 |
| bridge | 788 | 9588 |
| shelf-white-tall | 240 | 7556 |
| shelf-dark-tall | 240 | 7244 |
| shelf-wire | 412 | 6524 |
| cubicle | 84 | 5688 |
| cctv-dome | 360 | 5208 |
| walkway | 496 | 5162 |
| sink | 224 | 4972 |
| cctv-ptz | 332 | 4924 |
| shelf-white-short | 192 | 4420 |
| escalator | 394 | 3122 |
| ac-unit | 140 | 2924 |
| stair-leftForward | 1016 | 2192 |
| stair-rightForward | 1016 | 2192 |
| stair-left180 | 968 | 2144 |
| stair-right180 | 968 | 2144 |
| stair-centerForward | 920 | 2096 |
| stair-left90 | 920 | 2096 |
| stair-right90 | 920 | 2096 |
| clock | 1870 | 1940 |
| cctv | 124 | 1888 |
| stair-straight | 620 | 1796 |
| lift | 468 | 1488 |
| electrical-cabinet | 36 | 1224 |
| extinguisher-glass | 822 | 918 |
| exit-covered-1 | 902 | 902 |
| exit | 902 | 902 |
| exit-covered-3 | 902 | 902 |
| tactile-warning | 12 | 812 |
| fence-iron | 768 | 768 |
| checkout | 750 | 750 |
| gate-new | 720 | 720 |
| rail-signal | 708 | 708 |
| vending | 676 | 676 |
| gate | 540 | 668 |
| desk | 652 | 652 |
| pillar-thick | 576 | 576 |
| exit-uncovered-2 | 554 | 554 |
| exit-uncovered-3 | 554 | 554 |
| exit-uncovered-1 | 530 | 530 |
| fence-gate | 432 | 432 |
| roof-tapered | 396 | 396 |
| tvm | 372 | 372 |
| busstop-long | 372 | 372 |
| fence | 360 | 360 |
| door-steel-1 | 324 | 324 |
| door-glass-1 | 324 | 324 |
| roof-truss | 264 | 264 |
| busstop-short | 260 | 260 |
| light-circular | 256 | 256 |
| monitor-wall | 213 | 213 |
| lawn | 12 | 204 |
| bin | 196 | 196 |
| vent | 168 | 168 |
| bench-seat-1 | 156 | 156 |
| extinguisher | 146 | 146 |
| extinguisher-compact | 146 | 146 |
| door-wood-1 | 144 | 144 |
| sidewalk | 12 | 132 |
| tv | 114 | 114 |
| noise-barrier | 108 | 108 |
| noise-barrier-half | 108 | 108 |
| traffic-light | 108 | 108 |
| bench-steel-1 | 84 | 84 |
| sign-ceiling | 74 | 74 |
| monitor-ceiling | 72 | 72 |
| tactile-guide | 60 | 60 |
| guidepost | 60 | 60 |
| curtain-wall | 60 | 60 |
| glass-1x1 | 60 | 60 |
| glass-2x1 | 60 | 60 |
| glass-3x1 | 60 | 60 |
| glass-1x2 | 60 | 60 |
| glass-2x2 | 60 | 60 |
| glass-3x2 | 60 | 60 |
| exit-virtual | 60 | 60 |
| psd-end | 58 | 58 |
| road | 50 | 50 |
| stair-block | 34 | 48 |
| billboard-wide | 40 | 40 |
| billboard-standard | 40 | 40 |
| billboard-large | 40 | 40 |
| billboard-panorama | 40 | 40 |
| billboard-portrait | 40 | 40 |
| billboard-square | 40 | 40 |
| linemap-stand | 40 | 40 |
| hanger-roof | 36 | 36 |
| hanger-post | 36 | 36 |
| pillar-slim | 36 | 36 |
| linemap-wall | 26 | 26 |
| exit-doorway-1 | 26 | 26 |
| exit-doorway-2 | 26 | 26 |
| exit-doorway-3 | 26 | 26 |
| exit-doorway-4 | 26 | 26 |
| roof-shell | 24 | 24 |
| noise-barrier-railing | 24 | 24 |
| light-rectangular | 24 | 24 |
| roof | 12 | 12 |
| floor-mark-boarding | 2 | 2 |
| floor-mark-waiting | 2 | 2 |
| floor-mark-direction | 2 | 2 |
| sign-wall | 2 | 2 |
| calligraphy-kai-h | 2 | 2 |
| calligraphy-kai-v | 2 | 2 |
| calligraphy-xing-h | 2 | 2 |
| calligraphy-xing-v | 2 | 2 |
| calligraphy-li-h | 2 | 2 |
| calligraphy-li-v | 2 | 2 |
| calligraphy-wei-h | 2 | 2 |
| calligraphy-wei-v | 2 | 2 |
| calligraphy-hei-h | 2 | 2 |
| calligraphy-hei-v | 2 | 2 |
| calligraphy-song-h | 2 | 2 |
| calligraphy-song-v | 2 | 2 |

## Guard the cause and verify the result

Prefer deterministic assertions about work and correctness: one scene pick per
press, no preview commit, one release commit, retained allocation identity,
cache invalidation, bounded dormant entries and exact disposal. Do not use FPS or
wall-clock thresholds in Node tests. Retain placement, route and geometry checks
so an apparent speedup cannot come from missing work or invisible content.

Run focused regressions and `npm run test:perf` for source coverage. Inspect the
changed files' line/function/branch results; imported files inflate totals, and
Node coverage does not prove GPU behavior. Run the full game suite and production
build before committing implementation changes. For renderer changes, use
`check:render-batching`, its `--no-multi-draw` fallback and `check:perf-tools` as
appropriate; browser checks assert correctness rather than FPS.

Record results and limitations in `game/PERFORMANCE.md`, including remaining cold
stalls, unchanged throughput and unrelated validation failures. Keep raw JSON,
screenshots, CPU profiles and traces under ignored `.preview/perf/`. Never weaken
an asset-integrity assertion or change generated provenance merely to make a
performance change's test run green.
