---
name: metro-unity-web
description: Work on the Unity shared React 19 UI shell (game/src/unity-web/), Bridge v2 protocol, WebGL and WebView2 desktop/Editor transports, WebGL/Windows packaging, Cloudflare /game/unity and benchmark deploy, and Node contract tests (unity/tests/). Use for stationBridge, MetroEditorWebView, UnityBenchmarkRoute, or Worker changes.
---

# Unity Web Shell, Bridge v2 & Deployment (`metro-unity-web`)

This skill covers the browser and desktop presentation layer around the Unity 6 URP runtime:
the shared React 19 UI shell in `game/src/unity-web/`, the Bridge v2 command/reply protocol,
the dual WebGL and Windows/Editor WebView2 transports, WebGL/Windows packaging, Cloudflare
Worker deployment for `/game/unity/*` and `/game/unity/benchmark`, and the Node contract
suite in `unity/tests/`.

## References and sibling skills

- [Bridge v2, Dual Transport & UI Shell](references/bridge-v2.md) — `game/src/unity-web/`
  module map, Bridge v2 envelopes & delta adoption, `StationDesktopUiPresenter`,
  `StationEditorReactOverlay`, `MetroEditorWebView.exe`, out-of-band artwork providers,
  exploded view, statistics paging, audio, and `#game-loading` handoff.
- [Packaging, Deploy, Benchmark & Tests](references/deploy-and-benchmark.md) —
  `tools/unity-web/` script map, `unity/wrangler.jsonc` & Brotli split-stream serving,
  `/game/unity/benchmark` route & graphics controls, portable Windows `.exe` bundler
  (`tools/unity-windows-bundle/`), loopback passenger profile rules, and
  `unity/tests/*.test.mjs`.
- Sibling skills:
  - [metro-unity](../metro-unity/SKILL.md) — Unity C# sim/build/persistence/view/app/editor
    runtime, `metro-editor.ps1`, `metro-unity.ps1`, and Unity EditMode/PlayMode tests.
  - [metro-unity-assets](../metro-unity-assets/SKILL.md) — GLB conversion, finishes,
    passenger profiles, and Mesh LOD asset pipeline.
  - [metro-game](../metro-game/SKILL.md) — shared React 19 UI (`game/src/app/`), store
    slices, audio players, and TypeScript game contracts.
  - [metro-repo](../metro-repo/SKILL.md) — repo layout, root scripts, and the shared
    [performance reference](../metro-repo/references/performance.md).

## Architecture overview

The Unity runtime (`StationGameHost` on GameObject `StationGame`) is the sole authority for
the committed station document, revision, camera, simulation clock, statistics history,
exploded viewer, and edit session. The shared React 19 UI (`game/src/unity-web/main.tsx`)
mounts over the Unity canvas using two transports that speak the same Bridge v2 JSON protocol:

| Transport | Hosts | JS → C# path | C# → JS path |
| --- | --- | --- | --- |
| **WebGL browser** | Packed player at `/game/unity/` or local preview | `SendMessage("StationGame", "BrowserCommand", json)` | `StationGame.jslib` (`StationGameState`, `*Chunk`, `*Flush`) → `CustomEvent('metro:station-state')` |
| **Desktop / Editor WebView2** | Editor Play Mode & `StandaloneWindows64` `.exe` | `chrome.webview.postMessage` → TCP `{ kind: "cmd" }` → `StationDesktopUiPresenter` → `BrowserCommand` | `ReplyPublished` → TCP `{ kind: "bridge" }` → `PostWebMessageAsString` → `CustomEvent('metro:station-state')` |

In desktop and Editor mode (`UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN`),
`MetroEditorWebView.exe` (`tools/unity-editor-ui/`, `net10.0-windows`) runs completely
offscreen on a `1×1` click-through `HWND_BOTTOM` anchor (never `HWND_TOPMOST`). It captures
`CoreWebView2CompositionController` frames via `Windows.Graphics.Capture` into a
double-buffered `MUI2` shared-memory BGRA32 buffer (waiting for `navigationStarted` and at
least one non-transparent pixel before publishing the first frame), which
`StationDesktopUiPresenter` uploads onto an in-canvas `ScreenSpaceOverlay` `RawImage`
(`StationDesktopUiCanvas`, `sortingOrder = 32000`) while forwarding Unity `InputSystem`
pointer/wheel/keyboard events to CDP. Because Chromium renders native `<select>` popups in a
separate top-level OS HWND invisible to offscreen visual capture, interactive selectors in
overlay/benchmark UI must use pure-DOM controls (e.g., button toggle groups) rather than
native `<select>`.

## Commands

Run from the repository root (Node version pinned in `unity/scripts/node-version.txt`):

