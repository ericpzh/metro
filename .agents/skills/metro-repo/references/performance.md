# Performance reference

This is the current measured state and engineering contract, not a run diary.
Replace superseded values in place. Keep raw reports with source hashes and
hardware metadata outside this document. Do not describe unmatched workloads as
a speedup, or an older measurement as validation of newer code.
Record findings only when they answer a performance question or change a budget
or benchmark procedure. Functional fixes, test coverage and incidental durations
belong in their owning code, tests or reports, not in this reference.

## Reproduce the reported interaction

Measure from the first real input through visible feedback, including cold work.
Keep preview work separate from document commits. Preserve accepted/refused
outcomes.

## Current performance state

### Response budget and placement state

Editor feedback targets strictly <100 ms; exactly 100 ms misses. Renderer
submission, two-RAF response, GPU completion and physical display are different
boundaries. Measure worker installation separately. Large synchronous commits,
cold renderer preparation and structural worker rebuilds remain costs to measure.

The complete current action records live in
[editor-action-matrix.md](editor-action-matrix.md) and
[editor-action-matrix.jsonl](editor-action-matrix.jsonl). Do not duplicate older
case tables here. Keep failures, refusals and unsupported actions separate.

### City style selection

Latest available production observation: source `85d6fe412d63e2ba3a990e3373eba65b0c6d40a6397a587e86e82838bc31b6c6`, raw evidence at
`.preview/city-styles/current-audit/`. i7-14700KF / RTX 4080 SUPER, ANGLE D3D11,
High quality, paused normal opening view, 1440 × 1000 window, 892 × 815 canvas,
pixel ratio 1. This High-quality capture predates the Low-only simplifications
in the inventories below and does not validate their GPU cost.

The checker uses DOM `.click()` on popover tiles and ends at first render
submission. It does not measure actual pointer latency or GPU/display completion.
One observation per transition, starting each demo in Guangzhou, with no concurrent
builds, tests or profiles. No percentile or controlled speedup is claimed.

| Demo | First Shenzhen | Return Guangzhou | Repeat Shenzhen |
| --- | --- | --- | --- |
| zoo | 490.0 ms | 88.1 ms | 313.2 ms |
| tanwei | 789.2 ms | 228.0 ms | 743.5 ms |

Five of six observations miss the target. Both demos retain train roots/textures,
perform zero chunk remeshes/raycasts, and send only population patches. Costs
remain unprofiled.

City poster images decode on demand per selected city and share pending requests;
Beijing's 6564 × 6537 source is kept whole and is not decoded when opening another
city.

Chongqing production observation (2026-11-04): source
`c0e862b5f777e8971a65d6d90899ab4126a306b98f3f6a2110f6256e1e999ae9`, raw evidence
at `.preview/city-styles/chongqing-browser/report.json`. i7-14700KF / RTX 4080
SUPER, ANGLE D3D11, paused normal view, 1440 × 1000 window, 892 × 815 canvas,
pixel ratio 1. Fixture: one covered exit, virtual exit, guidepost, wall/standing
maps, doorway and four prepared B consists for two lines. One Guangzhou →
Chongqing DOM tile click took **155.5 ms to first render submission**, missing the
strict <100 ms target. This single observation is not a percentile, real-pointer
latency or GPU/display completion measurement. No concurrent builds/tests/profiles
ran during capture. It retained train roots and badge textures and performed zero
chunk remeshes/raycasts, and the capture does not attribute the remaining cost.

## Per-model geometry detail inventory

Actual generated counts, not station totals or FPS estimates. Equipment counts
include visible source/instanced geometry and authored Low; train counts include
static, door and transparent batching; passenger counts come from the baked atlas.
Counts exclude textures and do not establish a draw-call or GPU-time pass.

### Equipment and decor

Palette inventories were refreshed with
`node tools/model-triangle-inventory.mjs` using production builders and authored
Low geometry. Counts are geometry inventory, not frame-time measurements.

Default Guangzhou catalogue. Shared limits live in
`tools/equipment-low-budgets.mjs`: strict <10% unless an explicit minimum-shape
exception applies. Never raise a limit to conceal a regression.

Inventory refreshed 2026-11-06 with `BENCH_OUTPUT=.preview/perf/ballfields/report.json
node tools/model-triangle-inventory.mjs` (three.js r186); raw counts are in
`.preview/perf/ballfields/model-triangles.json`, with source hashes in
`.preview/perf/ballfields/source-hashes.json`. Ballfields use 88/192 triangles
(pickleball), 100/228 (badminton) and 52/132 (portable divider), Low/High. The open
nets use line primitives in addition: 129 segments for pickleball and 127 for
badminton. These are geometry counts, not drag latency, draw-call or GPU-time
measurements.

Seating inventory refreshed 2026-11-06 with `BENCH_OUTPUT=.preview/perf/seating/report.json node tools/model-triangle-inventory.mjs` (three.js r186). Raw counts: `.preview/perf/seating/model-triangles.json`. Both new palette options meet the strict <10% triangle budget. These are generated geometry counts, not frame-time measurements.

Tactile trim inventory refreshed 2026-11-07 with `BENCH_OUTPUT=.preview/perf/tactile-strip/report.json INVENTORY_REPORT_ONLY=1 node tools/model-triangle-inventory.mjs` (three.js r186). 圆点提示条 (`tactile-warning-strip`) is 4 / 1932 Low/High: Low keeps the one-metre top sheet and omits its 60 instanced dots, while High adds 32 triangles per dot. A crosswise junction arm adds one sheet and 15 dots, giving 8 / 2424 with one arm and 12 / 2916 with two. Raw counts: `.preview/perf/tactile-strip/model-triangles.json`.

