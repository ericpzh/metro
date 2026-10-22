---
name: metro-game
description: Work in game/ of the ericpzh/metro repo — the React 19 + three.js + Web Worker metro-building sandbox. Use when changing game/src (sim, builder, renderer, app shell, save format), the module catalogue, rails and trains, the crowd's day, or the metro-game Worker. Covers the dependency rule, the sim's load-bearing invariants and the app/rail architecture.
---

# The game (`game/`)

Every stock uses 0.8 m wheels, with bogies beneath inter-door window bays and sealed under-seat housings around the unchanged-height aisle. A/B/C/L passenger roofs and lower skirts derive from the cab rear cut in High and Low; C lamps sit in its coloured band and the floating white skirt blocks are removed. A/B/C/L cab face and lower colour are disjoint paint sections of the same shell, with flush fitted glazing, smooth circular headlights and wiper pivots fully below the glass. Passenger overhead fittings stop at the cab seam. A/B/C/L cabs have a ten-degree front rake that fades to zero at the rear body seam. A/B/L carry glazed crew doors on both sides; all five classes have surface-fitted windshield wipers. A/B/L use the same small centred emblem as C, whose narrower evacuation door clears it. The cabin ceiling stops at the cab seam; the aisle floor and passenger door centres keep their platform alignment. The A/B/C/L passenger leaves, seals and black lower panels follow the common skirt curve through opening travel. A/B/L crew doors stay upright and narrow, moved forward to clear fully opening passenger leaves by over 10 cm.

For performance work, read [the shared performance guide](../metro-repo/references/performance.md).
It covers cold interactions, work-count regressions, comparable measurements and GPU validation.

Its own application: its own `package.json`, Vite config, tests and Cloudflare
Worker (`metro-game`). It imports nothing from `web/` or `art/`.

Read first:

* `game/README.md` — the milestones, the time base, measured numbers and the
  deliberate divergences from the spec. **Read it before changing sim behaviour.**
* `references/module-map.md` (in this skill) — the file-by-file ownership map of
  `game/src`.
* `game/test/README.md`, or the `metro-game-test` skill — how the suite works.
* `GAME-SPEC.md` at the repo root — *what* the game does. Cite its sections.

```powershell
cd game
npm run dev        # http://localhost:5174
npm run typecheck  # tsc --noEmit — the other half of "it works"
npm run build      # tsc --noEmit && vite build
npm test           # node --test "test/**/*.test.mjs"
```

The production build enforces the Cloudflare Worker asset limit: every emitted
file must be smaller than 25 MiB. `game/test/passenger-assets.test.mjs` pins the
strict boundary, including files exactly 25 MiB, and verifies lossless atlas
splitting.

## Layout, and the one dependency rule

The direction is one-way and enforced by `game/test/layering.test.mjs`:

```
app/  →  render/  →  sim/
build/ →  sim/            (and neither render/ nor app/)
```

* `sim/` — **pure TypeScript.** Imports nothing outside `sim/`, and never touches
  the DOM, `window`, three.js or React. Runs directly in Node (tests import the
  `.ts` files and Node strips types). This is the rule to protect.
* `build/` — the station document and the edit commands (build, dig, paint,
  zones, facilities, placement, undo).
* `render/` — three.js scene, chunk mesher, procedural materials and models.
* `persistence/` — the `metro-save` v1 envelope.
* `data/` — the shipped demo station (`demo-station.json`, the 动物园 Line 5
  document), `reference-station.ts` and the 广州地铁 line colours.
* `app/` — the React shell. Panels and pointer handling only; no sim logic.

The B 删除, P 吸取 and M 移动 shortcuts are toggle modes: pressing the active
shortcut returns to the tool that was active before it. `ToolSlice.setTool` keeps
that predecessor current as tools change; keep the key handlers and
`game/test/tool-shortcuts.test.mjs` aligned when changing these bindings.

New station replaces the current document. Both its top-bar button and Ctrl+N
must open the same confirmation; invoke `newStation` only after the player chooses
新建车站, and let cancel, Escape and clicking outside dismiss it. The warning must
tell players to save anything they want to keep; do not promise that Undo restores
the replaced station. Pin the prompt and shortcut wiring in
`game/test/new-station-confirmation.test.mjs` (React views are tested as source
contracts because the Node suite does not mount them).

The top bar's `SettingsMenu` gear dropdown links the issue tracker beside restart: a `FaBug`
(`react-icons/fa`) anchor to `https://github.com/ericpzh/metro/issues`, opening in
a new tab with `rel="noreferrer"`, named by the bilingual `report_issue` catalogue
key and wearing the dropdown's `ghost settingsAction` chrome (with the matching `a.ghost`
styling in `src/styles.css`). Pin it in `game/test/topbar-report-issue.test.mjs`.

Inspector controls that edit placed equipment should call a store action and commit
one station edit, so the worker, undo history and selected document stay in sync.
The right-side inspector does not expose per-cell zone controls; paint and erase zones
through the 分区 build-rail tool (`ZoneTool`).
For escalators, travel direction is encoded by both `cfg.dir` and ordered `from`/`to`
endpoints; reverse both together. The inspector's selected-run reverse is
`switchRunDirection`, which serves a 自动步道 as well as a 扶梯. Pin the action in
`game/test/escalators.test.mjs`.
Escalator equipment collisions use `rampBodyBoxes`'s per-tile slope, even against
another run; do not substitute the landing-to-landing vertical envelope there.
Placement support is separate from collision: an escalator requires floor only at
its lower landing, not under the full projected incline. Keep `equipmentReason`
from routing it through the generic full-footprint floor check; `placement.test.mjs`
pins a supported lower base with open space along the run and the missing-base refusal.
Runs may occupy vertically adjacent storeys when their bodies only meet at the
landing plane. Pin slope clearance and real body overlap in
`game/test/placement.test.mjs` and `game/test/bay.test.mjs`.
Crowd movement has its own ramp-body clearance (`sim/rampCollision.ts`): use the
same storey-bounded `rampWalls` as routing, sweep the whole movement segment so a
crowd shove cannot tunnel through a rail, and keep a reachable next waypoint when
resolving pressure. Routing and collision clearance must agree at rail ends;
otherwise passengers can be pushed or routed into a dead end. Interior stair
turns retain the half landing, and displaced walkers or ramp queues recover around
the rail end. Keep these invariants covered in
`game/test/ramp-passengers.test.mjs` whenever changing ramp walls, graph edges,
crowd movement, queue approaches or stair turns.

### Conventions

Ground decor ends with 隔音屏 (`noise-barrier` family): full and half sound barriers
plus the bridge railing, with the full barrier as the parent thumbnail. These
are fence modules carrying `sound-barrier`, `sound-barrier-half` or `bridge-railing`
variants, so they use the existing fence line placement/delete/undo path and block
walking. Their palette ids belong to decor while ordinary fence ids stay in
equipment. Keep `fence`, `rail-families`, `rail-folders` and `pick-tool` aligned.

Screen-door lateral alignment is shared by bridge barriers/railings, ground
barriers and both gantry styles: `PSD_WALL_OFFSET` and `trackSideFixtureOffset`
define the common line. Ground barriers use `noiseBarrierOffset` for rendering
and placement; R half-turns choose the opposite side and line drags retain it.
Keep actual PSD/bridge/gantry geometry aligned in `module-build`, plus the thin
envelope and drag-side behavior in `fence`.

Train rendering batches repeated opaque leaves, sorts glass/straps with BatchedMesh,
and bakes mirrored static parts with corrected winding. EquipmentBatches keeps
original module surfaces on picking layer 31 and draws local material batches on
layer 0; moving door/wing/hand/cabin subtrees and cycling artwork windows remain
independent. ModuleSystem's revision key skips unchanged equipment walks, and
PanelAtlas preserves panel pixel sizes and refreshes changed source textures.
Use `bench:browser -- --compare-batching --investigate` for an enabled/disabled
comparison on the same scene and test consist; inspect its drawInventory and
multiDraw support instead of comparing reports from changed demo/assets.

Authored Low geometry belongs to each piece builder through `render/modelDetail.ts`.
Keep the full source geometry for picking; a zero-triangle approximation removes
small fittings without hiding their source/rig object. Shelves omit products and
price fittings; restroom furniture, cameras, cabinets, AC, tactile warning dots,
track hardware, ramps, lifts and stairs have explicit approximations. Both local
and cross-module batching must preserve these variants, and instances may share
geometry only when both their full and reduced geometry match. The full source
owns approximation disposal. Use `model-detail` for triangle budgets, exact stock
picks, retained motion, finish colours, restoration and disposal; regenerate the
per-model table with `node tools/model-triangle-inventory.mjs`.

Train parts author theirs in the same place: the cabin's straps, handrails, ring
lights, benches and seat-end guards, the car roof, the bogies, the gangway bellows,
the plug doors and the cab glazing all carry a Low sampling or an omission.
`batchStaticParts` merges **both** variants so a batch holds its own reduced
geometry, and `batchTrainDoors`/`batchTrainTransparent` reserve a Low leaf and Low
glass panes when they build their instance each. `render/trainDetail.ts` owns the
prepared swaps and `TRAIN_DETAIL_MAX_RADIUS`: a part with no authored variant may
use the bounded-error simplifier only while it is small, because a merged car body
spans a consist and 2 % of 150 m is metres. Door-bank and sorted-glass swaps must
stay reference-only and restore the exact sources before disposal; `train-lod` pins
the published per-consist High counts, the Low budgets, moving leaves under Low and
exactly-once release of the prepared approximations. Regenerate its table with the
inventory tool.

The crowd's Low LoD is not a model approximation but a second baked index table over
the same animated pose atlas (`lowIndices`/`lowCorners`, `passengerModel.ts`). Both
`InstancedMesh`es stay prepared and every packed instance records its storey in the
`passengerLevel` attribute; pack each drawn passenger into the topology its storey
asks for — 高画质 full on the edited storey and reduced on a ghosted one, 低画质 all
reduced, 隐藏UI all full — so a single-storey crowd stays one draw and only a ghosted
storey adds a second. Never bake or upload a second pose set, and never let the split
change pose sampling, identity, picking or the 70 % material; the atlas degrades to
the full topology when an older file has no Low table. `passenger-lod` pins the
table, the per-instance attribution, pause and one shared-atlas disposal.

Low furniture, extinguisher cabinets, fences, fare gates and exits also have
authored variants. `panelModelDetail` retains both broad faces of thin panels;
keep gate leaf rig metadata and direction artwork when reducing its shape.
Approximation bounds must contain both the source and replacement geometry,
including combined feet and chair backs that span several original fittings.
Rail signals keep all three aspect materials and unobstructed lenses. Shared
bridge noise-barrier/railing builders prepare thin Low panels without changing
post locations, gantry cutouts or glazing clearance; cover long runs and rotations.
Use `beamModelDetail` for top bars that must retain thickness: omit the two end
caps covered by joints, preserving four longitudinal faces and full source picks.

Batching preserves render order, shadow flags and culling policy. Hidden, skinned,
morphing and partial-range geometry retains its original rendering. Clock-hand,
wing, landing-door and moving-cabin descendants remain independent; cycling artwork
windows retain live geometry/material references. Transparent batches retain
per-surface sorting. `BatchedMesh.dispose()` owns its geometry plus matrix/indirection
textures: delegate that teardown once; do not separately dispose its geometry.
Instance buffers require `InstancedMesh.dispose()` in addition to geometry disposal.
Atlas material keys preserve rendering state and clipping-plane identity, not only
plane values. Distinct planes may later move independently. Repaints update stable
UV slots; deleted slots recycle. Unsupported/oversized/repeating/custom panels keep
their original maps; pages keep pixel sizes and gutters with linear/no-mipmap sampling.
Changing the view invalidates equipment revisions; cell-only edits with retained
roots preserve the actual batch allocations. New metadata/module neighbours still
take conservative rebuilds, except a module edit that only adds 楼梯块 tiles: those models
read their own floor finish and do not change neighbour geometry, so `retainedModuleIds`
keeps prior groups and builds the new tiles. Keep ordinary module additions fail-closed.
Pin the retention policy and real ModuleSystem keep-set in
`game/test/performance-policy.test.mjs`; the general batching rules stay in
`batching-lifecycle` and `draw-batching`.

* **Imports carry the file extension** (`./foo.ts`, `./Bar.tsx`) and types use
  `import type`. The tsconfig is strict with `verbatimModuleSyntax`,
  `erasableSyntaxOnly`, `noUnusedLocals`, `noUnusedParameters`.
* **No enums** (`erasableSyntaxOnly`). Use `as const` objects, e.g. `AgentState`.
* **ASCII ids; centralised bilingual copy** for anything a player reads (§9.2).
  The game supports Simplified Chinese and English; follow the i18n rules below.
* **Equipment hover previews:** 移动, 吸取 and 选择 show the actual targeted module as a vivid blue translucent preview; 删除 uses the same preview shape in red. `EquipmentTool.refreshHover` must only rebuild while the module tool is active, because its placement settings are shared with 方块 and a setting change after F must not restore a stale equipment ghost. Keep tint strength and opacity in `render/scene/systems/GhostSystem.ts`, and pin the tool-to-preview colors and inactive-tool refresh in `game/test/tool-hover-preview.test.mjs` when changing this behavior.
* **The 方块 drag budget:** one add drag previews and commits at most `MAX_BLOCK_DRAG_CELLS` (10,000) cells, generated auto-wall courses included. Count the raw rectangle/Shift line with `dragCellCount` and a 三角 run with `cutLineCellCount` before allocating, raise the cursor/notice immediately, and build the full footprint once after `StablePreviewDelay`'s 100 ms settle. Over budget is refused **whole**, never clipped: the accepted shape is cleared, every floor/auto-wall cell is passed to `setGhost([], 'add', undefined, undefined, ...)` as a red refused box, and `onUp` returns before any commit. `GhostSystem`'s red-box pool grows from `GHOST_MAX`; it is not a hard display limit. Keep preview/release counts and the exact-cap boundary pinned in `blocktool`, and measure the real pointer sequence with `npm run bench:block-drag`.
* **Picking follows what level slicing draws:** when 显示其他层 is off, hidden-storey modules cannot be selected, deleted, moved or picked. Three's raycaster still intersects invisible objects, so `CameraSystem` must reject hits with an invisible mesh or ancestor; cell-based tool fallbacks must also check `ModuleSystem.isModuleVisible` before resolving a document module. Keep the camera and level agreement in `game/test/batching-lifecycle.test.mjs`, and the tool fallbacks in `delete-tool`, `move`, `pick-tool` and `select-agent`.
* **Pack cell coordinates with `packKey`** (number arithmetic, ±4096 m). Never use
  bit shifts — the old `(x + 4096) << 20` collided neighbours.
* **Axes:** `+z` is up; `n` is `+y`, `e` is `+x`, `+z` = top face.
* **Camera follows the edited storey:** `CameraSystem.frame()` aims at `activeZ + 1 m` and translates the camera with the target, preserving orbit and zoom. Keep this pinned in `game/test/camera-vertical-pan.test.mjs` when changing storey or baseline behavior. The camera is also **read**: `pickFacing()` answers which face a pick means (a back-to-back 电视 pair, the wall a panel hangs on), and `SceneRenderer.onCameraAim` tells `Viewport` when the aim moved, so a ghost that depends on the view (a wall mount) is re-aimed without a pointer event.
* **Q/E level switches reuse prepared views:** `LevelSystem.prepareAdjacentViews()` uses the edited station's `levelBase` and the five-metre `STOREY_HEIGHT` to prewarm the active storey and its valid immediate neighbours before interaction. Do not derive these views from the deepest chunk level or hard-code a four-metre step. Keep `EquipmentBatches`' four-view bound, generation invalidation and disposal rules. `GridSystem.buildGrid()` moves the retained grid group on Q/E; it rebuilds vertices only when horizontal station bounds change. Pin selection, boundary/base cases and GPU allocation identity in `game/test/level-view-cache.test.mjs`; measure first and repeated key presses with `node tools/bench-level-switch.mjs`.
* **Loading a save respects the basis.** `loadFromText` opens on `activeZ = levelBase`, lowered to the lowest cell/module z when the player actually built below it; the infinite ground plane at 0 m is not a placement and never drags the view down to grade. The worker's `ready` message must not reset `activeZ` (`levelsZ[0]` is 0 whenever no level sits below grade). Keep this pinned in `game/test/save.test.mjs` when changing load or storey selection.
* **The hidden-UI sky follows simulation time** (`render/scene/systems/SkySystem.ts`, wired by `SceneRenderer`): the cloud sky remains visible at every camera and storey height while `hideUI` is on; it does not depend on Q/E elevation or the active storey. `setSimClock` supplies the day time; a fixed 05:00–07:00 dawn and 17:00–19:00 dusk curve sets sky background intensity and matching horizon fog, so a pause holds the light and a clock seek updates it immediately. Keep daily wrapping, gradual transitions, day/night levels, and midnight continuity in `game/test/sky.test.mjs`. The Node suite covers the deterministic cycle; when changing scene integration, check representative camera heights, hidden-UI restoration, fog and rendered output in a browser, because Node does not exercise WebGL.
* **All tuning numbers live in `sim/constants.ts`** (or `stock.ts`).
* The decorative 信号机 is one metre tall; its lower post and base use the shared
  `floor.concrete` finish. Keep the material choice pinned in
  `game/test/monitor-signal.test.mjs` when changing its model.
* **The code is organised for parallel edits:** every window, subwindow, list
  item, tool and 3D model is its own unit in its own file, and shared
  UI/behaviour uses a base class or shared chrome rather than a shared god-file.
  The former giants are barrels over their folders — `app/App.tsx`→`windows/`,
  `app/LeftRail.tsx`→`rail/`, `app/store.ts`→`store/`, `app/SignEditor.tsx`→
  `windows/sign/`, `build/model.ts`→`model/`, `render/models.ts`→`models/`,
  `render/scene.ts`→`scene/`, `sim/world.ts`→`world/` — so every deep import
  still resolves. Keep the rule when adding a unit: one unit per file, and the
  barrel re-exports it.
* Comments explain *why*, and cite `GAME-SPEC.md` sections.

### Game language and text layout

Follow the [repo translation rule](../metro-repo/SKILL.md#repo-rule-translations-use-the-existing-i18n-infrastructure)
for all built-in copy, including 3D decals. English-only wording changes must
preserve CN entries. Store compact labels in dedicated catalogue keys; do not
replace canonical direction labels with view-cube abbreviations. Where keys share
the same Chinese value, keep canonical entries after context-specific entries:
`translate`'s exact lookup uses the last matching entry.

`src/sim/i18n/messages.ts` owns built-in UI, catalogue, validation and display
copy (`zh` / `en`). Keep interpolation slots present in both translations.
`src/sim/i18n.ts` is the pure shared API: `msg(key, ...args)` creates canonical
Chinese data/notice strings, `t(key, ...args)` creates current-language copy,
and `translate(value)` presents existing catalogue labels and stored notices.
Use `tForLanguage(locale, key, ...args)` for explicit-language tool output; never
change global language merely to format a string. Fixed English captions on
bilingual signs use `printed_*` catalogue keys with the same value in both locales.
React views subscribe with `app/i18n.ts`'s `useLanguage()` so open panels and
errors change immediately. Keep locale out of station saves and worker state;
switching it must preserve edits, undo history, drafts and the simulation.

`https://stationdesigner.com/game/en/` (including the bare `/game/en`) opens the
English game; `/game/` is Chinese. The demo links keep the same pin —
`/game/en/zoo` opens the zoo in English. The
`IoLanguageSharp` button beside restart switches either route; each route keeps
its preference in local storage. Worker, Vite preview and `tools/preview.mjs`
must resolve the English document's relative assets. Locale changes refresh
rendered copy and the retained TV/map plate caches, without resetting the camera.

English station-name fields are **Primary name / Secondary name**; sign-text
fields are **Primary text / Secondary text**. These describe the existing first
and second fields: do not swap, translate or rewrite their authored contents.
Chinese mode keeps 中文 / 英文 labels. Both text boxes allow 24 characters
(`SIGN_TEXT_MAX` / `SIGN_TEXT_EN_MAX`, pinned in `game/test/sign.test.mjs`).

Inspect translated UI at desktop widths in both locales. Clock/status rows and
long control labels must wrap within their panels; SVG axis text must fit inside
the viewBox with enough gutter for English units and counts. Do not hide overflow
to disguise chopped labels. `test/i18n.test.mjs` covers catalogue/interpolation,
live notices, canonical labels and English route assets; check layout in a browser.

### Placement is one verdict, asked twice

`sim/placement.ts` holds the rules (`blockReason` — may a block be laid here,
answering `opening` / `equipment` / `track` and naming the piece in the way;
`equipmentReason` — may this module stand here) and `build/validation.ts` gathers
a whole preview's worth of them (`checkBlockCells` / `checkModulePlacements` →
accepted cells, refused cells, offending pieces). So the red ghost, the refusal
notice and the release all read one answer, and `moveDropReason` is that verdict
in words. **Never inline a placement rule in a tool**: add it to the verdict and
both the preview and the release get it. `game/test/validation.test.mjs` pins the
agreement cell for cell. Refusals name the offending piece (`被闸机挡住了` via
`blockerLabels`), and no failed press or release stays silent — a held cell the
preview skips reads blue under the cursor, so the release toasts it instead.

The same rule governs a piece's **own orientation**: `autofaceWallMount`'s search
asks `wallMountMissing` for each of the four directions rather than testing "is a
solid cell over there" itself, so the turn it picks is a turn the release accepts.
A looser second test chose a direction backed by a 半墙 facing away and refused
the panel on release — the ghost and the click disagreeing about the same wall.

