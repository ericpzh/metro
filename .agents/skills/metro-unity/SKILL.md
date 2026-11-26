---
name: metro-unity
description: Work on the Station Designer Unity 6 URP C# runtime (unity/Assets/StationDesigner/), assemblies, live Editor workflows (metro-editor.ps1), isolated batch and Windows .exe builds (metro-unity.ps1), EditMode/PlayMode tests, and tools/unity-parity/ oracles. Route bridge/WebGL/deploy to metro-unity-web and asset/LOD baking to metro-unity-assets.
---

# Station Designer Unity 6 URP runtime (`metro-unity`)

C# runtime, Editor automation, test suites, and TypeScript parity oracles for the
Station Designer Unity 6 URP port under `unity/` and `tools/unity-parity/`.
`GAME-SPEC.md` and `game/src/` remain the behavioral oracle.

## Routing and references

| Scope | Destination |
| --- | --- |
| Assemblies, C# file map, coordinates, sim parity, audio & `tools/unity-parity/` | [references/architecture.md](references/architecture.md) |
| Compile gate, `metro-editor.ps1`, `metro-unity.ps1`, Windows `.exe`, tests & `.gitignore` | [references/workflows.md](references/workflows.md) |
| Retained edits, picking, visibility, cutaway, skybox, exploded view, LODs, FSR 1.0 & glass | [references/rendering-lod-fsr.md](references/rendering-lod-fsr.md) |
| Shared React UI (`game/src/unity-web/`), Bridge v2, WebView2, WebGL pack/deploy & `unity/tests/` | [metro-unity-web](../metro-unity-web/SKILL.md) |
| Three.js/GLB conversion (`tools/unity-assets/`), finishes, passenger profiles & Mesh LOD baking | [metro-unity-assets](../metro-unity-assets/SKILL.md) |
| Unity performance invariants, Tianhe edit latency matrix & LOD inventory | [perf-unity.md](../metro-repo/references/perf-unity.md), [perf-tianhe-object-latency.md](../metro-repo/references/perf-tianhe-object-latency.md), [unity-model-lod-inventory.md](../metro-repo/references/unity-model-lod-inventory.md) |
| TypeScript behavioral reference (`game/src/` sim, build, render) | [metro-game](../metro-game/SKILL.md), [metro-game-sim](../metro-game-sim/SKILL.md), [metro-game-render](../metro-game-render/SKILL.md) |

## Pinned toolchain

Pinned in `unity/ProjectSettings/ProjectVersion.txt`, `unity/Packages/manifest.json`,
and `unity/scripts/node-version.txt`:

- **Unity Editor:** `6000.6.8f1 (237b6593792b)` with WebGL Build Support
  (`METRO_UNITY_EDITOR` overrides the Unity Hub executable path).
- **Key Unity packages:** `com.unity.render-pipelines.universal@17.6.0`,
  `com.unity.inputsystem@1.20.1`, `com.unity.ugui@2.6.0`,
  `com.unity.cloud.gltfast@6.19.0`, `com.unity.nuget.newtonsoft-json@3.2.1`,
  `com.unity.pipeline@1.0.0`, `com.unity.test-framework@1.8.0`.
- **Host tools:** Node `24.15.0`, `.NET 10 SDK` (for `check-unity-compile.ps1` and
  `MetroEditorWebView.csproj`), Microsoft Edge WebView2 Runtime, and the `unity`
  CLI on `PATH`.

## Execution loops at a glance

Choose the lightest loop that proves the layer you changed (details in
[references/workflows.md](references/workflows.md)):

