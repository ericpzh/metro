# Packaging, Cloudflare Deploy, Benchmark & Contract Tests

Reference for `tools/unity-web/`, `tools/unity-windows-bundle/`, `unity/wrangler.jsonc`,
`/game/unity/benchmark`, and `unity/tests/*.test.mjs`.

## Tooling map (`tools/unity-web/` & `tools/unity-windows-bundle/`)

| Path | Responsibility |
| --- | --- |
| `tools/unity-web/start-unity.mjs` | Orchestrates `npm run build:unity` (`--build-only`) and `npm run start:unity` / `npm start unity`. Syncs `unity/` into `.preview/unity/dev-workspace/project`, verifies SHA-256 input/fixture/output provenance, reuses or builds WebGL, packs React UI, writes `.preview/unity/station-game-local.jsonc`, and serves via `static-pack-server.mjs`. Flags: `--build-only`, `--rebuild`, `--bootstrap`, `--port <n>` (`8787`), `--ip <addr>` (`127.0.0.1`), `--scene StationGameLocal`, `--configuration Release\|Development`. |
| `tools/unity-web/pack.mjs` | Verifies raw WebGL build `.report.json` + `.provenance.json` (fonts, fixtures, file digests), builds React UI via `unity-ui-pack.mjs` for `/StationGame[^/]*\.unity$/`, rewrites HTML asset bases to `/game/_unity/...`, splits `>= 25 MiB` `.wasm`/`.data` files into `20 MiB` `.partN` chunks, and writes `manifest.json`. |
| `tools/unity-web/unity-ui-pack.mjs` | Runs `vite build --config vite.unity-ui.config.ts`, bundles `game/dist-unity-ui` plus `game/public/{module-thumbnails,audio}` under `UI/`, and injects `#game-loading`, `__metroUnityProgress`/`__metroUnityFail`, `window.metroUnityUiBase`, `window.metroUnityAudioBase`, and `mountUnityUI` bootstrap into `index.html`. |
| `tools/unity-web/stage-deploy.mjs` | Validates a public `StationGameLocal.unity` pack (`validatePublicPack`, `< 25 MiB` per file), Brotli-compresses split `.wasm`/`.data` bundles (quality 5) into `<= 20 MiB` `.brpartN` chunks, updates `manifest.json` `splitFiles` (`encoding: "br"`), and atomically stages `unity/dist-web/`. |
| `tools/unity-web/local-worker.mjs` | Production Cloudflare Worker (`unity/wrangler.jsonc`) and local Wrangler Worker: canonical redirects, HTML `lang` + `ASSET_PREFIX` rewriting, and zero-copy split-asset streaming. |
| `tools/unity-web/serve-latest-pack.mjs` / `static-pack-server.mjs` | Plain Node HTTP server (`npm run preview:unity`, default port `8799`, `--pack <dir> --port <n> --ip <addr>`) mirroring `local-worker.mjs` routing and split-file reassembly across `/game/` and `/game/unity/` without `workerd`. |
| `tools/unity-web/pack-release.mjs`, `release-worker.mjs`, `release-contract.mjs`, `route-contract.mjs` | Content-addressed immutable release pipeline (`/_unity/<releaseId>/...`, `releaseId = <sourceSha>-<artifactSha256[0..16]>`, `schemaVersion: 1` manifest, `Cache-Control: public, max-age=31536000, immutable`, `window.metroLaunch`). |
| `tools/unity-web/build-windows.mjs` / `pack-windows-exe.mjs` / `pack-windows-msix.mjs` | Isolated `StandaloneWindows64` builder (`--configuration Release\|Development`, `--out <dir>`, `--no-passengers`, `--no-bundle`, `--msix [--version <v>] [--identity <json>] [--dev-sign]`), single-file `.exe` packager (`.preview/unity/StationDesigner.exe`), and Microsoft Store `.msix` packager (`msix-identity.example.json`, `.preview/unity/StationDesigner-<version>-x64.msix`). |
| `tools/unity-windows-bundle/` | Self-contained `net10.0-windows` single-file launcher (`StationDesignerLauncher.csproj`, `Program.cs`, `StationDesigner.ico`) that verifies/extracts the appended `METRO_BUNDLE_V1` zip payload and launches `MetroStation.exe`. |
| `tools/unity-web/verify-station-game.mjs` | Headless Chrome verifier driving `window.__metroStationBridge` against a packed `StationGameLocal` build (`--packed <dir> --demo zoo\|tanwei\|tianhe\|all --locale both\|zh\|en --only case[,case] --timeout-ms <n> --load-probe`; set `METRO_STATIC_SERVER=1` to bypass `workerd`). |
| `tools/unity-web/smoke.mjs`, `smoke-release.mjs`, `smoke-first-playable.mjs`, `smoke-zoo-playable.mjs` | Headless Chrome smoke runners for raw local packs, immutable release artifacts, and legacy slice scenes. |