Two grade-level traps this rule has already paid for, at `z = 0` where a `solid`
and its dug `void` share one coordinate: `addWalls` must fill a `void` back by
*replacing* the record exactly as `addCells` / `addFloor` do (its `have` set is
solids-only), or the ghost promises a 半墙 / 三角 the release drops; and a delete
commit is gated on `sameCells`, never on `cells.length`, or a dug-out block can
never be dug again.

## The sim

Start points: the street plane, the graph, the fare line and the edge cost are
the four rules most changes trip over.

* **The street is an infinite plane, and it is stored inverted** (`sim/ground.ts`,
  §4.1). At `z = 0` **absence means solid ground**: the document holds a
  `{ fill: 'void' }` record only where somebody dug through it, and nothing
  anywhere else. An opening the *game* cut — a ramp's carved corridor, an exit's
  floor — needs no record at all, because `rampOpeningAt` / `exitFloorAt` derive
  it. So an empty document is a station standing on built ground (`emptyStation()`
  ships `cells: []`, and `buildGraph` gives the origin a node), and no save carries
  the horizon. `withGround(cells, modules, margin)` materialises one bounded window
  — the content's plan rectangle plus `GROUND_MARGIN` (16 m), a run's own
  `from`/`to` included — for the two consumers that walk every cell, the walk graph
  and the chunk mesher, so what is drawn is what is walked; everything else asks
  `solidAt` / `virtualSolidAt` / `groundHoleAt` in O(1) and never generates a cell.
  Derived holes are enumerated by run (`rampOpeningsInWindow` over each run's own
  bounding box, same `intrudes` predicate — never `rampOpeningAt` per street cell,
  which cost O(window × runs) on every commit), and the viewport hands its
  effective list into `setStation`/`prepareStation`, so one commit materialises the
  window once on the main thread (the worker's graph builds its own).
  The generated cells wear **`zone: 'outside'` (站外)** and no finish, and that is
  load-bearing rather than cosmetic: `outside`↔`unpaid` is not a fare crossing
  (`crossingDir`), so the plane never invents an ungated fare line around an unpaid
  concourse, while a painted `paid` patch still needs a gate. The live solid set the
  tools read (`app/Viewport.tsx` → `ToolContext.solids`) is the **effective** list,
  or the plane is real to the crowd and the mesher and invisible to the pointer. A
  dig is the one edit that writes the plane — `removeCells` records the `void` at
  grade and nowhere else. `addCells` fills a dug hole by clearing the `void` and
  returning to implicit ground; it must not leave a redundant plain `solid` at
  `z = 0` in the document/save. `addFloor` replaces the hole with its tagged
  `auto-floor` record, which is meaningful authored structure. Both count
  **blocks** rather than records;
  the 材质 brush materialises the pavement it paints, refused by the same
  `blockReason` the 方块 brush asks and refused outright on a `void`, because a hole
  is not a surface. Two things deliberately stay on the **document's** cells:
  `build/model/Floors.ts`'s 生成墙壁 ring at grade (the plane is one continuous
  floor, so a patch drawn on virgin ground has no outer edge to wall — and
  `BlockTool` hands `addFloor` the preview's own `acceptedCells`, so the release
  lays what the ghost drew) and `build/rail.ts`'s platform-edge derivation (the
  open street beside a track bed is not a platform). `ground.test.mjs` pins both
  halves and default-ground re-add; `save.test.mjs` pins custom finish/zone round trips
  and the absence of default ground from saves; `ground-visibility.test.mjs` pins the window as its own mesh pass and the
  隐藏地面 tile that takes it away whole.
* **Time base.** `SIM_SECONDS_PER_TICK = 1.0`; 1× runs one tick per real second, so
  the crowd walks at true speed. Fast-forward multiplies ticks per second, never the
  step, so determinism is untouched.
* **Determinism.** `seed + tick ⇒ byte-identical crowd`. All randomness draws from
  the single `Rng` in a fixed iteration order. Never add `Math.random`, `Date.now`,
  or unordered iteration into `sim/`.
* **Graph** (`sim/station.ts`). Every walkable cell is a node (a solid cell with
  nothing solid above it and floor speed > 0). Fixed-length vertical equipment —
  escalator, each stair flight — is a capacity-limited edge with a server; a lift is
  one car whose every ordered pair of stops is an edge; a **自动步道** is the same
  capacity edge laid flat (kind `walkway`, step-free, its belt's interior cells left
  out of the nodes); gates, doors and stops are
  servers too. CSR adjacency; A* with a `(from|to|needsClass)` path cache, a per-tick
  re-path budget, and live queue wait folded into edge cost. `PathFinder.search()`
  bypasses the cache for the fare-line gate choice, which must see queues as they are
  now.
* **A barrier belongs to a storey.** `buildGraph(data, zoneBarriers)` refuses a walk
  edge at an exit head-house and at a ramp balustrade — and both are **planes in
  plan**, so each carries the block levels its own body occupies and a walk edge
  outside them is free. Without that a head-house walls every floor beneath it and a
  run's glass walls the floors it never reaches: on the 动物园 demo that cut the floor
  into 73 walk-only islands and left **one** platform→exit route for the whole
  station, with 12 of its 30 ramps carrying nobody. `wayfinding.test.mjs` pins both
  directions.
* **The fare line is off by default.** A cell with no `zone` reads **`none` —
  无分区** (`DEFAULT_ZONE`, `zoneOf` in `sim/zones.ts`), which sits on the *unpaid*
  side of the line (`isUnpaidZone('none')`) without pretending to be a fare zone the
  game picked. So sparse zone paint invents ungated fare lines wherever a painted
  patch sits in unpainted floor, and they once sealed a platform's escalators into
  6-cell pockets behind one narrow stair. `ZONE_LINES_BLOCK` is therefore **false**: a
  zone line does not block, and a gate is a queue the crowd may walk around. Put it
  back with that constant, or per station — `buildGraph(data, true)` /
  `new World(data, seed, { zoneBarriers: true })`, which is how `zones`, `gates` and
  `wayfinding` keep §4.5's rule covered in both modes. A zone is painted on **floor**
  (`isFloorCell`: solid, top face exposed, a walkable finish or a track bed at the
  foot of its column), synthetic track-bed tiles follow the module's actual rotated
  footprint via `sim/track.ts` `trackCells` (never an unrotated `w × d` rectangle),
  and the 分区图 draws the storey being edited (`zoneMapFloorsAt`),
  and the folder's sixth tile is 无分区 as the *eraser* (`eraseZoneCells`,
  `isEraseBrush`) — see `zonetool.test.mjs`. Right-click in the 分区 tool temporarily uses that
  same eraser for floor taps and drags, without changing the armed brush or demolishing floor;
  right-click still removes a booth counter module. Preserve the initiating pointer button in
  `ZoneDragState` so shared viewport cancellation, release routing and early native `contextmenu`
  leave right-button erase drags intact. 商店 / 厕所 / 办公室 are ordinary room-purpose
  paint labels in `ZONE_PAINT_LIST`: they tint the same walkable floor path as fare zones, retain
  their existing room-type tile icons, preserve `Cell.zone` for fare logic, and create no room
  modules or walls. `zones.test.mjs`, `zonetool.test.mjs` and `rail-families.test.mjs` pin the
  map, click and palette behavior.
* **Only a gate may cross the fare line** (`sim/zones.ts`), if the gate's policy
  permits that direction. A same-side relabelling (`outside`↔`unpaid`,
  `paid`↔`platform`) is not a crossing at all: `crossingDir` returns 0, so
  `buildGraph` skips the gate check and the floor stays continuous. A two-way gate is
  a single lane: first come fixes the direction until that side drains
  (`sim/gates.ts`).
