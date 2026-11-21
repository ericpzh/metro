# Unity per-model LOD geometry inventory

Measured triangle counts for Unity `6000.6.8f1` native 3-tier Mesh LODs (`LOD0` High / full, `LOD1` Balanced / reduced, `LOD2` Low / simplified). Counts are per-model geometry inventory across all triangle submeshes, not station totals, draw-call counts, or FPS estimates. See [performance.md](performance.md#unity-native-mesh-lod-generation) for methodology, frame-rate captures, and open gates, and [editor-action-matrix.md](editor-action-matrix.md) for the web editor action matrix.

Summary: **236 rigid prefabs** (78 with `LOD2 < LOD0`, 361 / 6372 distinct meshes carrying 3 baked tiers), **5 procedural LOD probes**, **50 runtime compacted train formations**, **2 public stand-in passenger assets**, and **440 local soft-human passenger variants**.

## Low triangle target

Low targets at least 50% fewer triangles than High for every model. A pass requires LOD2 × 2 ≤ LOD0 before rounding. Zero-triangle geometry and unchanged two-triangle quads are exceptions. The retained paths listed below have explicit geometry-preservation exceptions.

| Model family | Pass | Miss | Exception | Unmeasured |
| --- | ---: | ---: | ---: | ---: |
| Rigid prefabs | 61 | 159 | 16 | 0 |
| Procedural probes | 5 | 0 | 0 | 0 |
| Train formations | 50 | 0 | 0 | 0 |
| Public stand-in passengers | 0 | 2 | 0 | 0 |
| Review-only passengers | 440 | 0 | 0 | 0 |

Regenerate from the open Unity Editor with:
```powershell
unity --no-banner --no-pager --format json command --project-path "$PWD/unity" --timeout 180 metro model_lod_inventory
node tools/unity-assets/write-model-lod-inventory.mjs
```
Pass `--strict` to exit with an error when an inventoried shipped model misses the target or lacks valid triangle counts.

## Rigid prefabs (equipment, decor & structures)

Every runtime rigid prefab under `unity/Assets/StationDesigner/Generated/Prefabs/` with its resolved `StationRigidModelLods` sidecar (`Resources/ModelLods/Rigid/<Prefab>.asset`), summed across all `MeshFilter` instances in the prefab and sorted descending by `LOD0` triangles. Native Mesh LOD baking tries deeper simplification levels to approach the Low triangle budget. Geometry that Unity cannot simplify and non-triangle topology such as court net lines retain their source geometry.

| Prefab | Runtime keys | 3-tier meshes | LOD2 (Low) | LOD1 (Balanced) | LOD0 (High) | Low / High | Target |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| `BridgeKit` | — | 15 / 123 | 8951 | 14780 | 25364 | 35.3% | Pass |
| `TrackKit` | generated:track | 8 / 70 | 7464 | 13728 | 25216 | 29.6% | Pass |
| `Tree` | tree | 2 / 2 | 5183 | 9661 | 18432 | 28.1% | Pass |
| `TrackGantry` | — | 11 / 72 | 6010 | 10040 | 16992 | 35.4% | Pass |
| `TrackTunnel` | — | 5 / 39 | 4295 | 7555 | 13556 | 31.7% | Pass |
| `TrackDetails` | — | 4 / 35 | 3732 | 6864 | 12608 | 29.6% | Pass |
| `ShopStock` | — | 14 / 39 | 4560 | 6992 | 11504 | 39.6% | Pass |
| `ShelfCooler` | shelf-cooler | 15 / 51 | 3036 | 5468 | 9852 | 30.8% | Pass |
| `ShelfCoolerDark` | shelf-cooler-dark | 15 / 51 | 3036 | 5468 | 9852 | 30.8% | Pass |
| `Bridge` | bridge | 4 / 46 | 2904 | 5141 | 9576 | 30.3% | Pass |
| `CityExitChengdu` | — | 16 / 45 | 3786 | 5706 | 8706 | 43.5% | Pass |
| `CheckoutCafePastry4m` | — | 2 / 122 | 4300 | 5260 | 8620 | 49.9% | Pass |
| `ShelfCafeBackbar4` | shelf-cafe-backbar-4 | 9 / 48 | 3188 | 5044 | 8488 | 37.6% | Pass |
| `ShelfWhiteTall` | shelf-white-tall | 13 / 49 | 3440 | 4912 | 7556 | 45.5% | Pass |
| `ShelfDarkTall` | shelf-dark-tall | 12 / 48 | 3312 | 4720 | 7244 | 45.7% | Pass |
| `ShelfFruitIsland` | shelf-fruit-island | 5 / 39 | 2300 | 3900 | 7100 | 32.4% | Pass |
| `Urinal` | urinal | 1 / 16 | 2848 | 4255 | 6880 | 41.4% | Pass |
| `ShelfWire` | shelf-wire | 9 / 51 | 2716 | 4508 | 6524 | 41.6% | Pass |
| `CheckoutCafePastry3m` | checkout-cafe-pastry-3m | 2 / 98 | 2476 | 3756 | 6332 | 39.1% | Pass |
| `ShelfFoodBakery` | shelf-food-bakery | 4 / 19 | 1676 | 3148 | 5884 | 28.5% | Pass |
| `ShelfBooks` | shelf-books | 7 / 23 | 1856 | 3136 | 5808 | 32.0% | Pass |
| `VehicleBusMosaic` | — | 6 / 8 | 1752 | 3172 | 5753 | 30.5% | Pass |
| `Cubicle` | cubicle | 9 / 31 | 2062 | 3278 | 5688 | 36.3% | Pass |
| `ShelfFruitTiered` | shelf-fruit-tiered | 5 / 46 | 2088 | 3240 | 5672 | 36.8% | Pass |
| `VehicleBusOrange` | — | 6 / 7 | 1752 | 3128 | 5612 | 31.2% | Pass |
| `CctvDome` | cctv-dome | 3 / 11 | 2303 | 3263 | 5208 | 44.2% | Pass |
| `CctvPost` | cctv-post | 3 / 14 | 2191 | 3151 | 5096 | 43.0% | Pass |
| `ShelfBags` | shelf-bags | 6 / 43 | 2020 | 3108 | 5048 | 40.0% | Pass |
| `Sink` | sink | 8 / 15 | 1692 | 2778 | 4972 | 34.0% | Pass |
| `CctvPtz` | cctv-ptz | 3 / 12 | 2019 | 2979 | 4924 | 41.0% | Pass |
| `PlatformEdge` | generated:platform-edge | 8 / 123 | 2234 | 3266 | 4738 | 47.2% | Pass |
| `CityExitWuhan` | — | 6 / 58 | 1892 | 2853 | 4634 | 40.8% | Pass |
| `ShelfWhiteShort` | shelf-white-short | 7 / 41 | 2208 | 3232 | 4420 | 50.0% | Pass |
| `Walkway` | walkway | 5 / 23 | 1890 | 2786 | 4202 | 45.0% | Pass |
| `VehicleBicycle` | — | 5 / 6 | 1355 | 2343 | 4080 | 33.2% | Pass |
| `CheckoutCafePastry2m` | checkout-cafe-pastry-2m | 2 / 74 | 1740 | 2508 | 4044 | 43.0% | Pass |
| `CityExitNanjing` | — | 6 / 38 | 1402 | 2298 | 3818 | 36.7% | Pass |
| `ShelfCafeBackbar2` | shelf-cafe-backbar-2 | 7 / 37 | 1776 | 2416 | 3712 | 47.8% | Pass |
| `VehicleMoped` | — | 5 / 8 | 1388 | 2076 | 3560 | 39.0% | Pass |
| `Escalator` | escalator, generated:escalator | 6 / 25 | 1198 | 2350 | 3362 | 35.6% | Pass |
| `CubicleToilet` | cubicle-toilet | 5 / 9 | 1010 | 1714 | 3052 | 33.1% | Pass |
| `ShelfCafeBackbar` | shelf-cafe-backbar | 6 / 37 | 1432 | 2192 | 2944 | 48.6% | Pass |
| `AcUnit` | ac-unit | 6 / 93 | 1772 | 2156 | 2924 | 60.6% | Miss |
| `ShelfClothingShoes` | shelf-clothing-shoes | 5 / 18 | 1298 | 1708 | 2724 | 47.7% | Pass |
| `RampJoin` | — | 2 / 2 | 704 | 1343 | 2612 | 27.0% | Pass |
| `VehicleSuv` | — | 3 / 7 | 984 | 1596 | 2568 | 38.3% | Pass |
| `VehicleSedan` | — | 3 / 7 | 972 | 1578 | 2492 | 39.0% | Pass |
| `CityExitChongqing` | — | 5 / 30 | 994 | 1506 | 2350 | 42.3% | Pass |
| `StairLeftForward` | stair-leftForward | 0 / 124 | 2336 | 2336 | 2336 | 100.0% | Miss |
| `StairRightForward` | stair-rightForward | 0 / 124 | 2336 | 2336 | 2336 | 100.0% | Miss |
| `StairLeft180` | stair-left180 | 0 / 120 | 2288 | 2288 | 2288 | 100.0% | Miss |
| `StairRight180` | stair-right180 | 0 / 120 | 2288 | 2288 | 2288 | 100.0% | Miss |
| `StairCenterForward` | stair-centerForward | 0 / 116 | 2240 | 2240 | 2240 | 100.0% | Miss |
| `StairLeft90` | stair-left90 | 0 / 116 | 2240 | 2240 | 2240 | 100.0% | Miss |
| `StairRight90` | stair-right90 | 0 / 116 | 2240 | 2240 | 2240 | 100.0% | Miss |
| `CheckoutCafe4m` | checkout-cafe-4m | 1 / 125 | 1796 | 1860 | 1972 | 91.1% | Miss |
| `CityGuidepostChongqing` | — | 2 / 6 | 656 | 1102 | 1940 | 33.8% | Pass |
| `Clock` | clock | 1 / 131 | 1812 | 1876 | 1940 | 93.4% | Miss |
| `StairStraight` | stair-straight | 0 / 91 | 1940 | 1940 | 1940 | 100.0% | Miss |
| `TactileWarningStrip` | tactile-warning-strip | 1 / 2 | 524 | 972 | 1932 | 27.1% | Pass |
| `Cctv` | cctv | 5 / 24 | 1116 | 1500 | 1888 | 59.1% | Miss |
| `ShelfFoodSnacks` | shelf-food-snacks | 3 / 24 | 876 | 1324 | 1884 | 46.5% | Pass |
| `ShopShelves` | — | 3 / 24 | 876 | 1324 | 1884 | 46.5% | Pass |
| `Lift` | generated:lift, lift | 0 / 148 | 1776 | 1776 | 1776 | 100.0% | Miss |
| `CheckoutCafePastry` | checkout-cafe-pastry | 2 / 50 | 844 | 1260 | 1756 | 48.1% | Pass |
| `CityExitShenzhen` | — | 2 / 40 | 1324 | 1580 | 1716 | 77.2% | Miss |
| `CheckoutCafe3m` | checkout-cafe-3m | 1 / 101 | 1508 | 1572 | 1684 | 89.5% | Miss |
| `FenceSteelBlue` | fence-steel-blue | 0 / 40 | 1668 | 1668 | 1668 | 100.0% | Miss |
| `CityGuidepostShenzhen` | — | 2 / 16 | 450 | 834 | 1604 | 28.1% | Pass |
| `CityExitBeijing` | — | 1 / 44 | 1018 | 1274 | 1542 | 66.0% | Miss |
| `BridgeNoiseBarrier` | — | 0 / 128 | 1536 | 1536 | 1536 | 100.0% | Miss |
| `CityExitShanghai` | — | 1 / 39 | 994 | 1250 | 1518 | 65.5% | Miss |
| `CheckoutCafe2m` | — | 1 / 77 | 1220 | 1284 | 1396 | 87.4% | Miss |
| `ShelfClothingWall` | shelf-clothing-wall | 1 / 47 | 1260 | 1324 | 1372 | 91.8% | Miss |
| `ElectricalCabinet` | electrical-cabinet | 0 / 102 | 1224 | 1224 | 1224 | 100.0% | Miss |
| `CityGuidepostWuhan` | — | 2 / 11 | 412 | 668 | 1204 | 34.2% | Pass |
| `CheckoutCafe` | checkout-cafe | 1 / 49 | 752 | 816 | 928 | 81.0% | Miss |
| `ExtinguisherGlass` | extinguisher-glass | 0 / 53 | 918 | 918 | 918 | 100.0% | Miss |
| `CityExitGuangzhou` | — | 0 / 76 | 902 | 902 | 902 | 100.0% | Miss |
| `Exit` | exit | 0 / 76 | 902 | 902 | 902 | 100.0% | Miss |
| `ExitCovered1` | exit-covered-1 | 0 / 76 | 902 | 902 | 902 | 100.0% | Miss |
| `ExitCovered3` | exit-covered-3 | 0 / 76 | 902 | 902 | 902 | 100.0% | Miss |
| `ShelfIceCream` | shelf-ice-cream | 1 / 27 | 676 | 804 | 900 | 75.1% | Miss |
| `RoofCanopy` | roof-canopy | 0 / 14 | 840 | 840 | 840 | 100.0% | Miss |
| `TactileWarning` | tactile-warning | 1 / 2 | 268 | 460 | 812 | 33.0% | Pass |
| `FenceIron` | fence-iron | 0 / 16 | 768 | 768 | 768 | 100.0% | Miss |
| `Checkout2m` | checkout-2m | 1 / 39 | 634 | 698 | 762 | 83.2% | Miss |
| `Checkout3m` | — | 1 / 39 | 634 | 698 | 762 | 83.2% | Miss |
| `Checkout4m` | — | 1 / 39 | 634 | 698 | 762 | 83.2% | Miss |
| `Checkout` | checkout | 1 / 38 | 622 | 686 | 750 | 82.9% | Miss |
| `ShelfClothingTable` | shelf-clothing-table | 1 / 16 | 484 | 612 | 732 | 66.1% | Miss |
| `GateNew` | gate-new | 0 / 23 | 720 | 720 | 720 | 100.0% | Miss |
| `PlatformEdgeHousing` | — | 0 / 31 | 720 | 720 | 720 | 100.0% | Miss |
| `RailSignal` | rail-signal | 0 / 16 | 708 | 708 | 708 | 100.0% | Miss |
| `ShelfClothingRail` | shelf-clothing-rail | 0 / 31 | 680 | 680 | 680 | 100.0% | Miss |
| `Vending` | vending | 0 / 58 | 676 | 676 | 676 | 100.0% | Miss |
| `Gate` | generated:gate-fence, gate | 0 / 33 | 668 | 668 | 668 | 100.0% | Miss |
| `Desk` | desk | 0 / 56 | 652 | 652 | 652 | 100.0% | Miss |
| `CityGuidepostNanjing` | — | 1 / 3 | 196 | 324 | 592 | 33.1% | Pass |
| `BridgePillar` | — | 3 / 3 | 192 | 384 | 576 | 33.3% | Pass |
| `PillarThick` | — | 3 / 3 | 192 | 384 | 576 | 33.3% | Pass |
| `DoorGlass2` | — | 0 / 33 | 564 | 564 | 564 | 100.0% | Miss |
| `DoorSteel2` | door-steel-2 | 0 / 33 | 564 | 564 | 564 | 100.0% | Miss |
| `ExitUncovered2` | exit-uncovered-2 | 0 / 47 | 554 | 554 | 554 | 100.0% | Miss |
| `ExitUncovered3` | exit-uncovered-3 | 0 / 47 | 554 | 554 | 554 | 100.0% | Miss |
| `ExitUncovered1` | exit-uncovered-1 | 0 / 45 | 530 | 530 | 530 | 100.0% | Miss |
| `FenceGate` | fence-gate | 0 / 18 | 432 | 432 | 432 | 100.0% | Miss |
| `TicketBooth` | generated:booth-info, generated:booth-ticket | 0 / 37 | 414 | 414 | 414 | 100.0% | Miss |
| `RoofTapered` | roof-tapered | 0 / 33 | 396 | 396 | 396 | 100.0% | Miss |
| `BusstopLong` | busstop-long | 0 / 34 | 372 | 372 | 372 | 100.0% | Miss |
| `Tvm` | tvm | 0 / 32 | 372 | 372 | 372 | 100.0% | Miss |
| `BenchOffice1` | bench-office-1 | 0 / 30 | 360 | 360 | 360 | 100.0% | Miss |
| `Fence` | fence | 0 / 18 | 360 | 360 | 360 | 100.0% | Miss |
| `CheckoutGeneric4m` | checkout-generic-4m | 0 / 31 | 352 | 352 | 352 | 100.0% | Miss |
| `ClockDigital` | clock-digital | 1 / 7 | 116 | 244 | 352 | 33.0% | Pass |
| `DoorGlass1` | door-glass-1 | 0 / 20 | 324 | 324 | 324 | 100.0% | Miss |
| `DoorSteel1` | door-steel-1 | 0 / 20 | 324 | 324 | 324 | 100.0% | Miss |
| `StreetDecor` | — | 0 / 41 | 320 | 320 | 320 | 100.0% | Miss |
| `BridgeRailing` | — | 0 / 26 | 312 | 312 | 312 | 100.0% | Miss |
| `CheckoutGeneric3m` | checkout-generic-3m | 0 / 27 | 304 | 304 | 304 | 100.0% | Miss |
| `RampSurface` | — | 1 / 2 | 128 | 183 | 300 | 42.7% | Pass |
| `RoofTruss` | roof-truss | 0 / 22 | 264 | 264 | 264 | 100.0% | Miss |
| `BusstopShort` | busstop-short | 0 / 24 | 260 | 260 | 260 | 100.0% | Miss |
| `CheckoutGeneric2m` | checkout-generic-2m | 0 / 23 | 256 | 256 | 256 | 100.0% | Miss |
| `LightCircular` | light-circular | 0 / 2 | 256 | 256 | 256 | 100.0% | Miss |
| `ShopCounter` | — | 0 / 23 | 256 | 256 | 256 | 100.0% | Miss |
| `Bench` | bench-seat-2 | 0 / 21 | 252 | 252 | 252 | 100.0% | Miss |
| `DoorWood2` | — | 0 / 20 | 240 | 240 | 240 | 100.0% | Miss |
| `CourtBadminton` | court-badminton | 0 / 20 | 228 | 228 | 228 (+1 line) | 100.0% | Miss |
| `ShopRoom` | shop-room | 0 / 18 | 216 | 216 | 216 | 100.0% | Miss |
| `StructureCeiling` | — | 0 / 2 | 216 | 216 | 216 | 100.0% | Miss |
| `StructureFloor` | — | 0 / 2 | 216 | 216 | 216 | 100.0% | Miss |
| `MonitorWall` | monitor-wall | 0 / 97 | 213 | 213 | 213 | 100.0% | Miss |
| `CheckoutGeneric` | checkout-generic | 0 / 19 | 208 | 208 | 208 | 100.0% | Miss |
| `Lawn` | lawn | 1 / 1 | 64 | 124 | 204 | 31.4% | Pass |
| `Bin` | bin | 0 / 28 | 196 | 196 | 196 | 100.0% | Miss |
| `CourtPickleball` | court-pickleball | 0 / 17 | 192 | 192 | 192 (+1 line) | 100.0% | Miss |
| `RetailRoom` | — | 0 / 16 | 192 | 192 | 192 | 100.0% | Miss |
| `BenchWood1` | bench-wood-1 | 0 / 15 | 180 | 180 | 180 | 100.0% | Miss |
| `BenchWood2` | bench-wood-2 | 0 / 15 | 180 | 180 | 180 | 100.0% | Miss |
| `PlatformEdgeHeader` | — | 0 / 11 | 174 | 174 | 174 | 100.0% | Miss |
| `Vent` | vent | 0 / 14 | 168 | 168 | 168 | 100.0% | Miss |
| `CityGuidepostBeijing` | — | 0 / 9 | 164 | 164 | 164 | 100.0% | Miss |
| `CityGuidepostShanghai` | — | 0 / 10 | 164 | 164 | 164 | 100.0% | Miss |
| `StructureWall` | — | 0 / 1 | 160 | 160 | 160 | 100.0% | Miss |
| `BenchSeat1` | bench-seat-1 | 0 / 13 | 156 | 156 | 156 | 100.0% | Miss |
| `Extinguisher` | extinguisher | 0 / 13 | 146 | 146 | 146 | 100.0% | Miss |
| `ExtinguisherCompact` | extinguisher-compact | 0 / 13 | 146 | 146 | 146 | 100.0% | Miss |
| `DoorWood1` | door-wood-1 | 0 / 12 | 144 | 144 | 144 | 100.0% | Miss |
| `CourtDivider` | court-divider | 0 / 11 | 132 | 132 | 132 | 100.0% | Miss |
| `Sidewalk` | sidewalk | 0 / 1 | 132 | 132 | 132 | 100.0% | Miss |
| `TvDouble` | tv-double | 0 / 16 | 132 | 132 | 132 | 100.0% | Miss |
| `PsdEnd` | generated:psd-end-full, psd-end | 0 / 8 | 114 | 114 | 114 | 100.0% | Miss |
| `Tv` | tv | 0 / 12 | 114 | 114 | 114 | 100.0% | Miss |
| `NoiseBarrier` | noise-barrier | 0 / 9 | 108 | 108 | 108 | 100.0% | Miss |
| `NoiseBarrierHalf` | noise-barrier-half | 0 / 9 | 108 | 108 | 108 | 100.0% | Miss |
| `TrafficLight` | traffic-light | 0 / 7 | 108 | 108 | 108 | 100.0% | Miss |
| `StructureFinishes` | — | 0 / 3 | 88 | 88 | 88 | 100.0% | Miss |
| `BenchSteel1` | bench-steel-1 | 0 / 7 | 84 | 84 | 84 | 100.0% | Miss |
| `BenchSteel2` | bench-steel-2 | 0 / 7 | 84 | 84 | 84 | 100.0% | Miss |
| `SignCeiling` | sign-ceiling | 0 / 7 | 74 | 74 | 74 | 100.0% | Miss |
| `MonitorCeiling` | monitor-ceiling | 0 / 11 | 72 | 72 | 72 | 100.0% | Miss |
| `CityGuidepostGuangzhou` | — | 0 / 17 | 60 | 60 | 60 | 100.0% | Miss |
| `CurtainWall` | generated:curtain-wall, curtain-wall | 0 / 5 | 60 | 60 | 60 | 100.0% | Miss |
| `ExitVirtual` | exit-virtual | 0 / 17 | 60 | 60 | 60 | 100.0% | Miss |
| `Glass1x1` | glass-1x1 | 0 / 5 | 60 | 60 | 60 | 100.0% | Miss |
| `Glass1x2` | glass-1x2 | 0 / 5 | 60 | 60 | 60 | 100.0% | Miss |
| `Glass1x4` | — | 0 / 5 | 60 | 60 | 60 | 100.0% | Miss |
| `Glass2x1` | glass-2x1 | 0 / 5 | 60 | 60 | 60 | 100.0% | Miss |
| `Glass2x2` | glass-2x2 | 0 / 5 | 60 | 60 | 60 | 100.0% | Miss |
| `Glass2x4` | glass-2x4 | 0 / 5 | 60 | 60 | 60 | 100.0% | Miss |
| `Glass3x1` | glass-3x1 | 0 / 5 | 60 | 60 | 60 | 100.0% | Miss |
| `Glass3x2` | glass-3x2 | 0 / 5 | 60 | 60 | 60 | 100.0% | Miss |
| `Glass3x4` | — | 0 / 5 | 60 | 60 | 60 | 100.0% | Miss |
| `Glass4x4` | — | 0 / 5 | 60 | 60 | 60 | 100.0% | Miss |
| `Guidepost` | guidepost | 0 / 17 | 60 | 60 | 60 | 100.0% | Miss |
| `HangerRoof` | hanger-roof | 0 / 5 | 60 | 60 | 60 | 100.0% | Miss |
| `TactileGuide` | tactile-guide | 0 / 5 | 60 | 60 | 60 | 100.0% | Miss |
| `PlatformEdgeDecals` | — | 0 / 29 | 58 | 58 | 58 | 100.0% | Miss |
| `StationPanels` | — | 0 / 8 | 56 | 56 | 56 | 100.0% | Miss |
| `CityGuidepostChengdu` | — | 0 / 13 | 50 | 50 | 50 | 100.0% | Miss |
| `Road` | road | 0 / 5 | 50 | 50 | 50 | 100.0% | Miss |
| `StreetArrows` | — | 0 / 5 | 50 | 50 | 50 | 100.0% | Miss |
| `StairBlock` | generated:stair, stair-block | 0 / 4 | 48 | 48 | 48 | 100.0% | Miss |
| `LinemapStand` | linemap-stand | 0 / 5 | 40 | 40 | 40 | 100.0% | Miss |
| `HangerPost` | hanger-post | 0 / 3 | 36 | 36 | 36 | 100.0% | Miss |
| `PillarSlim` | generated:pillar-run | 0 / 3 | 36 | 36 | 36 | 100.0% | Miss |
| `Billboard16x9_3m` | billboard-16x9-3m | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `Billboard16x9_4m` | billboard-16x9-4m | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `Billboard4x3_3m` | billboard-4x3-3m | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `Billboard4x3_4m` | billboard-4x3-4m | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `BillboardLarge` | billboard-large | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `BillboardPanorama` | billboard-panorama | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `BillboardPortrait` | billboard-portrait | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `BillboardSquare` | billboard-square | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `BillboardStandard` | billboard-standard | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `BillboardWide` | billboard-wide | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `CityDoorwayBeijing` | — | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `CityDoorwayChengdu` | — | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `CityDoorwayChongqing` | — | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `CityDoorwayGuangzhou` | — | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `CityDoorwayNanjing` | — | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `CityDoorwayShanghai` | — | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `CityDoorwayShenzhen` | — | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `CityDoorwayWuhan` | — | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `ExitDoorway1` | exit-doorway-1 | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `ExitDoorway2` | exit-doorway-2 | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `ExitDoorway3` | exit-doorway-3 | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `ExitDoorway4` | exit-doorway-4 | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `LinemapWall` | linemap-wall | 0 / 3 | 26 | 26 | 26 | 100.0% | Miss |
| `BridgeEdgeConcrete` | — | 0 / 2 | 24 | 24 | 24 | 100.0% | Miss |
| `LightRectangular` | light-rectangular | 0 / 2 | 24 | 24 | 24 | 100.0% | Miss |
| `NoiseBarrierRailing` | noise-barrier-railing | 0 / 2 | 24 | 24 | 24 | 100.0% | Miss |
| `RoofShell` | roof-shell | 0 / 2 | 24 | 24 | 24 | 100.0% | Miss |
| `TrainMarkBeijing` | — | 0 / 2 | 14 | 14 | 14 | 100.0% | Miss |
| `TrainMarkChongqing` | — | 0 / 2 | 14 | 14 | 14 | 100.0% | Miss |
| `TrainMarkGuangzhou` | — | 0 / 2 | 14 | 14 | 14 | 100.0% | Miss |
| `TrainMarkNanjing` | — | 0 / 2 | 14 | 14 | 14 | 100.0% | Miss |
| `PsdEndCover` | psd-end-cover | 0 / 1 | 12 | 12 | 12 | 100.0% | Miss |
| `Roof` | roof | 0 / 1 | 12 | 12 | 12 | 100.0% | Miss |
| `CalligraphyHeiH` | calligraphy-hei-h | 0 / 1 | 2 | 2 | 2 | 100.0% | Exception |
| `CalligraphyHeiV` | calligraphy-hei-v | 0 / 1 | 2 | 2 | 2 | 100.0% | Exception |
| `CalligraphyKaiH` | calligraphy-kai-h | 0 / 1 | 2 | 2 | 2 | 100.0% | Exception |
| `CalligraphyKaiV` | calligraphy-kai-v | 0 / 1 | 2 | 2 | 2 | 100.0% | Exception |
| `CalligraphyLiH` | calligraphy-li-h | 0 / 1 | 2 | 2 | 2 | 100.0% | Exception |
| `CalligraphyLiV` | calligraphy-li-v | 0 / 1 | 2 | 2 | 2 | 100.0% | Exception |
| `CalligraphySongH` | calligraphy-song-h | 0 / 1 | 2 | 2 | 2 | 100.0% | Exception |
| `CalligraphySongV` | calligraphy-song-v | 0 / 1 | 2 | 2 | 2 | 100.0% | Exception |
| `CalligraphyWeiH` | calligraphy-wei-h | 0 / 1 | 2 | 2 | 2 | 100.0% | Exception |
| `CalligraphyWeiV` | calligraphy-wei-v | 0 / 1 | 2 | 2 | 2 | 100.0% | Exception |
| `CalligraphyXingH` | calligraphy-xing-h | 0 / 1 | 2 | 2 | 2 | 100.0% | Exception |
| `CalligraphyXingV` | calligraphy-xing-v | 0 / 1 | 2 | 2 | 2 | 100.0% | Exception |
| `FloorMarkBoarding` | floor-mark-boarding | 0 / 1 | 2 | 2 | 2 | 100.0% | Exception |
| `FloorMarkDirection` | floor-mark-direction | 0 / 1 | 2 | 2 | 2 | 100.0% | Exception |
| `FloorMarkWaiting` | floor-mark-waiting | 0 / 1 | 2 | 2 | 2 | 100.0% | Exception |
| `SignWall` | sign-wall | 0 / 1 | 2 | 2 | 2 | 100.0% | Exception |

## Generated & retained procedural modules

Procedural C# builders that emit native 3-tier index ranges via `StationMeshLodIndices`:

| Procedural model | LOD2 (Low) | LOD1 (Balanced) | LOD0 (High) | Low / High | Target | Policy |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| pillar-round (1×3 m) | 32 | 64 | 128 | 25.0% | Pass | Closed 32 / 16 / 8 segment cylinder |
| track-24m (third-rail) | 1916 | 3836 | 5756 | 33.3% | Pass | Rail heads and sleepers retained; fasteners/clips drop at LOD1/LOD2 |
| track-24m (catenary) | 1820 | 3740 | 5660 | 32.2% | Pass | Rail heads and sleepers retained; fasteners/clips drop at LOD1/LOD2 |
| booth-ticket (3×3 m) | 192 | 396 | 396 | 48.5% | Pass | Low retains the counter, fascia and glazing; small fittings, posts and recess trim are omitted |
| booth-info (3×3 m) | 144 | 336 | 384 | 37.5% | Pass | Low retains the counter, fascia and glazing; small fittings, posts and recess trim are omitted |

Explicitly retained procedural paths (same geometry across `LOD0`–`LOD2` to preserve motion, walk-contact, cutaway, or pick fidelity):

| Family / system | Policy |
| --- | --- |
| `escalator` | Step band, comb plate, landing, side shell, and handrails retain motion and section outlines. |
| `gate` | Gate leaf and adjacent fence retain exact span, gaps, hinges, and passable opening. |
| `glass` | Already built from flat panes and straight frames; pane edges and cutaway extents stay exact. |
| `lift` | Cabin, door leaf, and shaft surfaces retain floor stops, motion, and vertical cutaways. |
| `platform-edge` | Retains platform edge, independent moving leaves, infill gaps, and content surfaces. |
| `psd-end` | Retains exact return faces meeting the platform wall without opening seams. |
| `stair` | Treads, landings, and rails retain walk-contact and section silhouettes. |
| `station-cell-chunks` | Exposed cell faces stay exact across tiers for cuts, face picks, finishes, and ambient shading. |
| `construction-and-catalogue-previews` | Uses `LOD0` (Full) so previews match placed geometry. |

## Train models (车辆)

All 50 selectable formations (`A`/`B`/`C`/`D`/`L` × 2, 3, 4, 6, or 8 cars × Third-rail / Catenary), measured after Unity runtime consist compaction (`TrainConsistViews.CompactConsistInstance`). Low uses baked geometry from the train exporter for car bodies, moving door leaves, gangways, and pantographs. The original door transforms, material slots, glass and signage stay in place. The compactor also omits selected small opaque details such as bolts, springs, straps, ring lights, and vents.

Low submits **55.1%–70.3% fewer triangles** than High per formation when the whole formation uses LOD2. The buffers carry the High and Low geometry together. These are triangle counts for the selected tier. The camera and graphics profile determine when the renderer selects each tier.

| Train model | Third-rail LOD2 | Third-rail LOD1 | Third-rail LOD0 | Third-rail saved | Catenary LOD2 | Catenary LOD1 | Catenary LOD0 | Catenary saved |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A-2 | 109201 | 251292 | 263836 | 58.6% (Pass) | 117949 | 264316 | 276860 | 57.4% (Pass) |
| A-3 | 143162 | 324058 | 342874 | 58.2% (Pass) | 151910 | 337082 | 355898 | 57.3% (Pass) |
| A-4 | 177123 | 396824 | 421912 | 58.0% (Pass) | 185871 | 409848 | 434936 | 57.3% (Pass) |
| A-6 | 245045 | 542356 | 579988 | 57.7% (Pass) | 253793 | 555380 | 593012 | 57.2% (Pass) |
| A-8 | 312967 | 687888 | 738064 | 57.6% (Pass) | 326089 | 707424 | 757600 | 57.0% (Pass) |
| B-2 | 101628 | 232720 | 245264 | 58.6% (Pass) | 110376 | 245744 | 258288 | 57.3% (Pass) |
| B-3 | 131505 | 295454 | 314270 | 58.2% (Pass) | 140253 | 308478 | 327294 | 57.1% (Pass) |
| B-4 | 161382 | 358188 | 383276 | 57.9% (Pass) | 170130 | 371212 | 396300 | 57.1% (Pass) |
| B-6 | 221136 | 483656 | 521288 | 57.6% (Pass) | 229884 | 496680 | 534312 | 57.0% (Pass) |
| B-8 | 280890 | 609124 | 659300 | 57.4% (Pass) | 294012 | 628660 | 678836 | 56.7% (Pass) |
| C-2 | 91273 | 246000 | 258544 | 64.7% (Pass) | 100021 | 259024 | 271568 | 63.2% (Pass) |
| C-3 | 122798 | 310250 | 329066 | 62.7% (Pass) | 131546 | 323274 | 342090 | 61.5% (Pass) |
| C-4 | 154323 | 374500 | 399588 | 61.4% (Pass) | 163071 | 387524 | 412612 | 60.5% (Pass) |
| C-6 | 217373 | 503000 | 540632 | 59.8% (Pass) | 226121 | 516024 | 553656 | 59.2% (Pass) |
| C-8 | 280423 | 631500 | 681676 | 58.9% (Pass) | 289171 | 644524 | 694700 | 58.4% (Pass) |
| D-2 | 124356 | 406284 | 418828 | 70.3% (Pass) | 133184 | 419388 | 431932 | 69.2% (Pass) |
| D-3 | 171814 | 548274 | 567090 | 69.7% (Pass) | 180642 | 561378 | 580194 | 68.9% (Pass) |
| D-4 | 219272 | 690264 | 715352 | 69.3% (Pass) | 228100 | 703368 | 728456 | 68.7% (Pass) |
| D-6 | 314188 | 974244 | 1011876 | 68.9% (Pass) | 323016 | 987348 | 1024980 | 68.5% (Pass) |
| D-8 | 409104 | 1258224 | 1308400 | 68.7% (Pass) | 417932 | 1271328 | 1321504 | 68.4% (Pass) |
| L-2 | 95056 | 213992 | 226536 | 58.0% (Pass) | 103804 | 227016 | 239560 | 56.7% (Pass) |
| L-3 | 122775 | 268666 | 287482 | 57.3% (Pass) | 131523 | 281690 | 300506 | 56.2% (Pass) |
| L-4 | 150494 | 323340 | 348428 | 56.8% (Pass) | 159242 | 336364 | 361452 | 55.9% (Pass) |
| L-6 | 205932 | 432688 | 470320 | 56.2% (Pass) | 219054 | 452224 | 489856 | 55.3% (Pass) |
| L-8 | 261370 | 542036 | 592212 | 55.9% (Pass) | 274492 | 561572 | 611748 | 55.1% (Pass) |

## Passenger models (乘客)

### Public stand-in passenger assets

| Asset | Meshes | LOD2 (Low) | LOD1 (Balanced) | LOD0 (High) | Target |
| --- | ---: | ---: | ---: | ---: | --- |
| `passenger-adult` | 7 | 2350 | 2350 | 2350 | Miss |
| `soft-human-adult-commuter-daypack-low` | 1 | 592 | 592 | 592 | Miss |

### Local soft-human passenger library (440 variants, review-only)

All 440 local soft-human passenger recipes (`INTERNAL_REVIEW_ONLY`), grouped when exact `LOD0` / `LOD1` / `LOD2` triangle counts match. Source counts come from `passenger-library.manifest.json` (`LOD0`) and `.preview/unity/passenger-lod-library/passenger-lods.json` (`LOD1`, `LOD2`).

| Variants | LOD2 (Low) | LOD1 (Balanced) | LOD0 (High) | Low / High | Target |
| ---: | ---: | ---: | ---: | ---: | --- |
| 2 | 791 | 4049 | 8101 | 9.8% | Pass |
| 2 | 774 | 4008 | 8016 | 9.7% | Pass |
| 2 | 715 | 3690 | 7382 | 9.7% | Pass |
| 2 | 704 | 3647 | 7297 | 9.6% | Pass |
| 5 | 684 | 3879 | 7149 | 9.6% | Pass |
| 2 | 690 | 3601 | 7149 | 9.7% | Pass |
| 1 | 678 | 4329 | 7145 | 9.5% | Pass |
| 1 | 670 | 3713 | 7021 | 9.5% | Pass |
| 5 | 673 | 3770 | 6976 | 9.6% | Pass |
| 2 | 664 | 3788 | 6968 | 9.5% | Pass |
| 2 | 672 | 3767 | 6961 | 9.7% | Pass |
| 1 | 668 | 3630 | 6894 | 9.7% | Pass |
| 6 | 659 | 3780 | 6888 | 9.6% | Pass |
| 2 | 671 | 3430 | 6862 | 9.8% | Pass |
| 2 | 669 | 3430 | 6862 | 9.7% | Pass |
| 2 | 669 | 3429 | 6861 | 9.8% | Pass |
| 2 | 669 | 3428 | 6860 | 9.8% | Pass |
| 11 | 660 | 3638 | 6858 | 9.6% | Pass |
| 2 | 654 | 3387 | 6777 | 9.7% | Pass |
| 2 | 653 | 3387 | 6777 | 9.6% | Pass |
| 2 | 654 | 3388 | 6776 | 9.7% | Pass |
| 2 | 653 | 3387 | 6775 | 9.6% | Pass |
| 2 | 658 | 3379 | 6761 | 9.7% | Pass |
| 2 | 655 | 3379 | 6761 | 9.7% | Pass |
| 2 | 658 | 3378 | 6760 | 9.7% | Pass |
| 2 | 657 | 3378 | 6760 | 9.7% | Pass |
| 2 | 643 | 3338 | 6676 | 9.6% | Pass |
| 2 | 640 | 3338 | 6676 | 9.6% | Pass |
| 2 | 645 | 3337 | 6675 | 9.7% | Pass |
| 2 | 642 | 3337 | 6675 | 9.6% | Pass |
| 5 | 616 | 3518 | 6430 | 9.6% | Pass |
| 2 | 616 | 3240 | 6430 | 9.6% | Pass |
| 1 | 614 | 3968 | 6426 | 9.6% | Pass |
| 1 | 604 | 3352 | 6302 | 9.6% | Pass |
| 5 | 603 | 3409 | 6257 | 9.6% | Pass |
| 2 | 594 | 3429 | 6249 | 9.5% | Pass |
| 2 | 592 | 3406 | 6242 | 9.5% | Pass |
| 1 | 590 | 3271 | 6175 | 9.6% | Pass |
| 6 | 593 | 3419 | 6169 | 9.6% | Pass |
| 11 | 590 | 3279 | 6139 | 9.6% | Pass |
| 5 | 565 | 3258 | 5910 | 9.6% | Pass |
| 5 | 564 | 3258 | 5910 | 9.5% | Pass |
| 2 | 574 | 2980 | 5910 | 9.7% | Pass |
| 2 | 569 | 2980 | 5910 | 9.6% | Pass |
| 5 | 562 | 3259 | 5909 | 9.5% | Pass |
| 2 | 568 | 2981 | 5909 | 9.6% | Pass |
| 5 | 563 | 3258 | 5908 | 9.5% | Pass |
| 2 | 573 | 2980 | 5908 | 9.7% | Pass |
| 1 | 564 | 3708 | 5906 | 9.5% | Pass |
| 1 | 561 | 3708 | 5906 | 9.5% | Pass |
| 1 | 565 | 3709 | 5905 | 9.6% | Pass |
| 1 | 564 | 3708 | 5904 | 9.6% | Pass |
| 5 | 554 | 3209 | 5809 | 9.5% | Pass |
| 5 | 550 | 3209 | 5809 | 9.5% | Pass |
| 2 | 560 | 2931 | 5809 | 9.6% | Pass |
| 2 | 558 | 2931 | 5809 | 9.6% | Pass |
| 5 | 554 | 3208 | 5808 | 9.5% | Pass |
| 5 | 552 | 3208 | 5808 | 9.5% | Pass |
| 2 | 560 | 2930 | 5808 | 9.6% | Pass |
| 2 | 558 | 2930 | 5808 | 9.6% | Pass |
| 1 | 548 | 3659 | 5805 | 9.4% | Pass |
| 1 | 546 | 3659 | 5805 | 9.4% | Pass |
| 1 | 550 | 3658 | 5804 | 9.5% | Pass |
| 1 | 548 | 3658 | 5804 | 9.4% | Pass |
| 1 | 560 | 3092 | 5782 | 9.7% | Pass |
| 1 | 549 | 3092 | 5782 | 9.5% | Pass |
| 1 | 560 | 3093 | 5781 | 9.7% | Pass |
| 1 | 549 | 3092 | 5780 | 9.5% | Pass |
| 5 | 556 | 3149 | 5737 | 9.7% | Pass |
| 5 | 555 | 3149 | 5737 | 9.7% | Pass |
| 5 | 554 | 3150 | 5736 | 9.7% | Pass |
| 5 | 553 | 3149 | 5735 | 9.6% | Pass |
| 2 | 549 | 3169 | 5729 | 9.6% | Pass |
| 2 | 544 | 3169 | 5729 | 9.5% | Pass |
| 2 | 545 | 3168 | 5728 | 9.5% | Pass |
| 2 | 550 | 3167 | 5727 | 9.6% | Pass |
| 2 | 551 | 3146 | 5722 | 9.6% | Pass |
| 2 | 548 | 3146 | 5722 | 9.6% | Pass |
| 2 | 547 | 3147 | 5721 | 9.6% | Pass |
| 2 | 550 | 3146 | 5720 | 9.6% | Pass |
| 1 | 547 | 3043 | 5681 | 9.6% | Pass |
| 1 | 545 | 3043 | 5681 | 9.6% | Pass |
| 2 | 545 | 3042 | 5680 | 9.6% | Pass |
| 1 | 546 | 3011 | 5655 | 9.7% | Pass |
| 1 | 543 | 3011 | 5655 | 9.6% | Pass |
| 1 | 549 | 3010 | 5654 | 9.7% | Pass |
| 1 | 544 | 3009 | 5653 | 9.6% | Pass |
| 6 | 543 | 3159 | 5649 | 9.6% | Pass |
| 6 | 540 | 3159 | 5649 | 9.6% | Pass |
| 6 | 544 | 3160 | 5648 | 9.6% | Pass |
| 6 | 541 | 3159 | 5647 | 9.6% | Pass |
| 10 | 543 | 3100 | 5636 | 9.6% | Pass |
| 5 | 545 | 3099 | 5635 | 9.7% | Pass |
| 5 | 543 | 3099 | 5635 | 9.6% | Pass |
| 4 | 524 | 3118 | 5628 | 9.3% | Pass |
| 4 | 524 | 3117 | 5627 | 9.3% | Pass |
| 2 | 540 | 3097 | 5621 | 9.6% | Pass |
| 2 | 538 | 3097 | 5621 | 9.6% | Pass |
| 2 | 538 | 3096 | 5620 | 9.6% | Pass |
| 2 | 536 | 3096 | 5620 | 9.5% | Pass |
| 11 | 548 | 3019 | 5619 | 9.8% | Pass |
| 11 | 539 | 3019 | 5619 | 9.6% | Pass |
| 11 | 549 | 3018 | 5618 | 9.8% | Pass |
| 11 | 538 | 3017 | 5617 | 9.6% | Pass |
| 1 | 536 | 2960 | 5554 | 9.7% | Pass |
| 1 | 534 | 2960 | 5554 | 9.6% | Pass |
| 1 | 536 | 2959 | 5553 | 9.7% | Pass |
| 1 | 534 | 2959 | 5553 | 9.6% | Pass |
| 6 | 533 | 3110 | 5548 | 9.6% | Pass |
| 6 | 531 | 3110 | 5548 | 9.6% | Pass |
| 12 | 533 | 3109 | 5547 | 9.6% | Pass |
| 22 | 530 | 2968 | 5518 | 9.6% | Pass |
| 22 | 528 | 2967 | 5517 | 9.6% | Pass |
| 2 | 523 | 2710 | 5422 | 9.6% | Pass |
| 2 | 512 | 2667 | 5337 | 9.6% | Pass |
| 5 | 430 | 2538 | 4470 | 9.6% | Pass |
| 2 | 426 | 2260 | 4470 | 9.5% | Pass |
| 1 | 424 | 2988 | 4466 | 9.5% | Pass |
| 1 | 415 | 2372 | 4342 | 9.6% | Pass |
| 5 | 413 | 2429 | 4297 | 9.6% | Pass |
| 2 | 408 | 2449 | 4289 | 9.5% | Pass |
| 2 | 410 | 2426 | 4282 | 9.6% | Pass |
| 1 | 402 | 2291 | 4215 | 9.5% | Pass |
| 6 | 399 | 2439 | 4209 | 9.5% | Pass |
| 11 | 400 | 2299 | 4179 | 9.6% | Pass |
