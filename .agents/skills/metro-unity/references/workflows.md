# Unity build, Editor, test & Windows player workflows

Verified commands and operational constraints for compiling, testing, capturing,
and building the Unity 6 URP port from the repository root (Windows PowerShell
5.1; avoid `&&` in `.ps1`-invoked shells).

## 1. Fast engine-free C# compile gate (`check-unity-compile.ps1`)

Compiles all four C# layers in ~2–4 s via `dotnet build` using Unity's generated
`*.csproj` reference lists without opening Unity or writing into `Assets/`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/unity-parity/check-unity-compile.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools/unity-parity/check-unity-compile.ps1 -OutSuffix -agent2
powershell -NoProfile -ExecutionPolicy Bypass -File tools/unity-parity/check-unity-compile.ps1 -Skip Editor,Tests
```

- Builds `CheckCore` (`Sim` + `Build` + `Persistence`, catching accidental
  `UnityEngine` references), `CheckUnity` (`View` + `App` + `Scripts`),
  `CheckEditor` (`Editor`), and `CheckTests` (`Tests/EditMode`) inside
  `unity/Temp/acheck<OutSuffix>`.
- Supports `-Skip <Core|Unity|Editor|Tests>`, `-ExcludeFiles <relpaths>`, and
  `-OutSuffix <tag>` so parallel tasks do not collide on `bin/`/`obj/`.
- Drops the duplicate `Unity.Plastic.Newtonsoft.Json` reference from
  `collab-proxy` so `Newtonsoft.Json` types match across assemblies.

## 2. Live Unity Editor workflow (`metro-editor.ps1`)

Talks only to an already-open Unity `6000.6.8f1` Editor on `unity/` via the
`unity` CLI (`com.unity.pipeline`), serialized on named mutex
`Local\MetroUnityEditorWorkflow`. Writes `run.json`, CLI logs, and `1280 × 720`
captures under `.preview/unity/editor/<run-id>/`:

```powershell
./unity/scripts/metro-editor.ps1 status
./unity/scripts/metro-editor.ps1 compile
./unity/scripts/metro-editor.ps1 test -Mode EditMode -TestFilter StationVisibilityTests
./unity/scripts/metro-editor.ps1 test -Mode PlayMode -TestFilter StationExplodedViewPlayTests
./unity/scripts/metro-editor.ps1 smoke -Demo zoo -NoRepeat
./unity/scripts/metro-editor.ps1 smoke -Demo zoo -Ticks 30 -StopAfter
./unity/scripts/metro-editor.ps1 verify -TestFilter StationScenePickerTests -Demo zoo
```

- **Parameters:** `status | compile | test | smoke | verify`, `-ProjectPath`,
  `-OutputDirectory` (must stay under `.preview/unity/`), `-Mode EditMode|PlayMode`,
  `-TestFilter <single fixture or method substring>`, `-Demo zoo|tanwei|tianhe`,
  `-Scene StationGameLocal`, `-Ticks <n>`, `-TimeoutSeconds`, `-LockTimeoutSeconds`,
  `-StopAfter`, `-NoRepeat`, `-Force`.
- **`compile` and `test` stop Play Mode first** (avoids `EditorSceneManager.NewScene`
  throws). Pass a single fixture or method substring to `-TestFilter` (not `|`
  regexes); unfiltered full EditMode runs exceed `unity test run --mode editor`'s
  synchronous RPC timeout and belong in `metro-unity.ps1 test`.
- **`smoke`** verifies demo provenance hashes, opens `StationGameLocal.unity`,
  starts Play Mode (`--run-in-background true`), runs `metro station_smoke`,
  captures `1280 × 720` PNGs, restores state via `metro station_smoke_finish`,
  and repeats once (unless `-NoRepeat`) to confirm identical deterministic state
  hashes. Play Mode stays running unless `-StopAfter` is passed.
- **Pipeline recovery:** If `status` reports `STATUS_NO_INSTANCES`, open `unity/`
  in Unity `6000.6.8f1`. Never delete `Library/PackageCache/com.unity.pipeline@*`
  (it is CLI-installed, not registry-fetched; deleting it causes `CS0246` on
  `CliArgAttribute` and `STATUS_PIPELINE_LOAD_PENDING`). Repair with
  `unity pipeline install --project-path unity --force`.

### Live Editor `metro` CLI commands

Invoke directly against the open Editor via:

```powershell
unity --no-banner --no-pager --format json command --project-path "$PWD/unity" --timeout 60 metro <subcommand> [args...]
```

| Subcommand | Owner (`Editor/`) | Purpose |
| --- | --- | --- |
| `station_smoke`, `station_smoke_finish` | `StationGameSmoke.cs` | Load demo, tick deterministically, pause for capture, and restore state |
| `station_storey_probe`, `station_storey_probe_finish` | `StationStoreyVisibilityProbe.cs` | Apply storey/view settings and inspect live actor/train/vehicle visibility |
| `station_binding_report`, `station_family_view` | `StationBindingReportCommand.cs` | Export per-module binding report or frame one module family |
| `station_local_scene`, `station_local_web_scene` | `StationLocalProfile.cs` | Generate/verify local Editor or loopback WebGL passenger scenes |
| `editor_ui_{selftest,prepare,wait,capture}` | `StationEditorReactOverlay.cs` | Verify offscreen WebView2 overlay, prepare/wait Play Mode, capture framebuffer |
| `editor_ui_{exploded,statistics,sky,picker}_check` | `StationEditorReactOverlay.cs` | End-to-end live Editor WebView2 checks for exploded, stats, skybox, and picking |
| `player_benchmark_start` | `StationEditorReactOverlay.cs` | Launch `MetroStation.exe -metroBenchOut` in the interactive desktop session |
| `bake_rigid_model_lod`, `bake_train_lods`, `model_lod_inventory` | `StationMeshLodImporter.cs`, `TrainMeshLodBaker.cs` | Mesh LOD baking and inventory export (see [metro-unity-assets](../../metro-unity-assets/SKILL.md)) |

## 3. Isolated batch workflow (`metro-unity.ps1`)

Runs `-batchmode` Unity processes and **refuses any project containing
`Temp/UnityLockfile`**. Always point `-ProjectPath` at an isolated scratch copy
(`Assets`, `Packages`, `ProjectSettings`, `asset-recipes`) and `-OutputDirectory`
at a fresh folder beneath `.preview/unity/`:

```powershell
./unity/scripts/metro-unity.ps1 doctor
./unity/scripts/metro-unity.ps1 bootstrap -ProjectPath .preview/unity/<copy> -OutputDirectory .preview/unity/<out>
./unity/scripts/metro-unity.ps1 catalogue -ProjectPath .preview/unity/<copy> -OutputDirectory .preview/unity/<out>
./unity/scripts/metro-unity.ps1 test -Mode EditMode -ProjectPath .preview/unity/<copy> -OutputDirectory .preview/unity/<out>
./unity/scripts/metro-unity.ps1 test -Mode EditMode -Graphics -TestFilter StationHighlightRetentionTests -ProjectPath .preview/unity/<copy> -OutputDirectory .preview/unity/<out>
./unity/scripts/metro-unity.ps1 build-web -Configuration Release -Scene StationGameLocal -ProjectPath .preview/unity/<copy> -OutputDirectory .preview/unity/<out>
./unity/scripts/metro-unity.ps1 build-windows -Configuration Release -Scene StationGameLocal -ProjectPath .preview/unity/<copy> -OutputDirectory .preview/unity/<out>
```

- **Tasks:** `doctor`, `bootstrap`, `catalogue`, `test`, `build-web`,
  `build-windows`, `import-assets` (`-Manifest`), `pack-web`, `smoke-web`.
- **Graphics tests (`-Graphics`):** Batch runs pass `-nographics` by default.
  Pass `-Graphics` when running GPU/pixel tests such as
  `StationHighlightRetentionTests` (which ignores itself under `GraphicsDeviceType.Null`).
- **Live-Editor-only fixture:** `StationEditResolverTests` (inside
  `StationEditTransactionTests.cs`) passes under `metro-editor.ps1 test` but
  exits with code 2 in isolated `metro-unity.ps1 test`; run it against the open
  Editor.
- **EditMode teardown:** Always use `Object.DestroyImmediate` (never
  `Object.Destroy`) in EditMode test `[TearDown]`.
- **Provenance & mutable inputs:** `build-web` and `build-windows` snapshot
  SHA-256 hashes across `Assets`, `Packages`, `ProjectSettings`, and
  `unity/tests/fixtures` before and after the build, allowlisting only
  `Assets/Settings/UniversalRenderPipelineGlobalSettings.asset`. Switching
  build targets mid-build trips the provenance guard; after switching targets
  manually on a project, commit the switch with a no-op
  `-batchmode -nographics -projectPath <dir> -quit -buildTarget WebGL` run first.

## 4. WebGL, local passenger player & portable Windows `.exe`

- **WebGL packaging, preview & Cloudflare deploy** (`npm run build:unity`,
  `npm start unity`, `npm run preview:unity`, `npm run stage:unity`,
  `npm run deploy:unity`) are documented in
  [metro-unity-web](../../metro-unity-web/references/deploy-and-benchmark.md).
- **Local soft-human WebGL player (loopback only):**
  ```powershell
  ./unity/scripts/metro-local-player.ps1 -Serve -Port 8801
  ```
  Builds `Assets/StationDesigner/Scenes/StationGameLocalWeb.unity` with the
  local cohort (`passenger-catalogue-web.asset`), packs it under
  `.preview/unity/local-web/packed`, and serves on `127.0.0.1` only.
- **Portable Windows single-file `.exe` (`npm run build:unity:windows`):**
  `tools/unity-web/build-windows.mjs` rebuilds `MetroEditorWebView.exe` and
  `game/dist-unity-ui`, syncs `unity/` into `.preview/unity/win-workspace/project`
  (patching `productName: Station Designer`, resizable `1600 × 900` windowed
  `fullscreenMode: 3`, and local passengers inside the isolated workspace only),
  runs `metro-unity.ps1 build-windows` (`BuildWindows.cs` applies
  `Editor/StationDesignerIcon.png`, LZ4HC compression, and deferred
  `Resources/MetroWindowsTrains` train loading to avoid startup preload stalls),
  and packs `.preview/unity/StationDesigner.exe` (`--no-passengers` omits local
  passengers; stop running `StationDesigner`/`MetroStation`/`MetroEditorWebView`
  processes before rebuilding).
  - Runtime CLI flags: `-benchmark`, `--en`, `-metroRoute <path>`.
  - Hardware edit/playback benchmark: launch `MetroStation.exe -metroBenchOut <json>`
    (`StationPlayerBenchmark.cs`, optional `-metroBenchDemos` / `-metroBenchModelDetail`)
    from the open Editor's interactive desktop session via
    `metro player_benchmark_start --exe <path> --out-path <json> [--model-detail true]`.

## 5. Gitignored Unity paths, `.meta` hygiene & fresh-clone setup

- **Gitignored paths (`.gitignore`):** `/unity/plan/` (never link to it from
  tracked docs), Editor/IDE caches (`Library/`, `Temp/`, `Obj/`, `Logs/`,
  `UserSettings/`, `.utmp/`, generated `*.csproj`/`*.slnx` except
  `MetroEditorWebView.csproj` and `StationDesignerLauncher.csproj`), `Build/` /
  `Builds/` (except `Runtime/Build/`), and regenerated outputs (`Demos/`,
  `Generated/{RuntimeCatalogue,TrainCatalogue}.asset`,
  `Scenes/StationGameLocalWeb*.unity`, `Generated/Passengers/passenger-catalogue*.asset`,
  `Generated/Passengers/Lods/`).
- **Fresh clone before running Unity tests directly on `unity/`:**
  ```powershell
  node tools/unity-parity/export-station-documents.mjs
  node tools/unity-assets/ensure-meta.mjs
  ```
  Then generate the scene and catalogues (`Metro/Station Game/Generate Scene`
  or `metro-unity.ps1 bootstrap`).
- **ProjectSettings & image `.meta` rules:** Edit `ProjectSettings/*.asset`
  only with the Editor closed and **without a UTF-8 BOM** (avoid PowerShell 5.1
  `Set-Content -Encoding UTF8`). Every image under `Assets/` must carry a full
  2D `TextureImporter` `.meta` block (run `node tools/unity-assets/ensure-meta.mjs`,
  enforced by `unity/tests/asset-meta.test.mjs`).
