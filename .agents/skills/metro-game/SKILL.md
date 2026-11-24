---
name: metro-game
description: Work in game/ — Station Designer's React 19 + Three.js + Web Worker sandbox. Use for game/ architecture, dependency rules, build/ commands, persistence/ saves, shipped demos, app/ React shell and tools, city styles, audio, assets, or game/worker/. Routes sim/, render/, test/, unity-web/, wasm/, and stats/ to sibling skills.
---

# Station Designer Game (`game/`)

`game/` is a standalone React 19 + Three.js + Web Worker application with its own
`package.json`, Vite build, Node test suite, and Cloudflare Worker (`metro-game`).
It imports nothing from `web/`, `art/`, `model/`, or `stats/` at runtime.

## Routing to References and Sibling Skills

| Area | Owner |
| --- | --- |
| `build/`, `persistence/`, `data/`, `assets/`, `app/`, `worker/` map | [references/app-and-build-map.md](references/app-and-build-map.md) |
| City styles (8 cities, branding, canopies, maps, thumbnails) | [references/city-styles.md](references/city-styles.md) |
| Game SFX, spatial ambience, speed scaling & music | [references/audio.md](references/audio.md) |
| Pure simulation (`game/src/sim/`, 5 m profile, routing, trains) | [`metro-game-sim`](../metro-game-sim/SKILL.md) |
| Three.js renderer (`game/src/render/`, models, batching, LOD) | [`metro-game-render`](../metro-game-render/SKILL.md) |
| Node test suite (`game/test/`) & `tools/check-*.mjs` | [`metro-game-test`](../metro-game-test/SKILL.md) |
| Shared Unity React shell (`game/src/unity-web/`, `vite.unity-ui.config.ts`) | [`metro-unity-web`](../metro-unity-web/SKILL.md) |
| Opt-in Rust/WASM A* prototype (`game/wasm/`) | [`metro-wasm-experiment`](../metro-wasm-experiment/SKILL.md) |
| Anonymous stats Worker (`stats/`) & `app/globalStats.ts` | [`metro-stats`](../metro-stats/SKILL.md) |
| Soft-human passenger source library & sound studio (`model/`) | [`metro-model`](../metro-model/SKILL.md) |
| Repo layout, root scripts & measured performance record | [`metro-repo`](../metro-repo/SKILL.md) · [performance.md](../metro-repo/references/performance.md) |

## Commands

Run from the repository root (or inside `game/` where shown):

```powershell
npm run dev:game                        # Vite dev server on http://localhost:5174 (/ and /en/)
npm --prefix game run typecheck         # tsc --noEmit (4096 MB heap)
npm run build:game                      # npm --prefix game ci && typecheck + vite build -> game/dist/
npm run test:game                       # node --test "test/**/*.test.mjs"
npm run test:perf                       # Curated perf/geometry/LOD/preview suites + coverage
npm run audit:i18n                      # AST check for inline UI/decal copy in game/src and web/src
npm --prefix game run render:menu-thumbnails  # Bake 132 px LHS palette PNGs (build -> render -> build)
npx wrangler dev -c game/wrangler.jsonc # Local Cloudflare Worker preview for /game/ routes
npm run deploy:game                     # Build + wrangler deploy -c game/wrangler.jsonc
```

The Vite build (`scripts/passenger-assets.ts`) splits baked passenger binaries into
`< 20 MiB` `.bin` chunks and fails the bundle if any emitted asset reaches the
Cloudflare Workers `25 MiB` limit (`game/test/passenger-assets.test.mjs`).

## Layout, Dependency Rule, and Coding Conventions

`game/test/layering.test.mjs` enforces the one-way dependency boundary:

```text
app/    ->  render/  ->  sim/
app/    ->  build/, persistence/, data/
build/  ->  sim/                     (imports neither render/ nor app/)
sim/    ->  sim/ only                (zero external packages, DOM, three, or react)
```

- `render/` never imports `app/`. Two narrow facility-wall helpers (`facilityWallCells`
  and `SHOP_WALL_H`) are imported from `build/model.ts` by `ChunkSystem.ts` and
  `RoomModel.ts`.
- **One unit per file with compatibility barrels:** Windows, tools, rail folders, store
  slices, build domains, models, and scene systems live in dedicated files; barrels
  (`app/App.tsx`, `app/LeftRail.tsx`, `app/SignEditor.tsx`, `app/store.ts`,
  `build/model.ts`, `render/models.ts`, `render/scene.ts`, `sim/world.ts`) preserve
  existing deep imports.