```powershell
# 1. Node contract, transport, benchmark & packaging tests
npm run test:unity

# 2. Typecheck game/ and build the standalone Unity React UI bundle (game/dist-unity-ui/)
npm --prefix game run typecheck
npm --prefix game run build:unity-ui

# 3. Isolated WebGL build, local preview & headless browser verification
npm run build:unity                              # isolated WebGL build/reuse (auto local passengers on loopback) + UI pack
npm run build:unity -- --scene StationGameLocal  # clean zero-actor public pack
npm run start:unity                              # (alias: npm start unity) build/reuse + serve http://127.0.0.1:8787/game/ & /game/en/
npm start unity -- --rebuild                     # force isolated bootstrap + Release WebGL rebuild
npm run preview:unity                            # serve latest pack on http://127.0.0.1:8799/game/ & /game/unity/ (no workerd)
node tools/unity-web/verify-station-game.mjs .preview/unity/verify-run --packed <pack-dir> --demo zoo --locale both

# 4. Cloudflare staging & deploy (stationdesigner.com/game/unity/*)
npm run stage:unity                              # validate StationGameLocal pack, Brotli-compress split bundles into unity/dist-web/
npm run deploy:unity                             # build public StationGameLocal + stage unity/dist-web/ + wrangler deploy -c unity/wrangler.jsonc

# 5. Local-only soft-human WebGL packager (loopback 127.0.0.1 only; never upload publicly)
./unity/scripts/metro-local-player.ps1 -Serve -Port 8801

# 6. Portable single-file Windows standalone executable (.preview/unity/StationDesigner.exe)
npm run build:unity:windows
```

## Load-bearing contracts

### 1. Bridge v2, correlation & single-layer invariants

- **Envelope, FIFO load queue & adoption gating:** Every JS → C# command uses
  `{ schemaVersion: 2, id: "c-<n>", sessionId, expectedRevision?, type, payload }`.
  `stationBridge.register` mints a fresh `sessionId` and drains queued startup commands;
  replies from stale sessions are dropped. Station loads (`station.open`, `station.openDemo`,
  `station.new`, `station.resync`) drain strictly FIFO with at most one active load; dependent
  document edits (`edit.*`, `face.*`, `road.*`, `sign.*`) retain their target load ID,
  wait until the shell signals matching `(commandId, sessionId, stationEpoch, revision)`
  adoption via `stationBridge.noteAdopted` (or cancel only that load's dependents on
  `noteAdoptionFailed`/reject), and bind intent + revision guard right before `SendMessage`
  via `beforeSend`/`beforeDispatch`/`onCancel` hooks while preserving caller `expectedRevision`
  verbatim on edits authored against an already loaded document.
- **Commits vs deltas:** `commit` replies carry full v1 `document` JSON on open, new, and
  resync, and a versioned `delta` (`schemaVersion: 1`) on sequential local edits and
  undo/redo carrying verbatim host raw JSON (`changedCellsJson`, `changedModulesJson`,
  `linesJson`) and target indices (`changedCellIndices`, `changedModuleIndices`, omitting
  duplicate parsed record bodies). `stationBridge` parses records for `stationDelta.ts`
  (`applyStationDelta`) while preserving raw strings/indices for lossless `webglAutosave.ts`
  folding and final-sequence position validation. Any `baseRevision` gap or invalid delta
  triggers an automatic `station.resync`; file export calls
  `stationBridge.readCommittedDocument()` (`station.save { includeDocument: true }` on demand).
- **Correlated `request` & side channels:** `stationBridge.request<TPayload>` matches
  non-commit `ack`/`reject` replies by `id` (cancelling cleanly on session change or timeout
  without touching `snapshot.revision`) for `stats.history`, `graphics.get`/`graphics.set`,
  `benchmark.*`, `station.save`, and `edit.cancel`. High-frequency `kind: "camera"` poses and
  `kind: "audio"` cues/ambience bypass the snapshot reducer entirely.
- **One React tree & one overlay canvas:** `mountUnityUI` tears down any prior `activeShell`
  before mounting; `StationDesktopUiPresenter` owns the single `StationDesktopUiCanvas`
  (`DestroyOtherCanvases`, `OverlayCanvasCount()`).

### 2. Dual-transport publishing, artwork recapture & `#game-loading`

- **Dual-transport outbound publishing:** Host-initiated browser-canvas artwork requests
  (`signRequest`, `psdHeaderRequest`, `exitFaceRequest`, `calligraphyRequest`,
  `trainMarkRequest`) must publish via `StationGameHost.PublishOutbound` — never WebGL-only
  `StationWebBridge.Publish` — so both WebGL and WebView2 receive them. `main.tsx` intercepts
  all five streams before `stationBridge.receive` so PNG chunks never enter the state reducer.
- **Authoritative history, line selection, carried moves, theme sync, WebGL autosave & WebView2 links:**
  `StationGameHost` publishes `canUndo`, `canRedo`, and monotonic `stationEpoch` (cleared
  unconditionally on non-edit station loads) so `TopBar.tsx` undo/redo buttons stay
  authoritative; `lineSelection.ts` activates host-created lines (`reserveAdd`/`bindAdd`/`trackAdd`)
  and reconciles fallback selection on removal/undo/replacement; `carriedMoveAdapter.ts`
  surfaces carried-move targets and localized refusal reasons to `InfoCard.tsx`; `main.tsx`
  syncs `view.set { key: "theme" }` into `StationSkySystem`, runs lossless raw-JSON coalesced
  WebGL autosave (`webglAutosave.ts`, validating final record positions and disabling itself on
  desktop overlay and `/benchmark`), and `MetroEditorWebView` forwards only allowlisted
  `/stats/report` & `/stats/en/report` popups (`NewWindowRequested`) to the system browser.
