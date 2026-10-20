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

Triangle counts below are for one model built from each palette option's default configuration. High is the full model geometry; Low uses the renderer's reduced geometry wherever that model part has a supported approximation, and keeps unsupported parts at full detail. These are model triangles, not totals across all placed copies. Width, length, style and material controls can create additional variants; the table lists the 119 shipped palette options.

#### Ambient road vehicles

Ambient road vehicles are seeded into the six models listed below. The counts are per
vehicle instance and include the colour geometry plus its matching depth-only prepass;
the prepass suppresses far-side fittings. High uses 70% opacity; Low vehicles and
Low passenger bodies use 45%. Low road vehicles stay at or below 25% of High's
submitted triangles (including the depth pass). Low is an
authored geometry variant selected by the game's Low graphics setting, not a runtime
simplification. Regenerate the production counts and front/rear captures with
`node tools/check-road-vehicles.mjs`; the ignored report and images are in
`.preview/road-vehicles/`. The app keeps only the active quality visible and packs
traffic into its matching instance buffers.

| Ambient road vehicle | Low triangles | High triangles |
|---|---:|---:|
| Guangzhou bus, pale/orange | 2,504 | 11,224 |
| Guangzhou bus, red mosaic | 2,666 | 11,506 |
| SUV | 1,232 | 5,136 |
| Sedan | 1,160 | 4,984 |
| Moped with rider | 1,120 | 7,120 |
| Step-through bicycle with rider | 1,960 | 8,160 |

Each Low model preserves the full variant's body outline, windows and required fittings
while reducing wheels, repeated rods, spokes, fender tessellation and bus-window mullions.
Low uses flat hexagonal hubs, four-corner body sections, coarse rounded fittings,
flat bus arch strips and LED segments; cars omit door handles and chrome belt strips.
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

Furniture/cabinets omit stock and fine fittings; vending drinks become thin colour
panels. Fences use four-sided tubes without clamps/feet fittings. Fare gates retain
reader/entry artwork and animated leaves. Exit Low retains openings, printed
headers and the wave profile, with thin roof/glass surfaces and fewer frame posts.
`panelModelDetail` retains two broad faces; approximation bounds include both full
and reduced shapes so combined fittings do not disappear at the screen edge.

Rail-signal Low keeps three eight-sided aspects/rims and coarse hood shells.
Noise barriers retain full posts and all bay/gantry cutouts, using two broad faces
per thin panel/middle rail. Top beams retain thickness with hidden end caps omitted;
the shared bridge builders also prepare these Low variants.

| Equipment / decor model name | Low triangles | High triangles |
|---||---:|---:|
| tree | 396 | 18432 |
| shelf-cooler | 420 | 9852 |
| shelf-cooler-dark | 420 | 9852 |
| bridge | 720 | 9576 |
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
| psd-end | 114 | 114 |
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
| D-8 | 129952 | 1303424 |
| D-6 | 104876 | 1008052 |
| A-8 | 166728 | 730512 |
| A-6 | 126140 | 574244 |
| C-6 | 112708 | 534888 |
| B-6 | 109376 | 513888 |
| L-6 | 96120 | 464576 |
| C-4 | 76640 | 395652 |
| B-4 | 74332 | 378236 |
| L-4 | 65260 | 344492 |

The shared `TrainBogie.ts` wheelsets, sculpted frames, suspension and brakes are included in these regenerated counts; Low keeps profiled eight-sided wheels and omits coils, bolts, pipes and dampers.

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

The interior carries most of the reduction for A/B/C/L: hanging straps, seat-end
handrails and centre poles become four-sided tubes on a six-segment path, ring lights
a twelve-sided torus, benches and seat-end guards a single envelope. D is the
Guangzhou 18/22 reference and the outlier: its streamlined cab and plug doors are
lofted surfaces, and their Low sampling — four door panels from 12×64 to 3×8, the cab
shell from 64×128 to 16×32, the bellows from 32×128 to 8×16 — is what takes D-8 from
1,303,040 to 129,856 triangles (10.0 % retained). D-6 draws 1,007,764 High / 104,804 Low
(10.4 % retained). The shipped 动物园 Line 5 runs **L-6**.

