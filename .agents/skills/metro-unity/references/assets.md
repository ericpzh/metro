# Station Designer Unity assets (`tools/unity-assets/`)

Sub-guide of [`metro-unity`](../SKILL.md) for converting Station Designer Three.js procedural builders, canvas-painted finishes, and source GLB/FBX models into Unity URP assets with deterministic CLI recipes, Khronos `gltf-validator` checks, repeatable `glTFast` Editor imports, and WebGL pixel proofs.

When `unity/plan/` is present locally (gitignored), consult `unity/plan/02-assets.md` for asset pipeline background and `unity/plan/model-migration-checklist.md` for per-variant migration history. Use `metro-game` for station equipment builders, `metro-model` for passenger rigs and activity poses, and [`metro-unity`](../SKILL.md) for C# runtime, simulation and bridge work.

## Dependencies and environment

From the repo root on Windows, use Node `24.15.0`, the pinned Unity `6000.6.8f1` Editor (`unity/ProjectSettings/ProjectVersion.txt`) with WebGL Build Support, `com.unity.cloud.gltfast@6.19.0`, and Chrome or Edge for WebGL pixel checks:

```powershell
npm.cmd --prefix game ci
npm.cmd --prefix tools/unity-assets ci
```

Pass `-Editor <absolute Unity.exe path>` (or set `METRO_UNITY_EDITOR`) for a non-default install, or `-SkipWeb` for import-only checks. Proof wrappers copy the Unity project into an isolated scratch directory, so the main Unity Editor on `unity/` can stay open.

## Family proof and promotion workflow (`prove-model.ps1`)

Production model families in `tools/unity-assets/` follow a three-file convention per `<family>` (`advert`, `barrier`, `canopy`, `cctv`, `civic`, `concourse`, `crowd`, `display`, `exit`, `fitout`, `fixture`, `formations`, `glass`, `hanger`, `light`, `monitor`, `opening`, `passenger`, `printed`, `retail`, `rolling`, `script`, `shelf`, `stair`, `structure`, `transit`, `vehicle`, `wayfinding`, `wayside`):

- `tools/unity-assets/export-<family>.mjs` — builds each variant from the real `game/src/` Three.js builder, validates portable GLB output with `gltf-validator` (zero errors/warnings), and writes `<variant>.glb` + `manifest.json` + `validation.json`.
- `tools/unity-assets/Review<Family>.cs` — `Metro.AssetExample.Review<Family>.Import()` and `.BuildWeb()` verify bounds, material slots, transparent queues, sockets/anchors and clips, save wrapper prefabs and a review scene, and log `<FAMILY>_IMPORT_OK`.
- `tools/unity-assets/check-web-<family>.mjs` — boots the WebGL review build in headless Chrome/Edge and verifies rendered pixels and shader health.

```powershell
# Run full export ×2 → import ×2 → WebGL check → promote to unity/Assets/StationDesigner/Generated/ → clean scratch
./tools/unity-assets/prove-model.ps1 -Family cctv

# Keep scratch project (default D:\metro-unity-scratch\<family>-*) and .preview/unity/<family>-* without promoting
./tools/unity-assets/prove-model.ps1 -Family opening -SkipPromote
```

`prove-model.ps1` uses `D:\metro-unity-scratch` by default (override with `-ScratchRoot`) to avoid filling the repo drive:

1. Runs `export-<family>.mjs` twice and requires byte-identical `.glb` SHA-256 hashes.
2. Imports into a clean URP scratch project twice and requires identical `.glb`, `.prefab` and `.meta` hashes on the second import (scene `.unity` files mint fresh runtime `fileID`s on save, so `Review<Family>.cs` validates scene structure directly).
3. Builds and pixel-checks the WebGL review player unless `-SkipWeb` is set.
4. Calls `promote-family.ps1` to install verified `.glb`, `.prefab`, review `.unity`, paired `.meta` files, and `unity/asset-recipes/catalogue.json` rows into `unity/Assets/StationDesigner/Generated/{Models,Prefabs,Review}/` while preserving existing destination GUIDs, then deletes its `.preview/unity/<family>-*` and scratch directory on success. If you debug with `-SkipPromote` or `-KeepEvidence`, clean up scratch artifacts before reporting done.

After changing promoted prefabs or recipes, refresh and verify the runtime lookup tables:

```powershell
node tools/unity-assets/build-runtime-views.mjs          # writes unity/asset-recipes/runtime-views.json (--check verifies)
node tools/unity-assets/audit-runtime-models.mjs         # cross-checks all 152 palette IDs + 208 demo variants -> 0 unresolved
node tools/unity-assets/ensure-meta.mjs                  # ensures paired .meta files exist for any newly staged assets
npm run test:unity                                       # runs runtime-views, runtime-model-inventory, renderer-audit guards
```