## Isolated WebGL build & public vs loopback passenger rules

- **Provenance & workspace isolation:** `start-unity.mjs` checks Node against
  `unity/scripts/node-version.txt`, snapshots `Assets/`, `Packages/`, `ProjectSettings/`,
  `asset-recipes/`, `game/src/data/`, `tools/unity-parity/`, and `unity/tests/fixtures/`, and
  builds inside `.preview/unity/dev-workspace/project` (safe while the live Unity Editor is
  open on `unity/`). `Assets/Settings/UniversalRenderPipelineGlobalSettings.asset` is
  allowlisted in `MUTABLE_BUILD_INPUTS` because WebGL shader stripping updates it during
  builds.
- **WebGL memory ceiling:** `unity/ProjectSettings/ProjectSettings.asset` pins
  `runInBackground: 1`, `webGLInitialMemorySize: 1024`, `webGLMaximumMemorySize: 4096`,
  `webGLMemoryGrowthMode: 2`, `webGLThreadsSupport: 0`, and `webWasm2023: 1`. Never raise
  `webGLMaximumMemorySize` above `4096` (exceeding 4 GiB enables Emscripten memory64/`BigInt`
  glue that fails in `createUnityInstance`).
- **Loopback-only soft-human WebGL profile:**
  - When `start-unity.mjs` runs on loopback (`127.0.0.1`, `localhost`, `::1`) without an
    explicit `--scene` flag and
    `unity/Assets/StationDesigner/Generated/Passengers/passenger-library.manifest.json` exists
    locally, it invokes `Metro.Editor.StationLocalProfile.PrepareLocalWebBuild` inside the
    isolated workspace and builds `StationGameLocalWeb.unity` (15-recipe local cohort).
  - Passing `--scene StationGameLocal` (or a non-loopback `--ip`) removes
    `Generated/Passengers/` and `StationGameLocalWeb.unity` from the isolated workspace to
    produce a clean zero-actor public pack.
  - `./unity/scripts/metro-local-player.ps1 [-ProjectPath ...] [-OutputDirectory ...] [-Configuration Release|Development] [-SkipBuild] [-Serve] [-Port 8801]`
    builds and serves `StationGameLocalWeb.unity` strictly under `.preview/unity/` on
    `127.0.0.1`.
  - **Public deploy gate:** `stage-deploy.mjs` (`validatePublicPack`) refuses any pack whose
    `provenance.json` `Scene` is not `Assets/StationDesigner/Scenes/StationGameLocal.unity`.

## Cloudflare Worker deployment (`unity/wrangler.jsonc` & `local-worker.mjs`)

- **Worker binding (`unity/wrangler.jsonc`):**
  - Worker name: `metro-unity`; entry: `../tools/unity-web/local-worker.mjs`.
  - Routes: `stationdesigner.com/game/unity` and `stationdesigner.com/game/unity/*` (more
    specific than `metro-game`'s `stationdesigner.com/game/*`, keeping the Three.js game
    untouched).
  - Static assets: `directory: "./dist-web"` (gitignored, populated by `npm run stage:unity`),
    `binding: "ASSETS"`, `run_worker_first: true`, `vars: { "ASSET_PREFIX": "/game/unity" }`.
