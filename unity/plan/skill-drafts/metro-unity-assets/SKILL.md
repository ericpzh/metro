---
name: metro-unity-assets
description: Convert Station Designer Three.js and source GLB models into Unity assets with CLI recipes, validation and repeatable Editor import. Use for model conversion, recipe additions, importer failures and mesh or animation parity. Route gameplay changes through the runtime migration plan.
---

# Station Designer Unity assets

Read `unity/plan/02-assets.md` for the full asset pipeline design. Read `metro-game` for station equipment and `metro-model` for passenger art and activity sources.

## Run the linked-seat example

From the repo root on Windows, use Node 24, the local Unity URP project, the matching licensed editor and Web Build Support. Chrome or Edge is required for the Web check.

```powershell
npm.cmd --prefix game ci
npm.cmd --prefix tools/unity-assets ci
./tools/unity-assets/prove-bench.ps1
```

Use `-Editor <absolute Unity.exe path>` for a custom install or `-SkipWeb` for the import-only check. The wrapper prints the evidence directory and creates a separate project under `.preview/unity/bench-*/`, so the main Editor can stay open. The standalone export and validator also run with `node tools/unity-assets/export-bench.mjs`.

1. Read `export/manifest.json` and `export/validation.json` in the evidence directory. Expect `station.bench.seat-2`, 252 triangles, three materials, and zero validator errors and warnings. The two exports must produce identical GLB bytes.
2. Check `repeat-import.log` for `BENCH_IMPORT_OK`. The command verifies the GLB digest, material slots, bounds of 2.040 × 1.105 × 0.685 m in Unity axes, and named axes at four facings. It verifies that a second import preserves the GLB metadata and wrapper prefab bytes. The project contains `Assets/BenchProof/Bench.prefab` and the generated review scene.
3. Inspect `bench-web.png` for two blue seats and white frames from the front three-quarter angle. `web-pixels.json` records the basic rendered-frame and shader check.

## Run the Type A train example

Install the same dependencies and run `./tools/unity-assets/prove-bench.ps1 -Asset train`. The exporter invokes the game's Type A builder with two cars and catenary power. This fixture covers both cabs and a gangway. The shipped Type A uses six or eight cars. Find the verification outputs in the printed `.preview/unity/train-*/` directory. The delivered prefab and source GLB live in `unity/Assets/TrainProof/`.

1. Inspect the GLB and `validation.json`. Expect 40 named door leaves, four embedded images and two one-second clips named `OpenPlus` and `OpenMinus`. The GLB should validate with zero errors and warnings. Three.js normalizes some source normals during export. The validator reports informational notices for unused UVs and a non-power-of-two decal, so read severities separately.
2. Read `repeat-import.log` for `TRAIN_IMPORT_OK`. Unity checks the imported glass queue, embedded texture bindings, scale, livery and both animation clips. It samples each clip at closed, plug-out and fully open, and compares every leaf to Three.js within 1 mm, including the bank that must stay closed.
3. Inspect `train-web.png` for the full fixture with the near-side doors open and the correct livery. This Web scene shows a fixed open pose. The animation sampling runs in the Unity Editor, and driving the clips from the running Web simulation is a separate integration step.

The train exposed three gaps in a bench-only workflow.

- **Canvas and material conversion.** The train builder creates textures even for a headless export. The pinned `@napi-rs/canvas` adapter supplies real 2D rasterization and PNG encoding. A canvas stub used for triangle inventories would lose artwork. Check GLB alpha modes as well as Unity materials. The export carries glass as `BLEND` and the Nanjing decal as `MASK`. For materials with both Three.js `transparent` and `alphaTest` enabled, GLTFExporter chooses `BLEND` and the cutoff needs a Unity material decision. Pin font inputs and compare pixels before claiming text or branding parity across machines.
- **Motion metadata.** Three.js keeps door registries and plug/slide parameters in `userData`. Read and sample motion before stripping renderer metadata. Name every articulated node uniquely, create separate clips for each bank, and validate both the moving leaves and the stationary leaves after import. Treat clips as interchange evidence. The C# simulation owns door state and timing in the game.
- **Asset size and hierarchy.** The unbatched two-car GLB is about 21.8 MiB with 2,223 renderers after import. Use it as a review fixture. For production, prototype reusable end and middle cars, merge compatible static geometry, keep glass and articulated nodes separate, then measure a six- or eight-car consist in a release-equivalent browser build. Check packaged Web files separately from GLB size. This review build's uncompressed WASM was 32.8 MiB.

