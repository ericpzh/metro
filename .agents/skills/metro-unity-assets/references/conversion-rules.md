# Unity asset conversion rules & LOD policy

Engineering contracts for exporting `game/src/` Three.js builders and `model/`
soft-human characters into Unity 6 URP (`6000.6.8f1`,
`com.unity.cloud.gltfast@6.19.0`). Return to [SKILL.md](../SKILL.md) for
commands and workflows.

## Basis, handedness, `glTFast` reflection & winding

- **Source vs Unity axes:** Station documents and Three.js builders use Z-up
  `(x, y, z)` in metres. Unity world space is Y-up `(x, z, y)` with saved
  quarter-turns mapping to `-90° * rot` Unity yaw (`StationCoordinates`).
- **Exporter root rotation:** Exporters reset the builder's placement position
  and rotation (recording `placementOffset` in `manifest.json`), attach basis
  anchors (`AxisX = [1, 0, 0]`, `Front = [0, 1, 0]`, `Up = [0, 0, 1]`, plus
  `Approach = [0, -1, 0]` where applicable), and wrap the Z-up root under a
  glTF Y-up parent rotated `rotation.x = -Math.PI / 2`.
- **`glTFast` X-reflection & wrapper basis:** Because `glTFast` reflects X on
  import, Unity wrapper prefabs place a **180° Y rotation on an intermediate
  parent (`Unity basis`)** above the instantiated GLB root
  (`Quaternion.Euler(0, 180, 0)`). This preserves the imported root transform
  and restores `(x, z, y)` so `AxisX -> right`, `Front -> forward`,
  `Up -> up`, and `Approach -> back` hold across all four 90° facings.
- **Asymmetry & special topologies:**
  - Verify normals, winding, and asymmetric side labels (`+X` / `-X`, left /
    right door banks, facade `-y`) at all four quarter-turns before promoting.
  - Opening GLBs keep Z-up content under the `-90°` X export node, so runtime
    swing door hinges rotate around local Z rather than local Y, and cabinet
    measurements on `glTFast`-mirrored prefabs run in holder space.
  - Skinned passenger GLBs (`export-passenger-library.mjs`) export in Y-up
    character space with `Hips` permuted to `bones[0]` (`GLTFExporter` writes
    `skin.skeleton` from `bones[0]`); `glTFast` reflects X on import, swapping
    `mesh.bounds.min.x` and `-max.x` (`ImportPassengerLibrary.cs`).
  - Non-triangle submeshes (`MeshTopology.Lines`, e.g. `CourtBadminton` /
    `CourtPickleball` nets) are preserved untouched; always check
    `GetTopology(sub) == MeshTopology.Triangles` before reading triangle
    indices.

## Canvas textures, materials & `.meta` rules

- **Shadow `canvas.data = undefined` on `@napi-rs/canvas`:** `@napi-rs/canvas`
  defines a `.data()` method on `Canvas`. Three.js `GLTFExporter` treats any
  image with a truthy `.data` property as a `DataTexture` and emits an
  all-zero buffer, passing `gltf-validator` while turning every texture
  transparent black. Always apply
  `Object.defineProperty(canvas, 'data', { value: undefined })` in headless
  canvas shims (`export-bin.mjs`, `export-train.mjs`, `export-formations.mjs`).
  Never use a no-op canvas stub for textured models.
- **Deterministic PNG & RNG encoding:**
  - `GLTFExporter` invokes `canvas.toBlob` concurrently across materials;
    serialize encodes through a sequential promise queue (`canvasEncodeQueue`
    in `export-formations.mjs`) so image and `bufferView` ordering stays
    byte-identical across repeat exports.
  - Seed `Math.random` before calling `createModelMaterials()` or
    `createMaterials()` (`Rng(1)` in `train-source.mjs`, `0x9e3779b9` in
    `export-station-finishes.mjs`) so procedural brushed-steel strokes and
    finishes produce identical PNG digests.
- **Alpha modes & render queues:**
  - Glass exports as glTF `BLEND` and must retain a transparent Unity render
    queue (`>= 3000`). Decals such as city train marks export as `MASK`.
  - When a Three.js material sets both `transparent: true` and `alphaTest > 0`,
    `GLTFExporter` emits `BLEND`; inspect cutoff/sorting in Unity URP
    explicitly.
  - Pin font inputs before asserting pixel parity on text-bearing artwork.
- **2D `TextureImporter` `.meta` requirement:** Every image under
  `unity/Assets/` (such as `Resources/{StationFinishes,Posters,LineMaps}/`)
  must carry a full 2D sRGB `Repeat` `TextureImporter:` block in its `.meta`.
  A GUID-only `.meta` causes Unity to import PNGs as `Cubemap`s so
  `Resources.Load<Texture2D>` returns `null`. Run
  `node tools/unity-assets/ensure-meta.mjs` after staging images outside Unity
  (`unity/tests/asset-meta.test.mjs`).
