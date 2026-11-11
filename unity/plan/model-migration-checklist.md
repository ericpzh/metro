# Unity model migration checklist

This file is the shared assignment and completion record for runtime game models. Start with one unclaimed row or a related family. Each row can share a prefab or runtime generator with another row if the evidence covers both IDs.

Inventory snapshot at `c2f6fd40` from the current working tree. Covers all 152 build palette IDs and 10 additional bench, door and glass variants, plus the non-palette work below. Sizes, rotations and user-authored content belong in parameter test cases, with distinct rows for finite variants as they are discovered.

## Claim and finish a row

1. Read this file and the [asset subplan](02-assets.md). Pick a TODO row, add your agent or chat name in Owner, and set it to IN PROGRESS before editing the model. If two agents choose the same ID, coordinate before touching its files. Edit only your rows and keep other claims intact.
2. Trace the palette ID through [catalog.ts](../../game/src/app/store/catalog.ts) and [models.ts](../../game/src/render/models.ts). Record any extra geometry variants, materials, motion, attachment anchors and source provenance. Use the [asset skill](skill-drafts/metro-unity-assets/SKILL.md) for the bench, bin and train examples. Use glTFast for reusable meshes. Port geometry that depends on station dimensions or neighbors to a Unity runtime generator and test representative parameters.
3. Keep one recipe ID per asset or documented shared generator. Add the exact export or generation command, validation command and review evidence to the row or a linked recipe. The current manifest importer recognizes fixture kinds. Extend its contract when needed and check the existing fixtures and transaction regression.
4. Validate geometry and any relevant materials, textures, anchors and motion in Unity. Render or exercise the asset in Web. Deliver the verified model and wrapper or runtime generator under unity/Assets with its metadata. Mark DONE and add the delivery path and review evidence after those checks pass.
5. Use PARTIAL for a useful but limited implementation and BLOCKED with a concrete reason when work cannot proceed. Include the next check or dependency in the evidence column. Keep TODO for unclaimed work. Use the source-audit rows to close coverage gaps and reconcile the palette with this table before declaring the whole catalogue migrated.

Suggested first picks for the playable station are gate, gate-new, exit and platform-edge. Coordinate shared exporter, importer and catalogue edits before working on models that require them.

## Station palette and additional variants