| Equipment / decor model name | Low triangles | High triangles |
|---|---:|---:|
| tree | 396 | 18432 |
| shelf-cooler | 420 | 9852 |
| shelf-cooler-dark | 420 | 9852 |
| bridge | 720 | 9576 |
| checkout-cafe-pastry/4m | 116 | 8620 |
| shelf-cafe-backbar-4 | 136 | 8488 |
| shelf-white-tall | 240 | 7556 |
| shelf-dark-tall | 240 | 7244 |
| shelf-fruit-island | 364 | 7100 |
| urinal | 648 | 6880 |
| shelf-wire | 412 | 6524 |
| checkout-cafe-pastry/3m | 108 | 6332 |
| shelf-food-bakery | 80 | 5884 |
| shelf-books | 64 | 5808 |
| cubicle | 72 | 5688 |
| shelf-fruit-tiered | 384 | 5672 |
| cctv-dome | 336 | 5208 |
| walkway | 290 | 5162 |
| cctv-post | 352 | 5096 |
| shelf-bags | 116 | 5048 |
| sink | 224 | 4972 |
| cctv-ptz | 308 | 4924 |
| shelf-white-short | 192 | 4420 |
| checkout-cafe-pastry/2m | 100 | 4044 |
| shelf-cafe-backbar-2 | 100 | 3712 |
| escalator | 204 | 3410 |
| cubicle-toilet | 256 | 3052 |
| shelf-cafe-backbar | 116 | 2944 |
| ac-unit | 140 | 2924 |
| shelf-clothing-shoes | 40 | 2724 |
| stair-leftForward | 232 | 2336 |
| stair-rightForward | 232 | 2336 |
| stair-left180 | 222 | 2288 |
| stair-right180 | 222 | 2288 |
| stair-centerForward | 212 | 2240 |
| stair-left90 | 212 | 2240 |
| stair-right90 | 212 | 2240 |
| checkout-cafe/4m | 100 | 1972 |
| clock | 188 | 1940 |
| stair-straight | 150 | 1940 |
| tactile-warning-strip | 4 | 1932 |
| cctv | 124 | 1888 |
| shelf-food-snacks | 80 | 1884 |
| lift | 144 | 1776 |
| checkout-cafe-pastry | 92 | 1756 |
| checkout-cafe/3m | 92 | 1684 |
| fence-steel-blue | 94 | 1668 |
| checkout-cafe/2m | 84 | 1396 |
| shelf-clothing-wall | 44 | 1372 |
| electrical-cabinet | 36 | 1224 |
| checkout-cafe | 60 | 928 |
| extinguisher-glass | 86 | 918 |
| exit-covered-1 | 68 | 902 |
| exit | 68 | 902 |
| exit-covered-3 | 68 | 902 |
| shelf-ice-cream | 68 | 900 |
| roof-canopy | 56 | 840 |
| tactile-warning | 4 | 812 |
| fence-iron | 72 | 768 |
| checkout/2m | 68 | 762 |
| checkout/3m | 68 | 762 |
| checkout/4m | 68 | 762 |
| checkout | 64 | 750 |
| shelf-clothing-table | 48 | 732 |
| gate-new | 68 | 720 |
| rail-signal | 64 | 708 |
| shelf-clothing-rail | 48 | 680 |
| vending | 40 | 676 |
| gate | 64 | 668 |
| desk | 60 | 652 |
| pillar-thick | 48 | 576 |
| exit-uncovered-2 | 52 | 554 |
| exit-uncovered-3 | 52 | 554 |
| exit-uncovered-1 | 52 | 530 |
| fence-gate | 38 | 432 |
| roof-tapered | 38 | 396 |
| tvm | 30 | 372 |
| busstop-long | 30 | 372 |
| fence | 26 | 360 |
| bench-office-1 | 16 | 360 |
| checkout-generic/4m | 28 | 352 |
| door-steel-1 | 20 | 324 |
| door-glass-1 | 18 | 324 |
| checkout-generic/3m | 28 | 304 |
| roof-truss | 26 | 264 |
| busstop-short | 24 | 260 |
| checkout-generic/2m | 28 | 256 |
| light-circular | 18 | 256 |
| court-badminton | 100 | 228 |
| monitor-wall | 8 | 213 |
| checkout-generic | 28 | 208 |
| lawn | 12 | 204 |
| bin | 26 | 196 |
| court-pickleball | 88 | 192 |
| bench-wood-1 | 14 | 180 |
| vent | 32 | 168 |
| bench-seat-1 | 20 | 156 |
| extinguisher | 12 | 146 |
| extinguisher-compact | 12 | 146 |
| door-wood-1 | 20 | 144 |
| court-divider | 52 | 132 |
| sidewalk | 12 | 132 |
| tv-double | 28 | 132 |
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
| stair-block | 34 | 48 |
| linemap-stand | 16 | 40 |
| hanger-roof | 6 | 36 |
| hanger-post | 14 | 36 |
| pillar-slim | 16 | 36 |
| billboard-wide | 4 | 26 |
| billboard-standard | 4 | 26 |
| billboard-large | 4 | 26 |
| billboard-panorama | 4 | 26 |
| billboard-portrait | 4 | 26 |
| billboard-square | 4 | 26 |
| billboard-16x9-3m | 4 | 26 |
| billboard-16x9-4m | 4 | 26 |
| billboard-4x3-3m | 4 | 26 |
| billboard-4x3-4m | 4 | 26 |
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

