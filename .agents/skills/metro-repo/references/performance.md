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

### Q/E level switching

Use `node tools/bench-level-switch.mjs` against both shipped demos after building
`game/dist`. Record the first real Q/E press separately from warmed presses,
opening prewarm time, batch-cache hits, retained allocations, draw calls and
triangles. Keep the before run comparable (`--baseline` permits the known opening
cache miss while retaining correctness checks); `--no-multi-draw` checks the
fallback renderer. A level-cache hit must preserve exact batch allocations and
must not advance the paused simulation. Prewarm the edited storey and immediate
valid neighbours from `levelBase` using `STOREY_HEIGHT`; never infer neighbours
from the lowest rendered chunk or assume a four-metre step. The editing grid
should translate on Q/E while retaining its geometry and buffer, rebuilding only
when horizontal station bounds change. Pin neighbour boundaries, shifted bases,
cache invalidation/disposal and grid allocation identity in
`game/test/level-view-cache.test.mjs`.

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
- Count a drag's footprint arithmetically before allocating it. The shared
  `MultiPlaceDrag` scheduler uses a 50 ms latest-target throttle for block, wall,
  fence, tactile, road, tile-equipment and related placement drags: target changes
  replace pending work without restarting the timer, so motion does not starve
  preview. It skips an unchanged rendered target, keeps the prior accepted preview
  visible while work is pending, and flushes/cancels on release/cancel. Roofs use
  their frame scheduler. Preserve each tool's preview/refusal contract; known
  over-budget targets clear accepted layers immediately and remain refused whole.
  The 10,000-cell budget applies to all supported placement drags and includes
  generated auto walls. See `npm run bench:block-drag` and
  `node tools/bench-drag-latency.mjs` for real pointer measurements.
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
`equipment-retention` pin the deterministic work counts; record measured
before/after numbers and fixture controls in `game/PERFORMANCE.md`.

### Block collision cascades in demo stations

Use `node tools/bench-drag-latency.mjs` with `BENCH_PIECE=block` and
`BENCH_DEMO=zoo` or `tanwei`; choose `BENCH_SIDE` to include the real collision
footprint. This loads the shipped example without replacing its authored data.
Measure cold and warm movement through the real pointer path, including a blocked
rectangle, then compare accepted/refused counts, callback CPU, ghost CPU and the
two-RAF presentation proxy. `BENCH_ASSERT_WITNESS=1` checks that tiny movement
within the same snapped blocked target leaves the cursor red without another
preview draw. `BENCH_PROFILE=1` captures CPU profiles and `BENCH_CONTINUOUS=1`
measures intermediate previews during ongoing movement. Save raw outputs in the
ignored `.preview/perf/` directory and summarize setup, results and limitations in
`game/PERFORMANCE.md`. Keep a deterministic work-count regression for the original
cascade; browser timing is supporting evidence, never a unit-test threshold.

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

Triangle counts below are for one model built from each palette option's default configuration. High is the full model geometry; Low uses the renderer's reduced geometry wherever that model part has a supported approximation, and keeps unsupported parts at full detail. These are model triangles, not totals across all placed copies. Width, length, style and material controls can create additional variants; the table lists the 120 shipped palette options.

#### Ambient road vehicles

Ambient road vehicles are seeded into the six models listed below. The counts are per
vehicle instance and include the colour geometry plus its matching depth-only prepass;
the prepass suppresses far-side fittings. High uses 70% opacity; Low vehicles and
Low passenger bodies use 45%. Low road vehicles stay at or below 10% of High's
submitted triangles (including the depth pass). Low is an
authored geometry variant selected by the game's Low graphics setting, not a runtime
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

Each Low model preserves the full variant's body outline, windows and required fittings
while reducing wheels, repeated rods, spokes, fender tessellation and bus-window mullions.
Low uses diamond hubs, four-corner body sections, coarse rounded fittings,
flat outward arch strips and LED segments; cars omit door handles and chrome belt strips.
Thin fittings keep their outward face, rods use open triangular tubes, and bicycle
wheels retain two-sided open rims and spokes. The basket keeps its perimeter.
`road-vehicles.test.mjs` pins the reduction, instance switch, pause behaviour and exact
resource release. This is a geometry update, with no timing claim.

