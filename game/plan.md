# Parallel-edit refactor plan

Goal: split the god-files so parallel edits rarely touch the same file.
A merge conflict should mean two people changed the same *unit*, never that two
unrelated units share a file.

Rule of thumb: if `git blame` on a file shows three features, the file is wrong.

## General rules

- **R1 — Every window is a standalone class.** `App.tsx`, the build rail, the
  inspector, the status bar, the sign editor: each owns a folder and an entry
  file, and knows nothing about its siblings' internals.
- **R2 — Every subwindow is a standalone class.** Each rail folder (工具 / 轨道 /
  房间 / 装饰 / 材质 / 分区 / 视图), each inspector section (信息 / 出入口 / 线路),
  each editor panel: one folder, one entry file.
- **R3 — Every item in a window list is a standalone class.** One `ExitCard`,
  one line card, one rail line item, one finish tile, one sign-board row:
  one file each. List files map over items; they never implement an item.
- **R4 — Every tool and every 3D model is a standalone class.** One tool
  controller per tool (`BlockTool`, `WallTool`, …), one builder per piece
  (`GateModel`, `ClockModel`, …). Adding 时钟 never opens the 售票机 file.
- **R5 — Shared UI uses inheritance where OOP fits, composition elsewhere.**
  Pointer tools, model builders and scene systems become real base-class
  hierarchies (`ToolController`, `PieceBuilder`, `SceneSystem`) with one
  subclass per unit. React windows stay function components and share chrome
  (`Folder`, `Block`, `Disclosure`, `Metric`) by composition, not by
  subclassing `React.Component` — subclassing components fights the framework
  and the existing style.
- **R6 — Every standalone class gets its own file.** One public unit per file
  plus its private helpers. No `Utils.ts` grab-bags: a helper lives with its
  unit, in a shared folder only when two units genuinely import it.

Corollaries (non-negotiable, cheap to check in review):

- **C1 — One-way communication.** A unit talks to siblings only through props,
  the zustand store, or a pure helper it imports — never by reaching into a
  sibling's folder. Sibling folders import each unit's entry file, not its
  internals.
- **C2 — Barrels re-export only.** Folder `index.ts` files contain no logic;
  they exist so old deep import paths keep working during migration.
- **C3 — The layering rule still holds** (`game/test/layering.test.mjs`):
  `app/ → render/ → sim/`, `build/ → sim/`. Subfolders are fine — the test only
  forbids escaping the layer — but no new cross-layer edge may appear.
- **C4 — No cycles.** If two new files need each other, the shared part moves
  down a layer into a third file.
- **C5 — Soft cap: ~300 lines per file.** Anything bigger is a split candidate.
  (Current worst offenders are listed below.)
- **C6 — New code follows R1–R6 from today.** No new exports in god-files; the
  freeze starts with this plan, not with phase 3.
- **C7 — Conventions carry over.** Imports carry the file extension, `import
  type` for types, no enums, ASCII ids (`Skill: Metro Station Designer`
  conventions section).

## Starting point (measured 2026-10-05)

| File | Lines | Units inside (why it blocks parallel edits) |
|---|---|---|
| `render/models.ts` | 3685 | ~25 `build*` piece functions + shared `slab`/`plate`/`prism` kit |
| `render/scene.ts` | 2783 | `SceneRenderer` with ~70 methods: chunks, modules, ghosts, levels, trains, lifts, crowd, grid, camera, overlays |
| `app/Viewport.tsx` | 2352 | ~15 pointer handlers + ghost/refresh builders per tool |
| `build/model.ts` | 2124 | ~80 exports: cells, floors, walls, paint, zones, facilities, equipment, lifts, state |
| `sim/world.ts` | 1700 | `World` lifecycle + crowd/lift/train stepping |
| `app/SignEditor.tsx` | 1473 | board editor shell + palette + canvas rows (inventory before split) |
| `app/LeftRail.tsx` | 1216 | `Icon` (~15 icons), `Block`, `Folder`, 7 folders, 4 sub-menus, action tiles |
| `app/store.ts` | 1171 | document + 8 concern groups + catalog + worker plumbing |
| `sim/sign.ts` | 1158 | pure board document (already single-purpose; split only if phase 3 needs it) |
| `sim/station.ts` | 964 | graph + `PathFinder` (cohesive; do not split without a reason) |
| `app/App.tsx` | 831 | `TopBar`, `ZoneCard`, `LineFields`, `Disclosure`, `ExitCard`, `Inspector`, `BottomBar`, `Metric` |