#### Shenzhen variants

| Equipment / decor model name | Low triangles | High triangles |
|---|---:|---:|
| exit-covered-1 | 168 | 1716 |
| exit | 168 | 1716 |
| exit-covered-3 | 168 | 1716 |
| guidepost | 40 | 1604 |
| exit-virtual | 40 | 1604 |
| exit-uncovered-2 | 52 | 554 |
| exit-uncovered-3 | 52 | 554 |
| exit-uncovered-1 | 52 | 530 |
| linemap-stand | 16 | 40 |
| linemap-wall | 4 | 26 |
| exit-doorway-1 | 10 | 26 |
| exit-doorway-2 | 10 | 26 |
| exit-doorway-3 | 10 | 26 |
| exit-doorway-4 | 10 | 26 |

All 14 Shenzhen variants meet the existing budgets; no limit was raised.

#### Shanghai variants

All 14 Shanghai variants meet the same budgets.
Records: `.preview/perf/current-models-shanghai/model-triangles.json`.

| Equipment / decor model name | Low triangles | High triangles |
|---|---:|---:|
| exit-covered-1 | 124 | 1518 |
| exit | 124 | 1518 |
| exit-covered-3 | 124 | 1518 |
| exit-uncovered-2 | 52 | 554 |
| exit-uncovered-3 | 52 | 554 |
| exit-uncovered-1 | 52 | 530 |
| guidepost | 36 | 164 |
| exit-virtual | 36 | 164 |
| linemap-stand | 16 | 40 |
| linemap-wall | 4 | 26 |
| exit-doorway-1 | 10 | 26 |
| exit-doorway-2 | 10 | 26 |
| exit-doorway-3 | 10 | 26 |
| exit-doorway-4 | 10 | 26 |


#### Beijing variants

All 14 Beijing variants pass the existing budgets; no limit was raised.
Records: `.preview/perf/current-models-beijing/model-triangles.json`.

| Equipment / decor model name | Low triangles | High triangles |
|---|---:|---:|
| exit-covered-1 | 154 | 1542 |
| exit | 154 | 1542 |
| exit-covered-3 | 154 | 1542 |
| exit-uncovered-2 | 52 | 554 |
| exit-uncovered-3 | 52 | 554 |
| exit-uncovered-1 | 52 | 530 |
| guidepost | 44 | 164 |
| exit-virtual | 44 | 164 |
| linemap-stand | 16 | 40 |
| linemap-wall | 4 | 26 |
| exit-doorway-1 | 10 | 26 |
| exit-doorway-2 | 10 | 26 |
| exit-doorway-3 | 10 | 26 |
| exit-doorway-4 | 10 | 26 |

#### Chengdu variants

All 14 Chengdu variants pass the existing budgets; no limit was raised. Counts
do not establish FPS or GPU cost. Records:
`.preview/perf/model-triangles.json`.

| Equipment / decor model name | Low triangles | High triangles |
|---|---:|---:|
| exit-covered-1 | 362 | 8706 |
| exit | 362 | 8706 |
| exit-covered-3 | 362 | 8706 |
| exit-uncovered-2 | 52 | 554 |
| exit-uncovered-3 | 52 | 554 |
| exit-uncovered-1 | 52 | 530 |
| guidepost | 49 | 50 |
| exit-virtual | 41 | 50 |
| linemap-stand | 16 | 40 |
| linemap-wall | 4 | 26 |
| exit-doorway-1 | 10 | 26 |
| exit-doorway-2 | 10 | 26 |
| exit-doorway-3 | 10 | 26 |
| exit-doorway-4 | 10 | 26 |

#### Chongqing variants

Production-path inventory (three.js r186, `MODEL_CITY=chongqing`):
`.preview/perf/current-models-chongqing/model-triangles.json`. All 14 Chongqing
variants meet the existing budgets; no limit was raised. These counts do not
establish FPS or GPU cost.

| Equipment / decor model name | Low triangles | High triangles |
|---|---:|---:|
| exit-covered-1 | 222 | 2350 |
| exit | 222 | 2350 |
| exit-covered-3 | 222 | 2350 |
| guidepost | 46 | 1940 |
| exit-virtual | 46 | 1940 |
| exit-uncovered-2 | 52 | 554 |
| exit-uncovered-3 | 52 | 554 |
| exit-uncovered-1 | 52 | 530 |
| linemap-stand | 16 | 40 |
| linemap-wall | 4 | 26 |
| exit-doorway-1 | 10 | 26 |
| exit-doorway-2 | 10 | 26 |
| exit-doorway-3 | 10 | 26 |
| exit-doorway-4 | 10 | 26 |

#### Wuhan variants

Production-path inventory (three.js r186):
`.preview/perf/current-models-wuhan/model-triangles.json`, generated with
`MODEL_CITY=wuhan BENCH_OUTPUT=.preview/perf/current-models-wuhan/report.json node tools/model-triangle-inventory.mjs`.
All 14 Wuhan variants meet existing budgets. These are geometry counts, not FPS
measurements.

| Equipment / decor model name | Low triangles | High triangles |
|---|---:|---:|
| exit-covered-3 | 102 | 4982 |
| exit | 102 | 4634 |
| exit-covered-1 | 102 | 4322 |
| guidepost | 40 | 1204 |
| exit-virtual | 40 | 1204 |
| exit-uncovered-2 | 52 | 554 |
| exit-uncovered-3 | 52 | 554 |
| exit-uncovered-1 | 52 | 530 |
| linemap-stand | 16 | 40 |
| linemap-wall | 4 | 26 |
| exit-doorway-1 | 10 | 26 |
| exit-doorway-2 | 10 | 26 |
| exit-doorway-3 | 10 | 26 |
| exit-doorway-4 | 10 | 26 |

