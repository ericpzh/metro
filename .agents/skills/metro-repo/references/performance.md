# Performance work in metro

This is the repo's single performance reference: the contracts that keep the game
interactive, the current model inventory, and the measured state of the production
paths. Raw profiles, reports and screenshots belong in ignored `.preview/perf/`.

Performance work is part of `metro-game` and `metro-game-test`. For every change,
measure the reported interaction — including its first invocation — and leave a
deterministic work-count regression that fails if the measured cause returns.
Browser timings are evidence; deterministic assertions are the gates.

## Reproduce the reported interaction

Measure the actual event sequence before choosing an optimization. For a drag,
separate hover, pointer-down, first movement, continued movement, release and
cancel. Compare the first invocation with warmed repetitions. A smooth steady drag
can hide a long initialization stall; placement-helper timings alone do not measure
the pointer handler or the first rendered frame.

Use the supplied station through `BENCH_STATION` without replacing the shipped
demo. `node tools/bench-stair-drag.mjs` drives real browser input and counts
raycasts on initial stair-block pickup. `bench:sim` measures CPU helpers and
simulation; `bench:browser` measures the app, worker and rendered frames.

Record work counts alongside time: raycasts per event, graph/model rebuilds,
allocations, uploads and cache hits. Do not locate a picked module by scanning with
a scene raycast per document entry (`modules.find(m => m.id === pickModule(...))`
repeats a full scene raycast on every miss). Pick once, then find the document entry
by ID. Test both a miss and a hit near the end of a realistically large module list.

The demo workflow tour (`npm run bench:usage-tour`) loads Zoo and Tanwei in separate
fresh browser sessions, records fixture size, browser, viewport and GPU backend,
and writes `.preview/perf/usage-tour.json`. It sweeps all 120 palette options
through cold and warmed production model previews, measures first and repeated
hover for all 11 pointer tools, performs a real bench place, move, pick, delete and
undo round trip, and records WASD pan, Q/E storey changes, wheel zoom, orbit drag,
line colour, exit open/restore, date selection and play/pause. Set `BENCH_DEMO`
for one fixture and `BENCH_OUTPUT` for another report path; `METRO_BROWSER_GPU=hardware`
opts out of the default SwiftShader backend. Tour timings include protocol round
trips and are diagnostic, not pass/fail thresholds.

### Q/E level switching

Use `node tools/bench-level-switch.mjs` against both shipped demos after building
`game/dist`. Record the first real Q/E press separately from warmed presses,
opening prewarm time, batch-cache hits, retained allocations, draw calls and
triangles. `--no-multi-draw` checks the fallback renderer. A level-cache hit must
preserve exact batch allocations and must not advance the paused simulation.

Opening prepares the actual editing storey and both valid Q/E neighbours from
`levelBase`, using `STOREY_HEIGHT` and `levelSteps(levelBase)`. Never infer
neighbours from the lowest rendered chunk or assume a four-metre step. The editing
grid translates on Q/E while retaining its geometry and buffer, rebuilding only
when horizontal station bounds change. Pin neighbour boundaries, shifted bases,
cache invalidation/disposal and grid allocation identity in
`game/test/level-view-cache.test.mjs`.

## Keep interactive work bounded

- Hoist event-invariant queries out of loops and predicates. Reuse the hit,
  camera aim and document indexes throughout the event.
- Keep previews out of undo/commit and worker routing paths. Validate on release
  and commit the accepted run once.
- Coalesce replaceable pointer previews per frame; flush before release and
  cancel stale callbacks on cancellation, tool changes or unmount. Preserve all
  samples for deletion sweeps and touch gestures that depend on the path.
- Count a drag's footprint arithmetically before allocating it. The shared
  `MultiPlaceDrag` scheduler uses a 50 ms latest-target throttle for block, wall,
  fence, tactile, road, tile-equipment and related placement drags: target changes
  replace pending work without restarting the timer, so motion does not starve
  preview. It skips an unchanged rendered target, keeps the prior accepted preview
  visible while work is pending, and flushes/cancels on release/cancel. Roofs use
  a one-callback frame scheduler. Preserve each tool's preview/refusal contract;
  known over-budget targets clear accepted layers immediately and remain refused
  whole. The 10,000-cell budget applies to all supported placement drags and
  includes generated auto walls.
- Never assume the configured wait is the full delay. Profile callback work,
  ghost submission and event-through-two-RAF separately, for both the first and
  repeated interaction. Keep CPU readiness distinct from displayed-pixel/GPU
  latency. Demo stations expose collision cascades that empty-floor fixtures miss.
- Cache block occupancy and exact blocker verdicts by immutable `cells`/`modules`
  arrays; prepare collision bodies once per module snapshot and query local spatial
  buckets. Bound per-snapshot verdict retention. A blocked drag may retain one
  refused coordinate as a constant-time red-cursor witness while its footprint
  covers that coordinate; clear it on geometry/settings/footprint changes. Do not
  reuse scheduler output across document identity changes just because the pointer
  key or station epoch is unchanged. Preserve refusal priority, blocker order,
  exact geometry and partial-acceptance/release semantics.
- Retain unaffected geometry and GPU allocations. Move pickup/cancel masks the
  lifted piece and restores neighbours without rebuilding the station.
- Key prepared data by immutable document inputs and test invalidation. Bound
  caches that retain GPU resources and verify disposal on eviction and teardown.
- Preserve picking IDs, storey visibility, material ownership, animation and
  geometry. Hidden drawing must not change simulation ticks, RNG, train dispatch,
  routes or passenger identity.

### Pointer picking and geometry snapping

Pointer tools resolve one event-scoped scene ray and a lazy scene intersection
snapshot, then reuse the visible hit or miss for every block, module, surface,
normal, bounds and roof query. Overlapping lift roots are traversed once;
plane-only queries do not traverse scene geometry. Each interpolated deletion
sample keeps its own cached position. Queued movement is flushed before the
release event's pick scope opens. The shared snapshot lives in
`render/scene/systems/CameraSystem.ts` and is dispatched through `Viewport.tsx`.
Never invoke a scene raycast inside a document search predicate.

Placement and move snapping follow actual scene geometry, never a nominal storey
band or editing base: floor, wall, ceiling, beam and shaft surfaces decide the
anchor. Prefer the nearest visible object surface over terrain behind it; map
hanger hits to the hanger's real attachment anchor and leave support/refusal to the
shared validator. Preserve erase and floor-paint policies.

Fresh and carried module anchors resolve through `app/tools/moduleAim.ts`. Selection,
picking and deletion fallbacks resolve through `app/tools/moduleTarget.ts`; coarse
stair/escalator/walkway envelopes cannot make a run selectable through a nearer
visible block, and forgiving bounds queries reject runs whose actual surface lies
behind that block. Preserve outdoor canopy and paving priority.

`tools/check-geometry-snapping.mjs` drives real mouse placement/move fixtures for
slabs, hangers and wall mounts across editing bases 0, 2 and 4, plus low-angle
object picks for construction tools: 69 dispatches, maximum one raycast per
dispatch, no browser errors. The slab preview/commit/move anchor stays at 17 m and
the hanger anchor at 11 m at every base. `tools/check-tool-picking.mjs` covers
ceiling props, ramp occlusion, deletion, undo/redo and all eleven tools' first/warm
hovers: 38 dispatches, one raycast maximum, no browser errors. Pin event reuse in
`tool-picking.test.mjs`, ramp occlusion/deletion/undo in `ramp-targeting.test.mjs`,
geometry anchors in `geometry-snap.test.mjs`, and low-angle targeting/occlusion in
`placement-surface.test.mjs`.

### Placement invalidation and model retention

Every equipment, structure and decor module is classified against the inputs its
builder actually reads. Unknown future dependencies keep the conservative rebuild
path. The current policy retains remote models as follows:

| Placement work | Current behaviour |
|---|---|
| Roads | Rebuild only when a road's ink, junction sides, arrival markings or signals change |
| Tracks/platform screens | Compare third-rail side and neighbouring gantry posts; screens retain their owning-track dependency |
| Screen-end returns | Rebuild the return when its referenced corner changes |
| Pillars/roof hangers | Compare supporting bridge height or actual suspension heights |
| Hung decor | Compare the actual common ceiling height |
| Ramps/lifts/exits | Retain remote pieces; conservatively rebuild intersecting columns and nearby landings |
| Sidewalk/lawn | Compare actual opening/ground visibility |
| Tool occupancy and chunk preparation | Reuse prepared inputs for equipment-only edits within the existing street window |
| Road, screen end, moving walkway | Skip chunk preparation/remeshing when cells and street bounds are unchanged |
| Existing signs/inscriptions/maps | Repaint only changed plate inputs; name/line edits still propagate |
| Contact shadows | Retain batches and power-of-two capacity; upload changed matrices only; shrink excessive capacity and release empty levels |
| Functional simulation edits | Install the latest snapshot in one queued worker task per 100 ms window |

The worker retains its old document and graph together until installation; ticks
continue against that coherent pair. Cosmetic edits join pending topology work.
Installing an edit does not advance the simulation clock. Loading another station
cancels pending edits, and a burst undone to the applied document skips the graph
rebuild. Initial station loading remains immediate. The queued job still performs
a complete graph rebuild; the change coalesces and defers that work rather than
making graph construction incremental.

Structural edits invalidate dependent model families. Functional equipment edits
inside the existing street window skip chunk remeshing independently of the
worker's routing decision. Common hover previews use the prepared station; move
pickup caches its one removal, and coupled previews keep their candidate list.
Curtain lookup uses the immutable glass index rather than scanning unrelated
modules.

Deterministic work counts live in `placement-invalidation` and the related
`stationGeometry`/`moduleDependencies`/`structuralModelInputs` suites. The current
policy adds the 119 palette options beside a remote catalogue containing every
option and replaces no remote models on placement or deletion. Remaining
document-wide work is dependency/index bookkeeping and structural chunk-input
derivation. Actual structural/cell changes, street-window expansion, station
metadata/language/artwork changes and unknown model dependencies retain their
conservative invalidation paths. Chunk meshes and equipment draw buckets still
reuse unchanged GPU allocations.

### Settings and presentation edits

Settings and presentation edits have a separate fast path. Line/station/exit
labels, line colours, termini (including optional English secondary names),
population, exit policy, headways, opening hours, peak windows and demand curves
must not rebuild station geometry or routing. The RHS line editor
(`app/windows/inspector/LineCard.tsx`) uses compact square tiles and fixed-width
headway inputs; keep its bilingual terminus drafts in one commit/undo step.
English terminus names persist in `LineDef` and appear beneath the matching
directional destination on platform signage.

Names, line colours and termini repaint only artwork whose declared inputs changed,
retaining module roots, geometry, materials, atlas slots and static batches. PSD
colour bands use live textures; train recolouring updates the owned livery material
and retains door buffers. Unknown artwork dependencies keep the conservative
rebuild path. Invisible population and exit-policy edits must not request a frame.

Exit open/closed and population changes patch the running document without
rebuilding connectivity or requesting a 3D redraw. Closing an exit excludes new
spawns/destinations while allowing existing journeys to complete. A separate
geometry revision prevents metadata/history changes from rebuilding zone and move
overlays. Restart reuses the static graph, node indexes and collision buffers while
resetting dynamic queues, servers, lifts, dispatch, route caches and routing
scratch state.

Settings history shares the immutable document instead of deep-copying its
geometry. Undo/Redo send compact settings patches and preserve the same prepared
scene/geometry. Structural edits retain the conservative snapshot/build behaviour.
Same-document commits, stale line IDs and unchanged scalar line patches do no work.
Explicit stock/cars/power/PSD retries still run: an identical geometry option can
legitimately retry a previously refused rail resize after removing a blocker.

`nonstructural-updates`, `equipment-retention`, `train-lod`, `line-edit`,
`population-edit` and `scene-wiring` pin these contracts.

### Build-rail thumbnails

The build rail's module previews are checked-in 132 × 132 PNGs generated by
`tools/render-menu-thumbnails.mjs`; do not restore startup WebGL thumbnail
rendering. The source PNGs total 648 KiB for all 120 options. The rail uses async
decoding and native lazy loading. After changing the module catalogue or preview
renderer, regenerate them with `npm --prefix game run build`,
`npm --prefix game run render:menu-thumbnails`, then build again. Keep the
catalog/asset regression in `menu-thumbnails.test.mjs`.

### Suspended ceilings

The 吊顶 variant follows the same `checkBlockCells` preview and release path as
ordinary blocks. Keep the original station arrays intact during hover so the block
index and verdict cache remain reusable; never prepare a copied module list or
relocate existing hung fixtures. `addSuspendedCeiling` validates every cell against
the original station, tags and finishes accepted cells, and leaves fixture anchors
unchanged. Normal collision refusals remain in effect. Deterministic coverage pins
preview-cache reuse, fixture anchor retention, overlap refusal, release refusal and
reuse of the ordinary block preview cache in `storey-height.test.mjs`.

## Collect comparable evidence

Run benchmarks sequentially, without builds, tests or other profilers competing
for the host. Use distinct `BENCH_OUTPUT` paths for comparable, final and profiled
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

### Shared interactive previews

`GhostSystem` owns all module/fence preview contexts and resource release.
`ModulePreviewDocument` keeps the immutable station (or one source-removal document
per carried piece); proposed geometry neighbours go through `modelNeighbours`,
never a copied station per pointer cell. Unknown future module kinds retain the
conservative resolver until their dependencies are audited.

Ordinary and carried equipment share `EquipmentPreview`, `EquipmentBatches`,
`SourceGeometryDetail` and `detailHeight` with placed equipment: Low, camera
distance, other-storey and Hide UI must select the same authored geometry.
Instanced roofs retain their source Low link. Restore High references before
disposal. Long roof runs use matching 16 m/storey buckets with shared geometry, so
their far end can reduce independently while all 10,000 tiles remain visible.

