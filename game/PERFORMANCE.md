# Current performance state

Verified 2026-10-20. One editable block is 1 m; stations use a single 5 m
storey profile and trains use uniform 0.98 scale. Measurements below describe
the current geometry and the latest completed validation. Raw reports belong
in ignored `.preview/perf/`.

## Placement invalidation audit (2026-10-20)

Audited all 119 equipment/structure/decor palette options, plus generated track
and platform dependencies. The palette matrix places each option beside a
remote catalogue containing every option, then checks deletion as well. Against
the pre-change dependency policy, the 119 additions unnecessarily replaced 670
remote models in total; the updated policy replaces zero. This is a deterministic
work count, not a timing claim. Raw per-option results and the reproduction are
`.preview/perf/placement-classification-audit.json` and
`.preview/perf/placement-classification-audit.mjs`.

| Placement work | Previous behavior | Current behavior |
|---|---|---|
| Roads | Every road model rebuilt | Compare each road's ink, junction sides, arrival markings and signals |
| Tracks/platform screens | All track models rebuilt | Compare third-rail side and neighboring gantry posts; screens retain their owning-track dependency |
| Screen-end returns | Every return rebuilt for track/screen edits | Rebuild the return when its referenced corner changes |
| Pillars/roof hangers | All pillars or roof hangers rebuilt | Compare supporting bridge height or actual suspension heights |
| Hung decor | Every hung piece rebuilt on an opening edit | Compare the actual common ceiling height |
| Ramps/lifts/exits | Whole families rebuilt on opening/ramp edits | Retain remote pieces; conservatively rebuild intersecting columns and nearby landings |
| Sidewalk/lawn | All surfaces invalidated on opening edits | Compare actual opening/ground visibility |
| Tool occupancy and chunk preparation | Rebuilt the generated plane and solid/floor/thin sets for every placement | Reuse prepared inputs for equipment-only edits within the existing street window |
| Road, screen end, moving walkway | Took the chunk path | Skip chunk preparation/remeshing when cells and street bounds are unchanged |
| Existing signs/inscriptions/maps | Structural placement repainted the whole station's cached plates | Repaint only changed plate inputs; name/line edits still propagate |
| Contact shadows | Every storey's mesh, geometry and instance buffer recreated | Retain batches and power-of-two capacity; upload changed matrices only; shrink excessive capacity and release empty levels |
| Functional simulation edits | Rebuilt routing in every worker build-message handler | Install the latest snapshot in one queued worker task per 100 ms window |

The worker retains its old document and graph together until installation; ticks
can continue against that coherent pair. Cosmetic edits join pending topology
work. Installing an edit does not advance the simulation clock. Loading another
station cancels pending edits, and a burst undone to the applied document skips
the graph rebuild. Initial station loading remains immediate. The queued job
still performs a complete graph rebuild; this change coalesces and defers that
work rather than making graph construction incremental.

Production input measurement: `bench-tree-placement.mjs`,
`BENCH_EQUIPMENT_FIXTURE=1 SKIP_LAWN=1 COUNT=2 PIECE=bench`, paused with no
passengers, seed 12345, 128 untouched fences, 1440×1000 Chrome window, ANGLE
SwiftShader. Baseline and final runs use the same fixture/assets. The harness now
counts chunk preparation and plate repaints and records commit-to-worker-frame
latency separately from pointer phases, so deferred acknowledgements are not
misattributed to a later release.

| Unprofiled production phase | Before | Final |
|---|---:|---:|
| First hover, event through two RAFs | 271 ms | 208 ms |
| First press, event through two RAFs | 225 ms | 199 ms |
| First release, event through two RAFs | 45 ms | 45 ms |
| First press `setStation` CPU | 10.0 ms | 5.4 ms |
| Repeated press `setStation` CPU | 9.4 ms | 4.7 ms |
| Repeated press, event through two RAFs | 134 ms | 156 ms |

Both presses retain all prior equipment roots and build exactly one added model;
the final instrumentation records zero chunk preparation/remesh or station-wide
plate repaint calls. Both runs end at 115 draws / 85,536 triangles with two
commits and no captured runtime errors. Final commit-to-worker-frame latency is
145.6 / 149.9 ms, including the intentional 100 ms coalescing window. Cold hover
and software-GPU frame latency remain significant; the repeated end-to-end press
did not improve, so this is not a blanket responsiveness or FPS claim. This shared
workspace also had independent validation processes running; timings are
single-run evidence, while deterministic work counts are the regression gates.

`PIECE=psd-end` also commits twice through production input with no chunk remesh,
retaining the 128/129 prior models; `setStation` CPU is 5.5 / 4.0 ms. Raw reports:
`.preview/perf/placement-audit-before.json`,
`placement-audit-final-instrumented.json`, `placement-audit-psd-end.json`, and
`placement-audit-profiled.json` plus its `.cpuprofile`, all under `.preview/perf/`.

Validation: full game suite **1,979 passing, zero failures/skips**, production
build/typecheck, focused placement/shadow/worker/sign regressions, native
multi-draw and extension-free production rendering checks, and profiler smoke
check. Rendering checks preserve triangles with no captured GLSL/WebGL/runtime
errors. Full logs are `.preview/perf/placement-audit-tests-final-all.txt`,
`placement-audit-build-final.txt`, `placement-render-native.txt`,
`placement-render-fallback.txt` and `placement-profiler-check.txt`.

Focused line/branch/function coverage (`placement-audit-coverage-final.txt`):
`stationGeometry` 100/100/100%, `moduleDependencies` 100/96.15/100%,
`structuralModelInputs` 100/93.94/94.74%, `worker` 96.14/89.80/100%,
`ModuleSystem` 65.04/88.24/37.84%, `PlateSystem` 74.57/64.79/64.29%.
The latter systems include unrelated animation/picking/plate lifecycle paths;
the changed shadow update/disposal and selective repaint paths are exercised.
The broad `npm --prefix game run test:perf` attempt was stopped after stalling
in the existing block-drag section after the auto-wall cap assertion; no complete
broad performance-coverage result is claimed. Its log is
`.preview/perf/placement-audit-perf.txt`.

Remaining document-wide work includes dependency/index bookkeeping and structural
chunk-input derivation. Actual structural/cell changes, street-window expansion,
station metadata/language/artwork changes and unknown future model dependencies
retain their conservative invalidation paths. Chunk meshes and equipment draw
buckets still reuse unchanged GPU allocations.

## Drag preview performance

### Demo-station blocked block drags (2026-10-20)

The empty-floor measurements missed the reported cascade. In the shipped Tanwei
station (9,572 modules / 14,717 cells), the drag grows a 49 x 48 footprint with 107
refused cells alongside 2,243 accepted cells. Each refused cell previously rebuilt
`moduleBlockedCells` and scanned the entire module list for blockers. The warm
callback took 617.1 ms after a 50.5 ms wait; ghost submission was only 11.5 ms.

Block decisions now remember each cell's exact verdict and blocker identity for
the immutable cells/modules snapshot. Growing/shrinking drags reuse covered cells
and check unseen coordinates. Leaving a blocked coordinate removes it from the
preview; changing either document array invalidates its verdict (including blocker
removal/movement and undo/redo). Retention is bounded to two drag budgets: 20,000
cells per snapshot. Level occupancy and exact block-collider bodies are prepared
once per module array; lazy 16 x 16 buckets per height course find nearby blockers.
The block cursor also keeps one refused coordinate as a constant-time witness:
it remains red while the rectangle covers that coordinate in the same snapshot.
An unchanged preview key cannot reset it to cyan. Shrinking clear, changing the
station/settings, cancel and release invalidate it. The shared preview scheduler
also invalidates cached rendered keys when cells/modules identity changes:
`stationEpoch` only tracks opening a station, so it cannot invalidate edits/undo. Shift lines and prepared
suspended ceilings conservatively require the exact preview key before reuse.
Broad imported bounds use a bounded fallback in document order. Refusal priority,
exact geometry, partially accepted patches and release rules are preserved.

Production browser comparison, first / repeated movement, milliseconds. The real
demo loader retains authored geometry and seed. Long-press gestures aimed around
a booth cross existing geometry, then cancel (zero commits). Tanwei starts on
a roof hit and holds the pressed height while expanding across roof/support
geometry, as the real block tool does. The 50 ms cadence is
unchanged. Chrome 155 / SwiftShader, 1424 x 905, paused population. Projected
endpoints agree within floating-point precision; hit cell/place coordinates agree
exactly. Initial rendering settles before the first measured hover. Timings are
evidence, not deterministic pass thresholds.

| Fixture / phase | Before first / repeated | After first / repeated |
|---|---:|---:|
| Zoo: callback work | 62.6 / 49.2 | 8.3 / 3.4 |
| Zoo: ghost CPU ready | 114.2 / 105.1 | 59.6 / 53.4 |
| Zoo: event through two RAFs | 125.8 / 111.6 | 83.6 / 84.9 |
| Tanwei: callback work | 676.2 / 617.1 | 47.0 / 22.8 |
| Tanwei: ghost CPU ready | 722.3 / 664.1 | 91.7 / 73.3 |
| Tanwei: event through two RAFs | 773.5 / 688.9 | 248.0 / 177.0 |

Accepted/refused counts match: Zoo 492 / 35, Tanwei 2,243 / 107. Tanwei first-hover
through two RAFs still takes 521.2 ms (baseline 443.8 ms); software rendering and
initialization remain expensive and variable. CPU readiness is not displayed-pixel
latency; two RAFs are a presentation proxy, not a GPU timer. A 12-position final
Tanwei gesture produced 11 / 9 intermediate previews, no runtime errors or edits.

`block-collision-cache` pins deterministic work on a 1,201-module blocked fixture:
growing a 400-cell refusal by 20 cells performs no new reads of unrelated module
types. It checks witness reuse, shrink/grow, blocker removal, cell replacement,
snapshot isolation, reason priority, retention bounds and broad imported geometry.
Both demos' blocker IDs/order are compared against the original geometry scan at
sampled booth, gate, stair, roof and support positions. Existing placement and
block-tool tests pin release agreement.

Reproduce: `node tools/bench-drag-latency.mjs`, `BENCH_PIECE=block`,
`BENCH_DEMO=zoo BENCH_SIDE=24` or `BENCH_DEMO=tanwei BENCH_SIDE=48`;
`BENCH_PROFILE=1` captures CPU samples, `BENCH_CONTINUOUS=1` repeats movement.
Reports/screenshots/profiles: `.preview/perf/demo-collision-<demo>-before.json`,
`demo-collision-<demo>-verified.json` and corresponding `.cpuprofile`/`-preview.png`;
`demo-collision-tanwei-continuous-final.json` records continuous movement.