`sim/` below `world.ts` is already one-unit-per-file; leave it alone.

## Target trees

### Lane A — `app/windows/` (from `App.tsx`)

```text
app/windows/
  AppShell.tsx            # was App(): composes TopBar + LeftRail + Viewport + Inspector + BottomBar
  topbar/TopBar.tsx       # was TopBar() + StationName()
  inspector/
    Inspector.tsx         # column shell only; maps sections
    InfoCard.tsx          # selected piece + 移动 lift + sign-editor entry
    ExitCard.tsx          # R3: one card per exit
    LineCard.tsx          # R3: was LineFields(); one card per line
    ZoneCard.tsx
  statusbar/
    BottomBar.tsx         # FPS + 方块数 + clock()
    Metric.tsx            # shared dot (also used by inspector if needed)
  shared/
    Folder.tsx            # R5 composition chrome for R1/R2
    Disclosure.tsx
```

### Lane B — `app/rail/` (from `LeftRail.tsx`)

```text
app/rail/
  LeftRail.tsx            # shell: folder open-state only
  folders/
    ToolsFolder.tsx       # 选择 / 地基 (+auto-wall + 半墙 tiles) / 墙 / 删除 / undo-redo
    RailFolder.tsx        # 站台 / 隧道 / 旋转 / 方向 / 线路 / 重置屏蔽门
    RoomFolder.tsx        # R3 items: one tile per FacilityBrush (store/ticket/office/toilet)
    DecorFolder.tsx
    PaintFolder.tsx       # 单块 / 整面 / 取色 + finish tiles (R3: FinishTile.tsx)
    ZoneFolder.tsx
    ViewFolder.tsx
  menus/
    StairMenu.tsx         # R2: nested variant sub-menus, one file each
    ExitMenu.tsx
    BenchMenu.tsx
    BillboardMenu.tsx
  actions/
    ModuleActions.tsx     # R4: 旋转 / 宽度 / 上行下行 / 闸机门 / 自定义 tiles per piece type
  items/
    LineItem.tsx          # R3: one rail line row
  shared/
    Block.tsx             # tile button (no title prop; label + shortcut badge)
    Icon.tsx              # dispatcher; split into icons/*.tsx only when it regrows past C5
    ColourTile.tsx
    InlinePanel.tsx       # InlineExpand + InlinePanel + interleaveRows
```

### Lane C — `app/tools/` (from `Viewport.tsx` pointer logic)

Real class hierarchy (R4 + R5):

```text
app/tools/
  ToolController.ts       # abstract base: onDown/onMove/onUp, ghost hooks, shared pick helpers
  SelectTool.ts
  BlockTool.ts            # patch drag + 半墙 single mode + right-press column lift
  WallTool.ts
  DeleteTool.ts           # + same-type sweep via app/sweep.ts
  EquipmentTool.ts        # module place + fence drag + elevator extend hover
  PaintTool.ts            # incl. stair-surface resolve via pickModule
  ZoneTool.ts             # zone paint + facility rectangle drag
  PlatformTool.ts         # 站台 rail
  TunnelTool.ts
  MoveController.ts       # moveDraft aim/commit (from the 信息 card, not a tool)
  geometry/               # pure pointer math: pendingCells, planeCells, rectCells,
                          # straightLineCells, faceTargets, wallSnapAt, thinGhost
```

`Viewport.tsx` keeps the `SceneRenderer` lifecycle + keyboard shortcuts and
dispatches pointer events to the active controller. First step of the lane:
write the `ToolContext` interface (hover refs, drag refs, ghost setters) that
all controllers share — agree it before parallelising.