Use `clearToolPreview` for cross-tool cancellation, including face ghosts and road
handles; clearing an unused layer must not allocate it. Paint and zone rectangles
share the existing 50 ms latest-target scheduler, while release computes its own
final edit and cancels queued drawing. Face pools grow to cover the full edit.

Equipment collision previews/release share immutable spatial buckets and the fence
connection index; keep fence-arm tile bounds, hypothetical new joints,
carried-origin exclusion, ordered blockers and broad-import fallback intact.
Tactile runs use an anchor index rather than one module search per tile. Glass
joints reject against the full possible fence-arm tile before resolving the four
neighbour directions.

Fence/gate/landing indexes are prepared with the document; candidate connections
overlay that index without copying or scanning the station document, and only the
neighbouring buckets are masked. Keep hidden lower-storey source roots alive
through cancel and release.

`node tools/bench-preview-audit.mjs` sweeps the production palette plus
hover/drag/carry cancellation; `node tools/check-preview-lod.mjs` checks real glass
wall picks, Low/High topology and preview/commit height agreement.
`node tools/check-tool-picking.mjs` covers event reuse and ramp occlusion/deletion.
Keep the `preview-pipeline` and `preview-lod` all-palette geometry equivalence,
local work counts, single ownership and LOD restoration assertions.

### Drag previews and collision

Placement drags share the 50 ms latest-target cadence: blocks, walls, fences
(including the fence-run decor), tactile paving, stair blocks, sidewalks, lawns and
roads. Changing a snapped cell replaces pending work without restarting the timer.
Today's accepted preview remains visible until its replacement is ready. A known
oversized target clears accepted layers immediately and draws the whole refused
footprint on the same cadence. The 10,000-placement limit and release verdicts are
unchanged. Roofs retain their faster one-callback frame scheduler.

Every multi-cell drag that places equipment or decor shares the 10,000-cell budget
in `app/tools/geometry/multiPlaceDrag.ts`. Block patches include generated
auto-wall courses; full-height wall columns count each course; fence and tactile
lines count panels; roof, stair-block and outdoor drags count generated tiles;
roads count their rectangular cell footprint. The count is checked before the
large preview allocation. Over-budget drags are refused whole, show a red footprint
after the pointer target settles, and commit nothing. A 10,000-cell release remains
accepted.

Block collision keeps a per-snapshot verdict cache bounded to 20,000 cells.
Growing/shrinking drags reuse covered cells and check only unseen coordinates.
Changing either the cells or modules array invalidates its verdicts, including
blocker removal/movement and undo/redo. Level occupancy and exact block-collider
bodies are prepared once per module array; lazy 16 × 16 buckets per height course
find nearby blockers. The block cursor keeps one refused coordinate as a
constant-time witness: it remains red while the rectangle covers that coordinate
in the same snapshot, and an unchanged preview key cannot reset it to cyan.
Shrinking clear, station/settings changes, cancel and release invalidate it. The
shared preview scheduler invalidates cached rendered keys when cells/modules
identity changes; `stationEpoch` alone only tracks opening a station. Shift lines
conservatively require the exact preview key before reuse. Broad imported bounds
use a bounded fallback in document order.

Roof previews build one exact model per homogeneous run and instance its geometry;
all variants retain their full shape and rotation. Placement checks use one
immutable document, skip existing tiles through a cached footprint index, and
append accepted disjoint roofs in one edit. Roof collision queries use immutable
cell buckets at each height, retaining the exact collision-box verdict and
naturally invalidating on a new cell array. Accepted roofs use the frame scheduler:
at most one pending animation-frame callback, latest target wins without restarting
the wait, and an unchanged rendered target does no work. The viewport flushes the
work inside its existing coalesced pointer frame. Explicit release drains avoid
building a preview that is about to be discarded. Over-limit refusals keep
immediate red cursor/notice feedback.

The hover and drag paths share the instanced preview path and a 16-entry material
cache keeps the shader owner alive across target replacements. Clearing geometry
does not dispose the last material using that program. Refusal tints are distinct,
source materials stay scene-owned, clipping changes propagate, and eviction/teardown
release cached clones.

`block-collision-cache`, `multi-place-drag`, `frame-preview`, `solid-cell-index`,
`roof-tool`, `roof-preview`, `preview-material-cache` and `blocktool` pin these
contracts. Existing placement and block-tool tests pin release agreement.

### Fence drags and equipment placement

Two production pointer benchmarks cover the station-wide invalidation paths:

- `node tools/bench-fence-drag.mjs` drives hover, press, a long press, three drag
  movements, Escape/cancel and a repeated drag/release over 256 fences. It records
  preview CPU, event-through-two-RAF latency, group counts, `syncBatches` calls and
  hidden-source leaks per phase. Build `game/dist` first; set
  `METRO_BROWSER_GPU=hardware` for hardware timing and give each run a distinct
  `BENCH_OUTPUT` path. `BENCH_CLOSE=1` captures the close view.
- `node tools/bench-tree-placement.mjs` with
  `BENCH_EQUIPMENT_FIXTURE=1 SKIP_LAWN=1 COUNT=1 PIECE=bench` (or `PIECE=tvm`)
  measures the first hover/press/release of one functional piece against 128
  untouched fences. It separates retained/replaced/added models, chunk remesh,
  `setStation` CPU and worker acknowledgement from end-to-end frame latency.

Keep preview work local: prepare the fence/gate/landing index with the document,
overlay the drag's candidate joints, and mask only the affected equipment buckets.
Do not copy the station document for an ordinary hover, and do not remesh or rebuild
unrelated models for a functional equipment edit. `fence-preview` and
`equipment-retention` pin the deterministic work counts.

### Block collision in demo stations

Use `node tools/bench-drag-latency.mjs` with `BENCH_PIECE=block` and
`BENCH_DEMO=zoo` or `tanwei`; choose `BENCH_SIDE` to include the real collision
footprint. This loads the shipped example without replacing its authored data.
Measure cold and warm movement through the real pointer path, including a blocked
rectangle, then compare accepted/refused counts, callback CPU, ghost CPU and the
two-RAF presentation proxy. `BENCH_ASSERT_WITNESS=1` checks that tiny movement
within the same snapped blocked target leaves the cursor red without another
preview draw. `BENCH_PROFILE=1` captures CPU profiles and `BENCH_CONTINUOUS=1`
measures intermediate previews during ongoing movement. Browser timing is
supporting evidence; the deterministic work-count regression is the gate.

## Per-model geometry detail inventory

Triangle counts are for one model built from each palette option's default
configuration. High is the full model geometry; Low uses the renderer's reduced
geometry wherever that model part has a supported approximation, and keeps
unsupported parts at full detail. These are model triangles, not totals across all
placed copies. Width, length, style and material controls can create additional
variants; the table lists the 120 shipped palette options.

Regenerate all four tables with `node tools/model-triangle-inventory.mjs`; it writes
ignored `.preview/perf/model-triangles.{json,md}`, `train-triangles.{json,md}` and
`passenger-triangles.{json,md}`. The inventory builds equipment and trains through
the real renderer path (batching included) and reads passengers from the baked
atlas records. Update this reference after changing models or the detail policy.

### Ambient road vehicles

Ambient road vehicles are seeded into the six models listed below. Counts are per
vehicle instance and include the colour geometry plus its matching depth-only
prepass; the prepass suppresses far-side fittings. High uses 70% opacity; Low
vehicles and Low passenger bodies use 45%. Low road vehicles stay at or below 10%
of High's submitted triangles (including the depth pass). Low is an authored
geometry variant selected by the game's Low graphics setting, not a runtime
simplification. Regenerate the production counts and front/rear captures with
`node tools/check-road-vehicles.mjs`; the ignored report and images are in
`.preview/road-vehicles/`. The app keeps only the active quality visible and packs
traffic into its matching instance buffers.

| Ambient road vehicle | Low triangles | High triangles |
|---|---:|---:|
| Guangzhou bus, pale/orange | 956 | 11,224 |
| Guangzhou bus, red mosaic | 1,014 | 11,506 |
| SUV | 464 | 5,136 |
| Sedan | 436 | 4,984 |
| Moped with rider | 612 | 7,120 |
| Step-through bicycle with rider | 764 | 8,160 |

Each Low model preserves the body outline, windows and required fittings while
reducing wheels, repeated rods, spokes, fender tessellation and bus-window
mullions. Low uses diamond hubs, four-corner body sections, coarse rounded
fittings, flat outward arch strips and LED segments; cars omit door handles and
chrome belt strips. Thin fittings keep their outward face, rods use open triangular
tubes, and bicycle wheels retain two-sided open rims and spokes. The basket keeps
its perimeter. `road-vehicles.test.mjs` pins the reduction, instance switch, pause
behaviour and exact resource release.

### Equipment and decor

The current inventory covers 120 palette models totalling **9,279 Low / 154,963
High triangles**. Every individual High count is unchanged by the Low work. **60
options are strictly below 10%** of their High geometry; **60 use a minimum usable
shape** (44 user-approved exceptions plus 16 two-triangle artwork/floor quads).
`tools/equipment-low-budgets.mjs` shares the strict integer limit
(`ceil(High / 10) - 1`) and explicit exception caps between inventory, regression
and browser checks. No High geometry is inflated to meet the ratio.

Counts are for one built model through the production batching/detail path;
configured sizes and neighbouring pieces can change them. Low combines authored
reductions and supported prepared approximations; unchanged parts keep their High
geometry. A 100% share means that default model has no reduction.

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
| 半球机 | `cctv-dome` | 5,208 | 336 | 6.5% |
| 自动步道 | `walkway` | 5,162 | 290 | 5.6% |
| 立柱球机 | `cctv-post` | 5,096 | 352 | 6.9% |
| 洗手池 | `sink` | 4,972 | 224 | 4.5% |
| 球机 | `cctv-ptz` | 4,924 | 308 | 6.3% |
| 白色矮架 | `shelf-white-short` | 4,420 | 192 | 4.3% |
| 扶梯 | `escalator` | 3,410 | 204 | 6.0% |
| 空调风机 | `ac-unit` | 2,924 | 140 | 4.8% |
| 左直跑楼梯 | `stair-leftForward` | 2,336 | 232 | 9.9% |
| 右直跑楼梯 | `stair-rightForward` | 2,336 | 232 | 9.9% |
| 左双跑楼梯 | `stair-left180` | 2,288 | 222 | 9.7% |
| 右双跑楼梯 | `stair-right180` | 2,288 | 222 | 9.7% |
| 中直跑楼梯 | `stair-centerForward` | 2,240 | 212 | 9.5% |
| 左转角楼梯 | `stair-left90` | 2,240 | 212 | 9.5% |
| 右转角楼梯 | `stair-right90` | 2,240 | 212 | 9.5% |
| 时钟 | `clock` | 1,940 | 188 | 9.7% |
| 单跑楼梯 | `stair-straight` | 1,940 | 150 | 7.7% |
| 枪机 | `cctv` | 1,888 | 124 | 6.6% |
| 电梯 | `lift` | 1,740 | 140 | 8.0% |
| 设备柜 | `electrical-cabinet` | 1,224 | 36 | 2.9% |
| 大 | `extinguisher-glass` | 918 | 86 | 9.4% |
| 有盖 单向 | `exit-covered-1` | 902 | 68 | 7.5% |
| 有盖 双向 | `exit` | 902 | 68 | 7.5% |
| 有盖 三向 | `exit-covered-3` | 902 | 68 | 7.5% |
| 有柱雨棚 | `roof-canopy` | 840 | 56 | 6.7% |
| 圆点提示 | `tactile-warning` | 812 | 4 | 0.5% |
| 铁围栏 | `fence-iron` | 768 | 72 | 9.4% |
| 收银台 | `checkout` | 750 | 64 | 8.5% |
| 新 | `gate-new` | 720 | 68 | 9.4% |
| 信号机 | `rail-signal` | 708 | 64 | 9.0% |
| 自动售货机 | `vending` | 676 | 40 | 5.9% |
| 旧 | `gate` | 668 | 64 | 9.6% |
| 办公桌 | `desk` | 652 | 60 | 9.2% |
| 粗支柱 | `pillar-thick` | 576 | 48 | 8.3% |
| 无盖 双向 | `exit-uncovered-2` | 554 | 52 | 9.4% |
| 无盖 三向 | `exit-uncovered-3` | 554 | 52 | 9.4% |
| 无盖 单向 | `exit-uncovered-1` | 530 | 52 | 9.8% |
| 门 | `fence-gate` | 432 | 38 | 8.8% |
| 收束桁架 | `roof-tapered` | 396 | 38 | 9.6% |
| 售票机 | `tvm` | 372 | 30 | 8.1% |
| 长 | `busstop-long` | 372 | 30 | 8.1% |
| 玻璃围栏 | `fence` | 360 | 26 | 7.2% |
| 不锈钢 | `door-steel-1` | 324 | 20 | 6.2% |
| 玻璃 | `door-glass-1` | 324 | 18 | 5.6% |
| 桁架 | `roof-truss` | 264 | 26 | 9.8% |
| 短 | `busstop-short` | 260 | 24 | 9.2% |
| 圆形 | `light-circular` | 256 | 18 | 7.0% |
| 壁挂式 | `monitor-wall` | 213 | 8 | 3.8% |
| 草坪 | `lawn` | 204 | 12 | 5.9% |
| 垃圾桶 | `bin` | 196 | 26 | 13.3% |
| 通风口 | `vent` | 168 | 32 | 19.0% |
| 靠背座椅 | `bench-seat-1` | 156 | 20 | 12.8% |
| 中 | `extinguisher` | 146 | 12 | 8.2% |
| 小 | `extinguisher-compact` | 146 | 12 | 8.2% |
| 木 | `door-wood-1` | 144 | 20 | 13.9% |
| 人行道 | `sidewalk` | 132 | 12 | 9.1% |
| 屏蔽端门 | `psd-end` | 114 | 30 | 26.3% |
| 电视 | `tv` | 114 | 22 | 19.3% |
| 全高声屏障 | `noise-barrier` | 108 | 46 | 42.6% |
| 半高声屏障 | `noise-barrier-half` | 108 | 46 | 42.6% |
| 交通灯 | `traffic-light` | 108 | 28 | 25.9% |
| 不锈钢 | `bench-steel-1` | 84 | 16 | 19.0% |
| 吊挂指示牌 | `sign-ceiling` | 74 | 18 | 24.3% |
| 吊挂式 | `monitor-ceiling` | 72 | 20 | 27.8% |
| 条形导向 | `tactile-guide` | 60 | 10 | 16.7% |
| 导向柱 | `guidepost` | 60 | 57 | 95.0% |
| 玻璃幕墙 | `curtain-wall` | 60 | 18 | 30.0% |
| 玻璃板 1×1 | `glass-1x1` | 60 | 18 | 30.0% |
| 玻璃板 2×1 | `glass-2x1` | 60 | 18 | 30.0% |
| 玻璃板 3×1 | `glass-3x1` | 60 | 18 | 30.0% |
| 玻璃板 1×2 | `glass-1x2` | 60 | 18 | 30.0% |
| 玻璃板 2×2 | `glass-2x2` | 60 | 18 | 30.0% |
| 玻璃板 3×2 | `glass-3x2` | 60 | 18 | 30.0% |
| 虚拟 | `exit-virtual` | 60 | 46 | 76.7% |
| 道路 | `road` | 50 | 10 | 20.0% |
| 楼梯块 | `stair-block` | 48 | 34 | 70.8% |
| 横版 16:9 | `billboard-wide` | 40 | 6 | 15.0% |
| 标准 2.25:1 | `billboard-standard` | 40 | 6 | 15.0% |
| 大横版 16:9 | `billboard-large` | 40 | 6 | 15.0% |
| 长幅 3.75:1 | `billboard-panorama` | 40 | 6 | 15.0% |
| 竖版 0.7:1 | `billboard-portrait` | 40 | 6 | 15.0% |
| 方形 1:1 | `billboard-square` | 40 | 6 | 15.0% |
| 立式线网图 | `linemap-stand` | 40 | 16 | 40.0% |
| 吊装 | `hanger-roof` | 36 | 6 | 16.7% |
| 立柱 | `hanger-post` | 36 | 14 | 38.9% |
| 细支柱 | `pillar-slim` | 36 | 16 | 44.4% |
| 墙面线网图 | `linemap-wall` | 26 | 4 | 15.4% |
| 地面 单向 | `exit-doorway-1` | 26 | 10 | 38.5% |
| 地面 双向 | `exit-doorway-2` | 26 | 10 | 38.5% |
| 地面 三向 | `exit-doorway-3` | 26 | 10 | 38.5% |
| 地面 四向 | `exit-doorway-4` | 26 | 10 | 38.5% |
| 无桁架 | `roof-shell` | 24 | 8 | 33.3% |
| 栏杆 | `noise-barrier-railing` | 24 | 16 | 66.7% |
| 直条 | `light-rectangular` | 24 | 6 | 25.0% |
| 薄板 | `roof` | 12 | 4 | 33.3% |
| 屏蔽门盖板 | `psd-end-cover` | 12 | 4 | 33.3% |
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

