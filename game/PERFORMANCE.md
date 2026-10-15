# Demo station performance

Run from the repository root with Node 24+ and installed game dependencies:

```powershell
npm run bench:sim
npm run bench:browser
npm run bench:browser -- --investigate
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

`--investigate` adds a populated paused baseline and temporary renderer ablations:
disable crowd updates, compact nonzero crowd instances into a smaller draw, hide
crowd geometry, hide train geometry, then restore the original scene and repeat the
baseline. Population, camera and train poses stay fixed across these phases. The
compaction experiment excludes its one-time packing cost; it measures GPU submission
potential, not a production implementation. The flag also measures cell/module
raycasts, exposed wall-face paint commits and 8×8 structural commits. Picking samples
exclude tool dispatch, validation and ghost building. Bulk browser commits exclude
placement helpers, which the CPU benchmark measures separately at 8×8, 32×32 and
32 wall columns. Ablations affect only the disposable benchmark page.

| Environment variable | Default | Applies to |
|---|---|---|
| `BENCH_TICKS` | 600 per phase | Simulation |
| `BENCH_EDITS` | 12 CPU / 8 browser | Both |
| `BENCH_SECONDS` | 6 per FPS phase | Browser |
| `BENCH_SIZE` | `1400,900` browser window | Browser |
| `BENCH_PORT` | 9348 debugging port | Browser |
| `BENCH_OUTPUT` | `.preview/perf/sim.json` or `browser.json` | Both |
| `BENCH_STATION` | Shipped demo; otherwise a path to a `.metro.json` save | Both |

An external save is parsed through the normal loader, without changing the shipped
demo. Browser reports include cold application readiness and the subsequent save
opening time, move pickup/cancel latency, and first/repeated synthetic train arrivals.
Use distinct `BENCH_OUTPUT` paths for clean benchmarks and instrumented profiles.

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

## Investigation — October 13, 2026

Production build of the current working tree, including its pending model and wall
tool changes. Same RTX 4080 SUPER / Chrome 154 / 1384×805 / DPR 1 environment as
above; 12,075 cells and 727 modules. Reports are local files:
`.preview/perf/browser-2026-10-13-baseline.json`,
`browser-2026-10-13-investigate.json`,
`browser-2026-10-13-investigate-repeat.json`,
`sim-2026-10-13.json` and `sim-2026-10-13-investigate.json`.

The first baseline and investigation runs agree closely on empty/running FPS and
floor/block latency. Subsequent runs encountered large host-load variation: empty
FPS fell from 46.9 to 19.6 without a game change, and unchanged populated paused
baselines varied within each investigation. Do not treat ablation FPS differences
as precise speedup predictions. Counts and invalidation paths are more reliable.

| Workload | Mean in the first runs |
|---|---:|
| Empty paused station | 46.9 FPS / 5,923 draws |
| Running 16×, ~618 passengers | 37.5 FPS / 8,135 draws |
| Single floor paint → two animation frames | 170 ms |
| Single structural block edit → two animation frames | 921 ms |
| Single exposed wall-face paint → two animation frames | 1,045 ms |
| 8×8 structural commit → two animation frames | 1,025 ms |
| Simulation tick, opening / settled / peak | 3.02 / 3.16 / 3.73 ms |
| Live simulation graph rebuild | 84 ms |
| 8×8 / 32×32 placement preview, CPU helper | 8.2 / 92.3 ms |
| 32 full wall columns preview, CPU helper | 18.5 ms |
| Paint one wall face / flood 1,026 wall faces, CPU helper | 0.76 / 7.53 ms |
| Cell / module raycast over the viewport | 0.18 / 1.06 ms |

CPU helper additions came from a later, more variable run; use them to identify
frame-budget violations, not small regressions. Browser construction numbers measure
document commits rather than complete pointer gestures. Worker-response and nested
scene timings overlap other work; they are not additive.

Priorities supported by these measurements and the source paths:

1. **Retain equipment on wall paint and local structural edits.**
   `retainPaintedModules.ts` rejects every side-finish change. One wall face rebuilds
   all 727 modules, spending 430 ms in `buildModules` and about 505 ms in `setStation`,
   followed by expensive first-render uploads. The paint helper itself is below 1 ms.
   Side paint needs room-wall dependency tracking: `RoomModel` reads cell side finishes.
   Rebuild affected rooms, or replace their wall materials, while retaining unrelated
   equipment. Structural edits need explicit cell/neighbor dependencies for each
   model rather than unconditional reuse.
2. **Cache placement indexes across a preview, then across unchanged pointer targets.**
   Occupancy is already shared per rectangle, but each candidate still calls
   `reservedOpening` and `isTrackCell`; the latter scans the cell list and track
   modules. A 32×32 preview takes several frame budgets before ghost construction.
   Precompute track keys and reserved-opening lookups alongside occupancy, preserving
   the same refusal/collider semantics. Schedule at most one pointer preview per
   animation frame and avoid repeating validation when its cell rectangle is unchanged.
3. **Batch train shells and static portions of animated equipment.** Hiding train
   geometry consistently removes 2,210 draws (8,135 → 5,925 with crowd), while train
   update CPU is only ~0.01–0.06 ms/frame. Doors remain separate movable rigs. Static
   equipment still contributes 5,923 draws even with no passengers or trains.
4. **Skip hidden crowd render work and avoid unchanged/full-capacity buffer uploads.**
   `renderAgents` loops through everyone, including when the crowd switch is off, and
   marks body/shadow matrices, colors, outfit and poses dirty every frame. At capacity
   8,000 those attributes total about 1.28 MB, although the demo only uses hundreds
   of slots. Set update ranges to the active prefix, cache identity-only appearance,
   and stop uploading settled paused poses. Keep followed-passenger eye updates and
   route/selection behavior working when bodies are hidden.
   Hidden-storey bodies currently use zero-scale matrices but remain in the draw.
   The compaction experiment reduced submitted crowd instances from 478 to 218 and
   total triangles from 5,408,302 to 2,974,702 with the same visible storey policy.
   FPS was 31.0 vs 31.3 in that pair: fewer triangles alone did not resolve the
   draw-call bottleneck on this GPU. Frustum culling and distance-based model detail
   are further opportunities; actual wall occlusion would need a separate policy.
5. **Classify cosmetic worker edits.** Side color should not need an 84 ms routing
   rebuild. Floor finishes can affect speed and cover, so compare simulation-relevant
   properties before skipping graph work. Snapshot/clone is only about 0.07 ms in the
   first run; lowering worker payload frequency is a low priority for this fixture.

Reducing animation sample frequency is a renderer-only option for hidden or distant
models; preserve simulation ticks, boarding, queues and train service everywhere.
Train groups already skip per-frame consist updates when their level visibility is
false; platform screen-door groups still update. Crowd animation uses a baked GPU
pose atlas rather than individual skeleton mixers. Freezing CPU pose updates leaves
the shader's pose texture sampling in place, so it is not a measurement of a cheaper
static GPU shader. Test an idle/distant shader or lower-detail crowd separately.

The current approved atlas is another resource opportunity: 9,350 triangles per
passenger, 71.8 MB JSON, and about 90.4 MB for each float position/normal GPU texture
(~180.8 MB for the pair). Compact binary loading and packed texture formats could
reduce startup/download/memory cost. This investigation does not establish their
effect on steady-state FPS. No runtime optimization was shipped by this pass; changes
are the reusable benchmark scenarios and this report.

## 指示牌 board-editor drag — October 13, 2026

Two fixes, measured in structure rather than FPS (the bench's browser phases do not
drive the editor):

1. **The drag itself no longer writes the store per bin.** A live reorder used to
   call `previewSignLayout` on every hovered bin, bumping `signVersion` and running
   the viewport's full rebuild effect from inside the pointermove handler the drag
   ghost moves in. `trackDrag` now writes the bins locally (`applyLocal`) and schedules
   a 150 ms trailing `signVersion` bump; the drop flushes it once and cancels a
   pending timer behind it. Palette drags never wrote the store mid-drag, which is why
   dragging a *board* mark stuttered and dragging a *tile* did not.
2. **A boards-only change no longer rebuilds the station.** `signBoardsOnlyChange`
   (`render/moduleDependencies.ts`) detects the case where exactly one sign's
   `front`/`back` changed — cells, lines, station fields, every other module and the
   sign's mount all reference- or JSON-identical — and `setStation` then skips the
   chunk remesh (the mesher never reads signs) and rebuilds only that sign's group via
   `buildModules`' keep-set, retaining the other models, rigs and owned materials.
   Plates: the station-wide `redrawSignPlates` is skipped and only the one sign's two
   same-size faces are repainted in place (`PlateSystem.repaintSignPreview`); a panel
   resize still mints fresh plates through the normal path. A delete lands on this path
   too — it only takes marks off one board — which is what made the delete gesture lag
   after the first fix. Anything else (a second module, a cell, a line, a mount) falls
   back to the full rebuild.

Measured on the shipped demo's fixture scale, the full path this replaces costs about
180–920 ms per call (`buildModules` 9–430 ms, `setStation` up to 505 ms, plus first-render
uploads); the boards-only path is one module build plus one canvas repaint.

## Implemented improvements — October 13, 2026

The runtime now retains equipment independently on local cell edits using explicit
cell dependencies (`moduleDependencies.ts`). Room walls, ramp neighbours, lift stops
and suspension columns invalidate affected groups; unrelated geometry, owned materials
and live gate/lift/TV rigs survive. Module/neighbour metadata, language and decoded
artwork changes still take a full rebuild. Unchanged printed plates are not repainted.

Placement previews and block/wall/floor release share `blockIndex`: tracks, reserved
openings, equipment occupancy and virtual ground are indexed once per immutable
document. The last unchanged preview is reused. Pointer previews coalesce per frame
and flush before release; touch and path-collecting deletion sweeps retain every input.
Bulk painting no longer scans the full cell list once for every target face.

Train stationary opaque siblings batch while door/window references and transparent
sorting remain intact. Settled train leaves are not repositioned every frame. Crowd
draws pack only bodies visible under the existing storey policy and a conservative
camera frustum; simulation slots, eye following, selection and paused gait remain
independent of draw slots. Hidden crowds avoid render work, paused poses avoid uploads,
buffer updates cover only drawn prefixes, and colors/outfits upload only when packed
identities change. The worker classifies cosmetic edits before rebuilding routing;
geometry, zones, tags, metadata, speed, cover and track changes still invalidate it.

Reports: `.preview/perf/browser-2026-10-13-after.json` and
`.preview/perf/sim-2026-10-13-after-final.json`. Unprofiled browser phases retain the
6-second / 8-edit settings; CPU phases use 600 ticks / 12 edits. The fixture remains
12,075 cells / 727 modules, with ~618 passengers in the browser running phase.

| Metric | Investigation | After implementation |
|---|---:|---:|
| Single wall paint → frame | 1,045 ms | 181 ms |
| Single block edit → frame | 921 ms | 180 ms |
| 8×8 structural commit → frame | 1,025 ms | 182 ms |
| Module build during wall paint | 430 ms | 9.5 ms |
| Module build during block edit | 294 ms | 9.1 ms |
| Running draw calls | 8,135 | 6,910 |
| Running submitted triangles | 6.72 million | 2.72 million |
| 32×32 changing preview with a warm document index | 92.3 ms | 0.43 ms |
| 32×32 unchanged preview | Not separated | 0.06 ms |
| 32×32 preview including a fresh index | Not separated | 3.15 ms |
| 1,024 wall faces painted, CPU helper | Not sampled | 1.40 ms |
| Single floor paint → frame | 170 ms | 173 ms |

Changing-preview measurements alternate rectangles instead of repeatedly hitting the
last-preview cache. CPU reports also include `preview32x32ColdIndex`, which uses a
fresh document index each sample, actual `addFloor` with auto-wall rings at both sizes,
and painting 1,024 wall faces. Cold preparation is not hidden in the warm timings.
Live simulation tick timings remain essentially unchanged, as intended.

FPS is not a demonstrated improvement: the unprofiled after run reported 44.6 paused /
29.3 running FPS versus 46.9 / 37.5 originally. Host-load variation and concurrent
character-library edits complicate that comparison. The edit-latency reduction is
large and reproducible across subsequent diagnostic runs; a controlled FPS comparison
remains necessary. Static equipment still submits 5,923 draws and chunk meshing still
scans the whole station, so those remain significant limits. Actual 8×8 / 32×32
auto-wall floor release costs 19.8 / 20.8 ms; its global wall-ring synchronization
is another candidate for local invalidation rather than a whole-document pass.

### Profiling tools

```powershell
npm run check:perf-tools   # Chrome CPU/trace export smoke check
npm run profile:sim        # unminified real World/build helpers → V8 .cpuprofile
npm run profile:browser    # production app → CPU profile, Chrome trace, GPU timers/uploads
```

The browser flags can also be used separately:

```powershell
npm run bench:browser -- --gpu-timer
npm run bench:browser -- --profile --gpu-timer --investigate
```

Profiling output uses `BENCH_OUTPUT`'s basename: `.cpuprofile` opens in Chrome DevTools'
[Performance panel](https://developer.chrome.com/blog/profiling-cpu), and `.trace.json` opens in DevTools Performance or a compatible
trace viewer. CPU sampling covers the normal browser benchmark; timeline recording
replays structural edits afterward. Sampling and tracing are deliberately separate
to avoid competing V8 collectors. Marks identify every phase. Simulation profiles use
Node/V8 directly and preserve readable TypeScript source/function names. CDP requests
have bounded timeouts and session cleanup rejects outstanding requests.

`--gpu-timer` uses asynchronous `EXT_disjoint_timer_query_webgl2` samples, discards
disjoint/previous-phase results and never blocks waiting for a GPU fence. It reports
`gpu.render.ms` separately from CPU `render.submit.ms`. Unsupported timers report
`unavailable`, rather than substituting CPU timings. Buffer upload counters record
actual `bufferData`/`bufferSubData` bytes and calls, including active update ranges;
they exclude textures/uniforms. `crowdInstances` distinguishes available simulation
agents, configured draw count and submitted visible instances. Timer/trace hooks add
overhead, so keep normal benchmark reports for before/after comparisons.

Verified local exports are
`.preview/perf/browser-2026-10-13-profile-final.cpuprofile` (11,856 CPU samples),
`browser-2026-10-13-profile-final.trace.json` (2,004 events, structural-edit markers),
and `sim-1791931401969.cpuprofile`. The browser report confirms native GPU timer
support and zero buffer uploads during its sampled empty paused phase.
`performance-policy` and `worker-preview` cover the new contracts; all 1,326 tests
and the production build pass. A captured production view also retained complete
station/train geometry.

### Sequential rerun with the host idle

After the user cleared other load, the CPU and browser benchmarks ran sequentially,
without builds, tests, CPU sampling or GPU timer instrumentation alongside them.
Reports are `.preview/perf/sim-2026-10-13-no-load.json` and
`.preview/perf/browser-2026-10-13-no-load.json`, using the same fixture and settings.

| Metric | Idle-host rerun |
|---|---:|
| Empty paused FPS | 44.1 |
| Running 16× FPS, 618 passengers | 38.0 |
| Populated paused FPS | 35.1; 33.6 on repeat |
| Populated paused, crowd updates disabled | 35.2 |
| Populated paused, crowd hidden | 35.2 |
| Populated paused, trains hidden | 45.9 |
| Single wall paint → frame | 183 ms |
| Single block edit → frame | 177 ms |
| 8×8 structural commit → frame | 197 ms |
| Single floor paint → frame | 182 ms |
| 32×32 changing preview, warm index | 0.35 ms |
| 32×32 preview, fresh index | 3.06 ms |
| 1,024 wall faces painted, CPU helper | 1.45 ms |
| Actual 8×8 / 32×32 auto-wall floor release | 20.4 / 21.5 ms |

Running FPS recovered from the earlier 29.3 to 38.0, near the original 37.5;
this establishes recovery under reduced host load, not a meaningful overall FPS
increase. Edit latency and preview improvements persist. Rendering dominates the
populated paused frame: submission averages 28.1 ms while crowd updates average
0.14 ms (0.0035 ms on the repeat after its initial update). Hiding the crowd removes
about 1.78 million triangles but barely changes FPS. Hiding trains removes 985 draws,
reduces submission to 21.5 ms, and raises FPS to 45.9. Further train batching and
static-equipment draw consolidation are therefore better candidates than lowering
crowd animation cadence. Those experiments identify costs; they are not a proposal
to hide trains in normal play. Global chunk scans and auto-wall synchronization
remain the measured placement limits.

### Train and equipment draw-call pass — October 13, 2026

Implemented all five follow-ups: repeated opaque door frames/feet instance per
consist; glass, moving door panes and red straps use sorted BatchedMesh draws;
mirrored static seats/panels bake reflected transforms with corrected winding;
equipment batches across module roots by material and 16 m area; unlit canvas
labels and station-information screens share full-resolution atlas pages.
Cycling artwork windows remain independently updateable. Atlas regions refresh
when their source texture changes, include edge gutters, and recycle deleted
panel slots. Pages use linear filtering without mipmaps to avoid cross-panel bleed;
oversized/repeating/custom-shader panels keep their original materials.

Picking uses the original surfaces on layer 31, while cameras draw batches on
layer 0. Original IDs, bounds and material owners survive. Door, wing, clock-hand
and lift-cabin subtrees remain live. Equipment revisions skip unchanged root/slice
walks; changed buckets replace only their own allocations. Module/neighbour metadata
changes still invalidate models conservatively, so equipment topology edits can
require broader rebuilds than cell-only edits.

The demo changed during this work to 11,951 cells / 770 modules, and the approved
passenger atlas changed from 26 to 56 variants. Reports from the earlier fixture
are therefore not a controlled comparison. The new `--compare-batching` option
toggles these optimizations in one production scene with a fixed four-car B consist,
the same population/camera, and the same station/assets on both sides. Disabled mode
retains the previous within-module/opaque-sibling batching. `drawInventory` records
render-list material passes by family/material and sorted-batch surface counts;
`environment.multiDraw` records native WEBGL_multi_draw support. Browser errors
also fail the benchmark instead of silently accepting a broken render loop.

Final current-asset report: `.preview/perf/browser-2026-10-13-batches-current-assets.json`.
Six-second phases / eight edits, 620 passengers, 56 approved variants, RTX 4080 SUPER,
1384×805, DPR 1; native multi-draw is available. Sampling/GPU timers were disabled.

| Same populated paused scene | Batching disabled | Batching enabled |
|---|---:|---:|
| Total draw calls | 7,643 | 2,122; 2,124 on repeat |
| Test train draw calls | 813 | 24 |
| Equipment material passes | 6,396 | 1,664 |
| Submitted triangles | 2,788,131 | 2,788,131 |
| FPS | 17.6 | 41.1; 45.6 on repeat |
| CPU render submission | 56.2 ms | 23.7 ms; 21.1 ms on repeat |

That is about 72% fewer total draws, 97% fewer test-train draws, and 74% fewer
equipment passes. Timing still varies with host load: the prior 26-variant paired
run measured 28.8 FPS disabled / 58.1 enabled, while the final running-16× phase
with 56 variants measured 36.3 FPS. Use the paired phases for the causal comparison,
not absolute FPS across different asset/host states. Final wall/block/8×8 commit
latencies were 226 / 228 / 226 ms; this pass does not establish an additional edit
latency gain over the previous 727-module idle-host run. Remaining unbatched costs
include moving screen doors/cabins, artwork windows and some singleton equipment.

```powershell
npm run bench:browser -- --compare-batching --investigate --screenshot
```

Close-up enabled/disabled/open-door captures retained train windows, seats, straps,
door fittings and clear open apertures (`.preview/perf/train-batches-*.png`). The
production build/typecheck, 86 focused renderer/build tests, seven batching tests
after atlas-slot recycling, and CPU/trace export smoke check pass. The full current
suite passes 1,334 of 1,335 tests; its remaining failure is the newly exported
`male-original-crossbody-left-bag` hip-motion assertion in `passenger-library`.
Legacy passenger metadata now falls back to the prior reviewed age pools while
explicit age flags always take precedence, avoiding empty appearance pools during
an asset/schema update.

### Regression and skill audit

The final full suite now passes **1,391 tests**, including the passenger hip-bag
motion check. The repo/game/test/model skills and module ownership reference cover
the new placement, worker, pointer, crowd, batching and atlas contracts. The skill
frontmatter validator passes for all four updated skills.

The expanded regressions cover actual source-layer camera picking/occlusion,
mapped-equipment UV/material integration, allocation reuse/disable/re-enable,
exact geometry/instance/texture disposal, hidden/skinned/morph/partial-range
exclusions, culling/render/shadow policy, independent and moving clipping planes,
nested landing/cabin rigs, all A/B/C/L stock and four rotations, paused/hidden train
buffers/eviction, immutable ground/exit indexes, paint deduplication and frozen
camera-driven crowd repacking. They caught and fixed duplicate batched-geometry
disposal, missing culling/draw-policy preservation, unsafe mesh exclusions, and
atlas sharing across independent clipping planes. Moving a shared plane also keeps
its cached material rather than allocating another clone.

`npm run test:perf` measures source coverage of the focused performance suites.
All nine new helper files (`frameTask`, `blockIndex`, `cosmeticEdit`,
`moduleDependencies`, `batchGeometry`, `equipmentBatches`, `panelAtlas`,
`trainBatches`, `passengerEligibility`) have 100% line coverage. Branch coverage
ranges from 88.9% to 100%; defensive geometry/merge guards are not a claim of
exhaustive GPU coverage. The full production build/typecheck and CPU/trace export
smoke check pass.

`npm run check:render-batching` is now a repeatable real GLSL/WebGL check rather
than only a manual capture. It checks station draws and positive, equal open/closed
train triangle counts with no runtime/shader/GL errors. With the native extension,
station draws were 3,550 → 1,008 and both train poses 814 → 25. After a build,
`node tools/check-render-batching.mjs --no-multi-draw` disables the extension before
renderer initialization: station draws were 3,550 → 1,701 and both train poses
814 → 630, again with equal triangles and no errors. These are correctness/draw
checks at fixed visibility, not FPS gates. Reports are
`.preview/perf/render-batching-check.json` and `render-batching-check-fallback.json`;
coverage/full-suite logs are `coverage-performance-final.log` and
`tests-skills-coverage-final.log` in the same ignored directory.

### Performance run — 2026-10-14

Ran `bench:sim`, `bench:browser`, `profile:sim` and `profile:browser` sequentially
on Node 24.15.0 / Windows with an Intel i7-14700KF and RTX 4080 SUPER. The
fixture was 动物园 (11,871 cells, 770 modules, 15,131 graph nodes); the browser
used Headless Chrome 155 at 1384×805, DPR 1, z = -16, with native multi-draw.

| Benchmark | Result |
|---|---|
| Simulation tick, opening / settled / morning peak | Mean 3.03 / 3.09 / 3.66 ms; p95 6.04 / 6.34 / 7.46 ms (600 samples each) |
| Simulation morning-peak agent movement | Mean 3.46 ms; p95 7.25 ms (600 samples) |
| 32×32 build preview / live rebuild | Mean 0.40 / 77.68 ms; p95 0.62 / 89.39 ms (12 samples each) |
| Browser paused / running at 16× | 60.0 / 49.6 FPS; 2,101 / 2,127 draws; running population 627 |
| Browser paint / block edits | 35.9 / 33.0 FPS; edit-to-frame mean 140.09 / 199.72 ms, p95 228 / 252.9 ms (8 edits each) |

The browser profile measured GPU render p50/p95 of 11.36/12.38 ms paused and
11.35/12.67 ms at 16×; the profile pass also collected pointer, edit, crowd and
train ablations plus GPU buffer uploads. These profiling timings include the
instrumented run and are separate from the clean browser benchmark above.

Reports and profiles are `.preview/perf/sim.json`,
`.preview/perf/browser-bench-2026-10-14.json`,
`.preview/perf/sim-profile.json`, `.preview/perf/sim-1792029212742.cpuprofile`,
`.preview/perf/browser.json`, `.preview/perf/browser.cpuprofile` and
`.preview/perf/browser.trace.json`. Browser production builds and all four
commands completed successfully; Vite reported its existing large-chunk warning.

### Larger-station improvements — 坦尾, 2026-10-14

Used the supplied `坦尾.metro.json` through `BENCH_STATION`: 13,721 cells,
1,334 modules and 38,462 graph nodes, seed 7654321. The original save and shipped
demo are unchanged. Hardware is the i7-14700KF / RTX 4080 SUPER above, Chrome 155,
1384×805, DPR 1, native multi-draw, with this save's active storey z = -7.

Clean browser comparisons use three-second phases and four edits, without CPU
sampling or GPU timers. Each starts a fresh Chrome profile against local HTTP;
startup is application readiness on the shipped demo, followed by opening 坦尾.
These startup measurements do not represent a throttled network or cold disk.
Simulation comparisons use 600 ticks per phase and 12 helper samples. Browser,
simulation, build and profiling runs execute separately.

| Measurement | Before | After |
|---|---:|---:|
| Application ready | 9.85 s | 8.23 s |
| Open 坦尾, including worker and two frames | 2.25 s | 2.24 s |
| Validate 32 stair-block candidates, mean / p95 | 34.52 / 38.84 ms | 8.85 / 10.67 ms |
| Move pickup to two frames, mean | 1,153.95 ms | 46.65 ms |
| Move cancel to two frames, mean | 1,156.33 ms | 43.50 ms |
| Repeated four-car B consist creation, mean (3 repeats) | 58.17 ms | 0.03 ms |
| Running at 16× | 55.3 FPS | 52.0 FPS |
| Morning-peak simulation tick, mean / p95 | 19.18 / 40.51 ms | 19.68 / 41.72 ms |

Pickup/cancel now hides retained module geometry instead of rebuilding the station.
Affected equipment batches temporarily expose their original neighbouring surfaces;
cancelling restores the same batch allocations. View slicing and picking still agree,
including changing storey while carrying a piece. Placement prepares immutable module
collision bodies once and rejects disjoint bodies before expensive pair rules.
The stair measurement covers validation, excluding ghost construction and pointer work.

Production passenger buffers are fetched as binary assets instead of parsed base64
JavaScript strings. Their raw payload is 30.25 MB rather than 40.34 MB; normal HTTP
compression can narrow that transfer difference. Positions/normals retain signed
16/8-bit values on the GPU, reducing their combined texture allocation from 529.7 MB
to 198.6 MB without discarding baked values. Development retains a tested native/base64
compatibility decoder. Production assets remain below the strict 25 MiB Worker limit.

Train geometry survives between services in a cache bounded to eight dormant
configurations, evicting the least recently used with full GPU disposal. A new
configuration still took 61.8 ms to construct in the final clean run. The cache
addresses repeat-arrival stalls; it does not establish a steady FPS improvement.
Browser populations varied slightly (559 before / 556 after the running phase), and
the short FPS samples and simulation ticks show no sustained throughput gain.
Graph rebuilding remains costly: mean 616 → 751 ms, median 556 → 584 ms and p95
978 → 1,355 ms in these runs. Those long tails, save opening and first-use train
creation remain targets for further profiling.

Clean reports: `.preview/perf/tanwei-before-clean.json` and
`tanwei-after-clean.json`; simulation reports: `tanwei-before-sim.json` and
`tanwei-after-sim.json` in the same directory. Instrumented reports and matching
`.cpuprofile` / `.trace.json` exports are `tanwei-before-browser.*` and
`tanwei-after-profile.*`. The latter includes asynchronous GPU timing and buffer
upload counters, with no console/shader/runtime errors. The final screenshot is
`tanwei-after-clean.png`. All artifacts are local and ignored.

The production build/typecheck and all **1,447 tests** pass. Regression coverage
includes move allocation/visibility restoration, immutable collision-cache invalidation,
train reuse/eviction/disposal, exact binary delivery and signed pose reconstruction.
Native and extension-free WebGL geometry/draw checks and CPU/trace export checks
are recorded in `tanwei-render-check.log`, `tanwei-render-fallback.log` and
`tanwei-perf-tools.log` under `.preview/perf/`.

### Stair-block preview follow-up

Stair-block dragging now draws proposed geometry without running placement
validation or collision highlighting. Full validation runs on release, rejecting
blocked tiles and committing accepted tiles as one edit; routing rebuilds only
after that commit. Invalid placements therefore report their refusal on release.
The earlier 32-candidate validation measurement now describes release work, and
the simulation harness labels it `build.validate32StairBlocksOnRelease.ms`.
`roof-tool` pins that previews never inspect station cells for placement checks
or create undo entries, while release still refuses covered tiles correctly.
The 53 focused stair/preview/tool tests and production build/typecheck pass.
The follow-up full suite passes 1,447 of 1,448 tests; `passenger-clothing` reports
a current reviewed GLB versus baked-atlas source-hash mismatch, outside this change.

### Initial stair-drag stall: repeated raycasts

The first press searched the module document with
`modules.find(m => m.id === this.pickModuleAt(info))`. That invokes a complete
scene raycast for every examined module. A miss on 坦尾 ran 1,334 raycasts before
initializing the drag, blocking subsequent pointer moves even though the hover
preview was already visible. Once the press completed, dragging avoided this search,
explaining why later movement was responsive. Direction uses the tile's rotation;
the deliberate drag threshold is 160 ms plus 4 px of movement.

The picked ID is now evaluated once and reused by the document lookup. The same
pattern was corrected in tactile placement, floor-mark deletion and exit-ramp
snapping. `roof-tool` pins one raycast for both a miss and a final-entry hit in a
1,334-module station, including preservation of the selected anchor.

`node tools/bench-stair-drag.mjs` reproduces an actual browser press and drag using
the supplied save through `BENCH_STATION`. On this host, pointer-down fell from
587.6 ms / 1,334 raycasts to 4.3 ms / 1 raycast (raycast time 586.4 → 3.0 ms).
Reports are `.preview/perf/stair-drag-before.json` and `stair-drag-after.json`.
The production build/typecheck passes. The full suite passes 1,454 of 1,455 tests,
with the same unrelated passenger-clothing GLB/baked-atlas hash mismatch.

### Repository guidance and final coverage

Root `AGENTS.md` and the repo/game/test skills now route performance work through
`.agents/skills/metro-repo/references/performance.md`: reproduce cold events, count
work, bound caches, preserve placement/simulation contracts and compare equivalent
measurements. `npm run bench:stair` exposes the real pointer-event harness.

The expanded `npm run test:perf` passes **87 tests**, covering all four repeated-pick
paths and the new renderer/passenger contracts. Selected V8 source results:

| File | Lines | Branches | Functions |
|---|---:|---:|---:|
| `TileEquipmentTool.ts` | 100% | 85.16% | 90.48% |
| `EquipmentTool.ts` | 53.38% | 46.67% | 50% |
| `TactileTool.ts` | 56.91% | 33.33% | 63.64% |
| `equipmentBatches.ts` | 99.31% | 96.04% | 93.75% |
| `passengerAtlas.ts` | 100% | 73.33% | 100% |
| `passengerModel.ts` | 100% | 97.06% | 94.44% |
| `scripts/passenger-assets.ts` | 100% | 85.71% | 100% |

These are focused-suite source measurements, not exhaustive equipment or GPU
coverage. The production build/typecheck, native and extension-free WebGL checks,
CPU/trace exports and all three updated skill validators pass. The local full
suite passes **1,458 of 1,459**: six ignored generated skirt GLBs differ from the
tracked atlas's source hashes, producing the existing `passenger-clothing` failure.
The integrity assertion and generated atlas remain unchanged.

Final logs under `.preview/perf/`: `perf-coverage-final.log`, `perf-tests-final.log`,
`perf-build-final.log`, `perf-render-final.log`, `perf-render-fallback-final.log`
and `perf-export-final.log`.

### Sim-inert decor incremental refresh — October 15, 2026

Floor stickers (盲道/地面指示) placed a ~0.5 s hitch because the commit took the
full path: `setStation` remeshed every chunk and rebuilt all module models
(`retainedModuleIds` failed closed on any module diff), repainted every sign and
decor plate, and the worker rebuilt the walk graph (`isCosmeticStationEdit`
failed closed on any module diff) — even though `buildGraph` never reads these
pieces.

The fix classifies sim-inert decor once (`sim/decorInert.ts`): floor stickers,
wall panels, hanging fittings, wayfinding furniture and street props that change
neither the walk graph nor the street window. Machines, cabinet bodies, posts,
pillars, screen ends and unknown future types stay functional and fail closed,
as does any edit that moves a cell, touches lines/station fields, or widens the
street window. A roof hanger is inert while a post hanger still blocks; a
tactile add/remove rebuilds its four neighbours (`tactileArms`) and a hanger
add/remove rebuilds the fittings hung from its bar (`hangerSupports`).

That verdict is asked in all three places: the worker skips `World.rebuild()`
(`sim/cosmeticEdit.ts`), `setStation` skips the chunk remesh and station-wide
plate repaints (`render/scene/SceneRenderer.ts` via
`ModuleSystem.inertDecorOnlyChanged`), and `buildModules` retains every untouched
group (`render/moduleDependencies.ts`). Both fast paths clear the slice key the
remesh used to clear, so the trailing `applyLevel` still walks new-group
visibility and resyncs the cross-module batches — without it a deleted shelf
kept drawing its batched body until a reload. `performance-policy` pins the inert vs
functional classification, tactile/hanger neighbour rebuilds, conservative
functional invalidation and delete-group retention; `worker-preview` pins the skipped vs forced graph
rebuild; `scene-wiring` pins the `setStation` fast path including the slice-key
clear. `npm run test:perf`
passes 90 tests; the full suite passes 1,462 of 1,463 with the pre-existing
`passenger-clothing` GLB hash mismatch. No browser FPS claim is made here.


### Road brush validation and equipment retention — October 15, 2026

The real production road gesture on the shipped demo slowed progressively as its
rectangle grew. `equipmentReason` called `moduleFloorOk`, which scanned all
11,871 authored cells and repeatedly searched 770 modules for **each** proposed
road square. The baseline Chrome CPU profile attributes about 1.67 s across the
measured sequence to that floor-validation stack (minified `Zc`, including
`cells.some`, ground-hole and exit searches). The preview model builder itself
cost only about 0.2–0.5 ms per update; its geometry was not the dominant stall.
Release also discarded and rebuilt all equipment models for one road addition.

`sim/roadPlacement.ts` now prepares support, ground holes, exit floors and track
occupancy once for each immutable cell/module array pair, then walks only the
proposed road rectangle. Preview and release still ask `equipmentReason`, with
identical support, obstruction and refusal priority; there is no deferred commit
or skipped preview validation. `roadsOnlyChange` allows the renderer to retain
non-road equipment allocations while rebuilding road markings for intersections.
This is a rendering dependency rule only: roads still rebuild pedestrian routing,
and expanding the street window still remeshes the ground.

Controlled main-thread/browser runs used the same demo (11,871 cells, 770 modules,
seed 7654321, zero passengers, paused at 0 m), the same 12 × 96 m road at
(153, 0, 0), camera/viewport and three gestures (two cancels, one release).
Windows, Chrome 155, NVIDIA RTX 4080 SUPER through ANGLE/D3D11, device scale 1,
1424 × 905 content viewport. Hardware rendering was requested for both runs;
the final report records the unmasked backend. CPU sampling ran separately.

| Interaction | Before | After |
|---|---:|---:|
| First road hover | 123.6 ms | 100.6 ms |
| First press | 63.1 ms | 87.3 ms |
| First movement (6 × 8 m) | 87.5 ms | 87.4 ms |
| First large preview (12 × 96 m) | 281.5 ms | 77.6 ms |
| Warm large preview | 268.4 ms | 75.6 ms |
| Release, through two animation frames | 1880.4 ms | 873.8 ms |
| `setStation` CPU within release | 621.3 ms | 284.4 ms |

Input figures include CDP dispatch and two animation-frame boundaries, not isolated
handler CPU, GPU time or actual presentation latency. The first press has no
measured improvement; cold hover/render setup and a roughly 70–90 ms frame floor
remain in this headless setup. The exterior road enlarges the generated street
window, so release still has a noticeable remesh/initial-upload hitch. No steady
simulation-throughput or FPS improvement is claimed. Main-thread CPU profiles do
not measure the worker's graph-build time.

Both runs picked once per press, committed nothing during preview/cancel, and
committed exactly one road on release. The final renderer retained all 770 prior
equipment roots, with zero runtime/shader failures. Deterministic coverage in
`road-performance.test.mjs` pins one cold document preparation, **zero document
cell reads on warmed extent changes**, invalidation on new cell/module arrays,
original-verdict equivalence, actual equipment-group identity, replaced-road
material disposal, and continued routing invalidation.

Reproduce with `npm run bench:road`; set `BENCH_STATION` for a supplied save,
`BENCH_OUTPUT` for a distinct JSON path and `BENCH_PROFILE=1` for a separate CPU
profile. Raw evidence is ignored under `.preview/perf/`: `road-baseline.json`,
`road-final.json`, `road-comparison.json`, `road-baseline-profile.cpuprofile`,
`road-final-profile.cpuprofile` and their corresponding JSON/log files. Builds,
full tests, coverage and browser correctness checks use separate `road-*.log`
reports in that directory.

Validation: production build and all 1,500 game tests pass; `test:perf` passes all
96 tests. Its V8 report gives `roadPlacement.ts` 100% line/function and 97.37%
branch coverage; `moduleDependencies.ts` has 94.20% line coverage. The existing
traffic/gesture portions of `roads.ts` are covered by the full road suite, not
all imported by the focused perf run. Real production input checks pass in both
languages, and native multi-draw plus the disabled-extension fallback preserve
train triangles with no GLSL, WebGL or runtime errors. Raw validation outputs are
`road-full-tests.log`, `road-perf-tests.log`, `road-input-check.log`,
`road-render-check.log` and `road-render-fallback.log` under `.preview/perf/`.
