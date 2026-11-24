# Tianhe Park Three.js performance plan

Apply the useful parts of Unity Plan 38 to the browser game in `game/src`. Prioritize the work that improves Tianhe Park at 16× in Regular and Exploded view while preserving service outcomes, the existing High and Low detail policies, and editor responsiveness. The original browser game already has a simulation worker, an instanced passenger atlas, retained equipment batches, and a live panel atlas. Build on those paths. [Web performance contracts](../.agents/skills/metro-repo/references/perf-web.md)

## Baseline and order of work

The recorded Three.js native-resolution runs on a 60 Hz display give the following starting points. Use the values as historical context and recapture the current revision before allocating work to a subsystem. The desktop Unity profile supplies hypotheses about where to look. [Benchmark matrix](../.agents/skills/metro-repo/references/perf-benchmark-matrix.md)

| Tianhe case | Average FPS | 1% low FPS | Worst frame |
| --- | ---: | ---: | ---: |
| Regular Low | 37.45 | 16.05 | 90 ms |
| Regular High | 18.76 | 10.39 | 142 ms |
| Exploded Low | 25.14 | 1.97 | 792 ms |
| Exploded High | 23.33 | 1.81 | 766 ms |

1. Capture clean timings and separate profiles for warm 16× playback, opening, and peak crowd paused. Identify whether the Exploded frame tails occur during deferred prop generation, scene submission, worker delivery, texture uploads, or steady playback.
2. Implement the highest-cost independently verified change among worker message copies, TV refresh, and redundant presentation writes. Compare the same workload after each change.
3. Run the simulation and geometry experiments independently. Consider adaptive crowd updates and audio cadence only where the preceding comparisons leave a measurable cost. Keep changes to scheduling policy, visual quality, and asset content independently reversible.

## 1. Reduce worker publication copies

The worker slices the agent and density buffers before posting them. It transfers route points already. The main thread retains the latest frame for renderer recreation and feeds Regular and Exploded consumers. It also adopts statistics and append-only history. [Worker publication](../game/src/sim/worker.ts) · [Protocol](../game/src/sim/protocol.ts) · [Consumer](../game/src/app/store/slices/SimSlice.ts)

- Measure bytes per channel, allocation and clone time, message age at adoption, and renderer packing. Start by transferring only message-owned typed arrays. Preserve the worker's reusable scratch arrays and any arrays owned by the world or graph. Keep the current payload shape for that comparison.
- If density copies dominate, add explicit demand for the density overlay. Enabling it while paused must request a fresh snapshot for the current graph, including after rebuild, undo, or a station switch. Keep density aligned to the graph revision used for node coordinates.
- Introduce buffer recycling only if transfers leave allocation pressure. Define ownership across the worker, latest-frame replay, interpolation, and statistics. Return buffers only after the final consumer releases them. Test the lifetime by holding old frames across worker ticks and close/reopen transitions.
- For any change that coalesces visual frames, keep history resets and appends, route tokens, and current metrics reliable. Fence visual frames and graph data by station generation and revision. Consume one consistent pose/clock bundle per renderer update. Interpolate adjacent ticks and snap across gaps or epoch changes. Keep the current timing policy for the transport comparison.
- The worker currently advances one fixed simulation tick per timer callback. If the baseline falls short of the requested rate, investigate timer drift and tick cost separately. Any scheduling change must keep one simulated second per tick, define bounded catch-up and pause/speed boundaries, and report missed deadlines. Preserve command order across build, load, seek, restart, and undo/redo.

## 2. Reduce display repaint and atlas work

The browser already paints canvases. The remaining work is CPU drawing, checking all TV content, atlas pixel reads, and GPU patches. The atlas retains CPU pages, compares dirty pixels, and budgets live uploads. [Clock system](../game/src/render/scene/systems/ClockSystem.ts) · [TV and sign system](../game/src/render/scene/systems/PlateSystem.ts) · [Panel atlas](../game/src/render/panelAtlas.ts)

- Profile TV lookup, status selection, canvas drawing, and atlas work separately. Replace each TV's repeated list search with a retained lookup or binding keyed by the immutable module source. Invalidate nearest-track and service associations for rail, platform-edge, line, and TV changes. Cache the fields that actually affect printed content, including locale, station name, date, and schedule status.
- If clock drawing is measurable, share a CPU calendar strip within a renderer for matching date, locale, font/style, and dimensions. Keep the existing textures and atlas slots stable. For TV and clock panels, queue only the latest content per panel and prioritize visible panels while ensuring visible work eventually drains. Refresh a hidden panel from the current state when it becomes visible. Keep poster rotation and rail signals on their existing schedules.
- Verify distinct simultaneous TV faces, paused seek and midnight rollover, locale and line renames, font or artwork readiness, and settings edits while paused. Exercise atlas removal and slot reuse, context restoration, and close/reopen. Keep hover clocks synchronized with placed clocks and retain the one-live-panel GPU upload budget unless profiling and browser checks justify changing it.

