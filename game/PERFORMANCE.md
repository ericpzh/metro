# Demo station performance

Run from the repository root with Node 24+ and installed game dependencies:

```powershell
npm run bench:sim
npm run bench:browser
npm run bench:browser -- --investigate
```

Both benchmark commands run the two shipped examples, 动物园 (Zoo) and 坦尾
(Tanwei), sequentially with the same settings. Browser reports default to
`.preview/perf/browser-zoo.json` and `browser-tanwei.json`; simulation reports
default to `sim-zoo.json` and `sim-tanwei.json`. Set `BENCH_STATION` to run one
external save instead. `BENCH_OUTPUT` supplies the output base, with the fixture
name added before `.json` when running both.

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
| `BENCH_OUTPUT` | `.preview/perf/sim.json` or `browser.json` base | Both |
| `BENCH_STATION` | Both shipped examples; set a path to run one `.metro.json` save | Both |

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
each example's default camera/storey. Paused throughput forces continuous rendering;
`pausedIdle` restores normal frame reuse and reports actual `renderedFrames` alongside
RAF cadence. It then waits until
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


## Connected road traffic — 2026-10-15

Road traffic now follows a derived directed lane graph. Topology is prepared once
per immutable module array; an eight-entry road-signature history also preserves
it across unrelated decor edits and thumbnail builds. Same-width collinear strokes
coalesce, perpendicular crossings/T joins get curved turn connectors, and different
heights remain separate. A maximum of 192 vehicles uses 0.1 simulated-second steps,
lane queues and exclusive junction reservations. Seeks/catch-up over 60 simulated
seconds reset ambient traffic instead of replaying an unbounded day. Cars are
instanced, static crosswalk ink/pole parts merge, and paused views stop buffer uploads.
Crosswalks remain visual; pedestrian routing still avoids roads.

Controlled production-browser input comparison, existing demo (11,871 cells,
770 modules, no passengers, paused, seed 7654321), ground level, plan camera,
1440 × 1000 window, Chrome 155, Windows, RTX 4080 SUPER through ANGLE/D3D11,
28 logical processors. Same fixture/assets/camera on both sides. Three gestures
(two cancellations and one release), including the first invocation:

| Measurement | Before network | After network |
|---|---:|---:|
| First hover, dispatch through two RAFs | 101.8 ms | 86.4 ms |
| First pointer-down, dispatch through two RAFs | 62.7 ms | 61.7 ms |
| First drag move, dispatch through two RAFs | 78.8 ms | 78.6 ms |
| Maximum `setModulePreview` CPU | 1.2 ms | 0.7 ms |
| Release, dispatch through two RAFs | 743.9 ms | 771.8 ms |
| `setStation` CPU on release | 283.5 ms | 301.9 ms |

These are individual local observations, not an FPS improvement or timing gate.
The existing remesh/initial-upload and pedestrian-graph work on release remains a
noticeable stall. Both runs commit once and retain all 770 equipment roots. A
separate `ROAD_INTERSECT=1` run adds a perpendicular road before the gesture: first
hover/down/move 76.9/97.9/93.2 ms, release 790.4 ms, `setStation` 272.0 ms, maximum
preview 1.7 ms, one commit and 770 retained non-road equipment roots. It creates
one junction with both authored roads retained in the document. The crossing run
has one additional fixture road and is not a controlled before/after comparison.

The isolated production crossing check uses two 6 m × 86 m roads plus one manually
placed traffic-light decor, the same browser/GPU/seed, a 1424 × 905 inner viewport
and an isometric camera. It advances 60 simulated seconds (600 calls): 20 directed
edges, one junction, four automatic signals, two road-owned crosswalk assemblies,
24 vehicles at the end. CN/EN first road-system updates: 1.8/1.9 ms; median update
below browser timer resolution, p95 0.1/0.1 ms, maximum 0.2/0.2 ms. These CPU times
include instance writes, not asynchronous GPU completion. Cold `setStation` for
this small fixture is 92.7/77.0 ms and includes street/scene construction.
Turns, waits, static paused buffers, signal lenses and both locales pass with no
runtime or shader failures. No passenger throughput or GPU-time gain is claimed.

Raw reports: `.preview/perf/road-network-before.json`, `road-network-after.json`,
`road-network-crossing.json`, and `road-network/report.json`; PNGs live beside the
last report. Reproduce with `node tools/bench-road-drag.mjs` using `BENCH_OUTPUT`,
then `ROAD_INTERSECT=1` for the extra crossing fixture. `node
tools/check-road-network.mjs` runs the bilingual WebGL and live-traffic check.

Deterministic `road-network` regressions guard cached document scans, bounded
history, actual saturated capacity, full/partial T junctions, merged crossings,
continuous directed connectors, signal exclusion, vehicle tail reservations,
queue body gaps, seed/time behavior, model bounds and decor save/placement.
Focused V8 coverage: `roadNetwork.ts` 100% lines / 91.87% branches / 94.44%
functions; `roadTraffic.ts` 100% lines / 97.59% branches / 100% functions. This
covers source logic, not the GPU. Full game suite: 1,521 passing tests; existing
`test:perf`: 96 passing tests. Production build and i18n audit pass.

Production flat-ground/R/Tab/release input checks pass in both locales. Native
multi-draw and disabled-extension fallback both preserve train geometry with no
GLSL/WebGL/runtime errors. CPU sampling and trace-stream export smoke checks pass.
Logs: `road-network-input-check.txt`, `road-network-render.txt`,
`road-network-render-fallback.txt`, `road-network-profiler-check.txt` under
`.preview/perf/`. The browser crossing check also verifies both palette labels fit,
that the 交通灯 tile arms its own placement tool, and its real model thumbnail loads.


## Right-hand lane arrows and incoming stop lines — 2026-10-15

Two-way rotations 0/2 and 1/3 now keep the same right-hand lane directions.
Connector generation assigns left/right turns only to the driver's corresponding
outer lane while all lanes retain legal through movements. A T stem splits its
lanes; an odd middle lane serves both turns. Painted arrows read those same
connectors, and stop lines span incoming lanes only. Preview arrows read the
candidate lane layout and return before any topology lookup; their flat geometry
merges into one white draw per road. No document commit or worker routing rebuild
occurs during hover, drag or R/Tab refresh.

Deterministic `road-network` tests pin every rotation, one-way reversals, actual
multi-lane connectors, odd/even T splits, multi-direction arrow faces and incoming
stop-line width/side. A module-array proxy refuses topology preparation during
preview, guarding the avoided per-gesture graph work. V8 coverage gives
`roadLaneMovements.ts` and `RoadArrowMarking.ts` 100% line/branch/function coverage;
`RoadModel.ts` has 100% lines/functions and 97.40% branches.

Production browser checks in Chinese and English verify live preview arrows,
R/Tab refresh, real wide-crossing/T meshes, right-hand lane positions, incoming
half-width stop lines and working traffic. The 18 m-wide crossing has 44 edges,
12 lane arrows, four 9 m stop lines and 58 vehicles after 60 simulated seconds;
road-system update p95 is 0.1/0.2 ms (CN/EN), cold update 1.7/3.1 ms. The wide T
has 30 edges, nine lane arrows, three 9 m stop lines and 48 vehicles; p95 is
0.1/0.1 ms, cold update 3.2/2.5 ms. CPU includes instance writes, not asynchronous
GPU work. Both scenes have zero runtime/shader failures and retain paused buffers.
Fixtures: seed 7654321, ground level, isometric camera, 1440 × 1000 Chrome 155
window (1424 × 905 inner viewport), RTX 4080 SUPER / ANGLE D3D11, 28 processors,
no passengers. Timings are observations, not gates or a throughput claim.

The real first road gesture on the unchanged 11,871-cell / 770-module paused demo
records hover/down/first move at 118.6/94.1/100.7 ms through CDP and two RAFs;
maximum preview CPU 0.9 ms, release 1029.4 ms (`setStation` CPU 339.7 ms). One commit,
770 retained equipment roots, zero runtime/shader failures. The existing release
stall remains; these single-run timings do not establish a speed improvement.
Raw report: `.preview/perf/road-markings-drag.json`. Wide scene reports/screenshots:
`.preview/perf/road-markings/` and `.preview/perf/road-markings-t/`; preview captures
are `.preview/roads/preview-{zh-CN,en}.png`. Use `ROAD_WIDE=1`, optionally `ROAD_T=1`,
and `ROAD_NETWORK_OUTPUT` with `tools/check-road-network.mjs` to reproduce.

Validation for this follow-up: all 1,525 game tests pass, production build and i18n
audit pass, native and disabled-extension render checks preserve geometry without
GLSL/WebGL/runtime errors, and CPU/trace exports pass. Focused source coverage is
`.preview/perf/road-markings-coverage.txt`; full test/build/browser logs are under
`.preview/road-markings-*`, with render logs under `.preview/perf/`.

## Node-based road editing — 2026-10-15

Road authoring now caches a node/segment graph by immutable module array. An edit
splits crossings and branches once on release; previews reuse the prepared graph
without commits or worker routing rebuilds. Each press resolves one scene pick.
Node handles share one retained instanced ring mesh, capped at 2,048 handles with
active endpoints prioritized; unchanged previews do not upload their matrices.
Deleting an arm removes one segment, and surviving arms retain their shared node
and pavement. Collinear width transitions use unsignalled traffic connectors.