## Run the trash-bin example

Run `./tools/unity-assets/prove-bench.ps1 -Asset bin` for a canvas-textured static piece. Inspect `export/manifest.json` and `validation.json` in the evidence directory. Expect `station.bin.double-stream`, 196 triangles, four materials, two textures and zero validator errors and warnings. `repeat-import.log` must contain `BIN_IMPORT_OK`: bounds of 0.880 × 0.950 × 0.420 m in Unity axes, four named anchors (`AxisX`, `Front`, `Up` and the bin's own `Approach` on local −y), the transparent `binLabels` queue at 3000, the 1024 × 768 sticker canvas and the 128 × 128 brushed-steel canvas. `bin-web.png` shows the two sorting stickers and the green recycling mark from the front three-quarter angle. `unity/asset-recipes/catalogue.json` records the recipe row.

The canvas adapter has one sharp edge. `@napi-rs/canvas` exposes a `data()` method on every Canvas, and Three.js `GLTFExporter` treats any image with a `data` property as a `DataTexture`. It then writes an all-zero buffer instead of the canvas pixels, so the GLB validates but every texture is transparent black. Shadow `data` with `undefined` on each canvas created by the shim; both the bin and train exporters do this.

The bin is also promoted into the main URP project with its proof GUIDs preserved: `Assets/StationDesigner/Generated/Models/bin.glb`, `Prefabs/Bin.prefab` and `Review/Bin.unity`. Open that scene to inspect the wrapper prefab, anchors and materials. The project pins `com.unity.cloud.gltfast@6.19.0`. Regenerate the proof first, then copy the GLB, prefab and scene with their `.meta` files together; dropping only the `.glb` loses the imported sub-asset references.

The bench follows the same promotion layout: `Assets/StationDesigner/Generated/Models/bench.glb`, `Prefabs/Bench.prefab` and `Review/Bench.unity`. Expect bounds 2.040 × 1.105 × 0.685 m in Unity axes, 252 triangles and the `darkSteel`, `trainSeat` and `white` materials. The catalogue entry is `station.bench.seat-2`.

## Adapt the example

Find the real source generator, catalogue ID, dimensions and provenance before writing an adapter. Reuse a stable local origin, material names and named anchors. Keep procedural station surfaces runtime-generated and use a representative snapshot for comparison. Use the game-pinned Three.js exporter and validate portable GLB before Unity import. For the bench, the exporter resets the placement root, rotates Z-up into glTF Y-up, and records the source-space bounds and anchors. glTFast reflects X. The Unity wrapper puts its 180° Y correction on a **parent** of the imported model to preserve the imported root rotation and obtain `(x,z,y)`. Verify basis and winding with asymmetric geometry before reusing it on another asset.

Keep the imported model and wrapper prefab separate. Add validation for each asset's relevant materials, sockets, bounds, skin weights and clips. Use the matching Web review scene to inspect the finished import. The general catalogue and batch runner described in the migration plan are future work.

## Deliver the verified asset to Unity

The proof command generates scratch evidence. When the user asks to convert a model for this project, finish by installing the verified asset under the real `unity/Assets/` tree. Use scratch-only output when the user requests a review or trial in isolation.

1. Record the destination and check for existing assets before copying. For a first delivery, bring over the verified GLB, wrapper prefab and their paired `.meta` files together. Include a review scene and its metadata when it helps the user open the asset. Copy the folder's `.meta` alongside it. The wrapper references the GLB's GUID, so keep the pair intact. For updates, preserve destination GUIDs and regenerate wrappers against the destination import with the Editor APIs.
2. Ensure the destination resolves the pinned importer. Use the Unity Package Manager API or promote the package files it generated from a matching project after reviewing the diff. Keep unrelated dependencies intact. With the destination Editor open, let it refresh in place. Use a separate project for batch validation so the running Editor keeps its project lock.
3. Verify the files and references in the destination. Check Git visibility for source assets and metadata, and keep the generated Web build, caches and QA screenshots under `.preview/`. Report the real project path as the deliverable and link the scratch evidence separately.

Stop promoting the asset if the provenance is unknown, side labels disagree, required anchors or weights disappear, or a clean import introduces unexpected dependencies. On export failure, inspect the recipe and exporter warnings first. On Editor import failure, check supported extensions, shader support, paths and Unity package resolution. On Web-only failure, inspect shader stripping and runtime material bindings using the release build.
