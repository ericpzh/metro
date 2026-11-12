# Unity model migration checklist

This file is the shared assignment and completion record for runtime game models. Assign work by model family. Each row records verification for its own variant and can point to a shared prefab, generator, or evidence report.

See the [model audit and runtime integration plan](10-model-runtime-integration.md) for current gameplay coverage and the steps to wire these assets into Zoo.

Inventory snapshot at `c2f6fd40` from the current working tree. Covers all 152 build palette IDs and 10 additional bench, door and glass variants, plus the non-palette work below. Sizes, rotations and user-authored content belong in parameter test cases, with distinct rows for finite variants as they are discovered.

## Claim and finish a model family

1. Read this file and the [asset subplan](02-assets.md). Assign one agent the related TODO variants that share a source builder, Unity generator, materials or review setup. Before editing code, that agent lists the IDs in the assignment and claims the rows together by setting Owner and IN PROGRESS. If part of the family already has an owner, coordinate the remaining scope with that owner. Split a large family only where the implementation can be edited independently, and name who owns the shared code.
2. Trace the palette ID through [catalog.ts](../../game/src/app/store/catalog.ts) and [models.ts](../../game/src/render/models.ts). Record any extra geometry variants, materials, motion, attachment anchors and source provenance. Use the [asset skill](skill-drafts/metro-unity-assets/SKILL.md) for the bench, bin and train examples. Use glTFast for reusable meshes. Port geometry that depends on station dimensions or neighbors to a Unity runtime generator and test representative parameters.
3. Reuse the same exporter, generator and review setup across the family. Keep stable recipe IDs or document how the shared generator selects each variant. Add the exact generation and validation commands and review evidence to the rows or a linked recipe. The current manifest importer recognizes fixture kinds. Extend its contract when needed and check the existing fixtures and transaction regression.
4. Validate geometry and any relevant materials, textures, anchors and motion in Unity. Render or exercise the asset in Web. Deliver the verified model and wrapper or runtime generator under unity/Assets with its metadata. Mark each row DONE once the evidence covers that variant. A family report can cover several rows if it identifies the cases and outcomes.
5. Use PARTIAL for a useful but limited implementation and BLOCKED with a concrete reason when work cannot proceed. Include the next check or dependency in the evidence column. Keep TODO for unclaimed work. Use the source-audit rows to close coverage gaps and reconcile the palette with this table before declaring the whole catalogue migrated.
6. Clean up your own preview. Run the family proof through `./tools/unity-assets/prove-model.ps1`, which promotes the verified GLBs, prefabs and review scenes into `unity/Assets/StationDesigner/Generated` and then deletes its `.preview/unity/<family>-*` evidence and `D:\metro-unity-scratch\<family>-*` project on success. A debug run (`-SkipPromote`) keeps both; delete them yourself before reporting done. The deliverable is the asset files under `unity/` plus the catalogue row, not evidence documents.

For example, assign all nine `stair-*` rows to one agent. Review the shared stair builder and the stair-block path, reuse their common Unity geometry and review setup where applicable, then verify each straight, forward-offset, quarter-turn, switchback and block variant. Other useful assignments are both fare gate variants, the exit family and platform-edge equipment. Coordinate shared exporter, importer and catalogue edits across families.

## Station palette and additional variants

