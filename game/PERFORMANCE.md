# Current performance state

Verified 2026-10-19. One editable block is 1 m; stations use a single 5 m
storey profile and trains use uniform 0.98 scale. Measurements below describe
the current geometry and the latest completed validation. Raw reports belong
in ignored `.preview/perf/`.

## Block drag footprint

One 方块 drag is capped at 10,000 preview/placement cells, counting generated
auto-wall courses too. A drag over that budget is refused whole: while the
pointer is still down every cell in the requested footprint is drawn as a red
box and the bottom notice says the area is too large; the release then commits
nothing. The footprint is never clipped, so the red preview and the empty
release tell the same story. Shift lines and 三角 ridge runs count against the
same budget, and a release of exactly 10,000 cells still places.

The preview still waits 100 ms for the snapped block to remain the same, then
builds, validates and draws the complete latest footprint once; the pointer
cursor updates immediately. Production-browser measurement on an empty station,
active level 1, 99×99 real pointer drag (9,801 cells) with auto-walls off,
1424×905 viewport, Headless Chrome 155 / SwiftShader: the settled ghost draw
submitted 9,801 cells in 59.8 ms cold / 49.5 ms warm. Move event-to-two-frame
readings were 209.0 ms cold / 194.9 ms warm. The warm release handler took
436.6 ms and the release event-to-two-frame 484.8 ms — the accepted 9,801-cell
commit and its chunk rebuild are synchronous, and SwiftShader timings are
diagnostic rather than a GPU performance claim. Raw report:
`.preview/perf/block-drag-10000.json`. Reproduce with `npm run bench:block-drag`.

The deterministic `blocktool` regressions pin the 10,000-cell boundary, the
whole-footprint refusal (all cells red, no commit, notice raised during the
drag), auto-wall inclusion, and the Shift/三角 line counts. A deterministic
scheduler regression confirms that a changing snapped cell replaces the pending
draw, while repeated events over the same cell keep the timer and use the latest
event data.

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