## 3. Skip unchanged presentation writes

Measure the number of applied transforms and buffer writes in the frame loop at peak crowd, after interpolation settles, and during a paused camera move. [Frame loop](../game/src/render/scene/SceneRenderer.ts) · [Trains and PSDs](../game/src/render/scene/systems/TrainSystem.ts) · [Lifts and escalators](../game/src/render/scene/systems/LiftSystem.ts) · [Crowd and gates](../game/src/render/scene/systems/CrowdSystem.ts)

- Keep ingesting the authoritative samples. Skip a transform or attribute write when the resolved pose is unchanged. Preserve final interpolation endpoints and both door banks. Resync on reveal, rebind, seek, resume, service-sequence change, and return from Exploded view. Test the first visible frame and its successor.
- Reuse the current paused crowd cache and High/Low instance buffers. If packing is expensive, cache stable per-identity attributes and static support lookups, and update only the affected instance ranges where measured upload cost warrants it. Invalidate for graph or document replacement, reveal, support changes, tier changes, and pool-slot reuse. Resolve train, lift, and ramp support from the current state.
- If crowd GPU cost dominates, experiment with spatial culling or reduced update cadence for distant instances. Preserve atlas pose phase, visible IDs, tint and opacity, active-storey and Hide UI detail policy, selection, and eye view. Give visible actors a bounded time to refresh and force a fresh pose on reveal, activity change, and follow. Compare Regular and Exploded paths. Existing browser atlas animation is the reference for appearance and activity coverage. [Exploded passenger support](../game/src/render/explodedPassengers.ts)

## 4. Optimize simulation hot loops with exact replay

`World` already uses typed arrays for collision grids and density. Sparse routing also has per-tick occupancy and reverse-tree reuse. Profile the browser worker and Node simulation independently and improve the remaining measured work. [World](../game/src/sim/world/World.ts) · [Sparse routing](../game/src/sim/sparseRouter.ts)

- If congestion pricing or collision scans are hot, compare precomputed node-to-cell indexes or stamped touched-cell buffers with the current implementation. Rebuild mappings on graph or grid changes. Preserve negative coordinates, storey bands, half-step landings, collision traversal order, and crowd counters. Include empty, edge-of-grid, and dense cases.
- If sparse routing dominates, optimize scratch allocation, repeated node scans, or exact cache reuse. Key reuse by all relevant topology and cost inputs, including remote gate/lift waits and excluded services. Preserve RNG draws, tie-breaks, work budgets, and the tick each route/refill becomes available. Test any proposed warmup changes as a separate experiment.
- Compare baseline and candidate for a fixed seed and command sequence at equal ticks. Require identical passenger IDs and poses, route readiness and paths, queue entries/exits, train arrivals and dispatch, and statistics/history, excluding elapsed-time instrumentation fields. Include a live local edit and undo/redo and both Tianhe departure waves. Keep the existing sparse-routing queue and fallback assertions. [Determinism tests](../game/test/determinism.test.mjs) · [Sparse routing tests](../game/test/sparse-routing.test.mjs)

## 5. Reduce scene submission and Exploded frame tails

The browser already batches static equipment, instances paving, and uses a light rig without shadow maps. Target the Three.js costs shown by draw counts and long frames. [Equipment batches](../game/src/render/equipmentBatches.ts) · [Surface batches](../game/src/render/surfaceBatches.ts) · [Exploded view](../game/src/render/explodedView.ts) · [Light rig](../game/src/render/scene/lightRig.ts)

- Use the existing benchmark ablations to identify high-draw families and heavy batch construction. Trial batching remaining opaque fixed housings or supports through the current equipment path. Keep moving doors, steps, and transparent pieces under their current owners. Compare tile sizes and thresholds against culling, draw calls, triangle counts, and retained edit cost.
- If Exploded prop construction drives the long tail, measure structural readiness and the time until equipment is fully ready separately. Split the expensive work into resumable chunks under the existing structure-first handoff. Preserve the single resident renderer and floor-drag transform path. Cancel queued work on close or station switch and verify repeated open/close and memory recovery.
- Preserve storey and section clipping, logical module IDs, selection highlights, transparent order, and picking and preview behavior. Keep one pick per pointer event. Preview work stays outside document edits, history, and the simulation worker. Exercise retained add/remove/move/cancel/undo/redo, including the multi-draw fallback. [Batch lifecycle tests](../game/test/batching-lifecycle.test.mjs) · [Exploded tests](../game/test/exploded-view.test.mjs)