Final validation: production build and all 1,981 game tests pass. Focused V8
coverage passes 105 tests: `placement.ts` 86.77% lines / 75.71% branches / 73.72%
functions, `blockIndex.ts` 96.08% / 90% / 100%, `BlockTool.ts` 74.12% / 62.61% /
58.82%, and `multiPlaceDrag.ts` 100% / 96% / 93.75%; unrelated tool/placement limbs
remain outside this focused run. The new blocker-index lines are exercised.
`BENCH_ASSERT_WITNESS=1` also passes through production input on Tanwei: first
and repeated unchanged blocked footprints keep a red cursor without another
preview draw. Report: `.preview/perf/demo-collision-witness-browser.json`.
Build/test/coverage logs: `demo-collision-build-final.log`,
`demo-collision-tests-final.log`, `demo-collision-coverage-final.log` under the
same directory. The full instrumented `test:perf` attempts did not complete and
were stopped; no full performance-gate pass is claimed. Logs are
`demo-collision-perf-final.log` and `demo-collision-perf-deterministic-final.log`.

### Shared 50 ms drag cadence (2026-10-20)

Follow-up to `f41ea98`: blocks, walls, fences (including the fence-run decor),
tactile paving, stair blocks, sidewalks, lawns and roads now share a 50 ms
latest-target cadence. Changing a snapped cell replaces the pending work without
restarting the timer, so continuous movement does not starve the preview. An
unchanged rendered target does no further work. Accepted previews remain visible
until replaced; a known oversized target immediately clears accepted layers and
keeps the existing red-cursor/notice contract, with the whole refused footprint drawn
on the same cadence. The 10,000-placement limit and release verdicts are unchanged.
Roofs retain their faster existing-frame scheduler.

The block profile confirmed both waiting and computation: the previous warm
10,000-cell movement waited 106.8 ms and spent 25.1 ms in the callback, with
20.9 ms in ghost submission. The new callback waited 57.1 ms and spent 28.9 ms;
this dense fixture still has real geometry cost. Sparse block/wall ghosts now
pass their candidate cells to the chunk mesher instead of visiting every empty
cell of a 16 x 16 course. A deterministic 32-candidate regression spans 32 chunks
(32 visits instead of 8,192), compares exact indexed geometry with the original
mesher, covers duplicate/negative coordinates and ramp filling above pending
cells, and checks temporary occupancy is restored. Dense geometry is still the full mesher output.

Production input measurements below are pointer-to-preview **CPU readiness**,
first invocation / repeated invocation, in ms. Same fixture, camera, seed 12345,
paused empty population, Chrome 155, SwiftShader, 1424 x 905; each fixture has a
solid square floor of the stated side. First hover/press, long press, movement,
Escape/cancel and repeated drag/release are driven through CDP. Initial floor
rendering settles before the first interaction; each report records first-hover
cost separately. Browser timings are evidence, not deterministic test thresholds.

| Tool / footprint | Before | After |
|---|---:|---:|
| Block: 10,000 cells over 100 x 100 floor | 134.9 / 132.3 | 88.9 / 86.3 |
| Wall: 150 courses over 30 x 30 floor | 112.4 / 102.4 | 55.1 / 51.3 |
| Fence: 30 panels | 106.9 / 105.6 | 65.0 / 60.9 |
| Tactile: 30 tiles | 119.7 / 106.2 | 72.3 / 63.3 |
| Stair block: 30 pieces | 111.1 / 102.9 | 69.5 / 55.8 |
| Sidewalk: 900 tiles | 113.3 / 105.8 | 69.3 / 55.0 |
| Lawn: 900 tiles | 123.0 / 105.5 | 72.2 / 64.5 |
| Road: one 30 m segment | 106.5 / 102.5 | 55.4 / 50.8 |

Block event-through-two-RAF presentation proxy fell from 138.1 / 135.4 ms to
91.8 / 88.9 ms. This is not a displayed-pixel or GPU timer. The first block hover
still took 142.3 ms through two frames; initialization and large release scene
rebuilds remain separate costs. Additional final block runs: 9,880 floor/auto-wall
candidates over a 90 x 90 floor were ready in 90.2 / 82.3 ms, and a 10,000-cell
suspended ceiling over a 100 x 100 floor in 88.2 / 87.6 ms.

A 12-position continuous block gesture produced **6 / 6 previews while moving**,
versus **0 / 0** with the old restart-on-change delay. Other final continuous runs
also produced intermediate previews: wall 5 / 5, fence 7 / 9, tactile 6 / 6,
stair block 6 / 5, sidewalk 6 / 6, lawn 5 / 5, road 6 / 6; roofs remain 12 / 12.
The shared fake-timer regression drives every deferred placement controller, asserts a single
50 ms timer across target changes, retains the previous draw, reuses unchanged
snapped targets, keeps previews out of document commits, and cancels on release.
Oversized refusal tests remain in the same suite.

Reproduce with `node tools/bench-drag-latency.mjs`: `BENCH_PIECE` selects the
palette type (or `block` / `wall`), `BENCH_SIDE` the floor/camera span,
`BENCH_CONTINUOUS=1` enables the 12-position gesture, and `BENCH_PROFILE=1`
captures a CPU profile. `BENCH_AUTO_WALLS=1` and `BENCH_SUSPENDED_CEILING=1`
select the block modes. A unique CDP port isolates each harness from other chats.
Raw reports/screenshots: `.preview/perf/shared-<piece>-before.json` and
`shared-<piece>-after.json` (lawn baseline: `shared-lawn-before-clean.json`),
`shared-block-continuous-before-clean.json`, `shared-<piece>-continuous-final.json`,
`shared-block-auto-walls-final.json` and `shared-block-ceiling-final.json`.
CPU profiles: `shared-block-before.cpuprofile` and `shared-block-after.cpuprofile`.
The abandoned overlapping run is excluded from these comparisons.

Validation: production build and all 1,966 game tests pass. The focused drag
coverage run passes 91 tests: `StablePreviewDelay` has 100% line/branch/function
coverage, `MultiPlaceDrag` 100% / 95% / 93.33%, and the full `GhostSystem`
84.23% / 70.83% / 70.73%. Browser fixtures reported no runtime errors. Logs:
`.preview/perf/shared-drag-build-final.log`, `shared-drag-tests-final.log` and
`shared-drag-coverage-final.log`. The full `npm run test:perf` instrumented run
and its isolated-file retry did not complete and were stopped; neither is
reported as a pass. Their logs are `shared-drag-perf-final.log` and
`shared-drag-perf-isolated-final.log`.

### Pointer-to-preview latency follow-up (2026-10-20)

The baseline below was committed as `f097616` before this follow-up. Profiling
the whole settled callback exposed a second cost hidden by the ghost-only timer:
with a 100×100 floor and a 10,000-roof preview, the warm timer waited 103.4 ms
and then spent 337.5 ms constructing/validating/submitting the preview. Only
5.0 ms of that was geometry submission. Pointer-to-ready was 441.2 ms and
pointer through two animation frames was 447.4 ms. The cold callback took
373.2 ms; its timer was also delayed by initial scene work. Merely reducing the
timer cannot remove the repeated full-floor collision scan.

Roof collision queries now use immutable cell buckets at each height, retaining
the exact collision-box verdict and naturally invalidating on a new cell array.
Accepted roof drags use the shared `FramePreview` scheduler: at most one pending
animation-frame callback, latest target wins without restarting the wait, and
unchanged rendered targets do no work. The viewport flushes the work inside its
existing coalesced pointer frame, avoiding a second frame wait. Explicit release
drains do not build a preview that is about to be discarded; losing the pick or
leaving the viewport cancels pending work. The previous preview remains visible
until its replacement is ready. Over-limit refusals keep immediate red cursor/
notice feedback and the stable heavy-footprint path; release/tool changes cancel
both schedulers. Other tools retain their existing stable-preview policy.

The CPU profile also found shader compilation (`getProgramInfoLog`: 43 samples).
Hover and drag now share the instanced path, and a 16-entry material cache keeps
the shader owner alive across target replacements. Clearing geometry no longer
disposes the last material using that program. Refusal tints are distinct, source
materials stay scene-owned, clipping changes propagate, and eviction/teardown
release cached clones. An intermediate cold-drag profile recorded 2 samples in
`getProgramInfoLog`; retaining geometry alone would not have fixed recompilation.

Same 100×100 floor/roof fixture, Chrome 155, SwiftShader, 1424×905: final
pointer-to-ready was 19.0 ms cold / 10.6 ms warm, including the frame queue and
all preview validation. Ghost submission was 5.8/4.9 ms. Through two animation
frames it was 34.8/33.7 ms: software rendering/presentation is variable and still
contributes delay, so CPU readiness must not be described as displayed-pixel latency.
The cold first hover was still 309.2 ms through two frames (warm: 51.1 ms), a
remaining initialization/rendering stall, rather than a hidden zero-cost warmup.
A 12-position continuous drag produced 12 previews before movement stopped,
for both cold and warm runs. The 100 ms restart-on-change wait is gone for roofs.

Reports: `.preview/perf/roof-latency-100ms.json`,
`roof-latency-floor-100ms.json`, `roof-latency-16ms.json`,
`roof-latency-floor-frame-final.json`, `roof-latency-continuous-frame.json`, and
`roof-latency-final-cached-materials.json`, `roof-latency-one-frame-final.json`,
and `roof-latency-continuous-final.json`. CPU profiles are
`roof-latency-floor-frame-settled.cpuprofile`,
`roof-latency-final-cached-materials.cpuprofile` and
`roof-latency-one-frame-final.cpuprofile`.
The final fixture waits for initial floor rendering before measuring the first
roof interaction. `BENCH_FLOOR=1 BENCH_SIDE=100` selects it;
`BENCH_CONTINUOUS=1` drives repeated real pointer moves and `BENCH_PROFILE=1`
captures CPU samples. The two-frame reading is a presentation proxy, not a GPU
timer or an FPS threshold. Release scene rebuilding remains a separate cost.

`frame-preview` pins no starvation during continuous movement, latest-target
coalescing, unchanged-target reuse, existing-frame flushing, release drains and
cancellation. `solid-cell-index`
pins negative coordinates, bucket/course boundaries, broad bounds and immutable
invalidation. `roof-tool` guards against scanning a 10,000-cell floor per tile.
`preview-material-cache` pins stable material identity, independent refusal tints,
source ownership, clipping refresh and bounded eviction/disposal.

