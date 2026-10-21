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