- **Strict TypeScript (`game/tsconfig.json`):** Explicit `.ts`/`.tsx` extensions on
  relative imports, `import type` (`verbatimModuleSyntax`), and `as const` objects
  instead of `enum` (`erasableSyntaxOnly`).
- **Coordinate packing & axes:** `+z` is up, `n` is `+y`, `e` is `+x`; pack cell
  coordinates with `packKey(x, y, z)` (numeric arithmetic, never bit shifts).

## Load-Bearing Architectural Invariants

### 1. Single-Verdict Placement, Previews, and Immutable History

- **One verdict, asked twice:** Placement rules live in `sim/placement.ts`
  (`blockReason`, `cutCourseReason`, `equipmentReason`, `moveDropReason`), and
  `build/validation.ts` (`checkBlockCells`, `checkCutCells`, `checkModulePlacements`,
  `previewNotice`) aggregates candidate sets for previews and releases. Never duplicate
  or inline placement rules inside `app/tools/*`.
- **Preview isolation:** Hover, drag, roof, road, fence, and move previews mutate only
  renderer preview state (`GhostSystem`) and never touch `StationState`, history, or
  the simulation worker.
- **Grade-level (`z = 0`) rules:** Street cells are stored inverted (only dug `void`
  holes are recorded). `addWalls` replaces `void` records with solids; delete commits
  gate on `sameCells` rather than `cells.length`; stations have no minimum block count.
- **Drag budgets & gestures:**
  - Block/cut/tactile/road multi-cell drags cap at `MAX_BLOCK_DRAG_CELLS = 10_000`
    (`sim/constants.ts`). Over-budget drags refuse whole (never clipped) and defer
    large preview rebuilds via `StablePreviewDelay` (`100 ms`).
  - Loose equipment and decor support single-axis line placement
    (`supportsLinePlacement` in `app/store/catalog.ts`, spacing `0–6` blocks in
    `sim/lineSpacing.ts`, pitch arithmetic in `app/tools/geometry/linePlacement.ts`).
  - `store`, `toilet`, and `office` are room-purpose zone paints (`Cell.room`) applied
    via `ZoneTool`; buildable `ticket` / `info` booth counters live in the Rooms folder
    and stand on the pointed block's floor (`facilityStandZ`).
- **Immutable commits & undo:** Every document edit passes through
  `StationSlice.commit`, keeping up to `UNDO_MAX_FRAMES = 40` immutable snapshots
  sharing untouched records, clearing contact finishes (`clearContactFinishes`),
  syncing bridge piers (`syncBridgePillars`), and releasing retired `WeakMap` caches
  (`forgetDocumentCaches`). Presentation-only edits (`populationEdit`) keep
  `geometryVersion` unchanged and send `{ type: 'population' }` to the worker;
  structural edits on stations with `>= 20_000` records (`LARGE_WORKER_DOCUMENT`) send
  bounded `{ type: 'build-edit' }` deltas (`stationEdit`) when possible.

### 2. Persistence, Shipped Demos, Startup, and Tutorial

- **Save envelope (`persistence/save.ts`):** `metro-save` v1 (`SAVE_FORMAT`,
  `SAVE_VERSION = 1`, `GAME_VERSION = '0.2.0'`). `serialize` writes top-level `city`
  and runs `repairGrid`; `parse` validates the envelope strictly (never partially
  loads), normalizes `d.city ?? d.cityStyle` (defaulting to `guangzhou`), repairs
  off-grid coordinates via `toStateRepairing`, and reports `droppedCells` /
  `droppedModules`.
- **Shipped demos (`data/reference-station.ts`):** `EXAMPLE_STATION_IDS = ['zoo',
  'tanwei', 'tianhe']` (`demo-station.json`, `tanwei-station.json`,
  `tianhe-station.json`), returned via `structuredClone` and booted cold at
  `DEFAULT_SIM_TIME` (`06:30`, `warmup: 0`, `REFERENCE_BOOT`). Refresh saves with
  `node tools/bake-demo-station.mjs <file.metro.json>`.
- **Startup & autosave (`main.tsx`, `boot.tsx`, `autosave.ts`, `demoRoute.ts`):**
  - Query flags `?capture-*` boot minimal capture modules for concept art and menu
    thumbnails without loading the full game.
  - Phone/tablet viewports (`isMobileMode`) mount `MobileNotice` without downloading
    the Three.js bundle until the user opts in.
  - Demo links (`/game/zoo`, `/game/tanwei`, `/game/tianhe`, plus `/en/` twins) load
    before autosave, replace the URL to `/game/` or `/game/en/`, and initialize the
    worker once.
  - Normal startup restores `metro-game.autosave.v1` if valid, otherwise opens an
    empty station at `openingLevel(station)` (respecting `levelBase`). Autosave
    flushes committed `version` changes every `AUTOSAVE_INTERVAL_MS` (`300_000 ms`,
    5 min) plus `pagehide`/`visibilitychange`, and invalidates immediately on
    `stationEpoch` changes.