Validation: production build and all 1,962 normal tests pass. The focused
performance regression run passes 64 tests with V8 coverage: `FrameTask`,
`PreviewMaterialCache` and `solidCellsInBounds` each have 100% line/branch/function
coverage; `FramePreview` has 94% line coverage (the native RAF adapter is exercised
by the browser benchmark). Logs: `.preview/perf/roof-latency-build-final.log`,
`roof-latency-tests-final.log` and `roof-latency-coverage-final.log`.

### Roof drag correction (2026-10-20)

Roof timing must be measured separately from blocks. The previous shared timer
deferred synchronous roof work: a 900-tile patch still built 900 model groups,
and release rebuilt collision caches on each growing module array. Roof previews
now build one exact model per homogeneous run and instance its geometry; all
variants retain their full shape and rotation. Placement checks use one immutable
document, skip existing tiles through a cached footprint index, and append the
accepted disjoint roofs in one edit. The 10,000 cap and 100 ms settle remain.

Production pointer comparison, 900 thin roofs, empty station, 1424×905, Chrome
155 / SwiftShader, same camera and gesture: preview submission was 16.5/17.0 ms
cold/warm before and 0.8/0.7 ms after. Movement through two animation frames,
including the settle delay, was 267.5/314.3 ms before and 163.3/150.6 ms after.
The release handler fell from 313.0 to 73.5 ms (two frames: 436.9 to 117.0 ms).
Reports: `.preview/perf/roof-drag-baseline.json` and `roof-drag-final.json`.

The larger 9,801-roof run retains every tile in one preview mesh: cold/warm
preview submission 7.5/5.4 ms, movement handlers 0.1/0.0 ms. Preview totals were
11 scene draw calls (10 without the preview). Release still takes 394.3 ms
(456.6 ms through two frames) to commit and build the placed models; the preview
optimization does not make that large document edit asynchronous. Raw report:
`.preview/perf/roof-drag-final-100.json`. Run `node tools/bench-roof-drag.mjs`
after building; `BENCH_SIDE=100` exercises the larger run. Browser timing is
evidence, not a deterministic test threshold.

`roof-preview` pins the exact model matrices for every roof variant and rotation,
10,000 retained instances in one thin-roof draw, and instance buffer disposal.
`roof-tool` pins one collision preparation and one undoable bulk placement.

### Shared drag footprint

Every drag that places multiple equipment or decor cells shares a 10,000-cell
budget in `app/tools/geometry/multiPlaceDrag.ts`. Block patches include generated
auto-wall courses; full-height wall columns count each course; fence and tactile
lines count panels; roof, stair-block and outdoor drags count generated tiles;
roads count their rectangular cell footprint. The count is checked before the
large preview allocation. Over-budget drags are refused whole, show a red
footprint after the pointer target settles, and commit nothing. A 10,000-cell
release remains accepted.

Each tool updates the cursor and limit notice on the pointer event. The stable
heavy-preview policy waits 100 ms on a replaceable timer. Changing
the snapped target restarts the timer; release, cancellation and tool changes
clear pending work. Accepted roofs now use the frame policy described above;
single-cell hover previews remain immediate. The stable
timer is deterministic and uses no wall-clock threshold in tests.

Production-browser measurement on an empty station, active level 1, 99×99 real
pointer drag (9,801 cells) with auto-walls off, 1424×905 viewport, Headless Chrome
155 / SwiftShader: cold/warm first-move handlers were 0.1/0.0 ms and the settled
ghost submissions took 39.5/31.1 ms. Move event-to-two-frame readings were
200.3/180.6 ms including the 100 ms stable-preview delay. The warm release
handler took 256.4 ms and release event-to-two-frame 281.0 ms; the accepted
9,801-cell commit and its chunk rebuild remain synchronous. SwiftShader timings
are diagnostic rather than a GPU performance claim. Raw report:
`.preview/perf/block-drag.json`. Reproduce with `npm run bench:block-drag`.

`multi-place-drag` pins shared ownership, the exact cap, timer replacement and
cancellation. `blocktool` pins whole-footprint refusal (all cells red, no commit,
notice raised during the drag), auto-wall inclusion and Shift/三角 counts;
equipment suites pin their placement/release contracts.

## Train LOD inventory

**All ten third-rail rows match a freshly regenerated inventory.** Counts are
triangles submitted by one complete consist through the production model path:
static batches, independent door banks and sorted glass batches. High is full
geometry; Low applies all prepared detail swaps. The inventory verifies exact
High restoration after each Low swap. Uniform 0.98 scaling does not change topology.

The two power variants have different geometry. Third-rail counts exclude
pantographs; overhead-wire counts include collectors and their roof mounts.
D-8 is the current D formation; D-6 is retained as an inventory/legacy case.
These are model counts, not whole-scene totals or frame-time measurements.

### Third rail

| Consist | High triangles | Low triangles | Low / High |
|---|---:|---:|---:|
| D-8 | 1,303,424 | 129,952 | 10.0% |
| D-6 | 1,008,052 | 104,876 | 10.4% |
| A-8 | 730,512 | 166,728 | 22.8% |
| A-6 | 574,244 | 126,140 | 22.0% |
| C-6 | 534,888 | 112,708 | 21.1% |
| B-6 | 513,888 | 109,376 | 21.3% |
| L-6 | 464,576 | 96,120 | 20.7% |
| C-4 | 395,652 | 76,640 | 19.4% |
| B-4 | 378,236 | 74,332 | 19.7% |
| L-4 | 344,492 | 65,260 | 18.9% |

Source: `.preview/perf/train-triangles.json`, three.js revision 186.
Regenerate with `node tools/model-triangle-inventory.mjs`.

### Overhead wire

| Consist | High triangles | Low triangles | Low / High |
|---|---:|---:|---:|
| D-8 | 1,316,536 | 131,544 | 10.0% |
| D-6 | 1,021,164 | 106,468 | 10.4% |
| A-8 | 744,200 | 168,384 | 22.6% |
| A-6 | 587,932 | 127,796 | 21.7% |
| C-6 | 548,576 | 114,364 | 20.8% |
| B-6 | 527,576 | 111,032 | 21.0% |
| L-6 | 478,264 | 97,776 | 20.4% |
| C-4 | 409,340 | 78,296 | 19.1% |
| B-4 | 391,924 | 75,988 | 19.4% |
| L-4 | 358,180 | 66,916 | 18.7% |

Source: `.preview/perf/train-5m-audit/train-catenary-triangles.json`.
The audit harness `train-power-inventory.mjs` in that directory uses the same
batching/detail pipeline with `power: 'catenary'` and `modelScale: 0.98`.

High quality draws the active storey at High and ghosted storeys at Low;
Low quality uses Low throughout. Hide UI restores High. Train detail follows
quality/storey, not projected size. Prepared swaps retain source picking geometry,
door motion and allocations. Identical consists keep separate poses; up to eight
dormant configurations are retained for reuse.

## Equipment and decor LOD inventory

One row per palette option in its default configuration, sorted by High triangle
count. Counts are for one built model through the production batching/detail
path; configured sizes and neighbouring pieces can change them. Low combines
authored reductions and supported prepared approximations; unchanged parts keep
their High geometry. A 100% share means that default model has no reduction.

