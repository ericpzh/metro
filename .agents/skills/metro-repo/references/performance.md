# Performance reference

Active performance contracts, measurement rules, and per-model geometry inventories for Station Designer.

## Engineering & measurement rules

- **Current state only**: Replace superseded values in place; keep raw captures, source/build hashes, and hardware metadata under `.preview/perf/` or `.preview/unity/` instead of run diaries.
- **Reproduce the reported interaction**: Measure from the first real input through visible feedback (including cold work); separate preview work from document commits and preserve accepted/refused outcomes.
- **Comparable workloads**: Match fixture, build hash, hardware/GPU backend, quality/LOD profile, upscaling mode, camera, canvas size, DPR, speed, and timing boundary; keep clean runs, CPU profiles, and traces separate.
- **Explicit boundaries**: Keep API-to-render, two-RAF, submitted-frame, GPU-completion, and display timings distinct. Targets: strictly `< 100 ms` editor feedback; `≥ 15 FPS` 1% low over 30 s at Low / normal view / 16×.
- **No fabricated numbers**: Preserve failures, refusals, and unsupported cases separately; update this reference only when a task addresses performance or changes a budget or benchmark procedure.

## Sub-references

- [perf-web.md](perf-web.md) — Three.js interactive budgets, picking, batching, derived-index release, paving, level slicing, sparse routing, traffic scaling, and exploded-view handoff.
- [perf-unity.md](perf-unity.md) — Unity 6 URP 3-tier LODs, non-active storey step-down, FSR 1.0 upscaling, retained edits, WebGL memory/Brotli packaging, Windows `.exe` startup/benchmark, and sparse routing parity.
- [perf-benchmarks.md](perf-benchmarks.md) — verified `npm` scripts, browser/route benchmarks, Unity EditMode/PlayMode perf suites, and standalone player benchmarks.
- [perf-benchmark-matrix.md](perf-benchmark-matrix.md) — full 240-combination serial benchmark matrix across Web (Three.js localhost), Unity WebGL (localhost), and Unity Desktop (`.exe`).
- [unity-model-lod-inventory.md](unity-model-lod-inventory.md) — Unity `LOD0`/`LOD1`/`LOD2` triangle inventory across rigid prefabs, procedural probes, compacted trains, and passengers.

## Per-model geometry detail inventory (Web Three.js)

Per-model generated triangle counts (not station totals, draw calls, or FPS). Equipment Low budgets live in `tools/equipment-low-budgets.mjs` (`< 10%` of High unless an explicit minimum-shape exception applies; never raise a limit to hide a regression). Verify WebGL rendering with `npm run check:equipment-lod`.

### Equipment and decor

Default Guangzhou catalogue (city-specific exit/guidepost/map variants satisfy the same budgets; open ballfield nets add 129 pickleball / 127 badminton line segments):

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
| clock-digital | 28 | 352 |
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

### Train models (车辆)

All selectable formations (`A`/`B`/`C`/`D`/`L` × 2/3/4/6/8 cars × third-rail /
catenary) with production static, door, and transparent batching (`≤ 10%` Low
budget, pinned by `game/test/train-lod.test.mjs`).

| Train model | Third-rail Low | Third-rail High | Catenary Low | Catenary High |
|---|---:|---:|---:|---:|
| A-2 | 21756 | 263172 | 23412 | 276860 |
| A-3 | 29774 | 341878 | 31430 | 355566 |
| A-4 | 37792 | 420584 | 39448 | 434272 |
| A-6 | 53828 | 577996 | 55484 | 591684 |
| A-8 | 69864 | 735408 | 72348 | 755940 |
| B-2 | 19576 | 244600 | 21232 | 258288 |
| B-3 | 26642 | 313274 | 28298 | 326962 |
| B-4 | 33708 | 381948 | 35364 | 395636 |
| B-6 | 47840 | 519296 | 49496 | 532984 |
| B-8 | 61972 | 656644 | 64456 | 677176 |
| C-2 | 20668 | 257880 | 22324 | 271568 |
| C-3 | 27934 | 328070 | 29590 | 341758 |
| C-4 | 35200 | 398260 | 36856 | 411948 |
| C-6 | 49732 | 538640 | 51388 | 552328 |
| C-8 | 64264 | 679020 | 65920 | 692708 |
| D-2 | 27032 | 418820 | 28624 | 431932 |
| D-3 | 35178 | 566934 | 36770 | 580046 |
| D-4 | 43612 | 715336 | 45204 | 728448 |
| D-6 | 60192 | 1011852 | 61784 | 1024964 |
| D-8 | 76772 | 1308368 | 78364 | 1321480 |
| L-2 | 17944 | 225872 | 19600 | 239560 |
| L-3 | 24330 | 286486 | 25986 | 300174 |
| L-4 | 30716 | 347100 | 32372 | 360788 |
| L-6 | 43488 | 468328 | 45972 | 488860 |
| L-8 | 56260 | 589556 | 58744 | 610088 |

### Passenger models (乘客)

All 440 baked soft-human variants (`game/src/assets/passenger-approved.json`) share 218,396 animated vertices and pack High/Low index tables over the same pose atlas: High spans 4,179–8,101 triangles (padded to 8,101) and Low spans 399–791 triangles (padded to 791, `< 10%` per variant; pinned by `game/test/passenger-lod.test.mjs`, see `game/src/assets/PASSENGERS.md`). Ambient road vehicles use authored Low car, bus, bicycle, and scooter meshes in bounded instance pools.

### Unity native Mesh LOD generation

Unity uses native 3-tier Mesh LODs (`LOD0` High, `LOD1` Balanced, `LOD2` Low) targeting `LOD2 × 2 ≤ LOD0` (≥ 50% reduction; zero-triangle geometry, 2-triangle quads, and explicitly retained procedural paths are exceptions).

- **Rigid prefabs**: `StationRigidModelLods` sidecars under `unity/Assets/StationDesigner/Resources/ModelLods/Rigid/`, baked via `Metro / Station Game / Bake All Rigid Model LODs` or `metro bake_rigid_model_lod --prefab <PrefabName>`.
- **Train formations**: All 50 compacted formations (`A`–`L` × 2/3/4/6/8 × third-rail/catenary) use baked Low meshes in `Resources/ModelLods/TrainMeshes.asset` (`node tools/unity-assets/export-formations.mjs <dir> --lod-meshes` + `metro bake_train_lods --export-path <dir>`), saving 55.1%–70.3% triangles at `LOD2`.
- **Procedural & passengers**: Procedural builders (rails, ticket/info booths) pack 3-tier ranges with `StationMeshLodIndices`; stand-in and local soft-human passenger catalogues carry per-tier meshes.
- **Inventory refresh**: Run `metro model_lod_inventory` in the live Editor then `node tools/unity-assets/write-model-lod-inventory.mjs --strict` to refresh [unity-model-lod-inventory.md](unity-model-lod-inventory.md).