#### Equipment minimum-shape exceptions

Low targets strictly less than 10% of High. The user-approved exceptions below
keep a minimum usable shape, including the two-triangle artwork and floor quads.
Caps and reasons live in `tools/equipment-low-budgets.mjs` and are enforced by the
inventory and regression suite; High geometry is unchanged. Counts describe model
geometry; transparent two-sided materials can submit an additional GPU pass.

| Equipment / decor model name | Low / High | Minimum-shape exception |
|---|---:|---:|
| bin | 26 / 196 | Two open hoppers, outer cabinet faces, dark wells and sorting label. |
| vent | 32 / 168 | Frame, dark duct and three louver strips visible above and below. |
| bench-seat-1 | 20 / 156 | Seat and back surfaces plus two supports. |
| door-wood-1 | 20 / 144 | Four frame members and a two-sided leaf. |
| psd-end | 30 / 114 | Shortened fixed glass, separate housing/trim faces and artwork. |
| tv | 22 / 114 | Two suspension rods, bezel, live station board, video window and status light. |
| noise-barrier | 46 / 108 | Posts and separate opaque/glazed bands, keeping all bay cutouts. |
| noise-barrier-half | 46 / 108 | Posts and separate opaque/glazed bands, keeping all bay cutouts. |
| traffic-light | 28 / 108 | Pole, base, closed housing and three separate lenses. |
| bench-steel-1 | 16 / 84 | Two-sided seat pan plus two supports. |
| sign-ceiling | 18 / 74 | Two suspension rods, backing and readable sign face. |
| monitor-ceiling | 20 / 72 | Two rods, housing, printed camera view and status light. |
| tactile-guide | 10 / 60 | Tile top and four continuous raised guide ribs. |
| guidepost | 57 / 60 | Three independently printed sides, shaped logo collar and triangular column sections. |
| curtain-wall | 18 / 60 | Four frame members and one double-sided glass surface. |
| glass-1x1 | 18 / 60 | Four frame members and one double-sided glass surface. |
| glass-2x1 | 18 / 60 | Four frame members and one double-sided glass surface. |
| glass-3x1 | 18 / 60 | Four frame members and one double-sided glass surface. |
| glass-1x2 | 18 / 60 | Four frame members and one double-sided glass surface. |
| glass-2x2 | 18 / 60 | Four frame members and one double-sided glass surface. |
| glass-3x2 | 18 / 60 | Four frame members and one double-sided glass surface. |
| exit-virtual | 46 / 60 | Three printed sides and shaped metro-logo collar. |
| road | 10 / 50 | Road surface plus four lane/edge markings. |
| pillar-slim | 16 / 36 | Shaft and end collars, preserving height and support footprint. |
| stair-block | 34 / 48 | All four solid treads, exposed risers and closed side silhouette. |
| billboard-wide | 6 / 40 | Original cropped artwork, frame surface and illuminated AD label. |
| billboard-standard | 6 / 40 | Original cropped artwork, frame surface and illuminated AD label. |
| billboard-large | 6 / 40 | Original cropped artwork, frame surface and illuminated AD label. |
| billboard-panorama | 6 / 40 | Original cropped artwork, frame surface and illuminated AD label. |
| billboard-portrait | 6 / 40 | Original cropped artwork, frame surface and illuminated AD label. |
| billboard-square | 6 / 40 | Original cropped artwork, frame surface and illuminated AD label. |
| linemap-stand | 16 / 40 | Base, support and two separately oriented readable map faces. |
| hanger-roof | 6 / 36 | Support bar visible from every direction. |
| hanger-post | 14 / 36 | Bar, upright and base. |
| linemap-wall | 4 / 26 | Frame surface and original cropped map face. |
| exit-doorway-1 | 10 / 26 | Doorway framing and independently readable header faces. |
| exit-doorway-2 | 10 / 26 | Doorway framing and independently readable header faces. |
| exit-doorway-3 | 10 / 26 | Doorway framing and independently readable header faces. |
| exit-doorway-4 | 10 / 26 | Doorway framing and independently readable header faces. |
| roof-shell | 8 / 24 | Two pitched sheets visible from above and below. |
| noise-barrier-railing | 16 / 24 | Open railing silhouette and supports. |
| light-rectangular | 6 / 24 | Steel rim visible above/below and a two-sided luminous diffuser. |
| roof | 4 / 12 | One sheet with both opposing faces. |
| psd-end-cover | 4 / 12 | One sheet with both opposing faces. |
| floor-mark-boarding | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| floor-mark-waiting | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| floor-mark-direction | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| sign-wall | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-kai-h | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-kai-v | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-xing-h | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-xing-v | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-li-h | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-li-v | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-wei-h | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-wei-v | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-hei-h | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-hei-v | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-song-h | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-song-v | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |

The authored Low variants remove shelf stock, cubicle interiors and fine hardware;
keep simplified sink/CCTV/AC silhouettes, track sleepers/rails, ramp bands, lift
doors and stair surfaces. Source picks and rigs stay exact. `model-detail` guards
per-model triangle budgets, batching, restoration, finish colours and disposal.

Tree far/Low uses sparse, enlarged intact crossed leaf cards and a continuous
six-sided trunk; retain canopy extrema and valid leaf UVs when rebaking with
`node tools/bake-street-tree-lod.mjs`. Clock Low retains two readable hour-marked
faces and moving hands, using flat marks/hands and a twelve-sided case.

Every palette model above ten High triangles has a nonempty Low variant with fewer
triangles, guarded by the catalogue sweep in `model-detail` and the inventory
script. The smaller primitive families retain source UVs, colours and artwork:
thin box sheets keep both broad faces, and rods omit their end caps. Round pillar
shafts keep eight sides, narrow support rods use triangular tubes, and circular
lights use a hexagonal rim and two-sided diffuser; guide columns omit buried
bottom caps. Source picking and animated rig identities remain exact.

Furniture/cabinets omit stock and fine fittings; vending drinks become thin colour
panels. Fences use open triangular tubes without clamps/feet fittings and fewer
iron bars. Fare gates retain reader/entry artwork and animated leaves. Exit Low
retains openings, printed headers and the wave profile, with thin roof/glass
surfaces and fewer frame posts. `panelModelDetail` retains two broad faces;
approximation bounds include both full and reduced shapes so combined fittings do
not disappear at the screen edge.

Rail-signal Low keeps three six-sided aspects, diamond rims and coarse hood shells.
Noise barriers retain full posts and all bay/gantry cutouts, using two broad faces
per thin panel/middle rail. Top beams retain thickness with hidden end caps
omitted; the shared bridge builders also prepare these Low variants.

Low uses exposed faces, triangular support tubes, simpler silhouettes and a
bounded print of the original static monitor vectors. Live TV artwork, clock hands,
moving escalator/walkway/lift rigs, exact source picks and material ownership
remain intact. Every real stair tread/riser remains at its original height and
extent. Touching coplanar exit pads merge without filling actual stair wellways;
folded canopy and glass surfaces remain joined. Models with coherent
artwork/surfaces switch together through local and global batches, including
Hide UI and ghost-storey transitions. All three equipment batch paths retain
conservative union bounds for Near and Low, so simplified geometry outside a
source part's bounds remains visible and picked through the original source.

`npm run check:equipment-lod` renders all 120 High and Low options in a real
browser, checks visible pixels, geometry budgets and WebGL/shader errors, and
checks monitor and open-exit counts through real local/global batching. Contact
sheets and raw GPU/model counts are in `.preview/perf/equipment-10pct/`. The table
measures geometry; transparent DoubleSide materials can submit an extra pass. The
browser report records this separately (for example, the narrow open exit has 52
model triangles and 58 GPU triangles). Not every complete GPU submission is below
10%.

### Train models (车辆)

One row per reviewed consist built by `buildTrain`. D-8 is the shipped eight-car
formation and D-6 the six-car formation. Counts are model triangles for one train,
not totals across services. High is the complete consist — both cabs, gangways,
the rideable cabin interior, bogies and the closed door leaves (open/closed poses
submit the same triangles). Low is what the same consist draws after its prepared
swaps: a part with an authored §9.3 approximation swaps geometry, a part outside
that set (a 12-triangle slab, a fixed 5 m surface) keeps its full geometry. Counts
are drawn totals through the renderer's own path — static batching, door banks and
sorted glass batches — not a sum of unmerged parts. Uniform 0.98 scaling does not
change topology.

Third-rail counts exclude pantographs:

| Train model | Low triangles | High triangles |
|---|---:|---:|
| D-8 | 78,144 | 1,303,424 |
| D-6 | 61,196 | 1,008,052 |
| A-8 | 71,016 | 730,512 |
| A-6 | 54,612 | 574,244 |
| C-6 | 50,516 | 534,888 |
| B-6 | 48,480 | 513,888 |
| L-6 | 44,272 | 464,576 |
| C-4 | 35,616 | 395,652 |
| B-4 | 34,028 | 378,236 |
| L-4 | 31,132 | 344,492 |

Overhead-wire counts include collectors and their roof mounts:

| Train model | Low triangles | High triangles |
|---|---:|---:|
| D-8 | 131,544 | 1,316,536 |
| D-6 | 106,468 | 1,021,164 |
| A-8 | 168,384 | 744,200 |
| A-6 | 127,796 | 587,932 |
| C-6 | 114,364 | 548,576 |
| B-6 | 111,032 | 527,576 |
| L-6 | 97,776 | 478,264 |
| C-4 | 78,296 | 409,340 |
| B-4 | 75,988 | 391,924 |
| L-4 | 66,916 | 358,180 |

The shared `TrainBogie.ts` wheelsets, sculpted frames, suspension and brakes are
included in these counts; Low keeps profiled eight-sided tyre treads and flanges,
six-sided wheel webs, and omits coils, bolts, pipes, dampers and fine
brake/bearing fittings.

D's layout: each side has four doorways and three bays of two small windows, with
painted end bays. Middle cars have four double doors; cab cars have three double
doors and one single door nearest the cab, mirrored at opposite ends.
`DTrainShell.ts` owns the curved shell and panes; `stock.ts` shares door centres
and widths with the platform screens. `stock`, `draw-batching` and `train-lod` pin
the cadence, apertures, moving doors and geometry totals.