#### Nanjing variants

Production-path inventory (three.js r186):
`.preview/perf/current-models-nanjing/model-triangles.json`, generated with
`MODEL_CITY=nanjing` and `tools/model-triangle-inventory.mjs`. All 14 Nanjing
variants meet existing budgets; counts do not establish FPS.

| Equipment / decor model name | Low triangles | High triangles |
|---|---:|---:|
| exit-covered-1 | 374 | 3818 |
| exit | 374 | 3818 |
| exit-covered-3 | 374 | 3818 |
| guidepost | 16 | 592 |
| exit-virtual | 16 | 592 |
| exit-uncovered-2 | 52 | 554 |
| exit-uncovered-3 | 52 | 554 |
| exit-uncovered-1 | 52 | 530 |
| linemap-stand | 16 | 40 |
| linemap-wall | 4 | 26 |
| exit-doorway-1 | 10 | 26 |
| exit-doorway-2 | 10 | 26 |
| exit-doorway-3 | 10 | 26 |
| exit-doorway-4 | 10 | 26 |

#### Equipment minimum-shape exceptions

| Equipment / decor model name | Low / High | Minimum-shape exception |
|---|---:|---:|
| cubicle-toilet | 1712 / 3052 |  |
| bin | 26 / 196 | Two open hoppers, outer cabinet faces, dark wells and sorting label. |
| vent | 32 / 168 | Frame, dark duct and three louver strips visible above and below. |
| bench-seat-1 | 20 / 156 | Seat and back surfaces plus two supports. |
| door-wood-1 | 20 / 144 | Four frame members and a two-sided leaf. |
| tv-double | 28 / 132 | Two back-to-back TV screens with shared housing and suspension. |
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
| stair-block | 34 / 48 | All four solid treads, exposed risers and closed side silhouette. |
| billboard-wide | 4 / 26 | Original cropped artwork and frame surface. |
| billboard-standard | 4 / 26 | Original cropped artwork and frame surface. |
| billboard-large | 4 / 26 | Original cropped artwork and frame surface. |
| billboard-panorama | 4 / 26 | Original cropped artwork and frame surface. |
| billboard-portrait | 4 / 26 | Original cropped artwork and frame surface. |
| billboard-square | 4 / 26 | Original cropped artwork and frame surface. |
| billboard-16x9-3m | 4 / 26 | Original cropped artwork and frame surface. |
| billboard-16x9-4m | 4 / 26 | Original cropped artwork and frame surface. |
| billboard-4x3-3m | 4 / 26 | Original cropped artwork and frame surface. |
| billboard-4x3-4m | 4 / 26 | Original cropped artwork and frame surface. |
| linemap-stand | 16 / 40 | Base, support and two separately oriented readable map faces. |
| hanger-roof | 6 / 36 | Support bar visible from every direction. |
| hanger-post | 14 / 36 | Bar, upright and base. |
| pillar-slim | 16 / 36 | Shaft and end collars, preserving height and support footprint. |
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

Current budget violations remain failures:

| Model | Low | High | Limit |
| --- | --- | --- | --- |
| cubicle-toilet | 1712 | 3052 | 305 |

`INVENTORY_REPORT_ONLY=1` exposes the full inventory despite violations; it does
not waive them. Default inventory generation remains strict.

### Train models (车辆)

| Train model | Low triangles | High triangles |
|---|---:|---:|
| D-8 | 76772 | 1308368 |
| D-6 | 60192 | 1011852 |
| A-8 | 69864 | 735408 |
| A-6 | 53828 | 577996 |
| C-6 | 49732 | 538640 |
| B-6 | 47840 | 519296 |
| L-6 | 43488 | 468328 |
| C-4 | 35200 | 398260 |
| B-4 | 33708 | 381948 |
| L-4 | 30716 | 347100 |

Counts include retained city decals and use production static/door/transparent
batching plus detail swaps. City decals are fitted before batching, so city switches
do not rebuild prepared trains. All classes remain inside the 10% train budget.
Current inventory: `.preview/perf/current-models-nanjing/train-triangles.json`
(three.js r186).

### Passenger models (乘客)

All 440 variants, grouped only when exact High/Low counts match. Individual names
remain in `.preview/perf/current-models/passenger-triangles.json`.