Regenerate all three tables in this section with `node tools/model-triangle-inventory.mjs`;
it writes ignored `.preview/perf/model-triangles.{json,md}`, `train-triangles.{json,md}`
and `passenger-triangles.{json,md}`. The inventory builds the equipment and the trains
through the real renderer path (batching included) and reads the passengers from the
baked atlas records. The authored Low
variants remove shelf stock, cubicle interiors and fine hardware; keep simplified
sink/CCTV/AC silhouettes, track sleepers/rails, ramp bands, lift doors and stair
surfaces. Source picks and rigs stay exact. `model-detail` guards per-model triangle
budgets, batching, restoration, finish colours and disposal. Update this table and
`game/PERFORMANCE.md` together after changing models or the detail policy.

Tree far/Low uses sparse, enlarged intact crossed leaf cards and a continuous six-sided trunk;
retain canopy extrema and valid leaf UVs when rebaking with
`node tools/bake-street-tree-lod.mjs`. Clock Low retains two readable hour-marked
faces and moving hands, using flat marks/hands and a twelve-sided case.

Every palette model above ten High triangles must have a nonempty Low variant
with fewer triangles, guarded by the catalogue sweep in `model-detail` and the
inventory script. The smaller primitive families retain source UVs, colours and
artwork: thin box sheets keep both broad faces, and rods omit their end caps.
Round pillar shafts keep eight sides, narrow support rods use triangular tubes, and circular lights use a hexagonal rim and two-sided diffuser; guide columns
omit buried bottom caps. Source picking and animated rig identities remain exact.

Furniture/cabinets omit stock and fine fittings; vending drinks become thin colour
panels. Fences use open triangular tubes without clamps/feet fittings and fewer iron bars. Fare gates retain
reader/entry artwork and animated leaves. Exit Low retains openings, printed
headers and the wave profile, with thin roof/glass surfaces and fewer frame posts.
`panelModelDetail` retains two broad faces; approximation bounds include both full
and reduced shapes so combined fittings do not disappear at the screen edge.

Rail-signal Low keeps three six-sided aspects, diamond rims and coarse hood shells.
Noise barriers retain full posts and all bay/gantry cutouts, using two broad faces
per thin panel/middle rail. Top beams retain thickness with hidden end caps omitted;
the shared bridge builders also prepare these Low variants.