- **Artwork recapture:** Whenever runtime code binds or swaps textures/materials after world
  registration (signs, PSD headers, street exits, calligraphy, billboards, TVs, line maps,
  digital clocks, road signals), it must call `world.RecaptureArtwork(renderer)`
  (`StationVisibilityTarget.Recapture` → `SyncDerived`) so ghosted and cleared storeys display
  live artwork.
- **UI bundle stubs & `#game-loading`:** `game/vite.unity-ui.config.ts` (`unityHostStubs`,
  `cssCodeSplit: false`) excludes Three.js viewport/scene/exploded code and large station JSONs
  from `dist-unity-ui`. `unity-ui-pack.mjs` injects the themed bilingual `#game-loading`
  screen (determinate 0–90% WebGL download bar, hidden immediately on `/benchmark[/en]`).
  `main.tsx` waits two animation frames before synchronous `SendMessage` on
  `openDemo`/`openSave` so `#game-loading` paints before WebGL blocks, and dismisses it on
  commit or load rejection.
- **WebGL heap & `.jslib` rules:** `unity/ProjectSettings/ProjectSettings.asset` pins
  `webGLInitialMemorySize: 1024`, `webGLMaximumMemorySize: 4096`, `webGLMemoryGrowthMode: 2`,
  `webGLThreadsSupport: 0`, and `webWasm2023: 1` (never exceed `4096 MiB` to avoid Emscripten
  memory64/`BigInt` failures in `createUnityInstance`). Every function in
  `Plugins/WebGL/*.jslib` must declare `<fn>__sig` with `'p'` on pointer parameters.

### 3. Routes, benchmark, graphics & public-pack separation

- **Cloudflare Worker (`unity/wrangler.jsonc`):** `metro-unity` claims
  `stationdesigner.com/game/unity` and `/game/unity/*` via `tools/unity-web/local-worker.mjs`
  (`ASSET_PREFIX: "/game/unity"`, `run_worker_first: true`), rewrites `/game/_unity` HTML
  paths, sets `<html lang="en|zh-CN">`, and streams Brotli `.brpartN` split `.wasm`/`.data`
  files zero-copy via `FixedLengthStream` (`encodeBody: 'manual'`).
- **Benchmark & graphics controls:** `/game/unity/benchmark` and `/game/unity/benchmark/en`
  mount `UnityBenchmarkRoute.tsx` (also reachable in-place on desktop via `SettingsMenu` or
  `-benchmark`). Benchmark routes stay locale-isolated from saved game preferences
  (`languageRoute.ts`), suppress `Tutorial.tsx` (`data-metro-benchmark-active` /
  `metro:benchmark-mode`), use pure-DOM station toggle buttons (`benchmarkStations`, no
  native `<select>`), expose 3-tier model detail (`low`/`balanced`/`high`), 5 FSR 1.0
  upscaling presets (`ultra`/`quality`/`balanced`/`performance`/`native`) via
  `graphics.get`/`graphics.set` (restoring `PlayerPrefs` afterward), and 3 views
  (`regular` | `explode` | LOD0 close-up `tour` via `benchmarkCameraTour.ts`), record native
  C# frames/memory/hardware on desktop via `StationBenchmarkRecorder`, and plot FPS,
  shared `FrameTimeChart` (ms), and resource usage charts.
- **Public-pack isolation:** The review-only soft-human passenger library
  (`StationGameLocalWeb.unity`) is strictly loopback-only. `stage-deploy.mjs` refuses any
  scene other than `Assets/StationDesigner/Scenes/StationGameLocal.unity`, and
  `unity/tests/passenger-profile.test.mjs` guards source files and built packs against
  internal asset leaks.

## Verification checklist

1. Run `npm run test:unity` and `npm --prefix game run typecheck` after any change in
   `game/src/unity-web/`, `tools/unity-web/`, `tools/unity-editor-ui/`, or
   `unity/wrangler.jsonc`.
2. Rebuild and verify WebGL changes with `npm run build:unity` and
   `node tools/unity-web/verify-station-game.mjs .preview/unity/verify-run --packed <pack-dir> --demo zoo --locale both`
   (use `--only <case[,case]>` to iterate; set `METRO_STATIC_SERVER=1` if `workerd` is
   unavailable).
3. Verify desktop/Editor WebView2 changes via
   `unity --no-banner --no-pager --format json command --project-path "$PWD/unity" metro editor_ui_selftest`
   (and relevant `editor_ui_*` checks in the open Editor) or `npm run build:unity:windows`.
4. Before deploying publicly, verify the public pack passes
   `node unity/tests/passenger-profile.test.mjs --pack <pack-dir>` and `npm run stage:unity`.