L's three-door car keeps its shell and platform cadence, with one broad cab
windscreen, small framed end windows and paired wide inter-door windows. The window
builder keeps the real glazing apertures and uses one-segment corner curves for Low
geometry.

B keeps the shared shell and four-door cadence, with a single broad windshield at
each cab and three inset, rounded, rubber-framed side windows between the doors.
End bays remain painted. Low detail keeps the cut-out glazing and rubber frame
while reducing the corner segments.

Every selectable stock, one through eight cars, with either third rail or catenary,
draws at most 10% of its own High triangles. `train-lod` checks all 80 combinations,
moving door banks and exact High restoration through the real TrainSystem path. The
interior carries most of the reduction for A/B/C/L: straps become hollow, two-sided
triangular loops; handrails use open three-sided tubes over two path segments; ring
lights use eight ring segments and three tube sides. Door and window frames retain
real apertures and both broad faces while omitting thin edge walls. Door leaves
follow the Low shell profile. D keeps its authored lofted shell, plug doors and
bellows; clipped cab trim also carries explicit 12×3 Low surfaces.

High quality draws the active storey at High and ghosted storeys at Low; Low quality
uses Low throughout. Hide UI restores High. Train detail follows quality/storey,
not projected size. Prepared swaps retain source picking geometry, door motion and
allocations. Identical consists keep separate poses; up to eight dormant
configurations are retained for reuse.

Train parts are authored in their builders (`render/modelDetail.ts`);
`batchStaticParts` merges both variants so a batch carries its own Low geometry, and
the door banks and sorted-glass batches reserve theirs when they are built. A part
with no authored variant may fall back to the bounded-error simplifier only inside
`TRAIN_DETAIL_MAX_RADIUS` — a merged car spans a whole consist, and 2% of that is
metres. Preparing both variants costs roughly 10% (D) to 30% (B/C) more on a
consist's first build, once per cached configuration.

`tools/check-transport-lod.mjs` captures both details, both power systems,
front/side elevations and three door poses; reports and images live in
`.preview/perf/transport-10pct/train-captures/`. Production captures cover 50
High/Low pairs; the 20 elevation comparisons pass with minimum High-mask coverage
98.31% and minimum intersection-over-union 98.29%, and the other 30 pairs record
the three door poses for visual review. The shipped 动物园 Line 5 runs **L-6**. The
shipped overhead-wire counts are in
`.preview/perf/train-5m-audit/train-catenary-triangles.json`.

### Passenger models (乘客)

One row per reviewed appearance in the baked crowd atlas
(`game/src/assets/passenger-approved.json`, prepared instanced draws with no
per-agent GLB or skeleton). High is each variant's full topology; Low is a second
index table over the same animated vertex pool. Every appearance has a hard budget
of `floor(highTriangles * 0.10)`; the shared padded draw also stays below 10% of
High. The current shared stride is **9,370 High / 841 Low triangles (9.0%)**.

`tools/passenger-low-topology.mjs` builds separate faceted envelopes for each
anatomical part and palette region, keeping heads, arms, legs, shoes, skirts and
bags separate. Closed envelopes avoid the missing legs produced by unconstrained
grid clustering. Envelope simplification does not prune components; original
source faces retain extrema from every one of the 73 pose frames. Every output
corner references an existing animated vertex from that appearance, and every
triangle keeps one original flat palette region. Skirts retain their original
cloth topology with motion-aware reduction instead of a standing envelope. Other
parts use convex envelopes that remove concavities and small detail. Full geometry,
pose frames, normals, regions, source hashes and eligibility metadata are unchanged.

Each packed instance records its storey in `passengerLevel`. 高画质 draws the
edited storey full and ghosted storeys reduced; 低画质 draws the whole crowd reduced;
隐藏UI restores full bodies. One-storey crowds use one draw; ghosted crowds can add
a second. High bodies use 70% opacity and Low bodies 45%. The pose, normal and
region textures remain shared, so the triangle reduction does not reduce their
memory. Switching quality retains the prepared GPU allocations.

| Passenger model | Low triangles | High triangles |
|---|---:|---:|
| male-original-bag | 820 | 9,370 |
| male-short-bag | 811 | 9,314 |
| male-bald-bag | 801 | 9,296 |
| male-short-small-bag | 831 | 8,872 |
| male-short-standard-87.5-bag | 841 | 8,867 |
| male-bald-small-bag | 827 | 8,854 |
| male-bald-standard-87.5-bag | 835 | 8,849 |
| male-short-standard-75-bag | 825 | 8,832 |
| male-bald-standard-75-bag | 821 | 8,814 |
| male-side-part-bag | 776 | 8,772 |
| male-quiff-bag | 776 | 8,772 |
| male-swept-bag | 776 | 8,752 |
| male-crop-bag | 765 | 8,673 |
| female-rounded-bob-bag | 760 | 8,636 |
| female-lob-bag | 758 | 8,594 |
| female-bob-bag | 758 | 8,584 |
| female-angled-bob-bag | 758 | 8,582 |
| female-side-part-bob-bag | 758 | 8,580 |
| female-shoulder-bag | 754 | 8,579 |
| female-shoulder-swept-bag | 754 | 8,579 |
| female-cropped-bob-bag | 758 | 8,578 |
| male-crew-bag | 752 | 8,569 |
| male-buzz-bag | 752 | 8,526 |
| male-rounded-bag | 752 | 8,524 |
| male-original-small-bag | 791 | 8,425 |
| male-original-standard-87.5-bag | 798 | 8,409 |
| male-original-standard-75-bag | 788 | 8,389 |
| male-side-part-small-bag | 787 | 8,363 |
| male-quiff-small-bag | 787 | 8,363 |
| male-side-part-standard-87.5-bag | 794 | 8,347 |
| male-quiff-standard-87.5-bag | 792 | 8,347 |
| male-swept-small-bag | 787 | 8,343 |
| male-swept-standard-87.5-bag | 790 | 8,327 |
| male-side-part-standard-75-bag | 782 | 8,327 |
| male-quiff-standard-75-bag | 784 | 8,327 |
| male-swept-standard-75-bag | 782 | 8,307 |
| female-rounded-bob-small-bag | 785 | 8,269 |
| male-crop-small-bag | 782 | 8,264 |
| male-crop-standard-87.5-bag | 787 | 8,248 |
| female-rounded-bob-standard-87.5-bag | 784 | 8,241 |
| female-rounded-bob-standard-75-bag | 779 | 8,235 |
| male-crop-standard-75-bag | 775 | 8,228 |
| female-lob-small-bag | 781 | 8,227 |
| female-bob-small-bag | 779 | 8,217 |
| female-angled-bob-small-bag | 779 | 8,215 |
| female-side-part-bob-small-bag | 779 | 8,213 |
| female-shoulder-small-bag | 779 | 8,212 |
| female-shoulder-swept-small-bag | 779 | 8,212 |
| female-cropped-bob-small-bag | 779 | 8,211 |
| female-lob-standard-87.5-bag | 780 | 8,199 |
| female-lob-standard-75-bag | 777 | 8,193 |
| female-bob-standard-87.5-bag | 780 | 8,189 |
| female-angled-bob-standard-87.5-bag | 780 | 8,187 |
| female-side-part-bob-standard-87.5-bag | 780 | 8,185 |
| female-shoulder-standard-87.5-bag | 780 | 8,184 |
| female-shoulder-swept-standard-87.5-bag | 780 | 8,184 |
| female-cropped-bob-standard-87.5-bag | 780 | 8,183 |
| female-bob-standard-75-bag | 777 | 8,183 |
| female-angled-bob-standard-75-bag | 777 | 8,181 |
| female-side-part-bob-standard-75-bag | 777 | 8,179 |
| female-shoulder-standard-75-bag | 777 | 8,178 |
| female-shoulder-swept-standard-75-bag | 779 | 8,178 |
| female-cropped-bob-standard-75-bag | 777 | 8,177 |
| male-crew-small-bag | 763 | 8,160 |
| male-crew-standard-87.5-bag | 772 | 8,144 |
| male-crew-standard-75-bag | 764 | 8,124 |
| male-buzz-small-bag | 761 | 8,117 |
| male-rounded-small-bag | 759 | 8,115 |
| male-buzz-standard-87.5-bag | 766 | 8,101 |
| male-rounded-standard-87.5-bag | 764 | 8,099 |
| male-buzz-standard-75-bag | 760 | 8,081 |
| male-rounded-standard-75-bag | 760 | 8,079 |
| female-midi-pleated-swapped-no-bag | 569 | 5,832 |
| female-long-a-line-swapped-no-bag | 565 | 5,806 |
| female-long-pleated-swapped-no-bag | 570 | 5,805 |
| female-midi-pleated-no-bag | 571 | 5,802 |
| female-midi-a-line-swapped-no-bag | 551 | 5,785 |
| female-long-a-line-no-bag | 563 | 5,775 |
| female-long-pleated-no-bag | 565 | 5,775 |
| female-midi-a-line-no-bag | 563 | 5,773 |
| female-full-pleated-swapped-no-bag | 564 | 5,771 |
| female-full-pleated-no-bag | 562 | 5,770 |
| female-slim-long-skirt-no-bag | 561 | 5,749 |
| female-slim-long-skirt-swapped-no-bag | 558 | 5,718 |
| male-short-crossbody-right-bag | 481 | 5,071 |
| male-short-crossbody-left-bag | 474 | 5,070 |
| male-bald-crossbody-right-bag | 479 | 5,053 |
| male-bald-crossbody-left-bag | 474 | 5,052 |
| male-short-shoulder-right-bag | 452 | 4,764 |
| male-short-shoulder-left-bag | 451 | 4,762 |
| male-bald-shoulder-right-bag | 450 | 4,746 |
| male-bald-shoulder-left-bag | 451 | 4,744 |
| male-short-no-bag | 450 | 4,705 |
| male-bald-no-bag | 440 | 4,687 |
| male-original-crossbody-right-bag | 451 | 4,650 |
| male-original-crossbody-left-bag | 446 | 4,649 |
| female-long-swept-crossbody-right-bag | 446 | 4,612 |
| female-long-swept-crossbody-left-bag | 446 | 4,611 |
| female-long-crossbody-right-bag | 446 | 4,605 |
| female-long-crossbody-left-bag | 444 | 4,604 |
| male-side-part-crossbody-right-bag | 447 | 4,588 |
| male-quiff-crossbody-right-bag | 447 | 4,588 |
| male-side-part-crossbody-left-bag | 440 | 4,587 |
| male-quiff-crossbody-left-bag | 440 | 4,587 |
| male-swept-crossbody-right-bag | 443 | 4,568 |
| male-swept-crossbody-left-bag | 438 | 4,567 |
| male-crop-crossbody-right-bag | 438 | 4,489 |
| male-crop-crossbody-left-bag | 435 | 4,488 |
| female-rounded-bob-crossbody-right-bag | 432 | 4,482 |
| female-rounded-bob-crossbody-left-bag | 432 | 4,481 |
| female-lob-crossbody-right-bag | 429 | 4,440 |
| female-lob-crossbody-left-bag | 421 | 4,439 |
| female-bob-crossbody-right-bag | 428 | 4,430 |
| female-bob-crossbody-left-bag | 420 | 4,429 |
| female-angled-bob-crossbody-right-bag | 428 | 4,428 |
| female-angled-bob-crossbody-left-bag | 420 | 4,427 |
| female-side-part-bob-crossbody-right-bag | 428 | 4,426 |
| female-side-part-bob-crossbody-left-bag | 420 | 4,425 |
| female-shoulder-crossbody-right-bag | 425 | 4,425 |
| female-shoulder-swept-crossbody-right-bag | 425 | 4,425 |
| female-shoulder-crossbody-left-bag | 421 | 4,424 |
| female-shoulder-swept-crossbody-left-bag | 421 | 4,424 |
| female-cropped-bob-crossbody-right-bag | 428 | 4,424 |
| female-cropped-bob-crossbody-left-bag | 420 | 4,423 |
| male-crew-crossbody-right-bag | 427 | 4,385 |
| male-crew-crossbody-left-bag | 424 | 4,384 |
| male-buzz-crossbody-right-bag | 419 | 4,342 |
| male-original-shoulder-right-bag | 423 | 4,341 |
| male-buzz-crossbody-left-bag | 418 | 4,341 |
| male-rounded-crossbody-right-bag | 419 | 4,340 |
| female-long-swept-purse-left-bag | 415 | 4,340 |
| female-long-swept-purse-right-bag | 414 | 4,340 |
| male-original-shoulder-left-bag | 419 | 4,339 |
| male-rounded-crossbody-left-bag | 418 | 4,339 |
| female-long-purse-left-bag | 415 | 4,333 |
| female-long-purse-right-bag | 414 | 4,333 |
| female-long-swept-shoulder-right-bag | 414 | 4,318 |
| female-long-swept-shoulder-left-bag | 416 | 4,316 |
| female-long-shoulder-right-bag | 414 | 4,311 |
| female-long-shoulder-left-bag | 416 | 4,309 |
| male-short-straight-no-bag | 411 | 4,294 |
| male-short-straight-swapped-no-bag | 404 | 4,292 |
| male-crew-straight-no-bag | 411 | 4,285 |
| male-relaxed-straight-swapped-no-bag | 413 | 4,281 |
| male-side-part-shoulder-right-bag | 415 | 4,279 |
| male-quiff-shoulder-right-bag | 417 | 4,279 |
| male-side-part-shoulder-left-bag | 411 | 4,277 |
| male-quiff-shoulder-left-bag | 413 | 4,277 |
| male-relaxed-straight-no-bag | 410 | 4,277 |
| male-fitted-straight-no-bag | 410 | 4,268 |
| male-original-no-bag | 409 | 4,262 |
| male-crew-straight-swapped-no-bag | 408 | 4,262 |
| male-swept-shoulder-right-bag | 415 | 4,259 |
| male-swept-shoulder-left-bag | 413 | 4,257 |
| female-long-swept-no-bag | 410 | 4,231 |
| female-long-no-bag | 408 | 4,224 |
| male-fitted-straight-swapped-no-bag | 404 | 4,224 |
| male-short-wide-no-bag | 407 | 4,217 |
| male-relaxed-wide-swapped-no-bag | 405 | 4,215 |
| female-rounded-bob-purse-left-bag | 407 | 4,210 |
| female-rounded-bob-purse-right-bag | 410 | 4,210 |
| male-relaxed-wide-no-bag | 405 | 4,209 |
| male-long-relaxed-no-bag | 410 | 4,205 |
| male-side-part-no-bag | 403 | 4,200 |
| male-quiff-no-bag | 403 | 4,200 |
| female-rounded-bob-shoulder-right-bag | 404 | 4,188 |
| female-rounded-bob-shoulder-left-bag | 404 | 4,186 |
| male-swept-no-bag | 401 | 4,180 |
| male-crop-shoulder-right-bag | 408 | 4,180 |
| male-short-wide-swapped-no-bag | 400 | 4,179 |
| male-crop-shoulder-left-bag | 406 | 4,178 |
| female-lob-purse-left-bag | 395 | 4,168 |
| female-lob-purse-right-bag | 398 | 4,168 |
| female-bob-purse-left-bag | 395 | 4,158 |
| female-bob-purse-right-bag | 396 | 4,158 |
| female-angled-bob-purse-left-bag | 393 | 4,156 |
| female-angled-bob-purse-right-bag | 396 | 4,156 |
| female-side-part-bob-purse-left-bag | 395 | 4,154 |
| female-side-part-bob-purse-right-bag | 396 | 4,154 |
| female-shoulder-purse-left-bag | 399 | 4,153 |
| female-shoulder-swept-purse-left-bag | 401 | 4,153 |
| female-shoulder-purse-right-bag | 400 | 4,153 |
| female-shoulder-swept-purse-right-bag | 402 | 4,153 |
| female-cropped-bob-purse-left-bag | 395 | 4,152 |
| female-cropped-bob-purse-right-bag | 396 | 4,152 |
| male-crew-tapered-swapped-no-bag | 399 | 4,152 |
| female-lob-shoulder-right-bag | 402 | 4,146 |
| female-lob-shoulder-left-bag | 400 | 4,144 |
| male-crew-tapered-no-bag | 402 | 4,144 |
| male-long-relaxed-swapped-no-bag | 403 | 4,144 |
| female-bob-shoulder-right-bag | 400 | 4,136 |
| female-bob-shoulder-left-bag | 398 | 4,134 |
| female-angled-bob-shoulder-right-bag | 400 | 4,134 |
| female-angled-bob-shoulder-left-bag | 398 | 4,132 |
| female-side-part-bob-shoulder-right-bag | 400 | 4,132 |
| male-fitted-tapered-no-bag | 393 | 4,132 |
| female-shoulder-shoulder-right-bag | 402 | 4,131 |
| female-shoulder-swept-shoulder-right-bag | 406 | 4,131 |
| female-side-part-bob-shoulder-left-bag | 398 | 4,130 |
| female-cropped-bob-shoulder-right-bag | 400 | 4,130 |
| female-shoulder-shoulder-left-bag | 404 | 4,129 |
| female-shoulder-swept-shoulder-left-bag | 404 | 4,129 |
| female-cropped-bob-shoulder-left-bag | 398 | 4,128 |
| male-fitted-tapered-swapped-no-bag | 389 | 4,128 |
| male-long-tapered-no-bag | 405 | 4,105 |
| male-crop-no-bag | 389 | 4,101 |
| female-rounded-bob-no-bag | 398 | 4,101 |
| male-long-tapered-swapped-no-bag | 402 | 4,089 |
| male-crew-shoulder-right-bag | 393 | 4,076 |
| male-crew-shoulder-left-bag | 395 | 4,074 |
| female-lob-no-bag | 392 | 4,059 |
| female-bob-no-bag | 390 | 4,049 |
| female-angled-bob-no-bag | 392 | 4,047 |
| female-side-part-bob-no-bag | 390 | 4,045 |
| female-shoulder-no-bag | 394 | 4,044 |
| female-shoulder-swept-no-bag | 394 | 4,044 |
| female-cropped-bob-no-bag | 390 | 4,043 |
| female-straight-trousers-no-bag | 390 | 4,040 |
| female-straight-trousers-swapped-no-bag | 393 | 4,034 |
| male-buzz-shoulder-right-bag | 389 | 4,033 |
| male-buzz-shoulder-left-bag | 389 | 4,031 |
| male-rounded-shoulder-right-bag | 389 | 4,031 |
| male-rounded-shoulder-left-bag | 389 | 4,029 |
| male-crew-no-bag | 383 | 3,997 |
| female-wide-trousers-swapped-no-bag | 384 | 3,976 |
| female-wide-trousers-no-bag | 382 | 3,960 |
| male-buzz-no-bag | 379 | 3,954 |
| male-rounded-no-bag | 377 | 3,952 |
| female-relaxed-trousers-no-bag | 377 | 3,921 |
| female-relaxed-trousers-swapped-no-bag | 376 | 3,900 |
| female-tapered-trousers-swapped-no-bag | 376 | 3,830 |
| female-tapered-trousers-no-bag | 371 | 3,821 |