| Equipment / decor | Model ID | High triangles | Low triangles | Low / High |
|---|---|---:|---:|---:|
| 树木 | `tree` | 18,432 | 396 | 2.1% |
| 白色冷柜 | `shelf-cooler` | 9,852 | 420 | 4.3% |
| 深色冷柜 | `shelf-cooler-dark` | 9,852 | 420 | 4.3% |
| 轨道桥 | `bridge` | 9,576 | 720 | 7.5% |
| 白色高架 | `shelf-white-tall` | 7,556 | 240 | 3.2% |
| 深色高架 | `shelf-dark-tall` | 7,244 | 240 | 3.3% |
| 移动网篮架 | `shelf-wire` | 6,524 | 412 | 6.3% |
| 厕所隔间 | `cubicle` | 5,688 | 84 | 1.5% |
| 半球机 | `cctv-dome` | 5,208 | 360 | 6.9% |
| 自动步道 | `walkway` | 5,162 | 496 | 9.6% |
| 立柱球机 | `cctv-post` | 5,096 | 376 | 7.4% |
| 洗手池 | `sink` | 4,972 | 224 | 4.5% |
| 球机 | `cctv-ptz` | 4,924 | 332 | 6.7% |
| 白色矮架 | `shelf-white-short` | 4,420 | 192 | 4.3% |
| 扶梯 | `escalator` | 3,410 | 410 | 12.0% |
| 空调风机 | `ac-unit` | 2,924 | 140 | 4.8% |
| 左直跑楼梯 | `stair-leftForward` | 2,336 | 1,040 | 44.5% |
| 右直跑楼梯 | `stair-rightForward` | 2,336 | 1,040 | 44.5% |
| 左双跑楼梯 | `stair-left180` | 2,288 | 992 | 43.4% |
| 右双跑楼梯 | `stair-right180` | 2,288 | 992 | 43.4% |
| 中直跑楼梯 | `stair-centerForward` | 2,240 | 944 | 42.1% |
| 左转角楼梯 | `stair-left90` | 2,240 | 944 | 42.1% |
| 右转角楼梯 | `stair-right90` | 2,240 | 944 | 42.1% |
| 时钟 | `clock` | 1,940 | 212 | 10.9% |
| 单跑楼梯 | `stair-straight` | 1,940 | 644 | 33.2% |
| 枪机 | `cctv` | 1,888 | 124 | 6.6% |
| 电梯 | `lift` | 1,740 | 588 | 33.8% |
| 设备柜 | `electrical-cabinet` | 1,224 | 36 | 2.9% |
| 大 | `extinguisher-glass` | 918 | 134 | 14.6% |
| 有盖 单向 | `exit-covered-1` | 902 | 346 | 38.4% |
| 有盖 双向 | `exit` | 902 | 346 | 38.4% |
| 有盖 三向 | `exit-covered-3` | 902 | 346 | 38.4% |
| 有柱雨棚 | `roof-canopy` | 840 | 328 | 39.0% |
| 圆点提示 | `tactile-warning` | 812 | 12 | 1.5% |
| 粗支柱 | `pillar-thick` | 768 | 768 | 100.0% |
| 铁围栏 | `fence-iron` | 768 | 256 | 33.3% |
| 收银台 | `checkout` | 750 | 104 | 13.9% |
| 新 | `gate-new` | 720 | 130 | 18.1% |
| 信号机 | `rail-signal` | 708 | 144 | 20.3% |
| 自动售货机 | `vending` | 676 | 200 | 29.6% |
| 旧 | `gate` | 668 | 162 | 24.3% |
| 办公桌 | `desk` | 652 | 212 | 32.5% |
| 无盖 双向 | `exit-uncovered-2` | 554 | 150 | 27.1% |
| 无盖 三向 | `exit-uncovered-3` | 554 | 150 | 27.1% |
| 无盖 单向 | `exit-uncovered-1` | 530 | 150 | 28.3% |
| 门 | `fence-gate` | 432 | 100 | 23.1% |
| 收束桁架 | `roof-tapered` | 396 | 396 | 100.0% |
| 售票机 | `tvm` | 372 | 372 | 100.0% |
| 长 | `busstop-long` | 372 | 372 | 100.0% |
| 玻璃围栏 | `fence` | 360 | 68 | 18.9% |
| 不锈钢 | `door-steel-1` | 324 | 324 | 100.0% |
| 玻璃 | `door-glass-1` | 324 | 324 | 100.0% |
| 桁架 | `roof-truss` | 264 | 264 | 100.0% |
| 短 | `busstop-short` | 260 | 260 | 100.0% |
| 圆形 | `light-circular` | 256 | 256 | 100.0% |
| 壁挂式 | `monitor-wall` | 213 | 213 | 100.0% |
| 草坪 | `lawn` | 204 | 12 | 5.9% |
| 垃圾桶 | `bin` | 196 | 196 | 100.0% |
| 通风口 | `vent` | 168 | 168 | 100.0% |
| 靠背座椅 | `bench-seat-1` | 156 | 156 | 100.0% |
| 中 | `extinguisher` | 146 | 50 | 34.2% |
| 小 | `extinguisher-compact` | 146 | 50 | 34.2% |
| 木 | `door-wood-1` | 144 | 144 | 100.0% |
| 人行道 | `sidewalk` | 132 | 12 | 9.1% |
| 屏蔽端门 | `psd-end` | 114 | 114 | 100.0% |
| 电视 | `tv` | 114 | 114 | 100.0% |
| 全高声屏障 | `noise-barrier` | 108 | 52 | 48.1% |
| 半高声屏障 | `noise-barrier-half` | 108 | 52 | 48.1% |
| 交通灯 | `traffic-light` | 108 | 108 | 100.0% |
| 不锈钢 | `bench-steel-1` | 84 | 84 | 100.0% |
| 吊挂指示牌 | `sign-ceiling` | 74 | 74 | 100.0% |
| 吊挂式 | `monitor-ceiling` | 72 | 72 | 100.0% |
| 条形导向 | `tactile-guide` | 60 | 60 | 100.0% |
| 导向柱 | `guidepost` | 60 | 60 | 100.0% |
| 玻璃幕墙 | `curtain-wall` | 60 | 60 | 100.0% |
| 玻璃板 1×1 | `glass-1x1` | 60 | 60 | 100.0% |
| 玻璃板 2×1 | `glass-2x1` | 60 | 60 | 100.0% |
| 玻璃板 3×1 | `glass-3x1` | 60 | 60 | 100.0% |
| 玻璃板 1×2 | `glass-1x2` | 60 | 60 | 100.0% |
| 玻璃板 2×2 | `glass-2x2` | 60 | 60 | 100.0% |
| 玻璃板 3×2 | `glass-3x2` | 60 | 60 | 100.0% |
| 虚拟 | `exit-virtual` | 60 | 46 | 76.7% |
| 道路 | `road` | 50 | 50 | 100.0% |
| 细支柱 | `pillar-slim` | 48 | 48 | 100.0% |
| 楼梯块 | `stair-block` | 48 | 34 | 70.8% |
| 横版 16:9 | `billboard-wide` | 40 | 40 | 100.0% |
| 标准 2.25:1 | `billboard-standard` | 40 | 40 | 100.0% |
| 大横版 16:9 | `billboard-large` | 40 | 40 | 100.0% |
| 长幅 3.75:1 | `billboard-panorama` | 40 | 40 | 100.0% |
| 竖版 0.7:1 | `billboard-portrait` | 40 | 40 | 100.0% |
| 方形 1:1 | `billboard-square` | 40 | 40 | 100.0% |
| 立式线网图 | `linemap-stand` | 40 | 40 | 100.0% |
| 吊装 | `hanger-roof` | 36 | 36 | 100.0% |
| 立柱 | `hanger-post` | 36 | 36 | 100.0% |
| 墙面线网图 | `linemap-wall` | 26 | 26 | 100.0% |
| 地面 单向 | `exit-doorway-1` | 26 | 10 | 38.5% |
| 地面 双向 | `exit-doorway-2` | 26 | 10 | 38.5% |
| 地面 三向 | `exit-doorway-3` | 26 | 10 | 38.5% |
| 地面 四向 | `exit-doorway-4` | 26 | 10 | 38.5% |
| 无桁架 | `roof-shell` | 24 | 24 | 100.0% |
| 栏杆 | `noise-barrier-railing` | 24 | 16 | 66.7% |
| 直条 | `light-rectangular` | 24 | 24 | 100.0% |
| 薄板 | `roof` | 12 | 12 | 100.0% |
| 屏蔽门箭头 | `floor-mark-boarding` | 2 | 2 | 100.0% |
| 排队等候线 | `floor-mark-waiting` | 2 | 2 | 100.0% |
| 方向指引 | `floor-mark-direction` | 2 | 2 | 100.0% |
| 墙面指示牌 | `sign-wall` | 2 | 2 | 100.0% |
| 楷书 横排 | `calligraphy-kai-h` | 2 | 2 | 100.0% |
| 楷书 竖排 | `calligraphy-kai-v` | 2 | 2 | 100.0% |
| 行书 横排 | `calligraphy-xing-h` | 2 | 2 | 100.0% |
| 行书 竖排 | `calligraphy-xing-v` | 2 | 2 | 100.0% |
| 隶书 横排 | `calligraphy-li-h` | 2 | 2 | 100.0% |
| 隶书 竖排 | `calligraphy-li-v` | 2 | 2 | 100.0% |
| 魏碑 横排 | `calligraphy-wei-h` | 2 | 2 | 100.0% |
| 魏碑 竖排 | `calligraphy-wei-v` | 2 | 2 | 100.0% |
| 黑体 横排 | `calligraphy-hei-h` | 2 | 2 | 100.0% |
| 黑体 竖排 | `calligraphy-hei-v` | 2 | 2 | 100.0% |
| 宋体 横排 | `calligraphy-song-h` | 2 | 2 | 100.0% |
| 宋体 竖排 | `calligraphy-song-v` | 2 | 2 | 100.0% |

Source: `.preview/perf/model-triangles.json`, three.js revision 186.
Regenerate with `node tools/model-triangle-inventory.mjs`.

Train interiors use one continuous ceiling per car, with the underside at
2.94 m throughout the cabin (31 cm above the original lining). Door boards
remain above the door head. The exterior crown, shoulders and collector well
retain their shape; downward-facing solid roof closures are removed so the
lining is visible from inside. Lighting and ceiling-mounted fittings follow
the new lining. Current inventories include this geometry in both LODs.

## Other geometry

