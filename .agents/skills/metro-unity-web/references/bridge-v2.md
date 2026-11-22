# Bridge v2, Dual Transport & Shared React UI Shell

Reference for `game/src/unity-web/`, `game/vite.unity-ui.config.ts`, `tools/unity-editor-ui/`,
and the Unity bridge/presenter classes in `unity/Assets/StationDesigner/`.

## Module map (`game/src/unity-web/` & shared seams)

| File | Responsibility |
| --- | --- |
| `main.tsx` | Single-tree shell entry (`mountUnityUI`), registers `StationHost` + `stationHostCommit`, intercepts artwork streams before `stationBridge.receive`, mounts `UnityApp` / `UnityShellRoot` / `UnityExplodedView` / `UnityBenchmarkRoute`, wires `#game-loading`, `.metro-measure-chip`, audio, eye drag, and reject notices. Exposes `window.__metroStationBridge`. |
| `stationBridge.ts` | Bridge v2 transport (`SCHEMA_VERSION = 2`), pre-registration command queue, `sessionId` fencing, pure `reduce()`, `onCommit`, out-of-reducer `onCameraPose` & `onAudio`, correlated `request<TPayload>()` (`BridgeRequestError`, 5 s default timeout), `readCommittedDocument()`, and `resync()`. |
| `stationDelta.ts` | O(\|delta\|) in-place application of `StationCommitDelta` (`STATION_DELTA_SCHEMA_VERSION = 1`) via `WeakMap`-cached cell index (`seedStationCellIndex`, `applyStationDelta`) preserving untouched object identities. |
| `cameraAdapter.ts` | `createStationCameraPort`, `createUnityViewCubeAdapter` (rAF-coalesced `camera.orbit` & sequenced `onCameraPose`), `attachViewStateBridge` (`view.set`), and `attachCanvasCameraGestures` (middle orbit, unclaimed right pan, wheel zoom, build-button chord guard). |
| `pointerButtons.ts` | Canonical DOM mouse button (`0`/`1`/`2`) to `MouseEvent.buttons` bit (`1`/`4`/`2`) table, `MOVE_BUTTON = -1` sentinel, `holdsButton`, `hasBuildChord`. |
| `pointerInput.ts` | Canvas tool pointer stream (`pointer.down`, rAF-coalesced `pointer.move`, `pointer.up`, `pointer.rightTap`, `pointer.cancel`, `pointer.leave`), build-button chord cancel, and full-swapchain coordinate normalization under `html.metro-overlay`. |
| `pointerMeasure.ts` | Formats and positions the drag-size badge (`.metro-measure-chip`) from `state.edit.cells.measure` (`wantsMeasure`, `measureText`, `measurePosition`). |
| `keyboardNavigation.ts` | Held `WASD` (`camera.panPlanarHeld`) and `Ctrl+Q/E` (`camera.panHeld`) with `Shift` boost; clears held state on blur, tab hide, dialog block, or unmount. |
| `toolAdapter.ts` | Bidirectional sync between shared store tool/rail/paint settings and C# `tool.set` / `state.tool` (`applyingHostTool` echo guard, `rightClaimedByTool`). |
| `editNotices.ts` | Localizes `state.edit.notice` (`blocked` / `no-op` / `stale` + refusal codes) with tool-scoped overrides (`noticeText`, `noticeKey`). |
| `simulationAdapter.ts` / `playbackControls.ts` | Mirrors `state.clock` and 14 `state.simulationCapabilities` flags atomically (`receiveHostState`, reset on `sessionId` change); routes `sim.{play,speed,seek,restart}`; gates TopBar buttons via `useSimulationAvailability`. |
| `statisticsAdapter.ts` | Syncs `state.statistics` (`18`-field `Metrics` deduplicated without `tickMs`) and paginates `stats.history` (`MAX_HISTORY_PAGE_ROWS = 128`, 13-stride `Float32Array`) with `sessionId` + `runId` fencing. |
| `UnityExplodedView.tsx` / `explodedInput.ts` | Reparents `#unity-canvas` into `ExplodedViewShell` over Layer 8 `ExplodedViewerCamera`, handles `exploded.*` commands, generation-fenced open/close sync, tray drag, camera gestures, and floating floor panel clamping. |
| `UnityBenchmarkRoute.tsx` | Interactive 30 s 16× benchmark route (`/game/unity/benchmark[/en]` and in-place desktop mode), LOD/FSR selection, `benchmark.{mode,start,stop}`, FPS and resource charts. |
| `signFaceProvider.ts` / `signCommitAdapter.ts` | `signRequest` → `drawSignPanel` (`512 px/m`) → `sign.faceChunk` + `sign.faceReady`; `sign.commit` with `expectedRevision`. |
| `psdHeaderProvider.ts` | `psdHeaderRequest` → `drawPsdHeader` (`1024`/`2048 × PSD_HEADER_PIXELS`) → `psd.headerChunk` + `psd.headerReady`. |
| `exitFaceProvider.ts` | `exitFaceRequest` → `exitHeaderCanvas` / `guideFace` / `guideEnglishFace` / `guideExitLetterFace` → `exit.faceChunk` + `exit.faceReady`; pushes `exit.locale` on boot and language switches. |
| `calligraphyFaceProvider.ts` | `calligraphyRequest` → `drawCalligraphyPanel` (`sim/calligraphyFonts.ts` manifest + DOM font advance probe, UV orientation `mirrorU`/`flipV`) → `calligraphy.faceChunk` + `calligraphy.faceReady`. |
| `unityAudio.ts` | Mounts shared `gameAudio` & `gameMusic` on `stationBridge.onAudio` for edit cues (`place`, `select`, `pick`, `delete`, `move`, `refused`) and camera-relative crowd/train/traffic ambience frames. |
| `unity-ui.css` | Full-viewport layout, hides `#unity-loading-container`/`#unity-footer`, layers `.explodedViewer[data-unity-host="true"]`, hides `.app` when `html.metro-overlay body:has(.explodedViewer[open])`, styles `.metro-measure-chip`. |
| `bridge.ts` / `zooUi.tsx` | Legacy `ZooPlayable` vertical-slice bridge (`zooBridge`, `metro:zoo-state`) kept for slice verification. |