Across all 232 variants, the atlas references **1,308,230 High / 123,928 Low**
triangles over the unchanged pool of **226,731 animated vertices**, 73 frames and
21 palette stops. Real Low rows range from **371 to 841 triangles**. The padded
Low row is `lowCorners` **2,523 corners**, versus 28,110 High corners.

Production GPU validation compares **11,736 paired High/Low renders**: every
eligible adult/child appearance, all three gait profiles, standing and three
walking samples per profile, in isometric/elevation/plan views. Every comparison
passes the fixed gates (80% High-mask coverage, 70% intersection-over-union).
Worst overlap is **78.59%**, and minimum High-mask coverage **86.15%**. The 864
skirt-only comparisons reach minimum overlap 92.49% and coverage 95.63%. These
samples do not claim exhaustive visual coverage of all interpolated poses, camera
angles or age-size extremes.

`passenger-lod` pins both 10% budgets, per-appearance vertex membership, flat
palette boundaries, all-frame extrema, quality/storey routing and shared disposal.
`node tools/check-passenger-lod.mjs` performs paired production GPU captures for
both eligible ages, all variants, all three gaits and three camera views; review
its worst silhouette pairs in ignored `.preview/perf/passenger-10pct/`.
`node tools/model-triangle-inventory.mjs` regenerates the table. A full
`npm run bake:passengers` regenerates reviewed exports and the complete atlas;
for Low-policy-only changes, `node tools/bake-approved-passenger.mjs --low-only`
first verifies every export hash and then regenerates only Low topology fields.

### Five-metre clearance and other geometry

| Datum | Height above track anchor |
|---|---:|
| Concrete underside | −1 m |
| Train/platform floor | +1 m |
| Scaled train origin | +0.3924 m |
| Collector carbon / wire underside | +3.891 m |
| Wire centre | +3.903 m |
| Covered ceiling underside | +4 m |

Covered track has a 5 m bottom-to-ceiling envelope. Open bridges/gantries use their
own taller clearance. Full PSDs stand 3 m above the platform: 2.35 m of glass, a
0.6 m information plate and a 0.05 m cap.

Passenger atlas draw strides are 9,370 High / 841 Low triangles per instance;
individual variants can be smaller. Both LODs share animation data. Rendered
passenger dimensions use the train's 0.98 uniform scale, including shadows,
picking, stride phase and eye height; simulation physique/speed and the atlas
topology are unchanged. A single-storey crowd uses one draw; a visible ghosted
storey can add a second. Passenger and road-vehicle opacity is 70% at High and 45%
at Low.

Current inventory sizes:

| Inventory | Current report |
|---|---|
| Equipment/decor | `.preview/perf/model-triangles.json` |
| Trains, third rail | `.preview/perf/train-triangles.json` |
| Trains, overhead wire | `.preview/perf/train-5m-audit/train-catenary-triangles.json` |
| Passenger variants | `.preview/perf/passenger-triangles.json` |
| Road vehicles, including colour + depth pass | `.preview/road-vehicles/report.json` |

## Current measurements

These are production-browser samples on the stated fixtures. Each table's first
value is the first invocation and the second is a warmed repetition unless noted;
milliseconds, CPU readiness through two animation frames where stated. Browser
timing is evidence, not a pass threshold. Re-measure after changing the path.

### Fence drag preview

`node tools/bench-fence-drag.mjs` drives production hover, press, a 220 ms long
press, three drag movements, Escape/cancel and a repeated drag followed by release.
The deterministic fixture has 256 glass fences (128 on each of z=0 and z=-5), 128
floor cells, seed 12345, no crowd or lines, paused, High graphics, ground storey
active and Show other levels off. Chrome 155 on Windows, 28 logical CPUs,
RTX 4080 SUPER through ANGLE/D3D11; viewport 1424 × 905, top orthographic view.
Both runs use the same fixture and event sequence, with builds and tests idle.

| Phase | Preview CPU | Event through two RAFs |
|---|---:|---:|
| First press | 1.1 ms | 84.2 ms |
| First drag movement | 1.4 ms | 38.9 ms |
| Continued movement | 0.9–1.6 ms | 47.6–50.2 ms |
| Cancel | 0.3 ms | 32.0 ms |
| Repeated press | 0.5 ms | 34.4 ms |
| Release/commit | 0.5 ms | 51.3 ms |

The one-panel preview builds two groups (candidate plus its one adjacent joint); a
four-panel run builds five. Pointer press, movement and cancel perform zero
equipment batch synchronizations. The immutable fence/gate/landing index is
prepared while building the station, and candidate connections overlay that index
without copying or scanning the station document. Only neighbouring bucket draws
are masked; original GPU allocations and all remote geometry remain in place.
All 128 hidden lower-storey source roots stay hidden through cancel, cancel commits
nothing, and release adds exactly four panels in one commit. Release still performs
the normal functional station/routing edit.

Run with `METRO_BROWSER_GPU=hardware`, choose distinct `BENCH_OUTPUT` paths, and
set `BENCH_EXPECT_LOCAL=1` to check the local-work and visibility contracts.
`BENCH_STATION` accepts a user save with a ground fence and five free cells to its
east; `BENCH_PROFILE=1` writes a separate CPU profile.

### Equipment placement and hover indexes

`tools/bench-tree-placement.mjs` with
`BENCH_EQUIPMENT_FIXTURE=1 SKIP_LAWN=1 COUNT=1 PIECE=bench` (or `PIECE=tvm`),
seed 12345, 128 pre-existing ground fences, no stored floor cells, no crowd/lines,
paused, one real hover/press/release per piece. The target lies inside the existing
street window. Chrome/GPU/viewport as above.

| Placement measurement | Current |
|---|---:|
| First hover, event through two RAFs | 208 ms |
| First press, event through two RAFs | 199 ms |
| First release, event through two RAFs | 45 ms |
| First press `setStation` CPU | 5.4 ms |
| Repeated press `setStation` CPU | 4.7 ms |
| Repeated press, event through two RAFs | 156 ms |

Both presses retain all prior equipment roots and build exactly one added model;
the run records zero chunk preparation/remesh or station-wide plate repaint calls.
It ends at 115 draws / 85,536 triangles with two commits and no captured runtime
errors. Commit-to-worker-frame latency is 145.6 / 149.9 ms, including the
intentional 100 ms coalescing window. Cold hover and software-GPU frame latency
remain significant; the repeated end-to-end press is not a blanket responsiveness
or FPS claim. `PIECE=psd-end` also commits twice through production input with no
chunk remesh, retaining the 128/129 prior models; `setStation` CPU is 5.5 / 4.0 ms.
Raw reports are under `.preview/perf/` (`placement-audit-*.json` and adjacent
profiles). `equipment-retention.test.mjs` guards 1,024 unrelated models, functional
routing, chunk classification, structural/coupled invalidation, geometry matching a
fresh build, live materials, cached move removal and ordinary hovers without
document scans.

### Curtain-wall carried preview

`node tools/bench-curtain-preview.mjs` uses the shipped Tanwei station, 9,572
modules, paused simulation and hardware ANGLE/D3D11 on an RTX 4080 SUPER. Twelve
real mouse movements include the first invocation; runs use the same camera and 22
pick-verified targets.

| Event through two RAFs | Current |
|---|---:|
| First hover | 263.8 ms |
| Median of eleven subsequent movements | 83.1 ms |
| Subsequent range | 58.9–134.2 ms |

Preview model submission is about 1–3 ms. The run commits no document and calls no
`setStation`. Glass/fence pairs bypass the nominal-envelope rejection because a
joint can grow perpendicular fence arms; the full possible fence-arm tile is
rejected first, then four local neighbour lookups use the immutable fence
connection index, and the exact thin arm boxes still decide collision. Cold hover
remains noticeable and general rendering throughput is not optimized. Two RAFs
include frame scheduling, rendering and CDP overhead.

`glass-panel` guards cold/repeated verdicts with 2,048 remote fences, bounded
station iterations, exact turning-arm collision, curtain crossing permission and
immutable neighbour-removal invalidation; it is included in `test:perf`.

### Suspended-ceiling drag

The 吊顶 tool validates hover, drag and release against the original station,
exactly as ordinary blocks do. It prepares no copied module document and relocates
no fixture anchors. `addSuspendedCeiling` retains the original modules array and
only adds tagged/finished cells.