## 6. Keep React and ambient audio work bounded

The TypeScript game delivers binary pose buffers and derives state locally. Its viewport already detaches the ambient frame callback when muted. [Store adoption](../game/src/app/store/slices/SimSlice.ts) · [Viewport audio](../game/src/app/Viewport.tsx) · [Audio frame construction](../game/src/render/scene/SceneRenderer.ts)

- Profile metrics, history adoption, and React renders independently of pose delivery. Retain frame subscribers for render-only data. If UI work dominates, reduce redundant store updates while preserving live clock, selection, arrival and history notifications and reset semantics.
- Compare the existing fast-forward ambient cadence with a lower cadence only when audio frame construction shows up in the profile. Preserve one-shot cues, spatial response during camera or tray movement, and immediate ambient refresh after mute, view changes, and station replacement. Compare muted and audible runs separately. [Audio tests](../game/test/audio.test.mjs)

## Verification and acceptance

The first clean capture can use the following PowerShell commands from the repo root. Change the mode to `explode` and quality to `high` for the other Tianhe cases. Use a distinct output path for each repetition.

```powershell
$env:BENCH_DEMO = 'tianhe'
$env:BENCH_MODE = 'regular'
$env:BENCH_QUALITY = 'low'
$env:BENCH_SPEED = '16'
$env:BENCH_SECONDS = '30'
$env:BENCH_CANVAS_SIZE = '1600,900'
$env:BENCH_PIXEL_RATIO = '1'
$env:BENCH_PROFILE = '0'
$env:BENCH_TRACE = '0'
$env:BENCH_ABLATE = ''
$env:BENCH_OUTPUT = '.preview/perf/threejs-tianhe/baseline-regular-low-1.json'
npm run bench:sim-stalls
```

- Use the tracked `tools/bench-sim-stalls.mjs` and the existing browser and worker profiling commands. Rebuild from recorded source revisions and run serially with a fresh browser session, hardware GPU, 1600×900 canvas, DPR 1, native resolution, fixed camera, and matched audio settings. Capture three clean runs per case with profiles and ablations in separate runs. Record browser, hardware, refresh rate, build revision and the actual playback window. [Benchmark protocol and commands](../.agents/skills/metro-repo/references/perf-benchmarks.md)
- Cover Tianhe Regular/Exploded in Low/High for 30 s at 16×. Include peak-crowd pause, a camera orbit, and an Exploded open/close. Run Zoo and Tanwei in both views to guard smaller stations. Capture a 1× presentation check. Verify 64× separately before claiming throughput at that speed.
- Record submitted-frame and rAF timings separately. Compare average FPS, 1% low, p95/p99, worst frame, draw calls, and peak JS and process memory. Visible workload must match at fixed ticks and camera positions. In the publication check, count executed worker ticks separately from delivered and rendered snapshots. Expect about **480 ticks in 30 s** at 16×, scaled to the actual window, with at most one tick of sampling uncertainty per endpoint. Report timer misses and publication lag. A run with less simulation work can diagnose a bottleneck and cannot establish an FPS gain.
- For a 60 Hz display, aim for **55 FPS average and 30 FPS 1% low** in Tianhe Low after the first profile. These are browser targets to validate separately in Regular and Exploded. Meet the existing minimum **15 FPS 1% low** in Low Regular. Require improvement on the targeted Tianhe frame costs and no material regression outside measured variance in High, Zoo, Tanwei, peak memory, or station opening. Keep editor feedback strictly below the existing **100 ms** budget and verify it independently of worker install time.
- Run `npm --prefix game run typecheck`, `npm run test:game`, and `npm run test:perf`. Use focused deterministic tests for changed behavior and browser checks for WebGL, picking, artwork, and visual parity. For batching or LOD changes, run `npm run check:render-batching` and `npm run check:passenger-lod` as applicable.
- Record the reproducible before/after results in the repo performance reference. Keep raw captures under `.preview/perf/`. [Measured-state record](../.agents/skills/metro-repo/references/performance.md)