| ID | Source family / coverage | Status | Owner | Unity output / evidence |
| --- | --- | --- | --- | --- |
| `ac-unit` | ac-unit | TODO | |  |
| `bench-office-1` | bench | TODO | |  |
| `bench-seat-1` | bench | TODO | |  |
| `bench-seat-2` | bench | DONE | | [Bench prefab](../Assets/StationDesigner/Generated/Prefabs/Bench.prefab) · `./tools/unity-assets/prove-bench.ps1 -Asset bench` |
| `bench-steel-1` | bench | TODO | |  |
| `bench-steel-2` | bench | TODO | |  |
| `bench-wood-1` | bench | TODO | |  |
| `bench-wood-2` | bench | TODO | |  |
| `billboard-16x9-3m` | billboard | TODO | |  |
| `billboard-16x9-4m` | billboard | TODO | |  |
| `billboard-4x3-3m` | billboard | TODO | |  |
| `billboard-4x3-4m` | billboard | TODO | |  |
| `billboard-large` | billboard | TODO | |  |
| `billboard-panorama` | billboard | TODO | |  |
| `billboard-portrait` | billboard | TODO | |  |
| `billboard-square` | billboard | TODO | |  |
| `billboard-standard` | billboard | TODO | |  |
| `billboard-wide` | billboard | TODO | |  |
| `bin` | bin | DONE | | [Bin prefab](../Assets/StationDesigner/Generated/Prefabs/Bin.prefab) · `./tools/unity-assets/prove-bench.ps1 -Asset bin` |
| `bridge` | track | TODO | |  |
| `busstop-long` | busstop | TODO | |  |
| `busstop-short` | busstop | TODO | |  |
| `calligraphy-hei-h` | calligraphy | TODO | |  |
| `calligraphy-hei-v` | calligraphy | TODO | |  |
| `calligraphy-kai-h` | calligraphy | TODO | |  |
| `calligraphy-kai-v` | calligraphy | TODO | |  |
| `calligraphy-li-h` | calligraphy | TODO | |  |
| `calligraphy-li-v` | calligraphy | TODO | |  |
| `calligraphy-song-h` | calligraphy | TODO | |  |
| `calligraphy-song-v` | calligraphy | TODO | |  |
| `calligraphy-wei-h` | calligraphy | TODO | |  |
| `calligraphy-wei-v` | calligraphy | TODO | |  |
| `calligraphy-xing-h` | calligraphy | TODO | |  |
| `calligraphy-xing-v` | calligraphy | TODO | |  |
| `cctv` | cctv | TODO | |  |
| `cctv-dome` | cctv | TODO | |  |
| `cctv-post` | cctv | TODO | |  |
| `cctv-ptz` | cctv | TODO | |  |
| `checkout` | checkout | TODO | |  |
| `checkout-cafe` | checkout | TODO | |  |
| `checkout-cafe-pastry` | checkout | TODO | |  |
| `checkout-generic` | checkout | TODO | |  |
| `clock` | clock | TODO | |  |
| `clock-digital` | clock | TODO | |  |
| `court-badminton` | court | TODO | |  |
| `court-divider` | court | TODO | |  |
| `court-pickleball` | court | TODO | |  |
| `cubicle` | cubicle | TODO | |  |
| `cubicle-toilet` | cubicle | TODO | |  |
| `curtain-wall` | glass | TODO | |  |
| `desk` | desk | TODO | |  |
| `door-glass-1` | door | TODO | |  |
| `door-glass-2` | door | TODO | |  |
| `door-steel-1` | door | TODO | |  |
| `door-steel-2` | door | TODO | |  |
| `door-wood-1` | door | TODO | |  |
| `door-wood-2` | door | TODO | |  |
| `electrical-cabinet` | electrical-cabinet | TODO | |  |
| `escalator` | escalator | TODO | |  |
| `exit` | exit | TODO | |  |
| `exit-covered-1` | exit | TODO | |  |
| `exit-covered-3` | exit | TODO | |  |
| `exit-doorway-1` | exit | TODO | |  |
| `exit-doorway-2` | exit | TODO | |  |
| `exit-doorway-3` | exit | TODO | |  |
| `exit-doorway-4` | exit | TODO | |  |
| `exit-uncovered-1` | exit | TODO | |  |
| `exit-uncovered-2` | exit | TODO | |  |
| `exit-uncovered-3` | exit | TODO | |  |
| `exit-virtual` | exit · review its runtime visual marker and placement preview | TODO | |  |
| `extinguisher` | extinguisher | TODO | |  |
| `extinguisher-compact` | extinguisher | TODO | |  |
| `extinguisher-glass` | extinguisher | TODO | |  |
| `fence` | fence | TODO | |  |
| `fence-gate` | fence | TODO | |  |
| `fence-iron` | fence | TODO | |  |
| `fence-steel-blue` | fence | TODO | |  |
| `floor-mark-boarding` | floor-mark | TODO | |  |
| `floor-mark-direction` | floor-mark | TODO | |  |
| `floor-mark-waiting` | floor-mark | TODO | |  |
| `gate` | gate | TODO | |  |
| `gate-new` | gate | TODO | |  |
| `glass-1x1` | glass | TODO | |  |
| `glass-1x2` | glass | TODO | |  |
| `glass-1x4` | glass | TODO | |  |
| `glass-2x1` | glass | TODO | |  |
| `glass-2x2` | glass | TODO | |  |
| `glass-2x4` | glass | TODO | |  |
| `glass-3x1` | glass | TODO | |  |
| `glass-3x2` | glass | TODO | |  |
| `glass-3x4` | glass | TODO | |  |
| `glass-4x4` | glass | TODO | |  |
| `guidepost` | guidepost | TODO | |  |
| `hanger-post` | hanger | TODO | |  |
| `hanger-roof` | hanger | TODO | |  |
| `lawn` | lawn | TODO | |  |
| `lift` | lift | TODO | |  |
| `light-circular` | light | TODO | |  |
| `light-rectangular` | light | TODO | |  |
| `linemap-stand` | linemap | TODO | |  |
| `linemap-wall` | linemap | TODO | |  |
| `monitor-ceiling` | monitor | TODO | |  |
| `monitor-wall` | monitor | TODO | |  |
| `noise-barrier` | fence | TODO | |  |
| `noise-barrier-half` | fence | TODO | |  |
| `noise-barrier-railing` | fence | TODO | |  |
| `pillar-slim` | pillar | TODO | |  |
| `pillar-thick` | pillar | TODO | |  |
| `psd-end` | psd-end | TODO | |  |
| `psd-end-cover` | psd-end | TODO | |  |
| `rail-signal` | rail-signal | TODO | |  |
| `road` | road | TODO | |  |
| `roof` | roof | TODO | |  |
| `roof-canopy` | roof | TODO | |  |
| `roof-shell` | roof | TODO | |  |
| `roof-tapered` | roof | TODO | |  |
| `roof-truss` | roof | TODO | |  |
| `shelf-bags` | shelf | TODO | |  |
| `shelf-books` | shelf | TODO | |  |
| `shelf-cafe-backbar` | shelf | TODO | |  |
| `shelf-cafe-backbar-2` | shelf | TODO | |  |
| `shelf-cafe-backbar-4` | shelf | TODO | |  |
| `shelf-clothing-rail` | shelf | TODO | |  |
| `shelf-clothing-shoes` | shelf | TODO | |  |
| `shelf-clothing-table` | shelf | TODO | |  |
| `shelf-clothing-wall` | shelf | TODO | |  |
| `shelf-cooler` | shelf | TODO | |  |
| `shelf-cooler-dark` | shelf | TODO | |  |
| `shelf-dark-tall` | shelf | TODO | |  |
| `shelf-food-bakery` | shelf | TODO | |  |
| `shelf-food-snacks` | shelf | TODO | |  |
| `shelf-fruit-island` | shelf | TODO | |  |
| `shelf-fruit-tiered` | shelf | TODO | |  |
| `shelf-ice-cream` | shelf | TODO | |  |
| `shelf-white-short` | shelf | TODO | |  |
| `shelf-white-tall` | shelf | TODO | |  |
| `shelf-wire` | shelf | TODO | |  |
| `sidewalk` | sidewalk | TODO | |  |
| `sign-ceiling` | sign | TODO | |  |
| `sign-wall` | sign | TODO | |  |
| `sink` | sink | TODO | |  |
| `stair-block` | stair | TODO | |  |
| `stair-centerForward` | stair | TODO | |  |
| `stair-left180` | stair | TODO | |  |
| `stair-left90` | stair | TODO | |  |
| `stair-leftForward` | stair | TODO | |  |
| `stair-right180` | stair | TODO | |  |
| `stair-right90` | stair | TODO | |  |
| `stair-rightForward` | stair | TODO | |  |
| `stair-straight` | stair | TODO | |  |
| `tactile-guide` | tactile | TODO | |  |
| `tactile-warning` | tactile | TODO | |  |
| `tactile-warning-strip` | tactile | TODO | |  |
| `traffic-light` | traffic-light | TODO | |  |
| `tree` | tree | TODO | |  |
| `tv` | tv | TODO | |  |
| `tv-double` | tv | TODO | |  |
| `tvm` | tvm | TODO | |  |
| `urinal` | urinal | TODO | |  |
| `vending` | vending | TODO | |  |
| `vent` | vent | TODO | |  |
| `walkway` | walkway | TODO | |  |