Train parts are authored in their builders (`render/modelDetail.ts`); `batchStaticParts`
merges both variants so a batch carries its own Low geometry, and the door banks and
sorted-glass batches reserve theirs when they are built. A part with no authored
variant may fall back to the bounded-error simplifier only inside
`TRAIN_DETAIL_MAX_RADIUS` — a merged car spans a whole consist, and 2 % of that is
metres. Preparing both variants costs roughly 10 % (D) to 30 % (B/C) more on a
consist's first build, once per cached configuration (eight are kept).

### Passenger models (乘客)

One row per reviewed appearance in the baked crowd atlas
(`game/src/assets/passenger-approved.json`, drawn as prepared instanced draws — no
per-agent GLB or skeleton). High is the padded shared stride a full-detail passenger
submits; Low is the atlas's baked Low topology (§9.3): a second index table over the
*same* animated vertex pool, simplified from the standing pose and padded to the same
shared stride. Both draws sample one pose/normal/region atlas, so nothing is
duplicated but the geometry and index table. Each packed instance records its storey
in `passengerLevel`, and the renderer packs each drawn passenger into the topology its
storey asks for: 高画质 draws the edited storey full and a ghosted storey reduced,
低画质 draws the whole crowd reduced, 隐藏UI restores full bodies. A crowd that shares
the edited storey is one draw; a ghosted storey's crowd adds a second. Counts are each
variant's own topology, recorded in the atlas `library` as `triangles` and
`lowTriangles`; the shared padded stride the crowd actually submits is 9,370 full and
2,825 Low. High bodies use 70% opacity; Low bodies use 45%, including Low bodies
on ghosted storeys in High quality. Hide UI restores full bodies and 70% opacity.