| Variants | Low | High |
| --- | --- | --- |
| 2 | 791 | 8101 |
| 2 | 774 | 8016 |
| 2 | 715 | 7382 |
| 2 | 704 | 7297 |
| 2 | 690 | 7149 |
| 5 | 684 | 7149 |
| 1 | 678 | 7145 |
| 1 | 670 | 7021 |
| 5 | 673 | 6976 |
| 2 | 664 | 6968 |
| 2 | 672 | 6961 |
| 1 | 668 | 6894 |
| 6 | 659 | 6888 |
| 2 | 671 | 6862 |
| 2 | 669 | 6862 |
| 2 | 669 | 6861 |
| 2 | 669 | 6860 |
| 11 | 660 | 6858 |
| 2 | 653 | 6777 |
| 2 | 654 | 6777 |
| 2 | 654 | 6776 |
| 2 | 653 | 6775 |
| 2 | 658 | 6761 |
| 2 | 655 | 6761 |
| 2 | 658 | 6760 |
| 2 | 657 | 6760 |
| 2 | 643 | 6676 |
| 2 | 640 | 6676 |
| 2 | 645 | 6675 |
| 2 | 642 | 6675 |
| 7 | 616 | 6430 |
| 1 | 614 | 6426 |
| 1 | 604 | 6302 |
| 5 | 603 | 6257 |
| 2 | 594 | 6249 |
| 2 | 592 | 6242 |
| 1 | 590 | 6175 |
| 6 | 593 | 6169 |
| 11 | 590 | 6139 |
| 2 | 574 | 5910 |
| 2 | 569 | 5910 |
| 5 | 564 | 5910 |
| 5 | 565 | 5910 |
| 2 | 568 | 5909 |
| 5 | 562 | 5909 |
| 2 | 573 | 5908 |
| 5 | 563 | 5908 |
| 1 | 561 | 5906 |
| 1 | 564 | 5906 |
| 1 | 565 | 5905 |
| 1 | 564 | 5904 |
| 2 | 558 | 5809 |
| 2 | 560 | 5809 |
| 5 | 554 | 5809 |
| 5 | 550 | 5809 |
| 2 | 558 | 5808 |
| 2 | 560 | 5808 |
| 5 | 554 | 5808 |
| 5 | 552 | 5808 |
| 1 | 548 | 5805 |
| 1 | 546 | 5805 |
| 1 | 550 | 5804 |
| 1 | 548 | 5804 |
| 1 | 549 | 5782 |
| 1 | 560 | 5782 |
| 1 | 560 | 5781 |
| 1 | 549 | 5780 |
| 5 | 556 | 5737 |
| 5 | 555 | 5737 |
| 5 | 554 | 5736 |
| 5 | 553 | 5735 |
| 2 | 549 | 5729 |
| 2 | 544 | 5729 |
| 2 | 545 | 5728 |
| 2 | 550 | 5727 |
| 2 | 551 | 5722 |
| 2 | 548 | 5722 |
| 2 | 547 | 5721 |
| 2 | 550 | 5720 |
| 1 | 547 | 5681 |
| 1 | 545 | 5681 |
| 2 | 545 | 5680 |
| 1 | 543 | 5655 |
| 1 | 546 | 5655 |
| 1 | 549 | 5654 |
| 1 | 544 | 5653 |
| 6 | 540 | 5649 |
| 6 | 543 | 5649 |
| 6 | 544 | 5648 |
| 6 | 541 | 5647 |
| 10 | 543 | 5636 |
| 5 | 545 | 5635 |
| 5 | 543 | 5635 |
| 4 | 524 | 5628 |
| 4 | 524 | 5627 |
| 2 | 538 | 5621 |
| 2 | 540 | 5621 |
| 2 | 536 | 5620 |
| 2 | 538 | 5620 |
| 11 | 539 | 5619 |
| 11 | 548 | 5619 |
| 11 | 549 | 5618 |
| 11 | 538 | 5617 |
| 1 | 534 | 5554 |
| 1 | 536 | 5554 |
| 1 | 536 | 5553 |
| 1 | 534 | 5553 |
| 6 | 533 | 5548 |
| 6 | 531 | 5548 |
| 12 | 533 | 5547 |
| 22 | 530 | 5518 |
| 22 | 528 | 5517 |
| 2 | 523 | 5422 |
| 2 | 512 | 5337 |
| 2 | 426 | 4470 |
| 5 | 430 | 4470 |
| 1 | 424 | 4466 |
| 1 | 415 | 4342 |
| 5 | 413 | 4297 |
| 2 | 408 | 4289 |
| 2 | 410 | 4282 |
| 1 | 402 | 4215 |
| 6 | 399 | 4209 |
| 11 | 400 | 4179 |

### Ambient road vehicles

Authored Low car/bus/bike/scooter meshes use bounded instance pools. Road
catalogue counts describe surface geometry, not the fleet.

## Keep interactive work bounded

### Pointer picking and geometry snapping

Resolve at most one scene pick per event and share it across tools, surface aims,
selection and audio.

`node tools/check-geometry-snapping.mjs` production capture in
`.preview/perf/geometry-snapping/browser.json` covers 12 fixtures and 111 pointer
events: maximum one scene raycast per event, no browser errors. Its synchronous
dispatch maximum was 16.4 ms; this excludes queued hover work, render submission
and display and does **not** establish the <100 ms visible-response budget. Keep
the build identifier and timing boundary in the raw report.

### Placement invalidation and model retention

Use immutable inputs and complete dependency keys. Retain remote roots, animation
registrations and Low resources. Unknown inputs take the conservative rebuild path.
Commit accepted edits only; never scan all equipment per candidate tile.

### Undo history and derived placement indexes

2026-11-06, the reported interaction: open the supplied 天河公园 save and place
ceiling-hung lights with the real pointer. Production build, headless Chrome 156 /
SwiftShader, 1440 × 1000, paused, no concurrent runs. The 13.8 MB save holds
130 150 cells, 75 454 modules and 2 674 suspended-ceiling cells; it opens at a
1.15 GB main-isolate heap, 18 095 draws and 1.8 GB of texture pixel data. Eight
placements, four forced GCs after each, raised the heap **29.7 MB per placement**
(1 152.9 → 1 362.2 MB; `past` 2 → 9). Clearing `past`/`future` after each commit
held the same run to 8.9 MB per placement.