- **Canonical redirects (308):**
  - `/` → `${prefix}/`, `/en[/]` → `${prefix}/en/`, `/benchmark[/]` → `${prefix}/benchmark`,
    `/benchmark/en[/]` → `${prefix}/benchmark/en`.
  - `${prefix}` or `${prefix}/index.html` → `${prefix}/`; `${prefix}/en` or
    `${prefix}/en/index.html` → `${prefix}/en/`.
  - Strips trailing slashes on demo and benchmark leaf routes (`/game/unity/zoo/` →
    `/game/unity/zoo`, `/game/unity/benchmark/en/` → `/game/unity/benchmark/en`).
- **Asset & Brotli split streaming (`/_unity/*`):**
  - Serves direct files from `env.ASSETS` first; on 404, checks `/manifest.json`
    `splitFiles[relPath]`.
  - Streams `.partN` or Brotli `.brpartN` parts sequentially through
    `FixedLengthStream(split.bytes)` (with a back-pressured `ReadableStream` fallback) using
    `encodeBody: 'manual'`, `content-type` (`application/wasm` for `.wasm`, else
    `application/octet-stream`), `content-encoding: br | gzip | identity`,
    `vary: Accept-Encoding` (when compressed), and `content-length: split.bytes`.
- **HTML rewriting:** Fetches `/`, injects `<html lang="en">` for `/en/...` and
  `/benchmark/en` (otherwise `zh-CN`), rewrites `/game/_unity` to `${ASSET_PREFIX}/_unity`
  when `ASSET_PREFIX !== '/game'`, and returns `cache-control: no-cache` on `/game/unity`
  (`no-store` on `/game`).

## Portable single-file Windows `.exe` (`npm run build:unity:windows`)