### Lane D — `app/store/` (from `store.ts`)

```text
app/store/
  Store.ts                # create() + slice wiring; useStore lives here
  slices/
    StationSlice.ts       # document, undo/redo, load/open/reference
    ToolSlice.ts          # tool/brush/rot/width/dir/door/halfWall/wallSnapCycle
    ViewSlice.ts          # ghost/ceiling/cutaway/hideWalls/ortho/activeZ
    RailSlice.ts          # layTrack/layTunnel/rotateRail/regenRail/removeRail…
    LineSlice.ts          # addLine/updateLine/removeLineAndTracks…
    MoveSlice.ts          # moveDraft lift/aim/rotate/cancel/confirm
    PaintSlice.ts         # paintMode/paintFinish/enamel (N/M/I behaviour)
    SignSlice.ts          # signPreview/composer session
    SimSlice.ts           # worker plumbing: initSim/rebuildSim/frames
  catalog.ts              # MODULE_OPTIONS, FACILITY_OPTIONS, predicates, labels,
                          # placementPreviewKey
  store.ts                # C2 barrel: re-exports useStore + helpers (tests import this path)
```

### Lane E — `render/models/` (from `models.ts`)

Real class hierarchy (R4 + R5):

```text
render/models/
  models.ts               # C2 dispatcher: buildModule() switch → piece classes.
                          # Keeps exporting buildModule/setGateWing/rollEscalator/
                          # setDoors/buildTrain (tests import these paths)
  PieceBuilder.ts         # abstract base: protected slab/plate/prism/mitreCap/
                          # finishSlab access, ModuleContext wiring; subclass per piece
  pieces/
    GateModel.ts          # + drawFence shared with FenceModel via base
    FenceModel.ts
    StairModel.ts         # flights + landings + stairSurface finish
    EscalatorModel.ts
    LiftModel.ts
    ExitModel.ts          # + buildWavyRoof
    TrackModel.ts         # bed + power (third-rail/catenary) + direction arrows
    PsdModel.ts           # platform-edge screen + header
    RoomModel.ts          # walls + mitreCap + doors
    BoothModel.ts
    TrainModel.ts         # + CabModel.ts (both ends, lamps, door banks)
    TvmModel.ts
    VendingModel.ts
    BenchModel.ts
    ShelfModel.ts
    DeskModel.ts
    CubicleModel.ts
    SinkModel.ts
    BinModel.ts
    ExtinguisherModel.ts
    ClockModel.ts
    CctvModel.ts
    BillboardModel.ts
    TvModel.ts            # single + back-to-back pair
    SignModel.ts
```

First step of the lane: extract `PieceBuilder` + the canvas/ink helpers
(`drawMetroMark`, recycle marks) into the base, then piece files parallelise
freely — each touches only its own file + the base.

### Lane F — `render/scene/` (from `scene.ts`)

`SceneRenderer` becomes a thin orchestrator owning one instance per system
(R4 + R5 via a `SceneSystem` base with `rebuild()`/`dispose()`):

```text
render/scene/
  SceneRenderer.ts        # owns systems, forwards the public API (pick, setStation,
                          # setGhost, setLevel, setTrains, …). No meshing logic left.
  systems/
    ChunkSystem.ts        # meshBand + chunkCache + releaseChunks + outlineSet/levelKey/gridKey
    ModuleSystem.ts       # buildModules/clearModules/pickModule/selection boxes
    GhostSystem.ts        # shape/face/module/fence ghosts + ghostKeyOf + ownedMats
    LevelSystem.ts        # setLevel/setAutoCeiling/cutaway/hideWalls/applyLevel
    TrainSystem.ts        # poses, doors, twin banks
    LiftSystem.ts         # car poses, cabin glide, door ease
    CrowdSystem.ts        # agents, density, overlays, zone labels
    GridSystem.ts         # buildGrid/clearGrid/cursor
    CameraSystem.ts       # presets, ortho, orbit/pan/frame, ViewCube input
    PlateSystem.ts        # tv/sign plate textures + ad-screen refresh cadence
  scene.ts                # C2 barrel re-exporting SceneRenderer (Viewport imports this path)
```