Key shared seams in `game/src/app/`: `windows/StationHost.tsx` (`StationHost` context),
`stationHostBridge.ts` (`registerStationHostCommit` for `commitSignBoards`, `commitExit`,
`undo`, `redo`, `deleteSelection`, `cancelGesture`, `confirmMove`, `rotateCarried`,
`cycleCarriedLightPosition`), `pointerDrag.ts` (`beginPointerDrag` +
`attachScrollbarDragFallback`), `ViewCubeAdapter.ts`, `windows/ExplodedViewShell.tsx`,
`windows/topbar/SettingsMenu.tsx`, `windows/tutorial/Tutorial.tsx`, and `languageRoute.ts`.

`game/vite.unity-ui.config.ts` (`unityHostStubs`, `cssCodeSplit: false`,
`assetsInlineLimit: 0`, `manifest: true`) stubs `Viewport.tsx`, `ExplodedView.tsx`,
`render/scene.ts`, `CameraSystem.ts`, and `data/{tanwei,tianhe}-station.json` at build time
so Three.js scene buffers and large station saves stay out of `game/dist-unity-ui/` while
producing one stylesheet shared by the player and benchmark route.

## Bridge v2 wire contract

### Command & reply envelopes (`StationCommandRouter.cs`, `StationGameHost.cs`)

- **JS → C# (`BrowserCommand`):**
  `{ schemaVersion: 2, id: "c-<n>", sessionId, expectedRevision?, type, payload }`.
  - Document-mutating commands carry `expectedRevision` (checked by `StationCommandRouter` →
    `revision-mismatch` on drift) or commit through `StationEditSession` with
    `documentRevision` fencing.
  - Session-scoped commands (`camera.*`, `view.*`, `exploded.*`, `stats.history`, `sim.*`,
    `tool.*`, `graphics.*`, `benchmark.*`, hover `pointer.*`, artwork chunk/ready replies)
    never increment `revision`.