The real first gesture on the paused 11,871-cell / 770-module demo records
hover/down/first move at 130.4/92.1/100.1 ms through CDP and two RAFs. A warmed
repeat records 78.2/80.7/77.6 ms. Maximum preview CPU is 0.9 ms; release is
1,130 ms (`setStation` CPU 359.1 ms), with one commit and 770 retained equipment
roots. The existing release stall remains. New centreline/cap geometry changes
the workload, so these observations do not establish a before/after speedup.
Fixture: seed 7654321, no passengers, Chrome 155, RTX 4080 SUPER / ANGLE D3D11,
28 processors, 1424 × 905 inner viewport. No runtime/shader failures.
Raw report: `.preview/perf/road-node-drag.json`.

Deterministic `road-document` tests pin shared node lifetime, legacy splitting,
save/load, duplicate links, elevation isolation, width-transition continuity,
snapped placement/deletion, undo/redo, one pick per press, preview isolation,
cache reuse and retained/capped/disposed handle allocations. Focused V8 coverage
gives `roadDocument.ts` 100% lines/functions and 92.5% branches; `Roads.ts` has
100% lines/functions and 80% branches. Full game suite: 1,558 passing tests;
existing `test:perf`: 96 passing tests. Production build and i18n audit pass.

Production input checks pass in both languages for node drags, width/direction
preview changes, endpoint extension, mid-road branches, persistent node handles,
segment deletion and undo/redo. Reports/captures: `.preview/roads/node-*`.
The live crossing regression, native and disabled-extension rendering checks,
and CPU/trace-export smoke checks pass. Logs are under `.preview/perf/road-node-*`;
full-suite/build logs are under `.preview/road-node-*`.


## Outdoor surface placement and street ash (2026-10-15)

`node tools/bench-outdoor-surfaces.mjs` drives the production viewport with CDP
mouse input: first hover, press, first/continued movement and release, followed by
a warmed repeat for each finish. Fixture: 401 bins, no authored cells, no crowd,
paused at z=0, seed 7654321, a 10×10 m patch within the existing ground window.
Chrome 155, 28 logical processors, RTX 4080 SUPER / ANGLE D3D11, 1424×905 inner
viewport. The same fixture/camera was used before and after. A later harness
assertion caught one camera-settling run that placed only 72 tiles; that run was
discarded, damping was disabled and the camera matrix updated before projection.
All reported runs placed exactly 100 tiles; errors are asserted absent.

| Interaction | Before release CPU | After release CPU | Before CDP + two RAFs | After CDP + two RAFs |
|---|---:|---:|---:|---:|
| 人行道 first drag | 226.0 ms | 18.1 ms | 296.2 ms | 81.4 ms |
| 人行道 warm drag | 266.5 ms | 16.2 ms | 316.0 ms | 47.7 ms |
| 草坪 first drag | 243.6 ms | 13.8 ms | 296.8 ms | 49.8 ms |
| 草坪 warm drag | 243.4 ms | 13.6 ms | 293.7 ms | 49.6 ms |

First hover remains approximately 66–69 ms through CDP and two RAFs; first
pointer-down CPU stays approximately 2 ms. Those phases are not claimed as a
speedup. RAF timings include browser scheduling/presentation delay; they are not
GPU timer measurements. Tree visuals changed, but no trees are in this fixture,
so their geometry does not affect this placement comparison.

The old release validated/added each tile against a newly allocated module array,
recreating collision data and assigning posters for every tile. Surfaces also
missed the sim-inert classification, so a 100-tile edit remeshed terrain and
rebuilt every existing equipment model. Baseline `buildModules` took about
107–109 ms; `setStation` about 148–157 ms. CPU profiles also show shader program
initialization and geometry/material allocation churn.

The batch edit now validates against one immutable snapshot, allocates IDs once
and publishes one array. A cached surface index supplies support heights and
occupancy; the indexed verdict preserves floor, track, road and height refusals.
Sidewalk/lawn edits within the existing ground window skip routing and terrain
meshing. All 401 unrelated roots survive by identity; equipment actually lifted
or lowered still rebuilds. Pavers/turf keep the same geometry and colours, but
use one shared vertex-coloured mesh per tile instead of 11/17 individual meshes.
Post-placement station draws fall from 1162/1762 to 162 for sidewalk/lawn.

Expanding the existing ground window still needs terrain and routing updates to
keep the generated street and walk graph aligned. A second 400-bin fixture
without the far extent anchor measures first/warm release CPU of 39.1/40.4 ms
(sidewalk), 25.4/25.5 ms (lawn), retaining all 400 existing equipment roots. This
remaining work is intentional; boundary-expanding edits are not claimed inert.

The street tree now uses an offline EZ-Tree 1.1.0 ash bake: branching trunk and
alpha-cutout leaf clusters, 4.5 m high, two shared meshes (8832 branch and 9600
leaf triangles), one scene-owned leaf texture. The MIT generator is a pinned dev
dependency; no generation happens in a pointer handler. The bake options, source
attribution and license are preserved under `src/assets/trees/`. Its shader and
texture creation are separate from the surface-placement timing above.

Regression coverage: bulk edit read counts, deduplication/no-op/erase, shared
geometry reuse/disposal, immutable index invalidation, indexed/general placement
agreement, supported-equipment rebuilds and unaffected retention, preview/undo,
and real worker acknowledgements without routing rebuilds or paused ticks.
Focused V8 coverage reports 100% lines/functions/branches for the bulk editor,
surface index and both piece builders; TileEquipmentTool has 99.23% lines.
The full game suite passes 1578 tests; the performance suite passes 109 tests.
Production build and bilingual visual/i18n checks pass.

Raw reports/profiles: `.preview/perf/outdoor-baseline-bounded/`,
`.preview/perf/outdoor-profile/` (separate CPU-profile run),
`.preview/perf/outdoor-final-bounded/`, `.preview/perf/outdoor-final-expanding/`.
Source coverage: `.preview/perf/outdoor-perf-tests.log`; full suite/build logs:
`.preview/perf/outdoor-full-tests.log`, `.preview/perf/outdoor-final-build.log`.


Outdoor opening protection follow-up (2026-10-15): sidewalk/lawn use the shared
cached opening verdict to refuse exit floors and ramp holes. Saved surfaces also
skip drawing there, including exits placed after paving; head-houses keep their
fixed stair-landing elevation. Supporting-cell changes invalidate surface models
for dig/restore. The existing production 401-bin, 100-tile benchmark still retains
all 401 roots with zero terrain remeshes: first/warm release CPU 21.6/16.2 ms
(sidewalk), 12.9/12.4 ms (lawn). Raw report:
`.preview/perf/outdoor-openings/report.json`. These are observations, not a new
speedup claim. Tanwei B fixture tests cover both finishes, all rotations and
covered/uncovered exits, plus existing saved tiles, surrounding pavement,
standalone stairs and dig/restore. Full suite: 1582 passes; focused exit/surface
checks and production build pass. Browser capture verifies an unobstructed
wellway and the exit at its original height, without runtime errors:
`.preview/outdoor-openings/tanwei-b.png`.


## 树木 is planting, not structure — 2026-10-15

Planting one 树木 cost about **1.5 s per click** because the trunk fenced its own
walk tile (`buildGraph` → `fenceCells`), which made the placement non-cosmetic in
all three places that decide:

* the worker rebuilt the routing graph (`worker.ts` `build` → `World.rebuild()`);
* `retainedModuleIds` failed closed on the module diff, so `buildModules`
  rebuilt **all 782** module models (measured keep-set: 0 of 770 retained);
* `meshStation` remeshed, because only the inert-decor path skips it.

The rule was never written down — the line arrived inside commit `13f9806`
("Add performant outdoor surfaces and movable trees") under a comment about stair
blocks — and its boundary was inconsistent: the props beside it in 站外装饰
(垃圾桶, 灭火器, 货架, 导向柱, 交通灯, 公交站) are all walked through. A tree is
decoration, so the tile now stays a walk node and `sim/decorInert.ts` lists
`tree` among the inert street props. Its trunk still collides for *equipment*
placement, and its ground window still grows if it is planted past the content
bounds (unchanged shared rule).

Measured with the real production gesture (`node tools/bench-tree-placement.mjs`),
shipped 动物园 demo (11,871 cells, 770 modules, seed 7654321, zero passengers,
paused, plan camera at grade), Chrome 155 / Windows / RTX 4080 SUPER through
ANGLE/D3D11, 1440×1000 window, hardware rendering, dispatch through two animation
frames. Two rows of four plantings: bare street inside the ground window, and the
same on 草坪 tiles. Delete pass uses the real 删除 tool on the last tree.
`SKIP_LAWN=1` drops the pre-laid tiles and steps the row outward instead, which is
the second case below.

A planting **inside** the drawn street window is fully inert:

| Planting one 树木, inside the drawn street window | Before | After |
|---|---:|---:|
| Click → two animation frames | 1,475 ms (1,387–1,656) | **215 ms** (188–237) |
| `setStation` on the main thread | 579 ms | 40 ms |
| `buildModules` (all 782 models rebuilt) | 379 ms | 7 ms |
| `meshStation` | 79 ms | skipped |
| Worker snapshot turnaround | 1,286 ms | 137 ms |