- **Procedural station geometry stays in C#:** Cell chunks, dynamic PSD runs,
  dimensioned stairs/escalators/lifts, roofs/pillars/hangers, curtain glass,
  track/bridge runs, and road decks are built at runtime in C# from the
  station document using exported finishes and reusable leaf/post/cab prefabs,
  never exported as static station snapshots.

## Khronos `gltf-validator` & deterministic import gates

- **Zero errors and zero warnings:** Every exporter runs `gltf-validator`
  (`2.0.0-dev.3.10`) and fails if `issues.numErrors + issues.numWarnings !== 0`.
  Inspect severities separately: informational notices (e.g. unused UVs or
  non-POT decals on train fixtures) are permitted only when errors and
  warnings are zero.
- **Strip renderer metadata cleanly:** Three.js builders store renderer-only
  LOD geometries and door registries in `userData` with non-deterministic
  UUIDs. Sample door motion and assign deterministic node names *before*
  clearing `object.userData = {}` for export.
- **Double-export & double-import stability:** `prove-model.ps1` and
  `prove-bench.ps1` require byte-identical `.glb` SHA-256 hashes across two
  exports and identical `.glb`, `.prefab`, and `.meta` hashes across two Unity
  imports. Scene `.unity` files mint fresh runtime `fileID`s on save, so
  review scripts validate scene structure directly instead of hashing `.unity`
  bytes.
- **Preserve GUID pairs & atomic staging:** Always move `.glb`, wrapper
  `.prefab`, optional `.unity`, and every paired `.meta` (including folder
  `.meta`s) together. Replacing a `.glb` without keeping its `.meta` GUID
  breaks sub-asset `fileID` bindings on every referencing prefab and catalogue.
  `Metro.Editor.ImportAssets` validates a complete batch inside
  `Assets/__MetroFixtureImportStaging` before delivery and restores backed-up
  bytes + `.meta` on failure (`test-import-transaction.mjs`).
- **glTFast animation method for skinned characters:**
  `ImportPassengerLibrary.cs` pre-seeds `.glb.meta` from an existing glTFast
  `ScriptedImporter` template and enforces `importSettings.animationMethod =
  Legacy` so all 49 standing/walk/activity clips import as legacy
  `AnimationClip`s without a second 440-file reimport.

## Articulated doors, decals & train compaction

- **Motion clips vs runtime ownership:** Exporters sample `setDoorsSides`
  across five poses (`[0,0]`, `[0.18,0]`, `[1,0]`, `[0,0.18]`, `[0,1]`) and
  emit 1 s `OpenPlus` / `OpenMinus` clips on uniquely named leaves
  (`TypeADoor00`–`39`, `<partId>Door00`–`NN`). Review/import gates verify all
  five poses against Three.js within `1 mm` (`ReviewTrain.cs`) / `2 mm`
  (`ImportAssets.cs`) and confirm the opposite bank stays shut. Clips verify
  interchange; C# (`ModuleMotion`, `TrainDoorRig`, `StationSimulationSession`)
  owns runtime door state.
- **Shared car parts & runtime compaction:** Shipped consists are assembled
  from reusable `export-formations.mjs` parts (lead cab, trail cab, mid car,
  plain/well 2.24 m roof slice, gangway, pantograph) rather than monolithic
  multi-car GLBs (~21.8 MiB unbatched for 2 cars). At runtime,
  `TrainConsistViews.CompactConsistInstance`:
  - Combines static car and gangway meshes by `(Material, ShadowCastingMode)`
    while protecting `Door\d+$` subtrees and anchor nodes (`DoorCentre*`,
    `AxisX`, `Front`, `Up`, `Approach`).
  - Drops selected opaque static details by tier (`StaticDetailLastTier`):
    `bogie-wheel-face-bolt` and `bogie-primary-coil-spring` drop after `LOD0`;
    `hanging-strap`, `cabin-ring-light`, and `underframe-vent` drop after
    `LOD1`. Transparent/glass buckets never omit detail.
  - Packs baked `TrainMeshLods` Low replacements (`Resources/ModelLods/TrainMeshes.asset`)
    alongside High/Balanced ranges via `StationMeshLodIndices.ApplyLowOverride`,
    and applies unbatched Low tiers to moving door leaves and pantographs
    while preserving their transforms and materials.
- **Train LOD bake parity (`TrainMeshLodBaker.cs`):** `export-formations.mjs
  --lod-meshes` simplifies eligible opaque, untextured single-group meshes
  (`>= 48` tris) with `MeshoptSimplifier` (`0.6` / `LockBorder`, `0.20` /
  `Permissive`, preferring authored `modelDetailGeometry` when smaller).
  `TrainMeshLodBaker.Collect` requires exact SHA-256 provenance against
  promoted `Generated/Models/*.glb` plus identical child counts, local TRS,
  and submesh counts between full and `-lod2.glb`.

## LOD triangle-budget policy and retention exceptions