| Equipment / decor model name | Low triangles | High triangles |
|---|---:|---:|
| tree | 396 | 18432 |
| shelf-cooler | 420 | 9852 |
| shelf-cooler-dark | 420 | 9852 |
| bridge | 720 | 9576 |
| shelf-white-tall | 240 | 7556 |
| shelf-dark-tall | 240 | 7244 |
| shelf-wire | 412 | 6524 |
| cubicle | 84 | 5688 |
| cctv-dome | 336 | 5208 |
| walkway | 290 | 5162 |
| cctv-post | 352 | 5096 |
| sink | 224 | 4972 |
| cctv-ptz | 308 | 4924 |
| shelf-white-short | 192 | 4420 |
| escalator | 204 | 3410 |
| ac-unit | 140 | 2924 |
| stair-leftForward | 232 | 2336 |
| stair-rightForward | 232 | 2336 |
| stair-left180 | 222 | 2288 |
| stair-right180 | 222 | 2288 |
| stair-centerForward | 212 | 2240 |
| stair-left90 | 212 | 2240 |
| stair-right90 | 212 | 2240 |
| clock | 188 | 1940 |
| stair-straight | 150 | 1940 |
| cctv | 124 | 1888 |
| lift | 140 | 1740 |
| electrical-cabinet | 36 | 1224 |
| extinguisher-glass | 86 | 918 |
| exit-covered-1 | 68 | 902 |
| exit | 68 | 902 |
| exit-covered-3 | 68 | 902 |
| roof-canopy | 56 | 840 |
| tactile-warning | 4 | 812 |
| pillar-thick | 64 | 768 |
| fence-iron | 72 | 768 |
| checkout | 64 | 750 |
| gate-new | 68 | 720 |
| rail-signal | 64 | 708 |
| vending | 40 | 676 |
| gate | 64 | 668 |
| desk | 60 | 652 |
| exit-uncovered-2 | 52 | 554 |
| exit-uncovered-3 | 52 | 554 |
| exit-uncovered-1 | 52 | 530 |
| fence-gate | 38 | 432 |
| roof-tapered | 38 | 396 |
| tvm | 30 | 372 |
| busstop-long | 30 | 372 |
| fence | 26 | 360 |
| door-steel-1 | 20 | 324 |
| door-glass-1 | 18 | 324 |
| roof-truss | 26 | 264 |
| busstop-short | 24 | 260 |
| light-circular | 18 | 256 |
| monitor-wall | 8 | 213 |
| lawn | 12 | 204 |
| bin | 26 | 196 |
| vent | 32 | 168 |
| bench-seat-1 | 20 | 156 |
| extinguisher | 12 | 146 |
| extinguisher-compact | 12 | 146 |
| door-wood-1 | 20 | 144 |
| sidewalk | 12 | 132 |
| psd-end | 30 | 114 |
| tv | 22 | 114 |
| noise-barrier | 46 | 108 |
| noise-barrier-half | 46 | 108 |
| traffic-light | 28 | 108 |
| bench-steel-1 | 16 | 84 |
| sign-ceiling | 18 | 74 |
| monitor-ceiling | 20 | 72 |
| tactile-guide | 10 | 60 |
| guidepost | 57 | 60 |
| curtain-wall | 18 | 60 |
| glass-1x1 | 18 | 60 |
| glass-2x1 | 18 | 60 |
| glass-3x1 | 18 | 60 |
| glass-1x2 | 18 | 60 |
| glass-2x2 | 18 | 60 |
| glass-3x2 | 18 | 60 |
| exit-virtual | 46 | 60 |
| road | 10 | 50 |
| pillar-slim | 16 | 48 |
| stair-block | 34 | 48 |
| billboard-wide | 6 | 40 |
| billboard-standard | 6 | 40 |
| billboard-large | 6 | 40 |
| billboard-panorama | 6 | 40 |
| billboard-portrait | 6 | 40 |
| billboard-square | 6 | 40 |
| linemap-stand | 16 | 40 |
| hanger-roof | 6 | 36 |
| hanger-post | 14 | 36 |
| linemap-wall | 4 | 26 |
| exit-doorway-1 | 10 | 26 |
| exit-doorway-2 | 10 | 26 |
| exit-doorway-3 | 10 | 26 |
| exit-doorway-4 | 10 | 26 |
| roof-shell | 8 | 24 |
| noise-barrier-railing | 16 | 24 |
| light-rectangular | 6 | 24 |
| roof | 4 | 12 |
| psd-end-cover | 4 | 12 |
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

#### Equipment minimum-shape exceptions

Low targets strictly less than 10% of High. The user-approved exceptions below keep a minimum usable shape, including existing two-triangle artwork. Caps and reasons live in `tools/equipment-low-budgets.mjs` and are enforced by the inventory and regression suite; High geometry is unchanged. Counts describe model geometry; transparent two-sided materials can submit an additional GPU pass.

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
| pillar-slim | 16 / 48 | Shaft and end collars, preserving height and support footprint. |
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

### Train models (车辆)

One row per reviewed consist built by `buildTrain`, including legacy D-6 (the current
D stock selects eight cars). These rows use the third-rail roof and exclude
pantographs; see `game/PERFORMANCE.md` for the separately measured overhead-wire
variants. Counts are model triangles for one train, not totals across services. High is the
complete consist — both cabs, gangways, the rideable cabin interior, bogies and the
closed door leaves (open/closed poses submit the same triangles). Low is what the same
consist draws after its prepared swaps: a part with an authored §9.3 approximation
swaps geometry, a part outside that set (a 12-triangle slab, a fixed 5 m surface)
keeps its full geometry. Counts are drawn totals through the renderer's own path —
static batching, door banks and sorted glass batches — not a sum of unmerged parts.

| Train model | Low triangles | High triangles |
|---|---:|---:|
| D-8 | 78144 | 1303424 |
| D-6 | 61196 | 1008052 |
| A-8 | 71016 | 730512 |
| A-6 | 54612 | 574244 |
| C-6 | 50516 | 534888 |
| B-6 | 48480 | 513888 |
| L-6 | 44272 | 464576 |
| C-4 | 35616 | 395652 |
| B-4 | 34028 | 378236 |
| L-4 | 31132 | 344492 |

The shared `TrainBogie.ts` wheelsets, sculpted frames, suspension and brakes are included in these regenerated counts; Low keeps profiled eight-sided tyre treads and flanges, six-sided wheel webs,
and omits coils, bolts, pipes, dampers and fine brake/bearing fittings.