A planting that **widens the drawn plane** (past the content rectangle, which
`groundWindow` measures over every module anchor) still needs its new ground and
its graph — the same rule 草坪 and 人行道 obey, and the reason the inert verdict
asks for an unmoved window. It is still much cheaper, because the model keep-set
(`retainedModuleIds` → `inertDecorRetainedIds`) is deliberately window-agnostic:
every untouched model survives, only the ground remesh and the routing rebuild
remain.

| Planting one 树木 that widens the drawn plane | Before | After |
|---|---:|---:|
| Click → two animation frames | 1,778 ms (1,614–1,974) | **583 ms** (525–695) |
| `setStation` on the main thread | 686 ms (578–760) | 194 ms (168–227) |
| `buildModules` | 444 ms (363–517) | 7 ms (6–8) |
| `meshStation` (the new ground is real work) | 101 ms (91–117) | 77 ms (63–99) |
| Worker snapshot turnaround | 1,495 ms | 537 ms (484–650) |

Drawn geometry is unchanged in both cases: after eight plantings the scene showed
the same +16 draws and +147,552 triangles as before the change, so every new tree
is built and drawn while the rest are retained.

| Delete pass (real 删除 tool) | Result |
|---|---:|
| Click → two animation frames | 236 ms |
| Drawn geometry | −2 draws / −18,444 tris, group gone |

The inert fast path is verified in both directions: eight plantings still drew
their complete geometry, and deleting one tree through the tool removed its group
and its triangles within the same two frames — the trap this fast path once had,
where a deleted piece kept drawing until reload, does not apply here. The 垃圾桶
(174 ms) and 草坪 (164 ms) controls on the same fixture are unchanged, and 售票机
(1,528 ms) still shows the functional class this placement has now left.

Regressions: `outdoor-surfaces` gained "a tree draws without walking: its tile
stays a node and cuts no route" (node identity, node count, every edge at the
planted tile, and a real `PathFinder` leg across it), its existing tree test still
pins placement, equipment collision, save/load and the 4.5 m model;
`worker-preview` now loops `sidewalk`, `lawn` and `tree` through zero
`World.rebuild()` calls and an unchanged paused tick; `performance-policy` asserts
`isSimInertDecorModule`/`isSimInertDecorEdit`/`isCosmeticStationEdit` for a tree.
Raw reports: `.preview/perf/tree-placement-tree.json`, `tree-placement-bin.json`,
`tree-placement-lawn.json`, `tree-placement-tvm.json`, `tree-widening-before.json`
(before) and `tree-inert-after.json`, `tree-inert-delete.json`,
`tree-inert-widening.json` (after). Full suite after the change: 1,592 passing,
plus the two pre-existing failures reported separately below. `npm run test:perf`
passes 117. Production build and typecheck pass.

Unrelated failures present before and after this change, in this working tree
only (both about bridge/track ground indexing, not trees): `outdoor-surfaces`
"indexed surface verdict preserves the general placement rules for floor, track,
roads and elevation" (expects `floor`, the verdict returns `track` under a bridge)
and `performance-policy` "indexed placement preserves opening, track, equipment
and virtual-ground verdicts" (`blockIndex.ground` disagrees with `virtualSolidAt`).
Both reproduce with `sim/station.ts` and `sim/decorInert.ts` reverted
(`.preview/perf/baseline-two-files.log`), so they belong to the working tree's
other uncommitted work.

## Paired demo benchmark — 2026-10-16

Updated `bench:browser` and `bench:sim` to run both bundled examples sequentially.
The browser pair used the same production build, Headless Chrome 155, RTX 4080 SUPER
through ANGLE/D3D11, native multi-draw, DPR 1 and 1384×805 viewport. Zoo opened at
z = -16 (11,871 cells / 4,062 modules); Tanwei opened at z = -7 (14,554 cells /
9,572 modules). Clean browser runs used six-second phases and four edits. A separate
three-second GPU-timed/investigation run isolated render work; its FPS is diagnostic
because the GPU timer and ablations add instrumentation.

| Fixture | Paused FPS, clean | Draws / triangles | Render submission, clean | GPU render, diagnostic |
|---|---:|---:|---:|---:|
| Zoo | 38.3 | 5,243 / 3,759,887 | 25.4 ms | 21.8 ms |
| Tanwei | 19.7 | 10,250 / 4,781,505 | 49.3 ms | 48.7 ms |

Tanwei reproduces the under-20 paused rate. Crowd and train update CPU are each
under 0.02 ms/frame while paused. After population warmed to 573, paused FPS was
20.4; hiding both crowd and trains measured 20.2 FPS, with GPU time 39.1 / 39.8 ms.
The 5,551 sidewalk draws dominate Tanwei's draw inventory, followed by 952 equipment
batch draws and 822 platform-edge draws. This points to static station rendering and
GPU work, rather than simulation ticking, as the paused bottleneck. FPS varies with
the browser frame scheduler; these results describe this fixed local setup.

The simulation/build CPU pair also completed: graph sizes 15,127 / 37,274 nodes;
settled tick means 4.48 / 28.16 ms and morning-peak means 4.92 / 37.74 ms (Zoo /
Tanwei, 600 samples each). Tanwei's paused FPS issue is separate from these active
simulation timings.

Clean reports/captures: `.preview/perf/paused-pair-clean-zoo.json`,
`.preview/perf/paused-pair-clean-tanwei.json` and their PNGs. GPU ablations:
`.preview/perf/paused-pair-latest-zoo.json` and
`.preview/perf/paused-pair-latest-tanwei.json`. Simulation reports:
`.preview/perf/sim-zoo.json` and `.preview/perf/sim-tanwei.json`.

## Retained outdoor batches and paused frames — 2026-10-16

Sidewalk/lawn now share a scene-owned vertex-colour material and join the existing
16 m equipment buckets. Trees join those buckets too. Identical static geometry
uses instances even in ghost views; transparent instances sort by their transformed
surface centres before submission and retain unchanged matrix buffers. Original
module roots, detailed picking surfaces and storey/clip policies remain in place.
Unchanged buckets retain their GPU allocations, and pickup/cancel masks the affected
bucket without rebuilding it. The instance path no longer creates baked geometry
copies that it would immediately discard.

Each outdoor instance bucket also retains detailed and distant geometry. Tiles use
a raised coloured slab below 10 logical pixels per metre; trees use the derived ash
bake below 45 pixels per tree, with 20% hysteresis. The conservative screen-size
test uses the nearest edge of the chunk bounds and supports perspective/orthographic
cameras. Close views restore the authored geometry; picking and culling retain its
original bounds. The offline tree derivative keeps intact leaf UV cards and canopy
extrema (1,035 branch / 4,812 leaf triangles versus 8,832 / 9,600 originally).

Paused, settled frames reuse the existing canvas. RAF still services controls and
artwork timers, while rendering wakes for camera/projection changes, edits, ghosts,
view/clip changes, artwork, worker snapshots, interpolation and context restoration.
Running simulation continues rendering normally. The benchmark explicitly forces
continuous submissions for throughput phases and records actual `renderedFrames`
in `pausedIdle`; the idle RAF FPS is responsiveness cadence, not freshly drawn FPS.
`--compare-detail` adds an unchanged-geometry throughput phase for isolating batching.

Validation: 1,626 full-suite tests and 128 focused performance tests pass. New
deterministic regressions cover 1,024 tiles becoming four chunks, retained buffers,
source-layer picking, pickup/cancel, ghost order, LOD reuse/bounds and exact disposal,
and framebuffer wake policy. Source coverage is 100% lines/functions/branches for
`renderDemand.ts` and the outdoor piece builders; `staticInstances.ts` has 100%
lines/functions and 91.67% branches. This is source coverage, not GPU coverage.
Production checks exercise both demos' idle/wakeup/pick/edit/undo/resume paths and
the native/disabled-extension shader paths. Raw reports, captures and validation
logs are under `.preview/perf/static-cache/`.

The final clean pair used six-second phases / four edits and the same seed, browser,
GPU, viewport and opening storeys as the baseline above. These FPS results force
continuous drawing, so framebuffer reuse cannot inflate the comparison:

| Fixture | Before FPS | After, full original detail | After, automatic distant detail | Draws before → after |
|---|---:|---:|---:|---:|
| Zoo | 38.3 | 53.5 | 59.3 | 5,243 → 2,271 |
| Tanwei | 19.7 | 31.6 | 32.9 | 10,250 → 4,038 |

Full-detail triangles remain exactly 3,759,887 / 4,781,505 (Zoo / Tanwei), isolating
batching from geometry reduction. Automatic detail draws 1,883,633 / 2,941,200
triangles in those same views. Normal paused idle submitted 11 / 14 frames during
six seconds with periodic TV artwork still enabled, compared with 356 / 198 forced
continuous frames. Isolated settled tests with TV swaps held scheduled submit zero
frames and verify camera, preview, view, cut, artwork, edit, undo and resume wakeups.

Cold application readiness was 3.30 / 3.37 s; Zoo fixture readiness 6.60 s from
navigation and Tanwei opening 4.93 s after readiness. These local startup samples
are not a WAN measurement or a demonstrated startup improvement. Tanwei structural
edits still take hundreds of milliseconds, and running-service CPU/crowd work is
separate from paused rendering; this change does not claim to resolve those stalls.