Inside Unity (or via `metro-editor.ps1` / `StationGameScene.Generate`), `Metro.Editor.RuntimeCatalogue.Generate` builds `Assets/StationDesigner/Generated/RuntimeCatalogue.asset` (204 recipe/view keys + 6 appended road vehicle keys) and `Metro.Editor.TrainCatalogueBuilder` builds `TrainCatalogue.asset` (51 formations across A/B/C/D/L × 2/3/4/6/8 cars × third-rail/overhead + `L.6.third-rail@zoo`).

## Reference fixture walkthroughs (`prove-bench.ps1`)

The standalone single-asset proof script `./tools/unity-assets/prove-bench.ps1` creates an isolated project under `.preview/unity/<asset>-*/` and exercises the three foundational conversion patterns:

### 1. Static geometry: linked-seat bench (`-Asset bench`, default)

```powershell
./tools/unity-assets/prove-bench.ps1
# Standalone export + validator only:
node tools/unity-assets/export-bench.mjs
```

1. Inspect `export/manifest.json` and `export/validation.json`: expect `station.bench.seat-2`, `252` triangles, three materials (`darkSteel`, `trainSeat`, `white`), zero validator errors/warnings, and byte-identical GLBs across both exports.
2. Check `repeat-import.log` for `BENCH_IMPORT_OK`: verifies GLB digest, material slots, Unity-axis bounds of `2.040 × 1.105 × 0.685 m`, named axes at four facings, and unchanged GLB `.meta` + wrapper prefab bytes on second import.
3. Inspect `bench-web.png` and `web-pixels.json` for two blue seats on white frames from the front three-quarter angle. Promoted destination: `Assets/StationDesigner/Generated/{Models/bench.glb,Prefabs/Bench.prefab,Review/Bench.unity}`.

### 2. Canvas-textured static piece: double-stream bin (`-Asset bin`)

```powershell
./tools/unity-assets/prove-bench.ps1 -Asset bin
```

1. Expect `station.bin.double-stream`, `196` triangles, four materials, two embedded textures (`1024 × 768` sorting sticker canvas and `128 × 128` brushed-steel canvas), zero validator errors/warnings.
2. `repeat-import.log` must contain `BIN_IMPORT_OK`: Unity bounds `0.880 × 0.950 × 0.420 m`, four named anchors (`AxisX`, `Front`, `Up`, and `Approach` on local `-y`), and transparent `binLabels` queue at `3000`.
3. `bin-web.png` shows both sorting stickers and the green recycling mark. Promoted destination: `Assets/StationDesigner/Generated/{Models/bin.glb,Prefabs/Bin.prefab,Review/Bin.unity}`.

### 3. Articulated doors and decals: Type A two-car train fixture (`-Asset train`)

```powershell
./tools/unity-assets/prove-bench.ps1 -Asset train
```

Invokes the game's Type A builder with two cars and catenary power (covering both cabs and a gangway; shipped formations use `export-rolling.mjs` and `export-formations.mjs`, and the early `unity/Assets/TrainProof/` folder has been retired in favor of `Assets/StationDesigner/Generated/`).

1. Inspect `validation.json`: `40` named door leaves, four embedded images, two 1 s clips (`OpenPlus`, `OpenMinus`), zero errors/warnings (informational notices for unused UVs and non-POT decal are expected; read severities separately).
2. Check `repeat-import.log` for `TRAIN_IMPORT_OK`: verifies glass render queue, texture bindings, scale, livery, and samples both clips at closed, plug-out and fully open against Three.js within `1 mm`, confirming the opposite door bank stays shut.
3. Inspect `train-web.png` for the near-side open pose and livery. Keep `unity/asset-recipes/train-A-motion.json` and `fixture-manifest.json` aligned with `train-a.glb` whenever rolling-stock builders change.

## Hard-won conversion rules and gotchas