## Rolling stock and road traffic

| ID | Source family / coverage | Status | Owner | Unity output / evidence |
| --- | --- | --- | --- | --- |
| `train-A-two-car-proof` | Type A articulated two-car review fixture | DONE | | [Type A prefab](../Assets/TrainProof/TypeA.prefab) · [import and Web evidence](phase-0-handoff.md#imported-train-animation-in-web) |
| `train-A` | TrainModel · 6/8-car formations; verify cabs, intermediate cars, running gear, roof, gangways, interior, decals and both door banks | TODO | |  |
| `train-B` | TrainModel · 4/6-car formations; verify cabs, intermediate cars, running gear, roof, gangways, interior, decals and both door banks | TODO | |  |
| `train-C` | TrainModel · 4/6-car formations; verify cabs, intermediate cars, running gear, roof, gangways, interior, decals and both door banks | TODO | |  |
| `train-L` | TrainModel · 4/6-car formations; verify cabs, intermediate cars, running gear, roof, gangways, interior, decals and both door banks | TODO | |  |
| `train-D` | TrainModel · 8/8-car formations; verify cabs, intermediate cars, running gear, roof, gangways, interior, decals and both door banks | TODO | |  |
| `vehicle-suv` | RoadVehicleModel · geometry, scale, heading and LOD | TODO | |  |
| `vehicle-sedan` | RoadVehicleModel · geometry, scale, heading and LOD | TODO | |  |
| `vehicle-bus-orange` | RoadVehicleModel · geometry, scale, heading and LOD | TODO | |  |
| `vehicle-bus-mosaic` | RoadVehicleModel · geometry, scale, heading and LOD | TODO | |  |
| `vehicle-moped` | RoadVehicleModel · geometry, scale, heading and LOD | TODO | |  |
| `vehicle-bicycle` | RoadVehicleModel · geometry, scale, heading and LOD | TODO | |  |

## City styles and generated assets

| ID | Source family / coverage | Status | Owner | Unity output / evidence |
| --- | --- | --- | --- | --- |
| `city-guangzhou` | City style · applicable entrances, guideposts, signs and train marks | TODO | |  |
| `city-shenzhen` | City style · applicable entrances, guideposts, signs and train marks | TODO | |  |
| `city-shanghai` | City style · applicable entrances, guideposts, signs and train marks | TODO | |  |
| `city-beijing` | City style · applicable entrances, guideposts, signs and train marks | TODO | |  |
| `city-chengdu` | City style · applicable entrances, guideposts, signs and train marks | TODO | |  |
| `city-chongqing` | City style · applicable entrances, guideposts, signs and train marks | TODO | |  |
| `city-wuhan` | City style · applicable entrances, guideposts, signs and train marks | TODO | |  |
| `city-nanjing` | City style · applicable entrances, guideposts, signs and train marks | TODO | |  |
| `platform-edge` | PsdModel and PsdHousing · screen door forms, doors, housing, headers, decals and ends | TODO | |  |
| `track-kit` | TrackModel and TrackDetails · straight, curved, junction, tunnel, third rail and overhead supports | TODO | |  |
| `bridge-kit` | Bridge railing, noise barrier, edge concrete, pillars and generated support placement | TODO | |  |
| `structure-chunks` | chunkMesher and surfaceBatches · floors, walls, ceilings, finishes, exposed faces and edited neighbors | TODO | |  |
| `ramp-and-joins` | rampSurfaceMesh and RampJoinModel · elevations, orientation and connected surfaces | TODO | |  |
| `shop-room` | RoomModel and shop pieces · fitted rooms, shelves, stock and counters | TODO | |  |
| `retail-room` | RoomModel store adapter · validate authored retail appearance | TODO | |  |
| `ticket-booth` | BoothModel · shell, opening, furniture and dynamic signage | TODO | |  |
| `street-markings` | RoadArrowMarking and StreetDecorModel · arrows, lane markings and roadside details | TODO | |  |
| `dynamic-station-panels` | Panel and train mark atlases · editable signage, maps, posters and displays | TODO | |  |
| `passenger-original-placeholder` | PlaceholderCrowdMesh · static prototype exists; animated Unity asset and browser motion evidence | PARTIAL | |  |
| `passenger-production-rig` | Approved redistributable base, skins, age/size fits, wardrobe, hair, bags, LOD and motion recipes | BLOCKED — cleared source | |  |
| `passenger-activities` | Walking, idle, queues, stairs, escalators, boarding, seated and fixture interactions | TODO | |  |
| `catalogue-variant-audit` | Review per-family sim registries and builder attributes. Add missing finite variants or a parameter test matrix before closing the family. | TODO | |  |
| `renderer-source-audit` | Review every dispatcher and piece in game/src/render/models and scene systems. Assign unlisted renderable parts to an existing row or add a new row. | TODO | |  |