The regenerated inventory contains **119 palette models** and **232 passenger
variants**. Current equipment, passenger and road-vehicle tables are in the
[performance reference](../.agents/skills/metro-repo/references/performance.md#per-model-geometry-detail-inventory).

| Inventory | Raw report |
|---|---|
| Equipment/decor | `.preview/perf/model-triangles.json` |
| Trains, third rail | `.preview/perf/train-triangles.json` |
| Passenger variants | `.preview/perf/passenger-triangles.json` |
| Road vehicles, including colour + depth pass | `.preview/road-vehicles/report.json` |

Passenger atlas draw strides are 9,370 High / 2,825 Low triangles per instance;
individual variants can have smaller topology. Both LODs share animation data.
Rendered passenger dimensions use the train's 0.98 uniform scale, including
shadows, picking, stride phase and eye height; simulation physique/speed and
the atlas topology are unchanged, so the triangle tables remain valid.
A single-storey crowd uses one draw; a visible ghosted storey can add a second.
Passenger and road-vehicle opacity is 70% at High and 45% at Low.

## Five-metre clearance profile

| Datum | Height above track anchor |
|---|---:|
| Concrete underside | −1 m |
| Train/platform floor | +1 m |
| Scaled train origin | +0.3924 m |
| Collector carbon / wire underside | +3.891 m |
| Wire centre | +3.903 m |
| Covered ceiling underside | +4 m |

Covered track has a 5 m bottom-to-ceiling envelope. Open bridges/gantries use
their own taller clearance. Full PSDs stand 3 m above the platform: 2.35 m
of glass, a 0.6 m information plate and a 0.05 m cap.

## Current browser measurements

### Fence drag preview (2026-10-19)

`node tools/bench-fence-drag.mjs` drives production hover, press, a 220 ms long
press, three drag movements, Escape/cancel and a repeated drag followed by release.
The deterministic fixture has 256 glass fences (128 on each of z=0 and z=-5),
128 floor cells, seed 12345, no crowd or lines, paused, High graphics, ground
storey active and Show other levels off. Chrome 155 on Windows, 28 logical CPUs,
RTX 4080 SUPER through ANGLE/D3D11; viewport 1424 × 905, top orthographic view.
Both runs use the same fixture and event sequence, with builds and tests idle.

| Phase | Preview CPU before → after | Event through two RAFs before → after |
|---|---:|---:|
| First press | 56.0 → 1.1 ms | 328.7 → 84.2 ms |
| First drag movement | 103.6 → 1.4 ms | 305.0 → 38.9 ms |
| Continued movement (two samples) | 70.0–74.5 → 0.9–1.6 ms | 277.8–294.6 → 47.6–50.2 ms |
| Cancel | 13.8 → 0.3 ms | 84.1 → 32.0 ms |
| Repeated press | 56.4 → 0.5 ms | 250.1 → 34.4 ms |
| Release/commit | 14.0 → 0.5 ms | 203.2 → 51.3 ms |

The one-panel preview built 257 groups before and two after (candidate plus its
one adjacent joint). A four-panel run builds five instead of 260. Pointer press,
movement and cancel now perform zero equipment batch synchronizations; previously
each movement performed two. The immutable fence/gate/landing index is prepared
while building the station, and candidate connections overlay that index without
copying or scanning the station document. Only neighbouring bucket draws are
masked; original GPU allocations and all remote geometry remain in place.

The baseline also exposed all 128 hidden lower-storey source roots after cancel.
The final run kept all 128 hidden throughout, with zero shader/runtime errors;
cancel committed nothing and release added exactly four panels in one commit.
Release still performs the normal functional station/routing edit. These are
single cold/warm local samples, not FPS claims or GPU-fence measurements.

Reports and screenshot: `.preview/perf/fence-baseline.json`,
`.preview/perf/fence-final-all-equipment.json`, `.preview/perf/fence-close-visual.png`;
the earlier fence-only optimization is recorded separately in `fence-final.json`.
Build and test logs use the `fence-` and `equipment-` prefixes in
the same ignored directory. Run with `METRO_BROWSER_GPU=hardware`, choose distinct
`BENCH_OUTPUT` paths, and set `BENCH_EXPECT_LOCAL=1` to check the local-work and
visibility contracts. `BENCH_STATION` accepts a user save with a ground fence and
five free cells to its east; `BENCH_PROFILE=1` writes a separate CPU profile.

`fence-preview.test.mjs` guards 1,024 unrelated fences without document scans,
remote preview rebuilds, equipment rebatching or buffer disposal, including exact
neighbour geometry, gate/ramp index equivalence, immutable invalidation, current
storey restoration, ghost/clipping changes and exactly-once preview teardown.

### Other equipment placement and shared hover indexes (2026-10-19)

The audit found a second station-wide invalidation: functional equipment additions,
deletions and moves (benches, TVMs, vending machines, gates, cabinets, pillars and
post hangers) rebuilt every module model. Common hover previews also copied the
entire module array at each cell, invalidating immutable support indexes; edge-backed
equipment searched every module again for a curtain.

`moduleDependencies` now retains unchanged models according to their actual inputs,
including local fence/gate/tactile connections, paired TVs, shared cubicle partitions,
curtain corners/doors, supported fittings and raised paving. Complex structural edits
invalidate dependent model families; unknown types and station metadata fail closed.
Equipment edits inside the existing street window skip chunk remeshing independently
of the worker's routing decision. Common hover previews use the prepared station;
move pickup caches its one removal, and coupled previews keep their candidate list.
Curtain lookup uses the immutable glass index rather than scanning unrelated modules.

Production measurements use `tools/bench-tree-placement.mjs` with
`BENCH_EQUIPMENT_FIXTURE=1 SKIP_LAWN=1 COUNT=1 PIECE=bench` (then `PIECE=tvm`).
The same Chrome/GPU/viewport above, seed 12345, 128 pre-existing ground fences,
no stored floor cells, no crowd/lines, paused, one real hover/press/release per piece.
The target lies inside the existing street window. Each report is a separate fresh
browser run with no competing build/test/profile; times below are first invocations.

| Placement | Models replaced before → after | Module build CPU before → after | setStation CPU before → after | Through two RAFs before → after |
|---|---:|---:|---:|---:|
| Bench | 128 → 0 | 94.8 → 2.2 ms | 161.5 → 8.9 ms | 273.3 → 126.8 ms |
| Ticket machine | 128 → 0 | 102.7 → 2.8 ms | 151.9 → 11.7 ms | 291.9 → 159.8 ms |

Both final runs retained all 128 old groups, added exactly one model and made one
commit. The previous single chunk remesh became zero. Worker metrics arrived after
both functional edits; shader/runtime errors were zero. Remaining latency includes
the worker's required topology update and presentation; no routing work is skipped.
Raw reports: `.preview/perf/equipment-{bench,tvm}-{baseline,final}.json`.

`equipment-retention.test.mjs` guards 1,024 unrelated models, functional routing,
chunk classification, structural/coupled invalidation, geometry matching a fresh
build, live materials, cached move removal and ordinary hovers without document
scans. Both equipment suites are part of `test:perf`.

### Production batching

Chrome, software GPU, native multi-draw, 1400×900 browser window. The checker
compares identical scene geometry with batching enabled and disabled.

| Workload | Unbatched draws | Batched draws | Triangles, both modes |
|---|---:|---:|---:|
| Station fixture | 3,527 | 967 | 644,460 |
| Closed train view | 779 | 29 | 419,228 |
| Open train view | 779 | 29 | 419,228 |

No captured GLSL/WebGL/runtime errors; GL error is zero. The train-view total
includes the checker's visible scene and is separate from the per-consist inventory.
These are submission counts, with no comparative FPS/GPU-time claim.
Raw report: `.preview/perf/render-batching-check.json`.

### Reported-save opening

Chrome, software GPU, 1400×900, isolated browser profile and no competing test
processes. Fixture: `test/fixtures/covered-rail-clearance.metro.json`.
Load timing ends after worker readiness and two animation frames.

| Measurement | Time |
|---|---:|
| Cold app ready | 5,351 ms |
| First save opening | 332.8 ms |
| Repeated save opening | 623.2 ms |

Both loads preserve 870 cells / 6 modules, active altitude 2 m and train scale
0.98, with no captured console errors. These two samples do not establish a
warm-cache benefit or a speed improvement.
Raw samples/harness: `.preview/perf/train-5m-audit/cold-open.{json,mjs}`.

There is no completed paired-demo FPS or simulation benchmark for the current
5 m geometry. Re-measure before making throughput claims.

## Validation and remaining gaps

| Check | Latest completed result |
|---|---|
| Full game suite, process isolation | **1,925 pass; zero failures/skips** |
| Typecheck + production build | Pass |
| Production WebGL batching | Pass; geometry preserved, no captured errors |
| CPU-profile / trace export smoke check | Pass |
| Geometry inventory | 119 palette models, 10 third-rail and 10 overhead consists, 232 passengers |
| Full instrumented `test:perf` | Incomplete; stopped after approximately 11 minutes |
| Expanded same-process performance selection without coverage | Incomplete; stopped after approximately four minutes |

Normal-suite success does not certify either incomplete same-process gate.
Raw logs are in `.preview/perf/train-5m-audit/`, including
`browser-batching.txt`,
`perf-tools.txt`, `perf-tests.txt` and `perf-tests-uninstrumented.txt`.

Focused source coverage (lines / branches / functions):

| Module | Lines | Branches | Functions | Scope |
|---|---:|---:|---:|---|
| `render/models/pieces/TrainInterior.ts` | 100% | 97.96% | 100% | Continuous ceiling, inner shoulders and door headers |
| `render/models/pieces/CarShellProfile.ts` | 100% | 98.85% | 100% | Hollow underside and unchanged exterior geometry |
| `render/passengerModel.ts` | 100% | 93.33% | 100% | Passenger size, view, LOD and library suites |
| `persistence/save.ts` | 100% | 88.24% | 100% | Full save suite, 14 tests |
| `build/model/Ceilings.ts` | 87.18% | 91.67% | 77.78% | Seven-contract selection |
| `sim/stock.ts` | 77.44% | 100% | 36.36% | Seven-contract selection |
| `sim/track.ts` | 56.80% | 52.94% | 33.33% | Seven-contract selection |

These are focused results, not whole-suite or GPU coverage. Reports:
`save-coverage.txt` and `contracts-coverage.txt` in the audit directory.

Passenger-scale verification: `.preview/perf/passenger-scale/full-tests.txt`
(1,922 passing), `build.txt`, `coverage.txt` and `browser.json`. Production
High/Low/High matrices preserve adult/child 0.98 scale with zero captured errors.
All 38 focused passenger checks also pass with source coverage enabled.

Continuous-ceiling verification: full suite **1,925 passing, zero failures/skips**.
`.preview/perf/train-raised-ceiling/` contains
the full-suite/build logs, focused geometry coverage, production close-up and
batching reports. Tests probe the entire cabin ceiling, including between doors
and under collectors, and compare exterior roof ray hits before/after hollowing
at both LODs.

## Reproduce measurements

Run from the repository root with Node 24+ and installed game dependencies:

```powershell
node tools/model-triangle-inventory.mjs
npm --prefix game test
npm --prefix game run build
node tools/check-render-batching.mjs --software-gpu
npm run check:perf-tools
npm --prefix game run test:perf
npm run bench:sim
npm run bench:browser
```

Both benchmark commands run Zoo and Tanwei sequentially. `BENCH_STATION`
selects an external save; `BENCH_OUTPUT` sets a distinct report path.
Browser controls include `BENCH_SECONDS` (default 6), `BENCH_EDITS` (8),
`BENCH_SIZE` (1400,900), `BENCH_PORT` (9348) and `CHROME_PATH`.
Simulation uses `BENCH_TICKS` (600) and `BENCH_EDITS` (12).

Browser benchmarks use hardware rendering by default; add `--software-gpu`
for SwiftShader. Match fixture, seed, camera, population, viewport, hardware and
GPU backend between comparisons, and run without competing tests/builds.
`profile:browser` and `profile:sim` collect diagnostic profiles;
`--investigate` adds browser ablations. Keep raw reports under
`.preview/perf/` and use separate output paths for profiled and clean runs.
CPU render submission, asynchronous GPU time and frame presentation are distinct
measurements; frame edits measured through two animation frames are not GPU fences.

## Q/E neighbour prewarm and retained editing grid (2026-10-20)

The opening path still prepared `deepest + 4` after the five-metre migration.
The production key-input benchmark reproduced a cache miss on the first E press
in both shipped demos. Opening now prepares the actual editing storey and both
valid Q/E neighbours using `STOREY_HEIGHT` and `levelSteps(levelBase)`, so shifted
bases and non-deepest opening levels receive the right views. The existing
four-view cache limit, appearance/transform invalidation and eviction disposal
are unchanged. The editing grid now retains its geometry/material/buffer across
storey changes and translates its group; horizontal bounds changes still rebuild
and dispose the previous resources.

Production runs were sequential, with no tests/builds competing: Windows Chrome,
RTX 4080 SUPER / ANGLE D3D11, native multi-draw, 852x715 backing viewport, paused
population 0, same demo seeds/documents and eight real E/Q presses per fixture.
Numbers are event-through-two-RAF latency, not GPU completion or a frame budget.

| Fixture | Cells / modules | First E before -> after | Repeated mean before -> after | Opening prewarm before -> after |
|---|---:|---:|---:|---:|
| Zoo | 16,201 / 4,062 | 558.4 -> 94.0 ms | 30.7 -> 36.8 ms | 1,628.5 -> 2,553.8 ms |
| Tanwei | 14,717 / 9,572 | 723.0 -> 276.9 ms | 73.9 -> 65.0 ms | 2,269.8 -> 2,555.3 ms |

First E is 83% / 62% shorter in these samples. This trades more opening work for
removing the first interactive batch build; it does not establish an improvement
in warmed throughput. All revisited views retain every batch allocation, both
first presses hit the prepared cache, simulation ticks stay unchanged and there
are no console/runtime/WebGL errors. After switching, three views retain 1,579 /
1,885 owned batches. Rendering remains substantial (average 2,348 / 3,003 draw
calls and about 591k / 977k triangles); first-switch presentation still stalls,
especially on Tanwei. Broader batch submission/material work and first-use GPU
work remain candidates for profiling. This change does not prewarm every storey,
and visiting an unprepared or evicted storey can still build its view.

Raw before/after reports: `.preview/perf/levels-{before,after}.json` (baseline uses
`node tools/bench-level-switch.mjs --baseline`; final omits that flag).
`level-view-cache` now pins actual neighbour selection, shifted bases, both level
boundaries, restored active state, retained grid allocations and bounds disposal.

Validation: production build passed; full normal game suite passed 1,968 tests
with no skips/failures. Focused coverage passed 30 tests: LevelSystem 91.10% lines /
78.79% branches / 86.36% functions; GridSystem 83.33% / 100% / 55.56% (uncovered
functions are the unchanged cursor/visibility controls). SceneRenderer integration
is pinned by source contracts and the real production Q/E run, rather than Node
WebGL coverage. Native and forced-no-multi-draw render-batching checks passed with
triangles preserved and no GLSL/WebGL/runtime errors; profiler export smoke check
passed. The first fallback attempt timed out in CDP; the separate-port retry passed.
The broad `npm --prefix game run test:perf` attempt was stopped after over four
minutes while instrumenting the block-drag section (last completed assertion:
auto-wall drag cap); it did not complete and no full performance-coverage result
is claimed. Raw validation logs are `.preview/perf/levels-*.log`.
# Population controls (2026-10-20)

Changing per-train alighting or exit entry demand previously ran a full station
commit: bridge-support synchronization, a complete worker document clone and
routing rebuild, tool geometry preparation, model/chunk rebuilds and batch-view
invalidation. The range inputs commit on every input event, multiplying that work.

The two population fields now use a fail-closed classifier and a compact worker
message containing only changed IDs and numbers. The worker updates the installed
document and line lookup without rebuilding routing, replacing queues/crowd or
advancing time. A pending structural build receives the same patch; station loads
still cancel that build. Paused population edits emit no redundant crowd frame.
The viewport skips station/geometry rebuilding for these edits, preserving normal
language, sign-preview and station-load invalidation. Undo/save semantics remain
unchanged; document history still deep-copies its snapshot. Undo/Redo themselves
continue to use the full document path.

`node tools/bench-population-edit.mjs` drives real ArrowRight input on the mounted
production train-load and exit-demand ranges. It records the first edit and two
repetitions, one commit per input, synchronous commit CPU, scene work and an
input-through-two-RAF proxy. `BENCH_ASSERT_FAST=1` rejects any chunk preparation,
remesh, module rebuild or batch-view invalidation. Raw reports are in ignored
`.preview/perf/population-{before,after,after-cpu,final,hardware,final-cache,hardware-cache}.json`.

The controlled software-rendered comparison used the same local demo, 动物园,
14,073 cells / 4,291 modules, paused, a fresh Chrome profile per run, 1440×1000
window, default opening camera/storey and three +1-step inputs per control:

| Control | Before: first / repeat two-RAF ms | After: first / repeat two-RAF ms | Before scene CPU ms | After scene work |
|---|---|---|---|---|
| Train load | 2666 / 2573, 2541 | 255 / 239, 241 | 934 / 900, 888 | zero calls |
| Exit demand | 1362 / 1432, 1439 | 251 / 510, 420 | 609 / 681, 670 | zero calls |

The final software run's commit CPU was 8.0–14.2 ms. A separate hardware-enabled
run (`METRO_BROWSER_GPU=hardware`) measured train first/repeats at 67.6 / 58.3,
33.1 ms and exit first/repeats at 107.5 / 115.4, 97.3 ms; synchronous commit CPU
was 6.5–7.1 ms. Both final runs had zero scene/geometry/batch work, one commit per
input and no runtime errors. Hardware timings are additional evidence, not a
controlled comparison against the software baseline. Two RAFs include UI, browser
and rendering overhead; these numbers are not GPU timer queries or a claim of
zero end-to-end latency. Exit/UI/frame overhead and history-copy cost remain.

Deterministic guards: `population-edit` rejects geometry, renaming, consist,
headway, exit-open and unknown-field changes; preserves prepared tool geometry;
and proves immutable patch application. `line-edit` checks compact payloads and
Undo/Redo. `worker-preview` asserts retained graph/pool/queue identity, updated
spawn inputs, no rebuild/tick/redundant frame, pending-build ordering and load
cancellation. `scene-wiring` guards the viewport early return before rebuilding.
The geometry and module caches accept the latest population metadata without
rebuilding; a regression also checks that the next bench edit retains the local
equipment path instead of rebuilding because of stale population fields.

The six population-specific tests pass. Focused classifier coverage is 100%
lines/branches/functions; `stationGeometry.ts` is 100%/90.91%/100%. The broader
focused run measured `StationSlice.ts` 100%/95%/100%, `SimSlice.ts`
87.13%/86.21%/68.42%, `worker.ts` 96.32%/90.20%/100% and `ModuleSystem.ts`
33.08%/90.91%/22.73%. The latter tests exercise population cache acceptance, not
the entire model-building lifecycle; imported-file percentages are not GPU
coverage. Raw summaries are `population-{only-coverage,coverage-verified}.log`.

The production build passes. The final normal suite reports 1,999 passing / two
failing / zero skipped tests (2,001 total). Both failures concern the independently
edited Tanwei fixture: plain `toStateRepairing(referenceStation('tanwei'))` changes
9,572 authored modules into 9,583 modules with zero dropped records, failing the
demo-integrity and demo-switch assertions. The same loader-only reproduction does
not invoke the population update. An earlier full run, before that fixture change
and the final cache guard, passed all 2,000 tests. No fixture or acceptance assertion
was weakened. Logs: `population-full-{final,verified}.log`.

`npm --prefix game run test:perf` was attempted and stopped after several minutes
without test output, consistent with the previously recorded long instrumented
geometry runs. This is not a full performance-suite pass. The focused coverage
above, normal-suite results and real production slider work counts are the
completed validation; raw partial output is `population-perf-verified.log`.

## Settings rebuild audit (2026-10-20)

Audited document commits, line/exit inspectors, the time panel, history, view
actions, worker installation, scene/module/plate invalidation and inert-decor
classification. The same full-rebuild mistake also affected headways, opening
hours, peak windows and demand curves. Population Undo/Redo lost the narrow path
because history deep-copied otherwise unchanged geometry.

Fixed these flows by extending the compact population/settings message to the
known timetable/day fields (including calendar settings). World refreshes its
normalized day/calendar and line lookup, adjusts pending departures by the changed
current headway, and preserves graph/pathfinder, route caches, live journeys,
trains, queues, collision buffers, RNG and simulation time. A shortened pending
departure clamps to now; untouched headways retain their schedule. Paused
timetable edits acknowledge updated forecasts without a simulation tick, and
retained screen pixels reconcile the document and worker acknowledgement in
either arrival order. The next structural build still installs one coherent
document/graph and receives any preceding settings patches.

Settings history now shares the immutable document instead of deep-copying its
geometry. Undo/Redo send compact settings patches and preserve the same prepared
scene/geometry. Structural edits retain the conservative snapshot/build behavior.
Same-document commits, stale line IDs and unchanged scalar line patches do no
work. Explicit stock/cars/power/PSD retries still run: an identical geometry option
can legitimately retry a previously refused rail resize after removing a blocker.

`tools/bench-settings-audit.mjs` drives actual mounted headway number inputs,
demand sliders and service/peak chart grips with keyboard input. Undo/Redo are
driven through their store actions, independently of editor text undo. Each case
records its first invocation and one repetition, one history/version update, and
scene/chunk/module/batch work counts. `BENCH_ASSERT_FAST=1` requires zero scene
rebuild calls. Both runs use the same 动物园 fixture: 14,073 cells, 4,291 modules,
seed 7654321, paused at 06:30 on Monday Jan 5, 2026, zero passengers, opening camera
at −20 m, 1440×1000 Chrome 155 window and hardware rendering enabled. Runs were
sequential without this task's builds/tests competing. Raw reports:
`.preview/perf/settings-audit-{before,final,metadata}.json`.

| Flow | Before first / repeat ms | After first / repeat ms | After scene rebuilds |
|---|---:|---:|---:|
| Headway | 1703 / 1656 | 202 / 163 | 0 |
| Demand curve | 1502 / 1401 | 127 / 127 | 0 |
| Opening hours | 1498 / 1363 | 106 / 201 | 0 |
| Peak window | 1473 / 1409 | 122 / 137 | 0 |
| Settings Undo | 1524 / 1445 | 117 / 111 | 0 |
| Settings Redo | 1463 / 1420 | 103 / 99 | 0 |

These are interaction-through-two-RAF proxies, including React, browser and
rendering overhead. They are not just CPU or GPU times. Undo/Redo synchronous
work fell from 9.8–10.3 ms to 0.2–0.4 ms; the remaining display delay is not a
hidden station rebuild. No runtime errors occurred in the measured runs.

Remaining savings, ordered by evidence and expected impact:

* **Names/colours/termini:** a real line-name edit still measured 1783 / 1537 ms,
  including 967 / 857 ms in `setStation`, one full module build, chunk remesh and
  routing invalidation. A name needs affected plates refreshed; a colour also
  affects train and PSD appearance. This needs explicit artwork/model dependency
  invalidation rather than treating all line changes as invisible settings.
  Station and exit names use the same conservative metadata path; their individual
  timings were not measured here.
* **Redundant redraw requests:** overlay and move/highlight effects still observe
  the general document version, including invisible settings edits. Idempotent
  view updates or a distinct visual revision could avoid clean 3D redraws. The
  measured residual two-RAF latency includes this work, but its separate cost was
  not profiled here.
* **Exit open/closed:** source audit finds its flag in street spawning and new
  exit selection, rather than walking-graph construction. It is a candidate for
  the compact path, after pinning passengers already travelling to that exit and
  verifying its visual contract. Not changed or timed in this pass.
* **Restart:** `World.restart()` rebuilds the static graph after replacing the
  crowd. Reusing graph/pathfinder geometry could save work, but dynamic queues,
  lifts, dispatch and route caches still require a complete reset. Not changed or
  timed here.
* **Visual metadata/language:** unchanged cells should allow retained chunks even
  when translated artwork must refresh. Model/plate inputs need separate keys;
  broad metadata equality currently makes this conservative. Not timed here.

Already separated: ordinary view toggles do not commit or route; date seeking
retains the graph/crowd; inert decor and side paint skip routing; sign drafts and
placement previews have their own local/coalesced paths. Actual structural edits,
stock/formation/PSD/power changes and lift-door changes keep their required geometry
or connectivity work. No pick-inside-document-predicate pattern was found in the
current source search; no pointer contracts were changed.

Validation: production build and all 2,006 normal tests pass, with zero failures
or skips (`audit-build-final.log`, `audit-full-tests.log`). The 73-test focused run
also passes. Focused instrumented coverage (`audit-focused-coverage.log`, 67 tests,
all passing), in lines/branches/functions: `populationEdit.ts` 100/100/100,
`LineSlice.ts` 100/98.46/100, `StationSlice.ts` 100/95.65/100, `World.ts`
90.47/80.22/87.40, `worker.ts` 96.35/84/100, `PlateSystem.ts` 51.22/85.71/17.39.
The low PlateSystem function total reflects the many unrelated artwork methods;
new paused-settings reconciliation is covered, including the uninitialized case.
GPU correctness is checked by the production interaction/work-count run, not by
V8 percentages. The broad instrumented geometry suite was attempted again and
did not complete; its partial output is `audit-perf-coverage.log`.

Final dispatch edge guards also preserve an already-due first train and clamp a
shortened departure to now. They pass in `audit-settings-coverage-verified.log`
(10 tests; the settings classifier remains 100% lines/branches/functions).
Final build and normal-suite logs are `audit-build-verified.log` and
`audit-full-verified.log`.

## Remaining settings rebuilds resolved (2026-10-21)

This supersedes the unoptimized metadata, exit-policy and restart candidates in
 the preceding settings audit. Names, line colours and termini now repaint only
artwork whose inputs changed, retaining module roots, geometry, materials, atlas
slots and static batches. PSD colour bands use live textures; train recolouring
updates the owned livery material and retains door buffers. Unknown module artwork
dependencies conservatively retain the rebuild fallback. Structural edits still
rebuild their geometry and routing as required.

Exit open/closed and population changes patch the running document without
rebuilding connectivity or requesting a 3D redraw. Closing an exit excludes new
spawns/destinations while allowing existing journeys to complete. A separate
geometry revision prevents metadata/history changes from rebuilding zone and move
overlays. Restart retains the graph, node indexes and collision buffers, while
resetting dynamic queues, servers, lifts, dispatch and routing scratch state.

Production Chrome 155, hardware GPU, fresh profile, Zoo fixture (14,073 cells,
4,291 modules), seed 7654321, paused Monday 2026-01-05 06:30, zero passengers,
storey -20, 1440x1000. Each value measures input through two animation frames;
first invocation is included. Names/terminus/exit-policy/population use keyboard
UI; colour/station-name/restart use store actions. Values are milliseconds,
first/repeat, and include frame scheduling rather than just handler CPU time.

| Interaction | Before | After |
|---|---:|---:|
| Line name | 1784 / 1796 | 138 / 115 |
| Terminus | 1788 / 1538 | 118 / 41 |
| Line colour | 1627 / 1624 | 38 / 42 |
| Station name | 1482 / 1592 | 37 / 35 |
| Exit name | 865 / 746 | 182 / 185 |
| Exit open/closed | 693 / 684 | 106 / 33 |
| Population | 112 / 113 | 34 / 34 |
| Restart | 217 / 202 | 77 / 123 |

Raw reports: `.preview/perf/remaining-before.json` and
`remaining-traced.json`; reproduction: `BENCH_REMAINING=1 BENCH_ASSERT_FAST=1
node tools/bench-settings-audit.mjs`. Every final sample records zero setStation,
chunk preparation/meshing, module builds and batch invalidations. Exit policy and
population record zero requestRender calls. A preceding run (`remaining-complete`)
caught one overlapping redraw during the first exit toggle; the traced rerun
passed all assertions. Existing render frames may still finish after a visible edit.
Artwork PNGs in `remaining-final2-psd.png` and `remaining-final2-exit.png` were
visually checked for station, exit, terminus and colour updates.

Deterministic regressions cover strict patch classification, artwork dependencies,
texture/geometry identity and unaffected-line uploads, paused screen retention,
structural revisions through undo/redo, exit routing policy, live/parked/concurrent
train recolouring, and seeded restart equivalence with a legacy full rebuild for
24 subsequent ticks. GPU cache eviction remains pinned using distinct orientations.

Focused instrumented coverage (lines/branches/functions): populationEdit
100/100/100, artwork 100/81.82/100, presentationEdit 85.71/87.10/80;
StationSlice 70.97/65.52/44.44, ModuleSystem 64.19/54/24.39,
PlateSystem 58.96/63.89/57.69, TrainSystem 85.76/64.29/64.29,
World 71.23/69.08/70.16. These focused runs leave unrelated system methods
unexecuted; they are not whole-system coverage claims. Reports:
`remaining-coverage.log`, `remaining-system-coverage.log`. Production build passes
(`remaining-build-final3.log`).

The broad `npm --prefix game run test:perf` instrumentation was attempted again
(`remaining-perf-suite.log`) and stopped after several minutes without test output;
it is not counted as passing. Focused coverage and the production interaction
assertions completed successfully.

Final normal suite: **2,020 tests pass, zero failures/skips**
(`remaining-full-tests-final.log`). The first run exposed the old colour-allocation
expectation; its replacement still verifies bounded cache eviction and exactly-once
GPU disposal with distinct orientations. `git diff --check` passes.

### Passenger 10% Low LOD feasibility (2026-10-21)

A topology-only experiment against all 232 current atlas entries requested
`floor(highTriangles * 0.10)` triangles per appearance. It decoded the actual
standing frame and full index rows, compacted referenced vertex IDs, and used
existing baked vertices without changing the shipped atlas. The current shared
submission stride is 9,370 High / 2,825 Low triangles (30.15% retained); a 10%
shared-stride budget would be 937 triangles. Individual 10% budgets range from
382 to 937 triangles.

With the current meshoptimizer simplification method and 3% relative error,
0/232 entries reached their individual target (largest output: 2,824 triangles).
Raising the error limit to 5%, 10%, and 100% still reached 0/232 targets; even
100% left a largest row of 2,684 triangles. A permissive attribute simplification
experiment at 3% error reached only 3/232 targets, with a largest row of 2,501.
This indicates topology/seam restrictions as well as the error budget prevent a
simple target-constant change from enforcing 10%. Existing animated vertex
identity includes normals, palette and every pose; welding only by standing
position could merge vertices that move differently or cross material boundaries.

Raw per-appearance counts and the reproducible script are in ignored
`.preview/perf/passenger-10pct/report.json` and `assess.mjs`. These are offline
geometry feasibility results, not FPS, GPU or first-toggle latency measurements.
No production asset or runtime code changed. A 10% implementation would need
further topology work or authored reduced parts, with standing and all-walk
visual validation for hair, bags, straps, skirts and material boundaries. It
would reduce submitted triangle work, but retaining the shared pose pool would
not reduce the pose textures' memory.

## Complete palette Low geometry audit (2026-10-21)

The current inventory has 120 palette options, including the PSD end cover.
All 104 models above ten High triangles now have nonempty Low geometry with
strictly fewer triangles. The baseline had 45 identical High/Low models.
Across one default copy of every option, Low geometry falls from 23,563 to
20,804 triangles. These are geometry counts, not an FPS improvement claim.
The ten train consists and 232 baked passenger variants already had reductions;
the inventory now rejects missing Low variants in all three tables.

The small box-based families keep original artwork, UVs and colours. Thin sheets
retain both broad faces and omit narrow edges; rods omit their small end caps.
Pillars and circular lights have eight-sided Low cylinders, with painted pillar
UV scaling preserved. Guide columns omit buried bottom caps. The exact full
geometry remains available for picking and restoration; existing authored Low
variants take precedence. There is no runtime simplification or rig replacement.

Production quality switching on the shipped demo drew 397,264 triangles at Low
and 562,360 at High. First Low switch through two RAFs was 516.2 ms; the repeated
Low switch was 558.1 ms (High switches: 580.1 / 406.2 ms). This is a presentation
proxy on the current host, with other local work active, not a controlled timing
comparison or GPU duration. No shader/runtime/WebGL errors occurred; simulation
remained paused. Both native multi-draw and its extension-free fallback production
checks passed; the CPU/trace exporter check passed too.

The catalogue regression covers reduction before/after local batching and source
restoration. A separate panel regression pins UVs, exact removed-edge picking,
cached buffer identity and single disposal. Focused tests pass 219/219. Focused
line/branch/function coverage: `modelDetail.ts` 100/92.45/100%; dispatcher
97.37/91.07/100%; lights 100/100/100%; pillars 100/76.47/100%; street decor
100/91.40/83.87%. Production build passed. The first full game run passed
2,140 tests with zero skips. A final rerun after the additional panel regression
passed 2,140/2,141 with zero skips: the concurrently changed passenger LOD test
requires 10% geometry, while the current atlas's `male-original-bag` is
2,547/9,370 triangles. This palette work does not modify that test or atlas.
The broad `test:perf` instrumented run was stopped
after approximately 5.4 minutes without test output; the focused changed-module
coverage run completed as listed above. Raw inventories, baseline, quality-switch report,
browser checks and test/coverage logs are under ignored `.preview/perf/lod-*`
and `.preview/perf/model-triangles*`.

### Passenger Low LOD: every appearance below 10% (2026-10-21)

The approved atlas now enforces `floor(highTriangles * 0.10)` for each of its
232 appearances, as well as a 10% cap on the padded shared draw. High remains
9,370 triangles per submitted passenger; Low changes from 2,825 to **841 (8.98%
of High, 70.23% fewer than the previous Low)**. Real Low rows range from 371 to
841 triangles and total **123,928**, against 1,308,230 High triangles. The
published performance reference contains the regenerated 232-row inventory;
`PASSENGERS.md` summarizes its budgets. Raw inventory is
`.preview/perf/passenger-triangles.json`.

`tools/passenger-low-topology.mjs` builds separate faceted envelopes for anatomy
and palette regions, then simplifies the closed envelopes without pruning their
components. Original source faces retain exact extrema through every one of the
73 poses. Skirts keep their original cloth surfaces and use displacement
attributes from all three gaits during reduction, with a separate triangle
allocation. All Low corners reference existing animated vertices belonging to
that appearance and all triangles retain one original flat palette region.
This removes concavities and small detail and makes Low visibly faceted.

A bounds-only implementation was insufficient: grid clustering could retain
isolated extrema while deleting trouser surfaces, and standing skirt envelopes
lost fast-walk plan coverage. Both candidates were rejected. The deterministic
`passenger-lod` regression now checks projected surface coverage from three axes
in standing and four phases per gait for every appearance, in addition to exact
all-frame bounds, vertex ownership, flat palettes, both budgets and draw/disposal
contracts. The production capture can explicitly select Low while preserving
full-detail defaults for existing art callers.

A full bake consumed the reviewed GLBs. All 232 source hashes matched the prior
atlas. A subsequent `--low-only` bake verifies those hashes before regenerating
only Low fields; a repeat produced byte-identical JSON. SHA-256 comparisons show
that positions, normals, regions, full indices, source hashes, eligibility and
other library metadata are unchanged. The shared pose pool remains 226,731
vertices with 73 frames and 21 palette stops. Its texture memory is unchanged;
the smaller Low index table and geometry reduce their own allocations. JSON
shrinks from 42,746,457 to 40,707,627 bytes; decoded buffers total 177,616,422 bytes.

Production GPU validation compared **11,736 paired High/Low renders**: every
eligible adult/child appearance, all three gait profiles, standing and three
walking samples per profile, in isometric/elevation/plan views. Every comparison
passed the fixed gates (80% High-mask coverage, 70% intersection-over-union).
Worst overlap was **78.59%**, and minimum High-mask coverage **86.15%**. The
864 skirt-only comparisons reached minimum overlap 92.49% and coverage 95.63%.
Worst pairs were visually reviewed; no missing legs, shader errors or runtime
errors were accepted. These samples do not claim exhaustive visual coverage of
all interpolated poses, camera angles or age-size extremes.

The quality-switch browser fixture uses 232 paused passengers, seed 7654321,
viewport 852 x 715, DPR 1, Chrome 155 and hardware ANGLE/D3D11 on an RTX 4080 SUPER.
It drives the real settings buttons and measures event-to-two-RAF presentation
proxies, separately for first use and repetitions. Baseline first Low was
18.5 ms, repeats 29.5 / 18.6 ms; final first Low was 32.6 ms, repeats 22.3 / 26.9 ms.
This is **not evidence of lower switch latency or higher FPS**. Low submitted
scene triangles fell from 666,696 to 206,408; High stayed at 2,185,136. Both
prepared geometries and instance buffers were retained, all 232 passengers
remained drawn, the paused tick/document version stayed unchanged, and GL/shader
error counts were zero. No second pose atlas or runtime simplification was added.

Validation: production build/typecheck passed; full game suite **2,144 passed,
zero failures/skips**; model suite **9 passed**; focused final coverage **17 passed**
with reducer **100% lines, 96% branches, 100% functions**; `check-perf-tools` passed.
The capture module is exercised in the production browser; its source-contract
Node tests do not provide runtime V8 coverage. Raw bake logs, integrity hashes,
paired masks, worst-pair PNGs, benchmark JSON and coverage/test logs are under
ignored `.preview/perf/passenger-10pct/`.

The broad `npm --prefix game run test:perf` instrumented run was stopped after
approximately 15 minutes without completion (its log reached the passenger
all-frame bounds test). This is not a passing full performance-coverage result.
The final reducer's focused coverage, the full normal game suite and production
GPU comparisons above passed independently. No test was skipped or weakened to
make the triangle-budget change pass.


## 2026-10-21: road and train Low geometry capped at 10%

Low road traffic and every train stock now have a hard budget of at most
10% of their own High triangles. High source counts remain unchanged.
Road totals below include the matching depth-only prepass; train totals use
production static batching, door banks and sorted glass, with third-rail roofs.

| Road vehicle | Low submitted triangles | High submitted triangles | Low / High |
|---|---:|---:|---:|
| bus-orange | 956 | 11224 | 8.52% |
| bus-mosaic | 1014 | 11506 | 8.81% |
| suv | 464 | 5136 | 9.03% |
| sedan | 436 | 4984 | 8.75% |
| moped | 612 | 7120 | 8.60% |
| bicycle | 764 | 8160 | 9.36% |

| Train | Previous Low | Final Low | High | Low / High |
|---|---:|---:|---:|---:|
| D-8 | 129952 | 78144 | 1303424 | 6.00% |
| D-6 | 104876 | 61196 | 1008052 | 6.07% |
| A-8 | 166728 | 71016 | 730512 | 9.72% |
| A-6 | 126140 | 54612 | 574244 | 9.51% |
| C-6 | 112708 | 50516 | 534888 | 9.44% |
| B-6 | 109376 | 48480 | 513888 | 9.43% |
| L-6 | 96120 | 44272 | 464576 | 9.53% |
| C-4 | 76640 | 35616 | 395652 | 9.00% |
| B-4 | 74332 | 34028 | 378236 | 9.00% |
| L-4 | 65260 | 31132 | 344492 | 9.04% |

The regression exercises all **80** stock/length/power combinations: A/B/C/D/L,
one through eight cars, third rail and catenary. Each stays within its own 10%
budget with both door banks moving and restores the exact High count.

Road Low uses outward thin panels, open triangular rods, diamond car/bus tyres
and hubs, flat wheel-arch strips and two-sided open bicycle rims/spokes.
Fine basket grid is omitted while its outline remains. Train Low retains real
door/window apertures and both broad frame faces, hollow triangular straps,
coarse handrails/ring lights, wheel tread/flange profiles and suspension shapes.
Fine brake/bearing fittings are omitted. D cab trim has explicit reduced surfaces;
its Low windshield has denser sampling and separation from the coarse crown and
surround to prevent intersections. A ray regression samples both cab ends.
No runtime simplification or extra quality-switch geometry allocation was added.

Production captures cover 50 High/Low pairs: all stocks and both roofs in front,
side, three-quarter closed/half-open/open poses. Elevation masks must retain
80% High coverage and 70% intersection-over-union. Road front/rear views and
representative train pairs were visually reviewed, including the corrected D
windshield. The High road front PNG matches its baseline SHA-256 exactly.

Validation: production build/typecheck passed; the final full game suite passed
**2,147 tests, zero failures/skips**. Native and extension-free GPU batching
checks passed with no GLSL, WebGL or runtime errors; profiler exports passed.
The floor-detail test now asserts the existing policy that Low remains Low in
Hide UI. The road geometry regression is included in future test:perf runs.
Raw inventories, browser captures, timing JSON and test/coverage logs are under
ignored `.preview/perf/transport-10pct/`; road captures are also retained under
`.preview/road-vehicles/`.

The paused production quality-switch fixture uses seed 7654321, a 24 × 1000 m
road with all six traffic variants, and five A/B/C/D/L services (8/6/6/8/6 cars).
Chrome 155, hardware ANGLE/D3D11 on RTX 4080 SUPER, viewport 852 × 715, DPR 1.
The real settings buttons measure event-to-two-RAF presentation proxies:

| Quality | Baseline first / repeat / repeat (ms) | Final first / repeat / repeat (ms) |
|---|---|---|
| low | 23.0 / 22.5 / 26.8 | 21.8 / 18.3 / 29.7 |
| high | 24.5 / 24.5 / 30.6 | 28.8 / 25.5 / 17.0 |

Low scene triangles fell from **1,304,998 to 749,766**; High remained **5,622,354**.
Traffic populations, prepared train detail arrays, road geometry and instance
buffers were retained. Tick and document version stayed at zero; GL, shader and
runtime errors stayed at zero. Model preparation was 6802.7 ms before / 6435.7 ms
after. These samples establish fewer triangles and retained switch resources;
they do **not** establish higher FPS or lower switch latency.

All 20 elevation comparisons passed, with minimum High-mask coverage **98.31%**
and minimum intersection-over-union **98.29%**. The other 30 pairs capture three
door poses for visual review. Targeted runtime coverage passed six regressions
with **100% lines, branches and functions** in TrainDoorLow, TrainWindowLow,
TrainStrapLow and VehicleKit (`targeted-coverage.log`). The broad instrumented
`test:perf` attempt was stopped after 592 seconds without completing; a wider
focused instrumented attempt was stopped after 258 seconds. Neither is counted
as passing coverage. The targeted coverage and the full normal suite passed
independently; no budget regression was skipped in the normal suite.

The required artwork refresh completed after validation: 24 train stills, 60
real door/headlight poses and 25 module cards were recaptured. Sheets 01, 02,
04, 05, 11, 12 and 13 were regenerated in both locales, with 14 current browser
previews at 8 seconds and 14 tracked 300-DPI print exports. Reviewed layouts
retain model details, collectors, door alignment and readable labels. Train-art
pipeline tests passed 6/6; all 16 train playback samples and passenger gait
playback checks passed. The web build synced the regenerated SVGs and passed.

## Build-rail thumbnail cold open (2026-10-21)

The rail used to create a WebGL renderer and photograph all 120 module options on the
first Equipment open. `tools/bench-menu-thumbnails.mjs` starts a fresh Chrome profile,
waits for the production app, opens Equipment, scrolls its first preview into view, and
records the first ready PNG plus browser long tasks. The baseline cold open took
**1,964 ms** before 52 data-URL thumbnails appeared; the corresponding long task was
**1,946 ms**. After moving the same 132 px render to checked-in PNG assets, first-visible
image time was **447–516 ms** across two cold runs; 34–35 of 151 menu images loaded with
no failures. The measured open-to-image time fell about **76%**. A 397–420 ms long task
remains during the React/menu expansion and image presentation; the thumbnail renderer
itself is gone.

The source PNGs total **648 KiB** for all 120 options. They are generated at 132 × 132,
matching the 1× cold-capture viewport; the rail uses async decoding and native lazy
loading. This measurement covers local production assets under SwiftShader at 1400 ×
900, not WAN transfer or hardware GPU timing. App-ready time was 2,928 ms before and
2,684 ms after in the single cold samples, so this change does not claim to speed the
station's broader initial boot. Raw reports and Chrome profiles are in
`.preview/perf/menu-thumbnails/`; regenerate with `npm --prefix game run build`,
`npm --prefix game run render:menu-thumbnails`, then `npm --prefix game run build`.