First step: define the shared `SceneContext` (mats, finishes, hiddenCells,
thinSides, level state) the systems read — agree it before parallelising.

### Lane G — `build/model/` (from `build/model.ts`)

```text
build/model/
  State.ts                # StationState, toState/toData/cloneState, grid repair entry,
                          # poster backfill, termini defaults, ensureRoomFurniture hook
  Cells.ts                # cellKey, add/remove cells, isSolid
  Grid.ts                 # isGridCell/isGridModule/repairGrid/toStateRepairing
  Floors.ts               # addFloor/removeFloor/syncAutoWalls/plannedAutoWalls
  Walls.ts                # wallRun/addWalls/wallSnap/halfWallSideDirs/thinWallSideMap/
                          # wallColumnAt/wallColumnsAt
  Paint.ts                # facePresent, paint/erase/fill, paintStairSurface
  Zones.ts                # zoneAt/paintZone/zoneMapFloors/zoneRegionLabels
  Facilities.ts           # FacilityKind, rect/plan/place/remove, auto furniture,
                          # room layout spots, carveFacilityOpenings, facilityWallCells
  Equipment.ts            # createModule/randomAdSlug/add/remove/replace/ids/exit names
  Lifts.ts                # liftInColumn/extendLift
  Reference.ts            # labStation
  model.ts                # C2 barrel re-exporting everything (tests import this path)
```

First step of the lane: full export inventory (the file has more facility
exports past line ~70) and final domain assignment before splitting.

### Phase 3 (only if C5 bites again)

- `sim/world.ts` → `sim/world/{World.ts, Crowd.ts, LiftSim.ts, TrainSim.ts}`.
  Only if a second editor needs the file; the stepping functions are cohesive.
- `app/SignEditor.tsx` → `app/windows/sign/{SignEditor.tsx, BoardCanvas.tsx,
  ComponentPalette.tsx, BoardRow.tsx}` per R1–R3 after an inventory.
- `sim/sign.ts` stays unless it crosses the cap.

## Migration phases

- **Phase 0 — freeze (this plan).** New code follows R1–R6. No new exports in
  the god-files. Review checklist: one unit per file? barrel logic-free? layer
  intact? under cap?
- **Phase 1 — mechanical splits, zero behaviour change.** Lanes A, B (shell +
  folders), D, G. Pure `git mv` + import rewiring + barrels. Each PR moves one
  unit or one folder, then `npm run typecheck` + `npm run test:game` green.
  Lanes are independent — one owner per lane.
- **Phase 2 — class extractions.** Lanes C, E, F. Base class + context
  interface first (single PR each), then one PR per subclass/system, each
  independently reviewable and revertable.
- **Phase 3 — leftovers.** SignEditor, world.ts, icons — only on demand.
- **Final pass per lane:** move tests off the barrel shims onto the new deep
  paths (or keep the shims permanently for the heavily-imported ones —
  `build/model.ts`, `app/store.ts`, `render/models.ts`, `render/scene.ts` —
  and say so explicitly). Remove nothing until its importers move.

Verification per PR: `npm run typecheck` (strict flags:
`verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUnusedLocals`) and
`npm run test:game` (487 tests). Split PRs must not change test outcomes —
only imports move.

## Status (implemented)

All three phases have landed. Typecheck (`tsc --noEmit`) is clean and the full
suite is 487/487.