```powershell
# 1. Engine-free C# compile gate (~2-4 s; builds CheckCore, CheckUnity, CheckEditor, CheckTests)
powershell -NoProfile -ExecutionPolicy Bypass -File tools/unity-parity/check-unity-compile.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools/unity-parity/check-unity-compile.ps1 -OutSuffix -tag

# 2. Live Unity Editor (requires unity/ open in Unity 6000.6.8f1 with Pipeline ready)
./unity/scripts/metro-editor.ps1 status
./unity/scripts/metro-editor.ps1 compile
./unity/scripts/metro-editor.ps1 test -Mode EditMode -TestFilter StationModelLodTests
./unity/scripts/metro-editor.ps1 test -Mode PlayMode -TestFilter StationExplodedViewPlayTests
./unity/scripts/metro-editor.ps1 smoke -Demo zoo -NoRepeat
./unity/scripts/metro-editor.ps1 verify -TestFilter StationScenePickerTests -Demo zoo

# 3. Isolated batch, WebGL & portable Windows .exe (never target a locked live Editor copy)
./unity/scripts/metro-unity.ps1 test -Mode EditMode -ProjectPath .preview/unity/<copy> -OutputDirectory .preview/unity/<out>
npm run test:unity                # Node contract & packaging tests (unity/tests/*.test.mjs)
npm run build:unity               # isolated WebGL build + React UI pack
npm run build:unity:windows       # isolated Win64 build + portable .preview/unity/StationDesigner.exe
npm run build:unity:msix          # isolated public Win64 build + Store-ready .preview/unity/StationDesigner-<ver>-x64.msix
./unity/scripts/metro-local-player.ps1 -Serve -Port 8801  # loopback-only soft-human WebGL pack
```

**Live Editor vs isolated batch rule:** Drive the open Editor on `unity/` only
through `unity/scripts/metro-editor.ps1` (and `unity ... command ... metro <cmd>`).
Keep `-batchmode` runs, WebGL/Windows player builds, and unfiltered test sweeps
in `unity/scripts/metro-unity.ps1` against an isolated scratch copy under
`.preview/unity/`. Never delete `Library/PackageCache/com.unity.pipeline@*`.

## Assembly and dependency rules

Enforced by `.asmdef` files under `unity/Assets/StationDesigner/` and pinned by
`unity/tests/runtime-layering.test.mjs` and `check-unity-compile.ps1`:

| Assembly | Engine refs | Allowed references | Responsibility |
| --- | --- | --- | --- |
| `Metro.Sim` | Forbidden | None | Clock, RNG, walk graph & workspace, A* & sparse hierarchical routing, service/doors/trains/lifts, road traffic, statistics. |
| `Metro.Build` | Forbidden | `Metro.Sim` | Paged `StationDocument`, sharded `StationIndex`, module facts/footprints, cell/module/road/finish/sign/structure edit planners. |
| `Metro.Persistence` | Forbidden | `Metro.Sim`, `Metro.Build`, `Unity.Newtonsoft.Json` | Sole JSON boundary: `StationSaveV1`, `StationDocumentReader`, `StationLocalEdit`, surgical cell/module/road/lift edits, repairs. |
| `Metro.View` | Allowed | `Metro.Sim`, `Metro.Build` | `StationCoordinates`, `ModulePlacement`, `StationVisibility`, `StationCellMesher` & workspace, exploded layout, rail/ramp geometry, catalogues. |
| `Metro.App` | Allowed | `Metro.Sim`, `Metro.Build`, `Metro.Persistence`, `Metro.View`, `Metro.Runtime`, `Unity.InputSystem`, `Unity.ugui` | `StationGameHost`, `StationLoadCoordinator`, `StationWorldView`, tools/picker/preview, sky/section/exploded/LOD/FSR, family views & displays. |
| `Metro.Runtime` | Allowed | `Unity.ugui` | Bootstrap & feasibility helpers (`Assets/StationDesigner/Scripts/`). |
| `Assembly-CSharp-Editor` | Editor-only | All runtime + `Unity.Pipeline` + `glTFast` | Scene/catalogue/LOD builders, `BuildWeb`, `BuildWindows`, `ImportAssets`, live Editor `metro` CLI commands (`Assets/StationDesigner/Editor/`). |
| `Metro.EditModeTests` / `Metro.PlayModeTests` | Test-only | Runtime + `Unity.ugui` + `Newtonsoft.Json.dll` + NUnit | Deterministic EditMode oracle/parity suites and PlayMode viewer/lifecycle suites (`Assets/StationDesigner/Tests/`). |

Keep `UnityEngine` out of `Metro.Sim`, `Metro.Build`, and `Metro.Persistence`,
and keep `Newtonsoft.Json` out of `Metro.Sim`, `Metro.Build`, and `Metro.View`.

## Load-bearing runtime contracts