D's layout and counts were verified on 2026-10-17: each side has four doorways
and three bays of two small windows, with painted end bays. Middle cars have four
double doors; cab cars have three double doors and one single door nearest the
cab, mirrored at opposite ends. `DTrainShell.ts` owns the curved shell and panes;
`stock.ts` shares door centres and widths with the platform screens. The inventory
is `.preview/perf/train-triangles.json`, regenerated by
`node tools/model-triangle-inventory.mjs`; `stock`, `draw-batching` and `train-lod`
pin the cadence, apertures, moving doors and geometry totals.

L's three-door car keeps its shell and platform cadence, with one broad cab windscreen,
small framed end windows and paired wide inter-door windows. The window builder keeps
the real glazing apertures and uses one-segment corner curves for Low geometry.

B keeps the shared shell and four-door cadence, with a single broad windshield at each
cab and three inset, rounded, rubber-framed side windows between the doors. End bays
remain painted. Low detail keeps the cut-out glazing and rubber frame while reducing
the corner segments; the B-6 and B-4 totals above were regenerated through the train
inventory path (`.preview/perf/train-triangles.json`).

Every selectable stock, one through eight cars, with either third rail or catenary,
must draw at most 10% of its own High triangles. `train-lod` checks all 80 combinations,
moving door banks and exact High restoration through the real TrainSystem path.
The interior carries most of the reduction for A/B/C/L: straps become hollow,
two-sided triangular loops; handrails use open three-sided tubes over two path
segments; ring lights use eight ring segments and three tube sides. Door and window
frames retain real apertures and both broad faces while omitting thin edge walls.
Door leaves still follow the Low shell profile. D keeps its authored lofted shell,
plug doors and bellows; clipped cab trim also carries explicit 12×3 Low surfaces.
High geometry counts remain unchanged. `tools/check-transport-lod.mjs` captures
both details, both power systems, front/side elevations and three door poses;
reports and images live in `.preview/perf/transport-10pct/train-captures/`.
The shipped 动物园 Line 5 runs **L-6**.

Train parts are authored in their builders (`render/modelDetail.ts`); `batchStaticParts`
merges both variants so a batch carries its own Low geometry, and the door banks and
sorted-glass batches reserve theirs when they are built. A part with no authored
variant may fall back to the bounded-error simplifier only inside
`TRAIN_DETAIL_MAX_RADIUS` — a merged car spans a whole consist, and 2 % of that is
metres. Preparing both variants costs roughly 10 % (D) to 30 % (B/C) more on a
consist's first build, once per cached configuration (eight are kept).

### Passenger models (乘客)

One row per reviewed appearance in the baked crowd atlas
(`game/src/assets/passenger-approved.json`, prepared instanced draws with no
per-agent GLB or skeleton). High is each variant's full topology; Low is a second
index table over the same animated vertex pool. Every appearance has a hard
budget of `floor(highTriangles * 0.10)`; the shared padded draw also stays below
10% of High. The current shared stride is **9,370 High / 841 Low triangles (9.0%)**.

`tools/passenger-low-topology.mjs` builds separate faceted envelopes for each
anatomical part and palette region, keeping heads, arms, legs, shoes, skirts and
bags separate. Closed envelopes avoid the missing legs produced by unconstrained
grid clustering. Envelope simplification does not prune components; original
source faces retain extrema from every one of the 73 pose frames. Every output
corner references an existing animated vertex from that appearance, and every
triangle keeps one original flat palette region. Skirts retain their original
cloth topology with motion-aware reduction instead of a standing envelope.
Other parts use convex envelopes that remove concavities and small detail. Full geometry,
pose frames, normals, regions, source hashes and eligibility metadata are unchanged.

Each packed instance records its storey in `passengerLevel`. 高画质 draws the
edited storey full and ghosted storeys reduced; 低画质 draws the whole crowd reduced;
隐藏UI restores full bodies. One-storey crowds use one draw; ghosted crowds can add
a second. High bodies use 70% opacity and Low bodies 45%. The pose, normal and
region textures remain shared, so the triangle reduction does not reduce their
memory. Switching quality retains the prepared GPU allocations.