Baseline reports: `static-cache/before-clean-{zoo,tanwei}.json`; final clean reports
and PNGs: `static-cache/after-clean-final-{zoo,tanwei}.{json,png}` under
`.preview/perf/`. GPU diagnostic reports are
`static-cache/after-gpu-final-{zoo,tanwei}.json` (separate three-second timer runs).

| Fixture | GPU mean before | GPU mean after, full detail | GPU mean after, automatic detail | GPU p95 before → automatic |
|---|---:|---:|---:|---:|
| Zoo | 21.8 ms | 13.6 ms | 11.2 ms | 29.1 → 12.2 ms |
| Tanwei | 48.7 ms | 21.9 ms | 20.8 ms | 68.4 → 24.9 ms |

The full-detail control preserves original triangles and accounts for most of the
gain. Automatic detail reduces GPU time further without changing the close view.
Settled automatic-detail phases report zero buffer uploads (textures/uniforms are
not included in that counter). Tanwei still spends about 28–29 ms in render
submission with roughly 4,000 remaining draws: CPU/driver submission and ghost
rendering remain limits to continuously drawing 60 FPS. GPU and submission timings
overlap and must not be added. Host variation remains visible in the ablations,
so their small FPS differences are not speedup claims.

## Paused building: first and repeated Q/E — 2026-10-16

The reported Q/E interaction still stalled despite retaining a paused framebuffer.
`bench:levels` now drives eight real CDP key presses (`E Q E Q E Q E Q`) on
**both** demos, paused and settled for three seconds. It records the first press,
six warmed repetitions (presses 3–8), slice/batch/model/save work, exact GPU batch
identity on revisits, loading/preparation cost and unchanged simulation ticks.
`--uncached` disables view retention and prewarming in the same production bundle;
`--no-multi-draw` exercises the GPU extension fallback. Raw reports live in
`.preview/perf/levels-*.json`.

### Cause and changes

Q/E did **not** rebuild the source models, commit the document, rebuild routes or
write autosave. It did restore source meshes, traverse the whole station, rescan
UVs/transforms and create new opaque/ghost render batches on every press. In the
original Tanwei trace this consumed 185–254 ms per press, before drawing.

- Retain four recent level views, including the active view. Unchanged batch
  entries are shared between them. Revisited views restore their existing GPU
  objects and picking layers without traversing world matrices, inspecting UVs,
  baking geometry or uploading new batch buffers.
- Bound retained resources and dispose entries exactly once when no live view
  references them. New/changed module roots, transforms, appearance toggles,
  document edits and clipping membership invalidate dormant views. Moving a module
  still masks its combined draw and restores its neighbours.
- Prepare the deepest chunk storey and the next editing storey during opening.
  A disposable 1×1 offscreen target populates renderer buffers/programs without
  showing temporary levels; the active slice and render target are restored in
  `finally` blocks. Ordinary edits do not prewarm the station.
- Complete poster, line-map and pictogram decoding with **one** model refresh,
  then prewarm. Three independent completion callbacks previously allowed repeated
  station rebuilds and could discard a just-prepared view. A deferred opening only
  runs if it still belongs to the current document. Four slots also accommodate a
  late worker ready response visiting an intermediate level during loading.
- Extend periodic autosave from 10 seconds to **five minutes**. Document switches
  still invalidate/replace the saved station immediately, and page hide/leave still
  flushes dirty edits. Level changes never dirty the document.

### Controlled browser result

Sequential hardware runs, fresh Chrome 155 profiles, Windows ANGLE/D3D11 on NVIDIA
RTX 4080 SUPER, device/pixel ratio 1, actual canvas **852×715**. Zoo has 11,871 cells
and 4,062 modules; Tanwei has 14,554 cells and 9,572 modules; shipped seed 7654321.
Opening worker levels are −16 and −7 respectively; Q/E alternates with −12 and −3.
These are empty-crowd building measurements: population and simulation tick are zero.
Input latency is keydown to the second RAF callback, including the changed scene's
render submission; it is not an asynchronous GPU timer or a steady-state FPS test.

| Fixture | First Q/E, uncached → cached | Repeated Q/E mean | Batch CPU mean per press | Fixture loading, uncached → cached |
|---|---:|---:|---:|---:|
| Zoo | 246.8 → 85.2 ms | 147.7 → 26.5 ms | 108.1 → 2.1 ms | 4.34 → 5.34 s |
| Tanwei | 331.1 → 98.9 ms | 288.5 → 39.9 ms | 234.2 → 5.2 ms | 5.95 → 7.20 s |

The first press hits a prepared batch view in both fixtures. Every revisited view
retains **all** of its batch object identities. All eight paired levels have exact
matching draw and triangle counts: the speedup does not hide geometry. No key press
rebuilds models, calls `setStation`, writes autosave or advances the paused tick.
Native reports: `levels-final.json`, `levels-paired-uncached.json`; checked numeric
comparison: `levels-comparison.json`. The earlier reproduction is `levels-before.json`.

Preparation itself took 1.83 s for Zoo and 2.52 s for Tanwei in these runs; some of
that overlaps worker loading. Loading is **slower** by about 1.0/1.2 s in this pair.
At the end, three views retain 1,452/1,887 unique batch objects (shared across views),
versus 565/922 in the active lowest storey. Four-view retention is a bound, not a
fixed memory budget: larger stations still require more GPU memory. First visits
to other, unprepared/evicted levels and the first visit after an edit still perform
batch preparation. The first rendered visit can still pay driver/presentation work.
This change removes repeated preparation stalls; it does **not** reduce the remaining
full-station GPU/driver cost during continuous camera movement or guarantee 60 FPS.
The Q/E pair does not establish populated-simulation FPS; the preceding section's
separate GPU/throughput measurements cover that workload.

Deterministic regression: `test/level-view-cache.test.mjs`, using 1,024 modules,
checks no source matrix walk or atlas resolve on cached Q/E, complete batch identity
retention, transform/appearance/clip invalidation, move masking, four-view eviction,
single disposal, failed prewarm restoration and the opening/artwork source wiring.
Autosave regression additionally pins the five-minute interval and level-only state
remaining clean. Full suite: **1,630 passing**; performance suite: **132 passing**.
EquipmentBatches coverage is **100% lines / 95.24% functions / 98.53% branches**.
The extension-disabled Q/E run also passes first-hit and full revisit allocation
assertions for both demos: first presses 82.8/114.4 ms, repeated means 27.8/39.6 ms
(Zoo/Tanwei), with zero JS/shader/GL errors (`levels-fallback.json`). Production
build/typecheck passes with the existing bundle-size warning.
Native and extension-disabled static-rendering checks pass on both demos: zero
settled idle draws, 13 visible wakeups each, source picking, move/cancel retention,
delete/undo and resumed ticks, with no JS/shader/GL errors. The latest Tanwei
screen was inspected against the earlier capture; storey appearance is retained.
The production batching check also passes with/without multi-draw: station calls
3,597 → 1,022 / 1,715, train calls 814 → 25 / 630, unchanged train triangles and
no shader/runtime/GL errors.

## 2026-10-16 — floor-aware geometry detail and graphics settings

Eligible fixture geometry now has a cached meshoptimizer approximation prepared
during model loading/building, targeting 25% of indices with 2% relative geometric
error and UV weights. Unproductive reductions retain the original. Source bounds,
UV/material attributes, picking IDs and full picking geometry are preserved.
Static GPU batches reserve both variants; transitions swap geometry references or
instance geometry IDs without rebuilding the station or uploading new geometry.
Stationary cameras skip the batch detail walk. A third authored tree approximation
uses 1,353 triangles, versus 5,847 medium and 18,432 full.

High quality uses projected-size detail (24 CSS pixels with hysteresis) on current
floor fixtures and forces reduced geometry on visible other floors. Low quality
also reduces eligible current-floor geometry. Chunk surfaces, opaque train parts
and unbatched animated equipment follow the floor policy while retaining source
picks and live rig references. Hide UI restores full visible geometry. Existing
floor visibility, wall/ground/roof toggles and frustum culling still determine what
is visible. Skinned/morph geometry, custom shaders, alpha-cut surfaces without an
authored alternative and already minimal meshes retain their original geometry.
Train and crowd detail were not part of that pass; both follow this same floor and
quality policy now — see “Low LoD for trains and the crowd” below.

The top-right FaGear dropdown owns labelled restart/report-issue/language actions
and 低画质/高画质. The language action displays the opposite native language.
Quality persists locally outside station saves, undo and worker routing. This is
geometry quality; output pixel ratio and texture resolution are unchanged.

New deterministic regressions cover source immutability, UVs/bounds, approximation
cache/disposal, isolated fixtures, retained batch allocations, sorted transparent
instances, source picking, moving equipment/train rig identity, full restoration,
floor/quality policy and preference persistence. The full game suite passes
**1,644 tests**; production build/typecheck and the i18n audit pass. Raw profiles,
paired reports, screenshots and validation logs are in ignored `.preview/perf/`.

`test:perf` passes **146 tests**. Coverage (line / branch / function):
geometryDetail **100 / 92.86 / 90.91%**, equipmentBatches **100 / 97.40 /
97.22%**, sourceGeometryDetail **100 / 95.24 / 100%**, staticInstances **100 /
89.13 / 100%**; detailPolicy and preference persistence are **100% throughout**.
ChunkSystem's new detail/picking/restore path is exercised; its overall **28.53%**
line coverage reflects the much larger mesher excluded from this focused suite.
TrainSystem is **92.59%** lines. Node coverage does not establish GPU correctness.

