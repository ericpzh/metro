# Performance reference

This is the current measured state and engineering contract, not a run diary.
Replace superseded values in place. Keep raw reports with source hashes and
hardware metadata outside this document. Do not describe unmatched workloads as
a speedup, or an older measurement as validation of newer code.

## Reproduce the reported interaction

Measure from the first real input through visible feedback, including cold work.
Keep preview work separate from document commits. Preserve accepted/refused
outcomes and add a deterministic regression for the measured cause.

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

Five of six observations miss the target. Both demos retain train roots/textures
and benches, perform zero chunk remeshes/raycasts, and send only population patches.
Badge recolouring, undo/redo, autosave reload, bilingual controls and 1024 px menu
fit pass. Costs remain unprofiled. Theme appearance and Low geometry need their
own visual/geometry checks; this capture does not prove them.

## Per-model geometry detail inventory

Actual generated counts, not station totals or FPS estimates. Equipment counts
include visible source/instanced geometry and authored Low; train counts include
static, door and transparent batching; passenger counts come from the baked atlas.
Counts exclude textures and do not establish a draw-call or GPU-time pass.

### Equipment and decor

Default Guangzhou catalogue. Shared limits live in
`tools/equipment-low-budgets.mjs`: strict <10% unless an explicit minimum-shape
exception applies. `model-detail` checks reduction, restoration and batching.
Never raise a limit to conceal a regression.

| Equipment / decor model name | Low triangles | High triangles |
|---|---:|---:|
| tree | 396 | 18432 |
| shelf-cooler | 420 | 9852 |
| shelf-cooler-dark | 420 | 9852 |
| bridge | 720 | 9576 |
| shelf-white-tall | 240 | 7556 |
| shelf-dark-tall | 240 | 7244 |
| urinal | 648 | 6880 |
| shelf-wire | 412 | 6524 |
| cubicle | 72 | 5688 |
| cctv-dome | 336 | 5208 |
| walkway | 290 | 5162 |
| cctv-post | 352 | 5096 |
| sink | 224 | 4972 |
| cctv-ptz | 308 | 4924 |
| shelf-white-short | 192 | 4420 |
| escalator | 204 | 3410 |
| cubicle-toilet | 1712 | 3052 |
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
| lift | 144 | 1776 |
| electrical-cabinet | 36 | 1224 |
| extinguisher-glass | 86 | 918 |
| exit-covered-1 | 68 | 902 |
| exit | 68 | 902 |
| exit-covered-3 | 68 | 902 |
| roof-canopy | 56 | 840 |
| tactile-warning | 4 | 812 |
| fence-iron | 72 | 768 |
| checkout | 64 | 750 |
| gate-new | 68 | 720 |
| rail-signal | 64 | 708 |
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
| billboard-wide | 6 | 40 |
| billboard-standard | 6 | 40 |
| billboard-large | 6 | 40 |
| billboard-panorama | 6 | 40 |
| billboard-portrait | 6 | 40 |
| billboard-square | 6 | 40 |
| linemap-stand | 16 | 40 |
| hanger-roof | 6 | 36 |
| hanger-post | 14 | 36 |
| pillar-slim | 16 | 36 |
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

Covered-exit Low uses four roof/soffit sections and one-section glazed bays;
tiny lights and the sign bracket are omitted. Pylon Low retains one open
eight-segment annulus visible from both sides, emblem and upright labels, omitting rear ring/panel trim.
High geometry is unchanged. City-specific `model-detail` cases enforce the same
limits as the default catalogue and restore the exact original geometry.

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
| billboard-wide | 6 / 40 | Original cropped artwork, frame surface and illuminated AD label. |
| billboard-standard | 6 / 40 | Original cropped artwork, frame surface and illuminated AD label. |
| billboard-large | 6 / 40 | Original cropped artwork, frame surface and illuminated AD label. |
| billboard-panorama | 6 / 40 | Original cropped artwork, frame surface and illuminated AD label. |
| billboard-portrait | 6 / 40 | Original cropped artwork, frame surface and illuminated AD label. |
| billboard-square | 6 / 40 | Original cropped artwork, frame surface and illuminated AD label. |
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
not waive them. Default inventory generation and tests remain strict. Ramp
wall-input retention is a separate unresolved regression.

### Train models (车辆)

| Train model | Low triangles | High triangles |
|---|---:|---:|
| D-8 | 76672 | 1308000 |
| D-6 | 60092 | 1011484 |
| A-8 | 69544 | 735088 |
| A-6 | 53508 | 577676 |
| C-6 | 49412 | 538320 |
| B-6 | 47520 | 518976 |
| L-6 | 43168 | 468008 |
| C-4 | 34880 | 397940 |
| B-4 | 33388 | 381628 |
| L-4 | 30396 | 346780 |

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

Use authored car/bus/bike/scooter Low meshes and bounded instance pools. Road
catalogue counts describe surface geometry, not the fleet. Keep traffic behavior
independent of graphics quality.

### Five-metre clearance and other geometry

Preserve five-metre train/platform/catenary alignment, PSDs, ramp cuts and openings
at both detail levels. Outward Metro signs are decorative: never enlarge sim
collision for their rendered overhang. Low must preserve silhouettes and joints.

## Keep interactive work bounded

### Pointer picking and geometry snapping