| Passenger model | Low triangles | High triangles |
|---|---:|---:|
| male-original-bag | 820 | 9370 |
| male-short-bag | 811 | 9314 |
| male-bald-bag | 801 | 9296 |
| male-short-small-bag | 831 | 8872 |
| male-short-standard-87.5-bag | 841 | 8867 |
| male-bald-small-bag | 827 | 8854 |
| male-bald-standard-87.5-bag | 835 | 8849 |
| male-short-standard-75-bag | 825 | 8832 |
| male-bald-standard-75-bag | 821 | 8814 |
| male-side-part-bag | 776 | 8772 |
| male-quiff-bag | 776 | 8772 |
| male-swept-bag | 776 | 8752 |
| male-crop-bag | 765 | 8673 |
| female-rounded-bob-bag | 760 | 8636 |
| female-lob-bag | 758 | 8594 |
| female-bob-bag | 758 | 8584 |
| female-angled-bob-bag | 758 | 8582 |
| female-side-part-bob-bag | 758 | 8580 |
| female-shoulder-bag | 754 | 8579 |
| female-shoulder-swept-bag | 754 | 8579 |
| female-cropped-bob-bag | 758 | 8578 |
| male-crew-bag | 752 | 8569 |
| male-buzz-bag | 752 | 8526 |
| male-rounded-bag | 752 | 8524 |
| male-original-small-bag | 791 | 8425 |
| male-original-standard-87.5-bag | 798 | 8409 |
| male-original-standard-75-bag | 788 | 8389 |
| male-side-part-small-bag | 787 | 8363 |
| male-quiff-small-bag | 787 | 8363 |
| male-side-part-standard-87.5-bag | 794 | 8347 |
| male-quiff-standard-87.5-bag | 792 | 8347 |
| male-swept-small-bag | 787 | 8343 |
| male-swept-standard-87.5-bag | 790 | 8327 |
| male-side-part-standard-75-bag | 782 | 8327 |
| male-quiff-standard-75-bag | 784 | 8327 |
| male-swept-standard-75-bag | 782 | 8307 |
| female-rounded-bob-small-bag | 785 | 8269 |
| male-crop-small-bag | 782 | 8264 |
| male-crop-standard-87.5-bag | 787 | 8248 |
| female-rounded-bob-standard-87.5-bag | 784 | 8241 |
| female-rounded-bob-standard-75-bag | 779 | 8235 |
| male-crop-standard-75-bag | 775 | 8228 |
| female-lob-small-bag | 781 | 8227 |
| female-bob-small-bag | 779 | 8217 |
| female-angled-bob-small-bag | 779 | 8215 |
| female-side-part-bob-small-bag | 779 | 8213 |
| female-shoulder-small-bag | 779 | 8212 |
| female-shoulder-swept-small-bag | 779 | 8212 |
| female-cropped-bob-small-bag | 779 | 8211 |
| female-lob-standard-87.5-bag | 780 | 8199 |
| female-lob-standard-75-bag | 777 | 8193 |
| female-bob-standard-87.5-bag | 780 | 8189 |
| female-angled-bob-standard-87.5-bag | 780 | 8187 |
| female-side-part-bob-standard-87.5-bag | 780 | 8185 |
| female-shoulder-standard-87.5-bag | 780 | 8184 |
| female-shoulder-swept-standard-87.5-bag | 780 | 8184 |
| female-cropped-bob-standard-87.5-bag | 780 | 8183 |
| female-bob-standard-75-bag | 777 | 8183 |
| female-angled-bob-standard-75-bag | 777 | 8181 |
| female-side-part-bob-standard-75-bag | 777 | 8179 |
| female-shoulder-standard-75-bag | 777 | 8178 |
| female-shoulder-swept-standard-75-bag | 779 | 8178 |
| female-cropped-bob-standard-75-bag | 777 | 8177 |
| male-crew-small-bag | 763 | 8160 |
| male-crew-standard-87.5-bag | 772 | 8144 |
| male-crew-standard-75-bag | 764 | 8124 |
| male-buzz-small-bag | 761 | 8117 |
| male-rounded-small-bag | 759 | 8115 |
| male-buzz-standard-87.5-bag | 766 | 8101 |
| male-rounded-standard-87.5-bag | 764 | 8099 |
| male-buzz-standard-75-bag | 760 | 8081 |
| male-rounded-standard-75-bag | 760 | 8079 |
| female-midi-pleated-swapped-no-bag | 569 | 5832 |
| female-long-a-line-swapped-no-bag | 565 | 5806 |
| female-long-pleated-swapped-no-bag | 570 | 5805 |
| female-midi-pleated-no-bag | 571 | 5802 |
| female-midi-a-line-swapped-no-bag | 551 | 5785 |
| female-long-a-line-no-bag | 563 | 5775 |
| female-long-pleated-no-bag | 565 | 5775 |
| female-midi-a-line-no-bag | 563 | 5773 |
| female-full-pleated-swapped-no-bag | 564 | 5771 |
| female-full-pleated-no-bag | 562 | 5770 |
| female-slim-long-skirt-no-bag | 561 | 5749 |
| female-slim-long-skirt-swapped-no-bag | 558 | 5718 |
| male-short-crossbody-right-bag | 481 | 5071 |
| male-short-crossbody-left-bag | 474 | 5070 |
| male-bald-crossbody-right-bag | 479 | 5053 |
| male-bald-crossbody-left-bag | 474 | 5052 |
| male-short-shoulder-right-bag | 452 | 4764 |
| male-short-shoulder-left-bag | 451 | 4762 |
| male-bald-shoulder-right-bag | 450 | 4746 |
| male-bald-shoulder-left-bag | 451 | 4744 |
| male-short-no-bag | 450 | 4705 |
| male-bald-no-bag | 440 | 4687 |
| male-original-crossbody-right-bag | 451 | 4650 |
| male-original-crossbody-left-bag | 446 | 4649 |
| female-long-swept-crossbody-right-bag | 446 | 4612 |
| female-long-swept-crossbody-left-bag | 446 | 4611 |
| female-long-crossbody-right-bag | 446 | 4605 |
| female-long-crossbody-left-bag | 444 | 4604 |
| male-side-part-crossbody-right-bag | 447 | 4588 |
| male-quiff-crossbody-right-bag | 447 | 4588 |
| male-side-part-crossbody-left-bag | 440 | 4587 |
| male-quiff-crossbody-left-bag | 440 | 4587 |
| male-swept-crossbody-right-bag | 443 | 4568 |
| male-swept-crossbody-left-bag | 438 | 4567 |
| male-crop-crossbody-right-bag | 438 | 4489 |
| male-crop-crossbody-left-bag | 435 | 4488 |
| female-rounded-bob-crossbody-right-bag | 432 | 4482 |
| female-rounded-bob-crossbody-left-bag | 432 | 4481 |
| female-lob-crossbody-right-bag | 429 | 4440 |
| female-lob-crossbody-left-bag | 421 | 4439 |
| female-bob-crossbody-right-bag | 428 | 4430 |
| female-bob-crossbody-left-bag | 420 | 4429 |
| female-angled-bob-crossbody-right-bag | 428 | 4428 |
| female-angled-bob-crossbody-left-bag | 420 | 4427 |
| female-side-part-bob-crossbody-right-bag | 428 | 4426 |
| female-side-part-bob-crossbody-left-bag | 420 | 4425 |
| female-shoulder-crossbody-right-bag | 425 | 4425 |
| female-shoulder-swept-crossbody-right-bag | 425 | 4425 |
| female-shoulder-crossbody-left-bag | 421 | 4424 |
| female-shoulder-swept-crossbody-left-bag | 421 | 4424 |
| female-cropped-bob-crossbody-right-bag | 428 | 4424 |
| female-cropped-bob-crossbody-left-bag | 420 | 4423 |
| male-crew-crossbody-right-bag | 427 | 4385 |
| male-crew-crossbody-left-bag | 424 | 4384 |
| male-buzz-crossbody-right-bag | 419 | 4342 |
| male-original-shoulder-right-bag | 423 | 4341 |
| male-buzz-crossbody-left-bag | 418 | 4341 |
| male-rounded-crossbody-right-bag | 419 | 4340 |
| female-long-swept-purse-left-bag | 415 | 4340 |
| female-long-swept-purse-right-bag | 414 | 4340 |
| male-original-shoulder-left-bag | 419 | 4339 |
| male-rounded-crossbody-left-bag | 418 | 4339 |
| female-long-purse-left-bag | 415 | 4333 |
| female-long-purse-right-bag | 414 | 4333 |
| female-long-swept-shoulder-right-bag | 414 | 4318 |
| female-long-swept-shoulder-left-bag | 416 | 4316 |
| female-long-shoulder-right-bag | 414 | 4311 |
| female-long-shoulder-left-bag | 416 | 4309 |
| male-short-straight-no-bag | 411 | 4294 |
| male-short-straight-swapped-no-bag | 404 | 4292 |
| male-crew-straight-no-bag | 411 | 4285 |
| male-relaxed-straight-swapped-no-bag | 413 | 4281 |
| male-side-part-shoulder-right-bag | 415 | 4279 |
| male-quiff-shoulder-right-bag | 417 | 4279 |
| male-side-part-shoulder-left-bag | 411 | 4277 |
| male-quiff-shoulder-left-bag | 413 | 4277 |
| male-relaxed-straight-no-bag | 410 | 4277 |
| male-fitted-straight-no-bag | 410 | 4268 |
| male-original-no-bag | 409 | 4262 |
| male-crew-straight-swapped-no-bag | 408 | 4262 |
| male-swept-shoulder-right-bag | 415 | 4259 |
| male-swept-shoulder-left-bag | 413 | 4257 |
| female-long-swept-no-bag | 410 | 4231 |
| female-long-no-bag | 408 | 4224 |
| male-fitted-straight-swapped-no-bag | 404 | 4224 |
| male-short-wide-no-bag | 407 | 4217 |
| male-relaxed-wide-swapped-no-bag | 405 | 4215 |
| female-rounded-bob-purse-left-bag | 407 | 4210 |
| female-rounded-bob-purse-right-bag | 410 | 4210 |
| male-relaxed-wide-no-bag | 405 | 4209 |
| male-long-relaxed-no-bag | 410 | 4205 |
| male-side-part-no-bag | 403 | 4200 |
| male-quiff-no-bag | 403 | 4200 |
| female-rounded-bob-shoulder-right-bag | 404 | 4188 |
| female-rounded-bob-shoulder-left-bag | 404 | 4186 |
| male-swept-no-bag | 401 | 4180 |
| male-crop-shoulder-right-bag | 408 | 4180 |
| male-short-wide-swapped-no-bag | 400 | 4179 |
| male-crop-shoulder-left-bag | 406 | 4178 |
| female-lob-purse-left-bag | 395 | 4168 |
| female-lob-purse-right-bag | 398 | 4168 |
| female-bob-purse-left-bag | 395 | 4158 |
| female-bob-purse-right-bag | 396 | 4158 |
| female-angled-bob-purse-left-bag | 393 | 4156 |
| female-angled-bob-purse-right-bag | 396 | 4156 |
| female-side-part-bob-purse-left-bag | 395 | 4154 |
| female-side-part-bob-purse-right-bag | 396 | 4154 |
| female-shoulder-purse-left-bag | 399 | 4153 |
| female-shoulder-swept-purse-left-bag | 401 | 4153 |
| female-shoulder-purse-right-bag | 400 | 4153 |
| female-shoulder-swept-purse-right-bag | 402 | 4153 |
| female-cropped-bob-purse-left-bag | 395 | 4152 |
| female-cropped-bob-purse-right-bag | 396 | 4152 |
| male-crew-tapered-swapped-no-bag | 399 | 4152 |
| female-lob-shoulder-right-bag | 402 | 4146 |
| female-lob-shoulder-left-bag | 400 | 4144 |
| male-crew-tapered-no-bag | 402 | 4144 |
| male-long-relaxed-swapped-no-bag | 403 | 4144 |
| female-bob-shoulder-right-bag | 400 | 4136 |
| female-bob-shoulder-left-bag | 398 | 4134 |
| female-angled-bob-shoulder-right-bag | 400 | 4134 |
| female-angled-bob-shoulder-left-bag | 398 | 4132 |
| female-side-part-bob-shoulder-right-bag | 400 | 4132 |
| male-fitted-tapered-no-bag | 393 | 4132 |
| female-shoulder-shoulder-right-bag | 402 | 4131 |
| female-shoulder-swept-shoulder-right-bag | 406 | 4131 |
| female-side-part-bob-shoulder-left-bag | 398 | 4130 |
| female-cropped-bob-shoulder-right-bag | 400 | 4130 |
| female-shoulder-shoulder-left-bag | 404 | 4129 |
| female-shoulder-swept-shoulder-left-bag | 404 | 4129 |
| female-cropped-bob-shoulder-left-bag | 398 | 4128 |
| male-fitted-tapered-swapped-no-bag | 389 | 4128 |
| male-long-tapered-no-bag | 405 | 4105 |
| male-crop-no-bag | 389 | 4101 |
| female-rounded-bob-no-bag | 398 | 4101 |
| male-long-tapered-swapped-no-bag | 402 | 4089 |
| male-crew-shoulder-right-bag | 393 | 4076 |
| male-crew-shoulder-left-bag | 395 | 4074 |
| female-lob-no-bag | 392 | 4059 |
| female-bob-no-bag | 390 | 4049 |
| female-angled-bob-no-bag | 392 | 4047 |
| female-side-part-bob-no-bag | 390 | 4045 |
| female-shoulder-no-bag | 394 | 4044 |
| female-shoulder-swept-no-bag | 394 | 4044 |
| female-cropped-bob-no-bag | 390 | 4043 |
| female-straight-trousers-no-bag | 390 | 4040 |
| female-straight-trousers-swapped-no-bag | 393 | 4034 |
| male-buzz-shoulder-right-bag | 389 | 4033 |
| male-buzz-shoulder-left-bag | 389 | 4031 |
| male-rounded-shoulder-right-bag | 389 | 4031 |
| male-rounded-shoulder-left-bag | 389 | 4029 |
| male-crew-no-bag | 383 | 3997 |
| female-wide-trousers-swapped-no-bag | 384 | 3976 |
| female-wide-trousers-no-bag | 382 | 3960 |
| male-buzz-no-bag | 379 | 3954 |
| male-rounded-no-bag | 377 | 3952 |
| female-relaxed-trousers-no-bag | 377 | 3921 |
| female-relaxed-trousers-swapped-no-bag | 376 | 3900 |
| female-tapered-trousers-swapped-no-bag | 376 | 3830 |
| female-tapered-trousers-no-bag | 371 | 3821 |