### Final controlled throughput comparison

Command: `BENCH_SECONDS=4 BENCH_EDITS=2 node tools/bench-demos.mjs browser
--compare-detail --lod-only --gpu-timer --screenshot`, sequential, no tests or
builds running. Fresh Chrome 155, RTX 4080 SUPER / ANGLE D3D11, native multi-draw,
1384×805, DPR/output ratio 1, seed 7654321, paused population 0, original camera,
Zoo -16 m (11,871 cells / 4,062 modules), Tanwei -7 m (14,554 / 9,572).
Each scene alternates full/high/full/high, then low quality; visibility is the
same in each phase. Full detail disables geometry detail only, retaining batching.
GPU times below are asynchronous timer-query means; ranges show both repetitions.

| Demo / policy | Triangles | Draws | GPU mean ms | Continuous FPS |
|---|---:|---:|---:|---:|
| Zoo full | 3,759,887 | 2,271 | 14.24–15.13 | 50.2–52.7 |
| Zoo high | 1,140,143 | 2,271 | 13.11–13.58 | 54.2–54.7 |
| Zoo low | 1,113,181 | 2,271 | 11.51 | 59.7 |
| Tanwei full | 4,781,505 | 4,038 | 24.34–30.21 | 24.9–30.6 |
| Tanwei high | 2,280,713 | 4,038 | 22.78–30.91 | 24.4–32.1 |
| Tanwei low | 2,234,951 | 4,038 | 24.09 | 30.6 |

High quality reduces submitted triangles **69.7% / 52.3%** (Zoo/Tanwei).
Zoo improves in both paired samples. **Tanwei does not show a consistent FPS or
GPU-time gain**: one pair slightly regresses, the repeat improves. Its high-detail
CPU submission means remain 29.7–39.2 ms with 4,038 calls; reducing topology alone
does not remove that cost. Low versus high has little remaining geometry to save
at this initial floor/camera. These are short local samples, not a stable FPS
guarantee. Earlier zoomed probes (`equipment-lod-far-final-*`) likewise did not
establish a Tanwei speedup; fog also makes those far-camera screenshots unsuitable
for judging visible model detail. Final screenshots use the original camera or
modest real wheel input.

### Per-model geometry detail inventory

Triangle counts below are for one model built from each palette option's default configuration. High is the full model geometry; Low uses the renderer's reduced geometry wherever that model part has a supported approximation, and keeps unsupported parts at full detail. These are model triangles, not totals across all placed copies. Width, length, style and material controls can create additional variants; the table lists the 119 shipped palette options.

| Equipment / decor model name | Low triangles | High triangles |
|---||---:|---:|
| tree | 396 | 18432 |
| shelf-cooler | 420 | 9852 |
| shelf-cooler-dark | 420 | 9852 |
| bridge | 732 | 9588 |
| shelf-white-tall | 240 | 7556 |
| shelf-dark-tall | 240 | 7244 |
| shelf-wire | 412 | 6524 |
| cubicle | 84 | 5688 |
| cctv-dome | 360 | 5208 |
| walkway | 496 | 5162 |
| cctv-post | 376 | 5096 |
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
| clock | 212 | 1940 |
| cctv | 124 | 1888 |
| stair-straight | 620 | 1796 |
| lift | 468 | 1488 |
| electrical-cabinet | 36 | 1224 |
| extinguisher-glass | 134 | 918 |
| exit-covered-1 | 346 | 902 |
| exit | 346 | 902 |
| exit-covered-3 | 346 | 902 |
| roof-canopy | 328 | 840 |
| tactile-warning | 12 | 812 |
| fence-iron | 256 | 768 |
| checkout | 104 | 750 |
| gate-new | 130 | 720 |
| rail-signal | 144 | 708 |
| vending | 200 | 676 |
| gate | 162 | 668 |
| desk | 212 | 652 |
| pillar-thick | 576 | 576 |
| exit-uncovered-2 | 150 | 554 |
| exit-uncovered-3 | 150 | 554 |
| exit-uncovered-1 | 150 | 530 |
| fence-gate | 100 | 432 |
| roof-tapered | 396 | 396 |
| tvm | 372 | 372 |
| busstop-long | 372 | 372 |
| fence | 68 | 360 |
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
| extinguisher | 50 | 146 |
| extinguisher-compact | 50 | 146 |
| door-wood-1 | 144 | 144 |
| sidewalk | 12 | 132 |
| tv | 114 | 114 |
| noise-barrier | 52 | 108 |
| noise-barrier-half | 52 | 108 |
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
| exit-virtual | 46 | 60 |
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
| exit-doorway-1 | 10 | 26 |
| exit-doorway-2 | 10 | 26 |
| exit-doorway-3 | 10 | 26 |
| exit-doorway-4 | 10 | 26 |
| roof-shell | 24 | 24 |
| noise-barrier-railing | 16 | 24 |
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

Final reports: `.preview/perf/graphics-verified-{zoo,tanwei}.json` and PNGs. No
console/shader/runtime errors. Tanwei phase buffer updates were 0–4 calls / 0–140
bytes, unrelated to geometry swaps; no large geometry uploads occurred in the
measured phases. Fixture-ready times were collected separately from throughput;
Tanwei's built-in example load was 7.28 s. Preparing approximations adds cold-load CPU and
retains both geometry variants, trading memory/startup work for cheap transitions.
Paused-idle RAF frequency is not render FPS: settled idle checks report zero draws.

### Real Q/E and GPU validation

`graphics-levels-verified.json` drives eight actual E/Q key events per demo,
including the first press. First key-to-two-RAF latency is **99.1 / 97.1 ms**
(Zoo/Tanwei); warmed repeated means **40.4 / 41.7 ms**. Average batch sync CPU is
**4.0 / 7.2 ms**. First presses hit views prepared during opening; all revisited
views retain every batch, with ticks held at zero and no JS/GL errors. This stays
near the earlier cached Q/E result; geometry detail does not remove that first
presentation delay. Example load including preparation measured **5.63 / 8.69 s**,
of which preparation/upload was **1.77 / 3.02 s**. Counts/timings are recorded
separately from the throughput run because the input harness adds work counters.

`geometry-detail/{native,fallback}/report.json` passes both demos: labelled settings,
quality without station/tick changes, opposite-language switching, Escape dismissal,
full Hide UI restoration, real first/repeated wheel events, unchanged GPU batch
identities, unchanged draw counts across fixture LoD and zero shader/runtime/GL
errors. Settings and station screenshots were inspected. Static-rendering checks
pass both backends/demos: **zero settled idle draws**, 13 view wakeups, exact source
picking, move/cancel, delete/undo and resumed simulation. CPU/trace export smoke
checks pass. These checks establish correctness, not an FPS threshold.
Final production batching checks also pass: native station calls 3,597 → 1,022
and train 814 → 25; fallback 3,597 → 1,715 and 814 → 630, unchanged open/closed
train triangles and no shader/runtime/GL errors (`graphics-batching-*-final.log`).

## 2026-10-16 — authored Low models for fixtures and circulation

The per-model table above now includes authored alternatives for every requested
shelf, restroom fixture, CCTV, electrical cabinet, AC unit, warning tactile tile,
bridge track, escalator, walkway, lift and stair shape. Regenerate its complete
117-option JSON/Markdown inventory with `node tools/model-triangle-inventory.mjs`.
All 117 full-model triangle totals match the earlier raw inventory.

Shelves omit products, price labels and fine fittings. Cubicles retain the enclosure
and omit sanitary fit-out; sinks retain an eight-sided hollow bowl/pedestal and
simple tap. Cameras use low-segment housings and omit small IR emitters/trim.
Cabinets retain the base, body and coloured fascia; AC retains its shell, grille
panels and simple fan caps. Tactile plates omit dots. Track retains bed, sleepers,
rails and power structures while omitting clips, anchor bolts and rail seats.
Ramps retain animated tread matrices but use thin surfaces, simpler newels and no
nosing/riser hardware. Lifts keep shaft/cabin/door movement and omit clamps, narrow
trim and instruments. Stair flights keep tread/riser surfaces and simpler curved
returns; stair blocks omit underside and internal end faces.

`render/modelDetail.ts` owns explicit geometry selection and source-owned disposal.
Full picking meshes/instance IDs, material state and live rig objects remain intact.
Local batching merges both full and reduced geometry; cross-model instancing checks
both variants for equality. Current-floor projected detail, other-floor detail,
Low forcing reduced geometry and Hide UI restoring full geometry keep their policies.
No model is rebuilt or uploaded when its prepared geometry variant changes.

The final production run used Chrome 155 / RTX 4080 SUPER / ANGLE D3D11, native
multi-draw, 1384x805, output ratio 1, seed 7654321 and paused population 0.
Zoo had 11,913 cells / 4,062 modules at -16 m; Tanwei had 14,717 / 9,572 at -7 m.
Command: `BENCH_SECONDS=2 BENCH_EDITS=2 node tools/bench-demos.mjs browser
--compare-detail --lod-only --gpu-timer`. Each scene alternates full/high/full/high,
then Low with identical visibility/camera/population. Ranges show both repeats.