- **C# → JS (`ReplyKind`):**
  `{ schemaVersion: 2, kind, id, sessionId, revision, accepted, code, payload }`:
  - `commit`: Carries `document` + `documentRevision` + `sourceId` + `sourceHash` +
    `sourceHashRevision` + `capabilities` + state on full opens/new/resync, or `delta`
    (`schemaVersion: 1`, `baseRevision`, `revision`, `removedCells`, `changedCells`,
    `removedModules`, `changedModules`, metadata) on sequential local edits and undo/redo.
  - `state`: Coalesced runtime snapshot published on `StationGameHost.stateIntervalSeconds`
    (`0.1 s` default, immediate on `sim.*`), never carrying `document` or
    `stats.history.values`. Merges `level`, `name`, `speed`, `playing`, `tool`,
    `toolGeneration`, `rightClaim`, `settingsGeneration`, `queued`, `boarded`, `clock`,
    `simulationCapabilities`, and all registered `IStationStateContributor` payloads (`camera`,
    `view`, `render`, `exploded`, `edit`, `statistics`, `displays`, `overlays`, `roads`,
    `crowd`, `sign`, `exit`, `psd`, `graphics`), with raw-JSON caching for `crowd`,
    `statistics`, and `displays`.
  - `ack`: Carries command result payload; `camera`/`view` acks also merge `payload.camera`,
    `payload.view`, and `payload.level` directly into `snapshot.state`.
  - `reject`: Records `{ id, type, code, reason? }` in `snapshot.rejects` (last 8) without
    changing `revision`. `main.tsx` dismisses `#game-loading` and shows localized notices for
    `station.*` and `sim.*` rejects, shows `payload.reason` for player-driven
    `sign.*`/`road.*`/`face.*`/`tool.*` rejects, and keeps early startup `camera.*`/`view.*`
    rejects silent.
  - `camera`: Session-fenced per-frame sequenced pose (`{ camera, sequence }`) delivered to
    `stationBridge.onCameraPose` outside the snapshot reducer so ViewCube stays at camera
    cadence without waking React subscribers.
  - `audio`: Session-fenced edit cue (`{ cue }`) or ambience frame
    (`{ position, right, sources, passengers, sampleWeight, speed }`, emitted at 10 Hz or
    30 Hz when playing `>1×`) delivered to `stationBridge.onAudio`.

### Correlated requests, WebGL chunk streaming & yielded opens

- `stationBridge.request<TPayload>(type, payload, { id?, expectedRevision?, timeoutMs = 5000 })`
  registers its pending promise before `SendMessage`, resolves or rejects on matching
  `reply.id` (`BridgeRequestError`), cancels cleanly on `session-changed`, `disconnected`, or
  `timeout`, retires timed-out IDs, and skips `reduce()` for non-commit replies so late reads
  cannot roll back `snapshot.revision`.
- **WebGL `.jslib` & chunked streaming (`StationGame.jslib`, `StationWebBridge`):** Every
  export declares `<fn>__sig` (`StationGameState__sig: 'vp'`,
  `StationGameStateChunk__sig: 'vp'`, `StationGameStateFlush__sig: 'v'`). On WebGL,
  `StationCommandRouter.TryStreamCommitEnvelope` and `TryStreamDirectReply` stream multi-MiB
  full commits, `station.resync`, and `station.save { includeDocument: true }` through a
  32 KiB `ChunkedTextWriter` into `window.__metroStateChunks` before dispatching one
  `metro:station-state` event.
- **Yielded WebGL opens:** On `UNITY_WEBGL && !UNITY_EDITOR`,
  `StationGameHost.BrowserCommand` runs `station.open` and `station.openDemo` via the
  `RunYieldedOpen` coroutine (`coordinator.OpenYielded`), queuing incoming commands in
  `queuedBrowserCommands` until the commit completes.

## Self-registration, per-world lifecycle & artwork recapture