| Passenger model | Low triangles | High triangles |
|---||---:|---:|
| male-original-bag | 2547 | 9370 |
| male-short-bag | 2825 | 9314 |
| male-bald-bag | 2817 | 9296 |
| male-short-small-bag | 2600 | 8872 |
| male-short-standard-87.5-bag | 2649 | 8867 |
| male-bald-small-bag | 2598 | 8854 |
| male-bald-standard-87.5-bag | 2643 | 8849 |
| male-short-standard-75-bag | 2664 | 8832 |
| male-bald-standard-75-bag | 2660 | 8814 |
| male-side-part-bag | 2429 | 8772 |
| male-quiff-bag | 2441 | 8772 |
| male-swept-bag | 2449 | 8752 |
| male-crop-bag | 2430 | 8673 |
| female-rounded-bob-bag | 2749 | 8636 |
| female-lob-bag | 2735 | 8594 |
| female-bob-bag | 2741 | 8584 |
| female-angled-bob-bag | 2737 | 8582 |
| female-side-part-bob-bag | 2733 | 8580 |
| female-shoulder-bag | 2639 | 8579 |
| female-shoulder-swept-bag | 2626 | 8579 |
| female-cropped-bob-bag | 2745 | 8578 |
| male-crew-bag | 2423 | 8569 |
| male-buzz-bag | 2443 | 8526 |
| male-rounded-bag | 2415 | 8524 |
| male-original-small-bag | 2255 | 8425 |
| male-original-standard-87.5-bag | 2261 | 8409 |
| male-original-standard-75-bag | 2286 | 8389 |
| male-side-part-small-bag | 2249 | 8363 |
| male-quiff-small-bag | 2244 | 8363 |
| male-side-part-standard-87.5-bag | 2258 | 8347 |
| male-quiff-standard-87.5-bag | 2254 | 8347 |
| male-swept-small-bag | 2247 | 8343 |
| male-swept-standard-87.5-bag | 2287 | 8327 |
| male-side-part-standard-75-bag | 2280 | 8327 |
| male-quiff-standard-75-bag | 2273 | 8327 |
| male-swept-standard-75-bag | 2269 | 8307 |
| female-rounded-bob-small-bag | 2573 | 8269 |
| male-crop-small-bag | 2227 | 8264 |
| male-crop-standard-87.5-bag | 2253 | 8248 |
| female-rounded-bob-standard-87.5-bag | 2596 | 8241 |
| female-rounded-bob-standard-75-bag | 2575 | 8235 |
| male-crop-standard-75-bag | 2272 | 8228 |
| female-lob-small-bag | 2567 | 8227 |
| female-bob-small-bag | 2569 | 8217 |
| female-angled-bob-small-bag | 2575 | 8215 |
| female-side-part-bob-small-bag | 2573 | 8213 |
| female-shoulder-small-bag | 2473 | 8212 |
| female-shoulder-swept-small-bag | 2457 | 8212 |
| female-cropped-bob-small-bag | 2569 | 8211 |
| female-lob-standard-87.5-bag | 2587 | 8199 |
| female-lob-standard-75-bag | 2563 | 8193 |
| female-bob-standard-87.5-bag | 2591 | 8189 |
| female-angled-bob-standard-87.5-bag | 2593 | 8187 |
| female-side-part-bob-standard-87.5-bag | 2595 | 8185 |
| female-shoulder-standard-87.5-bag | 2495 | 8184 |
| female-shoulder-swept-standard-87.5-bag | 2484 | 8184 |
| female-cropped-bob-standard-87.5-bag | 2597 | 8183 |
| female-bob-standard-75-bag | 2567 | 8183 |
| female-angled-bob-standard-75-bag | 2569 | 8181 |
| female-side-part-bob-standard-75-bag | 2569 | 8179 |
| female-shoulder-standard-75-bag | 2477 | 8178 |
| female-shoulder-swept-standard-75-bag | 2461 | 8178 |
| female-cropped-bob-standard-75-bag | 2567 | 8177 |
| male-crew-small-bag | 2242 | 8160 |
| male-crew-standard-87.5-bag | 2266 | 8144 |
| male-crew-standard-75-bag | 2276 | 8124 |
| male-buzz-small-bag | 2253 | 8117 |
| male-rounded-small-bag | 2232 | 8115 |
| male-buzz-standard-87.5-bag | 2270 | 8101 |
| male-rounded-standard-87.5-bag | 2263 | 8099 |
| male-buzz-standard-75-bag | 2283 | 8081 |
| male-rounded-standard-75-bag | 2263 | 8079 |
| female-midi-pleated-swapped-no-bag | 1398 | 5832 |
| female-long-a-line-swapped-no-bag | 1397 | 5806 |
| female-long-pleated-swapped-no-bag | 1397 | 5805 |
| female-midi-pleated-no-bag | 1400 | 5802 |
| female-midi-a-line-swapped-no-bag | 1396 | 5785 |
| female-long-a-line-no-bag | 1397 | 5775 |
| female-long-pleated-no-bag | 1400 | 5775 |
| female-midi-a-line-no-bag | 1399 | 5773 |
| female-full-pleated-swapped-no-bag | 1399 | 5771 |
| female-full-pleated-no-bag | 1398 | 5770 |
| female-slim-long-skirt-no-bag | 1394 | 5749 |
| female-slim-long-skirt-swapped-no-bag | 1400 | 5718 |
| male-short-crossbody-right-bag | 1398 | 5071 |
| male-short-crossbody-left-bag | 1400 | 5070 |
| male-bald-crossbody-right-bag | 1398 | 5053 |
| male-bald-crossbody-left-bag | 1399 | 5052 |
| male-short-shoulder-right-bag | 1397 | 4764 |
| male-short-shoulder-left-bag | 1399 | 4762 |
| male-bald-shoulder-right-bag | 1396 | 4746 |
| male-bald-shoulder-left-bag | 1399 | 4744 |
| male-short-no-bag | 1400 | 4705 |
| male-bald-no-bag | 1400 | 4687 |
| male-original-crossbody-right-bag | 1400 | 4650 |
| male-original-crossbody-left-bag | 1400 | 4649 |
| female-long-swept-crossbody-right-bag | 1392 | 4612 |
| female-long-swept-crossbody-left-bag | 1392 | 4611 |
| female-long-crossbody-right-bag | 1392 | 4605 |
| female-long-crossbody-left-bag | 1393 | 4604 |
| male-side-part-crossbody-right-bag | 1397 | 4588 |
| male-quiff-crossbody-right-bag | 1400 | 4588 |
| male-side-part-crossbody-left-bag | 1400 | 4587 |
| male-quiff-crossbody-left-bag | 1400 | 4587 |
| male-swept-crossbody-right-bag | 1390 | 4568 |
| male-swept-crossbody-left-bag | 1399 | 4567 |
| male-crop-crossbody-right-bag | 1400 | 4489 |
| male-crop-crossbody-left-bag | 1398 | 4488 |
| female-rounded-bob-crossbody-right-bag | 1392 | 4482 |
| female-rounded-bob-crossbody-left-bag | 1394 | 4481 |
| female-lob-crossbody-right-bag | 1392 | 4440 |
| female-lob-crossbody-left-bag | 1393 | 4439 |
| female-bob-crossbody-right-bag | 1392 | 4430 |
| female-bob-crossbody-left-bag | 1392 | 4429 |
| female-angled-bob-crossbody-right-bag | 1393 | 4428 |
| female-angled-bob-crossbody-left-bag | 1393 | 4427 |
| female-side-part-bob-crossbody-right-bag | 1392 | 4426 |
| female-side-part-bob-crossbody-left-bag | 1392 | 4425 |
| female-shoulder-crossbody-right-bag | 1396 | 4425 |
| female-shoulder-swept-crossbody-right-bag | 1396 | 4425 |
| female-shoulder-crossbody-left-bag | 1395 | 4424 |
| female-shoulder-swept-crossbody-left-bag | 1396 | 4424 |
| female-cropped-bob-crossbody-right-bag | 1391 | 4424 |
| female-cropped-bob-crossbody-left-bag | 1392 | 4423 |
| male-crew-crossbody-right-bag | 1399 | 4385 |
| male-crew-crossbody-left-bag | 1399 | 4384 |
| male-buzz-crossbody-right-bag | 1400 | 4342 |
| male-original-shoulder-right-bag | 1400 | 4341 |
| male-buzz-crossbody-left-bag | 1392 | 4341 |
| male-rounded-crossbody-right-bag | 1390 | 4340 |
| female-long-swept-purse-left-bag | 1398 | 4340 |
| female-long-swept-purse-right-bag | 1397 | 4340 |
| male-original-shoulder-left-bag | 1399 | 4339 |
| male-rounded-crossbody-left-bag | 1390 | 4339 |
| female-long-purse-left-bag | 1400 | 4333 |
| female-long-purse-right-bag | 1399 | 4333 |
| female-long-swept-shoulder-right-bag | 1399 | 4318 |
| female-long-swept-shoulder-left-bag | 1395 | 4316 |
| female-long-shoulder-right-bag | 1392 | 4311 |
| female-long-shoulder-left-bag | 1393 | 4309 |
| male-short-straight-no-bag | 1397 | 4294 |
| male-short-straight-swapped-no-bag | 1396 | 4292 |
| male-crew-straight-no-bag | 1400 | 4285 |
| male-relaxed-straight-swapped-no-bag | 1399 | 4281 |
| male-side-part-shoulder-right-bag | 1399 | 4279 |
| male-quiff-shoulder-right-bag | 1400 | 4279 |
| male-side-part-shoulder-left-bag | 1400 | 4277 |
| male-quiff-shoulder-left-bag | 1399 | 4277 |
| male-relaxed-straight-no-bag | 1399 | 4277 |
| male-fitted-straight-no-bag | 1400 | 4268 |
| male-original-no-bag | 1400 | 4262 |
| male-crew-straight-swapped-no-bag | 1400 | 4262 |
| male-swept-shoulder-right-bag | 1400 | 4259 |
| male-swept-shoulder-left-bag | 1400 | 4257 |
| female-long-swept-no-bag | 1397 | 4231 |
| female-long-no-bag | 1397 | 4224 |
| male-fitted-straight-swapped-no-bag | 1397 | 4224 |
| male-short-wide-no-bag | 1393 | 4217 |
| male-relaxed-wide-swapped-no-bag | 1398 | 4215 |
| female-rounded-bob-purse-left-bag | 1400 | 4210 |
| female-rounded-bob-purse-right-bag | 1399 | 4210 |
| male-relaxed-wide-no-bag | 1398 | 4209 |
| male-long-relaxed-no-bag | 1400 | 4205 |
| male-side-part-no-bag | 1398 | 4200 |
| male-quiff-no-bag | 1400 | 4200 |
| female-rounded-bob-shoulder-right-bag | 1392 | 4188 |
| female-rounded-bob-shoulder-left-bag | 1397 | 4186 |
| male-swept-no-bag | 1399 | 4180 |
| male-crop-shoulder-right-bag | 1399 | 4180 |
| male-short-wide-swapped-no-bag | 1399 | 4179 |
| male-crop-shoulder-left-bag | 1399 | 4178 |
| female-lob-purse-left-bag | 1399 | 4168 |
| female-lob-purse-right-bag | 1400 | 4168 |
| female-bob-purse-left-bag | 1399 | 4158 |
| female-bob-purse-right-bag | 1399 | 4158 |
| female-angled-bob-purse-left-bag | 1399 | 4156 |
| female-angled-bob-purse-right-bag | 1399 | 4156 |
| female-side-part-bob-purse-left-bag | 1397 | 4154 |
| female-side-part-bob-purse-right-bag | 1396 | 4154 |
| female-shoulder-purse-left-bag | 1399 | 4153 |
| female-shoulder-swept-purse-left-bag | 1394 | 4153 |
| female-shoulder-purse-right-bag | 1399 | 4153 |
| female-shoulder-swept-purse-right-bag | 1399 | 4153 |
| female-cropped-bob-purse-left-bag | 1397 | 4152 |
| female-cropped-bob-purse-right-bag | 1400 | 4152 |
| male-crew-tapered-swapped-no-bag | 1398 | 4152 |
| female-lob-shoulder-right-bag | 1392 | 4146 |
| female-lob-shoulder-left-bag | 1396 | 4144 |
| male-crew-tapered-no-bag | 1400 | 4144 |
| male-long-relaxed-swapped-no-bag | 1389 | 4144 |
| female-bob-shoulder-right-bag | 1391 | 4136 |
| female-bob-shoulder-left-bag | 1399 | 4134 |
| female-angled-bob-shoulder-right-bag | 1390 | 4134 |
| female-angled-bob-shoulder-left-bag | 1393 | 4132 |
| female-side-part-bob-shoulder-right-bag | 1391 | 4132 |
| male-fitted-tapered-no-bag | 1400 | 4132 |
| female-shoulder-shoulder-right-bag | 1399 | 4131 |
| female-shoulder-swept-shoulder-right-bag | 1397 | 4131 |
| female-side-part-bob-shoulder-left-bag | 1397 | 4130 |
| female-cropped-bob-shoulder-right-bag | 1391 | 4130 |
| female-shoulder-shoulder-left-bag | 1397 | 4129 |
| female-shoulder-swept-shoulder-left-bag | 1388 | 4129 |
| female-cropped-bob-shoulder-left-bag | 1397 | 4128 |
| male-fitted-tapered-swapped-no-bag | 1398 | 4128 |
| male-long-tapered-no-bag | 1400 | 4105 |
| male-crop-no-bag | 1399 | 4101 |
| female-rounded-bob-no-bag | 1399 | 4101 |
| male-long-tapered-swapped-no-bag | 1396 | 4089 |
| male-crew-shoulder-right-bag | 1400 | 4076 |
| male-crew-shoulder-left-bag | 1398 | 4074 |
| female-lob-no-bag | 1397 | 4059 |
| female-bob-no-bag | 1398 | 4049 |
| female-angled-bob-no-bag | 1398 | 4047 |
| female-side-part-bob-no-bag | 1397 | 4045 |
| female-shoulder-no-bag | 1400 | 4044 |
| female-shoulder-swept-no-bag | 1396 | 4044 |
| female-cropped-bob-no-bag | 1398 | 4043 |
| female-straight-trousers-no-bag | 1400 | 4040 |
| female-straight-trousers-swapped-no-bag | 1395 | 4034 |
| male-buzz-shoulder-right-bag | 1400 | 4033 |
| male-buzz-shoulder-left-bag | 1400 | 4031 |
| male-rounded-shoulder-right-bag | 1395 | 4031 |
| male-rounded-shoulder-left-bag | 1400 | 4029 |
| male-crew-no-bag | 1400 | 3997 |
| female-wide-trousers-swapped-no-bag | 1399 | 3976 |
| female-wide-trousers-no-bag | 1399 | 3960 |
| male-buzz-no-bag | 1400 | 3954 |
| male-rounded-no-bag | 1399 | 3952 |
| female-relaxed-trousers-no-bag | 1398 | 3921 |
| female-relaxed-trousers-swapped-no-bag | 1398 | 3900 |
| female-tapered-trousers-swapped-no-bag | 1399 | 3830 |
| female-tapered-trousers-no-bag | 1400 | 3821 |

Across all 232 variants the atlas references 1,308,230 full triangles and
401,778 Low triangles over a shared pool of 226,731 animated vertices (73 pose frames,
21 palette stops); per-variant topology (2,450–7,279 vertices) deduplicates by matching
colour, position and normal in every pose. The Low table keeps the same pool: a padded
Low row is `lowCorners` 8,475 corners (2,825 triangles) and 1,388–2,825 real triangles
per variant — 30 % of the full stride, its vertices and its triangle work.
`passenger-library` and `passenger-lod` pin the eligibility pools, topology budgets and
the switch, and the atlas `library` array is the authoritative per-variant record.

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