| ID | Source family / coverage | Status | Owner | Unity output / evidence |
| --- | --- | --- | --- | --- |
| `ac-unit` | ac-unit | DONE | flash-fixture | [AcUnit prefab](../Assets/StationDesigner/Generated/Prefabs/AcUnit.prefab) |
| `bench-office-1` | bench | DONE | flash-fixture | [BenchOffice1 prefab](../Assets/StationDesigner/Generated/Prefabs/BenchOffice1.prefab) |
| `bench-seat-1` | bench | DONE | flash-fixture | [BenchSeat1 prefab](../Assets/StationDesigner/Generated/Prefabs/BenchSeat1.prefab) |
| `bench-seat-2` | bench | DONE | | [Bench prefab](../Assets/StationDesigner/Generated/Prefabs/Bench.prefab) · `./tools/unity-assets/prove-bench.ps1 -Asset bench` |
| `bench-steel-1` | bench | DONE | flash-fixture | [BenchSteel1 prefab](../Assets/StationDesigner/Generated/Prefabs/BenchSteel1.prefab) |
| `bench-steel-2` | bench | DONE | flash-fixture | [BenchSteel2 prefab](../Assets/StationDesigner/Generated/Prefabs/BenchSteel2.prefab) |
| `bench-wood-1` | bench | DONE | flash-fixture | [BenchWood1 prefab](../Assets/StationDesigner/Generated/Prefabs/BenchWood1.prefab) |
| `bench-wood-2` | bench | DONE | flash-fixture | [BenchWood2 prefab](../Assets/StationDesigner/Generated/Prefabs/BenchWood2.prefab) |
| `billboard-16x9-3m` | billboard | DONE | flash-advert | [Billboard16x9_3m prefab](../Assets/StationDesigner/Generated/Prefabs/Billboard16x9_3m.prefab) · fixed poster landscape-1-jfif |
| `billboard-16x9-4m` | billboard | DONE | flash-advert | [Billboard16x9_4m prefab](../Assets/StationDesigner/Generated/Prefabs/Billboard16x9_4m.prefab) · fixed poster landscape-1-jfif |
| `billboard-4x3-3m` | billboard | DONE | flash-advert | [Billboard4x3_3m prefab](../Assets/StationDesigner/Generated/Prefabs/Billboard4x3_3m.prefab) · fixed poster landscape-1-jfif |
| `billboard-4x3-4m` | billboard | DONE | flash-advert | [Billboard4x3_4m prefab](../Assets/StationDesigner/Generated/Prefabs/Billboard4x3_4m.prefab) · fixed poster landscape-1-jfif |
| `billboard-large` | billboard | DONE | flash-advert | [BillboardLarge prefab](../Assets/StationDesigner/Generated/Prefabs/BillboardLarge.prefab) · fixed poster landscape-1-jfif |
| `billboard-panorama` | billboard | DONE | flash-advert | [BillboardPanorama prefab](../Assets/StationDesigner/Generated/Prefabs/BillboardPanorama.prefab) · fixed poster landscape-1-jfif |
| `billboard-portrait` | billboard | DONE | flash-advert | [BillboardPortrait prefab](../Assets/StationDesigner/Generated/Prefabs/BillboardPortrait.prefab) · fixed poster portrait-1-jpeg |
| `billboard-square` | billboard | DONE | flash-advert | [BillboardSquare prefab](../Assets/StationDesigner/Generated/Prefabs/BillboardSquare.prefab) · fixed poster square-18-jpg |
| `billboard-standard` | billboard | DONE | flash-advert | [BillboardStandard prefab](../Assets/StationDesigner/Generated/Prefabs/BillboardStandard.prefab) · fixed poster landscape-1-jfif |
| `billboard-wide` | billboard | DONE | flash-advert | [BillboardWide prefab](../Assets/StationDesigner/Generated/Prefabs/BillboardWide.prefab) · fixed poster landscape-1-jfif; solid steel palette |
| `bin` | bin | DONE | | [Bin prefab](../Assets/StationDesigner/Generated/Prefabs/Bin.prefab) · `./tools/unity-assets/prove-bench.ps1 -Asset bin` |
| `bridge` | track | DONE | flash-transit | [Bridge prefab](../Assets/StationDesigner/Generated/Prefabs/Bridge.prefab) · instanced sleepers/fastenings baked |
| `busstop-long` | busstop | DONE | flash-canopy | [BusstopLong prefab](../Assets/StationDesigner/Generated/Prefabs/BusstopLong.prefab) · frozen catalogue campaign plate |
| `busstop-short` | busstop | DONE | flash-canopy | [BusstopShort prefab](../Assets/StationDesigner/Generated/Prefabs/BusstopShort.prefab) · frozen catalogue campaign plate |
| `calligraphy-hei-h` | calligraphy | DONE | flash-script | [CalligraphyHeiH prefab](../Assets/StationDesigner/Generated/Prefabs/CalligraphyHeiH.prefab) · sample inscription 人民广场; live-name reprint is runtime binding |
| `calligraphy-hei-v` | calligraphy | DONE | flash-script | [CalligraphyHeiV prefab](../Assets/StationDesigner/Generated/Prefabs/CalligraphyHeiV.prefab) · sample inscription 人民广场; vertical band |
| `calligraphy-kai-h` | calligraphy | DONE | flash-script | [CalligraphyKaiH prefab](../Assets/StationDesigner/Generated/Prefabs/CalligraphyKaiH.prefab) · sample inscription 人民广场 |
| `calligraphy-kai-v` | calligraphy | DONE | flash-script | [CalligraphyKaiV prefab](../Assets/StationDesigner/Generated/Prefabs/CalligraphyKaiV.prefab) · sample inscription 人民广场; vertical band |
| `calligraphy-li-h` | calligraphy | DONE | flash-script | [CalligraphyLiH prefab](../Assets/StationDesigner/Generated/Prefabs/CalligraphyLiH.prefab) · sample inscription 人民广场 |
| `calligraphy-li-v` | calligraphy | DONE | flash-script | [CalligraphyLiV prefab](../Assets/StationDesigner/Generated/Prefabs/CalligraphyLiV.prefab) · sample inscription 人民广场; vertical band |
| `calligraphy-song-h` | calligraphy | DONE | flash-script | [CalligraphySongH prefab](../Assets/StationDesigner/Generated/Prefabs/CalligraphySongH.prefab) · sample inscription 人民广场 |
| `calligraphy-song-v` | calligraphy | DONE | flash-script | [CalligraphySongV prefab](../Assets/StationDesigner/Generated/Prefabs/CalligraphySongV.prefab) · sample inscription 人民广场; vertical band |
| `calligraphy-wei-h` | calligraphy | DONE | flash-script | [CalligraphyWeiH prefab](../Assets/StationDesigner/Generated/Prefabs/CalligraphyWeiH.prefab) · sample inscription 人民广场 |
| `calligraphy-wei-v` | calligraphy | DONE | flash-script | [CalligraphyWeiV prefab](../Assets/StationDesigner/Generated/Prefabs/CalligraphyWeiV.prefab) · sample inscription 人民广场; vertical band |
| `calligraphy-xing-h` | calligraphy | DONE | flash-script | [CalligraphyXingH prefab](../Assets/StationDesigner/Generated/Prefabs/CalligraphyXingH.prefab) · sample inscription 人民广场 |
| `calligraphy-xing-v` | calligraphy | DONE | flash-script | [CalligraphyXingV prefab](../Assets/StationDesigner/Generated/Prefabs/CalligraphyXingV.prefab) · sample inscription 人民广场; vertical band |
| `cctv` | cctv | DONE | flash-cctv | [Cctv prefab](../Assets/StationDesigner/Generated/Prefabs/Cctv.prefab) |
| `cctv-dome` | cctv | DONE | flash-cctv | [CctvDome prefab](../Assets/StationDesigner/Generated/Prefabs/CctvDome.prefab) |
| `cctv-post` | cctv | DONE | flash-cctv | [CctvPost prefab](../Assets/StationDesigner/Generated/Prefabs/CctvPost.prefab) |
| `cctv-ptz` | cctv | DONE | flash-cctv | [CctvPtz prefab](../Assets/StationDesigner/Generated/Prefabs/CctvPtz.prefab) |
| `checkout` | checkout | DONE | flash-concourse | [Checkout prefab](../Assets/StationDesigner/Generated/Prefabs/Checkout.prefab) · POS island layout; instanced stock baked |
| `checkout-cafe` | checkout | DONE | flash-concourse | [CheckoutCafe prefab](../Assets/StationDesigner/Generated/Prefabs/CheckoutCafe.prefab) |
| `checkout-cafe-pastry` | checkout | DONE | flash-concourse | [CheckoutCafePastry prefab](../Assets/StationDesigner/Generated/Prefabs/CheckoutCafePastry.prefab) · glass pastry front |
| `checkout-generic` | checkout | DONE | flash-concourse | [CheckoutGeneric prefab](../Assets/StationDesigner/Generated/Prefabs/CheckoutGeneric.prefab) |
| `clock` | clock | DONE | flash-display | [Clock prefab](../Assets/StationDesigner/Generated/Prefabs/Clock.prefab) · fixed 10:09 pose; hand pivots preserved |
| `clock-digital` | clock | DONE | flash-display | [ClockDigital prefab](../Assets/StationDesigner/Generated/Prefabs/ClockDigital.prefab) |
| `court-badminton` | court | DONE | flash-printed | [CourtBadminton prefab](../Assets/StationDesigner/Generated/Prefabs/CourtBadminton.prefab) · court net is a LINES mesh (courtNetInk) |
| `court-divider` | court | DONE | flash-printed | [CourtDivider prefab](../Assets/StationDesigner/Generated/Prefabs/CourtDivider.prefab) |
| `court-pickleball` | court | DONE | flash-printed | [CourtPickleball prefab](../Assets/StationDesigner/Generated/Prefabs/CourtPickleball.prefab) · court net is a LINES mesh (courtNetInk) |
| `cubicle` | cubicle | DONE | flash-opening | [Cubicle prefab](../Assets/StationDesigner/Generated/Prefabs/Cubicle.prefab) · three partitions when isolated; door pivot preserved |
| `cubicle-toilet` | cubicle | DONE | flash-opening | [CubicleToilet prefab](../Assets/StationDesigner/Generated/Prefabs/CubicleToilet.prefab) · standalone toilet variant with ceramic fixtures |
| `curtain-wall` | glass | DONE | flash-glass | [CurtainWall prefab](../Assets/StationDesigner/Generated/Prefabs/CurtainWall.prefab) · default 2 m × 4 m (2×4 panel builder); width/height are placement parameters |
| `desk` | desk | DONE | flash-fixture | [Desk prefab](../Assets/StationDesigner/Generated/Prefabs/Desk.prefab) |
| `door-glass-1` | door | DONE | flash-opening | [DoorGlass1 prefab](../Assets/StationDesigner/Generated/Prefabs/DoorGlass1.prefab) |
| `door-glass-2` | door | DONE | flash-opening | [DoorGlass2 prefab](../Assets/StationDesigner/Generated/Prefabs/DoorGlass2.prefab) |
| `door-steel-1` | door | DONE | flash-opening | [DoorSteel1 prefab](../Assets/StationDesigner/Generated/Prefabs/DoorSteel1.prefab) |
| `door-steel-2` | door | DONE | flash-opening | [DoorSteel2 prefab](../Assets/StationDesigner/Generated/Prefabs/DoorSteel2.prefab) |
| `door-wood-1` | door | DONE | flash-opening | [DoorWood1 prefab](../Assets/StationDesigner/Generated/Prefabs/DoorWood1.prefab) |
| `door-wood-2` | door | DONE | flash-opening | [DoorWood2 prefab](../Assets/StationDesigner/Generated/Prefabs/DoorWood2.prefab) |
| `electrical-cabinet` | electrical-cabinet | DONE | flash-fixture | [ElectricalCabinet prefab](../Assets/StationDesigner/Generated/Prefabs/ElectricalCabinet.prefab) |
| `escalator` | escalator | DONE | flash-transit | [Escalator prefab](../Assets/StationDesigner/Generated/Prefabs/Escalator.prefab) · belt yawed to lie along the row; bounds from the oriented manifest |
| `exit` | exit | DONE | flash-exit | [Exit prefab](../Assets/StationDesigner/Generated/Prefabs/Exit.prefab) · 4 m covered canopy; 8.118 m run; off-centre bounds |
| `exit-covered-1` | exit | DONE | flash-exit | [ExitCovered1 prefab](../Assets/StationDesigner/Generated/Prefabs/ExitCovered1.prefab) · covered head-house, 1 bay |
| `exit-covered-3` | exit | DONE | flash-exit | [ExitCovered3 prefab](../Assets/StationDesigner/Generated/Prefabs/ExitCovered3.prefab) · covered head-house, 3 bays |
| `exit-doorway-1` | exit | DONE | flash-exit | [ExitDoorway1 prefab](../Assets/StationDesigner/Generated/Prefabs/ExitDoorway1.prefab) · ground doorway header, 3 m |
| `exit-doorway-2` | exit | DONE | flash-exit | [ExitDoorway2 prefab](../Assets/StationDesigner/Generated/Prefabs/ExitDoorway2.prefab) · ground doorway header, 4 m |
| `exit-doorway-3` | exit | DONE | flash-exit | [ExitDoorway3 prefab](../Assets/StationDesigner/Generated/Prefabs/ExitDoorway3.prefab) · ground doorway header, 5 m |
| `exit-doorway-4` | exit | DONE | flash-exit | [ExitDoorway4 prefab](../Assets/StationDesigner/Generated/Prefabs/ExitDoorway4.prefab) · ground doorway header, 6 m |
| `exit-uncovered-1` | exit | DONE | flash-exit | [ExitUncovered1 prefab](../Assets/StationDesigner/Generated/Prefabs/ExitUncovered1.prefab) · open exit with steel rail and printed header |
| `exit-uncovered-2` | exit | DONE | flash-exit | [ExitUncovered2 prefab](../Assets/StationDesigner/Generated/Prefabs/ExitUncovered2.prefab) |
| `exit-uncovered-3` | exit | DONE | flash-exit | [ExitUncovered3 prefab](../Assets/StationDesigner/Generated/Prefabs/ExitUncovered3.prefab) |
| `exit-virtual` | exit · review its runtime visual marker and placement preview | DONE | flash-exit | [ExitVirtual prefab](../Assets/StationDesigner/Generated/Prefabs/ExitVirtual.prefab) · virtual-exit guidepost marker; not a full exit |
| `extinguisher` | extinguisher | DONE | flash-concourse | [Extinguisher prefab](../Assets/StationDesigner/Generated/Prefabs/Extinguisher.prefab) |
| `extinguisher-compact` | extinguisher | DONE | flash-concourse | [ExtinguisherCompact prefab](../Assets/StationDesigner/Generated/Prefabs/ExtinguisherCompact.prefab) |
| `extinguisher-glass` | extinguisher | DONE | flash-concourse | [ExtinguisherGlass prefab](../Assets/StationDesigner/Generated/Prefabs/ExtinguisherGlass.prefab) · glass cabinet and alpha label |
| `fence` | fence | DONE | flash-barrier | [Fence prefab](../Assets/StationDesigner/Generated/Prefabs/Fence.prefab) · single isolated 1 m panel; runs and joins are runtime composition |
| `fence-gate` | fence | DONE | flash-barrier | [FenceGate prefab](../Assets/StationDesigner/Generated/Prefabs/FenceGate.prefab) · fence 'gate' variant, not a fare gate |
| `fence-iron` | fence | DONE | flash-barrier | [FenceIron prefab](../Assets/StationDesigner/Generated/Prefabs/FenceIron.prefab) |
| `fence-steel-blue` | fence | DONE | flash-barrier | [FenceSteelBlue prefab](../Assets/StationDesigner/Generated/Prefabs/FenceSteelBlue.prefab) |
| `floor-mark-boarding` | floor-mark | DONE | flash-printed | [FloorMarkBoarding prefab](../Assets/StationDesigner/Generated/Prefabs/FloorMarkBoarding.prefab) · transparent vinyl decal |
| `floor-mark-direction` | floor-mark | DONE | flash-printed | [FloorMarkDirection prefab](../Assets/StationDesigner/Generated/Prefabs/FloorMarkDirection.prefab) · transparent vinyl decal |
| `floor-mark-waiting` | floor-mark | DONE | flash-printed | [FloorMarkWaiting prefab](../Assets/StationDesigner/Generated/Prefabs/FloorMarkWaiting.prefab) · transparent vinyl decal |
| `gate` | gate | DONE | flash-opening | [Gate prefab](../Assets/StationDesigner/Generated/Prefabs/Gate.prefab) · machine body on local −x; 3 canvas lane-panel textures |
| `gate-new` | gate | DONE | flash-opening | [GateNew prefab](../Assets/StationDesigner/Generated/Prefabs/GateNew.prefab) · machine body on local −x; 3 canvas lane-panel textures |
| `glass-1x1` | glass | DONE | flash-glass | [Glass1x1 prefab](../Assets/StationDesigner/Generated/Prefabs/Glass1x1.prefab) |
| `glass-1x2` | glass | DONE | flash-glass | [Glass1x2 prefab](../Assets/StationDesigner/Generated/Prefabs/Glass1x2.prefab) |
| `glass-1x4` | glass | DONE | flash-glass | [Glass1x4 prefab](../Assets/StationDesigner/Generated/Prefabs/Glass1x4.prefab) |
| `glass-2x1` | glass | DONE | flash-glass | [Glass2x1 prefab](../Assets/StationDesigner/Generated/Prefabs/Glass2x1.prefab) |
| `glass-2x2` | glass | DONE | flash-glass | [Glass2x2 prefab](../Assets/StationDesigner/Generated/Prefabs/Glass2x2.prefab) |
| `glass-2x4` | glass | DONE | flash-glass | [Glass2x4 prefab](../Assets/StationDesigner/Generated/Prefabs/Glass2x4.prefab) |
| `glass-3x1` | glass | DONE | flash-glass | [Glass3x1 prefab](../Assets/StationDesigner/Generated/Prefabs/Glass3x1.prefab) |
| `glass-3x2` | glass | DONE | flash-glass | [Glass3x2 prefab](../Assets/StationDesigner/Generated/Prefabs/Glass3x2.prefab) |
| `glass-3x4` | glass | DONE | flash-glass | [Glass3x4 prefab](../Assets/StationDesigner/Generated/Prefabs/Glass3x4.prefab) |
| `glass-4x4` | glass | DONE | flash-glass | [Glass4x4 prefab](../Assets/StationDesigner/Generated/Prefabs/Glass4x4.prefab) |
| `guidepost` | guidepost | DONE | flash-concourse | [Guidepost prefab](../Assets/StationDesigner/Generated/Prefabs/Guidepost.prefab) · 7 canvas plates |
| `hanger-post` | hanger | DONE | flash-hanger | [HangerPost prefab](../Assets/StationDesigner/Generated/Prefabs/HangerPost.prefab) |
| `hanger-roof` | hanger | PARTIAL | flash-hanger | [HangerRoof prefab](../Assets/StationDesigner/Generated/Prefabs/HangerRoof.prefab) · next: runtime generator reads `hangerRoofZ` per station and sets rod length/clamp height |
| `lawn` | lawn | DONE | flash-transit | [Lawn prefab](../Assets/StationDesigner/Generated/Prefabs/Lawn.prefab) |
| `lift` | lift | DONE | flash-transit | [Lift prefab](../Assets/StationDesigner/Generated/Prefabs/Lift.prefab) · small 2 × 2 shaft, 5 m interval |
| `light-circular` | light | DONE | flash-light | [LightCircular prefab](../Assets/StationDesigner/Generated/Prefabs/LightCircular.prefab) |
| `light-rectangular` | light | DONE | flash-light | [LightRectangular prefab](../Assets/StationDesigner/Generated/Prefabs/LightRectangular.prefab) |
| `linemap-stand` | linemap | DONE | flash-printed | [LinemapStand prefab](../Assets/StationDesigner/Generated/Prefabs/LinemapStand.prefab) · neutral empty-network board; dynamic content is runtime binding |
| `linemap-wall` | linemap | DONE | flash-printed | [LinemapWall prefab](../Assets/StationDesigner/Generated/Prefabs/LinemapWall.prefab) · neutral empty-network board; dynamic content is runtime binding |
| `monitor-ceiling` | monitor | DONE | flash-monitor | [MonitorCeiling prefab](../Assets/StationDesigner/Generated/Prefabs/MonitorCeiling.prefab) |
| `monitor-wall` | monitor | DONE | flash-monitor | [MonitorWall prefab](../Assets/StationDesigner/Generated/Prefabs/MonitorWall.prefab) |
| `noise-barrier` | fence | DONE | flash-barrier | [NoiseBarrier prefab](../Assets/StationDesigner/Generated/Prefabs/NoiseBarrier.prefab) |
| `noise-barrier-half` | fence | DONE | flash-barrier | [NoiseBarrierHalf prefab](../Assets/StationDesigner/Generated/Prefabs/NoiseBarrierHalf.prefab) |
| `noise-barrier-railing` | fence | DONE | flash-barrier | [NoiseBarrierRailing prefab](../Assets/StationDesigner/Generated/Prefabs/NoiseBarrierRailing.prefab) |
| `pillar-slim` | pillar | DONE | flash-transit | [PillarSlim prefab](../Assets/StationDesigner/Generated/Prefabs/PillarSlim.prefab) |
| `pillar-thick` | pillar | DONE | flash-transit | [PillarThick prefab](../Assets/StationDesigner/Generated/Prefabs/PillarThick.prefab) |
| `psd-end` | psd-end | DONE | flash-canopy | [PsdEnd prefab](../Assets/StationDesigner/Generated/Prefabs/PsdEnd.prefab) · standalone half-height infill; corners/joins are runtime composition |
| `psd-end-cover` | psd-end | DONE | flash-canopy | [PsdEndCover prefab](../Assets/StationDesigner/Generated/Prefabs/PsdEndCover.prefab) · standalone white cover course |
| `rail-signal` | rail-signal | DONE | flash-canopy | [RailSignal prefab](../Assets/StationDesigner/Generated/Prefabs/RailSignal.prefab) |
| `road` | road | DONE | flash-transit | [Road prefab](../Assets/StationDesigner/Generated/Prefabs/Road.prefab) · 6 × 12 m two-way deck |
| `roof` | roof | DONE | flash-canopy | [Roof prefab](../Assets/StationDesigner/Generated/Prefabs/Roof.prefab) · 1 × 1 flat ceiling tile at z 5 |
| `roof-canopy` | roof | DONE | flash-canopy | [RoofCanopy prefab](../Assets/StationDesigner/Generated/Prefabs/RoofCanopy.prefab) · 4 m bay, eave z 5 |
| `roof-shell` | roof | DONE | flash-canopy | [RoofShell prefab](../Assets/StationDesigner/Generated/Prefabs/RoofShell.prefab) · 4 m bay, shell at z 9–10 |
| `roof-tapered` | roof | DONE | flash-canopy | [RoofTapered prefab](../Assets/StationDesigner/Generated/Prefabs/RoofTapered.prefab) · 4 m tapered truss |
| `roof-truss` | roof | DONE | flash-canopy | [RoofTruss prefab](../Assets/StationDesigner/Generated/Prefabs/RoofTruss.prefab) · 4 m truss |
| `shelf-bags` | shelf | DONE | flash-retail | [ShelfBags prefab](../Assets/StationDesigner/Generated/Prefabs/ShelfBags.prefab) |
| `shelf-books` | shelf | DONE | flash-retail | [ShelfBooks prefab](../Assets/StationDesigner/Generated/Prefabs/ShelfBooks.prefab) |
| `shelf-cafe-backbar` | shelf | DONE | flash-retail | [ShelfCafeBackbar prefab](../Assets/StationDesigner/Generated/Prefabs/ShelfCafeBackbar.prefab) |
| `shelf-cafe-backbar-2` | shelf | DONE | flash-retail | [ShelfCafeBackbar2 prefab](../Assets/StationDesigner/Generated/Prefabs/ShelfCafeBackbar2.prefab) |
| `shelf-cafe-backbar-4` | shelf | DONE | flash-retail | [ShelfCafeBackbar4 prefab](../Assets/StationDesigner/Generated/Prefabs/ShelfCafeBackbar4.prefab) |
| `shelf-clothing-rail` | shelf | DONE | flash-retail | [ShelfClothingRail prefab](../Assets/StationDesigner/Generated/Prefabs/ShelfClothingRail.prefab) |
| `shelf-clothing-shoes` | shelf | DONE | flash-retail | [ShelfClothingShoes prefab](../Assets/StationDesigner/Generated/Prefabs/ShelfClothingShoes.prefab) |
| `shelf-clothing-table` | shelf | DONE | flash-retail | [ShelfClothingTable prefab](../Assets/StationDesigner/Generated/Prefabs/ShelfClothingTable.prefab) |
| `shelf-clothing-wall` | shelf | DONE | flash-retail | [ShelfClothingWall prefab](../Assets/StationDesigner/Generated/Prefabs/ShelfClothingWall.prefab) |
| `shelf-cooler` | shelf | DONE | flash-shelf | [ShelfCooler prefab](../Assets/StationDesigner/Generated/Prefabs/ShelfCooler.prefab) |
| `shelf-cooler-dark` | shelf | DONE | flash-shelf | [ShelfCoolerDark prefab](../Assets/StationDesigner/Generated/Prefabs/ShelfCoolerDark.prefab) |
| `shelf-dark-tall` | shelf | DONE | flash-shelf | [ShelfDarkTall prefab](../Assets/StationDesigner/Generated/Prefabs/ShelfDarkTall.prefab) |
| `shelf-food-bakery` | shelf | DONE | flash-shelf | [ShelfFoodBakery prefab](../Assets/StationDesigner/Generated/Prefabs/ShelfFoodBakery.prefab) |
| `shelf-food-snacks` | shelf | DONE | flash-shelf | [ShelfFoodSnacks prefab](../Assets/StationDesigner/Generated/Prefabs/ShelfFoodSnacks.prefab) |
| `shelf-fruit-island` | shelf | DONE | flash-shelf | [ShelfFruitIsland prefab](../Assets/StationDesigner/Generated/Prefabs/ShelfFruitIsland.prefab) |
| `shelf-fruit-tiered` | shelf | DONE | flash-retail | [ShelfFruitTiered prefab](../Assets/StationDesigner/Generated/Prefabs/ShelfFruitTiered.prefab) |
| `shelf-ice-cream` | shelf | DONE | flash-shelf | [ShelfIceCream prefab](../Assets/StationDesigner/Generated/Prefabs/ShelfIceCream.prefab) |
| `shelf-white-short` | shelf | DONE | flash-shelf | [ShelfWhiteShort prefab](../Assets/StationDesigner/Generated/Prefabs/ShelfWhiteShort.prefab) |
| `shelf-white-tall` | shelf | DONE | flash-shelf | [ShelfWhiteTall prefab](../Assets/StationDesigner/Generated/Prefabs/ShelfWhiteTall.prefab) |
| `shelf-wire` | shelf | DONE | flash-shelf | [ShelfWire prefab](../Assets/StationDesigner/Generated/Prefabs/ShelfWire.prefab) |
| `sidewalk` | sidewalk | DONE | flash-transit | [Sidewalk prefab](../Assets/StationDesigner/Generated/Prefabs/Sidewalk.prefab) |
| `sign-ceiling` | sign | DONE | flash-printed | [SignCeiling prefab](../Assets/StationDesigner/Generated/Prefabs/SignCeiling.prefab) · neutral default face; dynamic content is runtime binding |
| `sign-wall` | sign | DONE | flash-printed | [SignWall prefab](../Assets/StationDesigner/Generated/Prefabs/SignWall.prefab) · neutral default face; dynamic content is runtime binding |
| `sink` | sink | DONE | flash-concourse | [Sink prefab](../Assets/StationDesigner/Generated/Prefabs/Sink.prefab) · authored water stream is runtime-hidden and stripped |
| `stair-block` | stair | DONE | flash-stair | [StairBlock prefab](../Assets/StationDesigner/Generated/Prefabs/StairBlock.prefab) |
| `stair-centerForward` | stair | DONE | flash-stair | [StairCenterForward prefab](../Assets/StationDesigner/Generated/Prefabs/StairCenterForward.prefab) |
| `stair-left180` | stair | DONE | flash-stair | [StairLeft180 prefab](../Assets/StationDesigner/Generated/Prefabs/StairLeft180.prefab) |
| `stair-left90` | stair | DONE | flash-stair | [StairLeft90 prefab](../Assets/StationDesigner/Generated/Prefabs/StairLeft90.prefab) |
| `stair-leftForward` | stair | DONE | flash-stair | [StairLeftForward prefab](../Assets/StationDesigner/Generated/Prefabs/StairLeftForward.prefab) |
| `stair-right180` | stair | DONE | flash-stair | [StairRight180 prefab](../Assets/StationDesigner/Generated/Prefabs/StairRight180.prefab) |
| `stair-right90` | stair | DONE | flash-stair | [StairRight90 prefab](../Assets/StationDesigner/Generated/Prefabs/StairRight90.prefab) |
| `stair-rightForward` | stair | DONE | flash-stair | [StairRightForward prefab](../Assets/StationDesigner/Generated/Prefabs/StairRightForward.prefab) |
| `stair-straight` | stair | DONE | flash-stair | [StairStraight prefab](../Assets/StationDesigner/Generated/Prefabs/StairStraight.prefab) · canonical 5 m storey, narrow 0.68 m band, 5 m ramp length |
| `tactile-guide` | tactile | DONE | flash-barrier | [TactileGuide prefab](../Assets/StationDesigner/Generated/Prefabs/TactileGuide.prefab) |
| `tactile-warning` | tactile | DONE | flash-barrier | [TactileWarning prefab](../Assets/StationDesigner/Generated/Prefabs/TactileWarning.prefab) |
| `tactile-warning-strip` | tactile | DONE | flash-barrier | [TactileWarningStrip prefab](../Assets/StationDesigner/Generated/Prefabs/TactileWarningStrip.prefab) |
| `traffic-light` | traffic-light | DONE | flash-canopy | [TrafficLight prefab](../Assets/StationDesigner/Generated/Prefabs/TrafficLight.prefab) |
| `tree` | tree | DONE | flash-transit | [Tree prefab](../Assets/StationDesigner/Generated/Prefabs/Tree.prefab) · leaf alpha map unavailable headlessly; authored foliage colour; ez-tree MIT bake |
| `tv` | tv | DONE | flash-display | [Tv prefab](../Assets/StationDesigner/Generated/Prefabs/Tv.prefab) · sample departure board; live arrivals are runtime state |
| `tv-double` | tv | DONE | flash-display | [TvDouble prefab](../Assets/StationDesigner/Generated/Prefabs/TvDouble.prefab) · one shared housing; 0.200 m pair body |
| `tvm` | tvm | DONE | flash-display | [Tvm prefab](../Assets/StationDesigner/Generated/Prefabs/Tvm.prefab) |
| `urinal` | urinal | DONE | flash-concourse | [Urinal prefab](../Assets/StationDesigner/Generated/Prefabs/Urinal.prefab) |
| `vending` | vending | DONE | flash-display | [Vending prefab](../Assets/StationDesigner/Generated/Prefabs/Vending.prefab) · two alpha materials |
| `vent` | vent | DONE | flash-fixture | [Vent prefab](../Assets/StationDesigner/Generated/Prefabs/Vent.prefab) · ceiling-mounted: bounds z 3.94–4.00 m in an empty station |
| `walkway` | walkway | DONE | flash-transit | [Walkway prefab](../Assets/StationDesigner/Generated/Prefabs/Walkway.prefab) · 30 m band |