- Features self-register via `[RuntimeInitializeOnLoadMethod]` into `StationRenderers`,
  `StationCommandHandlers`, `StationFrameSinks`, and `host.RegisterStateContributor(...)`.
  `StationGameHost` holds no per-family branches.
- `StationLoadCoordinator` stages the incoming `StationWorldView` before disposing the
  outgoing world, firing `BeforePreviousDispose` immediately before old-world teardown (used
  by `StationExplodedView` to close cleanly on station switches while staying open on rejected
  opens).
- **Four out-of-band PNG artwork streams:** Host requests (`signRequest`, `psdHeaderRequest`,
  `exitFaceRequest`, `calligraphyRequest`) must publish via `StationGameHost.PublishOutbound`
  so both WebGL and WebView2 receive them. Each provider caps batches at `32` keys, chunks PNG
  base64 at `48 KiB`, fences by `sessionId` + `revision`, gates on browser font/pictogram
  readiness (returning `pending` with `reason: "font" | "pictogram"` rather than blank
  plates), and never touches the snapshot reducer.
- **Artwork recapture:** After binding or replacing any runtime texture/material
  (`StationSignView`, `PsdHeaderArtwork`, `StationExitArtwork`,
  `StationCalligraphyArtwork`/`FaceCache`, `StationDisplayArtwork`, `StationDisplayTvArtwork`,
  `StationLineMapArtwork`, `StationClockArtwork`, `StationRoadView`), C# calls
  `world.RecaptureArtwork(renderer)` → `StationVisibilityTarget.Recapture(renderer)` →
  `StationVisibilityPalette.SyncDerived`, updating cached `Ghost`, `Clear`, and section-shader
  clones in place so non-active storeys reflect live artwork.

## Desktop & Editor WebView2 transport (`StationDesktopUiPresenter` & `tools/unity-editor-ui/`)

- **Offscreen compositing (`MetroEditorWebView.exe`, `net10.0-windows`):** Creates a `1×1`
  invisible click-through `HWND_BOTTOM` toolwindow anchor (`WS_EX_TOOLWINDOW |
  WS_EX_NOACTIVATE | WS_EX_TRANSPARENT | WS_EX_LAYERED`, never `HWND_TOPMOST`). Hosts
  `CoreWebView2CompositionController` (`DefaultBackgroundColor = Color.Transparent`,
  `Emulation.setFocusEmulationEnabled`, `Emulation.setDefaultBackgroundColorOverride`) on a
  `Windows.UI.Composition` `ContainerVisual`, capturing `DXGI_FORMAT_B8G8R8A8_UNORM` frames
  via `GraphicsCaptureItem.CreateFromVisual` + `Direct3D11CaptureFramePool.CreateFreeThreaded`.
- **Shared memory (`MUI2`, `0x4D554932`):** Premultiplied DComp pixels are unpremultiplied to
  straight sRGB BGRA32 into a lock-free double-buffered `MemoryMappedFile` (max
  `3840 × 2160`, auto `rasterScale` `0.65–2.5`). `StationDesktopUiPresenter` uploads dirty
  sequences into a `Texture2D(BGRA32)` via `LoadRawTextureData(IntPtr, int)` on a UV-flipped
  (`(0, 1, 1, -1)`) `RawImage` inside `StationDesktopUiCanvas` (`ScreenSpaceOverlay`,
  `sortingOrder = 32000`, `pixelPerfect = true`).
- **Virtual origin & overlay CSS:** Intercepts `https://app.metro.local/*`
  (`WebResourceRequested`) serving `dist-unity-ui` at `/game/_unity/UI/`,
  `public/module-thumbnails/` at `/game/_unity/UI/module-thumbnails/`, and `public/audio/` at
  `/audio/` and `/game/audio/`. Injects `<html class="metro-overlay">` with transparent
  `.stage`/`#unity-canvas`/`.explodedViewer[data-ready="true"]` and sets
  `window.__metroDesktopOverlay = true` + `window.metroUnityAudioBase = '/audio/'`.