| Demo / policy | Triangles | Draws | GPU mean ms | Continuous FPS |
|---|---:|---:|---:|---:|
| Zoo full | 3,760,543 | 2,271 | 11.44–14.88 | 51.5–60.0 |
| Zoo high | 901,447 | 2,271 | 10.63–10.70 | 58.9–59.9 |
| Zoo low | 779,221 | 2,271 | 11.92 | 57.4 |
| Tanwei full | 4,784,113 | 4,039 | 24.45–26.34 | 27.2–30.0 |
| Tanwei high | 1,670,311 | 4,039 | 22.75–23.67 | 30.2–31.0 |
| Tanwei low | 1,396,365 | 4,039 | 22.88 | 31.0 |

These are short samples. The extra Low reductions do not establish a consistent
throughput gain over High: Tanwei still spends about 31 ms in CPU submission with
4,039 calls. Lower topology helps GPU work but does not eliminate that cost. The
initial baseline used the pre-existing built demos (11,871 / 14,554 cells), which
differ from current committed fixtures; do not treat those before/after FPS values
as a controlled comparison. Raw before/after reports remain in ignored
`.preview/perf/authored-low-{baseline,final}-{zoo,tanwei}.json`.

Validation: production build passes; 33 new authored-model regressions pass.
`test:perf` passes 179 tests. Coverage line / branch / function: modelDetail
100 / 92.86 / 100%, batchStaticModule 100 / 95.92 / 100%, equipmentBatches
100 / 97.87 / 97.22%, sourceGeometryDetail 100 / 100 / 100%. The full suite is
1,676 passing / 1 failing: `demo.test.mjs` expects 14,554 Tanwei cells while the
committed fixture already contains 14,717 (confirmed in HEAD). The unrelated
fixture assertion is unchanged. Native production geometry checks pass for both
demos, including settings, full restoration, retained GPU allocations and no
JS/shader/WebGL failures. Logs and screenshots are in ignored `.preview/perf/`.

The extension-disabled geometry check also passes both demos. Close-up production
captures under `.preview/perf/authored-low-models/` were inspected for empty shelves,
simple hollow sinks, camera housings, escalator bands, lift shafts and stair
surfaces; every capture reports GL error 0. They use placed demo variants, whose
dimensions/materials can differ from the catalogue defaults in the table.
Real Q/E (`authored-low-levels.json`) retains cached batches for every revisit with
no JS/GL failures. First key-to-two-RAF latency is 123.5 / 173.3 ms (Zoo/Tanwei);
repeated means 37.3 / 56.3 ms, average batch CPU 3.4 / 7.1 ms, and initial prewarm
1.92 / 2.92 s. These timings do not establish a first-switch latency improvement;
the deterministic cache/allocation work assertions still pass.

Production batching validation passes with and without native multi-draw: station
calls 3,597 to 1,022 / 1,715; train calls 814 to 25 / 630, preserving open/closed
train triangles and reporting no GLSL/WebGL/runtime failures. Logs are
`authored-low-batching-{native,fallback}.log` under `.preview/perf/`.

## 2026-10-16 — smaller tree and clock approximations

The default tree Low/far mesh is 396 triangles (previously 1,353; full 18,432).
Its baked six-sided main trunk follows alternate source longitudinal rings so it
remains connected from ground to canopy. Retain every thirty-second intact crossed
leaf card plus canopy extrema, expanding retained cards up to 3x inside the original
canopy bounds. The middle tree level remains 5,847 triangles. An initial 40 cm
clustering attempt erased the thin lower trunk in production close-ups; it was
replaced by the connected trunk before completion. The static-rendering regression
now pins a 400-triangle budget, ground-to-canopy extent and connected indexed faces.

Clock Low is 212 triangles (previously 1,870; full 1,940). It keeps both readable
faces and live simulation-time hands, with a twelve-sided case, six-sided hubs,
flat hour marks and hands; minute ticks are omitted. Source picking, live pivots
and retained geometry restoration are covered before/after local batching.
All 117 full-model triangle totals match the original inventory. Both tables retain
their descending High-triangle ordering; regenerate with the inventory tool.

Production close-ups were inspected with opaque tree source materials (the placed
demo tree starts on a ghosted floor). The trunk, foliage and clock face render
correctly with GL error 0. Low draw counters report 720 triangles for the tree,
including the renderer's two passes over double-sided leaves, and 212 for the
clock. Model inventory counts each leaf triangle
once. Captures and logs live in ignored `.preview/perf/tree-clock-models/` and
`tree-clock-visual-final.log`. These counts do not establish a station FPS gain.

Validation: build passes; `test:perf` passes all 181 tests, with ClockModel and
TreeModel each at 100% line/branch/function coverage. Full suite: 1,679 pass, one
existing Tanwei cell-count failure (14,717 fixture cells vs 14,554 expected).
Final logs use `.preview/perf/tree-clock-{build,tests,coverage}-final.log`.
The native production geometry check passes both paused demos: first Low click to
two animation frames is 25.7 / 54.7 ms (Zoo/Tanwei), and first/repeated wheel zoom
is 16.7/17.2 and 35.4/41.5 ms respectively. Cached GPU batches are retained and
full geometry returns with Hide UI/detail restoration; there are no JS/shader/GL
errors. This is a correctness/interaction sample without a controlled timing
baseline. Report: `.preview/perf/tree-clock-detail/native/report.json`; the
ignored checker extends `tools/check-geometry-detail.mjs` with first-toggle timing.

## 2026-10-16 — Low cabinets, furniture, gates, fences and exits

Authored Low alternatives now cover all 22 requested catalogue variants. The
117-row table above and the performance skill have been regenerated in descending
High order. All 117 High counts still match the original inventory. Raw inventory:
`.preview/perf/fixtures-low-models.json`.

Standard/compact extinguishers retain the labelled cabinet, with an apron replacing
four tiny feet (50 triangles); the glass cabinet retains its shell, empty shelves,
door frames and labels (134). Checkout omits stock, tiny peripherals and fittings
but retains its counter, empty rack and POS (104). Desk keeps its workstation,
screens and chair with one continuous back instead of ten slats (212). Vending
keeps colourful drink silhouettes as thin panels and omits bottle caps (200).
Fences retain their neighbour-derived runs and glass/iron structure, using
four-sided tubes without clamps (68 / 100 / 256 for glass / gate / iron).
Fare gates retain indicators and live opposing leaves, using a simple case/crown
and flat coarse leaf shapes (162 old / 130 new).

Covered exits preserve the full wave profile, floor openings, glazing and printed
header, using thin roof/glass surfaces and omitting intermediate frames/lighting
(346). Uncovered exits retain corner/end posts, top rails and glazing (150).
Wall exit panels retain front/back faces and artwork (10); the virtual pillar
omits its small base and hidden internal caps (46). `panelModelDetail` preserves
both broad panel faces. Approximation bounds contain both original and reduced
geometry, including combined cabinet feet and chair backs; the source geometry
continues to own picking and approximation disposal. These variants are prepared
when a model is built and keep its existing geometry/rig objects when swapped.

Production close-ups for all 22 variants were captured and inspected under
`.preview/perf/fixtures-low-models/`, with GL error 0 throughout. The gallery
uses default catalogue configurations in the production renderer; glass retains
its transparency and exit shots face the printed header. Log:
`.preview/perf/fixtures-low-visual.log`. Triangle inventory counts geometry once;
renderer counters also include material passes over double-sided glass/leaves.

Build passes. `test:perf` passes 210 tests; after adding joined-fence and doorless
gate cases, the focused suite passes all 75 tests. Model-detail coverage is 100%
lines/functions and 93.10% branches in the full performance run. Checkout, desk,
extinguisher and vending each have 100% line/branch/function coverage; doorway
exit 100/80/100%, exit 92.31/77.05/93.75%. Gate reaches 98.58/91.18/100% in the
focused run. Coverage logs are `fixtures-low-{coverage,focused-coverage}.log`.
The full suite run has 1,707 passes and two unrelated failures: the existing
Tanwei fixture count, and a legacy worker-frame fixture missing new history
fields in the concurrently edited SimSlice (`fixtures-low-tests.log`).

Native production checks pass both paused demos, retaining GPU batches and
restoring full geometry after detail/Hide UI changes, without JS/shader/GL errors.
First Low click to two animation frames: 26.1 / 56.7 ms (Zoo/Tanwei). First and
repeated wheel input: 24.3/23.7 and 41.9/48.4 ms. Default-camera Low draws report
545,443 / 1,112,809 triangles. This is one correctness/interaction sample with
no controlled FPS or latency improvement claim. Raw report:
`.preview/perf/fixtures-low-detail/native/report.json`.

The same production check passes with multi-draw disabled for both demos, with
retained allocations, exact full restoration and zero runtime/GL errors. Fallback
reports/captures are in `.preview/perf/fixtures-low-detail/fallback/`; no FPS
threshold or cross-run timing comparison is inferred from these checks.

## 2026-10-16 — Low rail signals and noise barriers

Rail-signal Low is 144 triangles (full and previous Low 708): keep all three
aspect materials/positions, eight-sided lenses and front rims, four-segment visor
shells, concrete support and head boxes; omit the small side equipment box.
Full and half-height noise barriers are 52 triangles (previously/full 108), and
the simple railing is 16 (previously/full 24). Panels and middle rails retain
both broad faces; top beams retain their 3D thickness with small end caps omitted.
Simple railing posts also omit their hidden end caps. An initial flat top-bar
attempt looked detached from its post in close-ups and was replaced by the
four-side-face beam approximation before completion.