The frames were not copying documents: each retained frame's immutable `modules`
array kept the station-sized derived indexes the hover built against it. A Node
harness calling `equipmentReason` on each kept version retained 44.2 MB per frame
(collision bodies and their spatial index 14.6 MB, ceiling support 11.8 MB
including `blockIndex` 4.7 MB, plus blocked levels, ground, fences and outdoor
surfaces). Multiplied by the forty-frame depth that is ~1.2 GB of derived-index
retention above the load baseline, which is what pushes an already-large tab over
its heap limit.

`sim/documentCaches.ts` now releases a retired document's derived indexes from
`StationSlice` (`commit`, `undo`, `redo`, `newStation`, `loadFromText`,
`loadReference`) and the autosave restore. Frames keep their immutable records and
rebuild on demand if an undo makes them current. The same eight placements then
measured **5.5–6.0 MB per placement** with history retained (1 123.7 → 1 165.7 MB
before the fixture was re-saved; 1 130.5 → 1 169.2 MB after); the residual is each
frame's own 75 k-element module array. Raw reports: `.preview/perf/ceiling-oom/`
(ignored). Limits: software GPU and headless Chrome; this is a JS-heap slope, not a
hardware-GPU OOM reproduction, and it does not measure first-render latency.
`ChunkSystem.authoredKeys` remains keyed by the cells array and is not registered;
it matters only for cell edits, not equipment edits.

### Outdoor paving instances

2026-11-07: paving was one `Group` + `Mesh` + `EquipmentBatches` source and one
contact blob per 1 m tile. On the supplied 天河公园 save (130,158 cells; 55,545
lawn + 14,312 sidewalk modules) that was **~8 KB of page heap and two scene
objects per square metre**, while the drawing itself was already instanced. A
fresh production load (headless Chrome 156 / SwiftShader, 1440 × 1000, paused)
measured 1,087.8 MB page heap, 200,438 scene objects, 18,321 draws and 3.80 M
triangles.

`render/surfaceBatches.ts` now draws paving directly from the document: one
`StaticInstances` per finish × 64 m bucket, with no per-tile mesh or contact blob;
the bare root caches its open/unsupported verdict, and pointer picks resolve
`hit.instanceId` through the bucket's module table. After the change the same load
measures **691.1 MB page heap
(−396.7 MB, 36.5%)**, 129,879 scene objects (−70,559), 52 surface buckets,
69,857 instances, 17,729 draws and 4.11 M triangles (the coarser buckets keep
more pavers on their near detail at this camera; 3.80 M before). A one-tile delete
committed in 80.7 ms and retained 51 of the 52 bucket allocations, replacing only
the touched bucket. A storey switch's paving sync (after the cached hidden flag)
measured 9.6–11.1 ms. Reports: `.preview/perf/memory/surface-check-*.json` (ignored).

Limits: software GPU and headless; chunk geometry and canvas textures are
unchanged by this layer, and hardware-GPU memory is not measured. The remaining
~170 MB attributable to paving is the bare per-tile root plus its buckets —
removing those roots (with a document-driven level/selection path) is the next
lever. Keep the generic `EquipmentBatches` capable of static tiles as a unit, but
`ModuleSystem` must not route paving through it, or the per-tile source records
come back.

### Settings and presentation edits

City switches repaint cab textures in place, replace city-specific exit/pylon
shells and map roots, and cache map artwork by city. Ordinary label edits repaint
retained artwork; invisible settings do not dirty geometry. Preserve live rigs
and ownership on retention paths.

### Build-rail thumbnails

Checked-in, lazy-loaded 132 px PNGs avoid startup WebGL rendering. Generate them
with the real renderer after a build, then rebuild. Never restore startup WebGL
thumbnails.

### Suspended ceilings

Ceiling edits keep local invalidation.

### Shared interactive previews

Reuse bounded materials, geometry and the event's pick. Process only the newest
target; refused previews stay refused until footprint/inputs change.

### Drag previews and collision

Use 50 ms latest-target scheduling. Block drags cap at 10,000 cells including
walls; refuse oversized gestures whole before allocating their footprint. Cache
occupancy/verdicts against immutable inputs.

### Fence drags and equipment placement

2026-11-03: `tools/bench-fence-drag.mjs` production builds before and after the
per-cell refusal preview, on the 256-fence fixture at 1424 × 905 in headless
Chrome 156 / SwiftShader, two RAFs after real pointer events. Cold down was
157.9 / 260.6 ms and warm down 32.6 / 32.5 ms; warm move 2 was 48.9 / 50.9 ms.
Single samples are noisy and do not establish a speedup or hardware performance.
Raw reports: `.preview/perf/fence-drag-cell-before.json` and
`.preview/perf/fence-drag-cell-after.json`. This fixture has no blocked cell,
so it does not measure the extra red-box rendering.

Bound neighbour discovery and retain unrelated preview/batch contributions.

### Block collision in demo stations

Cache blocked and partial-support cases with original refusal priority, cell
ownership and immutable array reuse when introducing indexes.

## Simulation playback frame tails

Measure submitted frames separately from RAFs using `bench:sim-stalls`. Regular
Zoo: ground hidden, -15 m, TOP/N/W corner. Regular Tanwei: default opening level,
Hide UI. Both use the 2/3 camera-distance factor. Match canvas, pixel ratio,
population, speed and quality; separate clean timings, CPU sampling and GPU traces.
Low / normal view / 16× targets at least 15 FPS 1% low over the first 30 seconds.
No fresh playback measurement validates the latest models.

### Tanwei Low at 1×

Target 30 average and 15 FPS 1% low. Guard equipment batch sizing and active-storey
shadow behavior.

### Contact shadows on the active storey

Only floor-standing equipment on the active storey allocates contact blobs;
ceiling fixtures and fixed PSD infill/covers allocate none.