## Rolling stock and road traffic

Use the [formation and power matrix](09-train-and-passenger-parity.md#train-formations-and-power) to record each production configuration. Review consists are evidence for their own fixture.

| ID | Source family / coverage | Status | Owner | Unity output / evidence |
| --- | --- | --- | --- | --- |
| `train-A-two-car-proof` | Type A articulated two-car review fixture | DONE | | [Type A prefab](../Assets/TrainProof/TypeA.prefab) · [import and Web evidence](phase-0-handoff.md#imported-train-animation-in-web) |
| `train-A` | Production formation and power matrix · see [train plan](09-train-and-passenger-parity.md#train-formations-and-power) | DONE | flash-formations | [FormationA8Overhead prefab](../Assets/StationDesigner/Generated/Prefabs/FormationA8Overhead.prefab) · A 8-car overhead scene + A 2-car both powers; 50/50 matrix pass |
| `train-B` | Production formation and power matrix · see [train plan](09-train-and-passenger-parity.md#train-formations-and-power) | DONE | flash-formations | [FormationB2ThirdRail prefab](../Assets/StationDesigner/Generated/Prefabs/FormationB2ThirdRail.prefab) · B 2-car third rail + overhead; pantographs/unpowered roof caps verified |
| `train-C` | Production formation and power matrix · see [train plan](09-train-and-passenger-parity.md#train-formations-and-power) | DONE | flash-formations | [FormationC2Overhead prefab](../Assets/StationDesigner/Generated/Prefabs/FormationC2Overhead.prefab) · C 2-car overhead + third rail |
| `train-L` | Production formation and power matrix · see [train plan](09-train-and-passenger-parity.md#train-formations-and-power) | DONE | flash-formations | [FormationL6ThirdRailZoo prefab](../Assets/StationDesigner/Generated/Prefabs/FormationL6ThirdRailZoo.prefab) · Zoo Line 5 exact: L 6-car third rail, #c70541, scale 0.98; reversal verified |
| `train-D` | Production formation and power matrix · see [train plan](09-train-and-passenger-parity.md#train-formations-and-power) | DONE | flash-formations | [FormationD2Overhead prefab](../Assets/StationDesigner/Generated/Prefabs/FormationD2Overhead.prefab) · D 2-car overhead + third rail; D cab/end doors preserved |
| `vehicle-suv` | RoadVehicleModel · geometry, scale, heading and LOD | DONE | flash-vehicle | [VehicleSuv prefab](../Assets/StationDesigner/Generated/Prefabs/VehicleSuv.prefab) · 2.19 × 4.29 × 1.79 m, 7 colour bins |
| `vehicle-sedan` | RoadVehicleModel · geometry, scale, heading and LOD | DONE | flash-vehicle | [VehicleSedan prefab](../Assets/StationDesigner/Generated/Prefabs/VehicleSedan.prefab) · 2.19 × 4.29 × 1.51 m |
| `vehicle-bus-orange` | RoadVehicleModel · geometry, scale, heading and LOD | DONE | flash-vehicle | [VehicleBusOrange prefab](../Assets/StationDesigner/Generated/Prefabs/VehicleBusOrange.prefab) · 2.90 × 10.13 × 3.33 m |
| `vehicle-bus-mosaic` | RoadVehicleModel · geometry, scale, heading and LOD | DONE | flash-vehicle | [VehicleBusMosaic prefab](../Assets/StationDesigner/Generated/Prefabs/VehicleBusMosaic.prefab) · 2.90 × 10.16 × 3.33 m |
| `vehicle-moped` | RoadVehicleModel · geometry, scale, heading and LOD | DONE | flash-vehicle | [VehicleMoped prefab](../Assets/StationDesigner/Generated/Prefabs/VehicleMoped.prefab) · 0.88 × 1.92 × 1.72 m |
| `vehicle-bicycle` | RoadVehicleModel · geometry, scale, heading and LOD | DONE | flash-vehicle | [VehicleBicycle prefab](../Assets/StationDesigner/Generated/Prefabs/VehicleBicycle.prefab) · 0.67 × 1.90 × 1.81 m |

## City-specific models and artwork

Claim related rows together. Geometry and editable artwork have separate checks because an imported canopy does not verify dynamic signage. See `game/src/sim/cityStyles.ts` for the supported cities.

| ID | Source family / coverage | Status | Owner | Unity output / evidence |
| --- | --- | --- | --- | --- |
| `city-guangzhou-exit-canopy` | Default canopy in ExitModel.ts | DONE | flash-civic | [CityExitGuangzhou prefab](../Assets/StationDesigner/Generated/Prefabs/CityExitGuangzhou.prefab) · 4.10 × 8.12 × 4.00 m red frame canopy |
| `city-guangzhou-exit-header` | ExitModel.ts · editable header artwork | DONE | flash-civic | [CityExitGuangzhou prefab](../Assets/StationDesigner/Generated/Prefabs/CityExitGuangzhou.prefab) · header canvas 512×96 ground #c22f28, C口 |
| `city-guangzhou-doorway-entrance` | DoorwayExitModel.ts · city palette and header binding | DONE | flash-wayfinding | [CityDoorwayGuangzhou prefab](../Assets/StationDesigner/Generated/Prefabs/CityDoorwayGuangzhou.prefab) · 3.00 × 0.072 × 0.78 m header, C口 |
| `city-guangzhou-guidepost` | Default guidepost in GuidepostModel.ts | DONE | flash-wayfinding | [CityGuidepostGuangzhou prefab](../Assets/StationDesigner/Generated/Prefabs/CityGuidepostGuangzhou.prefab) · 4.000 m post, 7 plates |
| `city-shenzhen-exit-canopy` | ShenzhenExitCanopy.ts | DONE | flash-civic | [CityExitShenzhen prefab](../Assets/StationDesigner/Generated/Prefabs/CityExitShenzhen.prefab) · 4.56 × 8.10 × 3.59 m; blade plate |
| `city-shenzhen-exit-header` | ExitModel.ts · editable header artwork | DONE | flash-civic | [CityExitShenzhen prefab](../Assets/StationDesigner/Generated/Prefabs/CityExitShenzhen.prefab) · header canvas 512×96 ground #101b2b, C口 |
| `city-shenzhen-doorway-entrance` | DoorwayExitModel.ts · city palette and header binding | DONE | flash-wayfinding | [CityDoorwayShenzhen prefab](../Assets/StationDesigner/Generated/Prefabs/CityDoorwayShenzhen.prefab) · 3.00 × 0.072 × 0.78 m header, C口 |
| `city-shenzhen-guidepost` | ShenzhenGuidepost.ts | DONE | flash-wayfinding | [CityGuidepostShenzhen prefab](../Assets/StationDesigner/Generated/Prefabs/CityGuidepostShenzhen.prefab) · 3.995 m post, 3 plates |
| `city-shanghai-exit-canopy` | ShanghaiExitCanopy.ts | DONE | flash-civic | [CityExitShanghai prefab](../Assets/StationDesigner/Generated/Prefabs/CityExitShanghai.prefab) · 4.00 × 8.10 × 3.64 m; two roundels |
| `city-shanghai-exit-header` | ShanghaiExitHeader.ts · editable header artwork | DONE | flash-civic | [CityExitShanghai prefab](../Assets/StationDesigner/Generated/Prefabs/CityExitShanghai.prefab) · header canvas 512×96 ground #353b35, 13号口 |
| `city-shanghai-doorway-entrance` | DoorwayExitModel.ts · city palette and header binding | DONE | flash-wayfinding | [CityDoorwayShanghai prefab](../Assets/StationDesigner/Generated/Prefabs/CityDoorwayShanghai.prefab) · 3.00 × 0.072 × 0.78 m header, 13号口 |
| `city-shanghai-guidepost` | ShanghaiGuidepost.ts | DONE | flash-wayfinding | [CityGuidepostShanghai prefab](../Assets/StationDesigner/Generated/Prefabs/CityGuidepostShanghai.prefab) · 3.888 m post, 1 plate |
| `city-beijing-exit-canopy` | BeijingExitCanopy.ts | DONE | flash-civic | [CityExitBeijing prefab](../Assets/StationDesigner/Generated/Prefabs/CityExitBeijing.prefab) · 4.00 × 8.10 × 4.58 m; over-roof boards |
| `city-beijing-exit-header` | BeijingExitHeader.ts · editable header artwork | DONE | flash-civic | [CityExitBeijing prefab](../Assets/StationDesigner/Generated/Prefabs/CityExitBeijing.prefab) · header canvas 512×96 ground #073563, C口 |
| `city-beijing-doorway-entrance` | DoorwayExitModel.ts · city palette and header binding | DONE | flash-wayfinding | [CityDoorwayBeijing prefab](../Assets/StationDesigner/Generated/Prefabs/CityDoorwayBeijing.prefab) · 3.00 × 0.072 × 0.78 m header, no exit identifier (drawsExitName=false) |
| `city-beijing-guidepost` | BeijingGuidepost.ts | DONE | flash-wayfinding | [CityGuidepostBeijing prefab](../Assets/StationDesigner/Generated/Prefabs/CityGuidepostBeijing.prefab) · 3.965 m post, 2 plates |
| `city-chengdu-exit-canopy` | ChengduExitCanopy.ts | DONE | flash-civic | [CityExitChengdu prefab](../Assets/StationDesigner/Generated/Prefabs/CityExitChengdu.prefab) · 4.00 × 8.10 × 3.65 m |
| `city-chengdu-exit-header` | ChengduExitHeader.ts · editable header artwork | DONE | flash-civic | [CityExitChengdu prefab](../Assets/StationDesigner/Generated/Prefabs/CityExitChengdu.prefab) · header canvas 2048×384 ground #343433, C口 |
| `city-chengdu-doorway-entrance` | DoorwayExitModel.ts · city palette and header binding | DONE | flash-wayfinding | [CityDoorwayChengdu prefab](../Assets/StationDesigner/Generated/Prefabs/CityDoorwayChengdu.prefab) · 3.00 × 0.072 × 0.78 m header, C口 |
| `city-chengdu-guidepost` | ChengduGuidepost.ts | DONE | flash-wayfinding | [CityGuidepostChengdu prefab](../Assets/StationDesigner/Generated/Prefabs/CityGuidepostChengdu.prefab) · 4.000 m post, 3 plates |
| `city-chongqing-exit-canopy` | ChongqingExitCanopy.ts | DONE | flash-civic | [CityExitChongqing prefab](../Assets/StationDesigner/Generated/Prefabs/CityExitChongqing.prefab) · 4.00 × 8.22 × 3.45 m |
| `city-chongqing-exit-header` | ChongqingExitHeader.ts · editable header artwork | DONE | flash-civic | [CityExitChongqing prefab](../Assets/StationDesigner/Generated/Prefabs/CityExitChongqing.prefab) · header canvas 2048×384 ground #f2f0dd, C口 |
| `city-chongqing-doorway-entrance` | DoorwayExitModel.ts · city palette and header binding | DONE | flash-wayfinding | [CityDoorwayChongqing prefab](../Assets/StationDesigner/Generated/Prefabs/CityDoorwayChongqing.prefab) · 3.00 × 0.072 × 0.78 m header, C口 |
| `city-chongqing-guidepost` | ChongqingGuidepost.ts | DONE | flash-wayfinding | [CityGuidepostChongqing prefab](../Assets/StationDesigner/Generated/Prefabs/CityGuidepostChongqing.prefab) · 4.060 m post, 1.58 m crown ring, 1 plate |
| `city-wuhan-exit-canopy` | WuhanExitCanopy.ts | DONE | flash-civic | [CityExitWuhan prefab](../Assets/StationDesigner/Generated/Prefabs/CityExitWuhan.prefab) · 4.03 × 8.14 × 3.75 m |
| `city-wuhan-exit-header` | WuhanExitHeader.ts · editable header artwork | DONE | flash-civic | [CityExitWuhan prefab](../Assets/StationDesigner/Generated/Prefabs/CityExitWuhan.prefab) · header canvas 2048×384 ground #183b70, C口 |
| `city-wuhan-doorway-entrance` | DoorwayExitModel.ts · city palette and header binding | DONE | flash-wayfinding | [CityDoorwayWuhan prefab](../Assets/StationDesigner/Generated/Prefabs/CityDoorwayWuhan.prefab) · 3.00 × 0.072 × 0.78 m header, C口 |
| `city-wuhan-guidepost` | WuhanGuidepost.ts | DONE | flash-wayfinding | [CityGuidepostWuhan prefab](../Assets/StationDesigner/Generated/Prefabs/CityGuidepostWuhan.prefab) · 4.000 m post, 2 plates |
| `city-nanjing-exit-canopy` | NanjingExitCanopy.ts | DONE | flash-civic | [CityExitNanjing prefab](../Assets/StationDesigner/Generated/Prefabs/CityExitNanjing.prefab) · 4.00 × 8.49 × 4.86 m; emblem, wordmark and portal labels |
| `city-nanjing-exit-header` | NanjingExitHeader.ts · editable header artwork | DONE | flash-civic | [CityExitNanjing prefab](../Assets/StationDesigner/Generated/Prefabs/CityExitNanjing.prefab) · header canvas 2048×384 ground #14213f, C口 |
| `city-nanjing-doorway-entrance` | DoorwayExitModel.ts · city palette and header binding | DONE | flash-wayfinding | [CityDoorwayNanjing prefab](../Assets/StationDesigner/Generated/Prefabs/CityDoorwayNanjing.prefab) · 3.00 × 0.072 × 0.78 m header, C口 |
| `city-nanjing-guidepost` | NanjingGuidepost.ts | DONE | flash-wayfinding | [CityGuidepostNanjing prefab](../Assets/StationDesigner/Generated/Prefabs/CityGuidepostNanjing.prefab) · 3.800 m post, 1 opaque plate |
| `city-guangzhou-train-mark` | TrainModel and shared train marking atlas | DONE | flash-vehicle | [TrainMarkGuangzhou prefab](../Assets/StationDesigner/Generated/Prefabs/TrainMarkGuangzhou.prefab) · cab-front plate from trainMark atlas slot 0 (#d8231c) |
| `city-beijing-train-mark` | City style calligraphy train mark | DONE | flash-vehicle | [TrainMarkBeijing prefab](../Assets/StationDesigner/Generated/Prefabs/TrainMarkBeijing.prefab) · cab-front plate from trainMark atlas slot 1 (white calligraphy) |
| `city-chongqing-train-mark` | chongqingTrainMark.ts · line badge | DONE | flash-vehicle | [TrainMarkChongqing prefab](../Assets/StationDesigner/Generated/Prefabs/TrainMarkChongqing.prefab) · per-consist line badge canvas, line 4 (#dc8633) |
| `city-nanjing-train-mark` | NanjingTrainMark.ts · train marks | DONE | flash-vehicle | [TrainMarkNanjing prefab](../Assets/StationDesigner/Generated/Prefabs/TrainMarkNanjing.prefab) · nanjingTrainMark 256×256 mark on a cab-front plate |

## Generated station models and model parts

Claim each related set together, such as track, bridge, or platform-screen-door pieces. Related palette rows also cover the assembled model or its placement variants.

| ID | Source family / coverage | Status | Owner | Unity output / evidence |
| --- | --- | --- | --- | --- |
| `structure-floor` | chunkMesher.ts · floor slabs and openings | DONE | flash-structure | [StructureFloor prefab](../Assets/StationDesigner/Generated/Prefabs/StructureFloor.prefab) · 6 × 4 m slab with 2 × 2 opening; granite/concrete regions |
| `structure-wall` | chunkMesher.ts · wall faces and openings | DONE | flash-structure | [StructureWall prefab](../Assets/StationDesigner/Generated/Prefabs/StructureWall.prefab) · 6 × 4 m wall with 2 × 2 door and 1 × 1 window |
| `structure-ceiling` | chunkMesher.ts · ceilings and cutaways | PARTIAL | flash-structure | [StructureCeiling prefab](../Assets/StationDesigner/Generated/Prefabs/StructureCeiling.prefab) · cutaway snapshot; Unity runtime cutaway/level-slice recompute remains |
| `structure-finishes` | surfaceBatches.ts · face finish and dirty-neighbor update | PARTIAL | flash-structure | [StructureFinishes prefab](../Assets/StationDesigner/Generated/Prefabs/StructureFinishes.prefab) · finish-region snapshot; Unity runtime face-finish re-mesh/cache invalidation remains |
| `ramp-surface` | rampSurfaceMesh.ts · sloped walking surface | DONE | flash-structure | [RampSurface prefab](../Assets/StationDesigner/Generated/Prefabs/RampSurface.prefab) · 30° run, 9 m run / 5 m rise, 13 m² planar regions |
| `ramp-join` | RampJoinModel.ts · joined surfaces | DONE | flash-structure | [RampJoin prefab](../Assets/StationDesigner/Generated/Prefabs/RampJoin.prefab) · flush 30° pair, stainless infill + 6 domes, neighbour-aware bake |
| `platform-edge` | PsdModel.ts · screen door assembly and alignment | PARTIAL | flash-wayside | [PlatformEdge prefab](../Assets/StationDesigner/Generated/Prefabs/PlatformEdge.prefab) · 20 m full-height PSD snapshot; Unity runtime door-cadence port remains |
| `platform-edge-housing` | PsdHousing.ts · enclosure | PARTIAL | flash-wayside | [PlatformEdgeHousing prefab](../Assets/StationDesigner/Generated/Prefabs/PlatformEdgeHousing.prefab) · enclosure snapshot; finishPsdHousing dirty-neighbour segmentation remains |
| `platform-edge-header` | PsdHeader.ts · route and station header | DONE | flash-wayside | [PlatformEdgeHeader prefab](../Assets/StationDesigner/Generated/Prefabs/PlatformEdgeHeader.prefab) · 0.53 m/256 px header, 人民广场, line #1b6fd6 |
| `platform-edge-decals` | PsdDecals.ts · decals and door markings | DONE | flash-wayside | [PlatformEdgeDecals prefab](../Assets/StationDesigner/Generated/Prefabs/PlatformEdgeDecals.prefab) · 5 fixed bands, 8 door bands, 8 warnings, 8 arrows |
| `track-kit` | TrackModel.ts · straight, curved and junction paths | PARTIAL | flash-wayside | [TrackKit prefab](../Assets/StationDesigner/Generated/Prefabs/TrackKit.prefab) · straight + quarter-turn; curved/junction unsupported by document schema |
| `track-details` | TrackDetails.ts · rail, track bed and power details | DONE | flash-wayside | [TrackDetails prefab](../Assets/StationDesigner/Generated/Prefabs/TrackDetails.prefab) · 16 m straight, 2 rails, 27 sleepers, third rail |
| `track-gantry` | TrackGantry.ts · overhead support | DONE | flash-wayside | [TrackGantry prefab](../Assets/StationDesigner/Generated/Prefabs/TrackGantry.prefab) · 16 m catenary gantry, masts/cantilever/registration |
| `track-tunnel` | TrackModel.ts · tunnel shell | DONE | flash-wayside | [TrackTunnel prefab](../Assets/StationDesigner/Generated/Prefabs/TrackTunnel.prefab) · 16 m bore snapshot from TunnelShell; runtime generator remains |
| `bridge-kit` | TrackModel.ts · bridge assembly and supports | DONE | flash-wayside | [BridgeKit prefab](../Assets/StationDesigner/Generated/Prefabs/BridgeKit.prefab) · 24 m span at z8, gantry posts, concrete trough |
| `bridge-railing` | BridgeRailing.ts | DONE | flash-wayside | [BridgeRailing prefab](../Assets/StationDesigner/Generated/Prefabs/BridgeRailing.prefab) · both shoulders, 24 posts, 1.25 m top rail |
| `bridge-noise-barrier` | BridgeNoiseBarrier.ts | DONE | flash-wayside | [BridgeNoiseBarrier prefab](../Assets/StationDesigner/Generated/Prefabs/BridgeNoiseBarrier.prefab) · full 3.5 m barrier, 26 bays, glass |
| `bridge-edge-concrete` | BridgeEdgeConcrete.ts | DONE | flash-wayside | [BridgeEdgeConcrete prefab](../Assets/StationDesigner/Generated/Prefabs/BridgeEdgeConcrete.prefab) · both shoulders, 0.5 m deep |
| `bridge-pillar` | PillarModel.ts · bridge-owned support placement | PARTIAL | flash-wayside | [BridgePillar prefab](../Assets/StationDesigner/Generated/Prefabs/BridgePillar.prefab) · pier snapshot; bridgePillarCandidates/sync runtime placement remains |
| `shop-room` | RoomModel.ts · fitted shop shell | DONE | flash-fitout | [ShopRoom prefab](../Assets/StationDesigner/Generated/Prefabs/ShopRoom.prefab) · 6 × 3 × 4 m store shell, two-cell opening |
| `retail-room` | RoomModel.ts · authored store adapter | DONE | flash-fitout | [RetailRoom prefab](../Assets/StationDesigner/Generated/Prefabs/RetailRoom.prefab) · 5 × 3 × 4 m authored retail adapter, open front |
| `ticket-booth` | BoothModel.ts · shell, opening and dynamic signage | DONE | flash-fitout | [TicketBooth prefab](../Assets/StationDesigner/Generated/Prefabs/TicketBooth.prefab) · 4 × 2.4 × 3 m glazed kiosk with 售票处 wall sign |
| `shop-shelves` | ShopShelves.ts · room furniture | DONE | flash-fitout | [ShopShelves prefab](../Assets/StationDesigner/Generated/Prefabs/ShopShelves.prefab) · food-snacks run, stock instances baked to 10 colours |
| `shop-counter` | ShopCounter.ts · room counter | DONE | flash-fitout | [ShopCounter prefab](../Assets/StationDesigner/Generated/Prefabs/ShopCounter.prefab) · 2-cell counter, worktop, rear doors, POS screens |
| `shop-stock` | ShopStock.ts · shelf stock | PARTIAL | flash-fitout | [ShopStock prefab](../Assets/StationDesigner/Generated/Prefabs/ShopStock.prefab) · stock sampler proved; Unity runtime restock/replenishment remains |
| `street-arrow-markings` | RoadArrowMarking.ts · direction arrows | PARTIAL | flash-fitout | [StreetArrows prefab](../Assets/StationDesigner/Generated/Prefabs/StreetArrows.prefab) · 4 movement cases proved; road-network arrow placement remains |
| `street-decor` | StreetDecorModel.ts · roadside details | DONE | flash-fitout | [StreetDecor prefab](../Assets/StationDesigner/Generated/Prefabs/StreetDecor.prefab) · bus shelter + Guangzhou guidepost cluster, 11 textures |
| `dynamic-station-panels` | Panel atlases · edited signs, route maps, posters and displays | PARTIAL | flash-fitout | [StationPanels prefab](../Assets/StationDesigner/Generated/Prefabs/StationPanels.prefab) · 2048 panel atlas snapshot; runtime editing/rebinding and live repaint remain |

## Passenger models and animation

Use the [soft-human migration plan](09-train-and-passenger-parity.md#passenger-source-and-migration). The Unity stand-in rows record prototype evidence. The source of truth for passenger parity is the active soft-human crowd.

The Unity placeholder can support Zoo development. Confirm redistribution rights for the active soft-human source and derivatives before production delivery. Track reusable wardrobe, hair and accessory recipes together with that rig. See [the game passenger library](../../game/src/assets/PASSENGERS.md).

| ID | Source family / coverage | Status | Owner | Unity output / evidence |
| --- | --- | --- | --- | --- |
| `passenger-original-placeholder` | PlaceholderCrowdMesh · existing static prototype | DONE | flash-crowd | [PassengerAdult prefab](../Assets/StationDesigner/Generated/Prefabs/PassengerAdult.prefab) · cleared original stand-in supersedes the static prototype |
| `passenger-original-rig` | Create or select a cleared animated stand-in; verify skin, joints and scale | DONE | flash-crowd | [PassengerAdult prefab](../Assets/StationDesigner/Generated/Prefabs/PassengerAdult.prefab) · cleared 15-bone stand-in; soft-human 16-joint rig verified separately but INTERNAL_REVIEW_ONLY |
| `passenger-production-rig` | Migrate the active soft-human body and rig after confirming redistribution rights for its source and derivatives | BLOCKED — cleared source | | |
| `passenger-adult-child` | Adult/child scale and skin fit from approved rig | DONE | flash-crowd | [SoftHumanAdult prefab](../Assets/StationDesigner/Generated/Prefabs/SoftHumanAdult.prefab) · SoftHumanAdult 1.70 m + SoftHumanChild 1.132 m (INTERNAL_REVIEW_ONLY) |
| `passenger-wardrobe` | Wardrobe geometry and material recipes from approved sources | DONE | flash-crowd | [SoftHumanFormal prefab](../Assets/StationDesigner/Generated/Prefabs/SoftHumanFormal.prefab) · commuter/formal/skirt/casual/shoulder recipes, 3–7 baked regions (internal) |
| `passenger-hair` | Hair geometry and style recipes from approved sources | PARTIAL | flash-crowd | [SoftHumanAdult prefab](../Assets/StationDesigner/Generated/Prefabs/SoftHumanAdult.prefab) · single shared cap; no per-style hair geometries in the approved source |
| `passenger-bags` | Bags, straps and hand-held accessories from approved sources | PARTIAL | flash-crowd | [SoftHumanShoulder prefab](../Assets/StationDesigner/Generated/Prefabs/SoftHumanShoulder.prefab) · pack/strap geometry exact; hand-held bag uses rigid forearm weight (0.183 m deviation) |
| `passenger-lod` | Near/far mesh and shared crowd rendering | DONE | flash-crowd | [SoftHumanLow prefab](../Assets/StationDesigner/Generated/Prefabs/SoftHumanLow.prefab) · 592 t vs 6,242 t (9.49%), same bones/materials/clips |
| `passenger-idle` | Standing and queue poses | DONE | flash-crowd | [SoftHumanAdult prefab](../Assets/StationDesigner/Generated/Prefabs/SoftHumanAdult.prefab) · Idle/Wait/Queue; 0.207 mm max vs baked standing frame |
| `passenger-walk` | Walking clips, foot contact and orientation | DONE | flash-crowd | [SoftHumanAdult prefab](../Assets/StationDesigner/Generated/Prefabs/SoftHumanAdult.prefab) · WalkSlow/Walk/WalkFast, 24 frames each; 0.210 mm max vs bake |
| `passenger-stairs` | Stair traversal | PARTIAL | flash-crowd | [SoftHumanAdult prefab](../Assets/StationDesigner/Generated/Prefabs/SoftHumanAdult.prefab) · bake has no stair-specific clip; walk profiles only |
| `passenger-escalator` | Escalator and moving walkway poses | DONE | flash-crowd | [SoftHumanAdult prefab](../Assets/StationDesigner/Generated/Prefabs/SoftHumanAdult.prefab) · Escalator/EscalatorLeft with hand palettes |
| `passenger-boarding` | Train boarding and alighting | DONE | flash-crowd | [SoftHumanAdult prefab](../Assets/StationDesigner/Generated/Prefabs/SoftHumanAdult.prefab) · Door approach/through/release + walks |
| `passenger-seated` | Train and station seat poses | DONE | flash-crowd | [SoftHumanAdult prefab](../Assets/StationDesigner/Generated/Prefabs/SoftHumanAdult.prefab) · Sit/Toilet; child uses the 0.60 fit |
| `passenger-fixture-activities` | Fixture interaction clips and attachment points | DONE | flash-crowd | [SoftHumanAdult prefab](../Assets/StationDesigner/Generated/Prefabs/SoftHumanAdult.prefab) · 15 actions × 3 hand modes × 24 frames |
| `passenger-crowd-web` | Verify motion and appearance variants in a representative Web crowd | DONE | flash-crowd | [SoftHumanAdult prefab](../Assets/StationDesigner/Generated/Prefabs/SoftHumanAdult.prefab) · 24-instance crowd + 8-variant row, Web motion pass; INTERNAL_REVIEW_ONLY |

## Inventory reconciliation

| ID | Source family / coverage | Status | Owner | Unity output / evidence |
| --- | --- | --- | --- | --- |
| `catalogue-variant-audit` | Review per-family sim registries and builder attributes. Add finite variants or a parameter test matrix. | TODO | | |
| `renderer-source-audit` | Reconcile renderer and scene-system models with rows above; add any uncovered model or part. | TODO | | |