- **Loopback TCP IPC & input forwarding:** JSON lines over `127.0.0.1` ephemeral port
  (`connected`, `ready`, `cmd`, `bridge`, `resize`, `mouse`, `key`, `navigate`,
  `capturePreview`, `previewCaptured`, `log`, `quit`).
  - Mouse button edges capture InputSystem event coordinates (`OnMouseButtonEvent`) and
    deliver final drag motion before button-up; `mouseMoved` carries the active held button
    (`HeldButtonName` / `ResolveCdpMouseButton`) so Blink preserves native scrollbars, range
    sliders, and `setPointerCapture` drags alongside `pointerDrag.ts` (`beginPointerDrag`,
    `attachScrollbarDragFallback`).
  - Keyboard forwarding polls `KeyBindings` using Windows `SystemParametersInfo` repeat
    delay/rate, releases held keys on focus loss (`OnApplicationFocus(false)`), forwards
    `Keyboard.onTextInput` (`char`/`insertText`), and exposes
    `SendSyntheticMouse`/`SendSyntheticKey` for automated checks without OS cursor hijacking.
  - `SmokeSuppressed` hides the overlay canvas and pauses input forwarding for 3D-only smokes;
    `SuppressPhysicalInput` freezes physical polling during automated benchmarks.
- **Shutdown & standalone autosave:** `StopWorker` sends `{"kind":"quit"}` and waits up to
  `1000 ms` before `Kill()` so Chromium flushes `localStorage`. Standalone Windows builds
  atomically autosave to `Application.persistentDataPath/autosave.metro.json` every 15 s
  (when revision advances) and on destroy/quit, skipping benchmark runs and restoring the
  pre-benchmark station + `station.resync` when returning from benchmark mode.
- **Editor integration (`StationEditorReactOverlay.cs`):** Overrides
  `StationDesktopUiPresenter.PathResolver` to build
  `.preview/unity/editor-ui-host/bin/MetroEditorWebView.exe` and `game/dist-unity-ui` on
  demand; stages `<Player>_Data/StreamingAssets/MetroUi/{bin,ui,public}` on
  `BuildTarget.StandaloneWindows64` (`IPostprocessBuildWithReport`); exposes
  `Metro/Station Game/*` menus and 9 `metro` Pipeline CLI commands: `editor_ui_selftest`,
  `player_benchmark_start`, `editor_ui_prepare`, `editor_ui_wait`, `editor_ui_capture`,
  `editor_ui_exploded_check`, `editor_ui_statistics_check`, `editor_ui_sky_check`, and
  `editor_ui_picker_check`.

## `#game-loading`, Exploded View & Statistics handoffs

- **`#game-loading` (`unity-ui-pack.mjs`, `main.tsx`, `Program.cs`):** Replaces Unity's
  `#unity-loading-container` with the shared `blueprint`/`site`/`studio` themed bilingual
  loader. In WebGL, `createUnityInstance` progress drives determinate bar width
  (`0..0.9 → 0..100%`) and writes `__metroUnityDownloadProgress` / `__metroUnityLoadError`. On
  `/benchmark` and `/benchmark/en`, `#game-loading` starts hidden immediately. `main.tsx`
  waits two animation frames (`80 ms` fallback timer) before `openDemo`/`openSave`
  `SendMessage`, and dismisses `#game-loading` on commit or load rejection.
- **Standalone Exploded View (`UnityExplodedView.tsx`, `StationExplodedView.cs`):** Reparents
  `#unity-canvas` into `<dialog class="explodedViewer">` over isolated User Layer 8
  (`ExplodedPresentation`), sending
  `exploded.{open,close,theme,select,floorVisibility,reset,pointerDown,pointerMove,pointerUp,pointerCancel,camera}`.
  Generation numbers fence late replies and synchronize external open/close transitions
  (`BeforePreviousDispose`).
- **Statistics (`statisticsAdapter.ts`, `StationStatisticsFeature.cs`):** Mirrors
  `state.statistics.metrics` into `SimSlice.metrics` and drains `stats.history` in pages of
  `<= 128` rows (13-stride `Float32Array`), resetting cleanly on `runId` or `sessionId` change
  and retrying from `cursor` after transient failures.