The shared bridge builders keep every original bay, upright, gantry exclusion and
3 mm glazing clearance. They prepare the same Low geometry for bridge-generated
and separately placed barriers. Default bridge Low falls from 788 to 732 triangles
as a result. The 117-row inventory and performance skill remain sorted by High
descending, with all High counts unchanged. Raw inventory:
`.preview/perf/signal-barrier-models.json`.

`model-detail` now pins the four budgets, three visible signal aspects and exact
lamp picks, all barrier rotations, long runs with/without catenary and neighbour
posts, batching, retained geometry restoration and beam end-cap picking on all
three axes. All 96 focused tests pass. Build passes; the full suite has 1,747
passes and the existing Tanwei fixture-count failure (14,717 vs 14,554 cells).
Logs: `.preview/perf/signal-barrier-{focused,build-final,tests-final}.log`.

All four default models were captured at full/Low in the production renderer and
visually inspected, including the retained beam thickness and visible lower red
aspect. Every capture has GL error 0. Raw renderer counters are 708 -> 144 for
the signal, 132 -> 60 for each glazed barrier (includes double-sided glass
passes), and 24 -> 16 for the railing. Captures/log:
`.preview/perf/signal-barrier-models/` and `signal-barrier-visual-final.log`.
These per-model counts do not establish a station FPS improvement.

The final performance suite passes all 242 tests. RailSignalModel,
BridgeNoiseBarrier and BridgeRailing each have 100% line/branch/function coverage;
modelDetail has 100/93.33/100%. Coverage log:
`.preview/perf/signal-barrier-coverage-final.log`.

## 2026-10-17 — Low LoD for trains and the crowd

The B stock visual revision keeps the same shell and door cadence, with a single
cab shield and three inset windows per side per car. Its revised High/Low totals
are reflected below; raw counts are regenerated by `tools/model-triangle-inventory.mjs`
in `.preview/perf/train-triangles.json`. Low preserves each window aperture and
rubber surround with fewer corner segments.

Rolling stock and passengers had no authored Low approximation. A train's per-mesh
meshopt fallback was consumed by static batching, so a drawn consist stayed at
96.7–97.2 % of full for A/B/C/L, and every passenger submitted the padded shared
stride (9,370 triangles) even though most variants are 4,000–6,000. Both now have a
prepared Low form driven by the existing quality/storey policy.

Trains: every part whose builder can describe a faithful reduction attaches one
through `render/modelDetail.ts` — cabin straps, handrails and centre poles as
four-sided tubes on a six-segment path, ring lights as a twelve-sided torus, benches
and seat-end guards as one envelope, the car roof at four curve segments, eight-sided
profiled wheel tyres/webs with simplified bogie frames and omitted small hardware, the bellows at 8×16, and the D car's plug doors, cab shell and
paint faces at 3×8 / 16×32 / 12×32. `batchStaticParts` merges both variants so a
batch carries its own Low geometry; `batchTrainDoors` and `batchTrainTransparent`
reserve a Low leaf and Low panes; `render/trainDetail.ts` applies the swaps, keeps
the exact sources for picking and restores them before disposal. Generic
simplification is now limited to `TRAIN_DETAIL_MAX_RADIUS` (8 m): a merged car body
spans a whole consist, and 2 % of 150 m is metres.

| Consist | Full triangles | Low triangles | Low share |
|---|---:|---:|---:|
| D-8 | 1,303,040 | 129,856 | 10.0 % |
| D-6 | 1,007,764 | 104,804 | 10.4 % |
| A-8 | 730,144 | 166,648 | 22.8 % |
| A-6 | 573,968 | 126,080 | 22.0 % |
| C-6 | 534,612 | 112,648 | 21.1 % |
| B-6 | 513,612 | 109,316 | 21.3 % |
| L-6 | 464,300 | 96,060 | 20.7 % |
| C-4 | 395,468 | 76,600 | 19.4 % |
| B-4 | 378,052 | 74,292 | 19.7 % |
| L-4 | 344,308 | 65,220 | 18.9 % |

The inventory includes the continuous A/B/C/L shell and curved passenger doors,
flush face/band paint, upright narrow crew doors with over 10 cm full-opening
clearance, C lamps on the coloured band and 0.8 m wheels beneath window bays.
The production browser drew all five stocks with 1,749,276 High triangles,
490,696 Low triangles and an exact 1,749,276 restoration, retaining all source
geometry identities with no WebGL errors. Evidence is in
`.preview/complete-production.log` and `.preview/bogie-production-report.json`.
The current full suite passes 1,863/1,863 tests. Focused cab/bogie coverage passes
12/12 tests: `CabSkin.ts`, `CarShellProfile.ts`, `TrainBogie.ts` and `TrainInterior.ts`
have 100% line/function coverage; branch coverage is 100%, 98.68%, 98.59% and
96.88% respectively. See `.preview/complete-model-coverage.log`.

The current inventory includes shared detailed bogies on every A/B/C/D/L car: profiled wheels/flanges and machined hubs, sculpted frames, primary/air suspension and brake hardware. Low keeps the wheel profiles and structural parts, omitting small hardware. Counts were regenerated with `tools/model-triangle-inventory.mjs`; raw reports remain in `.preview/perf/`.

The D inventory includes four doorways on every car, with the cab-adjacent
doorway single-leaf, and exactly two small windows in each inter-door bay.
Raw regenerated counts are in `.preview/perf/train-triangles.json`.

L's single windscreen and framed small/end and broad/inter-door windows were
re-inventoried on 2026-10-17. Rounded window apertures retain authored Low
geometry; raw counts are in `.preview/perf/train-triangles.json`.

D is the extreme: its streamline cab and plug doors are lofted surfaces, and their
Low sampling takes the consist from 1,303,040 to 129,856. Preparing both variants
costs more on a consist's first build (medians of three builds on the same host:
D-8 552→606 ms, A-8 80→110 ms, B-6 51→70 ms, L-6 48→55 ms), paid once per cached
configuration (eight are kept).

Crowd: `tools/bake-approved-passenger.mjs` now bakes a second index table over the
*same* animated vertex pool (`lowIndices`, `lowCorners`, `lowTriangles` and
`library[].lowTriangles`). A padded Low row is 8,475 corners / 2,825 triangles
against 28,110 / 9,370 — 30 % of the stride, its vertices and its triangle work — and
the 232 variants carry 401,778 instead of 1,308,230 triangles. Re-baking added fields
only: every pre-existing atlas field is byte-identical to the previous file
(`positions`, `normals`, `indices`, `regions` and all library records).
`render/passengerModel.ts` shares the pose/normal/region textures between the two
draws and uploads one extra index texture. Each packed instance also records the
storey it stands on in a `passengerLevel` attribute (the `storeyBand` the detail
rule compares, and the value a future GPU rule would read). `CrowdSystem` packs
every drawn passenger into the draw its storey asks for, so the crowd follows the
same policy as the fixtures and consists beside it: 高画质 draws the storey being
edited full and a ghosted storey (显示其他层) reduced, 低画质 draws the whole crowd
reduced, and 隐藏UI always restores full bodies. A crowd whose passengers all share
the edited storey is still one draw; only a ghosted storey's crowd adds a second.
The simulation, identity, picking and the 70 % material are untouched.

Measured production captures (same paused Zoo camera, seed 7654321, RTX 4080 SUPER
through ANGLE/D3D11, native multi-draw, 1384×805, device ratio 1; raw reports and
screenshots under ignored `.preview/perf/crowd-lod*`):

| View | Full triangles | Low triangles | Draw calls | Shader/GL errors |
|---|---:|---:|---:|---|
| Gate queue close-up (62 passengers) | 966,584 | 391,992 (−59.4 %) | 478 → 478 | 0 |
| Station-wide (26 passengers) | 693,258 | 359,206 (−48.2 %) | 890 → 890 | 0 |

Captured images differ only in detail: the gate queue keeps every silhouette, bag and
walk pose at a natural viewing distance.
A third capture measured the per-storey split: standing on the concourse
(显示其他层 on), the platform crowd below is ghosted and lands in the reduced draw —
200 full + 191 reduced passengers against 3,663,670 triangles if all were full,
2,413,575 in fact (−34.1 % of the crowd) — while a crowd that shares the edited
storey stays one draw (191 passengers, no reduced group). `npm run check:geometry-detail` passes both
demos with exact full restoration (Zoo 1,712,275 → 668,421 → 1,712,275; Tanwei
2,533,776 → 1,380,253 → 2,533,776), retained batch allocations and no GL, shader or
runtime errors; the Low crowd's separate shader program compiles there.

Limitations: this is geometry only — pixel ratio, texture resolution and shader cost
are unchanged, and the crowd still submits its transparent 70 % draw. The two
captures above are single observations at one camera, not an FPS or GPU-time
comparison; no throughput claim is made. The Low crowd still pads to one shared
stride, so a bagless variant draws 2,825 triangles where its own topology is 1,388.
A ghosted storey's crowd needs a second crowd draw (the topology differs, so it
cannot ride the same instanced draw), and both crowd draws are still chosen by
storey and quality only, never by projected size. Train detail is likewise chosen by
quality/storey rather than projected size, so a close-up consist at 低画质 keeps its
approximation.

