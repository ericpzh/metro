# Bridge v2, Dual Transport & Shared React UI Shell

Reference for `game/src/unity-web/`, `game/vite.unity-ui.config.ts`, `tools/unity-editor-ui/`,
and the Unity bridge/presenter classes in `unity/Assets/StationDesigner/`.

## Module map (`game/src/unity-web/` & shared seams)

| File | Responsibility |
| --- | --- |
| `main.tsx` | Single-tree shell entry (`mountUnityUI`), registers `StationHost` (including authoritative `undo`/`redo`/`getHistory`/`subscribeHistory`) + `stationHostCommit`, intercepts all 5 artwork streams before `stationBridge.receive`, syncs UI theme (`view.set { key: "theme" }`), runs WebGL autosave, mounts `UnityApp` / `UnityShellRoot` / `UnityExplodedView` / `UnityBenchmarkRoute`, wires `#game-loading`, `.metro-measure-chip`, audio, eye drag, and reject notices. Exposes `window.__metroStationBridge`. |
| `stationBridge.ts` | Bridge v2 transport (`SCHEMA_VERSION = 2`), FIFO station-load queue (at most one active load), dependent-edit `targetLoadId` + revision/epoch binding, `beforeSend`/`beforeDispatch`/`onCancel` hooks, shell adoption gating (`noteAdopted` / `noteAdoptionFailed`), `sessionId` fencing, pure `reduce()` (tracking `stationEpoch`, `readHostHistory`, raw delta `*Json`/`*Indices`, and returning `current` unchanged for empty revision-unchanged `ack` frames), `onCommit`, out-of-reducer `onCameraPose` & `onAudio`, correlated `request<TPayload>()` (`BridgeRequestError`, 5 s default timeout), `readCommittedDocument()`, and `resync()`. |
| `stationDelta.ts` | O(\|delta\|) in-place application of `StationCommitDelta` (`STATION_DELTA_SCHEMA_VERSION = 1`, including `lines`) via `WeakMap`-cached cell index (`seedStationCellIndex`, `applyStationDelta`) preserving untouched object identities. |
| `lineSelection.ts` | Authoritative rail-line selection tracker (`createLineSelectionTracker`: `reserveAdd`, `bindAdd`, `trackAdd`, `noteReject`, `syncFence`, `reconcile`) activating newly created host lines on correlated `edit.line.add` commits and falling back cleanly on remove/undo/redo/replacement. |
| `carriedMoveAdapter.ts` | Memoized carried-move state bridge (`createCarriedMoveAdapter`, `readHostCarriedMove`) exposing host `state.edit.{carried,plan,moveReason}` and localized refusal strings to `InfoCard.tsx` for Confirm/Cancel controls. |
| `cameraAdapter.ts` | `createStationCameraPort`, `createUnityViewCubeAdapter` (rAF-coalesced `camera.orbit` & sequenced `onCameraPose`), `attachViewStateBridge` (`view.set`), and `attachCanvasCameraGestures` (middle orbit, unclaimed right pan, wheel zoom, build-button chord guard). |
| `pointerButtons.ts` | Canonical DOM mouse button (`0`/`1`/`2`) to `MouseEvent.buttons` bit (`1`/`4`/`2`) table, `MOVE_BUTTON = -1` sentinel, `holdsButton`, `hasBuildChord`. |
| `pointerInput.ts` | Canvas tool pointer stream (`pointer.down`, rAF-coalesced `pointer.move` suppressed during middle-drag orbit and unclaimed right-drag pan with middle-down hover rAF cancellation, `pointer.up`, `pointer.rightTap`, `pointer.cancel`, `pointer.leave`), build-button chord cancel, and full-swapchain coordinate normalization under `html.metro-overlay`. |
| `viewportCursor.ts` | Web-parity viewport cursor resolver (`customToolCursorFor`, `readSectionHot`, `toolPointerPosition`, `syncViewportCanvasClasses`) toggling `#unity-canvas` `.selectCursor` (normal OS arrow for Select), `.grab` (from immediate `state.edit.sectionHot` or `view.sectionHandle`), and `.toolPointer` classes plus `--ui-scale`-scaled floating SVG `move`/`delete`/`pick` icons while yielding to Exploded View, eye view, benchmark mode, and section-cut handles (`unity/tests/viewport-cursor.test.mjs`). |
| `pointerMeasure.ts` | Formats and positions the drag-size badge (`.metro-measure-chip`) from `state.edit.cells.measure` (`wantsMeasure`, `measureText`, `measurePosition`). |
| `keyboardNavigation.ts` | Held `WASD` (`camera.panPlanarHeld`) and `Ctrl+Q/E` (`camera.panHeld`) with `Shift` boost; clears held state on blur, tab hide, dialog block, or unmount. |
| `toolAdapter.ts` | Bidirectional sync between shared store tool/rail/paint/`currentBoards` (`signBoards`) settings and C# `tool.set` / `state.tool` (`applyingHostTool` echo guard, `rightClaimedByTool`). |
| `pickAdoption.ts` | Parses Unity `state.edit.pick` (`parseHostPick`) into typed `module`, `face`, or `none` targets with monotonic `seq` deduplication so `main.tsx` delegates both placed-module and block/wall/cut/wedge/ground finish picks to shared `PickTool.ts` (`adoptPickedModule`, `adoptPickedFace`) and re-adopts repeated picks cleanly. |
| `editNotices.ts` | Localizes `state.edit.notice` (`blocked` / `no-op` / `stale` + refusal codes, including room refusals `min-size` with live `width`/`height`, `clash`, `no-floor`, `too-large`, `track`, and `not-floor`) with tool-scoped overrides (`noticeText`, `noticeKey`). |
| `simulationAdapter.ts` / `playbackControls.ts` | Mirrors `state.clock` and 14 `state.simulationCapabilities` flags atomically (`receiveHostState`, reset on `sessionId` change); routes `sim.{play,speed,seek,restart}`; gates TopBar buttons via `useSimulationAvailability`. |
| `statisticsAdapter.ts` | Syncs `state.statistics` (`18`-field `Metrics` deduplicated without `tickMs`) and paginates `stats.history` (`MAX_HISTORY_PAGE_ROWS = 128`, 13-stride `Float32Array`) with `sessionId` + `runId` fencing. |
| `UnityExplodedView.tsx` / `explodedInput.ts` | Reparents `#unity-canvas` into `ExplodedViewShell` over Layer 8 `ExplodedViewerCamera`, handles `exploded.*` commands, generation-fenced open/close sync, tray drag, camera gestures, and floating floor panel clamping. |
| `UnityBenchmarkRoute.tsx` | Interactive 30 s 16× benchmark route (`/game/unity/benchmark[/en]` and in-place desktop mode), LOD/FSR selection, `benchmark.{mode,start,stop}`, FPS and resource charts. |
| `signFaceProvider.ts` / `signCommitAdapter.ts` | `signRequest` → `drawSignPanel` (`512 px/m`) → `sign.faceChunk` + `sign.faceReady`; `sign.commit` with `expectedRevision`. |
| `psdHeaderProvider.ts` | `psdHeaderRequest` → `drawPsdHeader` (`1024`/`2048 × PSD_HEADER_PIXELS`) and 4 vinyl decal painters (`PsdDecals.ts`) → `psd.headerChunk` + `psd.headerReady`. |
| `exitFaceProvider.ts` | `exitFaceRequest` → `exitHeaderCanvas` / `guideFace` / `guideEnglishFace` / `guideExitLetterFace` → `exit.faceChunk` + `exit.faceReady`; pushes `exit.locale` on boot and language switches. |
| `calligraphyFaceProvider.ts` | `calligraphyRequest` → `drawCalligraphyPanel` (`sim/calligraphyFonts.ts` manifest + DOM font advance probe, UV orientation `mirrorU`/`flipV`) → `calligraphy.faceChunk` + `calligraphy.faceReady`. |
| `trainMarkProvider.ts` | `trainMarkRequest` → city cab emblems, Chongqing line-numbered cab badge, and Nanjing side mark → `train.markChunk` + `train.markReady`. |
| `webglAutosave.ts` | Lossless raw-JSON WebGL `localStorage` autosave (`metro-game.autosave.v1`): O(1) `noteCommit`, coalesced idle encoding, synchronous `pagehide`/`visibilitychange`/`beforeunload`/5-minute interval flush, raw root/record slicing preserving own `__proto__` and >53-bit integer tokens, final-sequence target-index validation after removals/insertions (`onSequenceBroken` → `station.resync` without overwriting coherent storage), correlated `stationEpoch` clear-before-write replacement, and demo/explicit-open startup precedence (disabled on desktop overlay & `/benchmark`). |
| `desktopFiles.ts` | Desktop WebView2 native file picker bridge (`getDesktopFileBridge`, `buildSaveFileName`, `openDesktopSaveFile`, `saveDesktopSaveFile`) wrapping `window.__metroDesktopFiles` so Unity Editor and standalone Windows open native `OpenFileDialog`/`SaveFileDialog` (via `TopBar` `files.pickOpen` and `host.save()`) while WebGL keeps `<input type="file">` and `<a download>` (`unity/tests/desktop-files.test.mjs`). |
| `unityAudio.ts` | Mounts shared `gameAudio` & `gameMusic` on `stationBridge.onAudio` for edit cues (`place`, `select`, `pick`, `delete`, `move`, `refused`) and camera-relative crowd/train/traffic ambience frames. |
| `unity-ui.css` | Full-viewport layout, hides `#unity-loading-container`/`#unity-footer`, layers `.explodedViewer[data-unity-host="true"]`, hides `.app` when `html.metro-overlay body:has(.explodedViewer[open])`, styles `.metro-measure-chip`, sets `.viewport.selectCursor` to `default`, and scales `.movePointer`/`.deletePointer`/`.pickerPointer` by `calc(32px * var(--ui-scale, 1))`. |
| `bridge.ts` / `zooUi.tsx` | Legacy `ZooPlayable` vertical-slice bridge (`zooBridge`, `metro:zoo-state`) kept for slice verification. |