- **Coordinates, handedness & flat-box winding:** `Metro.Sim` and `Metro.Build`
  stay in document axes `(x, y, z)` (`StoreyHeight = 5`). `StationCoordinates`
  is the sole conversion to Unity world `(x, z, y)` with `-90° * rot` yaw; raw
  `Point` adds no offsets (`CellCenter` / `FloorTop` are explicit). Procedural
  boxes must emit 24-vertex outward-wound quads via `GeometryKit.BoxFaces`
  (`MeshWindingTests`). See [references/architecture.md](references/architecture.md).
- **Retained incremental edits, single-pick routing & highlights:** Ordinary
  block/module edits, undo, and redo commit through `StationLocalEdit`,
  `StationWorldView.StageLocalWorld`, `StationCellMeshWorkspace` (`16 × 16`
  chunks), `StationWalkGraphWorkspace.StageCellDelta`, and Bridge v2 deltas.
  `StationPointerRouter` routes `StationSectionDrag` first and resolves at most
  one `StationScenePicker.PickRay` per pointer event (accelerated by a 2-level
  `RecordGroup` + `16 m × 16 m` XY spatial DDA grid and pre-warmed on non-batch
  station loads alongside `StationCellTool` and `StationEditHost`).
  `StationPlacementPreview` keeps hover, selection, and ghosts separate outside
  document commits and uses `StationHighlight.shader` for retained erase
  batches and `ShowCellHover` (including compound cuts). In the `pick`
  (eyedropper) tool, `StationPointerRouter` resolves visible modules, dug track
  beds (`StationRailPlanner.RailAt`), standing/room fallbacks
  (`StationFootprints.ModuleTarget` / `NeedsSurfaceHit` gated by
  `StationScenePicker.IsModuleVisible`), and solid block/wall/cut/wedge/ground
  face finishes (`StationCellRenderer.TryGetSnapshot` +
  `StationFinishEdits.FacePresent`/`FinishOf`), stamps monotonic `seq` and
  `armable` (`StationModulePick.ArmsTool`) on `StationEditSession.Picked`,
  preserves pick-driven selection across the ensuing `pick → target` tool
  switch (`PreserveNextToolChangeSelection`), ignores right-click/right-tap,
  and highlights hovered walls/blocks directly (`ShowCellHover`) rather than a
  flat tile on the adjacent air cell. See
  [references/rendering-lod-fsr.md](references/rendering-lod-fsr.md).
- **Model detail, non-active storey Mesh LODs & desktop batching:**
  `StationGraphicsSettings` owns `high` / `balanced` / `low` (`graphics.get` /
  `graphics.set`). Non-active storeys step down one Unity LOD tier
  (`High → LOD1`, `Balanced`/`Low → LOD2`) via
  `StationVisibilityRules.OtherLevelMeshLod` across `StationVisibilityTarget`,
  `StationInstancedSurfaceDrawer.SelectMeshLod`, and `PassengerCrowdView`.
  `HideUi`, `Cutaway`, exploded trays, placement previews (`forceMeshLod = 0`),
  and followed passengers keep normal detail (`StationModelLodTests`).
  `VerticalModuleViews` GPU-instances escalator/walkway steps via
  `EscalatorStepInstancedDrawer`, `StationPrefabBatch` combines same-material
  child meshes across multi-LOD tiers (`lodCount > 1`),
  `StationInstancedSurfaceDrawer` frustum-culls and coalesces same-key visible
  chunks across draw calls (`EquipBatchThreshold = 3`),
  `OpeningModuleViews` merges static opaque PSD parts / compacts `Gate`/`Door`/`Cubicle`
  subtrees / instances repeated `psd-end:cover` runs, and `PassengerCrowdView`
  frustum-culls early via `Skin.forceRenderingOff` (never `Skin.enabled`, which
  would poison `StationVisibilityTarget` eligibility) with O(N) two-pointer tick
  alignment and per-frame animation/LOD/spawn budgets (`96`/`48`/`24`/`128`)
  (`StationPerf*Tests`). Keep `GraphicsJobMode.Native` off and
  `QualitySettings.maxQueuedFrames` at default on Win64 D3D12.
- **Runtime FSR 1.0 upscaling:** `StationFsrUpscaler` supports `native`, `ultra`,
  `quality`, `balanced`, and `performance`. Platforms with
  `SystemInfo.graphicsShaderLevel >= 45` use URP native FSR (`urp-fsr1`); WebGL 2
  / ES 3.0 runs the two-pass EASU + RCAS `Resources/StationFsr1.shader`
  (`webgl-fsr1`) and restores `camera.targetTexture = null` after rendering so
  picking sees full screen dimensions (`StationFsrSettingsTests`).