### Live TV atlas uploads and 1% lows

Upload at most one changed live panel per render frame, coalesce fairly to newest
pixels, retain CPU pages for context restoration, remove deleted pending slots
and request frames until uploads drain. Train-arrival cards and minute-clock
repaints can stall independently of train construction; use plate/atlas ablations.

## Exploded floor arrangement

Prepare geometry once per opening, reuse tray transforms and pose buffers. Drags
translate the selected group without extra picks, document commits or vertex
rewrites. Opening and dragging are different workloads. The snapshot measurement
below does not validate full viewer generation or the latest models.

Tianhe Park snapshot: 130,158 cells and 75,950 modules
(SHA-256 `fba82a60372be7bef50dac120239d37ecbd39d5c68dc40beefe2e1e4a3fe8e95`),
Windows / i7-14700KF / Node 24.15.0, source at `f604ef78` with the local
working tree. A Node CPU sample of five snapshot preparations identified
`packFloors` and its collision probes among the hot paths. Six alternating,
GC-before-sample runs after one warmup measured the original string keys at
522–664 ms (median 571 ms) and numeric keys at 348–486 ms (median 389 ms).
The guarded key implementation measured 330–399 ms (median 376 ms) in a
separate six-run capture. Reproduce the current snapshot-only measurement with
`node --expose-gc tools/bench-explode-snapshot.mjs <save.metro.json>`; these
numbers exclude parsing, WebGL, model building and the first rendered frame.
A full browser attempt on this machine exceeded the harness's 60-second CDP
limit before completing and did not yield a comparable viewer timing; do
not infer an end-to-end speedup from the snapshot result. Other applications
were running, so treat these as diagnostic measurements rather than a budget.

Full browser investigation of the same save: production build, Chrome
headless with hardware rendering requested, 1400 × 900 window (1384 × 690
canvas, pixel ratio 1), paused, default graphics quality. The fixture hash and
CPU are above. `node tools/bench-explode-generation.mjs <save.metro.json>` saves
stage timings and separate Chrome CPU profiles under `.preview/perf/explode-generation/`;
`BENCH_PROFILE=0` skips the explode CPU profile. Baseline unprofiled explode
(open action through ready plus two animation frames) was 166.3 s: `setStation`
58.0 s, of which `applyLevel` was 17.6 s; `enableExplodedLayout` 53.5 s; a
late artwork rebuild 19.7 s plus another 27.1 s visibility pass. These are
nested stage times, not additive independent measurements. The CPU-profiled
intermediate capture showed a large garbage-collector contribution. Diagnostic
geometry counters before instancing recorded 148,868 baked instances / 24.0m
vertices and 134,932 merge inputs; after retaining complete instances, 43,991
bakes / 16.0m vertices and 42,018 merge inputs remained.

The viewer skips equipment batches that its rigid trays immediately
hide, decodes the selected map before building, keeps whole instances in their
floor, and flushes temporary merge inputs at 131,072 vertices or 1,024 meshes.
The bounded-batch diagnostic run reached the rendered viewer in 39.7 s:
`setStation` 18.7 s (including 6.8 s modules, 9.0 s train preparation),
ramp sections 1.2 s, floor layout 11.2 s (4.5 s merge). Compare these captures as
diagnostic, not a controlled speedup: system load varied substantially (the regular
station build ranged from 15 to 27 s), tests overlapped the last run's station
opening, and only one run of each build was captured. The timed explode runs
themselves did not overlap a build. GPU backend was requested, not independently
identified. Train preparation and first-frame GPU work remain material costs on
this save and this does not establish a latency target.
An unprofiled full-save browser check (`BENCH_STATION=<save> node tools/check-exploded-view.mjs`) (production source hash
`cde4b3477d52af1e828faca262d4b93975d198bd4d201425b2ae6d9499505f11`)
opened in 25.9 s and 54.7 s across two successive openings; the real-pointer
drag checks took 816 and 691 ms, including rendered feedback. Raw results and
screenshots: `.preview/perf/exploded-view/report.json` and
`station-arranged.png`. The second opening and interaction latency remain
performance gaps; the two observations are not a stable percentile.

Structure-first capture, same Tianhe save and Chrome 156 hardware requested,
1384 × 690 canvas. One unprofiled generation capture (source hash
`f82150dabd6114271db2040f46dba6c1c3eedb1784f36f687dc5ca97635ee755`)
reported **8.33 s** from open to the rendered and interactive structure,
and **23.30 s** to all equipment attached. Initial scene setup took 3.16 s,
ramp sections 0.71 s and structural layout 1.97 s. The browser benchmark reports
both `structureMs` and `equipmentMs`; raw capture in
`.preview/perf/explode-structure-first/report.json`. The separate 25.9/54.7 s
full-save openings measured a fully furnished viewer, so compare those with
equipment completion only as separate diagnostic runs under varying system load.
The first-frame metric measures the first-frame usability milestone.

### Exploded viewer memory, Tianhe Park

Chrome 156 headless with hardware requested, Windows, i7-14700KF,
1384 × 690 canvas, paused, the user save SHA-256
`fba82a60372be7bef50dac120239d37ecbd39d5c68dc40beefe2e1e4a3fe8e95`,
production source hash `25e3f0f460d5a4e203b29dac996bf99189ed19d90427e626195d14280e5f6a72`
(including the current uncommitted worktree). Process working sets sampled about
once per second within four seconds of each browser milestone; Chrome CDP heap
figures are immediate, without forced garbage collection. Values are GiB.