- **Phase 1** — mechanical splits, zero behaviour change:
  - Lane A `app/App.tsx` → `app/windows/` (AppShell, topbar, inspector/*,
    statusbar/*, shared/Disclosure); `App.tsx` is a barrel.
  - Lane B `app/LeftRail.tsx` → `app/rail/` (shell, folders/*, menus/*, actions/,
    items/, shared/*); `LeftRail.tsx` is a barrel exposing `Folder` / `LeftRail`
    / `Icon`.
  - Lane D `app/store.ts` → `app/store/` (Store.ts + 9 slices + catalog.ts);
    `store.ts` is an explicit-re-export barrel. (`store/Store.ts`, not
    `store/store.ts` — the name would collide with the barrel on a
    case-insensitive filesystem.)
  - Lane G `build/model.ts` → `build/model/` (State, Cells, Grid, Floors, Walls,
    Paint, Zones, Facilities, Equipment, Lifts, Reference); `model.ts` is a
    barrel. `toStateRepairing` lives in `State.ts`, not `Grid.ts`, so `Grid.ts`
    stays a pure leaf (C4 — the plan's placement would have made a cycle).
- **Phase 2** — class extractions:
  - Lane C `app/Viewport.tsx` → `app/tools/` (`ToolController` base +
    `ToolContext`, one controller per tool, `geometry/`); Viewport keeps the
    renderer lifecycle and event routing. (`EquipmentTool.ts` is 640 lines — the
    one over-cap unit, a future split candidate.)
  - Lane E `render/models.ts` → `render/models/` (`PieceBuilder` base kit + one
    file per piece); `models.ts` is the dispatcher + barrel.
  - Lane F `render/scene.ts` → `render/scene/` (`SceneSystem` base +
    `SceneContext`, one system per concern); `scene.ts` is a barrel.
- **Phase 3** — leftovers:
  - `app/SignEditor.tsx` → `app/windows/sign/` (tokens.ts, tileArt.tsx,
    palette.tsx, BinStrip.tsx, TextFields.tsx, dragGhost.ts, SignEditor.tsx);
    `SignEditor.tsx` is a barrel.
  - `sim/world.ts` → `sim/world/` (types.ts + World.ts); `world.ts` is a barrel.
    **The method-group split into Crowd / LiftSim / TrainSim is deliberately
    **deferred**, per this plan's own gate ("only if a second editor needs the
    file; the stepping functions are cohesive"). `World` is now one file of its
    own (R6 satisfied); extracting the method groups would need a `WorldContext`
    and risks the byte-identical-determinism contract for no parallel-edit gain
    today. Revisit only when the file is actually contended.
- `game/test/layering.test.mjs` was taught to resolve relative imports, so a
  layer may be a folder tree: `sim/world/World.ts` may import `../agents.ts`
  (still in `sim/`) while escaping the layer still fails. The rule is unchanged;
  only the flat-path check was wrong.

Barrels kept: `app/App.tsx`, `app/LeftRail.tsx`, `app/store.ts`,
`app/SignEditor.tsx`, `build/model.ts`, `render/models.ts`, `render/scene.ts`,
`sim/world.ts` — every pre-refactor import path still resolves, so the ~40 test
suites and their deep imports were untouched.

## Risks

- **Test deep-imports.** ~40 test files import `../src/build/model.ts`,
  `../src/app/store.ts`, `../src/render/*.ts`. Barrels keep every old path
  working; the final pass updates tests lane by lane, never in the split PR.
- **Key coupling.** `placementPreviewKey` (store) and `moduleGhostKey`
  (render) must keep naming the same settings — the halfWall/wallSnapCycle and
  stair-finish entries move with their units, and `gate-door.test.mjs` pins
  both halves. Any PR touching a ghost setting runs that suite explicitly.
- **Viewport shared mutable refs.** Controllers share hover/drag/ghost state;
  the `ToolContext` interface (lane C step 0) is the contract that stops
  parallel controller PRs from colliding semantically.
- **Scene shared GPU state.** Systems share materials/finishes/caches; the
  `SceneContext` interface (lane F step 0) plus the existing dispose discipline
  (`ownedMats`, `releaseChunks` keep-rules) must be written down before the
  systems split, or disposal regressions will leak textures.
- **Big-bang temptation.** Do not move two units in one PR "while at it". The
  whole point is one unit, one file, one revert.