Production `bench-drag-latency.mjs`, Zoo demo (14,073 cells / 4,291 modules), block
tool, suspended-ceiling mode, 10 × 10 drag, paused plan view, identical targets and
assets:

| Measurement | Current first / repeated |
|---|---:|
| Hover event through two RAFs | 255.3 / 55.1 ms |
| Drag preview callback CPU | 8.0 / 1.4 ms |
| Drag movement through two RAFs | 192.4 / 210.6 ms |

Both runs recorded zero preview commits and zero browser errors. The harness
includes a 160 ms settle in drag samples. Cold hover still includes renderer
initialization and frame latency.

### Shared tool picking

Pointer tools share one event-scoped ray and lazy scene intersection snapshot.
Block, module, normal, bounds and roof queries reuse visible hits and misses;
overlapping lift roots are traversed once. Plane-only queries do not traverse
geometry. Each interpolated deletion sample keeps its own cached position. Queued
movement is flushed before the release scope opens.

`node tools/check-tool-picking.mjs` runs a ceiling sign placement at (3,1,3) and
move to (4,1,3) below the platform underside at 4 m, stair and escalator deletion
with undo/redo, and first/warm hovers of all eleven tools on Tanwei. Across 38
dispatches the maximum is one scene raycast per dispatch, with no browser errors.
Current event CPU: platform first hover/press 19.6/2.1 ms; carried-sign first
hover/press 3.0/1.3 ms; first block hover beside stair/escalator 1.2/0.6 ms. These
overlapped verification jobs; they are not isolated frame-present measurements.

Deterministic regressions cover event sharing, cached misses, nested scopes,
visibility refresh, layer restoration, duplicate lift roots and shared ceiling
aiming. Ramp regressions cover 92 combinations of stair shape, width and rotation
and escalator width/rotation using real rendered mesh intersections, deletion,
selection, picking and undo.

### Placement 100 ms budget

`npm run bench:placement` builds the game and runs
`tools/bench-placement-latency.mjs` against both demos with hardware rendering by
default. It records browser-clock pointer handler duration, first renderer
submission completion, event-through-two-RAF, nested subsystem times, retained
models, scene raycasts and the next paused worker metrics frame. Result lookup and
fixture discovery stay outside event timings. The initial five physical targets per
demo are pinned in the script; a changed target sequence fails. Every click must
add exactly one bench and each event must use at most one scene raycast.
`BENCH_EDITS` selects 1–20 placements; the first five remain pinned.

Controlled captures: Chrome 155 / ANGLE D3D11, RTX 4080 SUPER, High quality,
1440 × 1000 window, 892 × 815 scene canvas, paused population 0, seed 7654321.
Zoo: 14,073 cells / 4,291 modules. Tanwei: 16,437 cells / 9,694 modules. The
authored editing storeys are −20 m / −10 m; the pinned targets hit visible virtual
ground at 0 m.

| Browser event measurement (ms) | Zoo | Tanwei |
|---|---:|---:|
| First click → renderer submission complete | 669 | 335 |
| First click → two RAF | 706 | 382 |
| Repeated click → renderer submission, range | 115–529 | 257–1,079 |
| Repeated click → two RAF, range | 133–555 | 261–1,130 |
| Worst click → two RAF, five samples | 706 | 1,130 |
| Placements exceeding 100 ms, either proxy | 5 / 5 | 5 / 5 |

These are individual samples, not a p95 estimate. Renderer submission and two RAFs
are response proxies, not GPU fences or compositor presentation timestamps.
Subsystem timers overlap and must not be summed. All ten placements succeeded;
browser errors and GL error are zero, and each event uses one raycast.

Use **100 ms from pointer-down to visible placement feedback, including the first
click**, as the response budget. A proposed allocation is 20 ms for
validation/document commit, 20 ms for the changed model, 15 ms for local batch
updates, 30 ms for rendering and 15 ms reserve. These are engineering targets, not
achieved figures. Track worker installation separately: the observed next
metrics-frame delays are 270–1,079 ms, and routing already has a coalesced 100 ms
scheduling window. Fast feedback must preserve the coherent applied
document/routing pair and the tool's placement/refusal contract.

The measured cost centres, in profile order:

1. **Retaining the parent of retained module roots.** Re-adding a retained group to
   `moduleMeshes` makes Three remove it from that same parent first, searching and
   splicing the same large children array. The Tanwei CPU profile attributed 220 ms
   to `Object3D.remove` across three placements. A disposable-browser
   `--retain-parent` ablation skips the redundant additions: all original 9,694
   roots survive and the new bench is added, while model-update CPU falls to
   31–39 ms in the paired captures. Interior click-to-render still takes 200–252 ms,
   so this alone does not meet the budget. Keep the parent guard pinned by
   `equipment-retention`.
2. **Patching affected spatial batches and module registrations.** Even when all
   original models survive and document cells are the same array, a click can walk
   or re-register the whole station and invalidate equipment views twice, in
   `SceneRenderer.setStation` and `ModuleSystem.buildModules`. Interior Tanwei
   samples spent 84–109 ms in module updates and 56–66 ms in batch sync. Keep
   unaffected roots, rigs, buckets and buffers in place; update the new piece's
   local bucket and retain other view data. The 16 m bucket layout is the useful
   unit. `batching-lifecycle` pins reuse of retained source discovery and
   invalidation on transform/view changes.
3. **Updating ground edges without remeshing the whole station.** A bench placed on
   already visible virtual ground can extend the content bounds and move the
   generated ground window. Zoo's first target shifts x0 from −14 to −27; Tanwei's
   fourth shifts y1 from 100 to 112. That changes no authored cell but can take the
   full preparation/meshing path. Tanwei's edge click spent 236 ms in chunk meshing
   and 357 ms in batch sync, reaching 1,079 ms to renderer submission. Preserve
   authored chunks and rebuild only the affected boundary ground chunks, while
   keeping the ground/routing contract; `floor-geometry` compares the local ground
   pass with fresh meshing on expansion and shrink.
4. **Retaining uploaded rendering resources and warming cold programs.** The Zoo
   profile captured 145 ms in `getProgramInfoLog` during the three-click run, and
   repeated scene traversal/matrix updates remain significant. Avoid turning local
   placement into fresh station geometry/material/program work. Raycasting is
   already one traversal per event and is not the principal cost.

These paths carry deterministic regressions (`equipment-retention`,
`batching-lifecycle`, `floor-geometry`). Re-run `npm run bench:placement` after
changing them; the measured budget above is the acceptance target, not a claim
about the latest edit.

#### Follow-up placement audit (2026-10-22)

The optimized implementation was measured again with five pinned visible-ground
targets per demo in Chrome 155 / RTX 4080 SUPER through ANGLE/D3D11, High quality,
892 × 815 scene canvas. The run checked pointer-handler and renderer-submission
latency, two-RAF latency, subsystem work, retained model roots, worker frame delay,
raycasts and authored cells. Each click added exactly one bench, used at most one
scene raycast, preserved authored cells and reported zero browser/GL errors.

| Demo | First submission, before → after | Median, before → after | Worst, before → after |
|---|---:|---:|---:|
| Zoo | 683 → 134 ms | 505 → 134 ms | 683 → 176 ms |
| Tanwei | 366 → 118 ms | 276 → 110 ms | 1,075 → 241 ms |

The optimized submission samples were Zoo **134, 62, 132, 176, 156 ms** and
Tanwei **118, 110, 107, 241, 100 ms**. Corresponding two-RAF samples were Zoo
159/81/163/201/178 ms and Tanwei 157/149/142/283/133 ms. Worst submission
latency fell 74% on Zoo and 78% on Tanwei, but the 100 ms target remains unmet:
street-window boundary edits are still the main outliers. The worst Tanwei click
spent 72 ms meshing ground, 132 ms in `setStation`, and 191 ms in the pointer
handler before rendering; these nested measurements overlap and must not be
added together. Zoo boundary meshing cost 32–61 ms. Remaining profile costs
include generated-ground boundary meshing and whole-scene rendering/matrix work.

The completed usage tour also measured two-RAF times of 1,164 ms for enabling
cutaway on Zoo, 1,378 ms on Tanwei, 718 ms for Tanwei's first line-colour change,
649 ms for Zoo's first exit-open change, and 396 ms for Tanwei's time-panel/date
action. These are tour timings, not matched before/after comparisons. Play/pause
includes simulation startup and an intentional wait.

Captures are under `.preview/perf/placement-100ms/`: `baseline-equivalent.json`,
`optimized-final.json`, `comparison.json` and
`profile-remaining-tanwei.cpuprofile`. Earlier `after-local-v6.json`, the
original `baseline-matched.json`, and their overlapping validation runs are
diagnostic only. The matched baseline was built from Git HEAD `b0ab3b3` with the
same independent hidden-ceiling face correction. `--profile` captures remain
separate from clean timing runs. Target discovery uses untimed raycasts before
the first sample, so “first” means first placement after load, not first scene
pick. The original audit's validation recorded 2,326 passing game tests,
151 focused coverage tests, a successful production build and profiler export,
passing native/fallback batching checks, and complete demo tours with fixture
restoration and no browser errors. Its broad single-process `test:perf` attempt
was stopped without a final summary and is incomplete.

### Blocked block drags in the demos

Empty-floor measurements miss the reported cascade. In the shipped Tanwei station
(9,572 modules / 14,717 cells), a drag grows a 49 × 48 footprint with 107 refused
cells alongside 2,243 accepted cells. Without the verdict cache, each refused cell
would rebuild `moduleBlockedCells` and scan the entire module list for blockers;
the cache reuses covered verdicts and checks only unseen coordinates.

Production browser measurement, first / repeated movement, milliseconds. The real
demo loader retains authored geometry and seed. Long-press gestures aimed around a
booth cross existing geometry, then cancel (zero commits). Tanwei starts on a roof
hit and holds the pressed height while expanding across roof/support geometry, as
the real block tool does. Chrome 155 / SwiftShader, 1424 × 905, paused population.
Projected endpoints agree within floating-point precision; hit cell/place
coordinates agree exactly. Initial rendering settles before the first measured
hover.

| Fixture / phase | Current first / repeated |
|---|---:|
| Zoo: callback work | 8.3 / 3.4 ms |
| Zoo: ghost CPU ready | 59.6 / 53.4 ms |
| Zoo: event through two RAFs | 83.6 / 84.9 ms |
| Tanwei: callback work | 47.0 / 22.8 ms |
| Tanwei: ghost CPU ready | 91.7 / 73.3 ms |
| Tanwei: event through two RAFs | 248.0 / 177.0 ms |

Accepted/refused counts match: Zoo 492 / 35, Tanwei 2,243 / 107. Tanwei first
hover through two RAFs takes 521.2 ms; software rendering and initialization remain
expensive and variable. CPU readiness is not displayed-pixel latency; two RAFs are
a presentation proxy, not a GPU timer. A 12-position final Tanwei gesture produced
11 / 9 intermediate previews, with no runtime errors or edits.

`block-collision-cache` pins deterministic work on a 1,201-module blocked fixture:
growing a 400-cell refusal by 20 cells performs no new reads of unrelated module
types. It checks witness reuse, shrink/grow, blocker removal, cell replacement,
snapshot isolation, reason priority, retention bounds and broad imported geometry.
Both demos' blocker IDs/order are compared against the original geometry scan at
sampled booth, gate, stair, roof and support positions.

Reproduce: `node tools/bench-drag-latency.mjs`, `BENCH_PIECE=block`,
`BENCH_DEMO=zoo BENCH_SIDE=24` or `BENCH_DEMO=tanwei BENCH_SIDE=48`;
`BENCH_PROFILE=1` captures CPU samples, `BENCH_CONTINUOUS=1` repeats movement.
Reports/screenshots/profiles: `.preview/perf/demo-collision-*.json` and adjacent
files. `BENCH_ASSERT_WITNESS=1` passes through production input on Tanwei: first
and repeated unchanged blocked footprints keep a red cursor without another
preview draw.

### Shared 50 ms drag cadence

Production input measurements below are pointer-to-preview **CPU readiness**, first
invocation / repeated invocation, in ms. Same fixture, camera, seed 12345, paused
empty population, Chrome 155, SwiftShader, 1424 × 905; each fixture has a solid
square floor of the stated side. First hover/press, long press, movement,
Escape/cancel and repeated drag/release are driven through CDP. Initial floor
rendering settles before the first interaction.

| Tool / footprint | Current first / repeated |
|---|---:|
| Block: 10,000 cells over 100 × 100 floor | 88.9 / 86.3 ms |
| Wall: 150 courses over 30 × 30 floor | 55.1 / 51.3 ms |
| Fence: 30 panels | 65.0 / 60.9 ms |
| Tactile: 30 tiles | 72.3 / 63.3 ms |
| Stair block: 30 pieces | 69.5 / 55.8 ms |
| Sidewalk: 900 tiles | 69.3 / 55.0 ms |
| Lawn: 900 tiles | 72.2 / 64.5 ms |
| Road: one 30 m segment | 55.4 / 50.8 ms |

Block event-through-two-RAF presentation proxy is 91.8 / 88.9 ms. This is not a
displayed-pixel or GPU timer. The first block hover takes 142.3 ms through two
frames; initialization and large release scene rebuilds remain separate costs.
Additional block runs: 9,880 floor/auto-wall candidates over a 90 × 90 floor are
ready in 90.2 / 82.3 ms, and a 10,000-cell suspended ceiling over a 100 × 100 floor
in 88.2 / 87.6 ms.