* **The edge cost is §7.2's, and every term of it is load-bearing.** Arriving at a
  node costs the edge plus `waitQ` there, plus **the crowd** (`PathFinder.congestion`):
  `World.priceCongestion` scatters every standing body into its own collision cell
  *and the ring around it* — the speed derate's own density field is filled only where
  bodies stand, which is the wrong way round for pricing the crowd beside a gate — and
  writes `min(bodies, CONGESTION_CAP) × CONGESTION_S` seconds per node once a tick,
  before any search runs, so a budgeted re-path, a fare-line choice and the 选择 tool's
  preview all price the same station. A lift edge additionally carries
  `liftPenalty(needs)` (§7.2's `levelPenalty`): 0 for a step-free passenger,
  `LIFT_AVOID_LUGGAGE_S` with luggage, `LIFT_AVOID_S` for anyone who could have
  walked — a **preference, not a ban**, so a jammed ramp or a shaft with no
  alternative still hands them the lift. `chooseGate` re-plans a leg the moment a gate
  is within `GATE_LOOKAHEAD` (rationed by `GATE_REPLAN_PER_TICK`, because it skips the
  cache — at the gate's own cell included, so a wave arriving together spreads its
  choices over ticks) and `World.reRouteAroundQueue` is §7.2's patience trigger for a
  gate or lift queue (rationed by `REROUTE_REPLAN_PER_TICK`), moving an agent **only**
  when the new route queues at a different server.
* **The crowd level is one station-wide average** (`World.computeMetrics`, §7.3).
  The status bar's 平均拥挤等级 is the people *standing in the station* over
  `StationGraph.stationArea` — the graph's own walkable floor, one node per square
  metre, with the street plane (站外) **excluded**: the generated ground covers the
  whole window, so a reading divided by it would never leave LOS A. Nobody aboard a
  consist is standing on the floor under its car, so riders are on neither side, and
  an empty station reads A. The same pass still fills `nodePop`, which the heat
  overlay reads — do not drop it when touching the metric. A per-platform letter, if
  §9.3's 高峰预警 needs one, comes from `platforms[].cells` plus that per-node
  `density` buffer. This replaced a per-node *worst* letter whose scan was seeded at
  E, so a station with nobody in it read `E 非常拥挤`.
* **The worker** (`sim/worker.ts`, `sim/protocol.ts`) is the only sim code that
  touches `postMessage`. Messages in: `init` / `build` / `control` / `restart` /
  `seek`; out: `ready` (graph) / `state` (agent `Float32Array`s, metrics, density,
  train poses, the `trainServices` timetable forecast, `intervalMs`, and the run's
  record — see the 数据 window bullet). Payloads are copied, not transferred; the renderer
  interpolates over `intervalMs`. Each tick is synchronous. `build` is a live edit:
  it calls `World.rebuild()` and keeps the crowd. A station switch (打开 / 新建 /
  示例车站) re-sends `init`, which calls `World.load()` — a full reset of agents,
  trains, queues, clock and RNG — so no old passenger walks the new document.
  `restart` calls `World.restart()`: it empties every agent, train and queue and
  reseeds the RNG, but keeps the document and the clock (the top bar's 重启仿真 button).
  The tick loop carries a **`dirty` flag**: while paused the station can still change,
  so every mutating message sets it and `run` posts at once — but a paused tick that
  changed nothing returns immediately instead of building and cloning a full ~150 KB
  snapshot four times a second for data already on screen.
* **A 闸机 is either a lane or a fence** (`sim/gates.ts`, §5.2). `cfg.door` is `lane`
  (default) or `fence`, toggled on the rail with **Tab**; `gateDoorOf` also reads the
  spellings an older save may carry (`right` / `left` → lane, `none` → fence). The
  machine body is always built on the cell's local −x half with its lane — and the
  sliding leaf — on the other; **`R` turns the piece**, so which hand the lane is on
  is not a setting at all (`gateMachineSide` is just that half turned by `rot`, and
  `gateSolidFaces` says which neighbour a 围栏 run may butt into). `fence` is the
  **doorless** machine: the same body with fence on the lane's half (drawn by
  `drawFence`, the shared fence geometry), and `buildGraph` gives it no node and no
  server, so it blocks its cell and crosses no fare line — the piece for finishing a
  run. `buildGate` (`render/models/`) is the 广州地铁 photo gate in two housings:
  the default old one is a 1020 mm machine with a 0.80 m shoulder and a head cut
  short at the reference shoulder angle (its crown lands wider and lower, via
  `prism`), a stainless body, a navy head carrying the small tilted screen, the
  round reader, the small QR window and the small lane lights, a black fascia with
  a single **up** green arrow, and opaque red leaves (their own enamel material —
  the kit's shared `gateRed` stays translucent for the fittings that borrow it);
  `gate-new` is the modern rounded stainless housing with the blue belt.
* **Fences are barriers too** (`sim/fences.ts`, 围栏 §5.2). A fence is a 1 m thin
  panel through its cell's middle and its cell is not a walkable node, so a dragged
  run plus the gate row it plugs into divides the floor into areas the crowd only
  crosses at a gate. The renderer builds every panel from its neighbours (`fenceArms`),
  so a straight run is continuous, a dead end caps itself, and an L / T / + turns
  through the shared centre post with no overhang. A gate neighbour counts only on its
  machine side (`gateSolidFaces`), and `railLandingAt` also treats a stair/escalator
  landing as a neighbour — read through `escalatorLandings`, so both landing columns
  of a wide escalator count, and through each stair flight's full-width landing lanes,
  including a turned final flight whose axis differs from the module rotation. A fence
  beside any of those lanes butts up to the handrail instead of keeping an end cap.
  A 楼梯块 is a stepped floor tile without a handrail; `railLandingAt` skips it so an adjacent
  fence stays capped rather than snapping into it. Pin this beside the ramp landing cases in
  `game/test/fence.test.mjs`.
  A 楼梯块 drag is a straight row across its rotated width axis, so adjacent blocks widen the
  stair; ignore pointer movement along the treads. Keep its preview and release footprint aligned
  in `game/test/roof-tool.test.mjs`; roof plates remain rectangular.
  A run reserves exactly the tile it stands in, so the cell beside it is free ground
  and `placementBlocked` needs no exemption for that pair (only a single piece wider
  than a cell — an old 1.6 m stair — reaches its neighbour
  at all). A run met by **flat** equipment is measured by the body it draws
  (`collisionBoxes` → `openings.ts` `rampBodyBoxes`) instead of by that reservation:
  one box per tile, cut to the slope *at* that tile, and a stair's treads stop half a
  landing cell short of each landing (`stairTreadTrim`). So a stair's landing tiles and
  any slab the flight merely climbs *underneath* are free ground — a 围栏, a 闸机 or a
  bench stands at the head of a well or over the low half of a flight, which is how the
  demo guards each of its platform stairs — while two runs still meet on the full
  envelope and can never share a landing. A **narrow** escalator is the exception: its truss,
  step band and balustrades run landing centre to landing centre, so every tile of its
  run, landings included, is its own. A **wide** escalator (`cfg.width: 2`, the 宽 tile)
  is one continuous two-block band with rails on its outer edges only — no centre rail —
  and reserves exactly two blocks across (`escalators.test.mjs` pins the envelope in all
  rotations and directions). Its step band runs the incline plus a flat at each end
  (`ESCALATOR_FLAT_LENGTH`, comb plates and a landing deck of its own), its steps level
  through `escalatorStepHeight` while risers collapse on the flats (`rollEscalator`), its
  two glass balustrades each form one continuous pane: their rounded end caps fill the
  half-round gaps beneath the handrail returns (`module-build.test.mjs` checks both ends,
  widths, rotations and directions). Its four newels carry entry-arrow / stop-bar lights
  (`EscalatorIndicatorModel`), and flush
  neighbours share stainless infill caps (`RampJoinModel`, `ramp-join.test.mjs`). The
  piece draws its own body (`SlopeCut.ownBody`), so the mesher derives no filling under
  one — `ramp-fill.test.mjs` keeps the mesher's band honest against the real truss. A run
  that lands inside a covered exit rides +0.25 m (`exitLandingHeight`, the head-house
  plinth; the graph stays on the storey). A run comes in **length families**
  (`sim/rampLengths.ts`): one floor is 超短 2 m / 短 3 m / 中 4 m / 长 5 m for the 扶梯 and
  every staircase, a **staircase adds 超长 6 m** (one metre above 长, for uneven floors;
  a 单层 扶梯 stops at 长 because six metres of its climb is the 双层 超短 piece), and the
  escalator's 双层 family is 超短 6 m / 短 7 m / 中 8 m / 长 9 m / 超长 10 m.
  A fresh piece defaults to 长 / 超长 on the five-metre grid (`defaultRampLength`).
  Length is read off the endpoints (`escalatorLength` / `stairLengthOf`, no `cfg` flag);
  the one-floor setting is shared with every staircase so a bank is picked once — a
  staircase's armed 超长 resolves to 长 on the 扶梯 beside it (`rampLengthSpec`'s family
  fallback), and the rail marks the rung the piece will really build.
  The seam cap between two facing handrails forms only where the **endpoints** line up — the
  five-metre 30° escalator is a cell longer than the stair of the same length — and the exit-bay
  snap descends the piece's *own* length (`escalator-length.test.mjs`, `ramp-join.test.mjs`). A fence *on* a landing is read the same way as
  one beside it: the fence cell is not a walkable node, so that flight drops out of the
  walk graph and fencing the head of a stair really closes it off.
* **A 自动步道 (moving walkway, `sim/walkways.ts`, §5.1) is the 扶梯's level twin.** It
  reuses the escalator's body, glass and one-way ride, laid flat: `walkwayModule` builds a
  zero-rise run at `cfg.width` 1 (窄) or 2 (宽) and `cfg.dir` up/down — the width and direction
  tabs are the **shared** `escalatorWide` / `escalatorDir`, the length is its own three
  (`WALKWAY_LENGTHS`, 短 30 m / 中 60 m / 长 90 m, `WALKWAY_LENGTH_DEFAULT = 'short'`, cycled by
  `cycleWalkwayLength`). `WalkwayModel` calls the escalator's exported `buildRampBand`, so the two
  are one drawing. It sits under 设备 beside the 扶梯 / 电梯. Two contracts differ from the
  escalator: it **carves nothing** (excluded from `openings.ts`'s `rampList`), so it is a plain
  `addEquipment` append whose every belt cell — both lanes of a wide piece — must already have
  floor (`moduleFloorOk` reads `walkwayCoveredCells`, not just the landings), and it is **ends
  only**: `walkwayCoveredCells` are dropped from the crowd-graph nodes, so the only way across the
  belt is to ride it. The ride is a capacity edge of kind `walkway` (`KIND_WALKWAY`), `ride =
  dist / WALKWAY_SPEED` with `WALKWAY_SPEED = WALK_SPEED + 0.5` (1.84 m/s), width-2 doubling the
  rate. Unlike `stair`/`escalator`, `walkway` is **not** banned for a step-free passenger. A
  level run has no z to order its endpoints by, so `escalatorRun` breaks the tie on the plan
  (x then y) — that is what keeps a wide belt's centring shift the same whichever way it travels
  (`walkways.test.mjs` pins the lengths, the level centring, the ends-only routing, the doubled
  wide rate, the no-carve placement and the shared flat model). There is **no exit-bay snap** and
  no `RampJoinModel` seam (a level bank's glass meets with no infill).
* **A stair has three sizes** (`sim/stairs.ts`, §5.1) — and every staircase but the 楼梯块 has a
  **length** as well, the staircase's own five-rung family (`sim/rampLengths.ts`): 超短 2 m /
  短 3 m / 中 4 m / 长 5 m / 超长 6 m, cycled on the action tile beside the size (**Shift+Tab**)
  and carried into `stairFlightsFor`. A straight stair climbs it in one flight; a **turning** stair
  splits it into two flights with its platform at **half the rise** (1 m for 超短, 3 m for 超长). The setting
  is **shared** with the 扶梯 — one armed one-floor length for both, resolved into each family — so
  a bank is picked once; the
  seam between two runs fills only when their endpoints line up (see the escalator note above). Only
  a 楼梯块 has no run and grows
  no length tile. Tab cycles 窄 / 中 / 宽
  Straight catalogue pieces retain their stored palette width, but `stairTreadWidth`
  resolves their actual treads to 0.79 / 1.79 / 2.79 m so the two outer rails fill
  exactly 1 / 2 / 3 blocks, including saved stairs. Every **turning** shape stores that
  block-wide run directly (`stairBuildWidth`): a 双跑楼梯's flush pair shares the rule,
  and a 90° turn's two perpendicular legs each move half a block across **their own** run
  (`stairFlightSlides`), so the corner block is the first lane of both; its quarter-landing is
  the `lanes × lanes` square the two meet on, and the departing leg starts on that square's far
  edge (`stairQuarterTurnOffset`, so its treads begin where the platform ends —
  `stairQuarterTurnCells` / `stairQuarterTurnShape`). Rendering, carve, collision and
  graph barriers share this width and `stairFlightSlides`' straight-flight offset;
  do not add a renderer-only offset. Custom widths retain their authored dimensions.
  (`STAIR_WIDTH_LABELS`, `stairWidthLabel`); straight stairs place one standalone module
  whose width is one, two or three `ESCALATOR_BAND` lanes. The renderer keeps the hovered
  block as the near-side lane and shifts a new 中 / 宽 straight flight by half a block per
  extra lane along `stairRight`, so its footprint sits beside the anchor instead of
  straddling the anchor's centre. `stairWallSides` receives that same translated band, so
  walls are read beside the drawn flight. Narrow stairs and legacy off-grid widths such as
  1.6 m keep their original centre line. Old saves made from separate narrow lanes remain
  supported: neighbouring lanes **join their steps**, and lanes with the same legacy
  `cfg.flight` token drop their shared rail and graph barrier; separately placed stairs
  keep their own. A side a **wall hugs from bottom to top** (`stairWallSides(...)`) loses its
  handrail, rail posts and newel return the same way — the wall is the barrier there — but
  keeps its stringer; the wall must
  run the flight's whole length at the flight's own heights, or the rail stays. The
  stringer and the soffit are **trimmed by `thickness · tan θ`** so their square-cut
  lower corners end on the treads' edge; the handrail keeps the full incline, because it
  is in the air. Two 0.7 m stairs dropped separately keep both of their own railings,
  with their steps meeting between them; a lane against an *escalator* keeps its
  balustrade and does not reach under it. The hover ghost is built with its own pieces in
  the context (`setModulePreview`), so a wide stair previews as the one flight it will
  be. A **turning** stair is one piece — its flights turn, so its landings cannot be
  shared lane by lane — and needs a bay of its own at 中 / 宽. The two **switchbacks**
  (`stair-right180` / `stair-left180`, 右 / 左双跑楼梯) lay that return flight one
  **block** across per lane (`stairSwitchbackOffset`) and are built a block wide each —
  `stairSwitchbackRunWidth(size)` = the blocks a run fills less its two balustrades
  (0.79 / 1.79 / 2.79 m, stored in `cfg.width` by `stairBuildWidth`), because the flush
  pair's *treads* have to land on the block grid, not on a lane count. **Both** bands
  then move half a block (a whole block at three lanes) onto it (`stairFlightSlides`) and
  the return run closes any remaining well (`stairReturnSlide`) — an older, off-grid
  width (`stairOnBlockGrid` false) keeps its band where it was. The paths stay on the
  grid, so the half-landing is the row of **blocks** the pair covers; what moves is the
  band, never the walk. The piece claims a whole number of blocks across, two per run —
  2 / 4 / 6 at 窄 / 中 / 宽. The landing's **platform** is one block deep
  (`stairLandingShape`), and its own balustrade follows the same rule per edge
  (`stairLandingWalls`) — the two long sides of a 双跑楼梯 in a stairwell lose their
  railings too. The two **90° turns** (`stair-right90` / `stair-left90`) are the same
  width rule read on perpendicular legs: each band is slid across **its own** run (so a
  corner block is the first lane of both, and the two hands mirror), and their
  quarter-landing is the `lanes × lanes` **square** those legs meet on — 2 × 2 at 中, 3 × 3
  at 宽, the single corner cell at 窄 — with the departing leg laid on that square's far
  edge (`stairQuarterTurnOffset`) so its treads begin where the platform ends and no step,
  body box or wall stands over a landing cell (`stairQuarterTurnCells` /
  `stairQuarterTurnShape`; both are read from the piece's own flights, so a save from
  before the square keeps the landing it laid). Anything that measures a flight's body (the carve, `rampBodyBoxes`,
  `rampSlopeCuts`, the envelope, `rampWalls`, `stairWallSides`, `stairTurnCells`) has to
  read `stairFlightSlides`. The two hands are two pieces, not one turned: **R** rotates
  the whole stair about its base and never swaps the hand. A 180° turn lands on a **row**
  and a 90° turn on its square, never one shared cell, so the crowd has to walk it: `sim/station.ts` cuts each flight's
  balustrade wall off at the flight end that meets an interior landing
  (`stairTurnConnectors`), because the 0.6 m over-run an outer landing keeps would seal
  the landing's own cells apart and leave the two flights disconnected. The three forward
  variants (`leftForward`, `centerForward`, `rightForward`, 左 / 中 / 右直跑楼梯) place the
  upper flight three cells farther along the same heading, shifted left, centred or shifted
  right across the intermediate landing. They still climb one storey through two walkable
  flights; `stairs.test.mjs` checks every size and rotation in both travel directions, and
  `module-build.test.mjs` checks both rendered flights and the landing. A stair's
  **walking surface is a finish of its own** (`stair.cfg.finish`, 材质): its treads,
  risers and half-landing platform are one material, chosen by the floor it climbs from
  unless the player painted the piece (`paintStairSurface`), and that finish reaches the
  ground under the run, since the cut's cap is the piece's own surface. A turning stair's
  interior landing is the **stair's** own platform — one corner cell at 窄, the whole
  `lanes × lanes` square at 中 / 宽, a row for a 180. The model draws it as a 0.5 m slab at half
  the stair's rise, `buildGraph` walks every landing cell as a **virtual** node, and
  `addEquipment` lays no cell there; a legacy save's landing block is still cleaned up by
  `removeModule` with the piece. Those own cells are why a 移动 of a 楼梯 or a 扶梯 is a
  **tear-down and a rebuild** (`moveRebuilds` → `moveEquipment`) rather than a translation, and
  why `movedModule` re-lays the run's own `from`/`to` and flights.
* **A lift is one car per shaft** (`sim/lifts.ts`, 电梯 §5.1). The piece is a 2 × 2 m
  assembly with a 1.5 m carriage and **one story** — the 层高 tile's 超短 3 m / 短 4 m /
  中 5 m (default) / 长 6 m / 超长 7 m, named by the rung alone (the mark carries the size);
  hovering its upper/lower half stacks another story
  at the currently armed size, so one shaft can serve uneven floors. Find the shaft with
  `liftAt` (its own 2 × 2 column), never a generic `moduleAt`: a canopy roof or a run
  envelope can cover the cell without occupying the shaft and win the document-order
  lookup, so the snap silently never fires. The shaft's retained meshes stay in
  `liftPickMeshes`, and `CameraSystem.pick` enables the equipment batch source layer or
  the upper shaft (above the cabin and door leaves) stops answering the pointer
  (`lift-extension.test.mjs`). A story serves the
  **level at its base**: the level's door and the cabin's headroom live in the story above,
  so the top of the last story is a **cap**, not a landing. A fresh 5 m piece is one level
  (the floor it was dropped on); stacking a 3 m story adds the level at 5 m and moves the
  cap to 8 m. `liftLevels` is the stop list and the door chooser's rows (one per story);
  `liftStops` is the story boundaries used by the model's glass/wall segments.
  The piece stores each segment rise (`cfg.rises`), because a mixed shaft's levels are not
  evenly spaced; omitted segment metadata defaults to the fixed five-metre interval. The drawn shaft is
  **exactly the stacked stories** — a 5 m piece is 5 m from the base floor's surface to the
  cap — closed by a cap at each end; extending removes the shared middle cap and moves the
  caps to the total ends (`module-build.test.mjs` pins both). A
  fresh piece must stand on all four of its footprint cells, but
  extending never checks for floor, so a shaft may run past a floorless level (it simply
  has no landing there). `buildGraph` makes the walkable floor tile in front of the cabin
  door (`liftLandingCells`, turned by the piece's `rot`) at every **level** and
  gives the single `lift` server an edge between every ordered pair, so a rider goes
  straight to their floor. The whole 2 × 2 footprint is cabin interior and is never a
  walkable node, so the crowd boards and alights only through the door the model draws.
  The car is a real state machine (`World.stepLift`: park → open → dwell → close → move,
  eased), and riders are `STATE_RIDING` pinned inside the cabin by `stepLiftRide`, so
  they visibly move with it; `World.liftRenderState` sends one car pose per snapshot.
  The shaft comes in two housings (`cfg.style`, now **Shift+Tab**; Tab is the interval): glass is
  the default —
  corner posts, panel bays, guide rails and a glazed cabin — and steel keeps the old
  enclosed shaft; both keep the animated-car contract and survive extending and saving
  (`lift-style.test.mjs`, `lift-interval.test.mjs`).
* **Finishes** (`sim/finishes.ts`): the *family* decides behaviour (floor walk speed,
  track bed not walkable, wall blocks), the finish decides look. The renderer reads the
  same table, so a surface cannot look like one thing and behave like another.
* **Placement** (`sim/placement.ts`): every module has a world footprint
  (`moduleEnvelope`); `placementBlocked` refuses overlaps with strict box tests (adjacent
  cells are fine), except that a stair/escalator may pass through an exit head-house and
  room furniture (a shelf / desk / cubicle / sink / bench / bin / 灭火器箱) may stand
  inside a walled room or booth. A 广告牌 is *wall-mounted*: `wallMountMissing` refuses it
  unless the facing neighbour — turned by the placement rotation via `wallSide` — has a
  solid block at its first course (`z + 1`), and a two-cell banner needs a wall behind
  every cell of its run (`billboardCells`). `wallMountStandCell` stands the panel on the
  hovered floor, or on the face-adjacent cell when the pointer is on a wall itself —
  dropped to that wall's own storey floor (`storeyBand(z, levelBase)`, the station's
  **基准高度**, never the unshifted 0 / 4 / 8 grid) — so an ad can bolt to the
  station wall across the track where there is no floor in front of it. **A side face is a
  wall whatever the block is tagged** (§9.5 "side face = wall-mounted"): a wall raised with
  the 方块 brush carries no `wall` tag, and treating that hover as "not a wall" stood the
  panel *inside* the block, free to hug either neighbour. **Which of two walls** the panel
  hangs on is the **camera's** answer (`autofaceWallMount` ranks by the aim `pickFacing`
  reports), because the pointer cannot answer it — a hovered wall face puts the hit anywhere
  along it; the carried turn, the pointer then the rotation order settle a view that cannot
  tell them apart. The one mount the view may not re-aim is one bolted to a **named piece of
  the document**: a board on a booth header, and a 地面出入口 on the block face the pointer
  clicked (its `cfg.mountZ`). **Which course** of that wall a piece covers is a second question, and the
  玻璃板 answers it differently: it is the one wall piece that is a **band of wall** (its frame starts at
  its cell's floor top and rises its own height), so `wallMountFollowsCourse` sends it to the **course the
  pointer is on** — `wallMountStandCell`'s `followCourse` puts its cell one below the block that was hit,
  so the pane covers that block, while aiming at the wall's first course still lands on the storey floor.
  Only a **wall course** counts (a block with a block over it): a floor slab's own edge keeps the storey
  reading, so the pane is never sunk into a floor, and the pieces drawn at a `panelZ` of their own (广告牌,
  站名, 线网图, the wall 指示牌) keep the storey floor as their anchor — which is what puts a poster at eye
  height wherever on the wall it is aimed. Both tools pass the flag (`EquipmentTool.wallMountPlacement`,
  `MoveController.moveAnchorAt`), so the ghost, a carried piece and the release agree. The **hanging**
  指示牌, the 电视, the 时钟, the 监控, the 灯具 (both tiles) and the 通风口 are instead *ceiling-hung*:
  `hungCeilingAim` takes every one of them to the free cell directly under the **first underside above
  the pointer** — `top block - 1` — wherever on that column the pointer is, so aiming at the block
  below a ceiling, at the slab's own underside or at the floor all land the piece in the same cell
  (`topBlockZ` finds the lowest solid whose own cell below is air, which is what skips a wall's own
  courses; `topBlockOver` says a piece's own cell is such a cell). Its model then hangs it from that
  block at the short drop the piece's own design gives it (`hangCeilingLocal`; a 指示牌 0.65 m of rod, a
  电视 0.85, a 灯具 none at all), so a board hugs the slab it hangs from. `ceilingMountMissing` refuses
  a hung piece with no ceiling over it, and passes one whose own cell has a **top block** over it: the
  block over the cell *is* its ceiling, no storey slab needed. A piece anchored on a floor instead (an
  older save, or a hall whose only ceiling is the street plane) reads the real slab overhead
  (`ceilingMountHeight`), never the fixed 0 / 4 / 8 grid. A 指示牌's **wall** mount is
  the panel rule again rather than this one: one piece, two palette tiles
  (`sign-ceiling` / `sign-wall`), and the mount lives in `cfg.mount` (`SignMount`,
  `sim/sign.ts`) so `isWallMounted` / `isCeilingHung` / `wallMountCourses` ask the module.
  A stair requires pre-existing ground only at its foot (`moduleFloorOk`); do not require
  ground at upper or turn landings. Keep the full footprint for collision and ownership.
  `placement.test.mjs` pins this for every stair shape, width and rotation, including refusal
  when the foot itself has no ground.
  Either way the ghost is the piece itself and no floor cell is highlighted with it
  (`setCursor(null)` in the equipment, select, delete and move previews;
  `test/wall-ceiling-snap.test.mjs`). A 2 m bench is a real two-cell run (`benchCells`).
  `carveRampOpenings` (`sim/openings.ts`) opens the slab a ramp climbs through while
  keeping its landings as graph nodes — but only the cells the run's **centreline**
  crosses (`RAMP_CORE_HALF`). Every other block the body or handrail reaches is kept and
  marked by `rampThinCells`, and the **mesher** draws it a half block thick on the side
  away from the run — the same path a player's own 半墙 takes, so its faces keep their
  finishes and the 材质 brush can paint it (`thinWallCells` is the one list both come
  through). The floor beside a run stays buildable and a railing can sit against a wall; a
  tile-sized run (a stair lane, a narrow escalator) reaches nothing beside it — a width-2
  escalator is two blocks by construction. A **半墙** the
  player laid is skipped: that cell is already a half block thick, and its side is theirs.
  The ground **under** a run: a run's body hangs below its walking line — an escalator's
  truss by `RAMP_FOOT` (0.5 m), a stair's stringers and soffit by `STAIR_BODY_DROP`
  (0.36 m) — and the **line** is the run's own too, so `flightTiles` cuts a stair to the
  line its treads climb. `rampSlopeCuts` derives the volume each 楼梯 / 扶梯 takes out of
  the blocks it climbs over — the same tiles `rampBodyBoxes` reserves, with that body
  depth off the local line — and the mesher (`chunkMesher`'s `slope` map) draws those
  blocks' tops on that plane. A block under a run is therefore floor the 方块 tool lays
  and the carve keeps, and it reads as the filling under the slope. Only the run's own
  centreline column is cut, a landing column never is, and nothing is added to the
  document — the cut is derived, like the half panel beside a wide run. **The last course
  under a truss is the one the brush may not lay**, so the renderer draws the rest of the
  filling: `rampFillKeys` names every cut cell the station holds nothing in that stands on
  solid ground, `SceneRenderer` keeps that set with the cuts (`SceneContext.slopeFills`),
  and `chunkMesher`'s `fill` argument draws each one as if the block below carried on up
  to the truss — shaved by the same cut, solid to its neighbours so the seam is never
  drawn. Where the cut carries the run's drawn body half-width the filling *is* that body,
  in the run's own steel (`RAMP_SOFFIT_FINISH`, 钢板); anywhere else it wears the finish of
  the block below — except the **cap**, which is the run's own surface, so a 楼梯 painted
  with the 材质 brush paints the ground it stands on with it. **No run in the game derives
  a filling any more**: a 扶梯's piece draws its own body (`SlopeCut.ownBody`) and a
  **楼梯** asks for none at all (`SlopeCut.noFill`), because the course a filling would
  stand in under a stair is the run's own carved passage. The `fill` path itself is still
  the mesher's, kept honest by `ramp-fill` / `floor-surface` over hand-made cuts. 钢板 is a
  stock ceiling finish too. **A wedge's top is the one drawn surface in the game that is
  not a cell face**, so the pointer's placement cell is snapped by axis
  (`render/pickCell.ts`) and never `cell + face.normal`. `test/slope-cut.test.mjs` pins the
  cut and the derivation, `test/ramp-fill.test.mjs` the filling through the real chunk
  system, `test/pick-cell.test.mjs` the pick over both.
* **Rails and lines** (`build/rail.ts`, `sim/track.ts`, `sim/placement.ts`,
  `sim/world.ts`). A rail is a `track` module bound to a line and an `up`/`down`
  direction: a fixed, pre-rendered piece — a car-width bed (three cells by default; D stock
  needs four) and a run the length
  of the line's consist (`trackPieceForLine`) — placed like equipment (centred on the
  highlighted cell, so the long run grows evenly both ways) with **R** to quarter-turn it.
  `sim/track.ts` is the one orientation source (`rotateLocal` / `trackCells` / `edgeCells`
  / `trackCentre`), so a rail can run east–west or north–south and the consist, its screen
  doors and the platform services turn with it. Placing one **digs** its bed course, so the
  mesher exposes the platform edge as a half-metre drop and the module supplies the
  recessed slab and rails. Service is one consist per (line, track) (`trainKey`,
  `World.serviceTracks`): an 上行/下行 pair runs a train each, and each boards only at the
  screen doors derived from its own rail (`doorsByTrack` via `cfg.from`). Tunnel runs are
  extensions, not berths — unless the line owns nothing else — and a line with no rails at
  all keeps one line-level train serving the whole line. `derivePlatformEdges` generates
  one `platform-edge` per contiguous run of walkable exposed floor beside the bed (an
  island platform yields two — the Spanish solution), and `regenerateRailEdges` re-derives
  them after the floor changes. Every derived edge records which side the track lies on
  (`cfg.side`, shared by the derive, the renderer and `World.computeLineAnchors`), so the
  printed header always faces the platform, never the rail. The selected platform's 信息栏
  refresh action calls `regenRail` for that track id only, resolving a selected screen door
  through its `cfg.from`; the left rail does not expose an all-platform refresh. The pure
  lookup is covered by `line-edit.test.mjs`. The track side also sets the consist's **door-side mask**
  (`LineAnchor.doorSides`, the 10th value of a train pose), and `doorRunOffsets` sets the
  door cadence off the rail, so the train opens only the
  bank that meets screen doors. Editing a line's 车型/编组 re-cuts platform lengths and widens every
  bound tunnel / bridge bed to the consist's required width, preserving their authored run lengths;
  `resizeTrack` rebuilds tunnel shells and bridge supports around the new cross-section. A track bed
  is **either** the `floor.track` finish **or** a `track`
  module's footprint (`trackBedKeys` / `isTrackCell`), so the hand-built demo and placed
  rails agree. The 轨道 folder has two tools, both gated by `trackBlockReason`: any
  interference blocks placement instead of demolishing it. **站台** places the fixed
  consist-length piece, which must rest on solid floor under its whole bed
  (`trackFloorMissing`; at z = 0 the intact virtual street counts, but a saved hole does not) and
  refuses a run with a wall in its headroom
  (`trackClearanceBlocked`); **隧道** extends an existing rail off the end selected by the
  pointer (`makeTunnel` / `placeTunnel`, a pure run flagged `cfg.tunnel` that never spawns
  platform doors). The snap target includes the whole exposed
  platform connected to its screen-door edge, not only the dug rail bed: `railModuleAtPlatform`
  resolves floor and screen-door hits through `platform-edge.cfg.from`, and the hovered cell's
  local run coordinate selects the left or right half/end. **轨道桥** uses the same resolver and
  half selection. Keep preview and click using that same hit coordinate and pin both ends from
  platform/屏蔽门 cells in `game/test/rail.test.mjs`. Bridge input also reads the visible
  module surface once per event (`EquipmentTool.bridgePointerHit`): a dug bed may expose a
  lower floor to the block picker. Project that surface onto its owning bed, retaining
  the hovered half; `equipment-placement-input` pins rail/screen hits above a lower floor and
  ordinary floor hits across the outer platform, every rotation and preview/click agreement. A slider sets the tunnel length. It may hang over void, clears the wall it bores
  through, and raises a side wall + ceiling around itself where missing (`boreTunnel`,
  shell cells tagged `tunnel-shell:<id>`). **轨道桥** (`cfg.bridge`, `makeBridge`) is the
  same extension carried on pillars instead of bored through ground: it needs clearance
  but no floor, derives no platform doors and raises no shell, and
  `pillarSupportsBridge` (`sim/structures.ts`) exempts the pillar under its deck from
  the collision. Tunnel and bridge share the five run lengths
  (`TRACK_RUN_LENGTHS` 4/16/32/64/128, `track-run-length.test.mjs`). The placement ghost draws the run's 上行/下行
  direction as arrows (`buildTrack`; Tab toggles it in platform mode), a tunnel inherits
  its source's direction, and `computeLineAnchors` reads the train's travel sign from
  `cfg.dir`. A 第三轨 conductor rail sits on the travel right in tunnels and bridges —
  local −y for 上行, local +y for 下行, whatever the quarter-turn. A platform rail
  with screens on exactly one side takes the side with no 屏蔽门 so the live rail
  stays off the platform; both sides or neither side fall back to the travel left
  (local +y for 上行, local −y for 下行). Tunnel/bridge placement ignores adjacent
  screens. `thirdRailSide`
  (`sim/track.ts`) is the one side source the `TrackModel` draws from, counting only
  the rail's own edges (`cfg.from`, plus legacy direction-matched edges); keep it and
  `game/test/track-third-rail.test.mjs` aligned when changing 供电 models, edge
  derivation or the travel sign. `station.lines` holds many lines (added in the inspector, `LineCard`); each
  carries stock/cars/headwayProfile and a power mode, and its colour comes from
  `data/line-colours.ts` (real 广州地铁 sign colours by line number). The consist is one of
  the fixed `FORMATION_OPTIONS` 2/3/4/6/8 chips (`sim/headway.ts` snaps, ties down so a
  snapped train never outgrows its platform), and each leg of the headway is a 分/秒 row —
  高峰/平峰/离峰, clamped 60–1200 s with its own 列/时 · 人/时 readout (`HeadwayInput`,
  commit on blur like the line name). Platform-only
  controls (方向, 线路, 重置屏蔽门) show only while placing or editing a platform, not a
  tunnel. `LineDef.upTerminus` / `downTerminus` are the per-direction destinations, and
  every platform screen prints the bound line's terminus for its own `cfg.dir` (falling
  back to 上行/下行). Each line also chooses its 屏蔽门 height (`cfg.psd`, 全高 by default):
  `full` rises 2.95 m above the platform, leaving 5 cm under the ceiling block, with a
  deep signage fascia sized from `PSD_FULL_HEIGHT`,
  openings 1.5× the car-door width (`PSD_FULL_DOOR_WIDTH_SCALE`), and sliding vinyl bands —
  fixed-pane band, door band, warning placard and opening arrow (`PsdDecals.ts`, printed
  canvases registered as door leaves so they slide); `half` is 1.45 m tall, including
  its top cap, with the header on the glass. `psd-end` extensions use those same heights;
  their model bounds and placement envelope must agree, every cap must fit within
  the block height, and both transparent panes need polygon offset so a flush platform
  wall cannot z-fight through them. `psd-end.test.mjs` pins extension clearance and
  `module-build.test.mjs` pins pane depth ordering. Switching re-derives every edge on the line
  (`regenerateRailEdges`), so the model and the collision envelope agree
  (`PSD_FULL_HEIGHT` / `PSD_HALF_HEIGHT`). The header prints the station's own
  `name` / `nameEn`, never a hardcoded terminus.
* **`STOCK_CLASSES` (`['A','B','C','D','L']`) is the single ordering source** (`sim/stock.ts`), so
  the worker's pose index (`indexOf`) and the renderer's decode (`STOCK_CLASSES[stockIdx]`)
  cannot desync, and the inspector's 车型 chips iterate it too. D is the Guangzhou 18/22
  reference stock: 3.3 m wide, 20.1 m per car, eight cars, 1,758 rated / 2,600 crush capacity,
  catenary, 1,435 mm gauge and 160 km/h. Each end car has four doorways; only the one nearest
  each cab uses a single 0.8 m leaf. The other end-car doors and all four middle-car doorways
  use paired 1.4 m leaves. The A/B/C/D/L order is shared by
  worker poses, renderer decode, controls and generated train sheets. L is the 2.8 m wide,
  16.8 m long, three-door, third-rail 广州 4/5/6 stock. `LineDef.stock` is the imported `StockClass`
  (a `stock.ts` → `types.ts` edge that stays inside `sim/`); the save needs no migration,
  because stock is a plain string with no whitelist.
* **Type A side glazing** shares `BTrainWindows.ts`'s smaller inset apertures:
  five doors alternate with four windows per side per car, with painted end bays.
  `draw-batching` pins B-sized glass, clear openings and independent door banks
  in six/eight-car consists in both directions. Keep stock door alignment intact.
* **Type B glazing** uses one `b-cab-windscreen` per cab on the existing generic
  shell. `BTrainWindows.ts` cuts three rounded, rubber-framed passenger apertures
  between four doorways per side per car; end bays stay painted. Door centres and
  platform alignment still come from `stock.ts`. Pin the apertures and both travel
  directions/consist sizes in `draw-batching`; keep authored Low apertures intact.
* **Type C glazing** uses two front panes, one in a fixed evacuation door with
  its own outline and handle. Keep that door behind the emblem and lamp lenses.
  `CTrainWindows.ts` cuts three single large inter-door apertures and small end
  panes; driving-end small panes sit on the cab. Preserve the shared shell,
  `stock.ts` door centres, authored Low apertures and independent door banks.
  `draw-batching` pins four/six-car consists in both directions.
* **Shared bogies for every stock class.** `TrainBogie.ts` builds two two-axle assemblies per car, with machined tyre/flange and dished web profiles, side frames, axle boxes, coil/air suspension, dampers, brakes and a motor/gear case. Meshes remain car siblings for whole-consist batching. The tread contacts `RAIL_HEAD_Z` with the train origin 0.5 m above the track; flange orientation and `RAIL_CENTRE_OFFSET` must match the running rails. Keep the complete assembly below the unchanged 0.50 m cabin-floor underside. `train-bogie` pins every stock, High/Low contact, clearance and disposal; regenerate `train-lod` and both inventory tables after geometry changes.
* **Overhead-wire variants exist for every stock class.** `TrainPose.power` selects
  the catenary roof; absent power keeps legacy callers' third-rail geometry.
  `TrainPantograph.ts` builds a tapered single lower arm, forked upper tubes,
  a twin carbon bow with downturned horns, articulated pivots, tension springs,
  bonding/power leads and four five-shed ceramic insulators. Tiny hardware is
  omitted at Low while the arms, bow and mounts retain authored geometry.
  Keep all hardware below the shared contact plane. It places mirrored collectors at the inward end
  of each cab car (one central collector on a one-car formation). Recessed mounts
  in `TrainModel.ts`/`DTrainShell.ts` keep the raised linkage above the cabin and
  its contact bars at `CONTACT_STRIP_Z`, accounting for the scaled train origin's
  0.3924 m elevation over the track origin. Keep the conductor constants shared with
  `TrackModel.ts`. Catenary contact is 3.903 m above the track anchor in the fixed five-metre profile;
  reserve three clear courses and a ceiling underside at track +4 m for compact rigid rail;
  open platform/bridge gantries reserve four courses for the overhead suspension. Station canopies follow the wire; open platform/bridge portals carry
  lattice crossbeams above sagging messenger spans and droppers.
  `CatenaryModel.ts` owns round contact/return conductors, insulated registration
  arms, and compact flanged rigid rail with crown/wall brackets under slabs.
  Keep contact at `CONTACT_STRIP_Z` in High and Low; `catenary-model` pins
  sag, seams, bore clearance and prepared Low/disposal. Third-rail clearance stays unchanged.
  `build/model/TunnelShell.ts` rebuilds generated shells on line-power changes;
  loading preserves authored cells. The tenth
  worker-pose value packs door banks into bits 0–1 and catenary into bit 2;
  `TrainSystem` masks the door bits and includes power in its cache signature.
  `train-pantograph` covers all classes, inward placement, rotations, contact,
  real roof recesses, independent doors and power-mode cache reuse.
* **Both ends of a train are cabs, and the doors follow the screens.** A/B/C/L `buildTrain`
  (`render/models/`) re-skins the last 2 m of each end car through `buildCab` — the dark face
  mask, centre windscreen and crew-door windows, the 广州地铁 mark (`drawMetroMark`, shared with
  the exit banner), twin round lamp clusters and corner marker bars, the line-coloured front
  lower band, the
  number plates and the coupler — so the body stays exactly `cars × carLength` long, the cab
  stops short of the car's first passenger door, and only the coupler hangs past the nose. D
  uses `DTrainShell.ts` and `StreamlinedCab.ts`: its rounded shared car/head cross-section, swept
  nose, elliptical face livery, central windscreen, clipped trapezoid side panes and lamps, and
  continuous side paint are fitted to one shell. The D cab has no extra crew door; only the
  nearest passenger doorway at each end is single-leaf, while all other doorways are double-leaf.
  Its `d-car-window` panes remain small and inset in the black side band, exactly two between
  each adjacent pair of doorways (six per side per car), with painted end bays. A/B/C/D ends differ
  in their lamps (`headlight` / `taillight`); the two L ends follow the generic cab path. Door
  leaves carry the side they belong to (`registerDoorLeaf`'s `side`), and `setDoorsSides` slides
  the two banks independently. A leaf is a **door, not a hole**: it wears the body's own
  material (`trainBody`), with a window in its upper half, a kick plate at its foot and a rubber
  seal at each jamb of the doorway, so a closed consist reads as having doors in a side elevation
  rather than as a row of black rectangles (the leaf used to be one `trainDark` slab — the value
  of the cabin shadow behind it); `module-build.test.mjs` pins the material and the window. The pose's 10th value (`LineAnchor.doorSides`) says which of them
  may open, so `SceneRenderer.advanceTrainDoors` opens only the bank with screen doors to meet
  and leaves the tunnel-wall side shut. The platform screens themselves open by berth proximity
  (`TrainSystem` matches each `platform-edge` run against the poses of doors-open consists), not
  by line colour, so the two directions — and two stations on one line — move independently.
  The cadence itself is `doorCentres` (`sim/stock.ts`): one uniform pitch per car, held
  `DOOR_END_INSET` (2.8 m) off both car ends and rounded symmetrically about the consist centre,
  so a three-door L car spreads its outer doors to the ends. `doorRunOffsets` projects that list
  onto a rail's run, and it is the single list the model cuts the screen open with *and* the one
  `buildGraph` seats a door server on. `test/trains.test.mjs` pins the platform-side / island /
  no-platform cases and one train per track on a two-direction line; `stock.test.mjs` pins D's
  specs, consist capacities, mixed door counts/widths and classification index, while
  `draw-batching.test.mjs` pins its shell, cab surfaces, windows, livery joins, door geometry and
  motion. L keeps its shell and three-door cadence, with one broad cab windscreen, small side
  windows at the ends and paired wide panes between the doors; `LTrainWindows.ts` authors the
  framed apertures and their Low geometry. `train-lod.test.mjs` pins the full and Low consist
  counts; `train-art-pipeline.test.mjs` checks the bilingual sheets keep all five classes ordered
  and use captured D poses.
* **The crowd's day is four document fields** (`sim/clock.ts`, `sim/demand.ts`,
  `sim/constants.ts`, `sim/world/World.ts`, `build/model/State.ts`, `persistence/save.ts`).
  日期类型 / 营业时间 / 高峰时段 / 客流曲线 are `StationData.service` / `peaks` / `demand` /
  `calendar`, saved per station, repaired per field on load and re-normalized on every
  `rebuild()` (`World.day` + `World.calendar`), so an edit lands through the same path a
  save does. `periodOf(simTime, service, peaks, workday)` checks **shut first** — a station that
  opens at 08:00 is not in its 高峰 at 07:00 — and `DEFAULT_SERVICE` is 06:30–23:30.
  A **非工作日 runs 平峰/离峰 only**: the peak windows do not apply, so an open off-day
  is 平峰 all day and only shut hours and shoulders are 离峰 — dispatcher, TV forecast,
  clock chip and both charts read the same flag. There are **two saved curves**, one set
  of knobs for 工作日 and one for 非工作日 (`DayDemand`: `normalizeDayDemand` repairs each
  leg, and a pre-split file keeps its knobs as the workday curve); the calendar date picks
  which one the spawn and the charts read, so there is no weekend/holiday volume multiplier
  left — the volume lives in the curves. `demandSeries` samples a **uniform grid** so the last point closes
  onto the first for any step. `LOS_LABELS` is the single map both the status bar and the
  时刻 strip print. The knobs span 0–2.5 (peaks) and 0.4–2 (sharpness); a value past its
  slider is repaired by `normalizeDemand`, never refused. **The calendar is the 2026
  holidays** (`DEFAULT_CALENDAR`: 国务院办公厅 国办发明电〔2025〕7号, day 0 =
  2026-01-01) and the day type is **derived, never picked**: `dayTypeOf` reads the holiday
  list, then the weekend — there is no 调休 list, and a file that still carries one has it
  dropped on load. `normalizeCalendar` repairs rather than
  refuses (`02-30` becomes `02-28`), and `normalizePeaks` keeps the peak pair in order —
  早高峰 ends no later than 晚高峰 begins. `monthGrid` lays a Monday-first month of whole
  weeks so the view is pinned by a test, and `simTimeAtDate` turns a picked date plus the
  kept time of day into sim seconds. **The pick is a seek**: `SimSlice.seekToDate` keeps
  the time of day, posts a `seek`, and `World.seek` moves the clock and drops the
  absolute-time dispatch schedule (a backwards scrub would otherwise stall every train)
  while the crowd, queues, trains and counters stay. The chart's boundaries (both
  营业时间 ends, both peaks' on a workday) are grips on the curve itself (`curveBoundaries`: draft on
  move, one undo frame and one rebuild on release, arrow keys nudge-and-commit as one
  step); on an off-day the peak bands and grips stay off. The second chart is the trains'
  own curve (`TrainCurve`, `trainAlightSeries` in `sim/headway.ts`: per-train 下车 over the
  running headway times each line's consists, counted the way `World.serviceTracks`
  dispatches them), read-only on the same bands — a headway or 编组 edit moves it and
  leaves the entrance curve alone. `game/test/clock.test.mjs`, `demand.test.mjs`,
  `headway.test.mjs` and `line-edit.test.mjs` (the store
  half) pin it.