- **Lock-free state publish, TV repaint budget & Unity audio:**
  `StationSimulationHost` snapshots immutable crowd counters and
  `StationPublishedStatistics` into `StationPublishedSimFrame` so 10 Hz
  `PublishStateNow()` stays lock-free on the main thread, streaming crowd state
  (`StationCrowdStateContributor.BuildJson`) and camera poses
  (`FastCameraPosePublished`) without intermediate `JObject` trees and caching
  raw JSON for `crowd`, `statistics`, `displays`, `render`, `psd`, `exit`,
  `roads`, `overlays`, and `sign`; PlayMode `StationDisplayTvArtwork.StateContributor`
  defers painting to `Advance()` (`4/frame`, `skipHidden: true`, pooled
  `StationTvPlatePainter` RTs). `StationCommandRouter` (`StationEditAudioOutcome`)
  derives edit cues without extra scene picks, and `StationGameHost.PublishAudio`
  streams bounded camera-relative ambience inputs via `JsonTextWriter`
  (suppressing duplicate silent frames) on the session-scoped `audio` channel
  for `game/src/unity-web/unityAudio.ts` using `game/public/audio/`. Hover,
  cancels, no-ops, and parked trains stay silent.
- **Simulation & vertical circulation parity:** Sparse hierarchical routing
  (`StationSparsePolicy`/`Topology`/`Router`, default `StationRoutingMode.Sparse`)
  mirrors `game/src/sim/sparse*.ts` (`StationSparseRoutingTests`,
  `crowd-routing-oracle.json`). Arrivals and alighters use the 3% step-free /
  8% luggage mix; train berths align doors with PSD openings, centre dual-platform
  (Spanish-solution) tracks at `track.d / 2`, spawn alighters inside the cabin to
  walk out through the train door and PSD (`StationServiceRuntime`,
  `PassengerCrowdView`, `StationTrainAndRailParityTests`), and `TrainDoorRig.Bind`
  un-plugs `closed.z` by `bank * plugTravel` on `authoredOpen` prefabs so Type A
  doors seat flush when closed and clear PSDs (`0.04 m` recessed leaf frames) when
  open. Platform PSDs use each line's colour band, amber oval doorway lights,
  half-height moving-leaf rails/caps, and support platform PSD deletion
  (`cfg.psd = "none"` + `cfg.removedPsdSides`, preserving yellow safety lines and
  undo/redo). Lifts model 40 s cycle, 15 riders/cycle queue wait, 0/30/300 s
  mobility penalties, and 3-phase walk-in/ride/walk-out (`LiftPhase` 0/1/2);
  stairs charge `32 s × StairFlights` (`StationServiceFrameTests`).
- **No silent fallbacks & public pack hygiene:** Report unresolved modules via
  `context.ReportUnresolved(...)` instead of substituting placeholder boxes.
  Keep `Generated/Passengers/` (`INTERNAL_REVIEW_ONLY`) strictly out of
  `StationGameLocal.unity` and public builds (see
  [metro-unity-assets](../metro-unity-assets/SKILL.md)).

## Verification checklist

1. Ensure every new tracked file under `unity/Assets/` has a paired `.meta` file
   (`node tools/unity-assets/ensure-meta.mjs` also enforces 2D `TextureImporter`
   blocks on images).
2. Run `tools/unity-parity/check-unity-compile.ps1` (use `-OutSuffix <tag>` for
   parallel runs) and `npm run test:unity`.
3. Run the owning EditMode/PlayMode tests (`-TestFilter <SingleFixtureOrMethod>`)
   and `smoke` via `metro-editor.ps1` (or `metro-unity.ps1` on a scratch copy;
   pass `-Graphics` for GPU/pixel tests like `StationHighlightRetentionTests`).
4. When touching shared bridge, React UI, WebGL packaging, or desktop overlay
   code, run the verification steps in
   [metro-unity-web](../metro-unity-web/SKILL.md#verification-checklist).
5. **Always rebuild the portable Windows `.exe`** (`npm run build:unity:windows` →
   `.preview/unity/StationDesigner.exe`) after Unity runtime, UI, or player fixes.
6. Keep scratch projects, captures, and build outputs inside `.preview/unity/`.