| Milestone | Renderer working set | GPU process working set | JS used heap | V8 backing storage |
| --- | ---: | ---: | ---: | ---: |
| Editor loaded, before explode | 5.51 | 3.66 | 1.23 | 2.53 |
| Structure ready | 5.76 | 4.20 | 1.00 | 2.87 |
| Equipment attached | 6.39 | 5.58 | 1.11 | 3.21 |

Structure was ready at 8.91 s and equipment attached at 25.38 s in this run.
The process working sets include all Chrome pages/processes associated with this
benchmark profile and shared pages can appear in multiple working sets. GPU
working set is not a direct measurement of dedicated GPU VRAM. CDP backing
storage includes ArrayBuffers and other backing allocations, not just geometry.
The non-monotonic used heap reflects normal garbage collection, not negative
allocation. The editor and exploded renderer coexist; the growth is consistent
with copied meshes, buffers and GPU resources, but these measurements do not
attribute retained bytes to specific object classes or establish release after
closing. Peak observed individual process working sets in the first exploratory
run were 6.21 GiB renderer and 4.84 GiB GPU process. Reproduce with
`./tools/bench-explode-memory.ps1 <save.metro.json>` after a production build.
The benchmark writes milestone timestamps and CDP heap figures to
`.preview/perf/explode-memory/report.json`, and process samples to
`.preview/perf/explode-memory/processes.json`. Raw process samples: `.preview/perf/explode-memory-processes.json`.

### Exploded/editor renderer handoff

Windows, i7-14700KF, Chrome 156 headless with hardware requested,
1384 × 690 canvas, paused. A production build with source hash
`469e09ae2fee531fa6f28d81b724da20f1b70f2b402cc12ac8f1962555d74c42` and the
Tianhe save SHA-256
`724a40de061c6d9edfae938224a70124bf19fcb00d7ae613627a8e5e30a5252b` measured
renderer working sets of 5.11 GiB before opening, 3.19 GiB at structural ready,
3.14 GiB after equipment, and 5.96 GiB after returning to the rebuilt editor.
GPU process working sets at the same milestones were 3.65, 0.95, 2.18 and
3.87 GiB. CDP V8 backing storage was 2.38, 1.08, 1.39 and 3.10 GiB respectively
(the returned figure is before forced GC); after an explicit GC it was 2.62 GiB.
Chrome process samples are approximate and include shared pages, and GPU working
set is not dedicated VRAM. Structure-ready was 16.47 s, equipment completion
32.76 s, and returning to the rendered editor took 39.00 s in this one run.
The save hash differs from the memory-table capture above, so the two are not a
controlled before/after comparison. Source includes unrelated worktree changes.
Run `./tools/bench-explode-memory.ps1 <save.metro.json>` after a build to capture
milestones, return time, optional post-return GC and Chrome process samples;
raw files are under `.preview/perf/explode-memory/`.

## Collect comparable evidence

Keep source/build hash, fixture, hardware, GPU mode, quality, camera, canvas,
pixel ratio, sample count and timing boundary in raw reports. Never combine
profiled/clean runs or compare different scenes as a speedup. Preserve failures.
No fabricated V8 percentages.

### Repeatable editor action matrix

Keep `editorActionCases.ts` and its completeness test aligned with finite palette
settings. Complete unprofiled hardware captures update the matrix; focused runs
replace only matching cases. Incomplete, profiled and software-GPU captures must
not publish. Use `BENCH_MATRIX_UPDATE=0` for exploration.

天河公园 (tianhe) is the largest shipped example (151,852 cells, 76,436 modules).
Its first focused capture (guidepost, 1 sample, unprofiled hardware, 2026-11-07)
misses the strict 100 ms budget for the structural actions — 478.30 ms place,
292.20 ms drop, 153.90 ms move-preview and 1,572.60 ms delete — while preview
(45.40 ms) and pickup (79.70 ms) pass. The measured rows live in
[editor-action-matrix.md](editor-action-matrix.md); they are this document's
cost, not a target for the two smaller demos.

### Benchmark protocol

Build first; benchmark without concurrent builds, tests or profilers. API-to-render
and pointer-to-render are separate measurements. Use `BENCH_CANVAS_SIZE` and
`BENCH_PIXEL_RATIO` for playback reproductions. Keep artifacts tied to reports.

### Current validation routes

| Question | Command |
| --- | --- |
| Demo workflow | `npm run bench:usage-tour` |
| Pointer placement | `npm run bench:placement` |
| Action/settings matrix | `npm run bench:editor-actions` |
| Picking | `node tools/check-tool-picking.mjs` |
| Geometry snapping | `node tools/check-geometry-snapping.mjs` |
| Ramp fit | `node tools/check-ramp-fit.mjs` |
| Level switching | `node tools/bench-level-switch.mjs` |
| Presentation | `node tools/bench-settings-audit.mjs`, `node tools/check-city-styles.mjs` |
| Preview / LOD | `node tools/bench-preview-audit.mjs`, `node tools/check-preview-lod.mjs` |
| Equipment retention | `node tools/bench-tree-placement.mjs` |
| Exploded viewer | `node tools/check-exploded-view.mjs`, `npm run bench:explode` |
| Playback tails | `npm run bench:sim-stalls` |
| Actual model counts | `node tools/model-triangle-inventory.mjs` |
| City-specific counts | Set `MODEL_CITY=<city>`, then run the inventory command |
| GPU batching / fallback | `node tools/check-render-batching.mjs`, also `--no-multi-draw` |
| Harness | `npm run check:perf-tools` |