Across all 232 variants, the atlas references **1,308,230 High / 123,928 Low**
triangles over the unchanged pool of **226,731 animated vertices**, 73 frames and
21 palette stops. Real Low rows range from **371 to 841 triangles**. The padded
Low row is `lowCorners` **2,523 corners**, versus 28,110 High corners. The prior
Low stride was 2,825 triangles; the new stride submits **70.2% fewer Low triangles**.

`passenger-lod` pins both 10% budgets, per-appearance vertex membership, flat
palette boundaries, all-frame extrema, quality/storey routing and shared disposal.
`node tools/check-passenger-lod.mjs` performs paired production GPU captures for
both eligible ages, all variants, all three gaits and three camera views; review
its worst silhouette pairs in ignored `.preview/perf/passenger-10pct/`.
`node tools/model-triangle-inventory.mjs` regenerates the table above. A full
`npm run bake:passengers` regenerates reviewed exports and the complete atlas;
for Low-policy-only changes, `node tools/bake-approved-passenger.mjs --low-only`
first verifies every export hash and then regenerates only Low topology fields.

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

Underfloor equipment refresh: cabinets, vented access panels, air reservoirs, suspension mounting brackets and cable conduits now fill the space between bogies. Deep upper bogie cheek frames, bolsters and broad air cushions close the former empty suspension gap; roof HVAC units retain a thin housing at Low. The train geometry inventory was regenerated with `node tools/model-triangle-inventory.mjs`; raw counts are in `.preview/perf/train-triangles.json`. The original roof height and platform floor are retained; original-size passenger doors occupy about half the wheel-to-roof height through a deeper rail bed and taller underfloor structure.

### Five-metre audit evidence (2026-10-19)

The current profile uses 0.98 uniform train scale, contact wire centre +3.903 m
(carbon +3.891 m), and a covered ceiling underside +4 m above the track anchor.
Loading preserves authored cells/modules. The complete normal suite passes
1,921 tests with zero skips; do not disable demo/scenario acceptance for a profile
change. Save scale normalization, nine restored checks, production WebGL work
counts, current inventory and first/repeated reported-save loading are recorded
in `game/PERFORMANCE.md`. Raw audit evidence is `.preview/perf/train-5m-audit/`.
The full instrumented geometry coverage attempt exceeded 11 minutes and was
stopped; focused percentages and normal-suite results are reported separately.