- **Interactive tutorial (`app/windows/tutorial/`):** Persists step/hidden state in
  `metro-game.tutorial.v1` and auto-disables on `/benchmark` routes. The dimming
  overlay leaves pointer, wheel, orbit, and keyboard shortcuts live; practice steps
  (`block`, `delete`, `rail`) reveal the canvas only after the tool is selected during
  that step.

### 3. React 19 Shell, Bilingual i18n, and `metro-game` Worker

- **App shell & worker seam:** `app/store/Store.ts` composes 12 Zustand slices with
  zero sim logic. High-frequency worker frames flow through `setFrameHandler`,
  `subscribeFrame`, `setDensityHandler`/`replayDensityHandler`, and `setRouteHandler`
  directly into `Viewport` / `ExplodedView` without re-rendering React panels.
  `StationHost` / `stationHostBridge.ts` let the shared React UI delegate document
  ownership to Unity (`metro-unity-web`).
- **Shortcuts & dialogs (`AppShell.tsx`, `rail/helpers.ts`, `topbar/`):**
  - `B` (delete), `P` (pick), and `M` (move) toggle back to `previousTool`.
  - Build-rail folders use `Shift+1..0` (`RAIL_FOLDERS`); inspector folders use
    `Alt+1..4` (`INSPECTOR_FOLDERS`).
  - Both the New Station button and `Ctrl+N` open the same `NewStationButton`
    confirmation dialog before calling `newStation()`.
  - `SettingsMenu.tsx` houses the benchmark action in its heading, 4 audio sliders,
    4 setting tiles (graphics quality / Unity model detail, FSR 1.0 upscaling, edge
    scrolling, anonymous stats sharing), and 4 action tiles (restart, report issue to
    `/stats[/en]/report`, language toggle, UI theme cycling `blueprint`/`site`/`studio`).
- **Bilingual i18n (`sim/i18n.ts`, `sim/i18n/messages.ts`, `app/i18n.ts`,
  `app/languageRoute.ts`):**
  - All built-in UI, notice, and decal strings live in `sim/i18n/messages.ts`
    (verified by `npm run audit:i18n`). Use `msg()` for canonical Chinese data/notices,
    `t()` for active UI, `translate()` at presentation boundaries, `tForLanguage()` for
    fixed-locale output, and `printed_*` keys for fixed English captions on bilingual
    signs.
  - Locale stays out of saves and worker state; `/game/` defaults to `zh-CN`,
    `/game/en/` defaults to `en`, each route persists its own override in
    `metro-game.language.<routeLocale>`, and `/benchmark[/en]` stays isolated from
    main-game storage.
  - English station-name and sign-text inputs use Primary/Secondary labels without
    swapping authored fields (`SIGN_TEXT_MAX = SIGN_TEXT_EN_MAX = 24`). Ensure
    translated labels wrap cleanly without hidden overflow.
- **Cloudflare Worker (`game/worker/index.js`, `game/wrangler.jsonc`):** Claims
  `stationdesigner.com/game` and `/game/*` (`ASSET_PREFIX = "/game"`), strips the
  prefix before `env.ASSETS.fetch`, issues canonical `308` redirects for directory vs
  client routes (`/lab`, `/zoo`, `/tanwei`, `/tianhe`, `/benchmark`, `/benchmark/en`),
  aliases `/en/` and `/benchmark/` relative assets back to root assets, and falls back
  to `/` for extensionless client routes.

### 4. City Identity and Audio

- **City styles:** Eight cities (`guangzhou` default, `shenzhen`, `shanghai`,
  `beijing`, `chengdu`, `chongqing`, `wuhan`, `nanjing`) control new-line palettes,
  new-exit naming, train marks, entrance canopies/headers, guideposts, lazy-decoded
  network maps, and 14 cached city menu PNGs per non-Guangzhou city. See
  [references/city-styles.md](references/city-styles.md).
- **Audio:** `app/gameAudio.ts` (Web Audio SFX + speed-scaled spatial ambient beds),
  `app/ambientPlayback.ts`, `app/gameMusic.ts` (single-element streaming music), and
  `app/audioSettings.ts` manage four local volume channels outside station state and
  undo history. See [references/audio.md](references/audio.md).