A 12-position continuous block gesture produces **6 / 6 previews while moving**.
Other continuous runs produce: wall 5 / 5, fence 7 / 9, tactile 6 / 6, stair block
6 / 5, sidewalk 6 / 6, lawn 5 / 5, road 6 / 6; roofs remain 12 / 12. Sparse
block/wall ghosts pass their candidate cells to the chunk mesher instead of
visiting every empty cell of a 16 × 16 course; a deterministic 32-candidate
regression spans 32 chunks (32 visits instead of 8,192), compares exact indexed
geometry with the original mesher, covers duplicate/negative coordinates and ramp
filling above pending cells, and checks temporary occupancy restoration. Dense
geometry is still the full mesher output. The shared fake-timer regression drives
every deferred placement controller, asserts a single 50 ms timer across target
changes, retains the previous draw, reuses unchanged snapped targets, keeps previews
out of document commits, and cancels on release.

Reproduce with `node tools/bench-drag-latency.mjs`: `BENCH_PIECE` selects the
palette type (or `block` / `wall`), `BENCH_SIDE` the floor/camera span,
`BENCH_CONTINUOUS=1` enables the 12-position gesture, and `BENCH_PROFILE=1`
captures a CPU profile. `BENCH_AUTO_WALLS=1` and `BENCH_SUSPENDED_CEILING=1`
select the block modes. A unique CDP port isolates each harness from other chats.

### Roof drags

Roof timing is measured separately from blocks. Roof previews build one exact model
per homogeneous run and instance its geometry; all variants retain their full shape
and rotation. The 10,000 cap and a frame scheduler remain.

On a 100 × 100 floor and a 10,000-roof preview, pointer-to-ready is 19.0 ms cold /
10.6 ms warm, including the frame queue and all preview validation. Ghost
submission is 5.8 / 4.9 ms. Through two animation frames it is 34.8 / 33.7 ms:
software rendering/presentation is variable. The cold first hover is 309.2 ms
through two frames (warm 51.1 ms), a remaining initialization/rendering stall. A
12-position continuous drag produces 12 previews before movement stops.

For a 900-tile patch, preview submission is 0.8 / 0.7 ms and movement through two
animation frames 163.3 / 150.6 ms; release is 73.5 ms (117.0 ms through two frames).
A larger 9,801-roof run retains every tile in one preview mesh: cold/warm preview
submission 7.5 / 5.4 ms, movement handlers 0.1 / 0.0 ms. Preview totals are 11 scene
draw calls (10 without the preview). Release takes 394.3 ms (456.6 ms through two
frames) to commit and build the placed models; the preview optimization does not
make that large document edit asynchronous.

`roof-preview` pins the exact model matrices for every roof variant and rotation,
10,000 retained instances in one thin-roof draw, and instance buffer disposal.
`roof-tool` pins one collision preparation and one undoable bulk placement.

### Shared drag footprint

A 99 × 99 real pointer drag (9,801 cells) with auto-walls off, empty station, active
level 1, 1424 × 905 viewport, Headless Chrome 155 / SwiftShader: cold/warm
first-move handlers 0.1 / 0.0 ms and settled ghost submissions 39.5 / 31.1 ms.
Move event-to-two-frame readings are 200.3 / 180.6 ms including the 100 ms
stable-preview delay. The warm release handler takes 256.4 ms and release
event-to-two-frame 281.0 ms; the accepted 9,801-cell commit and its chunk rebuild
remain synchronous. Report: `.preview/perf/block-drag.json`. Reproduce with
`npm run bench:block-drag`.

`multi-place-drag` pins shared ownership, the exact cap, timer replacement and
cancellation. `blocktool` pins whole-footprint refusal (all cells red, no commit,
notice raised during the drag), auto-wall inclusion and Shift/三角 counts;
equipment suites pin their placement/release contracts.

### Level switching

Opening prepares the edited storey and both valid Q/E neighbours through
`STOREY_HEIGHT` and `levelSteps(levelBase)`. The existing four-view cache limit,
appearance/transform invalidation and eviction disposal are unchanged. The editing
grid retains its geometry/material/buffer across storey changes and translates its
group; horizontal bounds changes rebuild and dispose the previous resources.

Production runs are sequential: Windows Chrome, RTX 4080 SUPER / ANGLE D3D11,
native multi-draw, 852 × 715 backing viewport, paused population 0, same demo
seeds/documents and eight real E/Q presses per fixture. Numbers are
event-through-two-RAF latency, not GPU completion or a frame budget.

| Fixture | Cells / modules | First E | Repeated mean | Opening prewarm |
|---|---:|---:|---:|---:|
| Zoo | 16,201 / 4,062 | 94.0 ms | 36.8 ms | 2,553.8 ms |
| Tanwei | 14,717 / 9,572 | 276.9 ms | 65.0 ms | 2,555.3 ms |

After switching, three views retain 1,579 / 1,885 owned batches. Rendering remains
substantial (average 2,348 / 3,003 draw calls and about 591k / 977k triangles);
first-switch presentation still stalls, especially on Tanwei. Prewarming trades
opening work for removing the first interactive batch build; it does not improve
warmed throughput. This change does not prewarm every storey, and visiting an
unprepared or evicted storey can still build its view.

`level-view-cache` pins actual neighbour selection, shifted bases, both level
boundaries, restored active state, retained grid allocations and bounds disposal.
Reports: `.preview/perf/levels-*.json`.

### Settings, population and presentation edits

`tools/bench-settings-audit.mjs` drives actual mounted headway number inputs,
demand sliders and service/peak chart grips with keyboard input. Undo/Redo are
driven through their store actions, independently of editor text undo. Each case
records its first invocation, one repetition, one history/version update, and
scene/chunk/module/batch work counts. `BENCH_ASSERT_FAST=1` requires zero scene
rebuild calls.

Fixture: Zoo, 14,073 cells, 4,291 modules, seed 7654321, paused at 06:30 on Monday
5 January 2026, zero passengers, opening camera at −20 m, 1440 × 1000 Chrome 155
window and hardware rendering enabled. Values are interaction-through-two-RAF
proxies including React, browser and rendering overhead; not CPU or GPU times.

| Settings flow | Current first / repeat | Scene rebuilds |
|---|---:|---:|
| Headway | 202 / 163 ms | 0 |
| Demand curve | 127 / 127 ms | 0 |
| Opening hours | 106 / 201 ms | 0 |
| Peak window | 122 / 137 ms | 0 |
| Settings Undo | 117 / 111 ms | 0 |
| Settings Redo | 103 / 99 ms | 0 |

Undo/Redo synchronous work is 0.2–0.4 ms; the remaining display delay is not a
hidden station rebuild. No runtime errors occurred.

Presentation interactions measured with the same Zoo fixture, hardware GPU, fresh
profile, storey −20, 1440 × 1000. Names, terminus, exit policy and population use
keyboard UI; colour, station name and restart use store actions. Values are
milliseconds, first/repeat, through two animation frames.

| Interaction | Current first / repeat |
|---|---:|
| Line name | 138 / 115 ms |
| Terminus | 118 / 41 ms |
| Line colour | 38 / 42 ms |
| Station name | 37 / 35 ms |
| Exit name | 182 / 185 ms |
| Exit open/closed | 106 / 33 ms |
| Population | 34 / 34 ms |
| Restart | 77 / 123 ms |

Every sample records zero `setStation`, chunk preparation/meshing, module builds
and batch invalidations. Exit policy and population record zero `requestRender`
calls. Existing render frames may still finish after a visible edit. Artwork
captures in `.preview/perf/remaining-final2-psd.png` and
`remaining-final2-exit.png` show station, exit, terminus and colour updates.

Population-only production measurements: `node tools/bench-population-edit.mjs`
drives real ArrowRight input on the mounted train-load and exit-demand ranges.
Software-rendered comparison uses Zoo, 14,073 cells / 4,291 modules, paused, fresh
profile per run, 1440 × 1000, default opening camera/storey and three +1-step inputs
per control. Train load first/repeats: 255 / 239, 241 ms; exit demand 251 / 510,
420 ms. Commit CPU is 8.0–14.2 ms and scene work is zero calls. A hardware run
measured train 67.6 / 58.3, 33.1 ms and exit 107.5 / 115.4, 97.3 ms; synchronous
commit CPU 6.5–7.1 ms. Both final runs had zero scene/geometry/batch work, one
commit per input and no runtime errors. Hardware timings are additional evidence,
not a controlled comparison with the software runs. Two RAFs include UI,
browser and rendering overhead.

`population-edit` rejects geometry, renaming, consist, headway, exit-open and
unknown-field changes; preserves prepared tool geometry; and proves immutable
patch application. `line-edit` checks compact payloads and Undo/Redo.
`worker-preview` asserts retained graph/pool/queue identity, updated spawn inputs,
no rebuild/tick/redundant frame, pending-build ordering and load cancellation.
`scene-wiring` guards the viewport early return before rebuilding. The geometry and
module caches accept the latest population metadata without rebuilding; a
regression also checks that the next bench edit retains the local equipment path
instead of rebuilding because of stale population fields.

### Rendering and batching

Chrome, software GPU, native multi-draw, 1400 × 900 browser window. The checker
compares identical scene geometry with batching enabled and disabled.

| Workload | Unbatched draws | Batched draws, native / fallback | Triangles, both modes |
|---|---:|---:|---:|
| Station fixture | 3,789 | 1,104 / 1,767 | 644,460 |
| Closed train view | 779 | 29 / 594 | 419,228 |
| Open train view | 779 | 29 / 594 | 419,228 |

No captured GLSL/WebGL/runtime errors; GL error is zero. The train-view total
includes the checker's visible scene and is separate from the per-consist
inventory. These are submission counts, with no comparative FPS/GPU-time claim.
Report: `.preview/perf/render-batching-check.json`. `check:render-batching` has a
`--no-multi-draw` fallback; `check:perf-tools` covers the profiler export.

Quality-switch scene totals with the prepared geometry retained:

| Fixture | Low submitted triangles | High submitted triangles |
|---|---:|---:|
| Equipment/decor, shipped demo | 357,843 | 532,775 |
| Passenger crowd, 232 paused passengers | 206,408 | 2,185,136 |
| Road traffic + five train services | 749,766 | 5,622,354 |

These are scene geometry counts; the passenger fixture reported first Low switch
32.6 ms and repeats 22.3 / 26.9 ms through two RAFs, which is not evidence of lower
switch latency or higher FPS. Both prepared geometries and instance buffers are
retained, the paused tick/document version stays unchanged, and GL/shader error
counts are zero.

All three equipment batch paths retain conservative union bounds for Near and Low,
so simplified geometry outside a source part's bounds remains visible and picked
through the original source. Low stays reduced in Hide UI; other-storey and
camera-distance rules also apply. Long roof runs use matching 16 m/storey buckets
with shared geometry, so their far end can reduce independently.

### Opening and build-rail thumbnails

Chrome, software GPU, 1400 × 900, isolated browser profile and no competing test
processes. Fixture: `test/fixtures/covered-rail-clearance.metro.json`. Load timing
ends after worker readiness and two animation frames.

| Measurement | Current |
|---|---:|
| Cold app ready | 5,351 ms |
| First save opening | 332.8 ms |
| Repeated save opening | 623.2 ms |

Both loads preserve 870 cells / 6 modules, active altitude 2 m and train scale
0.98, with no captured console errors. These two samples do not establish a
warm-cache benefit or a speed improvement.

The build rail's cold open: first-visible thumbnail image at **447–516 ms** across
two cold runs; 34–35 of 151 menu images loaded with no failures. A **397–420 ms**
long task remains during React/menu expansion and image presentation; the
thumbnail renderer itself is gone. The 132 × 132 PNGs total 648 KiB for all 120
options. App-ready time is 2,684 ms. This covers local production assets under
SwiftShader at 1400 × 900, not WAN transfer or hardware GPU timing. Reports and
Chrome profiles are in `.preview/perf/menu-thumbnails/`; `node
tools/bench-menu-thumbnails.mjs` starts a fresh Chrome profile, waits for the
production app, opens Equipment, scrolls its first preview into view, and records
the first ready PNG plus browser long tasks.

## Validation and remaining gaps

### Current checks

| Check | Current result |
|---|---|
| Full game suite, process isolation | **2,317 pass; zero failures/skips** (143.2 s) |
| TypeScript typecheck | Pass |
| Geometry inventory | 120 palette models, 10 third-rail and 10 overhead consists, 232 passengers |
| Passenger atlas | 9,370 High / 841 Low stride; 1,308,230 High / 123,928 Low total |

Production browser checks (`check:render-batching` including `--no-multi-draw`,
`check:perf-tools`, `check:preview-lod`, `check:tool-picking`,
`check:geometry-snapping`, `check:equipment-lod`, `check:passenger-lod`,
`check:geometry-detail`) assert correctness, geometry preservation and work counts,
not FPS. Run them before committing; their reports are evidence, not suite
assertions. Focused source coverage is required for changed modules, with line,
branch and function results inspected individually; imported files inflate totals
and Node coverage does not prove GPU behaviour. Run `npm --prefix game run test:perf`,
review changed-module coverage, then run the full suite and production build.

### Remaining gaps

- **Cold first interaction remains the largest stall.** Fence hover, curtain-wall
  hover, roof hover and block hover all include renderer initialization and frame
  latency; the Tanwei block first hover through two RAFs is 521.2 ms and the cold
  roof hover 309.2 ms. CPU readiness is much lower than displayed-pixel latency.
- **Placement does not meet the 100 ms response budget.** Every measured bench
  placement on both demos exceeds it on at least one proxy (5 / 5 each). The four
  cost centres above are the profile order.
- **Worker installation is deferred by design.** Commit-to-worker-frame latency is
  145.6–149.9 ms including the intentional 100 ms coalescing window; the queued job
  still performs a complete graph rebuild.