Key shared seams in `game/src/app/`: `windows/StationHost.tsx` (`StationHost` context
including optional `undo`/`redo`/`getHistory`/`subscribeHistory`),
`stationHostBridge.ts` (`registerStationHostCommit` for `commitSignBoards`, `commitExit`,
`commitCityStyle`, `commitStationName`, `commitAddLine`, `commitRemoveLine`,
`commitUpdateLine`, `commitLiftDoorSide`, `commitSwitchRunDirection`,
`commitSwitchRoadDirection`, `commitRegenRail`, `startMove`, `undo`, `redo`,
`deleteSelection`, `cancelGesture`, `confirmMove`, `rotateCarried`,
`cycleCarriedLightPosition`, `getCarriedMove`, `subscribeCarriedMove`), `pointerDrag.ts` (`beginPointerDrag` +
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
    (`schemaVersion: 1`, `baseRevision`, `revision`, `removedCells`, `changedCellsJson`,
    `changedCellIndices`, `removedModules`, `changedModulesJson`, `changedModuleIndices`,
    `linesJson`, editable header fields; gated on `StationLocalEdit.CanRepresentHeaderInDelta`
    and `!HasReorderedRecords`) on sequential local edits and undo/redo.
  - `state`: Coalesced runtime snapshot published on `StationGameHost.stateIntervalSeconds`
    (`0.1 s` default, immediate on `sim.*`), never carrying `document` or
    `stats.history.values`. Merges `level`, `name`, `speed`, `playing`, `tool`,
    `toolGeneration`, `rightClaim`, `settingsGeneration`, `queued`, `boarded`, `clock`,
    `simulationCapabilities`, and all registered `IStationStateContributor` payloads (`camera`,
    `view`, `render`, `exploded`, `edit`, `statistics`, `displays`, `overlays`, `roads`,
    `crowd`, `sign`, `exit`, `psd`, `graphics`), with raw-JSON caching for `crowd`,
    `statistics`, `displays`, `render`, `psd`, `exit`, `roads`, `overlays`, and `sign`
    (plus zero-`JObject` streaming for `crowd` via `StationCrowdStateContributor.BuildJson`).
  - `ack`: Carries command result payload; `camera`/`view` acks also merge `payload.camera`,
    `payload.view`, and `payload.level` directly into `snapshot.state`. Continuous
    `camera.orbit`/`pan`/`zoom` commands take a zero-reparse fast path in `StationSectionView`
    with minimal `{ revision }` acks that `reduce()` treats as identity no-ops.
  - `reject`: Records `{ id, type, code, reason? }` in `snapshot.rejects` (last 8) without
    changing `revision`. `main.tsx` dismisses `#game-loading` and shows localized notices for
    `station.*` and `sim.*` rejects, shows `payload.reason` for player-driven
    `sign.*`/`road.*`/`face.*`/`tool.*` rejects, and keeps early startup `camera.*`/`view.*`
    rejects silent.
  - `camera`: Session-fenced per-frame sequenced pose (`{ camera, sequence }`, streamed
    zero-`JObject` via `StationViewRig.FastCameraPosePublished`) delivered to
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
- **Five out-of-band PNG artwork streams:** Host requests (`signRequest`, `psdHeaderRequest`,
  `exitFaceRequest`, `calligraphyRequest`, `trainMarkRequest`) must publish via
  `StationGameHost.PublishOutbound` so both WebGL and WebView2 receive them. Each provider caps
  batches at `32` keys, chunks PNG base64 at `48 KiB`, fences by `sessionId` + `revision`, gates
  on browser font/pictogram readiness (returning `pending` with `reason: "font" | "pictogram"`
  rather than blank plates), and never touches the snapshot reducer.
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
- **Shared memory (`MUI2`, `0x4D554932`) & startup backdrop:** Premultiplied DComp pixels
  are unpremultiplied to straight sRGB BGRA32 into a lock-free double-buffered
  `MemoryMappedFile` (max `3840 × 2160`, `rasterScale = 1.0` so the shared React UI's
  `--ui-scale` owns `75%–150%` resolution-aware scaling without double-scaling). Capture waits for
  `navigationStarted` and refuses to publish an all-transparent initial frame (`sequence == 0 && !hasVisiblePixel`).
  `StationDesktopUiPresenter` launches WebView2 eagerly in `Awake()` (`TryBindAndStartWorker`)
  and shows a native themed `StartupBackdrop` loading card (colors/copy synced via
  `PlayerPrefs` from `view.set` `"theme"` and `exit.locale`, animated sweeping bar; hidden on
  `-benchmark` and smoke runs) over the 3D viewport until the first visible WebView2 frame
  arrives, then uploads dirty sequences at most once per `Time.frameCount` into a
  `Texture2D(BGRA32)` via `LoadRawTextureData(IntPtr, int)` on a UV-flipped (`(0, 1, 1, -1)`)
  `RawImage` inside `StationDesktopUiCanvas` (`ScreenSpaceOverlay`, `sortingOrder = 32000`,
  `pixelPerfect = true`), streaming host replies via reusable `JsonTextWriter`/`StringBuilder`.
  Avoid native `<select>` and `<input type="color">` popups in overlay UI — Chromium renders
  them in a separate OS HWND outside `CoreWebView2CompositionController` capture (use pure-DOM
  controls such as button toggle groups or `popover="auto"` panels like `LineColourPicker`
  with `beginPointerDrag` instead).
- **Virtual origin, feedback links & overlay CSS:** Intercepts `https://app.metro.local/*`
  (`WebResourceRequested`) serving `dist-unity-ui` at `/game/_unity/UI/`,
  `public/module-thumbnails/` at `/game/_unity/UI/module-thumbnails/`, and `public/audio/` at
  `/audio/` and `/game/audio/`. Handles `NewWindowRequested` by setting `e.Handled = true` and
  launching only allowlisted `/stats/report` and `/stats/en/report` URLs on
  `https://stationdesigner.com` in the user's system browser. Injects `<html class="metro-overlay">` with transparent
  `.stage`/`#unity-canvas`/`.explodedViewer[data-ready="true"]` and sets
  `window.__metroDesktopOverlay = true` + `window.metroUnityAudioBase = '/audio/'`.
- **Loopback TCP IPC & input forwarding:** JSON lines over `127.0.0.1` ephemeral port
  (`connected`, `ready`, `cmd`, `bridge`, `resize`, `mouse`, `key`, `cursor`, `modalDialog`,
  `navigate`, `capturePreview`, `previewCaptured`, `log`, `quit`). Offscreen CSS cursor and
  `--ui-scale` changes stream as `{ kind: "cursor", cursor, scale }` notifications to
  `StationDesktopUiPresenter`, which hides the OS cursor (`Cursor.visible = false`) for
  `none` and applies quantized `24–64 px` (4 px steps from 32 px base) hardware textures and
  hotspots via `StationDesktopCursors` (`StationDesktopCursorsTests`), resetting on leave,
  focus loss, modal dialogs, smoke suppression, and teardown.
  - **Native desktop file dialogs:** `MetroEditorWebView.exe` injects `window.__metroDesktopFiles`
    (`openSave`, `saveFile`) backed by `__metro_file_{open,save,reply}__:` WebView2 messages
    intercepted before `metro:station-state`. Requests run WinForms `OpenFileDialog` /
    `SaveFileDialog` (64 MiB open cap, `.metro.json`/`.json` filters, remembered directory) on a
    dedicated STA thread owned by Unity's foreground/main HWND (`ResolveUnityOwnerHwnd()`), while
    `StationDesktopUiPresenter` grants `AllowSetForegroundWindow` on worker launch/focus and gates
    mouse, keyboard, text, and custom cursor handling while `{ kind: "modalDialog", open: true }`
    is active (`MetroEditorWebView` also drops CDP mouse/key events during `nativeDialogActive`).
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
  pre-benchmark station + `station.resync` when returning from benchmark mode. On startup,
  standalone autosave restore is deferred past WebView2 launch:
  `ReadStandaloneAutosaveInBackground` parses the document and builds
  `StationSimulationSession` off the main thread, then `RunStandaloneAutosaveInstall` drives
  frame-yielded `OpenPreReadDocumentYielded` (holding incoming `station.resync` until commit)
  so large stations keep `#game-loading` animating smoothly without freezing startup or
  flashing the 3D scene early.
- **Editor integration (`StationEditorReactOverlay.cs`):** Overrides
  `StationDesktopUiPresenter.PathResolver` to build
  `.preview/unity/editor-ui-host/bin/MetroEditorWebView.exe` and `game/dist-unity-ui` on
  demand; stages `<Player>_Data/StreamingAssets/MetroUi/{bin,ui,public}` on
  `BuildTarget.StandaloneWindows64` (`IPostprocessBuildWithReport`); exposes
  `Metro/Station Game/*` menus and 9 `metro` Pipeline CLI commands: `editor_ui_selftest`,
  `player_benchmark_start`, `editor_ui_prepare`, `editor_ui_wait`, `editor_ui_capture`,
  `editor_ui_exploded_check`, `editor_ui_statistics_check`, `editor_ui_sky_check`, and
  `editor_ui_picker_check`.

### Desktop tooltips

WebView2's native `title` popups are outside the captured surface. The desktop
overlay mounts one DOM tooltip from `desktopTooltip.ts` and disposes it when the
shell unmounts. Keep `title` as the text source, including empty titles that block
ancestor inheritance. Use the manual popover so the tooltip appears over dialogs
and menus. Run `node --test unity/tests/desktop-tooltip.test.mjs` and check hover in
the rebuilt Windows player.

### Windows IME

The standalone player sets `UnityEngine.Input.imeCompositionMode` to `On` before the
splash because Unity's Windows message handler uses that setting to keep the native
IME context attached. The Input System command enables composition callbacks separately.
Windows owns the selected input mode and the Microsoft Pinyin Shift toggle.

The offscreen WebView2 host reports focused editable fields and their candidate-window
anchor to Unity. Unity positions the native candidate window and forwards committed text
to WebView2. Run `node --test unity/tests/desktop-ime.test.mjs` for the bridge contract.
In the rebuilt Windows player, check focus and refocus, press Shift to toggle between
中 and 英, then compose and commit Pinyin in a station name field.

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