- **Shadow `canvas.data = undefined` on `@napi-rs/canvas`:** `@napi-rs/canvas` exposes a `.data()` method on every `Canvas` instance. Three.js `GLTFExporter` treats any image with a truthy `.data` property as a `DataTexture` and writes an all-zero buffer instead of encoding PNG pixels — producing a GLB that passes `gltf-validator` with every texture transparent black. Always shadow `Object.defineProperty(canvas, 'data', { value: undefined })` in headless canvas shims (see `export-bin.mjs`, `export-train.mjs`, `export-station-finishes.mjs`). Never use a triangle-inventory no-op canvas stub when exporting textured models.
- **Alpha modes (`BLEND` vs `MASK`):** Glass exports as `BLEND`; decals such as the Nanjing mark export as `MASK`. When a Three.js material sets both `transparent: true` and `alphaTest > 0`, `GLTFExporter` emits `BLEND`, so inspect cutoff/sorting behavior in Unity URP materials explicitly. Pin font inputs before claiming text/branding pixel parity across machines.
- **Basis and `glTFast` X-reflection:** Source station space is Z-up `(x, y, z)`; Unity world is Y-up `(x, z, y)`. Exporters reset the placement root, rotate Z-up into glTF Y-up, and record source-space bounds and anchors. Because `glTFast` reflects X on import, the Unity wrapper prefab places its **180° Y correction on a parent GameObject** above the imported model root — preserving the imported root rotation and yielding `(x, z, y)` with `-90° * rot` yaw. Always verify winding, normals and asymmetric side labels (`+X`/`-X`, left/right door banks) at all four quarter-turns before reusing an adapter.
- **Motion metadata vs runtime state:** Three.js builders store door registries and plug/slide parameters in `userData`. Sample motion and assign unique node names *before* stripping renderer metadata for export. Treat GLB clips as interchange verification; C# (`ModuleMotion`, `TrainDoorRig`, `StationSimulationSession`) owns runtime door state and timing.
- **Hierarchy and WebGL payload size:** An unbatched two-car train GLB is ~21.8 MiB with 2,223 renderers. Production consists (`export-rolling.mjs` / `export-formations.mjs`) reuse car/part structures, merge compatible static meshes while keeping glass and articulated leaves separate, and must be checked in packed WebGL output alongside raw GLB bytes.
- **Procedural station surfaces stay in C#:** Block chunks, dynamic PSD runs, dimensioned stair/escalator/lift assemblies and road networks are generated at runtime in C# from the station document (`StationCellMesher`, `VerticalModuleViews`, `OpeningModuleViews`, `StationRoadView`), using exported finishes or reusable leaf/cab/post prefabs rather than static station snapshots.

## Station finishes and passenger library pipelines

- **Station surface finishes (`export-station-finishes.mjs`):**
  ```powershell
  node tools/unity-assets/export-station-finishes.mjs --station unity/Assets/StationDesigner/Zoo/ZooSave.json
  node tools/unity-assets/export-station-finishes.mjs --check --station unity/Assets/StationDesigner/Zoo/ZooSave.json
  node tools/unity-assets/export-station-finishes.mjs --stage
  ```
  Renders `game/src/render/materials.ts` deterministically with seeded RNG into `unity/asset-recipes/finishes/` (21 finishes / 25 PNGs + `finishes.json`) and stages runtime resources into `unity/Assets/StationDesigner/Resources/StationFinishes/` for `StationFinishLibrary`. Run `node tools/unity-assets/ensure-meta.mjs` if new files are staged.
- **Soft-human passenger library (`Generated/Passengers/`):**
  `export-passenger-library.mjs`, `ImportPassengerLibrary.cs` and `promote-passenger-library.ps1` build the 440-recipe library (`220` male / `220` female, 16 bones, 49 legacy clips); `node tools/unity-assets/check-passenger-library.mjs` validates all 440 prefab-to-GLB GUIDs and manifest hashes without re-exporting ~719 MiB of GLBs. Keep this folder `INTERNAL_REVIEW_ONLY` (no `Resources/` subfolder, never referenced by `Scenes/StationGame.unity` or public Web packs; enforced by `unity/tests/passenger-profile.test.mjs`).

## Delivering and troubleshooting assets

1. **Preserve GUID pairs:** Always copy or update `.glb`, wrapper `.prefab`, optional review `.unity` and every paired `.meta` (including folder `.meta`s) together. Dropping a `.glb` without its `.meta` breaks sub-asset `fileID` bindings on every referencing prefab and catalogue.
2. **Stop promotion immediately** if provenance/licensing is unverified, asymmetric side labels or door banks disagree with Three.js, required anchors/bone weights disappear, or a second import mutates `.meta` or `.prefab` bytes.
3. **Failure triage:**
   - *Export / validator failure:* Inspect recipe inputs, `@napi-rs/canvas` `data` shadowing, and `validation.json` error/warning codes first.
   - *Editor import failure:* Check `glTFast@6.19.0` package resolution, supported glTF extensions, URP shader graph availability, and asset path length/casing.
   - *WebGL-only failure:* Inspect URP shader stripping (`UniversalRenderPipelineGlobalSettings.asset`), transparent render queues, and runtime material bindings in a Release WebGL build.
