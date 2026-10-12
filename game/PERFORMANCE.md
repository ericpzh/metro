# Demo station performance

Run from the repository root with Node 24+ and installed game dependencies:

```powershell
npm run bench:sim
npm run bench:browser
```

The browser command builds production first. Chrome/Edge is found by the existing
capture harness; override it with `CHROME_PATH`. Hardware rendering is the benchmark
default. `npm run bench:browser -- --software-gpu` uses SwiftShader for CPU-only hosts;
check the reported GPU before comparing FPS. Art capture tools keep their existing
software renderer default.

Both commands write JSON under `.preview/perf/`, including fixture size, environment,
sample counts, means and p50/p95/p99/max milliseconds. Keep before/after reports by
setting `BENCH_OUTPUT` to a different path. Run benchmarks alone, without builds or
tests competing for CPU. Repeat runs on the same hardware, browser, resolution and
view before judging small differences.

| Environment variable | Default | Applies to |
|---|---|---|
| `BENCH_TICKS` | 600 per phase | Simulation |
| `BENCH_EDITS` | 12 CPU / 8 browser | Both |
| `BENCH_SECONDS` | 6 per FPS phase | Browser |
| `BENCH_SIZE` | `1400,900` browser window | Browser |
| `BENCH_PORT` | 9348 debugging port | Browser |
| `BENCH_OUTPUT` | `.preview/perf/sim.json` or `browser.json` | Both |

The fixture is the current shipped 动物园 station, seed 7654321: 12,075 cells,
727 modules and 15,037 graph nodes in the measured version. Changing the demo changes
the workload. Simulation phases measure opening service after 120 warmup ticks,
settled service after another 600 warmup ticks, then a clock jump to 08:00 with the
existing crowd. The peak is a stress scenario, not a replay of every tick since opening.
Tick stage wrappers add a small amount of measurement overhead. Snapshot timing covers
the unselected worker payload construction and structured clone in Node; it excludes
message scheduling and the main-thread handler.

The browser uses the actual app/store/worker/renderer with an isolated profile and
the default camera/storey (z = -16). It measures an empty paused station, waits until
at least tick 180, measures 16× running service, pauses, alternates eight single-cell
top paints, and alternates adding/removing a block just beyond the station footprint.
Construction scenarios call the real store commit, including undo, worker messaging,
React effects and scene rebuilding. Pointer raycasting, drag previews and placement
validation are excluded from those browser timings; the CPU bench measures the actual
single-block/8×8 preview and add-block helpers separately.

`render.submit.ms` is CPU time inside three.js rendering, not a GPU timer. FPS comes
from animation-frame intervals and is affected by vsync/headless scheduling.
`build.editToFrame.ms` ends after two animation frames, allowing the passive scene
effect and next render to run; it is not a GPU presentation fence. Worker response
timing waits for a new paused state snapshot after each edit and includes main-thread
delays. Frame timings cover the whole edit burst, including 150 ms between edits.
Nested stage times overlap and should not be summed. Eight edit samples have coarse
tail percentiles; use more samples when investigating tails.

## Measured results — October 11, 2026

Windows, Intel i7-14700KF, RTX 4080 SUPER via ANGLE/D3D11, Chrome 154, DPR 1,
1384×805 content viewport. These are local diagnostic runs, not portable FPS guarantees.

| Metric | Before | After |
|---|---:|---:|
| Empty paused FPS | 24.4 | 44.9 |
| Paused draw calls | 8,909 | 5,882 |
| Paused triangles | 740,016 | 740,016 |
| Running 16× FPS (~616 passengers) | 25.0 | 37.7 |
| Running draw calls | 11,121 | 8,094 |
| Running triangles | 2,301,216 | 2,301,216 |
| Mean paint scene rebuild | 292 ms | 48 ms |
| Mean paint edit to frame | 1,021 ms | 169 ms |
| Mean 8×8 block drag preview (CPU) | 32.0 ms | 8.3 ms |
| Mean structural block edit to frame | Not sampled | 859 ms |

The changes batch opaque same-material static siblings inside each equipment model,
preserving module roots and nested group transforms. Transparent pieces, instancing,
shared/tagged geometry, animated rigs and mutable screens remain separate. Floor-only
top paint retains equipment models and avoids repainting/uploading unchanged sign/map
plates. Geometry edits, side finishes, station metadata, language changes and stair
starting-floor finishes still rebuild equipment.
Block previews now share one equipment occupancy index across the whole rectangle,
using the same placement verdict and refusal details as before.

Simulation baseline: opening ticks average 3.13 ms (p95 7.11), settled ticks 3.48 ms
(p95 7.82), morning peak 5.93 ms (p95 10.97), with 371–1,206 peak passengers.
Most tick time is in `moveAgents`. Undo cloning averages 2.56 ms, effective-ground
generation 2.94 ms, live simulation graph rebuilding 86.96 ms, snapshot/clone 0.05 ms.
Normal ticking does not explain the empty paused station's low FPS.

## Remaining opportunities

1. **Retain unchanged equipment on structural edits.** A single block edit still
   spends about 234 ms rebuilding all module models and re-uploads geometry/textures
   on the next render. Extend reuse per module with explicit dependencies for lift
   stops, staircase walls/joins, room walls, exit openings and neighbour-connected
   fences/tactile strips. Avoid a blanket cache keyed only by module id.
2. **Batch static parts of animated equipment and trains.** The station still submits
   about 8,094 draws with trains present. Keep doors/leaves/cabins/clock pivots dynamic
   while grouping their stationary shells; repeated fixtures could eventually be
   instanced per storey while retaining picking identities.
3. **Reduce chunk-rebuild preparation and scanning.** Even a paint edit spends about
   36 ms in chunk meshing/cache traversal plus 9 ms preparing station data. Track dirty
   chunks and their exposure neighbours instead of rescanning every band/pass.
4. **Distinguish cosmetic edits in the worker.** Floor appearance can affect walking
   speed, so not every paint is simulation-neutral. Build a dependency classifier
   before skipping the ~87 ms graph rebuild for changes that only alter appearance.
5. **Profile movement under larger demand.** `moveAgents` dominates simulation CPU;
   the current peak still fits inside 16×'s 62.5 ms tick budget. Use Node's CPU profiler
   with this fixture before changing routing, ramp collisions or crowd separation.

`render-performance.test.mjs` pins geometry bounds/triangles, ray picking, replaced
buffer disposal, animation/shared/transparent exclusions and paint-reuse invalidation.