Validation: `npm --prefix game run typecheck` and the production build pass (the Low
index table ships as its own 1.65 MiB binary asset, inside the 25 MiB Worker limit).
The full game suite is 1,778 passing with the pre-existing Tanwei fixture-count
failure (14,717 fixture cells vs 14,554 expected) unchanged; `npm --prefix game run
test:perf` passes 257 tests with `trainDetail` 100 % line / 92 % branch, `trainBatches`
100 / 90.67, `passengerModel` 100 / 93.10, `CrowdSystem` 72.58 % lines / 80.53 %
branches and `TrainSystem` 92.69 % lines. New regressions `train-lod` and
`passenger-lod` pin the published High counts, the Low budgets, the prepared swaps,
moving doors and sorted glass under Low, the crowd's per-storey split and recorded
`passengerLevel`, pause, clipping and single shared-atlas disposal. The per-storey
split was re-verified in the production build (200 full + 191 reduced passengers;
crowd 2,413,575 against 3,663,670 triangles if all were full) with GL error 0 and no
console errors. `check:render-batching` passes with native multi-draw (station 3,598→1,023 draws, train 815→26, open and
closed train triangles preserved) and with the extension disabled (3,598→1,716,
815→631), with no GLSL/WebGL/runtime errors; `check:perf-tools` exports CPU samples
and a trace stream. `tools/check-game-passenger-library.mjs` fails before any render —
the plain game path starts empty now and that older tool never loads a demo — which is
pre-existing and unrelated. Raw logs and captures: `.preview/perf/lod-*`,
`.preview/perf/crowd-lod*/` and `.preview/perf/crowd-level*/`.

有柱雨棚 (`roof-canopy`) uses 840 High / 328 Low triangles in its default 4 m bay. Production browser verification of the 4/8/12 m lineup retained both column rows, reduced drawn geometry, and restored the exact High triangle total; raw report and images: `.preview/perf/canopy/`.

Type A now shares Type B's smaller framed window geometry: four inter-door
apertures per car side and painted end bays. The A inventory above was regenerated
with `node tools/model-triangle-inventory.mjs`; raw counts are in ignored
`.preview/perf/train-triangles.json`. This is a model update, with no new timing claim.

## Ambient road vehicle Low/High geometry

Each seeded road-traffic appearance now has authored High and Low geometry. The Low
setting keeps the vehicle outline, glass and required lights while reducing wheel and
repeated-fitting detail. Submitted counts below include both the visible colour geometry
and the shared depth-only pass, which preserves the material opacity without showing
far-side wheels through the body. Counts are per vehicle; the instance count depends on
the road network and seed.

| Vehicle | Low submitted triangles | High submitted triangles |
|---|---:|---:|
| Guangzhou bus, pale/orange | 2,504 | 11,224 |
| Guangzhou bus, red mosaic | 2,666 | 11,506 |
| SUV | 1,232 | 5,136 |
| Sedan | 1,160 | 4,984 |
| Moped with rider | 1,120 | 7,120 |
| Step-through bicycle with rider | 1,960 | 8,160 |

`node tools/check-road-vehicles.mjs` captures the production instanced geometry from
both ends and regenerates the counts in ignored `.preview/road-vehicles/report.json`.
Low and High keep separate prepared buffers, and switching graphics quality only
re-packs the active buffer. No frame-time comparison was made.

2026-10-17 follow-up: all six Low models now stay within a 25% High triangle
budget (15.7–24.0% retained). High geometry is unchanged. Low uses fewer body-ring
corners, flat hexagonal wheel hubs and bus arch strips, coarse rounded fittings,
flat LED segments, fewer spokes and no car handles/chrome strips. Low road vehicles
and Low passenger bodies use 45% opacity; High keeps 70%. Passenger topology stays
at its existing 2,825 Low / 9,370 High triangles. Production captures and counts are
in `.preview/road-vehicles/`, with the baseline/final reports and validation logs
archived under ignored `.preview/perf/ambient-lod-25/`.

Production quality-hook check: seed 42, one 24×1,000 m two-way road, three fixed
passengers, paused, headless Chrome/SwiftShader at 1,400×900. Road submissions were
1,387,280 High / 299,560 Low (21.6%), with exact restoration on both repeated
High/Low switches and all geometry UUIDs retained. The first Low switch plus
fixture repack took 1.7 ms CPU (repeat 0.9 ms); the first Low render submission
took 4.7 ms (repeat 1.2 ms). These are local diagnostic CPU times, not GPU or FPS
measurements. Both body draws had the expected 70%/45% opacity, no document version
changed, and GL error was zero. `quality-switch.json` records all five samples.

Validation: production build and front/rear captures pass; `test:perf` passes
265 tests. Targeted coverage is 100% lines/branches/functions for `VehicleKit`,
`RoadCar`, `RoadBus` and `RoadCycle`; the wider performance suite covers
`passengerModel` at 100% lines / 93.33% branches / 100% functions. The full game
suite passes 1,835/1,836 tests; the unrelated existing Tanwei fixture assertion
still expects 14,554 cells but loads 14,717. Logs are in the same ignored folder.

## Paired demo benchmark — 2026-10-18

Re-ran both shipped examples with the current tree. Windows 11, Intel i7-14700KF,
NVIDIA RTX 4080 SUPER through ANGLE/D3D11, driver 617.42, Headless Chrome 155.0.8059.41,
1384x805 content viewport, DPR 1, native multi-draw. `bench:sim` used 600 ticks and
12 helper samples per demo; `bench:browser` used six-second phases and eight edits per
demo, both run sequentially with no build or profiler competing for the host (the
browser command builds first). Seed 7654321. Zoo opened at z = -16 (11,913 cells /
4,062 modules / 15,127 nodes); Tanwei at z = -7 (14,717 cells / 9,572 modules /
37,274 nodes).

Simulation timings (ms, mean / p95):

| Metric | Zoo | Tanwei |
|---|---:|---:|
| Opening tick | 7.24 / 12.20 | 38.12 / 105.54 |
| Settled tick | 7.30 / 13.06 | 45.68 / 113.33 |
| Morning-peak tick | 7.86 / 14.08 | 60.83 / 130.95 |
| Live graph rebuild | 185.72 / 295.42 | 1,330.01 / 2,431.78 |
| 32x32 placement preview, warm index | 0.39 / 0.61 | 0.53 / 0.93 |
| 32x32 placement preview, cold index | 4.57 / 6.27 | 7.75 / 10.36 |
| 32 stair-block candidates on release | 7.37 / 11.28 | 14.07 / 15.86 |
| 8x8 / 32x32 auto-wall floor release | 36.54 / 38.55 | 48.36 / 46.10 |
| 1,024 wall faces painted | 1.55 / 2.01 | 1.72 / 2.03 |
| Cold World build | 204.21 | 1,993.69 |

Browser phases (forced continuous frames unless paused-idle):

| Phase | Zoo | Tanwei |
|---|---:|---:|
| Paused FPS | 31.8 | 16.4 |
| Paused draws / triangles | 2,282 / 721,905 | 4,061 / 1,485,015 |
| Paused-idle frames drawn in 6 s | 10 | 11 |
| Running 16x FPS / population | 26.1 / 592 | 13.0 / 1,065 |
| Running draws / triangles | 2,329 / 2,923,043 | 4,090 / 4,784,297 |
| Paint edit -> two frames (mean / p95) | 612.58 / 758.40 | 1,180.04 / 1,511.80 |
| Block edit -> two frames (mean / p95) | 648.32 / 672.40 | 1,504.94 / 1,600.40 |
| Move pickup / cancel -> two frames | 81.53 / 71.88 | 147.57 / 135.94 |
| First train arrival (ms) | 1,520 | 1,601 |
| Cold app / fixture ready (s) | 3.65 / 9.02 | 3.61 / 11.69 |

No console/shader/runtime errors. Raw reports: .preview/perf/sim-zoo.json,
.preview/perf/sim-tanwei.json, .preview/perf/browser-zoo.json,
.preview/perf/browser-tanwei.json. GPU timers were disabled; CPU render.submit.ms
was 30.16 / 58.71 ms (Zoo / Tanwei, paused). These are local diagnostic
measurements, not portable FPS guarantees.

### Code-analysis follow-up

Regenerated the three model inventories with `node tools/model-triangle-inventory.mjs`
and the road-vehicle counts with `node tools/check-road-vehicles.mjs` against the
current production build. All three tables in the repo's performance reference match
the freshly generated inventories byte-for-byte (119 palette options, 10 consists,
232 passenger variants). The only numbers that lagged the inventory were the D-8 /
D-6 consist totals in the written narrative: updated from the pre-bogie figures
(1,112,720 -> 91,240 and 865,148 / 75,836) to the current inventory
(1,252,192 -> 119,920, 9.6 % retained; 969,980 / 97,396, 10.0 % retained) in both
this file and .agents/skills/metro-repo/references/performance.md. Road-vehicle,
equipment and passenger tables were already current.

Underfloor equipment refresh: cabinets, vented access panels, air reservoirs, suspension mounting brackets and cable conduits now fill the space between bogies. Deep upper bogie cheek frames, bolsters and broad air cushions close the former empty suspension gap; roof HVAC units retain a thin housing at Low. The train geometry inventory was regenerated with `node tools/model-triangle-inventory.mjs`; raw counts are in `.preview/perf/train-triangles.json`. The original roof height and platform floor are retained; original-size passenger doors occupy about half the wheel-to-roof height through a deeper rail bed and taller underfloor structure.