- **Large document edits remain synchronous.** The 9,801-roof release takes 394.3 ms
  (456.6 ms through two frames) and a 9,801-cell block release 256.4 ms. The preview
  scheduler does not make the commit asynchronous.
- **No paired-demo FPS or simulation-throughput benchmark is current.** Re-measure
  before making throughput claims; the available samples are diagnostic.
- **Single-process instrumented `test:perf` can stall.** Prefer focused
  changed-module coverage with process-isolated test files for the gate; browser
  timing stays evidence, never a unit-test threshold.
- **Software rendering and hardware rendering are not interchangeable.** SwiftShader
  runs describe CPU readiness and presentation proxies; hardware runs are
  additional evidence, not a controlled speedup comparison.

## Reproduce measurements

Run from the repository root with Node 24+ and installed game dependencies:

```powershell
node tools/model-triangle-inventory.mjs
npm --prefix game test
npm --prefix game run build
npm --prefix game run test:perf
node tools/check-render-batching.mjs --software-gpu
npm run check:perf-tools
npm run bench:sim
npm run bench:browser
```

Both benchmark commands run Zoo and Tanwei sequentially. `BENCH_STATION` selects an
external save; `BENCH_OUTPUT` sets a distinct report path. Browser controls include
`BENCH_SECONDS` (default 6), `BENCH_EDITS` (8), `BENCH_SIZE` (1400,900),
`BENCH_PORT` (9348) and `CHROME_PATH`. Simulation uses `BENCH_TICKS` (600) and
`BENCH_EDITS` (12).

Interaction-specific harnesses:

| Harness | What it measures |
|---|---|
| `tools/bench-drag-latency.mjs` | Block/wall/fence/tactile/stair/sidewalk/lawn/road pointer previews; demo blocked drags; continuous gestures |
| `tools/bench-fence-drag.mjs` | Fence hover/press/move/cancel/release, groups and batch syncs |
| `tools/bench-tree-placement.mjs` | First equipment placement against untouched fences |
| `tools/bench-level-switch.mjs` | Q/E first and repeated presses, prewarm and retained views |
| `tools/bench-population-edit.mjs` | Mounted train-load and exit-demand range inputs |
| `tools/bench-settings-audit.mjs` | Headway, demand, service/peak, Undo/Redo and presentation flows |
| `tools/bench-placement-latency.mjs` | Bench placement pointer-to-submission and subsystem timings |
| `tools/bench-usage-tour.mjs` | Full demo workflow tour |
| `tools/bench-curtain-preview.mjs` | Tanwei carried-curtain hover |
| `tools/bench-menu-thumbnails.mjs` | Build-rail cold open and long tasks |
| `tools/check-tool-picking.mjs` | Shared event picking, ramp occlusion, deletion and undo |
| `tools/check-geometry-snapping.mjs` | Slab/hanger/wall anchors and low-angle object picks |
| `tools/bench-preview-audit.mjs` | Palette preview sweep and cancellation |
| `tools/check-preview-lod.mjs` | Real glass picks, Low/High topology and preview/commit height |
| `tools/check-equipment-lod.mjs` | All equipment High/Low visible pixels and budgets |

Browser benchmarks use hardware rendering by default; add `--software-gpu` for
SwiftShader. Match fixture, seed, camera, population, viewport, hardware and GPU
backend between comparisons, and run without competing tests/builds.
`profile:browser` and `profile:sim` collect diagnostic profiles; `--investigate`
adds browser ablations. Keep raw reports under `.preview/perf/` and use separate
output paths for profiled and clean runs. CPU render submission, asynchronous GPU
time and frame presentation are distinct measurements; frame edits measured through
two animation frames are not GPU fences.

## Guard the cause and verify the result

Prefer deterministic assertions about work and correctness: one scene pick per
press, no preview commit, one release commit, retained allocation identity, cache
invalidation, bounded dormant entries and exact disposal. Do not use FPS or
wall-clock thresholds in Node tests. Retain placement, route and geometry checks so
an apparent speedup cannot come from missing work or invisible content.

Run focused regressions and `npm run test:perf` for source coverage. Inspect the
changed files' line/function/branch results; imported files inflate totals, and
Node coverage does not prove GPU behaviour. Run the full game suite and production
build before committing implementation changes. For renderer changes, use
`check:render-batching`, its `--no-multi-draw` fallback and `check:perf-tools` as
appropriate; browser checks assert correctness rather than FPS.

Record current results and limitations in this reference, including remaining cold
stalls, unchanged throughput and unrelated validation failures. Keep raw JSON,
screenshots, CPU profiles and traces under ignored `.preview/perf/`. Never weaken an
asset-integrity assertion or change generated provenance merely to make a
performance change's test run green.


## Tanwei hidden-ceiling block faces (2026-10-22)

At `(16,6,-1)`, suspended ceilings at `(16,5,-1)` and `(16,7,-1)`
were still side-occlusion votes after their independent render pass was hidden.
The second report, `(18,14,-3)` viewed from -y, exposed a related missing top:
the stepped wall's ledge at `(18,12,-2)` lost its top to a hidden ceiling at
`(18,12,-1)`, exposing the block interior. Ordinary/ground/plate passes now
retain every face beside suspended ceilings; ceiling-to-ceiling culling remains.
The halo hash includes matching side, cap and support votes, including across
the x=16 chunk boundary. No view-dependent remeshing, document commit or pointer
picking is added.

`node tools/check-ceiling-wall-faces.mjs` checks the production build with the
full shipped Tanwei demo at activeZ=-5, other storeys off: both reported side
faces exist with ceilings hidden, downward and oblique -y rays hit the restored
ledge top at z=-1, and six hide/show toggles retain every chunk geometry. The
saved production screenshot confirms the open black strip is filled. On this
local software-GPU run first show took 33.8 ms, subsequent shows 18.0/18.4 ms,
and hides 22.0/17.7/16.1 ms. These are synchronous setter timings, not frame
latency or a controlled before/after performance comparison. Raw results,
screenshot and validation logs: `.preview/perf/ceiling-wall-faces/`.

The focused `floor-geometry` + `chunk-cache` + `storey-height` instrumented run
passes 32 tests: `chunkMesher.ts` 71.54% lines / 81.40% branches / 61.54% functions;
`ChunkSystem.ts` 96.12% / 92.38% / 86.67%. The regression checks all four wall
sides, ledge closure from above and -y, ordinary shared-face culling, tag-only
neighbour changes across chunks, and geometry identity across ceiling toggles.
Production build passes. The initial full run had 2,320 passes and one unrelated
existing sign-preview source-text assertion failure in `scene-wiring` against
the concurrently modified `SceneRenderer.setStation` signature.

Final full owning suite: **2,325 passing, zero failures/skips** (`tests-final.txt`);
the initial unrelated assertion was resolved by concurrent work. The broad
in-process `test:perf` attempt was stopped after approximately 13 minutes without
a final summary; it is incomplete, not a pass. The completed focused coverage,
full suite and production browser checks above are the validation for this fix.

## Local equipment placement retention

Keep `ModuleSystem`'s existing scene parents and registries on an immutable
append when every previous model survives. `EquipmentBatches.invalidateViews(true)`
may retain source discovery only after the model-dependency classifier proves
the retained roots' inputs unchanged; rebuilt roots discover fresh sources and
removed roots leave the aggregate. Source records are bounded per root/view, transform changes refresh
them, and append aggregation updates only buckets receiving new sources. Unknown
callers retain conservative invalidation. Retired GPU entries leave the click
path through bounded idle disposal; teardown cancels and drains that work.

An equipment edit can extend virtual ground without changing authored chunks.
Use the explicit ground-only preparation/meshing path only after the same
classifier proves unchanged authored cells, openings and metadata. Preserve
structural indexes and authored buffers; hash/remesh changed ground boundaries.
Expansion and shrink must match a fresh full mesh. Keep the ordinary full path
for structural edits. On retained equipment, compare immutable module records
before serialization, skip unchanged level styling, and advance clipping shader
versions only when clipping changes. Never defer a refusal or make previews
commit documents.

This reference is the canonical home for placement measurements, reproduction
and the remaining 100 ms gap; use [the placement budget and audit](#placement-100-ms-budget)
alongside the local equipment placement retention notes here when changing that
path.

## Full demo benchmark rerun (2026-10-22)

`npm run bench:sim` and `npm run bench:browser` completed on both shipped demos,
Zoo then Tanwei. Simulation used Node 24.15.0 on Windows with an i7-14700KF,
seed 7654321, 600 ticks per phase and 12 edit samples. Browser used Headless
Chrome 155 at 1384 × 805 on an RTX 4080 SUPER / D3D11, with 6-second phases and
8 edits. Browser build and TypeScript check passed; Vite emitted its existing
large-chunk advisory. These are single-run measurements, not a controlled
before/after comparison.

| Demo | Cells / modules / nodes | Peak tick mean / p95 | Cold world mean | Live rebuild mean / p95 |
|---|---:|---:|---:|---:|
| Zoo | 14,073 / 4,291 / 15,120 | 5.26 / 10.18 ms | 205.31 ms | 79.05 / 108.60 ms |
| Tanwei | 16,869 / 9,694 / 37,474 | 40.05 / 83.65 ms | 967.17 ms | 522.40 / 831.35 ms |

| Demo | Paused FPS | 16× play FPS / passengers | Train first-arrival stall | Paint edit-to-frame mean | Block edit-to-frame mean |
|---|---:|---:|---:|---:|---:|
| Zoo | 59.6 | 48.6 / 615 | 940.7 ms | 200.5 ms | 490.9 ms |
| Tanwei | 30.6 | 22.2 / 1,155 | 951.8 ms | 326.1 ms | 985.1 ms |

The browser run also measured idle-paused at 60 FPS for both demos. Peak 16×
render submission p95 was 17.9 ms for Zoo and 94.4 ms for Tanwei. Raw captures:
`.preview/perf/sim-rerun-2026-10-22-zoo.json`,
`.preview/perf/sim-rerun-2026-10-22-tanwei.json`,
`.preview/perf/browser-rerun-2026-10-22-zoo.json` and
`.preview/perf/browser-rerun-2026-10-22-tanwei.json`.

## Tanwei structural edit and rendering follow-up (2026-10-22)

The paired demo bench above exposed a 985 ms mean block edit-to-two-RAF time.
The follow-up preserves batch-source discovery and level styling for each root
whose declared model inputs and slice inputs survive a structural edit. A fully
retained equipment set also keeps its animation registries. Rebuilt or removed
roots still take their normal paths; changed ground bands and storey spans must
refresh styling. Unknown model dependencies remain conservative.

Batched static picking leaves retain their prepared local matrices instead of
recomposing them on every frame. Resync and teardown restore the original
`matrixAutoUpdate` flags, and parent world transforms still propagate. During a
synchronous renderer call, fully batched source-only trees are hidden from scene
projection and restored in `finally`. Moving rigs, masked buckets whose sources
must draw, and cameras viewing the source layer keep their normal traversal.
This never changes document state or visibility between input events.

The final clean hardware run used the same Tanwei fixture (16,869 cells / 9,694
modules), Chrome 155 / RTX 4080 SUPER, 1384 × 805 viewport, seed 7654321,
6-second phases and 8 edits. These are single-run diagnostics, not timing gates.

| Measurement | Original clean run | Final clean run |
|---|---:|---:|
| Block edit-to-two-RAF mean | 985.1 ms | 654.0 ms |
| Block edit-to-two-RAF p95 | 1,060.3 ms | 778.3 ms |
| Block scene update mean | 600.8 ms | 361.5 ms |
| Block chunk meshing mean | 119.6 ms | 122.3 ms |
| Block module build/registration mean | 112.9 ms | 141.1 ms |
| Paused continuous-render FPS | 30.6 | 32.1 |
| Paused renderer submission mean | 31.1 ms | 29.3 ms |

Observed block response improved about 34%, but remains far above 100 ms. Block
phases held 1,154 / 1,155 passengers and submitted the same 6,136,856 triangles;
draw calls were 4,574 / 4,598. Both zero-population paused phases submitted exactly
4,516 draws / 1,065,610 triangles. The intermediate optimized run reached 589.6 ms
with fewer passengers and is not the final comparison. Live 16× rendering remains
about 22 FPS; differing phase populations prevent a controlled throughput claim.
Remaining edit costs include approximately 122 ms chunk meshing and 141 ms model
build/registration. Rendering still submits 1,882 equipment batches, 894
platform-edge draws and 384 lift draws in the paused fixture; dynamic equipment
submission and GPU work need further investigation. Nested CPU timings overlap.

Validation: 2,329 game tests pass with zero failures/skips (128.9 s); the focused
instrumented run passes 71 tests. `equipmentBatches.ts` has 94.53% lines / 95.18%
branches / 88.10% functions, and `ModuleSystem.ts` 80.98% / 89.60% / 64.71%.
The production build, native/fallback render-batching checks, tool picking and
profiler export smoke check pass. The Tanwei production retention check compares
ordinary versus skipped-source rendering under default, moving-mask, Hide UI and
hidden-other-storey views; draw/triangle counts and restored root visibility
match. Its retained cell edit and a fresh rebuild also match exactly (4,518 draws,
1,065,618 triangles), with GL error zero. Node coverage does not cover the actual
WebGL rendering path; these browser checks supply that evidence.

Final capture: `.preview/perf/tanwei-improvement-after-final.json`; intermediate
capture: `tanwei-improvement-after-v2.json`; correctness capture and reproducible
browser script: `tanwei-improvement-retention-check.json` and
`check-tanwei-retention.mjs` in the same directory. Validation logs use the
`tanwei-improvement-` prefix. `tanwei-improvement-baseline-profile.cpuprofile`
contains the diagnostic CPU profile; its subsequent Chrome trace stream timed
out, so that instrumented run is incomplete and is not the clean baseline.