Per-model counts live in
[unity-model-lod-inventory.md](../../metro-repo/references/unity-model-lod-inventory.md)
and methodology/frame captures in
[performance.md](../../metro-repo/references/performance.md#unity-native-mesh-lod-generation).

- **Low triangle target:** `LOD2 × 2 ≤ LOD0` before rounding (`>= 50%`
  reduction from High to Low). Zero-triangle geometry and unchanged 2-triangle
  quads (`Calligraphy*`, `FloorMark*`, `SignWall`) are `Exception`s in
  `write-model-lod-inventory.mjs`.
- **Rigid prefab sidecars (`StationMeshLodImporter.cs`):** Excludes
  `Formation*.prefab` and `Train{A,B,C,D,L}.prefab`. For each readable
  triangle-only mesh, calls `MeshLodUtility.GenerateMeshLods(mesh, 4)` and
  packs 3 tiers `[0, 1, last]` into
  `Resources/ModelLods/Rigid/<Prefab>.asset` (`StationRigidModelLods`), keyed
  by `PrefabDependencyHash`. Unsimplifiable or non-triangle meshes record an
  explicit `ReuseReason` (`StationModelLodTests`).
- **Procedural 3-tier `StationMeshLodIndices` builders:**
  - `pillar-round` (`StructureParts.Cylinder`): closed 32 / 16 / 8 segment
    cylinder sharing vertex positions.
  - `track-24m` (`RailRunGeometry.Build`): retains rail heads and sleepers;
    drops fasteners/clips across `LOD1` / `LOD2`.
  - `booth-ticket` / `booth-info` (`BoothModuleViews`): retains counter,
    fascia, and glazing; omits small fittings, posts, and recess trim at `LOD2`.
- **Explicitly retained procedural paths** (same geometry across `LOD0`–`LOD2`
  to protect motion, walk-contact, cutaways, or picking):

| Family / system | Retention reason |
| --- | --- |
| `escalator` | Step band, comb plate, landing, side shell, and handrails keep motion and section outlines. |
| `gate` | Gate leaf and adjacent fence keep exact span, gaps, hinges, and passable opening. |
| `glass` | Flat panes and straight frames keep exact pane edges and cutaway extents. |
| `lift` | Cabin, door leaf, and shaft surfaces keep floor stops, motion, and vertical cutaways. |
| `platform-edge` | Retains platform edge, moving leaves, infill gaps, and content surfaces. |
| `psd-end` | Retains exact return faces meeting the platform wall without opening seams. |
| `stair` | Treads, landings, and rails keep walk-contact and section silhouettes. |
| `station-cell-chunks` | Exposed cell faces stay exact across tiers for cuts, face picks, finishes, and AO. |
| `construction-and-catalogue-previews` | Always renders `LOD0` (`forceMeshLod = 0`) so previews match placed geometry. |

- **Skinned passenger LOD invariant:** `PassengerCatalogueBuilder.LoadMeshTier`
  binds `Generated/Passengers/Lods/Models/...-lod{1,2}.glb` onto
  `PassengerCatalogue` only when `skin.bones` names and `sharedMesh.bindposes`
  match `LOD0` in exact order and `passenger-lods.json` matches
  `passenger-library.manifest.json`'s `recipeSha256`. `LOD2` reuses the
  topology-preserving baked `lowIndices` from `passenger-approved.json` (no
  spatial `ConvexHull` limb-to-body bridging). Every asset under
  `Generated/Passengers/` remains `INTERNAL_REVIEW_ONLY`.

## Promotion stop-gates & troubleshooting

Stop promotion immediately if provenance/licensing is unverified, asymmetric
side labels or door banks disagree with Three.js, required anchors or bone
weights disappear, or a repeat import changes `.meta` or `.prefab` bytes.

| Failure stage | First things to check |
| --- | --- |
| **Export / validator** | Recipe inputs, `canvas.data = undefined` shadowing, sequential `toBlob` queue, seeded RNG, `validation.json` error/warning codes. |
| **Editor import / GUIDs** | `com.unity.cloud.gltfast@6.19.0` resolution, supported glTF extensions, URP shader graphs, paired `.meta` files (`ensure-meta.mjs`), `TextureImporter:` block on PNGs, path length/casing. |
| **WebGL-only failure** | URP shader stripping (`UniversalRenderPipelineGlobalSettings.asset`, `StationGlassRef.mat`, `StationUnlitTransparentRef.mat`), transparent queues (`>= 3000`), magenta pixels in `check-web-*.mjs`. |
| **LOD bake / inventory** | Stale `PrefabDependencyHash` after prefab promotion (re-run `Bake Rigid Model LODs`), `Formation*` GLB hash drift before `metro bake_train_lods`, missing `.preview/unity/model-lod-coverage.json` or staged `passenger-lods.json` args in `write-model-lod-inventory.mjs`. |
| **Public pack passenger leak** | Run `node --test unity/tests/passenger-profile.test.mjs` and `--pack <pack-dir>`; verify `StationGameLocal.unity` has `catalogue: null`, no `Resources/` inside `Generated/Passengers/`, and neither `StationGameLocal.unity` nor `StationGameLocalWeb.unity` is in `EditorBuildSettings.asset`. |
