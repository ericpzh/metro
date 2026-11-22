---
name: metro-unity-assets
description: Convert Station Designer Three.js builders, finishes, posters, line maps, trains, and soft-human passengers into Unity 6 URP assets, bake native 3-tier Mesh LODs, and enforce public vs local passenger profiles. Use for tools/unity-assets/, unity/asset-recipes/, Unity Editor asset/LOD/catalogue scripts, and model promotion.
---

# Station Designer Unity asset pipeline (`tools/unity-assets/`)

Converts `game/src/` Three.js procedural builders, canvas-painted finishes, static artwork,
rolling stock, and `model/` soft-human characters into deterministic Unity 6 URP assets under
`unity/Assets/StationDesigner/{Generated,Resources}/`, with Khronos `gltf-validator` checks,
repeatable `glTFast` imports, WebGL pixel proofs, and native 3-tier Mesh LOD baking.

- Conversion, basis, material, compaction, and LOD-budget contracts: [references/conversion-rules.md](references/conversion-rules.md)
- Per-model Unity triangle inventory: [unity-model-lod-inventory.md](../metro-repo/references/unity-model-lod-inventory.md)
- Measured Mesh LOD benchmarks & methodology: [performance.md](../metro-repo/references/performance.md#unity-native-mesh-lod-generation)
- Related skills: [`metro-unity`](../metro-unity/SKILL.md), [`metro-unity-web`](../metro-unity-web/SKILL.md), [`metro-game-render`](../metro-game-render/SKILL.md), [`metro-model`](../metro-model/SKILL.md).

## Toolchain prerequisites

Pinned in `unity/ProjectSettings/ProjectVersion.txt`, `unity/Packages/manifest.json`,
`unity/scripts/node-version.txt`, and `tools/unity-assets/package.json`:

- **Unity Editor:** `6000.6.8f1 (237b6593792b)` with WebGL Build Support (`-Editor <Unity.exe>` or
  `METRO_UNITY_EDITOR` overrides Unity Hub).
- **Unity packages:** `com.unity.cloud.gltfast@6.19.0`,
  `com.unity.render-pipelines.universal@17.6.0`, `com.unity.pipeline@1.0.0`,
  `com.unity.nuget.newtonsoft-json@3.2.1`.
- **Node & asset tools:** Node `24.15.0`, `@napi-rs/canvas@1.1.0`, `gltf-validator@2.0.0-dev.3.10`,
  and Chrome or Edge for WebGL pixel proofs.

```powershell
npm.cmd --prefix game ci
npm.cmd --prefix tools/unity-assets ci
```

Proof scripts copy `unity/` into an isolated scratch project so the live Editor on `unity/` can
stay open.

## Family proof & promotion (`prove-model.ps1`)

Each production model family under `tools/unity-assets/` (`advert`, `barrier`, `canopy`, `cctv`,
`civic`, `concourse`, `crowd`, `display`, `exit`, `fitout`, `fixture`, `formations`, `glass`,
`hanger`, `light`, `monitor`, `opening`, `passenger`, `printed`, `retail`, `rolling`, `script`,
`shelf`, `stair`, `structure`, `transit`, `vehicle`, `wayfinding`, `wayside`) owns three files:

- `export-<family>.mjs` — builds variants from `game/src/`, validates zero errors/warnings with
  `gltf-validator`, writes `<variant>.glb`, `manifest.json`, and `validation.json`.
- `Review<Family>.cs` — `Metro.AssetExample.Review<Family>.Import()` / `.BuildWeb()` verify bounds,
  material slots, queues, anchors, and clips, save wrapper prefabs and review scenes, and log
  `<FAMILY>_IMPORT_OK`.
- `check-web-<family>.mjs` — boots the WebGL review build in headless Chrome/Edge and checks
  rendered pixels and shader health (zero magenta).

```powershell
# Export x2 (SHA-256 identical) -> import x2 (.glb/.prefab/.meta identical) -> WebGL check -> promote -> clean
./tools/unity-assets/prove-model.ps1 -Family cctv

# Keep scratch (default D:\metro-unity-scratch\<family>-*; override via -ScratchRoot) without promoting
./tools/unity-assets/prove-model.ps1 -Family opening -SkipPromote
./tools/unity-assets/prove-model.ps1 -Family shelf -SkipWeb -KeepEvidence
```

`prove-model.ps1` invokes `promote-family.ps1` to copy verified `.glb`, `.prefab`, review `.unity`,
and paired `.meta` files into `unity/Assets/StationDesigner/Generated/{Models,Prefabs,Review}/`
while refusing GUID conflicts or silent overwrites. Upsert recipe rows into
`unity/asset-recipes/catalogue.json` via `node tools/unity-assets/catalogue-add.mjs <row.json>`.
Delete `-SkipPromote` or `-KeepEvidence` scratch folders before finishing.

After promoting prefabs or changing recipes, refresh and verify catalogues:

```powershell
node tools/unity-assets/build-runtime-views.mjs   # updates unity/asset-recipes/runtime-views.json (--check verifies)
node tools/unity-assets/audit-runtime-models.mjs  # checks MODULE_OPTIONS + 3 shipped demos -> 0 unresolved
node tools/unity-assets/ensure-meta.mjs           # writes/repairs .meta files (2D TextureImporter on images)
npm run test:unity                                # runtime-views, runtime-model-inventory, asset-meta, passenger-profile
```

Inside Unity (`Metro/Station Game/Generate Scene`, `metro-unity.ps1 catalogue`, or
`metro-unity.ps1 bootstrap`), `Metro.Editor.RuntimeCatalogue.Generate` builds
`Generated/RuntimeCatalogue.asset` (`runtime-views.json` plus the six `RoadVehicleViewKeys`
prefabs) and `Metro.Editor.TrainCatalogueBuilder.Generate` builds `Generated/TrainCatalogue.asset`
(all 50 menu formations across `A`/`B`/`C`/`D`/`L` × `2`/`3`/`4`/`6`/`8` cars ×
`third-rail`/`overhead` plus the `@zoo` livery slot).

## Reference fixture walkthroughs (`prove-bench.ps1`)

`./tools/unity-assets/prove-bench.ps1 -Asset <bench|bin|train> [-SkipWeb]` builds an isolated
project under `.preview/unity/<asset>-*/` and exercises the three core conversion patterns
(verified by `check-web.mjs`):

| `-Asset` | Files | Verified contract | Promoted target (`Generated/`) |
| --- | --- | --- | --- |
| `bench` | `export-bench.mjs`, `ReviewBench.cs` | Static `station.bench.seat-2`, 252 tris, 3 materials (`darkSteel`, `trainSeat`, `white`), `AxisX`/`Front`/`Up` anchors at 4 facings, `BENCH_IMPORT_OK` | `Models/bench.glb`, `Prefabs/Bench.prefab`, `Review/Bench.unity` |
| `bin` | `export-bin.mjs`, `ReviewBin.cs` | Canvas-textured `station.bin.double-stream`, 196 tris, 4 materials, 2 embedded canvases (`1024×768` stickers at queue `>= 3000`, `128×128` steel), `Approach` on `-y`, `BIN_IMPORT_OK` | `Models/bin.glb`, `Prefabs/Bin.prefab`, `Review/Bin.unity` |
| `train` | `export-train.mjs`, `ReviewTrain.cs` | 2-car Type A catenary fixture, 40 door leaves (`TypeADoor00`–`39`), 4 textures, `OpenPlus`/`OpenMinus` 1 s clips within 1 mm of `setDoorsSides`, transparent `glass`, `TRAIN_IMPORT_OK` | Shipped consists use `export-rolling.mjs` / `export-formations.mjs`; manifests in `unity/asset-recipes/{fixture-manifest,train-A-motion}.json` |

Transactional import rollback for `fixture-manifest.json` (`ImportAssets.Run` via
`metro-unity.ps1 import-assets`) is verified by
`node tools/unity-assets/test-import-transaction.mjs <scratch-project> <evidence-dir>`.

## Finishes, posters & city line maps

- **Station finishes (`export-station-finishes.mjs`):** Renders `game/src/render/materials.ts` with
  seeded RNG (`0x9e3779b9`) into `unity/asset-recipes/finishes/` (stock finishes, neutral white-base
  `detail/wall.{enamel,plaster}.png`, and optional `--station` custom tints) and stages runtime
  files for `StationFinishLibrary`:
  ```powershell
  node tools/unity-assets/export-station-finishes.mjs --station unity/Assets/StationDesigner/Zoo/ZooSave.json
  node tools/unity-assets/export-station-finishes.mjs --check --station unity/Assets/StationDesigner/Zoo/ZooSave.json
  node tools/unity-assets/export-station-finishes.mjs --stage unity/Assets/StationDesigner/Resources/StationFinishes
  ```
- **Billboard posters (`export-posters.mjs`):** Decodes `game/src/assets/posters/*.webp` into PNGs
  capped at `512 px` plus `posters.json` under `unity/Assets/StationDesigner/Resources/Posters/`.
- **City line maps (`export-linemaps.mjs`):** Decodes `game/src/assets/linemaps/*` into
  opaque-backed PNGs capped at `1024 px` (`--edge`) plus `linemaps.json` (with source SHA-256) under
  `unity/Assets/StationDesigner/Resources/LineMaps/`.

Run `node tools/unity-assets/ensure-meta.mjs` after staging textures outside Unity so every image
carries a 2D sRGB `TextureImporter` `.meta` (`unity/tests/asset-meta.test.mjs`).

## Passenger library & three passenger profiles

The 440-recipe soft-human library (`220` male / `220` female, 16 bones, 49 legacy clips) under
`unity/Assets/StationDesigner/Generated/Passengers/` is derived from `HumanBody_Alt.fbx` with **no
redistribution licence**: every manifest and asset carries `INTERNAL_REVIEW_ONLY` and
`production: BLOCKED`. **Never ship it publicly or create a `Resources/` folder inside it.**

- **Build & verify:** `export-passenger-library.mjs` exports the 440 GLBs (or
  `--lod-meshes [--stage-local-lods]` for the 880 skinned LOD1/LOD2 meshes under
  `Generated/Passengers/Lods/`), `ImportPassengerLibrary.cs` imports with glTFast `Legacy` clips and
  builds wrapper prefabs, `promote-passenger-library.ps1` copies them GUID-safely, and
  `node tools/unity-assets/check-passenger-library.mjs` checks all 440 GUIDs and hashes.
- **Three runtime profiles** (`node --test unity/tests/passenger-profile.test.mjs` and
  `--pack <public-pack-dir>`):
  1. **Public batchmode / release (`Scenes/StationGameLocal.unity`):** Serializes
     `PassengerCatalogueAnchor` with `catalogue = null`. Public builds
     (`npm run build:unity -- --scene StationGameLocal`,
     `metro-unity.ps1 build-web -Scene StationGameLocal`) spawn zero 3D actors
     (`passenger-catalogue-missing`), keep `Generated/Models/passenger-adult.glb` outside
     `Generated/Passengers/`, and serialize zero internal GUIDs.
  2. **Local Editor Play Mode (`StationGameLocal.unity` + `LocalPassengerInjection.cs`):**
     `PassengerCatalogueBuilder` (`Metro/Passengers/*`) builds
     `Generated/Passengers/passenger-catalogue.asset` (440 rows + LOD1/LOD2 skins).
     `LocalPassengerInjection` injects it in memory on Play Mode entry (`metro station_local_scene`).
  3. **Local WebGL / loopback (`Scenes/StationGameLocalWeb.unity`):**
     `PassengerCatalogueBuilder.BuildWebCohort()` builds the 15-recipe
     `Generated/Passengers/passenger-catalogue-web.asset`; `StationLocalProfile.PrepareLocalWebBuild`
     / `metro station_local_web_scene` binds it in gitignored `StationGameLocalWeb.unity` (never in
     `EditorBuildSettings.asset`; used by `./unity/scripts/metro-local-player.ps1` and loopback
     `npm start unity`).

## Native Unity 3-tier Mesh LOD baking & inventory

Model detail (`High` / `Balanced` / `Low`, configured under **Project Settings → Station Designer →
Graphics** via `StationGraphicsProjectSettings`) uses native Unity 3-tier meshes (`LOD0` full,
`LOD1` reduced, `LOD2` simplified). Low targets `LOD2 × 2 ≤ LOD0` before rounding; see
[references/conversion-rules.md](references/conversion-rules.md#lod-triangle-budget-policy-and-retention-exceptions).

- **Rigid prefabs (`StationMeshLodImporter.cs`):**
  - Bake one prefab: **Assets → Station Designer → Bake Rigid Model LODs** or CLI
    `metro bake_rigid_model_lod --prefab <PrefabName>`.
  - Bake all rigid prefabs & write `../.preview/unity/model-lod-rigid-coverage.csv`:
    **Metro → Station Game → Bake All Rigid Model LODs** (or audit via
    **Metro → Station Game → Audit Rigid Model LOD Coverage**).
  - Commit sidecars under `Resources/ModelLods/Rigid/<Prefab>.asset` with paired `.meta` files, then
    verify strict coverage:
    ```powershell
    node tools/unity-assets/audit-runtime-models.mjs .preview/unity/model-inventory/runtime-model-inventory.json
    node tools/unity-assets/audit-model-lod-coverage.mjs .preview/unity/model-inventory/runtime-model-inventory.json .preview/unity/model-lod-rigid-coverage.csv .preview/unity/model-lod-coverage.json --strict
    ```
- **Train formations (`export-formations.mjs` + `TrainMeshLodBaker.cs`):**
  ```powershell
  node tools/unity-assets/export-formations.mjs .preview/unity/train-lod-catalogue --lod-meshes
  unity --no-banner --no-pager --format json command --project-path "$PWD/unity" --timeout 180 metro bake_train_lods --export-path "$PWD/.preview/unity/train-lod-catalogue"
  ```
  Writes `Resources/ModelLods/TrainMeshes.asset`, packed by
  `TrainConsistViews.CompactConsistInstance` (`>= 50%` Low savings checked in `StationModelLodTests`).
- **Local passenger LODs:**
  ```powershell
  node tools/unity-assets/export-passenger-library.mjs .preview/unity/passenger-lod-library --lod-meshes --stage-local-lods
  ```
  Stages `LOD1`/`LOD2` skins and `passenger-lods.json` inside `Generated/Passengers/Lods/` for
  `PassengerCatalogueBuilder`.
- **Regenerate `unity-model-lod-inventory.md`:**
  ```powershell
  unity --no-banner --no-pager --format json command --project-path "$PWD/unity" --timeout 180 metro model_lod_inventory
  node tools/unity-assets/write-model-lod-inventory.mjs
  ```
  Pass `--strict` to fail if any shipped model misses the Low target or lacks valid counts. Pass
  positional args (`<inventoryJson> <coverageJson> <passengerManifestJson> <passengerLodsJson>
  [outputMd]`) to read staged `Generated/Passengers/Lods/passenger-lods.json` when `.preview/` lacks
  a fresh passenger LOD export. Verify runtime LOD behavior with
  `./unity/scripts/metro-editor.ps1 test -Mode EditMode -TestFilter StationModelLodTests`.