* **The status bar's numbers are also the 数据 window** (`sim/history.ts`,
  `app/windows/charts/`, `app/store/slices/SimSlice.ts`, `statusbar/BottomBar.tsx`, §8.1).
  The left half of the bottom rail is a `div role="button"` (a `button` may only hold
  phrasing content and each 数值 is a block) that opens the floating panel — the 时刻
  window's chrome classes, and like it a non-modal view with a scrim and Escape.
  `World.history` samples the rail's own counters **once a sim minute**; the `state`
  message carries the samples since the last post (empty on 59 ticks out of 60) with
  `historyReset` telling the app to replace rather than append, because only `load`,
  `restart` and `seek` start a different run or day. A sample is the whole reading plus
  the **per-minute change** in 已上车 / 已出站 / 滞留 — a total is unreadable on the same
  axis as a level — and the first sample after a reset records those deltas as a
  baseline, since a seek keeps the counters and the first delta would read as one huge
  minute. Three charts, because they do not share a y axis: 平均拥挤等级 (the class
  axis upside down — **A at the top, F at the bottom**, so the line reads the way the
  letter does), 站内数值, 客流累计 (with its own 累计 / 每分钟 toggle). Each line toggles
  on its own legend chip and a chart's scale follows the lines actually shown.
  `game/test/history.test.mjs` pins the minute, the resets and the store's append.
* **A consist is a cabin the crowd rides in** (`sim/stock.ts`, `sim/agents.ts`,
  `sim/world/World.ts`, `render/models/pieces/TrainModel.ts`,
  `game/test/train-cabin.test.mjs`). The alighting wave is not dumped onto the platform at
  door-open: the whole cohort is **seated in the doorway queues it will leave by once the
  consist has stopped, before its doors open** (`World.loadAlighting` / `seatAlighter`,
  during the doors-shut berth), and the drawn run-in lands its **last** frame on the mark
  (`World.approachProgress`), so the car is already at rest when the wave appears rather
  than still gliding in behind it. `stock.ts` owns the cabin box both sides are cut from (`cabinSlot`,
  `CABIN_FLOOR_Z`, `CABIN_HALF_W`, `CABIN_ROW_PITCH`, `CABIN_MAX_ROWS`,
  `CABIN_ALIGHT_PAIR_S`, `CABIN_ALIGHT_MAX_S`) and `World.cabinWorldPos` uses the
  doorway's own node in the consist's frame, so the sim's slots and the car model cannot
  drift. Riders carry `train` / `trainDoor` / `trainFile` / `trainRow` / `trainPhase` on
  the `Agent`, are pinned by `World.stepTrainRider` to `World.trainAt` (the pose
  `trainRenderState` shares), and are **excluded from the collision pass, the density
  derate, `priceCongestion` and the LOS** while aboard. Boarding is held per doorway until
  that doorway's own queue drains, then `boardRider` seats the boarder behind the wave;
  everybody aboard leaves the world with the consist and a wave that missed its
  `CABIN_ALIGHT_MAX_S` turn is counted in `leftBehind`. An edit that re-cuts a consist's
  doorways sets its riders down (`World.rebuild`, without a left-behind mark — an edit is
  not a failure to serve); one that leaves the doorways alone keeps the wave riding.
* **The 选择 tool's route preview** (`World.routeOf`, `sim/worker.ts`,
  `render/routeLine.ts`, `render/scene/systems/CrowdSystem.ts` `setRoute` / `pickAgent`,
  `app/tools/SelectTool.ts`; tests `agent-route`, `select-agent`, `worker-preview`). One
  passenger's remaining walk is drawn as a ribbon on the walk surface (`writeRouteRibbon`,
  three-free arithmetic, **capped in the writer** — the scene sizes its buffer from
  `ROUTE_MAX_QUADS`, so an over-long polyline must be clamped where it is written), the
  pick is **screen-space** (`pickAgent`, with a 3 px tie window that falls through to
  whichever body stands in front), and the worker echoes the request's token on every frame
  so a stale frame cannot clear the selection it predates. Reading a route is an
  **observation**: it touches no agent field, queue or RNG, its A* searches skip the shared
  path cache, and the worker's `selectAgent` handler builds a frame (`stepping()` false)
  instead of stepping the world. The leg memo (`World.routeTails`) is keyed by agent *and*
  leg and capped (`ROUTE_TAIL_MEMO_MAX`), and `rebuild()` drops it.