1. `build-windows.mjs` builds `MetroEditorWebView.exe` and `game/dist-unity-ui/`, syncs
   `unity/` into `.preview/unity/win-workspace/project`, patches
   `productName: Station Designer` and resizable `1600 × 900` windowed mode
   (`fullscreenMode: 3`) inside the isolated copy, pre-normalizes
   `UnityConnectSettings.asset`, prepares `StationGameLocalWeb.unity` unless
   `--no-passengers` is passed, and runs `metro-unity.ps1 build-windows`
   (`Metro.Editor.BuildWindows.Run` with LZ4HC compression, deferred train staging, and
   `StationEditorReactOverlay`'s `StreamingAssets/MetroUi/` postprocessor).
2. `pack-windows-exe.mjs` publishes a self-contained `win-x64` `MetroEditorWebView.exe` and
   the trimmed single-file `StationDesignerLauncher.csproj` stub, zips the staged player tree
   (excluding `*_BackUpThisFolder_ButDontShipItWithYourGame`), concatenates
   `[launcher stub] + [payload.zip] + [56-byte METRO_BUNDLE_V1 footer]` into
   `.preview/unity/StationDesigner.exe`, applies `icacls /setintegritylevel Medium`, and
   verifies the bundle via `--bundle-verify` (falling back to
   `dotnet StationDesigner.dll --bundle-verify --bundle-file` on non-interactive `0xC0000142`
   shells).
3. At runtime, `StationDesigner.exe` extracts once (serialized by named mutex
   `Local\MetroStationDesignerExtract_<bundleId>`) into the first writable cache root
   (`METRO_BUNDLE_CACHE_DIR` → `%TEMP%\StationDesigner\runtime` →
   `%LOCALAPPDATA%\StationDesigner\runtime` → `<exeDir>\.station-designer-runtime`), checks
   for Microsoft Edge WebView2 Evergreen Runtime, and launches `MetroStation.exe` (defaulting
   to `-screen-fullscreen 0 -screen-width 1600 -screen-height 900`). Supported CLI flags:
   `-benchmark`, `--en` / `-en` / `-lang en`, `-metroRoute <path>`, `--bundle-verify`,
   `--bundle-extract-only`.

## Microsoft Store MSIX (`npm run build:unity:msix`)

1. `npm run build:unity:msix` invokes `build-windows.mjs --msix`, which enforces `--no-passengers`
   (stripping `Generated/Passengers/` and `StationGameLocalWeb.unity` from the isolated
   `.preview/unity/win-workspace/project` copy so only the public `StationGameLocal.unity` scene
   is built) and skips the portable SFX wrapper (`--no-bundle`).
2. `pack-windows-msix.mjs` resolves `makeappx.exe`, `makepri.exe`, and `signtool.exe` from the
   Windows SDK (`C:\Program Files (x86)\Windows Kits\10\bin`) or auto-restores
   `Microsoft.Windows.SDK.BuildTools` into the NuGet cache via `dotnet restore` (no admin needed),
   publishes self-contained `win-x64` `MetroEditorWebView.exe`, strips `.pdb`/`.xml`, and gates
   the staged tree with `node unity/tests/passenger-profile.test.mjs --pack <stageDir>`.
3. Partner Center identity (`name`, `publisher`, `publisherDisplayName`, `version`) is kept out
   of Git in `.preview/unity/msix-identity.local.json` (template:
   `tools/unity-web/msix-identity.example.json`; overridable via `--identity`, `--version`, or
   `METRO_MSIX_*` env vars).
4. Tile PNGs (`StoreLogo`, `Square44x44Logo` plated & unplated `targetsize-16..256`,
   `Square150x150Logo`, `Wide310x150Logo`, `Square310x310Logo` across scales `100`/`200`/`400`)
   are resampled from `design/icon/station-designer-blue-bold.png`, indexed into a single unified
   `resources.pri` (`<packaging>` auto-split removed so no stray `resources.scale-*.pri` files
   enter the single `.msix`), paired with an `x64` `Windows.FullTrustApplication` (`runFullTrust`)
   `AppxManifest.xml`, and packed into unsigned `.preview/unity/StationDesigner-<version>-x64.msix`
   (and `.preview/unity/StationDesigner.msix`) for Microsoft Store upload (the Store re-signs it
   automatically). Pass `--dev-sign` to also produce a locally self-signed `.dev-signed.msix` +
   `.preview/unity/win-workspace/msix-dev-cert/dev-sign.cer` for local sideload testing.

## Interactive Benchmark Route (`/game/unity/benchmark`)

- **Entry points:** Direct URL `/game/unity/benchmark` or `/game/unity/benchmark/en`,
  Settings menu `<PiSpeedometerBold />` button (`SettingsMenu.tsx` → `benchmarkHrefFor` on
  web; `StationHost.openBenchmark` in-place on desktop/Editor), or Windows CLI
  `StationDesigner.exe -benchmark [--en]`.
- **Locale & tutorial isolation:**
  - `initialLanguageForRoute` (`game/src/app/languageRoute.ts`) returns
    `{ language: routeLanguage, storageKey: null }` on benchmark paths so saved game language
    prefs never override `/benchmark` vs `/benchmark/en`, and the in-page locale toggle updates
    the URL via `history.replaceState` without mutating game storage.
  - `unity-ui-pack.mjs` and `Program.cs` hide `#game-loading` immediately on benchmark routes.
  - `UnityBenchmarkRoute.tsx` sets `document.body.dataset.metroBenchmarkActive = 'true'`,
    dispatches `metro:benchmark-mode`, and sends `benchmark.mode { active: true }` so
    `Tutorial.tsx` never opens and desktop autosave pauses.
- **Presets, graphics & measurement:**
  - Selectors: pure-DOM station toggle buttons (`benchmarkChoices benchmarkStations`,
    `data-station="zoo|tanwei|tianhe"`, avoiding native `<select>` popups invisible to offscreen
    WebView2 capture), 3-tier model detail (`low`, `balanced`, `high`), 5 FSR 1.0 upscaling
    presets (`ultra` `1/1.3`, `quality` `1/1.5`, `balanced` `1/1.7`, `performance` `0.5`,
    `native` `1.0`), and view (`regular` | `explode` | `tour`, where `tour` runs
    `game/src/app/benchmark/benchmarkCameraTour.ts` — opens at `2/3` overview, zooms way in to
    `13.5 m` full-LOD0 distance, and stays within `13.2–14.2 m` across framerate-invariant
    station-specific world pans, orbits, and `Q`/`E` ±5 m storey transitions + `frame()` +
    per-storey hotspot recentering via `view.set level`, `camera.orbit`, `camera.pan`, and
    `camera.zoom`, initialized from live `camera.zoom` ack / `state.camera` pose and plotting
    teal Q/E floor-switch markers on both the FPS and `FrameTimeChart` graphs).
  - Before opening the station, `UnityBenchmarkRoute.tsx` snapshots saved `PlayerPrefs` via
    `graphics.get`, applies the chosen profile + upscaling via `graphics.set` (`urp-fsr1` on
    `graphicsShaderLevel >= 45`; `webgl-fsr1` two-pass EASU + RCAS
    `Resources/StationFsr1.shader` on WebGL 2), and restores saved `PlayerPrefs` in `finally`.
  - During `preparing` and `running`, all pointer/wheel/key events are capture-blocked
    (`data-metro-benchmark-locked="true"`). The 30 s `16×` run invokes `benchmark.start` /
    `benchmark.stop` (`StationBenchmarkRecorder.cs` collects native `Time.unscaledDeltaTime`,
    ticks, `ProfilerRecorder("Total Used Memory")`, and `SystemInfo` hardware on
    desktop/Editor; WebGL uses `requestAnimationFrame`, `performance.memory`, and WebGL
    renderer info) and renders three time-series charts: FPS (scaled ceiling via
    `fpsCeilingFor`), shared frame generation time in ms (`FrameTimeChart` in
    `game/src/app/benchmark/FrameTimeChart.tsx`, also used by Web Three.js
    `BenchmarkRoute.tsx`, with `frameTimeCeilingFor`/`frameTimePath`, 60 FPS / 16.7 ms
    and 30 FPS / 33.3 ms guides, and train-arrival markers), and system resource usage.

## Node contract test suite (`unity/tests/*.test.mjs`)

Run with `npm run test:unity` (no Unity Editor required):

- **Bridge, UI shell & input:** `station-bridge.test.mjs`, `shared-web-ui.test.mjs`,
  `webgl-autosave.test.mjs`, `camera-cadence.test.mjs`, `pointer-input.test.mjs`,
  `pointer-measure.test.mjs`, `ui-pointer-drag.test.mjs`, `keyboard-navigation.test.mjs`,
  `tool-adapter.test.mjs`, `edit-notices.test.mjs`, `simulation-playback.test.mjs`,
  `station-statistics-adapter.test.mjs`, `exploded-view.test.mjs`.
- **Desktop/Editor WebView2 host:** `editor-react-overlay.test.mjs` (verifies
  `StationDesktopUiPresenter`, `StationEditorReactOverlay`, `MetroEditorWebView`
  build/self-test, single-canvas & single-shell invariants).
- **Artwork providers:** `exit-face.test.mjs`, `calligraphy-face.test.mjs`.
- **Packaging, Workers, benchmark & safety guards:** `unity-preview-pipeline.test.mjs`,
  `unity-benchmark.test.mjs`, `web-release-contract.test.mjs`, `web-release-worker.test.mjs`,
  `windows-msix.test.mjs`, `smoke-negative.test.mjs`, `passenger-profile.test.mjs` (also supports
  `node unity/tests/passenger-profile.test.mjs --pack <pack-dir>`).
- **Runtime/asset structure guards:** `runtime-layering.test.mjs`, `asset-meta.test.mjs`,
  `edge-placement.test.mjs`, `renderer-audit.test.mjs`, `runtime-model-inventory.test.mjs`,
  `runtime-views.test.mjs`.