Resolve at most one scene pick per event and share it across tools, surface aims,
selection and audio. Snap to actual visible geometry/supports, not editing levels.
Preserve `tool-picking`, `ramp-targeting`, `geometry-snap` and `placement-surface`.

### Placement invalidation and model retention

Use immutable inputs and complete dependency keys. Retain remote roots, animation
registrations and Low resources. Unknown inputs take the conservative rebuild path.
Commit accepted edits only; never scan all equipment per candidate tile.

### Settings and presentation edits

City switches preserve existing colours and walking topology. Repaint cab textures
in place; replace city-specific exit/pylon shells and map roots. Cache map artwork
by city. Ordinary label edits repaint retained artwork; invisible settings do not
dirty geometry. Preserve live rigs and ownership on every retention path.

### Build-rail thumbnails

Use checked-in, lazy-loaded 132 px PNGs. Exits, pylons and line maps select city
caches. Build, generate with the real renderer, inspect images, then build again.
Never restore startup WebGL thumbnails or commit synthetic preview fixtures.

### Suspended ceilings

Separate ceiling plates from ordinary floor and zone paint. Preserve mounted
fixtures, exact supports, local invalidation and floor/ceiling visibility rules.

### Shared interactive previews

Reuse bounded materials, geometry and the event's pick. Process the newest target;
refused previews stay refused until footprint/inputs change. Preserve cancel/release.

### Drag previews and collision

Use 50 ms latest-target scheduling. Block drags cap at 10,000 cells including
walls; refuse oversized gestures whole before allocating their footprint. Cache
occupancy/verdicts against immutable inputs and exercise blocked demo footprints.

### Fence drags and equipment placement

Bound neighbour discovery and retain unrelated preview/batch contributions. Keep
occupied/unsupported cases, cancellation and disposal covered deterministically.

### Block collision in demo stations

Include blocked and partial-support cases; preserve original refusal priority,
cell ownership and immutable array reuse when introducing indexes.

## Simulation playback frame tails

Measure submitted frames separately from RAFs using `bench:sim-stalls`. Regular
Zoo: ground hidden, -15 m, TOP/N/W corner. Regular Tanwei: default opening level,
Hide UI. Both use the 2/3 camera-distance factor. Match canvas, pixel ratio,
population, speed and quality; separate clean timings, CPU sampling and GPU traces.
Low / normal view / 16× targets at least 15 FPS 1% low over the first 30 seconds.
No fresh playback measurement validates the latest models.

### Tanwei Low at 1×

Target 30 average and 15 FPS 1% low. Guard equipment batch sizing and active-storey
shadow behavior with deterministic retention and performance tests.

### Contact shadows on the active storey

Only floor-standing equipment on the active storey gets contact blobs; exclude
ceiling fixtures and fixed PSD infill/covers. Preserve visibility transitions.

### Live TV atlas uploads and 1% lows

Upload at most one changed live panel per render frame, coalesce fairly to newest
pixels, retain CPU pages for context restoration, remove deleted pending slots
and request frames until uploads drain. Train-arrival cards and minute-clock
repaints can stall independently of train construction; use plate/atlas ablations.

## Exploded floor arrangement

Prepare geometry once per opening, reuse tray transforms and pose buffers. Drags
translate the selected group without extra picks, document commits or vertex
rewrites. Preserve solid infill, clipped ramp sections, source hiding, reset and
live/paused behavior. Opening and dragging are different workloads. No fresh
exploded-view measurement validates the latest models.

## Collect comparable evidence

Keep source/build hash, fixture, hardware, GPU mode, quality, camera, canvas,
pixel ratio, sample count and timing boundary in raw reports. Never combine
profiled/clean runs or compare different scenes as a speedup. Preserve failures
and deterministic work-count/lifecycle regressions. No fabricated V8 percentages.

### Repeatable editor action matrix

Keep `editorActionCases.ts` and its completeness test aligned with finite palette
settings. Complete unprofiled hardware captures update the matrix; focused runs
replace only matching cases. Incomplete, profiled and software-GPU captures must
not publish. Use `BENCH_MATRIX_UPDATE=0` for exploration.

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
| Shenzhen counts | Set `MODEL_CITY=shenzhen`, then run the inventory command |
| GPU batching / fallback | `node tools/check-render-batching.mjs`, also `--no-multi-draw` |
| Harness | `npm run check:perf-tools` |

### Model inventory upkeep

Replace tables when geometry/detail changes. Generated records live under
`.preview/perf/current-models/` and `.preview/perf/current-models-shenzhen/`.
Run model-detail, train/passenger LOD and owning geometry tests, then full tests
and build. Source restoration, ownership and disposal are required at both LODs.

### Exact ramp terrain cuts

`sim/rampSurface.ts` owns exact shared surfaces. Preview, validation, carve and
mesher use the same retained-volume allowance without editing the source document.
Pin in `ramp-surface`, `ramp-block-placement` and real browser fit/placement checks.

### Local edit storey-group retention

Reuse groups holding retained remote chunks; replacing their map entries can
strand geometry outside visibility/teardown. Compare local edits with fresh meshes.

### Tianhe underside block placement

A ground wedge under one ramp can accept a block while an intersecting passage
still refuses it. Preserve the `(77,-100,-16)` fixture and real-pointer probe.

### Tianhe door under stair

Wall/door support and underside clearance follow actual surfaces, not nominal
storey rounding. Preview and commit must agree on passage clearance and refusal.