* **The 移动 action moves a placed 设备 / 装饰 / 出入口 piece and the two runs**
  (`isMovableModule` / `movedModule` / `moveCandidate` / `moveDropReason` / `moveRebuilds`
  in `sim/placement.ts`, `replaceEquipment` / `moveEquipment`,
  `app/store/slices/MoveSlice.ts`, `app/tools/MoveController.ts`, `test/move.test.mjs`).
  It is deliberately **neither a tool nor a second panel**: the piece is already selected
  (选择), so the way in is the inspector's `信息` card — pressing 移动 there lifts the
  selected piece, and *that same card* becomes the move's whole control surface, with the
  tick and the cross exactly where 移动 was, over the cell the drop would use and the rule a
  refused cell broke. The lift then owns the pointer whatever tool is active, because a
  lift is a state of the *piece*, not a mode. A lift is **not an edit** — the piece keeps
  its id and its whole `cfg` and never leaves the document, so nothing reaches the undo
  stack and 取消 has nothing to restore — and the drop is **one** commit (one `Ctrl+Z`),
  refused by the same rules a fresh placement answers to, asked of a piece that already
  exists so the copy at its origin is never the obstacle. A carried wall panel aims through
  `wallMountStandCell` and a hung fitting through `hungCeilingAim`
  (`MoveController.moveAnchorAt`, reading the placed module's own mount), with the station's
  `levelBase` for the storey and — for a 玻璃板 / 广告牌 / 站名 — the **camera** for which wall it
  hangs on (`moveCandidate`'s `facing`; a 地面出入口 whose turn came from the block under the
  pointer passes none). A doorway exit's `cfg.mountZ` is part of its aim: `MoveSlice.aimMove`
  must refresh when only that course changes, and confirmation must commit the candidate's
  mount height along with its anchor and rotation; otherwise the visible ghost can be legal
  while the drop checks the old course and falsely reports a missing wall. `move.test.mjs`
  pins the Tanwei D exit facing west at `(33,37,4)`, a same-storey course change, live settings,
  and undo/redo. It previews without a floor cursor; the ghost is the highlight. A moved
  rectangular 灯具
  carries its in-cell spot with it (`cycleMoveLightPosition`, Tab; in the ghost key),
  and a picked one adopts the spot it hung from. The ways out are a left press
  on the ground, the card's 确认 (or `Enter`), and 取消 / `Esc` / a right press. A ghost
  carries a private id (`MOVE_GHOST_ID`), because a 指示牌's printed plate and a 电视's
  station plate are cached per module id and a preview may only dispose what it minted
  itself. A **run** — a 楼梯 or a 扶梯 — is movable for the same reason 删除 may sweep one: it
  carves the slab it climbs through (and a legacy turning stair may still carry the half-landing
  block an older build laid), so its move is a tear-down and a rebuild (`moveEquipment`:
  `removeModule` then `addEquipment`, still one commit) and `movedModule` re-lays its
  `from`/`to` — and every flight of a turn, turned about the piece's own anchor in the
  piece's own convention (`stairFacing`'s quarter turn, not `rotateLocal`'s, which is what a
  楼梯块 uses), so a legacy off-grid piece keeps the run it has. The opening a run carved
  where it stood stays open, as it does on a delete. A free-standing 支柱 moves too: it
  owns no document cells, carves nothing and derives nothing, so its move is a plain
  translation (`movedModule`'s default branch, `move.test.mjs`). Structural pieces still
  refused: a 电梯
  shaft (stacked an interval at a time without ever asking for floor), rooms, 轨道 / 站台门, and
  a bridge-owned pier (`cfg.bridgeId`, spaced by its bridge) — a
  translation would strand the geometry derived from them.
* **Above ground is pillars, roofs, doorway exits and stair blocks** (`sim/structures.ts`,
  `build/model/RoofPaint.ts`, `app/tools/TileEquipmentTool.ts` + `RoofTool.ts`,
  `app/rail/menus/StructurePanel.tsx`; `overground.test.mjs` + `roof-tool.test.mjs` +
  `structures-gaps.test.mjs` + `pillar-length.test.mjs` + `pick-tool.test.mjs` +
  `pillar-extension.test.mjs` + `move.test.mjs`). A pillar is a slim (0.3 m) or thick (1 m) column grown
  in 超短 2 m / 短 3 m / 中 4 m / 长 5 m / 超长 6 m sections (`extendedPillar`,
  `PILLAR_LENGTHS` / `nextPillarLength` / `pillarLengthLabel` / `pillarSectionOf`), chosen
  with Tab and copied when picked; R places a slim pillar at one of nine
  in-cell offsets on the shared centre-then-reading-order cycle (`sim/inCellPositions.ts`,
  which also drives a rectangular 灯具's Tab `position`; a slim pillar's module `rot` is
  an index, not a quarter-turn), shared by its drawn shaft and collision envelope.
  Thick pillars stay centred. Every column draws as one continuous shaft, with steel
  collars capping only its two ends — never the old 4 m mid-joints — so 长 5 m and
  超长 6 m never read as shorter pillars stacked together (`PillarModel`,
  `render-regressions.test.mjs`). Clicking a pillar grows it by the armed section, and the
  hover and the release both read it through `pillarAt` (`sim/placement.ts`): the
  pillar's own anchor cell, never a generic `moduleAt` — a turning stair's envelope
  spans the whole corner it turns through and would otherwise win the lookup whenever
  the stair is earlier in the document. A refused extension highlights the pieces in
  the way (`setCollisionHighlight` with the grown shaft's colliders, so the notice and
  the highlight agree), and a turning stair reserves its flights but never its center
  platform at any size (`rampBodyBoxes` holds no landing tile — a 90° turn's departing leg
  starts on the square's far edge, so none of its cells is under one), so a shaft beside
  the landing is judged by the flights alone. A roof is a 1×1 m thin tile, a truss-less shell bay, or a
  raised truss bay in 4/8/12 m widths (`ROOF_WIDTHS`, `nextRoofWidth` /
  `supportedRoofWidth` / `roofWidthLabel`, `trussRoofRidge`/`trussRoofTop`), painted
  per tile or per connected surface (`paintRoofSurface`, 材质 单块/整面) while the
  truss stays steel. A plain tile's 上 / 下 snap puts its quarter-metre slab against
  the upper / lower boundary of the target metre; drawing, collision envelope and
  storey slicing must share those exact bounds. Placement prefers an existing thin
  roof's height and snap half, then the block's outside face, then the active view
  height. Tab and the action tile cycle the same state; pin bounds in
  `overground.test.mjs` and snapping/control agreement in `roof-tool.test.mjs`.
  A doorway exit (`ExitCfg.style: 'doorway'`) is a 1 m pad aligned
  to the block edge (`exitDoorwayOffset`) with no carved floor, no walls and no run
  snap. A 虚拟 exit (`ExitCfg.style: 'virtual'`) is a 1×1 surface pillar drawn by
  the 导向柱 model (`ExitModel` delegates to `GuidepostModel` with a synthetic
  `exitId` back-link, so the pillar prints the station + its own exit letter):
  its street node is its own cell, with no floor, no walls and no run snap, and
  it places on any floor at 0 m or above like outside decor. A stair block (`stair.cfg.block`, 高 1 m / 矮 0.5 m) is a solid 1×1 m step
  with no rails; only the metre-high block connects storeys in the graph. A bridge
  (`track.cfg.bridge`) has a 1 m deck, one generated thick pier per complete 8 m bay,
  and a cycling railing / sound-barrier setting; `BridgePillars.ts` owns support sync,
  and the bridge finish applies to the deck alone.

* **Gate waits are forecasts, not queue lengths** (`sim/gateTraffic.ts`,
  `sim/constants.ts`, `sim/world/World.ts`). `GateTraffic` keeps per-server
  `queued`/`incoming` counts plus `reservations` for committed walkers inside a
  `GATE_FORECAST_SECONDS` (12 s) free-flow horizon. `wait` prices each direction
  separately, adds the opposing wave's drain time, and caps at 600 s; throughput
  and lane policy are unchanged. `World.rebuild` wires it as `path.gateWait`,
  `refresh` runs each tick after congestion pricing, and `chooseGate` /
  `joinServer` / `serve` reserve, join and release. `GATE_REPLAN_PER_TICK` is 8:
  a deferred choice keeps approaching but never joins a stale queue, and a
  deferred patience check keeps `wait` and retries next tick (`Agent.patienceWait`
  vs `wait`). Pin in `game/test/gate-traffic.test.mjs`.
* **Open floor walks diagonally** (`sim/station.ts`, §7.2). A `2×2` square with
  four walk nodes and legal cardinal edges in both directions gains both diagonal
  `KIND_WALK` edges at `√2/(speed)` cost. Gates keep cardinal approaches; exit /
  ramp / fare checks apply to the diagonal segment too. Pin in
  `game/test/diagonal-walk.test.mjs`.
* **The crowd fills usable floor** (`sim/crowdRouting.ts`, `sim/walkingSpace.ts`,
  `sim/world/World.ts`, §7.2–7.3). A shared shortest path is a corridor guide:
  stable lateral lanes spread walkers across legal width, with gradual fan-in at
  turns and service approaches. Every lateral move must follow connected floor
  and preserve fare, wall, road and ramp clearance. When live congestion makes a
  committed walking segment costly, rationed re-planning may replace only that
  segment and must preserve the itinerary tail and shared cached route. Platform
  wait spots use connected floor around the door; balancing counts approaching
  passengers before physical queues form, and the queue head must walk to the
  door before boarding. Keep bounded searches, deterministic replay, clear
  corridors, narrow passage, legal-segment, waiting-area and door-spread behavior
  pinned in `crowd-routing.test.mjs` and `walking-space.test.mjs`.
* **Ramp mode share is a preference** (`sim/constants.ts`, `sim/station.ts`,
  §7.2). `STAIR_AVOID_S` adds 32 seconds to stair edges for walkers who can use
  them, aiming for roughly 75% escalator entries on the shipped 动物园 scenario;
  it is not a ban. Step-free passengers still require lifts, and queue costs can
  send walkers to lifts when ramps are genuinely congested. The measured seed-99
  2,400-second mix (74.3% escalator / 23.4% stair / 2.4% lift) is recorded in
  `game/README.md`; pin the preference and lift pressure-valve behavior in
  `game/test/wayfinding.test.mjs`.
* **Finishes are material categories that paint any face** (`sim/finishes.ts`,
  `build/model/Paint.ts`). `finishPaletteGroups()` groups `stone` / `metal` /
  `wood` / `other` (marble, limestone, sandstone, slate, softwood, hardwood,
  aluminum, obsidian included); `finishesForFace` returns every finish, so any
  material paints any exposed face. `DEFAULT_MATERIAL` is `floor.concrete` and
  the brush, roof cladding, stair fallback and pillar shaft default to it;
  explicitly painted finishes keep their overrides. Granite is pink-red;
  `wall.soil` stays loadable but left the palette for obsidian. Pin in
  `game/test/surfaces.test.mjs` + `paint-mode.test.mjs` (independent 涂料/搪瓷板
  pickers, mode survives tile switches).
* **Wall signs snap to booth headers** (`sim/boothSigns.ts`, `sim/placement.ts`,
  `sim/types.ts`). A `sign-wall` with `cfg.boothId`/`boothOffset` is backed by
  the booth's overhead frame, not by wall courses or a ceiling slab:
  `snapSignToBooth` picks the nearest face and centres the board with its top
  flush to the header; `boothSupportsSign` is the backing check; `flatEnvelope`
  is a 3 mm sheet; the pair is exempt from `placementColliders`. The booth model
  carries no baked banner (`BoothModel.ts`); the sign model draws ink only for
  booth mounts. `moveCandidate` takes the pointer point (`near`) so wall signs
  re-snap while carried. Pin in `game/test/booth-sign.test.mjs`.
* **Hanging signs are smaller** (`sim/sign.ts`): `PANEL_MIN_H` 0.4 m, nine-arrow
  capacity at 3.5 m, smaller arrow/line/text/icon geometry. Saved content is
  vertically centred on reprint; a rejected tenth arrow never enters the hover
  preview. Drawn marks are `customer-service`, the `separator` divider line and
  the `gap` blank divider. Pin in `game/test/sign.test.mjs` +
  `sign-render.test.mjs`.

## The document and the demo station

### Startup and interactive tutorial

`app/boot.tsx` restores a valid local autosave before rendering and initializing
the worker, paused at the station's baseline; otherwise it starts empty.
Examples are explicit loads; `initialStation()` remains a reference
fixture helper, not the startup document. Keep browser fixture loaders explicit.

`app/demoRoute.ts` plus `boot.tsx` also answer a demo link — `/game/zoo`,
`/game/tanwei`, and their `/game/en/…` twins, which the concept site's 示例车站
picker links. The named example is loaded **before** the autosave is read, the
worker is initialised once (not again after the load), and the URL is replaced
with the plain game path (`/game/`, `/game/en/`) so a reload restores the player's
own station. `game/worker/index.js` serves the route as a client route and 308s a
trailing slash away. Pin the matching, the redirect and the boot order in
`demo-route.test.mjs`; `npm run check:demos` walks it in the production browser.

`app/autosave.ts` owns `metro-game.autosave.v1`, using the existing `metro-save`
JSON envelope. Committed `version` changes save every 10 seconds and on pagehide
or hidden visibility; previews and simulation frames must not dirty the save.
A `stationEpoch` change (new/import/example) invalidates the old save and writes
the replacement immediately. Failed writes stay dirty for retry; invalid or
blocked storage must not prevent startup. Pin these rules in `autosave.test.mjs`.

`app/windows/tutorial/` owns the bilingual tour, step metadata and local-storage
preference (`metro-game.tutorial.v1`). The top-bar bookmarks button reopens it;
the first card switches language through the existing shared i18n API. Keep mouse,
wheel, orbit and game keyboard shortcuts usable under the dimming layer. The tour
card alone catches pointer input; it must not mark the app inert or swallow game keys.

Block / Delete / Platform practice starts with the tool highlighted even when it
was already active. Reveal the construction area only after F / B / L or the
matching tile is selected **during that visit to the step**. Tool changes hide
that area again. Adding a line expands the line-step spotlight to the new card
and scrolls its settings into view without stealing editing focus. Highlight
whole equipment/decor/material folders as they expand, clipped to the rail's
visible area, and scroll expanded contents into view after the fold settles.
Use separate keycaps for each modifier/key, with wider gaps between shortcut
groups. Mouse wheel/middle-button instructions have mouse graphics. All copy
uses the shared catalogue; material painting starts by selecting a material,
then Tab switches single-block / whole-surface mode.

Run `npm run check:tutorial` for the production browser regression and the
`tutorial` unit suite for empty startup, persistence and blocked/corrupt storage.

* **Both boundaries repair rather than refuse.** `persistence/save.ts` owns the `metro-save`
  v1 envelope (`SAVE_FORMAT`, `SAVE_VERSION`, `serialize`, `parse`); a refusal (`文件损坏` /
  不是车站存档 / 存档太新了 / 缺少车站数据) is reserved for a broken **envelope**, and never
  partially loads. Everything else is repaired by the one grid rule in `build/model/State.ts`:
  `isGridCell` / `isGridModule` / `repairGrid` drop cells and modules at fractional coordinates
  no tool can address (a pick names whole cells, `removeCells` matches an exact coordinate), and
  `parse` reports `droppedCells` / `droppedModules` so the 打开 notice can say the station was
  repaired. Nothing in the game can *mint* an off-grid cell: a pick names whole cells
  (`render/pickCell.ts`), pinned against real meshed geometry by `test/pick-cell.test.mjs`.
  `test/grid.test.mjs` is the guard on the commands downstream of the pick — extend it if you add
  a tool that writes cells — and `save.test.mjs` pins both boundaries.
* **The demo is the author's real 动物园 (广州地铁 5号线) save**, shipped as
  `data/demo-station.json` (12,075 cells, 727 modules, seed `7654321`) and handed out by
  `referenceStation()` as a `structuredClone` so an edit never leaks back into the shared
  document. It opens cold at 06:30 sim time, warmup 0 (`REFERENCE_BOOT` in
  `data/reference-station.ts`, pinned to `DEFAULT_SIM_TIME`). Loading it seeds the world from
  `station.seed`; normal startup restores the autosave or opens an empty station. Browser captures and benchmarks
  use `loadExampleStation` from `tools/browser-harness.mjs` to load the demo and dismiss the tour.
  The old hand-built Wusi Square rig
  moved to `test/support/scenario-station.ts`, so the capacity / stair / escalator / opening tests
  keep their controlled knobs; `demo.test.mjs` guards that the shipped save is one connected
  circulation that actually boards and clears a crowd. **Refreshing it** (the author keeps editing
  the station): `node tools/bake-demo-station.mjs [动物园.metro.json]` parses the author's save
  envelope with the game's own loader and writes `toData(toState(…))` — the document the open path
  builds — as one line with no trailing newline, so the demo cannot carry anything a load would
  have repaired away. After a refresh, re-check `data/reference-station.ts`'s header comment and
  the demo facts `placement.test.mjs` pins, and make sure `demo.test.mjs` still passes.
  The five shipped stairs are complete current-catalogue pieces: three straight
  runs explicitly store 0.79 m fitted treads and two medium switchbacks store
  1.79 m per run. Rebuild replaced stairs with `createModule`, preserve their IDs
  and landing plans, and store `stairTreadWidth`; do not reintroduce lane tokens
  or leave the demo relying on legacy width conversion. `demo.test.mjs` pins
  the saved widths and current flight plans. Its reachability assertions resolve
  `platform.doors` as **server IDs** through `graph.servers[id].node`; the negative
  fixture must reject a door server moved to an unreachable node.

## Rendering and the app

Ambient road vehicles are procedural models in `render/models/pieces/vehicles/`:
`RoadCar`, `RoadBus`, `RoadCycle` share the grey `VehicleKit`; `RoadVehicleModel`
dispatches six variants and assigns them from seed/id without changing simulation
vehicle kinds, spacing or RNG. `RoadTrafficSystem` packs instances by variant.
Keep High at 70% colour opacity and Low at 45%, with a shared depth pass for
self-occlusion. Low vehicle triangles must stay at or below 25% of High, counting
both colour and depth. `road-vehicles` pins visible
geometry, variant packing, pause and teardown; `tools/check-road-vehicles.mjs`
captures the production front/rear views through `?capture-road-vehicles`.
The app prepares authored High and Low geometry per variant, uses the existing
`graphicsQuality` setting, shows only its selected variant and updates the matching
instance buffers when quality changes. `performance.md` records submitted counts,
including the depth prepass, for all six appearances.

* `render/models.ts` is a **dispatcher + barrel** over `render/models/` (the
  `PieceBuilder` base + shared kit, and one `pieces/*Model.ts` per piece). It builds all
  module geometry procedurally — turnstiles, ticket machines, escalators (rolling step
  band via `rollEscalator`), the eight fixed stair shapes, exits, platform screen doors (printed
  header is FrontSide only, facing the platform read from `cfg.side`), rolling stock.
  **No image or GLB assets.** `render/materials.ts` is the shared procedural material kit —
  an **ownership set** as much as a cache: `owns` says whether it minted a material (the
  only test a preview can use), `retain(finishesInUse(data))` gives back every painted
  colour the document no longer names (each finish wraps a 128² canvas), and `dispose`
  releases the lot with the scene. A piece that mints a material hands it to its group
  instead of leaning on the kit (`ownedMaterial`, or a train's `userData.ownedMats`
  livery), and `disposeObject` frees an `InstancedMesh` itself — three drops
  `instanceMatrix`/`instanceColor` only on the mesh's own `dispose`, and a contact-blob
  batch, an escalator's step band and a shelf's goods are all instanced and rebuilt per
  edit.
  **A metal with no environment map has no diffuse**, and the station rig is a hemisphere
  plus two directionals plus ambient — ambient feeds diffuse only, so anything much above
  `metalness: 0.2` renders charcoal under it. The car's paint is a dielectric at `0` for
  exactly this reason (`trainBody`'s own comment records the car that came out at 86/255),
  and a piece that must read as painted — a door leaf, say — may not be given `mats.steel`,
  however much a door looks like stainless. `steel`, `darkSteel` and `trainBlue` are for
  fittings and glass, which are meant to be dark and to catch the key light.
* `render/chunkMesher.ts` emits one mesh part per finish, and its cross-section is
  **`buildProfile(look)`**: a plain square that draws a wall on the sides that are **open at
  that cell's own height**, and *nothing at all* on a side a solid neighbour shares — so two top
  faces are one flat plane and a run of blocks has no seam down it. **A block is a cube**: the
  12.5 cm top-rim bevel (`BEVEL`), its mitre ring (`profileRing`), `pushFaceOut` and the corner
  triangle are all **gone**, because the bevel's 45° faces met at every convex corner in a facet
  that crossed its neighbours and stood proud of the lid — the block's rim is now its own cell
  edge and its corner is the corner of the cube. Corner rounding went the same way (with it the
  old `CORNER_R`), §4.2 having asked for rounding and a bevel that cannot coexist.
  `test/floor-surface.test.mjs` reads the drawn surface's height (flush seam, level floor, rim on
  the cell boundary) **and every drawn normal**, which is the pin on there being no 45° face left
  anywhere on a block.
  There are no named levels: the street is `z = 0` (`GROUND_Z`), a storey is the 5 m
  editing grid (`LEVEL_STEPS` / `storeyBand`, from +30 down to −40) — every solid cell belongs to the grid line
  at or below it, so a floor and its walls share a storey while a second floor one storey
  down keeps its own even when a wall column connects them — and the depth rail slices
  those bands. The 高度 rail shifts that whole grid by a 0–4 m `levelBase`
  (`normalizeLevelBase` / `levelSteps(base)` / `storeyBand(z, base)`; old saves default
  to 0, `storey.test.mjs` + `structures-gaps.test.mjs`). The save carries no `levels` field; old saves load with it ignored.
* **商店 / 厕所 / 办公室 are room-purpose zone paints**, not facility-room brushes. They are
  `RoomKind` labels in `Cell.room` and join `ZONE_PAINT_LIST` beside 站外 / 付费区. They paint
  exposed walkable floor through `paintZoneCells`, change the overlay color while leaving the
  underlying `Cell.zone` intact for fare logic, and create no `shop` module, wall, door or furniture.
  The 分区 tiles keep their existing type icons; only their paint and overlay behavior is shared.
  `zones.test.mjs`, `zonetool.test.mjs` and `rail-families.test.mjs` pin this contract. Legacy
  `shop` modules and their footprint/model helpers remain readable for old station data;
  `facility.test.mjs` covers those helpers, not current room-label brush behavior. 房间 keeps the
  buildable 售票亭 / 问讯处 counters. A booth's `cfg.front` names the counter/desktop face (`0` =
  −y, then +x, +y, −x); the R shortcut and 房间 folder's 旋转 tile turn that face, and
  `boothBenchSpots` keeps the staff benches opposite it. During a booth rectangle drag, `ZoneTool`
  previews the booth and its benches through `setModulePreview`, and refreshes that 3D ghost when R
  changes the front. `booth-model.test.mjs`, `zonetool.test.mjs` and `tool-shortcuts.test.mjs` pin
  orientation, model bounds, opposite benches, live drag preview/release and the R affordance.
  The **售票亭** (`buildBooth`) is hand-built geometry rather than voxels, and it must be a **closed box inside the module's own cells** — every side
  measures *inward from that side's outer face*, the west and east counter runs own the four
  corner squares while the north and south runs butt between them, and the four glass sheets
  run out to each other's inner faces with a corner mullion over every joint
  (`booth-model.test.mjs` pins the box).
* Decoration has four top-level rail folders: 天花板装饰 (Shift+4), 墙面装饰 (Shift+5),
  地面装饰 (Shift+6) and 站外装饰 (Shift+7); the other rail folders use Shift+1–3 and Shift+8–0.
  `decorCategoryHasId` assigns palette ids by mount/location, and a family appears in any section
  containing one of its variants. Once shown, its variant menu is always complete, including options
  mounted in other sections. Wall order ends with 站名 / 线网图; ground order is 售票机 / 自动售货机,
  座椅 / 门, 玻璃幕墙 / 屏蔽端门, 灭火器 / 垃圾桶, 货架 / 收银台, 线网图 / 办公桌,
  盲道 / 地面指示, 设备柜 / 信号机, 厕所隔间 / 洗手池, 挂架. 售票机 and 售货机 are ground decor;
  空调风机, 导向柱 and 公交站 are outside decor. 时钟 / 监控 / 电视 / 灯具 / 通风口 are ceiling decor,
  while 信号机 is floor-standing. The 监视器 family has a 1 m ceiling-hung cabinet whose rods reach
  the actual overhead slab, and a 3 m wall-backed cabinet with twelve 1 × 0.5 m views in a 3 × 4
  grid facing into the room. `sim/monitors.ts` owns its rotated run; placement must keep its three
  wall courses, panel envelope and backing verdict aligned with `MonitorModel`. 信号机 is a separate
  floor piece: its rendered model and placement envelope are both 1 m tall, with the lower post and
  base using `floor.concrete`. Keep mounting, rotations, screen orientation, tall-ceiling suspension,
  and signal bounds/materials pinned in `test/monitor-signal.test.mjs`. `DECOR_CATEGORY_ORDER` pins
  the wall and ground layouts. 座椅 is a
  nested sub-menu of two styles from
  `sim/benches.ts` — a plain stainless bench with no back and an upholstered seat with a back
  and arm rests — one tile per style, with **Tab** cycling each between its 1 m and 2 m
  run (`cycleBenchWidth`); the 2 m piece is a real two-cell run, and a pick arms its exact
  `-2` id. 货架 is a six-variant family from `sim/shelves.ts` (tall/short, wire and cooler):
  each variant is its own tile, and a pick copies the style.
  垃圾桶 is the stainless double bin (`buildBin`) and 灭火器 the red steel cabinet on four
  legs (`buildExtinguisher`); both are cosmetic — no server, no stop — and both count as
  room furniture. 门 (`sim/doors.ts`) is the folder's one **doorway**: a threshold, a post at
  each end, a head across them and the leaf hung between, so the piece carries its own frame
  and stands on a floor tile like a 货架 — it is *not* wall-mounted (`WALL_MOUNTED` leaves it
  out) and it reserves its whole cells from the floor top to its head. All six variants are
  1.99 m high, leaving 1 cm below the lintel of a two-block wall opening; keep the shared
  `DoorSpec.h`, rendered frame and placement envelope aligned. Pin the clearance across
  variants, rotations and storeys in `test/door-panel.test.mjs`, and update the fitted curtain
  pane boundary in `test/glass-panel.test.mjs`. Six variants, 单开 /
  双开 × 不锈钢 / 木 / 玻璃, and **R** turns it; the glass variant uses a translucent pane
  in the steel frame, while steel and wood leaves stay solid. Every fitting stands proud of
  the leaf's face by `DOOR_FRAME`'s own stand-off, because a plate lying a
  few millimetres off the leaf z-fights and shimmers as the camera moves. The **office reuses
  the very same builder** (`pieces/DoorModel.ts` `buildDoor`), so a hung 门 and a room's door
  are one drawing. 时钟 is the round station clock (`buildClock`): an **open-ended** dark
  bezel ring over a white dial disc with **sixty divisions** (twelve hour marks and 48 minute
  ticks, all ending at the same inner rim), two hands and a centre boss per face, and **no
  numerals or name**. It is **double-faced**, and the two faces are **one dial mounted
  twice**, the far one inside a group turned half a turn **about the vertical axis `z`** —
  not about the dial's own normal `y`, which hangs that face upside down. Every mark and hand
  carries its length along its box's local **x**, so one turn — **`a − π/2`** — aims them all
  **radially**; aimed across the rim instead, the cardinals come out the wrong way round. The
  dial is a `CylinderGeometry` (Y-up) in the **X-Z plane**, its printed face the `−y` cap; a
  quarter-turn about x lays the disc flat in the X-horizontal plane instead. The hands hang
  on **pivots** (`ClockRig`, `reposeClockHands`) that `ClockSystem` turns every frame from
  `clockHandAngles` (`sim/clock.ts`), so every 时钟 reads the sim's own clock — swept between
  worker snapshots, set on a seek, stopped when the sim is paused — instead of the fixed
  10:09 pose (`CLOCK_POSE_SECONDS`) a palette thumbnail still draws. The **hover ghost**'s
  clock is turned with the placed pieces (`GhostSystem` hands its rigs to the clock system).
  The face is **geometry, not a printed canvas** (a texture on the cap measured wrong on the
  built page while every unit test passed), which is why the ring is `openEnded`. 监控 is one
  family in three housings — 枪机 (the bracketed bullet, the legacy default), 球机 and 半球机 —
  each its own tile; all three are cosmetic props hung the whole storey and none is room furniture.
  灯具 is the ceiling fitting in two housings — 圆形 (centred, fixed) and 直条 (the shared
  nine-spot cycle, Tab, turned 0°/90° by R) with an emissive diffuser under the steel —
  and 通风口 the square grille with a recessed dark backing and nine blades (`lights` /
  `vent` suites pin the tiles, the mounts and the save round trip). A 导向柱 is the 4 m
  red street pillar bound to one exit (armed, else the first standing; `street-decor.test.mjs`),
  and the 虚拟 exit reuses that same pillar as its whole model — same 1×1 × 4 m
  reservation, same 17-mesh drawing (`module-build.test.mjs` pins both at
  `0.16×0.589×4`),
  and picking a 灯具 / 导向柱 / wide 扶梯 / shell roof / curtain wall / 屏蔽端门 / floor-mark
  方向指引 adopts its spot / exit / width (band, roof bay and curtain alike) / height / line
  (`pick-tool.test.mjs`, `psd-end.test.mjs`).
  广告牌 is a nested sub-menu of six formats whose run length and poster aspect come from
  `sim/billboards.ts`, so the thumbnail, the collision envelope and the drawn housing cannot
  disagree. 电视 hangs by rods from the ceiling, and the **吊挂指示牌** with it. A 指示牌 is
  **one board, two mounts** (`SignMount`, `sim/sign.ts`): the 吊挂指示牌 is a lit
  **double-sided** board (正面 and 背面, either of which may be empty), while the
  **墙面指示牌** is the same board bolted flat to the wall on its local −y face — the 广告牌's
  own face, so `autofaceWallMount` turns it — read from one side only: the wall is behind it,
  `cfg.back` is never mounted, the editor shows 正面 alone, and `createModule` drops the back
  a current pair carries. The wall board hangs at `SIGN_WALL_PANEL_Z` (1.65 m), so its 0.7 m
  panel crosses exactly the wall's second course (`signWallCourses`), and `flatEnvelope` gives
  it a 广告牌's thin slab on that wall rather than the hung board's whole storey column. The
  two mounts are two pieces to a sweep (`sign:wall` / `sign:ceiling`), to the hover ghost
  (`moduleGhostKey`) and to the palette, and one type everywhere else. The 电视 is
  **single-sided** — its station board and its content window both ride the local −y face,
  so the back is a plain dark panel — and every
  lit pane there lies over a dark backing slab, so it must stand half a slab out plus
  `LIT_STAND_OFF` (`test/tv-screen.test.mjs` pins the sampling, the depth and the tiling).
  The board is three arrival cards, a video window and a blue footer (`render/stationDisplay.ts`):
  `tvLineStatus(lines, services, at)` picks the nearest service track in 3D and forecasts
  three arrivals off the worker's timetable (`sim/trainSchedule.ts`, pure — no RNG, no world
  mutation), printing minutes (ceil), an arriving word inside `TRAIN_APPROACH_S` (6 s) and a
  platform word at the berth; with no line the plate still draws three empty cards under the
  station name (`station-display.test.mjs`). `电视` cycles the shared ad posters in that window, each screen rolling its own period, and
  only artwork cut for a landscape panel is eligible (cropping is not stretching).
  `render/stationDisplay.ts` owns the board's derivation and pixels, and
  `stationDisplayLayout` keeps its geometry testable without a canvas. **Two 电视 may share
  one tile back to back** (`sim/tvs.ts`, `test/tv-pair.test.mjs`): turned exactly 180° apart
  the pair is one object — a housing **two panels thick** (0.2 m through, `TV_HALF_DEPTH`
  either side of centre, *not* a cell-filling box), one bezel, one suspension, a lit face each
  side — and it is the one `placementColliders` exemption that is not a pair of *different*
  kinds. Which side a member prints on is `placeLocal`'s job and **not** a field on the pair
  slot: both panes are built on local −y and land on opposite sides purely because their `rot`
  values differ by a half-turn. `moduleAt` therefore takes the camera's look direction
  (`scene.pickFacing`) so a right-click on either face takes the 电视 the pointer is on. **A
  screen has a back**: `render/adArt.ts` mints poster materials `FrontSide`, and
  `SceneRenderer.tintModuleGhost` doubles the sides of everything except a material the model
  already made single-sided. Wall-mounted pieces must bolt to a wall, and because
  `wallMountMissing` is a function of `rot` alone the panel **turns itself** to face its wall
  (`autofaceWallMount`) — and when the tile has a wall on two sides the **camera** picks:
  the aim ranks first, so a turn the piece already carries does not hide the wall the player
  is looking at (a hovered wall face puts the pointer's hit anywhere along it, and the
  neighbour beside the piece won every time), with the carried turn, the pointer and the
  rotation order settling a view that cannot tell them apart. That search asks
  `wallMountMissing`'s own verdict per direction, so a 半墙 facing the other way is never
  chosen and then refused — **except** for the mounts bolted to a named piece of the
  document (a booth header, an aimed 地面出入口 on its clicked block face), which the caller
  keeps by passing no aim. An orbit is therefore a **change to the ghost**: `SceneRenderer`
  reports the aim it last handed out (`onCameraAim`, one notification per real move) and
  `Viewport` re-runs `refreshHover` for the equipment and 移动 ghosts — the pointer has not
  moved, so the settings-driven `placementPreviewKey` effect would never fire. A wall/ceiling piece is highlighted as
  itself, never as the floor beneath it: the build preview, the 选择 hover ghost, the 删除 red
  ghost and the 移动 ghost all draw the piece with `setCursor(null)` — selection still commits
  the blue `setSelection` box round the model, picked from the drawn mesh (`pickModule`) before
  the cell. **Three more wall pieces sit beside it.** 玻璃板 (`sim/glassPanels.ts`) has six
  short wall-mounted sizes (one to three cells wide, 1 m / 2 m tall) — and it is the one wall piece
  that is a **band of wall**, so it **hangs over the course the pointer is on**
  (`wallMountFollowsCourse`, above): the palette size is the metre band the pane covers, not a fixed
  band at the storey floor; floor-standing
  glass is its own **玻璃幕墙** tile, with 超窄 / 窄 / 中 / 宽 widths (1 / 2 / 3 / 4 m)
  and 短 / 中 / 长 heights (2 / 3 / 4 m). All four rotations may occupy the same tile,
  while a duplicate on the same side remains blocked. At a corner, remove one intersecting
  end post and shorten the rails for a clean snap; pin the four-side placement and corner
  frame in `test/glass-panel.test.mjs`.
  A door placed over a floor-standing
  curtain snaps to the curtain's run and rotation; `placement.ts` permits only a door fully
  inside that same-storey run, and `GlassModel` removes the lower doorway section while keeping
  upper and uncovered glazing. Keep rotated/double-door snapping, collision refusal and partial
  glass drawing pinned in `test/glass-panel.test.mjs`. Door pulls must stand on both leaf faces;
  pin the two face positions and clearance in `test/door-panel.test.mjs`.
  Each panel is **one outer frame**
  round the whole run, with a single
  pane between them. The floor-standing 玻璃幕墙 may share any of its
  occupied tiles with a 围栏, including a perpendicular crossing; the shared tile is
  the frame connection. Keep both placement orders pinned in `test/glass-panel.test.mjs`.
  站名 (`sim/calligraphy.ts` + `render/calligraphyFace.ts`) is the
  **station's own name** as an ink inscription: the module carries only the hand (楷书 / 行书 /
  隶书 / 魏碑 / 黑体 / 宋体) and the axis (横排 / 竖排), the plate is **transparent** and holds
  the name and nothing else, and a rename reprints every inscription in place. A 横排 panel is
  always an **odd** number of cells wide (`calligraphyPanelCells`), because the run is centred
  on the cell under the pointer. 线网图 (`sim/linemaps.ts`, `render/lineMapArt.ts`) is the
  network **poster**: the supplied 广州地铁 线网示意图, saved as
  `src/assets/linemaps/network-map.jpg` (2048 × 2047) — **artwork, not a drawing**. Both mounts
  print the same two-cell board cut to the poster's own aspect (`LINE_MAP_ASPECT`): a wall
  board, or a **free-standing totem on a plinth printed on both faces**. Until the pixels land
  (and in a unit test) a map prints `render/lineMapFace.ts`'s **placeholder board**.
  `wallMountCourses` says which 1 m courses each type's panel actually crosses — a 广告牌's
  first, a 2 m 玻璃板's first two, a 横排 inscription's 2nd and 3rd, a 线网图 board's 2nd and
  3rd — and `wallMountMissing` asks for solid wall on every one of them, for every cell of the
  run; `wallPanelBox` narrows the run's **own cells** to a slab on the wall, so the floor in
  front of a panel stays the room's. The course arithmetic is one leaf, `wallCourses(bottom,
  height)` (`sim/courses.ts`), shared by all three wall-piece tables and the placement rule: a
  panel crosses the courses it overlaps, half-open per course.
* A **售票机 and 自动贩卖机** are the two machine types (`tvm` / `vending`): a ticket machine
  and a drinks machine with the same 1 × 1 m footprint. Both are unpaid-zone `stop` servers at
  `TVM_RATE`, and a quarter of street entries (`sampleTripFromStreet`) route through one of the
  unpaid-zone machines.
* **The 方块 tool** has a **生成墙壁** toggle (**off by default**): on, a deliberate drag grows
  the `auto-wall` ring and tags the floor; off, the same click / drag lays untagged bare blocks
  with no ring. **Tab** is that toggle's key, refused while a cut piece owns the tool; the
  **半墙** cut tile places **one piece per click**, while the **上三角块 / 下三角块** tiles
  drag **ridge-locked lines** (`triangleRidgeAxis` / `triangleLineCells` in
  `app/tools/geometry/cells.ts`: `e`/`w` runs go north–south, `n`/`s` east–west, one
  shape on every cell so slopes join smooth — `BlockTool` for placement, `BlockTool` /
  `WallTool` ridge-locked removes via `wallRemoveLine` / `removeLine`). The
  deliberate drag also tags its cells `auto-floor` — the room-union rule generalised to cells,
  so overlapping/abutting patches union, hand-built floor is continuous ground, and a hole dug
  through a patch stays open — while a single click stays a plain block. A badge pinned to the
  pointer reads the patch's live 长 × 宽 in metres (`Viewport.tsx` `buildMeasure`). A
  **reserved opening** — the corridor a ramp carves or an exit's floor (`reservedOpening`) —
  refuses a hand-built cell, so the block brush cannot seal a run the player can see through.
  The 墙 tool lays a four-course column. On G, right-clicking any block clears the four courses
  above its supporting floor (+1 through +4), including the ceiling course: resolve the band
  from `storeyBand(hit.z - 1, levelBase)` so a hit at −10 m removes −11..−8 m, not the floor
  course at −12 m. This applies equally to F blocks and wall-tagged blocks, spans gaps, and a
  drag clears one such column per cell in one commit. `storeyColumnsAt` owns the erase set;
  its preview and release must match, and the cursor must show erase as available. The browser
  can dispatch `contextmenu` at right-button down, before pointer-up; `Viewport.tsx` must preserve
  an active right-button erase there or the release never commits. Keep this guard and the
  negative-height / shifted-basis pins in `test/column-delete.test.mjs` aligned.
  删除 remains button-agnostic: it lifts a whole module under the pointer (through its own
  teardown for a rail or room), else a single block or a dragged line.
* **The 半墙 and 三角 kits** (`sim/types.ts`, `sim/openings.ts`, `build/model/Walls.ts`,
  `build/model/Paint.ts`, `render/chunkMesher.ts`, `app/rail/folders/ToolsFolder.tsx`,
  `test/halfwall.test.mjs` + `triangle.test.mjs` + `blocktool.test.mjs`). A 半墙 keeps half its
  cell *in thickness*, a **三角** half its cell *in elevation* — the cell cut on a 45° plane,
  so the piece is a wedge with one flat 1 m square in the X-Y plane, one full-height square on
  the side it hugs, the slope across the cell and two sharp triangular ends. Both are ordinary
  solid wall cells wearing a tag (`wall` + `half-wall:<side>`, `tri-upper:w` / `tri-lower:w`
  through `triangleTag`), which is what makes every other rule agree with no second code path:
  `isWallBlock` reads it, so the column lift, the storey slice, the ramp carve (a run *keeps* a
  cut block instead of carving it — `rampThinCells` skips anything `shapeOf` answers) and the
  crowd all treat it as a wall. A **plain 方块 block is not one** to `isWallBlock` (it wears no
  tag), which decides only the *top/bottom* half of a wall mount's stand cell: a **side face is
  a wall whatever the tags are** (`wallMountStandCell`), or a wall raised with the 方块 brush
  could not take a 广告牌 or a 玻璃板 at all. The mesher draws the 半墙 by squashing the square profile
  into the half it keeps (`buildThinProfile`) — half a block through it, full height along it,
  square rim like any other block — which is what keeps its
  **per-face finishes** paintable; **R** picks the side (`halfWallSideDirs`, so a 半墙 along a
  patch edge hugs the edge with no key pressed), and switching modes resets the face cycle. A
  半墙's **inner** face is the one surface not on its cell's boundary, so `facePresent` offers
  it to the 材质 brush even with a solid cell behind it and the paint ghost is inset onto the
  panel itself. A 三角 is not a cross-section at all, so it leaves the profile path for
  `pushWedge`: `TRI_FRAME` is the one shape in eight frames, `pushFace` winds each face against
  its own normal so the orientation cannot drift from the tag that names it, and each face
  wears the finish of the axis its normal most points along. The two cuts are **two families,
  not one shape turned**: 三角上 stands the flat square on the floor (a ramp), 三角下 hangs it
  from the ceiling, and **R** steps the four sides the full-height face stands on. A 三角's
  **slope is a face of the piece**, not of its cell: `triangleSlopeFace(kind)` names the finish
  slot it wears (`top` for 上, `bottom` for 下), `facePresent` offers it to the 材质 brush
  **even when a solid block stands against the face it leans to**, and the paint ghost rides
  the sawn plane (`wedgeSlope`). On a horizontal face beside a wedge, the brush follows the
  mesher's cap coverage: its flat base covers the adjacent block's cap, while the sloping half
  leaves that cap paintable; `triangle.test.mjs` pins the face target and stored finish.
  `thinWallCells` / `thinWallSideMap` hand out a `CellShape`
  (`{kind:'half'}` | `{kind:'triangle'}`) rather than a bare `WallSide`, which is the type the
  mesher, the build ghost, the chunk hash and `facePresent` all read. A dragged 三角 run
  travels its **ridge only** (`triangleLineCells`: the off-axis extent is dropped, so the line
  can never step the run), lays the press's side on every course through `addWalls`, and
  deletes through the same line (`wallColumnsAt` over it) — a tap stays one wedge. The
  mesher culls a side only against a **covering** neighbour (`coversSide` / `sideOpen` in
  `render/chunkMesher.ts`): a full block or a wedge whose full-height face is the interface;
  a thin edge or triangular end leaves the neighbour's side drawn, so a wedge beside a
  block never punches a black hole in it, while a hugged full–full seam and a continuing
  ridge run (shared ends culled, outer ends kept) stay shut. Pin the line, the seam and
  the join in `test/triangle.test.mjs`. The three cut pieces are
  **three rail tiles** — **半墙**, **上三角块**, **下三角块** — and an armed one folds out a
  **旋转 row under its own tile** (`cutAnchor` is the cut's tile *and* its action anchor, so
  the row arrives through the very `ActionRow` a 座椅's 旋转 does), which steps the counter
  **R** turns (`rotateWallSnap`).
* The **围栏 tool** (设备) drags out a straight run like 墙, but lays one 1 m panel per cell with
  the panels following the drag direction (R turns a single); a right-drag lifts the run.
  `app/Viewport.tsx` drives a live fence preview that rebuilds only orthogonally
  adjacent fence joints, so an end you drag up to loses its cap as you move
  (`SceneRenderer.setFencePreview`). Keep the immutable connection index prepared
  during the document build, mask only affected equipment buckets without rebuilding
  them, and restore each source's current storey visibility on cancel. `fence-preview`
  pins bounded work, joint geometry, clipping, allocations and cleanup.
* The **电梯** (设备) draws a full-height shaft in world space (`buildLift`): corner posts and
  back/side walls, a threshold sill and green call panel at each **level** (a story's base), and a pair of
  sliding landing doors at every level (the shaft is exactly its stories, closed by a plate at
  each end, so the top of the last story is a cap, not a landing; the level's doorway lives in
  the story above). The glass housing glazes the **door side** from above each doorway to the
  story's top; steel carries the matching front wall above it. Extending moves the caps to the
  total shaft's ends — no cap is left at the joint. The two landing leaves belong to their fixed
  `landing-doors` group in `userData.liftLandings`; the cabin remains a separate moving group
  in `userData.liftCabin` with its own pair of leaves in `userData.doors`. Both steel and glass
  styles carry landing doors. `LiftSystem.updateLifts` opens only the landing aligned with the
  car pose, easing it with the car doors; every other level stays shut during travel. Do not
  add a door at a floorless level. The base cell
  stays solid (the shaft stands on it) but every slab at a level above is hidden
  (`SceneRenderer` `hiddenCells`), so the mesher cuts a real opening while the graph still sees
  the nodes. `SceneRenderer.setLifts` pairs each 6-float car pose with its shaft and glides the
  cabin / eases the doors between snapshots; the hover finds a shaft via `moduleAt` and
  previews the extension, its upper/lower half choosing up/down.
  删除 (B) trims only a clicked top/bottom extension; the original base or an interior
  interval still removes the whole shaft. Resolve the actual module-surface hit point once
  per event, keep the red preview aligned with the interval being removed, and pin both
  endpoint trims plus whole-shaft base/interior deletion in `test/delete-tool.test.mjs`.
  `test/module-build.test.mjs` pins served-floor doors, independent car doors, and the aligned
  landing animation in both styles and all four rotations.
* **An exit is named and selected in both views.** The RHS 出入口 folder lists one card per
  exit (`app/windows/inspector/ExitCard.tsx`): name (Enter/blur commits, and the model's street
  header reprints it), demand and open toggle. Clicking or focusing a control selects the exit,
  and clicking the exit in 3D selects it, so `SceneRenderer.setSelection` draws a box around
  the model. A click tests the drawn meshes (`SceneRenderer.pickModule`) before the collision
  envelope, so a large head-house is selected (or deleted) by any visible part of its model; a
  fresh exit letters itself for the first free A ~ Z (`nextExitName` — a 虚拟 exit
  takes the same letter bare via `nextExitLetter`, `C` not `C口`), and a delete frees its
  letter. **Exits have covered, uncovered, ground-doorway and virtual variants** (`sim/exits.ts`): 有盖 /
  无盖 each support 单向 / 双向 / 三向, 地面 supports 单向 / 双向 / 三向 / 四向, and 虚拟
  is a single 1×1 surface pillar with no bay choice. Their runs
  always stand **side by side**. `cfg.bays` (1–4) is how many adjacent columns the house holds,
  and `exitSpan` builds the plan around that group with one full block of floor each end, so
  `exitWidth` is 3–6 m; the four-way ground exit is 1 m wider than the three-way. `cfg.covered: false` drops the canopy and
  walls for a glass railing, but `exitWallPlanes` returns the same barriers, so only the look
  changes; the covered piece is a red steel portal frame under a blue waved roof, and the exit's
  name board is the red brand header (`ExitModel`): the station name with the saved English
  (`StationData.nameEn`) under it and the exit identifier beside it — no 口 suffix
  (`exit-banner.test.mjs`). The 地面 X向 doorway is a wall-fixed poster panel: it has no floor
  legs, attaches to the exact solid backing block course, and its header canvas grows with bay width
  while keeping font sizes fixed, so wider variants add spacing instead of stretching the text;
  `module-build.test.mjs` pins the full-width red fill and the fixed-size, spaced text layout. The house stands on a raised 0.25 m concrete plinth
  (`EXIT_BASE_HEIGHT`, `ExitLanding.ts`) with a street-edge step, and runs landing inside
  it draw +0.25 m up while the graph stays on the storey. The station itself is renamed the
  same way its exits are: the top bar's two-field form (中文站名 + English name) commits both
  as one undoable edit, and the envelope carries `nameEn` (trimmed, `''` by default).
  `exitRunSnap` snaps a straight stair/escalator dropped inside a head-house into the column
  under the pointer, clamped to the bay group. In the other direction, `snapExitToRamp` places a
  selected head-house around a picked straight stair/escalator, aligns a bay to the upper
  landing and faces its mouth down the run; preview and click must share that target, even when
  the exact ray falls through gaps between stair treads to a floor hit. A ramp-only model-bounds
  pick is the fallback and still respects hidden modules and nearer walls. The floor wellway follows
  both the landing's across-bay column and its along-run
  row (`exitRunOpenings` / `ExitModel`), including saves where the exit anchor and top landing
  differ by a row. Wide straight stairs' saved endpoints are the first lane, not the rendered
  centreline: openings must apply `stairFlightSlides`, as escalators apply `escalatorRun`.
  Snap the whole occupied lane span into the bay group. Ramp catalogue rotations are clockwise
  (`stairFacing`), whereas exit model rotations are counterclockwise (`exitRotate`); invert the
  rotation when snapping an exit to a ramp. Turning stairs are left un-snapped, and a
  虚拟 pillar never snaps (`isExitHeadHouse`). A
  head-house's plan is `cfg.bays` **alone**, and `exitRunOpenings` walks the runs actually
  placed and keeps the ones that fixed span covers.
* **View toggles and the bottom bar.** The level slice is `render/levelSlicing.ts` (pure,
  covered by `test/level-slicing.test.mjs`): **显示其他层** (`ghostOtherLevels`, default on) is
  all-or-nothing — off, the edited storey is the *only* thing drawn at every camera angle; on,
  the active storey stays crisp and the rest are 35% ghosts that keep their depth.
  **隐藏天花板** (`autoCeiling`, default on, `H`) is the one exception above the active storey:
  a slab one storey up is that room's ceiling, so with the toggle on a storey above keeps only
  the pieces with nothing under them (the chunk mesher's `float` plate, a fixture whose column's
  lowest storey is above the active one). Suspended-ceiling tiles (pass 'c', tagged
  `suspended-ceiling`) are hidden outright, while ceiling-attached decor that hangs from the
  current room's ceiling stays on screen. It only has an effect while 显示其他层 is on.
  A storey's caps do not depend on how deep each column goes: the storey pass culls a top
  only against a cover drawn in the same pass (`emit`), and the plate pass culls against the
  whole station (`cover`, hashed into the chunk key), so the two passes agree about every cap
  instead of one column showing what its neighbour loses (`ground-visibility.test.mjs`).
  **隐藏墙壁** (`hideWalls`) fades every wall face and platform screen door to 16% with
  `depthWrite` off and drops their outline — except while a **剖切** cut is on, where a wall
  goes completely instead. **隐藏UI** (`hideUI`, `U`) is the mode that hides no interface: it
  takes the editing lattice and the storey slice away and draws the station whole. **The crowd
  obeys the same storeys**: `crowdVisible`, never a storey above the active one, and the depth
  cutaway clips the agent meshes too. **Trains are sliced like everything else** — a consist is
  tagged with the storey of the floor block it stands on (`storeyBand` of the rounded track
  surface), and `applyGroupLevel` combines the slice with the sim's own `parked` flag. **The nav
  cube only moves the camera**: no face, corner, Home click (⌂ or `Ctrl+H`), arrow or
  lens-slider drag may rewrite the slice. The top bar's 重启仿真 button empties the crowd, trains and
  queues but keeps the station and clock, and **Space** toggles play/pause; the speed chips are
  multipliers only (there is no 0× chip). The bottom bar shows FPS and 方块数.
* **The 剖切 cut is a placed surface** (`render/section.ts`,
  `render/scene/systems/SectionSystem.ts` + `LevelSystem.ts` + `GridSystem.ts`,
  `app/store/slices/ViewSlice.ts`, `app/rail/folders/ViewFolder.tsx`, `test/section.test.mjs` +
  `section-drag.test.mjs` + `cut-clipping.test.mjs`). `section.ts` owns all of its arithmetic
  (pure, three-free): an `anchor` in the station plan, an `azimuth` that is always one of four
  `QUARTER_TURNS` and never tilts out of the vertical, and an `offset` measured the way the
  surface faces. `planeConstant` is `-d`, so the plane keeps the half **behind** the surface,
  and that sign is the bug `planeConstant` has carried twice: turn it round and the room in
  front of the player is sliced away instead of the one behind. The 剖切 tile (**C**) folds out
  **旋转** (**R**, reading the angle a press turns *to*, wrapping at 270) and **隐藏剖切面**
  (**Y**, default off). A press that lands on the sheet is the cut's own whatever tool is
  active: `Viewport` fixes the axis *on screen* once (`SceneRenderer.sectionDragAxis` →
  `{axis, span}`, pixels per metre) and measures every move along that line (`walkAlong` →
  `dragOffset`, `snapOffset` to the half metre, 5 cm with Shift). `SectionSystem.applyClip`
  hands that one `THREE.Plane` **by reference** to the chunk meshes, every module mesh, the
  crowd's four instanced materials and the slice walk, so a slide costs two numbers rather than
  a rebuild. **隐藏UI** is deliberately **not a slice flag**: `sliceOptions` turns it into a
  *different* slice (`{ghost: true, autoCeiling: false}`), because a flag could not undo the
  ghost material the slice had already assigned. 隐藏墙壁 and 剖切 are a pair, and in cut mode a
  wall goes **completely** (`visible = false`, hull and 屏蔽门 modules included) instead of
  reading through at 16%, and `dressWall` is where it is put back.
* **The camera's own controls are the cube's and the modifier's, never a new letter.** `Ctrl+Q`
  / `Ctrl+E` move the view up and down world Z — a **vertical pan**, not a lift — and the camera
  and the point it aims at step **together** (`CameraSystem.panCameraVertical`), so the orbit
  offset is untouched. The key set holds the pan under an **intent** token (`PAN_UP` /
  `PAN_DOWN`, `SceneSystem.ts`) rather than the key, and the nav cube's own two arrows hold the
  same token (`app/ViewCube.tsx`), so one vocabulary has two sources and they cannot drift
  (`moveSpeed()`, Shift ×3). A plain Q/E is still the storey step, and Alt is left out of the
  keyboard guard because AltGr *is* Ctrl+Alt on a European layout. The cube also carries the
  **视场角** slider: the number is `PerspectiveCamera.fov` itself (`CameraSystem.fov` /
  `setFov`), `DEFAULT_FOV` 45°, clamped to `FOV_MIN_DEG` 30° / `FOV_MAX_DEG` 120°, and
  **vertical** rather than horizontal so a window resize cannot change what it means. The
  camera is the truth: the widget polls `CameraSystem.fov` every frame, and the slider blurs
  itself when a drag ends — a range input is a typing target to `isTypingTarget` and would
  otherwise swallow WASD. A nav-cube **drag** orbits (`CameraSystem.orbitBy`, stopped
  `POLAR_EPS` short of the pole) with no key of its own, and **回到默认视角** (`viewHome.ts`
  `goHomeView` — the ⌂ button, or `Ctrl+H` handed over as `metro:home`) owns exactly three
  things: the iso preset, the 透视/正交 flag and the lens back to `DEFAULT_FOV`. Every display
  setting is left as the player had it.
* **The rail's folders answer to a Shift+letter ladder, and the ladder is data**
  (`app/rail/helpers.ts` `FolderKey` / `RAIL_FOLDERS` / `folderForShiftKey`,
  `app/windows/AppShell.tsx`, `test/rail-folders.test.mjs`): 工具 `Q`, 轨道 `W`, 设备 `E`, 装饰
  `R`, 房间 `T`, 分区 `Y`, 材质 `U`, 视图 `I`, in the order the folders are stacked, each key
  badged on its own header. The app names the folder and dispatches `metro:folder`, the rail
  folds it — the same app-names-it / owner-does-it split as `metro:preset` — the lookup
  case-blind, and a letter the rail does not use falls through to the app's own switch (O 正交,
  B 删除). The letters must be *shifted* because every one of them already means something
  unshifted.
* `app/Viewport.tsx` owns the `SceneRenderer` lifecycle and routes pointer events to the tool
  controllers in `app/tools/` (`ToolController` base + `ToolContext`, one controller per tool,
  `geometry/` for the pure pointer math); the Viewport is the only app file that touches three
  directly. The first station build frames the home (iso) view — the constructor's preset ran
  before the station existed — while later edits leave the camera alone (`framedRef`). **A Tab
  cycle must redraw the ghost already under the pointer**, and that takes two keys, not one: the
  viewport subscribes to `placementPreviewKey` (`app/store/catalog.ts`, reached through the
  `app/store.ts` barrel — the piece, its `rot` and every Tab cycle: stair/roof widths, the run length
  a 扶梯 or 单跑楼梯 is built at, escalator
  direction and width, lift style, 闸机 `gateDoor`, the guidepost's exit, a batten's in-cell spot, plus the
  方块 tool's `halfWall` mode and wall-face cycle) so the effect re-runs, and the renderer's ghost
  identity
  (`render/moduleGhostKey.ts`) has to name the same setting — a stair's painted `finish`
  included — because `SceneRenderer.setModulePreview` skips a rebuild whose key is unchanged.
  Naming a setting in only one of the two is a stale ghost that only a pointer move clears
  (`gate-door.test.mjs` pins both halves). **A camera orbit is a third key for the same
  reason**: a wall mount's ghost follows the view, so `SceneRenderer` hands the viewport the
  aim it last reported whenever it really moved (`onCameraAim`, compared with a tolerance so
  a settling camera does not rebuild the piece every frame) and the viewport re-runs
  `refreshHover` for the equipment and 移动 ghosts — skipped while a drag owns the pointer or
  a passenger is followed (`scene-wiring.test.mjs` pins both halves of that wiring as source
  text, since the renderer needs WebGL).
* **A variant family is one row in one table.** `app/store/catalog.ts`'s `MODULE_FAMILIES`
  (`ModuleFamily` = key + label + folder + the ids it `owns` + its variants' tile label) is read
  by every half of that UI: `familyOptions` is the sub-menu, `familyAnchor` the parent tile,
  `familyFor` / `subMenuForModule` the rail's single open slot, `actionsAnchorFor` where the
  action row folds out, `folderTiles(folder)` a folder's tiles **in rail order** (`RAIL_ORDER`
  supplies the general order and `DECOR_CATEGORY_ORDER` overrides the wall / ground decor order),
  and the folder header's count. A family included by a section keeps all of its variants there;
  `familyOptions` does not filter its submenu by section. The
  cut pieces themselves are `CUT_MODES` beside the family table (one row per piece: label and
  glyph, its own `cutAnchor`). `rail/shared/TileGrid.tsx` is the one grid the 设备 and 装饰
  folders render, and `rail/menus/VariantMenu.tsx` the one variant list for every family.
  Adding a family is one row; `test/rail-families.test.mjs` pins the contract — including that
  **a predicate answers for a palette id exactly as for the module type it builds**
  (`isDecorType('sign-ceiling')`), because the rail folds a folder open and the tool guards a
  right-click by the **id** it is armed with, before any module exists. The extinguisher family
  labels its three sizes 小 / 中 / 大 (Small / Medium / Large); keep their physical dimensions
  in `sim/extinguishers.ts` and pin both locale labels and heights in `test/decor.test.mjs`.
  **The action row is one
  component for the whole rail** — `rail/actions/ActionRow.tsx` holds the fold, the open rule
  (`actionRowOpen`) and every action tile (旋转 / 自定义 / 窄 中 宽 / 超短 短 中 长 / 上行-下行 / 宽-窄 /
  有门-围栏 / 玻璃-钢板 / the batten's Tab position tile / the guidepost's exit picker), and
  the **工具 folder mounts the very same row** under its cut pieces. The 旋转 tile is
  `rail/shared/RotateTile.tsx` (one glyph and one **R** badge for the piece, a cut piece, a
  轨道 run and the 剖切 surface alike); which tile a row belongs to is one derivation for pieces
  and cuts alike (`rail/helpers.ts` `armedTiles` → `armedRailTile` / `armedActionsAnchor`).
  **No tile anywhere carries a tooltip** (`Block` has no `title` at all): `aria-label` — not
  `title` — is how an icon-only control is named. `app/LeftRail.tsx` is a barrel over
  `app/rail/`; module thumbnails are rendered from the real models by `app/moduleThumbnails.ts`.
  **New module variant controls belong in `app/store/builderAttributes.ts`.** Declare each
  capability there with its shared kind (`width`, `length`, `height`, `direction`, `position`
  or `style`), current label and store action; do not add a model-specific tile in
  `ActionRow.tsx` or a separate module branch in `AppShell.tsx`. The same capability list
  drives the row and keyboard dispatch: **R** is the transform key; variants follow the
  shared priority width → length → height → direction → position → style, with **Tab** on
  the first and **Shift+Tab** on the second. The shared tile renderer owns each kind's icon,
  so every width uses one mark. Add a focused `builder-attributes.test.mjs` case for new
  capabilities and update `placementPreviewKey` plus `render/moduleGhostKey.ts` when the new
  setting changes a placement ghost — a **run length** needs the first only, because the
  endpoints `moduleGhostKey` already keys a stair and an escalator on *are* the length. List the
  test in both game READMEs. Exceptional pickers
  and editor actions (such as choosing an exit or opening the sign composer) remain their own
  controls; they are not cycled module attributes.
  Concept-art passengers are game-owned too: `app/capturePassengers.ts` renders
  `passengerMesh` from `render/passengerModel.ts` for sheets 01, 02, 12 and 13. If
  the baked human, hair, pose atlas, appearance or crowd material changes, rebuild
  and run `node tools/render-passenger-cards.mjs` before regenerating `art/`. It
  records varied identities and frozen idle/walking poses in `.preview/passenger-cards/`.
* **The 材质 brush modes live under each material tile.** 单块 / 整面 are a persistent brush
  setting (`paintBaseMode`); the finish submenu repeats those choices and **Tab** cycles them
  while 材质 is active (`N` still selects 单块). Mode controls occupy two tiles per row, with no
  current-color tile beside them. Custom-color slots are derived from saved station finish ids
  (`app/rail/paintColours.ts`), omit the stock enamel tint, and each opens a native color picker;
  **New Color** is the final picker tile, with a white plus and label. Choosing a color keeps the
  current brush mode and saves that color in the station when painted. `paint-mode.test.mjs` pins
  the mode and UI contracts. `P` 吸取 (the 工具 folder's eyedropper) lifts
  a bare face's finish into the brush and a placed piece into the placement; a **指示牌** is
  copied as its own printed **boards** (`SignSlice.adoptSignBoards`), not merely as its tile,
  and a picked 灯具 / 导向柱 / wide 扶梯 / shell roof brings its spot / exit / width / bay along
  (`PickTool` adopts each; a 导向柱 maps back to its tile like any variant piece, so the pick
  arms the placement rather than only selecting),
  and the whole gesture is put back by **Esc** through the `PickSlice` draft the picker notes
  before it writes (`beginPick` / `cancelPick` — the tool, the piece, its settings, the brush
  and the boards); the rail scrolls to the armed tile as it changes (`armedRailTile` +
  `revealScrollDelta`, run twice so the 280 ms fold has settled). `paint-mode.test.mjs` and
  `pick-tool.test.mjs` pin them.
* **The 指示牌 board is a document with an editor** (`sim/sign.ts`,
  `app/windows/sign/`, `render/signFace.ts`, `render/pictograms.ts`, §5.8). The board is an
  ordered list of components (arrows, line badges, text, icon labels) laid out in metres and
  dragged in the board editor. A text label carries two rows of up to 24 characters
  each (`SIGN_TEXT_MAX` / `SIGN_TEXT_EN_MAX`); a lone primary line takes over the
  gloss row below it, setting at twice the size, so the tile preview and the
  printed board agree (`signInkSize`, pinned in `game/test/sign.test.mjs` +
  `sign-render.test.mjs`). A single primary line is centred by its visible ink bounds
  vertically and by its per-glyph advances horizontally inside a square tile; keep
  that renderer rule pinned in `sign-render.test.mjs`. A sign is **two boards**, front and back — independent documents,
  either of which may be empty, and an empty side is the unlit black plate — but that pair is
  the **hung** board's (`signMountSpec(...).doubleSided`); a **wall** 指示牌 mounts 正面 alone.
  `signPanelSize` sizes the panel to what it carries between a floor and a ceiling, so a board
  never grows into a wall. `sim/sign.ts` is pure (no DOM, canvas or three): `signFace.ts` owns
  the only pixels and the editor the drag surface, both reading the same geometry, so the editor
  preview, the hover ghost and the lit face are one layout drawn three times. Six of the eleven
  icons are thresholded photo-to-bitmap assets (`tools/prep-sign-icons.py` turns
  `tools/sign-icons-source/` into `src/assets/pictograms/`), and five marks are **drawn
  geometry** instead — the green 出口/EXIT plate, the red 禁止 roundel, the
  service-counter mark, the white divider line and the blank divider, listed in
  `SIGN_DRAWN_ICONS` (`signIconIsDrawn`), which is what `pictograms.ts` asks before reporting a
  missing asset (`tools/sign-icons-sheet.py` prints the contact sheet for review).
  The **wall-mounted** sign is a single printed sheet, 3 mm proud of its backing; it has no steel
  back box or black lightbox. Its placement envelope reserves only that stand-off. The hanging sign
  keeps its steel body, black lightbox and two-sided faces.
* **The 删除 drag sweeps same-type runs** (`app/sweep.ts`, §9.5). A tap removes the piece under
  the pointer — drawn as the module ghost itself with no floor cursor (`setCursor(null)`,
  the wall/ceiling special cases gone); roof, stair-block, 人行道 and 草坪 deletes delegate to the tile
  tool, keeping the clicked tile's own type/rotation/width — for the two outdoor finishes that is the
  only teardown there is, one `editOutdoorSurfaces` commit for the whole run, exactly what the armed
  人行道 / 草坪 tool's right-drag performs. A held drag keeps collecting
  same-family neighbours — rotation and 自动 origin
  ignored, variant matched, so a 2 m 座椅 never takes the 1 m ones and a 闸机 row never takes the
  售票机 at its end — sampling the path between pointer events so a fast flick skips none, and
  the release bulldozes the run in **one** commit (one Ctrl+Z puts it back). Rooms, rails,
  出入口, 楼梯, screen doors and 围栏 are never swept — one piece, own teardown — while a bank of
  **escalators**, of **自动步道** or of **lift** shafts does sweep, each strictly inside its own family; that pair
  is a deliberate divergence from §9.5, which lists both as unsweepable. 导向柱, 公交站 (by
  shelter length), 灯具 (by housing shape) and 通风口 sweep as families too, and so do the
  floor kit (空调风机, 设备柜, each 地面指示 variant) and the 屏蔽端门 (by 半高/全高) —
  while 盲道 never sweeps: its own straight-run drag owns it. `test/sweep.test.mjs`
  is where the decision is written down. `sweep.ts` is the one app module written browser-free so
  Node can import it.
  Equipment-tool right-click teardown resolves the ray-picked visible module before falling back to
  the hit grid cell; wall posters, ceiling fixtures and tall pieces can overlap a different cell or
  rail beneath them. Keep the target resolver pure and pin it in `test/equipment-deletion.test.mjs`.
  The same resolver backs the B tool, and it prefers the **pointed cell's own piece** over a model the
  ray reached from elsewhere: a 树木's alpha-tested canopy swallows rays meant for the paving beside
  it, and a raised 人行道 plate is hit a cell away from the block the grid pick reports, so a ray-first
  rule deleted the canopy (or dug the street under the paving) where the tile tools' cell-based
  right-click removed the tile. B and right-click must stay indistinguishable — `test/delete-tool.test.mjs`
  compares their documents, tap and run alike.
  On left-click, wall- and ceiling-mounted pieces may be aimed from open air: do not apply the floor-hit
  guard before their wall/slab support verdict runs. Floor-standing pieces still need a solid hit;
  `test/equipment-placement-input.test.mjs` pins both paths.
* **The 广告牌 / 电视 posters fill their panels without stretching** (`sim/billboards.ts`
  `AD_POSTERS`, `sim/posterCatalogue.ts`, `render/adArt.ts`, `render/panelUv.ts`). The 74
  optimized WebPs in `src/assets/posters/` have square (384 × 384), portrait (288 × 512), or
  landscape (512 × 288) canvases. `tools/prep-posters.py` regenerates them from the supplied
  source folder, with a centred crop, WebP quality 76, and source-filename slugs. Each catalogue
  entry limits a poster to matching panel silhouettes; `panelUvWindow` crops again as needed to
  fill the panel, and `croppedPlane` walks the UV window in three's UV order. Artwork is decoded
  before materials are made; after it arrives, placeholder materials, textures and geometry are
  released before the scene redraws. Keep the folder named `posters/`, not `ads/` — EasyList blocks
  `/assets/ads/*`, which in dev would reject the importing module's whole graph.
  `test/billboard.test.mjs` reads the real WebP dimensions and pins catalogue agreement, panel
  filling, crop arithmetic and UV order.
* `app/store.ts` is zustand (a barrel over `app/store/`: `Store.ts` wiring + one slice per
  concern + `catalog.ts`): the station document lives here, the sim lives in the worker.
  `app/boot.tsx` is lazy-imported so `app/mobile.ts` + `MobileNotice.tsx` can show a plain notice
  on phones without downloading the three.js bundle. `/lab` renders `app/Lab.tsx`, the
  material/renderer lab.
* **A pass over what a rebuild costs** (`render/scene/systems/*`, `render/materials.ts`,
  `sim/worker.ts`, `build/model/State.ts`, `app/store/slices/*`). The chunk cache is released
  exactly once, keep-aware (`meshStation` used to release the last rebuild twice), and
  `chunk-cache.test.mjs` pins the very buffer objects a kept chunk comes back with. The chunk
  key hashes a chunk's own cells **plus the 1-cell halo around it** with the mesher's own votes
  (side occlusion from the pass's solid set, cap draws, plate-pass cover vs pass emit, neighbour
  shape): face culling reads the immediate neighbour, which often lives in the next 16 m chunk,
  so without the halo deleting a block reused the neighbouring chunk's stale mesh with the
  newly exposed face still culled, until a reload rebuilt every key from scratch. 电视 / 指示牌
  plates are **retained** across a rebuild (`PlateSystem.retainTvPlates` / `retainSignPlates`:
  the station's name, lines, services, clock and date are the inputs a rebuild can change;
  per-frame clock/service refreshes upload only when the printed ink changed), a consist
  configuration that left is retained in an eight-entry dormant cache (`TRAIN_PARKED_LIMIT` /
  `dropConsist` evicts the least recently seen), an overlay's quad and material are freed where the overlay is replaced
  (`CrowdSystem.dropOverlay`), the 区域 map is rebuilt only when the picture changes
  (`setZoneOverlayVisible`, `zoneKeyRef`), the scene stops its own animation frame on `dispose`
  (`SceneRenderer.raf`), and a painted colour the document no longer names gives its canvas
  texture back (`finishesInUse` / `MaterialSet.retain`). The undo stack is capped by frames
  **and memory** (`StationSlice.pushPast`), `cloneState` uses `structuredClone`, and a **live**
  指示牌 preview raises `signVersion` rather than the document's `version`, so a preview stops
  looking like a document edit. In the sim the worker stays quiet while paused with nothing
  `dirty`, and `AgentPool` drops a dead agent's id entry as it recycles the object.
  The demo performance harnesses are `npm run bench:sim` and `npm run bench:browser`
  from the repository root; `game/PERFORMANCE.md` records how to run and compare them.
  `BENCH_STATION` selects an external save for both harnesses. Move pickup/cancel
  uses `setMovingModule`, retaining the station and temporarily exposing original
  neighbour surfaces of affected equipment batches; a storey change restores the
  source visibility before slicing and reapplies the hidden piece afterwards.
  Collision bodies cache by immutable module arrays. Production passenger buffers
  load as binary assets; signed integer pose textures retain every baked value.
  Stair-block drags are visual-only: `TileEquipmentTool.draw` skips placement
  validation; release validates each tile and commits the accepted run once.
  Refusal highlights/notices for these blocks are deferred until release.
  Pick a module once per event, before finding its document entry. Never call
  `pickModuleAt` inside `modules.find`'s predicate: a miss would raycast the whole
  scene once per module and freeze the initial press (`roof-tool` pins the count).
  Opaque static siblings are batched per module by `render/batchStaticModule.ts`; keep the
  module root and nested groups for picking and storey visibility, and leave transparent,
  shared/tagged geometry, mutable screens and animated rigs separate in this base
  helper. Dedicated train/equipment batches handle sorted transparent parts and
  retained picking surfaces under the contracts above. `SceneRenderer`
  retains unrelated floor paint through `canRetainPaintedModules`, and local wall/structural
  edits through `moduleDependencies`: cell-dependent rooms, ramps, lifts and suspension
  columns invalidate only affected groups. A **boards-only sign edit** (a drag, a stamp or
  a delete that touches one sign's `front`/`back` — cells, lines, station fields, other
  modules and the mount all identical) skips the chunk remesh entirely and rebuilds just
  that sign through `signBoardsOnlyChange`'s keep-set, repainting only its same-size
  plates in place; a panel resize mints fresh plates. An **equipment edit** separates
  model retention from simulation routing: `retainedModuleIds` keeps every unchanged
  model whose declared inputs survive and rebuilds only the changed pieces plus their
  readers — fence/gate/tactile joints, paired TVs, shared cubicles, curtain corners and
  doors, hanger-supported fittings, platform edges/PSD ends, tracks and pillars,
  ramps/exits and guideposts. Functional machines and barriers still reach the worker;
  `isEquipmentModelEdit` is the narrower render-only chunk verdict (sim-inert decor or
  equipment types, with identical cells/station fields and street window). Unknown
  module types, changed cells/fields and widened ground windows fail closed. The fence
  connection index is prepared during the document build (`sim/fences.ts`), and a
  fence drag replaces only adjacent joints, masking their local equipment buckets;
  `render/modulePreviewDocument.ts` reuses the prepared station for ordinary hover
  pieces and caches a move's one source removal. Both fast paths skip the remesh that
  clears the slice key, so they clear
  `ctx.levelKey` themselves; otherwise the trailing `applyLevel` early-outs, batch
  resync never runs, and a deleted piece keeps drawing its batched body until a reload.
  Module/neighbour metadata, language
  and decoded artwork changes still rebuild. Retained groups keep owned materials and live rigs until
  invalidation or disposal. `blockIndex` caches occupancy, tracks, openings and virtual
  ground by immutable document arrays; preview and release share the same refusal rules.
  `placement.ts` caches exact block verdicts and prepares local collision buckets by
  immutable module snapshot; keep bounded retention, blocker ordering and refusal
  priority. `BlockTool` retains a refused cell as a red-cursor witness while the
  rectangle still covers it, and geometry identity changes must invalidate collision
  and rendered-preview caches (`stationEpoch` does not track edits/undo).
  `MultiPlaceDrag` shares the 50 ms latest-target scheduler across supported block,
  wall, fence, tactile, road and tile-equipment drags; target changes do not restart
  the cadence and unchanged rendered keys are skipped. Keep over-budget refusal
  immediate and whole, preserve each tool's release contract, and retain the roof
  frame scheduler. `GhostSystem` meshes sparse candidates by occupied course/chunk
  visits rather than scanning empty volume; preserve exact output and temporary
  occupancy restoration. `FrameTask` coalesces mouse previews and flushes before
  release. Touch gestures and
  deletion sweeps preserve every path sample; cancel/tool changes/unmount must not
  deliver stale queued work. Crowd draws pack only
  visible storey/frustum instances, retain paused poses and upload active prefixes;
  identity-only color/outfit data is uploaded only when the packed identities change.
  Hidden rendering never changes sim ticks, train dispatch, RNG, routing or passenger
  identity. Following an agent still updates the eye pose when its body is hidden;
  paused camera changes repack the draw without advancing frozen gait. Cosmetic
  worker edits skip routing rebuilds only when geometry, zones, tags, metadata,
  top-face speed/cover and track status agree, or when the module diff is sim-inert
  decor (`sim/decorInert.ts`). `performance-policy` and `worker-preview`
  pin these contracts. `npm run profile:sim` writes V8 CPU profiles; `profile:browser`
  adds Chrome CPU/trace exports, asynchronous GPU timers and measured buffer uploads.
  Sampling and tracing are separate collectors; GPU time is not CPU submission,
  disjoint/stale GPU queries are discarded, and buffer counters exclude textures/
  uniforms. `test:perf` measures helper source coverage, `check:render-batching`
  checks actual GLSL/WebGL geometry/calls, and `check:perf-tools` verifies exports.

* **Passengers are instanced humans with an eye view** (`src/assets/passenger-approved.json`,
  `src/assets/PASSENGERS.md`, `tools/bake-approved-passenger.mjs`,
  `render/passengerModel.ts`, `render/scene/systems/CrowdSystem.ts`,
  `render/scene/systems/CameraSystem.ts`, `app/store/slices/ViewSlice.ts`,
  `app/windows/inspector/InfoCard.tsx`, `app/Viewport.tsx`). The complete reviewed grey, faceless catalogue shares the pose atlas.
  Use `metro-model` (`../metro-model/SKILL.md`) for model builders, exports and
  the bake. Stable identity chooses equally within explicit `adultEligible` /
  `childEligible` pools. Approved small/crossbody bags can be child templates;
  bald models cannot. `passengerEligibility` preserves historical pools when an
  old atlas lacks flags, but explicit false always wins. Derive counts from the
  manifest rather than hard-coding variants into render/capture code. Age is
  20% children / 80% adults; size, ink tone and gait use separate identity hashes.
  Height varies 80–120%; width/depth vary 90–110% for adults and 80–90% for children.
  Child bases are 65% height and 70% width/depth; fore/aft depth scales speed and
  stride together. The High material uses 70% opacity and Low uses 45%, with alpha blending and
  no depth writes. Keep physique/speed in `sim/walking.ts` and model selection in
  `passengerAppearance`; consume no simulation RNG. `passenger-library.test.mjs`
  pins catalogue, equal age-pool selection, every walk on every variant, bag visibility,
  bounded topology and atlas disposal. `passenger-lod` pins the Low topology and its
  per-storey split (`passengerLevel` attribution, one draw for a single-storey crowd,
  two when a ghosted storey draws). `passenger-size` pins ranges,
  child restrictions and independent body/shadow matrices. Rendered adults and
  children multiply all three size axes by `trainScaleForStorey()` (0.98);
  shadows, picking, stride phase and eye height consume that scaled appearance.
  Keep this visual scale out of simulation physique/speed and the baked atlas. `passenger-clothing`
  pins all twenty jacket-free presets in both grey arrangements in both age pools,
  exact tones and actual baked skirt morphs against current GLB hashes. Appended
  clothing preserves original catalogue ordering and shares the instanced draw.
  Never replace clip/morph sampling with skeleton posing alone; see `metro-model`.
  Game-only exterior trimming removes internal garment supports and covered
  thighs before the transparent bake. Lossless frame deltas restore in
  `passengerAtlas` before texture creation; preserve absolute legacy atlases and
  keep both tracked-asset and shipped-chunk size guards.
  The model preview
  shares tuning through `preview-appearance.js`. The
  crowd draws once per visible LOD group (normally one; a ghosted storey's crowd
  adds a second), gait by distance, idle when waiting/riding, frozen while
  paused — and so is every other sim-driven animation: escalator step bands
  (`LiftSystem`), 闸机 leaves (`CrowdSystem.updateGates`) and train/screen doors
  (`TrainSystem`, which holds consist poses and door leaves, then resumes from
  the held pose). `SceneRenderer.setPlaying` forwards pause to all three systems.
  Pin in `game/test/sim-pause.test.mjs`. `followPassenger(id)` forces
  隐藏UI + perspective and snapshots the display state; the camera rides
  `PASSENGER_EYE_HEIGHT` facing travel direction, mouse-drag looks after the
  entry yaw, Space still pauses, Esc / departure restores everything. The
  inspector eye chip is the way in; keyboard/pan/tool input is ignored while
  following. Pin in `game/test/passenger-view.test.mjs`.
* **Canvas ink shares one shrink-to-fit helper** (`render/modelLabels.ts`):
  `drawModelText` with `t('printed_*')` captions. No hardcoded English on
  models, PSD decals, TVMs, floor marks, line maps or signs.
* **Viewport chrome folds without unmounting** (`app/windows/AppShell.tsx`,
  `app/windows/shared/CollapseButton.tsx`, `app/ViewCube.tsx`, `styles.css`).
  Left rail, inspector and view cube each keep an independent hide/show button
  (`aria-expanded` + `aria-controls`); contents and drafts stay mounted,
  `prefers-reduced-motion` disables the transition. Compass faces use
  `compass_*` catalogue keys via `t()`, not view-cube abbreviations.
* **Touch is tap-on-release plus pinch zoom** (`app/touchZoom.ts`,
  `app/Viewport.tsx`, `render/scene/systems/CameraSystem.ts`). First finger
  never builds until release (>8 px = no tap); two fingers drive shared
  `zoomBy` in both projections; the session owns release/cancel. Pin in
  `game/test/touch-zoom.test.mjs`.
* **Wall/ceiling sign aims read the drawn surface** (`app/tools/boothSignHit.ts`,
  `render/scene/systems/CameraSystem.ts` `pickModuleHit`,
  `app/tools/EquipmentTool.ts`, `app/tools/MoveController.ts`). `sign-wall`
  raycasts the module first so a booth header is clickable; open-air aim still
  reaches wall/ceiling mounts before any floor-hit guard.

## Current state, and where its history lives

Milestones: **V0–V5 done, B1 done, B2 core done.** Still open in B2: zone inference, module
zone-legality feedback for ticket machines, and the gate direction/anchor UI. **B3–B6** (capacity
kit, draw kit, authored time + charts + snapshot, ship) are planned. `game/README.md`'s milestone
table is the authority; it still files the draw kit under **B4** and its table is a step behind
the code.

`game/README.md` is also where the project's narrative history lives — what a feature replaced,
and the bug a rule exists to prevent. This skill keeps only the rules and the traps.

### Street roads

The 站外 palette includes `road` (车道). `app/tools/RoadTool.ts` owns its rectangle
surface gesture; `sim/roads.ts` owns long-axis direction, lane counts (3 m lanes,
two-way equal pairs), intersection ink intervals and seeded ambient vehicle poses.
`RoadModel` clips all white/yellow ink at same-level road overlaps. `RoadTrafficSystem`
uses simulation-clock interpolation and bounded instances of `RoadVehicleModel`'s
car, bus, bike and scooter meshes. Roads require complete floor at z >= 0 and
may overlap roads. Seeded vehicle spawning uses 50% of the previous slot count,
with a 10% bus, 60% scooter and 30% car mix. Pin palette order in `rail-families`
and behavior in `roads`.

Roads are pedestrian path cutters: exclude their footprint from `buildGraph` and
sweep moves against the same rectangles on that floor. On edits, relocate walkers
paved over to remaining floor. Vehicle materials are grayscale and share the
passenger material's opacity.
R quarter-turns the held rectangle; Tab switches travel mode. Keep width, depth,
rotation and direction in `moduleGhostKey`; route `AreaDrag.road` release to
EquipmentTool, never BlockTool. `npm run check:roads` pins the production browser
input path in both languages; a direct RoadTool test cannot cover that dispatch.

Road preview validation (`sim/roadPlacement.ts`) prepares support, holes, exit and
track occupancy once per immutable cell/module pair; keep the existing verdict
and refusal priority. Never scan the whole document per road square. Road-only
edits retain non-road equipment groups but rebuild road ink, and remain functional
worker edits because they cut the walk graph. Pin work counts and allocation
identity in `road-performance`; measure the actual cold/warm input path with
`npm run bench:road`, saving profiles under `.preview/perf/`.

### Platform screen door signage

`render/models/pieces/PsdHeader.ts` owns the printed bilingual full-height PSD
panels and the direction-aware destination. A station name matches the 上行
terminus only on an 上行 platform, and 下行 only on a 下行 platform; do not infer
terminal status from the opposite direction or an empty name. A middle station
gets a schematic route with no invented stops. Keep the next-destination arrow
on the travel side, independent of which bank faces the platform — but drop it at
a terminal, where the destination is the station's own name and the arrow would
only repeat it. The station
plaque and its yellow oval lamp stay centred over each train-aligned doorway;
the bound line supplies the lower fascia colour.

The full-height assembly is 3 m overall: 2.35 m glazing, a top-mounted 0.6 m
information plate and a 0.05 m cap, with no top padding. Keep the dimensions and lamp placement in
`module-build` / `psd-end`, and the ink, bilingual physical labels and directional
terminal rule in `psd-header`. Half-height stickers still share the same artwork
and directional/terminal decision.

Road network additions: `sim/roadNetwork.ts` caches directed lanes, coalesces same-width
collinear strokes and builds crossing/T connectors. `sim/roadTraffic.ts` owns bounded
fixed-step ambient queues and exclusive junction reservations. Seeded and boundary
spawns are staggered across the lanes of a multi-lane road, so cars do not appear
in lockstep on every lane. Road-derived zebra
markings are visual; pedestrian roads remain blocked. `RoadModel` builds automatic
signals/crosswalks, while `RoadTrafficSystem` animates their lamps and instanced cars.
A junction crosses **every street it meets, one-way or two-way**: `roadJunctionSides`
returns one side per junction per street — the side traffic arrives along and the side
it only leaves by — so a one-way street keeps its zebra on both sides and a stem that
only feeds traffic out gets one at its mouth. Stop lines and signal poles stay on
arrivals, and a width-merge node gets neither.
The separate `traffic-light` decor tile belongs in 站外装饰 beside 道路. Keep placement,
3.5 m pole bounds, picker/move/save and palette identity aligned; preserve dynamic
lens references when batching. Tests live in `road-network` and `rail-families`;
`tools/check-road-network.mjs` checks both locales in production WebGL.

Road lane permissions live in `sim/roadLaneMovements.ts`; `roadNetwork.ts` applies
them to connectors and `RoadModel` reads those connectors for ground arrows. Keep
two-way handedness independent of half turns. Preview arrows read the candidate
without building topology; stop lines cover incoming carriageways only. Pin all
rotations, odd T middle sharing, one-lane combined arrows and live R/Tab refresh.

Road authoring is a node/segment graph in `sim/roadDocument.ts`, separate from the
lane graph in `roadNetwork.ts`. Nodes derive their stable position/elevation IDs
from incident `road.cfg.from/to` endpoint references; no isolated node is saved.
`build/model/Roads.ts` materialises legacy/split segments in one edit. `RoadTool`
drags orthogonal centre lines and snaps to nodes/roads, but the snap moves the start
point only: it never takes width or direction from the road under the pointer. Width
uses Tab, traffic uses Shift+Tab, R reverses flow. Deletion targets
one segment, including virtual splits in older saves; shared caps and connected
nodes remain. Node handles are a persistent, bounded GhostSystem instance pool,
cleared on tool cancellation and restored after station/move-preview cleanup.
Pin document/gesture/lifecycle behavior in `road-document`, and run `check:roads`
for production bilingual pointer/keyboard input. Width transitions are uncontrolled
lane merges in the traffic graph; do not generate signals or zebra crossings there.

站外装饰 begins with 人行道 (`sidewalk`), 草坪 (`lawn`) and 树木 (`tree`). Surfaces use TileEquipmentTool rectangle drags and stand 0.1 m above the floor. **One finish per tile**: `equipmentReason` accepts the *other* finish on the candidate's tile as a replacement (the same kind stays the "already here" no-op), and `editOutdoorSurfaces` then deletes that tile in the same commit — never for a candidate the verdict refused, or a replacement would delete without placing. `outdoorSurfaceLift` shares derived support height with the model dispatcher and collision envelopes; anchors remain integer cells. Surfaces must invalidate equipment models when added or removed. Trees are separate props: **planting, not structure** — `buildGraph` leaves their tile a walk node, so the crowd walks through a tree like every other street prop and only its equipment collision remains. Keep it that way: fencing the tile puts every planting on the full routing-rebuild path (measured ~1.5 s per click against ~0.2 s, or ~0.6 s where the planting widens the drawn plane and still needs its ground and graph). The walk-graph half is pinned by `outdoor-surfaces`' "a tree draws without walking", and the skipped worker rebuild by `worker-preview` and `performance-policy`. Pin palette order in rail-families and geometry/placement/save in outdoor-surfaces.

Surface performance: `build/model/OutdoorSurfaces.ts` validates and edits a whole drag against one immutable document, committing one array; never reintroduce per-tile addEquipment/collision-cache reconstruction. `sim/outdoorSurfaces.ts` owns the cached tile/support index. Sidewalk/lawn/tree are sim-inert; retention rebuilds equipment only when its derived support height changes. Each finish uses one shared vertex-coloured mesh. Street trees are baked offline from the pinned EZ-Tree dev dependency; preserve the source options/license in `assets/trees/` and the two shared meshes/material-kit texture ownership. `node tools/bench-tree-placement.mjs` drives the real tree gesture (plant and delete) in the production browser.

Outdoor finishes must not cap exit-owned floors, ramp openings or dug holes. `outdoorSurfaceHidden` shares the cached opening/support verdict with the surface model; refuse new caps with `opening` and mask pre-existing saved tiles, without lifting exits on that masked paving. Surface retention must depend on its supporting cell so dig/restore updates visibility. The Tanwei B fixture regression lives in `outdoor-surfaces`.

The camera family includes `cctv-post`, a 4 m ground-mounted PTZ also listed in outside decor. Keep its ground placement, palette/picker round-trip and authored Low geometry aligned.

The roof family includes `roof-canopy` / `cfg.variant: canopy` (有柱雨棚). Its truss shell is lowered 4 m onto two symmetric rows of round columns at every width, without lower chords or diagonal webs. Aim placement at the ground; use shared canopy post/body helpers for support, collisions and routing so the sheltered aisle stays open.


## Storey spacing and suspended ceilings

Five metres is the only supported station profile (`storeyHeight: 5`).
Pass this context to build factories, slicing and track headroom. The viewing
ladder steps by 5 m; exact altitude entry remains integer.
Read [the five-metre profile](references/five-metre-profile.md) when changing the
grid, train size, ceiling fittings, PSDs or their load/placement paths. Do not
maintain a 4 m save/grid profile or move demo-station blocks as part of this work.
Turning stairs may store half-metre internal landing Z coordinates; editable cells
and outer endpoints remain integer-grid. Grid repair admits fractional internal
landings without depending on module tags. The graph synthesizes their nodes.
The block tool's Tab variant is 吊顶 (ordinary tagged blocks that can be placed
anywhere like a standard block); Shift+Tab controls wall generation. Placing one
triggers ceiling snapping for all ceiling decor to its underface, regardless of
placement height. Ceiling decor uses the normal tools and `ceilingAnchored` below
these slabs. 隐藏天花板 hides the tagged ceiling tiles; mounted decor remains visible.
Five-metre trains uniformly scale to 98%; shared stock door offsets, floor origin,
rail hardware and compressed pantograph contact must agree. Full PSD glazing is
2.35 m, with a 0.6 m information plate directly below the 0.05 m top cap and no
padding. Safety vinyl fits the actual pane height. Train model caching must keep
identical consists on different tracks as distinct poses, while reusing each model.

Train interiors use one continuous ceiling per car: `CABIN_CEILING_Z` is
2.99 m, with the lining underside 5 cm below it. Do not add local doorway
ceiling pockets. Boards stay above the door head; lights, poles and ceiling
fittings follow the raised lining. Keep exterior crown, shoulders and collector
wells unchanged; `openRoofUnderside` removes only downward closure faces so
the higher interior remains visible. `train-interior` pins full-length/width
headroom under collectors and unchanged exterior High/Low ray hits.
