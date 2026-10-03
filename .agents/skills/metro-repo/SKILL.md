---
name: Metro Station Designer
description: Work in the Metro Station Designer repo (ericpzh/metro) — a React 19 + three.js + Web Worker metro-building sandbox in game/, plus the concept-art site in web/. Use when changing the game simulation, renderer, builder, tests, art site, generated art, or Cloudflare deploy config.
---

# Metro Station Designer — repo guide

A 3D sandbox about moving crowds through a metro station you build yourself.
Block-based construction (1 block = 1 m), procedural voxel art, real rolling
stock, real passenger flow. No money or staff: you build, the crowds arrive, and
the station either copes or it does not.

## What lives where

| Path | What it is |
|---|---|
| `GAME-SPEC.md` | The design specification — the source of truth for *what* the game does. Cite its sections in code comments. |
| `game/` | **The game** — React 19 + three.js + a Web Worker sim. Own `package.json`, Vite config, tests, and Cloudflare Worker (`metro-game`). |
| `game/README.md` | Game milestones, the time base, measured numbers, and deliberate divergences from the spec. **Read this before changing sim behaviour.** |
| `web/` | The concept-art site (React + Vite), deployed as Worker `metro`. |
| `art/` | Generated SVG concept sheets. Source of truth; copied into `web/public/art` at build time. Never hand-edited. |
| `tools/` | Art generators (`node tools/gen-art.mjs`), drawn in the game's 2:1 dimetric projection via `tools/iso.mjs`. |
| `worker/` | The site's optional path-prefix rewrite entry. |
| `wrangler.jsonc` | Root site Worker config. `game/wrangler.jsonc` is the game's. |

The site and the game are **two apps and two Workers** in one repo. They build
and deploy independently; the only coupling is a URL (`gameUrl` in
`web/src/site.js`, overridable with `VITE_GAME_URL`).

See `references/module-map.md` for a file-by-file ownership map of `game/src`.

## Commands

Run from the repo root (PowerShell):

```powershell
npm install           # root deps (wrangler)
npm run setup         # install web/ deps
npm run dev           # site dev server at http://localhost:5173

npm run setup:game    # install game/ deps
npm run dev:game      # game dev server at http://localhost:5174
npm run test:game     # node --test over game/test/**/*.test.mjs
npm run build:game    # tsc --noEmit && vite build
npm run deploy:game   # build, deploy metro-game, and attach its routes

node tools/gen-art.mjs  # regenerate art/*.svg
```

Inside `game/`: `npm run dev`, `npm run typecheck`, `npm run build`,
`npm test`. The game preview server is on 4174 and `npm start` there builds then
previews.

Note: `npm start` at the repo root is **the game**, not the site. The site is
`npm run dev` / `npm run build`.

On Windows PowerShell 5.1 the `&&` separator is not valid — use `;` or separate
commands.

## Game architecture

The dependency direction is one-way and enforced by `game/test/layering.test.mjs`:

```
app/  →  render/  →  sim/
build/ →  sim/            (and neither render/ nor app/)
```

* `sim/` — **pure TypeScript.** Imports nothing outside `sim/`, and never
  touches the DOM, `window`, three.js or React. Runs directly in Node (tests
  import the `.ts` files and Node strips types). This is the rule to protect.
* `build/` — the station document and the edit commands (build, dig, paint,
  zones, facilities, placement, undo).
* `render/` — three.js scene, chunk mesher, procedural materials and models.
* `persistence/` — the `metro-save` v1 envelope.
* `data/` — the reference station and the palette.
* `app/` — the React shell. Panels and pointer handling only; no sim logic.

### The sim

* **Time base.** `SIM_SECONDS_PER_TICK = 1.0`; 1× runs one tick per real second,
  so the crowd walks at true speed. Fast-forward multiplies ticks per second,
  never the step, so determinism is untouched. The one tuning number is in
  `sim/constants.ts`.
* **Determinism.** `seed + tick ⇒ byte-identical crowd`. All randomness draws
  from the single `Rng` in a fixed iteration order. Never add `Math.random`,
  `Date.now`, or unordered iteration into `sim/`.
* **Graph** (`sim/station.ts`). Every walkable cell is a node (a solid cell with
  nothing solid above it and floor speed > 0). Fixed-length vertical equipment —
  escalator, each stair flight — is a capacity-limited edge with a server; a lift
  is one car whose every ordered pair of stops is an edge (see the lift bullet);
  gates, doors and stops are servers too. CSR adjacency; A* with a
  `(from|to|needsClass)` path cache, a per-tick re-path budget, and live queue
  wait folded into edge cost. `PathFinder.search()` bypasses the cache for the
  fare-line gate choice, which must see queues as they are now.
* **The worker** (`sim/worker.ts`, `sim/protocol.ts`) is the only sim code that
  touches `postMessage`. Messages in: `init` / `build` / `control`; out: `ready`
  (graph) / `state` (agent `Float32Array`s, metrics, density, train poses,
  `intervalMs`). Payloads are copied, not transferred; the renderer interpolates
  over `intervalMs`. Each tick is synchronous. `build` is a live edit: it calls
  `World.rebuild()` and keeps the crowd. A station switch (打开 / 新建 / 示例车站)
  re-sends `init`, which calls `World.load()` — a full reset of agents, trains,
  queues, clock and RNG — so no old passenger walks the new document.
* **Zones are barriers** (`sim/zones.ts`), and *only a gate may cross the fare
  line* — if the gate's policy permits that direction. An ungated line strands
  the crowd. A two-way gate is a single lane: first come fixes the direction
  until that side drains (`sim/gates.ts`).
* **Fences are barriers too** (`sim/fences.ts`, 围栏 §5.2). A fence is a 1 m
  thin panel through its cell's middle and its cell is not a walkable node, so a
  dragged run plus the gate row it plugs into divides the floor into areas the
  crowd only crosses at a gate. The renderer builds every panel from its
  neighbours (`fenceArms`), so a straight run is continuous, a dead end caps
  itself, and an L / T / + turns through the shared centre post with no
  overhang.
* **A lift is one car per shaft** (`sim/lifts.ts`, 电梯 §5.1). The piece is a
  2 × 2 m assembly with a 1.5 m carriage, dropped on a floor and serving the
  floor one storey up (`LIFT_RISE`); hovering its upper/lower half grows it a
  storey up/down (`LIFT_EXTEND`). A fresh piece must stand on all four of its
  footprint cells, but extending never checks for floor, so a shaft may run past
  a floorless level (it simply has no landing there). `buildGraph` makes every
  walkable floor in the column a *stop* and gives the single `lift` server an
  edge between every ordered pair, so a rider goes straight to their floor; only
  the anchor (lower-left) cell is a walkable node — the other three shaft cells
  are not, so the crowd never walks through the cabin walls. The car is a real
  state machine (`World.stepLift`: park → open → dwell → close → move, eased),
  and riders are `STATE_RIDING` pinned inside the cabin by `stepLiftRide`, so they
  visibly move with it instead of teleporting; `World.liftRenderState` sends one
  car pose per snapshot.
* **Finishes** (`sim/finishes.ts`): the *family* decides behaviour (floor walk
  speed, track bed not walkable, wall blocks), the finish decides look. The
  renderer reads the same table, so a surface cannot look like one thing and
  behave like another.
* **Placement** (`sim/placement.ts`): every module has a world footprint
  (`moduleEnvelope`); `placementBlocked` refuses overlaps with strict box tests
  (adjacent cells are fine), except that a stair/escalator may pass through an
  exit head-house and room furniture (a shelf / desk / cubicle / sink / bench)
  may stand inside a walled room or booth (`moduleAt` then answers with the
  furniture, not the room). A 广告牌 is *wall-mounted*: `wallMountMissing`
  refuses it unless the facing neighbour — turned by the placement rotation via
  `wallSide` — has a solid block at its first course (`z + 1`, exactly where auto
  walls and the 墙 tool start), and a two-cell banner needs a wall behind every
  cell of its run (`billboardCells`). The 指示牌 and 电视 are instead
  *ceiling-hung*: `ceilingMountMissing` refuses them unless a solid slab sits one
  storey up (`LEVEL_STEPS`, the 4 m grid), the ceiling their rods bolt to. A 2 m
  bench is a real two-cell run — `benchCells` fixes its collision envelope and
  base cells, so it blocks and is found from both cells.
  `carveRampOpenings` (`sim/openings.ts`) opens the slab a ramp climbs through
  while keeping its landings as graph nodes.
* **Rails and lines** (`build/rail.ts`, `sim/track.ts`, `sim/placement.ts`,
  `sim/world.ts`). A rail is a `track` module bound to a line and an `up`/`down`
  direction: a fixed, pre-rendered piece — a car-width bed (`d = 3`) and a run
  the length of the line's consist (`trackPieceForLine`) — placed like equipment
  (centred on the highlighted cell, so the long run grows evenly both ways) with
  **R** to quarter-turn it. `sim/track.ts` is the one orientation source
  (`rotateLocal`/`trackCells`/`edgeCells`/`trackCentre`), so a rail can run
  east–west or north–south and the consist, its screen doors and the platform
  services turn with it. Placing one **digs** its bed course, so the mesher
  exposes the platform edge as a half-metre drop and the module supplies the
  recessed slab and rails; the consist rides at `track.z + 0.5` along the run
  axis with a matching yaw. The train anchor needs only a track — a platform edge
  is for boarding — so a fresh rail runs a train before any screen doors exist.
  `derivePlatformEdges` generates one `platform-edge` per contiguous run of
  walkable exposed floor beside the bed (an island platform yields two — the
  Spanish solution), and `regenerateRailEdges` re-derives them after the floor
  changes. Every derived edge records which side the track lies on (`cfg.side`, read from the screen's own frame and shared by the derive, the renderer and `World.computeLineAnchors`), so the printed header always faces the platform, never the rail. Editing a line's 车型/编组 re-cuts its tracks (`resizeTrack`). A track
  bed is **either** the `floor.track` finish **or** a `track` module's footprint
  (`trackBedKeys` / `isTrackCell`), so the hand-built demo and placed rails agree.
  The 轨道 folder has two tools, both gated by `trackBlockReason`: any interference
  (equipment, a room, a screen door, a ramp, another rail/tunnel) blocks placement
  instead of demolishing it. **站台** places the fixed consist-length piece, which
  must rest on solid floor under its whole bed (`trackFloorMissing`) and refuses a
  run with a wall in its headroom (`trackClearanceBlocked`); **隧道** extends an
  existing rail off the free end nearest the pointer (`makeTunnel`/`placeTunnel`, a
  pure run flagged `cfg.tunnel` that never spawns platform doors; a slider sets the
  length), may hang over void, clears the wall it bores through, and raises a
  side wall + ceiling around itself where missing (`boreTunnel`, shell cells
  tagged `tunnel-shell:<id>`). The placement ghost draws the run's 上行/下行
  direction as arrows (`buildTrack`; Tab toggles it in platform mode), a tunnel
  inherits its source's direction, and `computeLineAnchors` reads the train's
  travel sign from `cfg.dir`, so the button turns the real consist too.
  `station.lines` holds many lines (added in the inspector); each carries
  stock/cars/headway and a power mode, and its colour comes from
  `data/line-colours.ts` (real 广州地铁 sign colours by line number). The whole
  rail panel lives in the left rail's 轨道 folder; its platform-only controls
  (方向 上行/下行, 线路, 重置屏蔽门) show only while placing or editing a platform,
  not a tunnel. The inspector's 线路 card edits the lines themselves; each card
  and the section fold open/closed. `LineDef.upTerminus` / `downTerminus` are the
  per-direction destinations, and every platform screen prints the bound line's
  terminus for its own `cfg.dir` (falling back to 上行/下行), so an up platform
  points where the up track runs. Each line also chooses its 屏蔽门 height
  (`cfg.psd`, 全高 by default): `full` reserves the whole storey with the header
  on a top band, `half` is a 1.5 m screen with the header on the glass; switching
  re-derives every edge on the line (`regenerateRailEdges`), so the model and the
  collision envelope agree (`PSD_FULL_HEIGHT` / `PSD_HALF_HEIGHT`).

### Rendering and the app

* `render/models.ts` builds all module geometry procedurally — turnstiles,
  ticket machines, escalators (rolling step band via `rollEscalator`), the four
  stair shapes, exits, platform screen doors (printed header is FrontSide only, facing the platform read from `cfg.side`), rolling stock. **No image or GLB
  assets.** `render/materials.ts` is the shared procedural material kit;
  `render/chunkMesher.ts` emits one mesh part per finish. There are no named levels: the street is `z = 0` (`GROUND_Z` in `build/model.ts`), a storey is the fixed 4 m editing grid (`LEVEL_STEPS`/`storeyBand` in `sim/constants.ts`) — every solid cell belongs to the grid line at or below it, so a floor and its walls share a storey while a second floor one storey down keeps its own even when a wall column connects them — and the depth rail slices those bands (a plate with nothing below it stays on screen above the cut). The save carries no `levels` field; old saves load with it ignored.
* A **walled facility room** is the one `shop` module type; its fit-out lives in
  `cfg.kind` (`store` / `toilet` / `office`, plus the open `booth` counter and
  the `retail` shell). `build/model.ts`'s rectangle drag creates 商店 / 厕所 /
  办公室 / 售票亭 through it, and `render/models.ts` draws the matching sign —
  厕所 / 办公室 hang a real door on their openings, 商店 keeps an open front. Two
  rooms merge only when their type *and* fit-out match. A room stocks its
  furniture as individual modules now (a store one `shelf` per island row and
  wall run, an office one `desk` per grid spot, a restroom its `cubicle`/
  `sink`, a booth its `bench`), so every unit is right-clickable; the room
  carries `cfg.stocked` and old saves migrate once via `ensureRoomFurniture` in
  `toState`. Deleting a room takes its `cfg.auto` furniture but leaves
  hand-placed pieces.
* The **装饰 folder** holds the free-standing, rotatable pieces — 座椅, 货架,
  办公桌, 厕所隔间 and 洗手池 — plus 广告牌 (wall-mounted) and 电视 / 指示牌
  (ceiling-hung). 座椅 is a nested sub-menu of four variants from `sim/benches.ts`:
  a plain stainless bench with no back and an upholstered seat with a back and
  arm rests, each 1 m or 2 m; the 2 m piece is a real two-cell run. 货架 draws a
  stocked supermarket gondola (perforated back panel, five shelves, price rails,
  instanced goods). 广告牌 is a nested sub-menu of four formats (横版 / 竖版 /
  方形 / 大横版) whose run length and poster aspect come from the shared
  `sim/billboards.ts` table, so the thumbnail, the collision envelope and the
  drawn housing cannot disagree. 电视 and 指示牌 hang by rods from the ceiling and
  print a lit double-sided face, so both read from either side; 电视 cycles the
  shared ad posters while 指示牌 shows a static wayfinding board. Every ad screen
  cycles three procedural, unlit posters on wall time (`SceneRenderer.updateAds`),
  one poster set per aspect so a portrait banner is not a stretched landscape.
  Wall-mounted pieces must bolt to a wall (see `wallMountMissing`), so **R**
  turns the panel's back to it.
* A **售票机 and 自动贩卖机** are the two machine types (`tvm` / `vending`): a
  ticket machine and a drinks machine with the same 1 × 1 m footprint. Both are
  unpaid-zone `stop` servers at `TVM_RATE`, and a quarter of street entries
  (`sampleTripFromStreet`) route through one of the unpaid-zone machines.
* The **地基 tool** has a **自动生成墙壁** toggle (on by default): on, a deliberate drag grows the
  `auto-wall` ring and tags the floor; off, the same click / drag lays untagged bare blocks with no
  ring. There is no separate 方块 tool any more.
* The **围栏 tool** (设备) drags out a straight run like 墙, but lays one 1 m panel
  per cell with the panels following the drag direction (R turns a single); a
  right-drag lifts the run. `app/Viewport.tsx` drives a live fence preview that
  rebuilds the existing runs with the dragged line merged in, so an end you drag
  up to loses its cap as you move (`SceneRenderer.setFencePreview`).
* The **电梯** (设备) draws a full-height shaft in world space (`render/models.ts`
  `buildLift`): corner posts and back/side walls, a threshold sill and green call
  panel at each real landing, and a cabin group left in `userData.liftCabin` whose
  two leaves are registered `doors`. The base cell stays solid (the shaft stands
  on it) but every slab at a stop above is hidden (`SceneRenderer` `hiddenCells`),
  so the mesher cuts a real opening while the graph still sees the nodes.
  `SceneRenderer.setLifts` pairs each 6-float car pose with its shaft and glides
  the cabin / eases the doors between snapshots; the hover finds a shaft via
  `moduleAt` (the lift's envelope reserves the whole 2 × 2 plan) and previews the
  extension, its upper/lower half choosing up/down.
* **An exit is named and selected in both views.** The RHS 出入口 folder lists one
  card per exit (`App.tsx` `ExitCard`): name (Enter/blur commits, and the model's
  street header reprints it), demand and open toggle. The card is the RHS half of
  one selection link — clicking or focusing a control selects the exit, and
  clicking the exit in 3D selects it — so `SceneRenderer.setSelection` draws a box
  around the model and the card gets `.sel`. A click tests the drawn meshes
  (`SceneRenderer.pickModule`) before the collision envelope, so a large
  head-house is selected (or deleted) by any visible part of its model; the 删除
  tool highlights the whole piece red instead of only the block beneath it. A
  fresh exit letters itself for the first free A ~ Z (`nextExitName`), so a new
  one reads `A口` / `B口` / … and a delete frees its letter.
* **Exits come in six variants** (`sim/exits.ts`): 有盖 / 无盖 × 单向 / 双向 /
  三向. `cfg.bays` (1, 2 or 3) sets how many runs the head-house opens — one bay
  at local x = 0, two at ±1, three at −2/0/+2 — and `exitWidth` widens the floor,
  frame and glass to 3.0 / 3.8 / 5.8 m. `cfg.covered: false` drops the canopy and
  walls for a glass railing, but `exitWallPlanes` returns the same barriers, so
  only the look changes; `models.ts` draws the covered piece as a red steel portal
  frame under a blue waved roof. `exitRunSnap` snaps a straight stair/escalator
  dropped inside a head-house into the nearest bay: its upper landing on the
  street, its base one storey down toward the mouth, so the pointer positions the
  run on the floor the exit opens onto. Turning stairs are left un-snapped.
* **View toggles and the bottom bar.** Auto ceiling hiding is always on: a storey
  above the active one keeps only plates with nothing under them, so a room never
  wears its own ceiling. **显示其他层** (`ghostOtherLevels`, now default off) then
  decides whether storeys *below* the active one are drawn as a 35% ghost.
  **隐藏墙壁** (`hideWalls`) fades every wall face and platform screen door to 16%
  with `depthWrite` off and drops their outline. The bottom bar shows FPS and
  方块数 (the old sim-timing and chunk-build metrics were dropped).
* The 地基 tool's *deliberate drag* is not a bare slab: `build/model.ts` tags the
  drawn cells `auto-floor` and raises a 4 m `auto-wall` ring on the patch's outer
  edge — the room-union rule generalised to cells, so overlapping/abutting patches
  union, hand-built floor is continuous ground, and a hole dug through a patch
  stays open. A single click stays a plain block. While previewing, a badge pinned
  to the pointer reads the patch's live 长 × 宽 in metres (`Viewport.tsx`
  `buildMeasure`). The 墙 tool lays tagged
  four-course columns a right-click lifts whole, and 删除 is button-agnostic: it
  lifts a whole module under the pointer (through its own teardown for a rail or
  room), else a single block or a dragged line. A **reserved opening** — the corridor a ramp
  carves or an exit's floor (`reservedOpening` in `sim/placement.ts`) — refuses a
  hand-built cell, so the block brush cannot seal a run the player can see
  through.
* `app/Viewport.tsx` owns the `SceneRenderer` lifecycle and turns pointer input
  into build commands; it is the only app file that touches three directly.
  `app/LeftRail.tsx` is the blueprint build rail; thumbnails are rendered from
  the real models by `app/moduleThumbnails.ts` / `app/zoneThumbnails.ts`.
* `app/store.ts` is zustand: the station document lives here, the sim lives in
  the worker. `app/boot.tsx` is lazy-imported so `app/mobile.ts` +
  `MobileNotice.tsx` can show a plain notice on phones without downloading the
  three.js bundle.
* `/lab` renders `app/Lab.tsx`, the material/renderer lab.

## Conventions

* **Imports carry the file extension** (`./foo.ts`, `./Bar.tsx`) and types use
  `import type`. The tsconfig is strict with `verbatimModuleSyntax`,
  `erasableSyntaxOnly`, `noUnusedLocals`, `noUnusedParameters`.
* **No enums** (`erasableSyntaxOnly`). Use `as const` objects, e.g. `AgentState`.
* **ASCII ids, Simplified Chinese labels** for anything a player reads (§9.2).
* **Pack cell coordinates with `packKey`** (number arithmetic, ±4096 m). Do not
  use bit shifts — the old `(x + 4096) << 20` collided neighbours.
* **Axes:** `+z` is up; `n` is `+y`, `e` is `+x`, `+z` = top face.
* **All tuning numbers live in `sim/constants.ts`** (or `stock.ts`).
* Comments explain *why*, and cite `GAME-SPEC.md` sections.

## Current state

* Milestones **V0–V5 done**, **B1 done**, **B2 core done**. Still open in B2:
  zone inference, module zone-legality feedback for ticket machines, and the gate
  direction/anchor UI. **B3–B6** (capacity kit, draw kit, authored time + charts
  + snapshot, ship) are planned in the spec.
* The **track kit** has landed: rails are fixed, pre-rendered `track` pieces
  sized from the bound line's consist, placed like equipment with **R** to
  quarter-turn them (`build/rail.ts`, `sim/track.ts`, `game/test/rail.test.mjs`).
  The 轨道 folder holds the 站台 tool (the consist-length piece), the 隧道 tool
  (auto-extends a rail off its free end, no platform doors, with a length slider),
  R (旋转), 上行/下行, the bound line, and 重置屏蔽门; the inspector a 线路
  section for multi-line management (名字/颜色/上行终点/下行终点/车型/编组/供电/下车,
  + 新建线路; each card and the section fold open/closed; a trash icon beside the
  colour swatch deletes the line and every track bound to it, `removeLineAndTracks`
  in `build/rail.ts`, undoable; the 下车 slider is per car, so the 载客量 readout
  `编组 × 下车/节` 人/列 and its peak-hour figure follow both the slider and the
  consist);
  a new line wears its real 广州地铁 colour from `data/line-colours.ts`. The line
  owns the direction, and its tracks
  carry it in `cfg.dir`; the line owns 供电 too, and `setLinePower` carries the
  new mode to every track bound to it — 第三轨 draws a guarded conductor rail,
  接触网 an overhead wire under a canopy or tunnel shell — re-cutting them on
  mesh rebuild.
  The README still files the draw kit under **B4** and its milestone table is not
  yet updated. Walled facility rooms (商店 / 厕所 / 办公室) share the `shop` module
  and pick their fit-out with `cfg.kind`; 售票亭 is the open `booth`.
* The **build kit** gained tagged floors with auto walls, the 墙 tool and a
  dedicated 删除 tool (`build/model.ts`, `game/test/walls.test.mjs`). A drawn
  floor patch grows a 4 m auto-wall ring on its outer edge; union with another
  patch drops the buried wall, and a hole dug through a patch stays open. A
  **placed rail's dug bed is covered ground** (`isTrackCell` / `trackAt`): the
  drag never pours a block into the trench, `syncAutoWalls` folds
  `trackFootprintKeys` into the covered set so the ring wraps the patch-plus-track
  area instead of walling the platform edge, and `platformDoorKeys` keeps any
  wall out of a derived screen door. The 墙 tool's `isWallCell` makes
  `wallColumnAt` / `wallColumnsAt` answer an `AUTO_WALL` ring as well as its own
  `WALL` run, so a doorway can be opened through generated walls.
  `reservedOpening` (`sim/placement.ts`) also refuses a hand-built block in a
  ramp corridor or an exit's floor. `game/README.md`'s test list documents it. Named levels are gone (`LevelDef` deleted): the street is `z = 0`, a storey keys each solid cell to the fixed 4 m grid line at or below it (`storeyBand` in `sim/constants.ts`, so a lower floor's wall reaching the floor above cannot merge two floors into one band), exits refuse non-street slabs, and `platform-edge.cfg.side` names the side the track lies on so headers face platforms. The 地基 tool carries a 自动生成墙壁 toggle (default on) instead of a separate 方块 tool.
* The **装饰 kit** has landed (`sim/billboards.ts`, `sim/benches.ts`,
  `sim/placement.ts`, `render/models.ts`,
  `game/test/shelf|desk|restroom|bench|sign.test.mjs`): 座椅 / 货架 / 办公桌 /
  厕所隔间 / 洗手池 are free-standing, rotatable `bench`/`shelf`/`desk`/
  `cubicle`/`sink` modules, a walled room stocks one per layout spot (migrated
  once from the old drawn interior by `ensureRoomFurniture`, guarded by
  `cfg.stocked`; each store wall unit backs its panel onto its own wall).
  座椅 offers four variants from `sim/benches.ts` (stainless / backed × 1 m / 2 m),
  the 2 m run spanning two cells; 货架 draws a stocked supermarket gondola. 广告牌
  is wall-mounted (`wallMountMissing`) with the four formats sharing
  `sim/billboards.ts`; 电视 and the new 指示牌 are *ceiling-hung*
  (`ceilingMountMissing`, lit double-sided). The 设备 folder's 货架 / 座椅 moved
  out to a new 装饰 folder, and 楼梯 / 出入口 / 座椅 / 广告牌 are nested variant
  sub-menus.
* The **围栏 kit** has landed (`sim/fences.ts`, `sim/station.ts`,
  `render/models.ts`, `app/Viewport.tsx`, `game/test/fence.test.mjs`): a fence run
  is dragged out like a wall, its cell is not a walkable graph node, and the
  renderer builds each joint from the neighbours, so a run plus a gate row is a
  barrier the crowd only crosses at a gate.
* The **lift kit** has landed (`sim/lifts.ts`, `sim/station.ts`, `sim/world.ts`,
  `render/models.ts`, `app/Viewport.tsx`, `game/test/lift.test.mjs`): 电梯 is a
  2 × 2 m shaft that serves every walkable floor in its column with one car, grown
  a storey at a time by hovering its upper/lower half. The graph gives the single
  `lift` server an edge between every ordered pair of stops, the car runs the
  open → dwell → close → move cycle and carries `STATE_RIDING` riders pinned
  inside, and the renderer glides the cabin and slides the doors from the worker's
  car poses.
* The **line direction termini** and the inspector's folding landed with it: each
  line carries `upTerminus` / `downTerminus`, and every platform screen prints its
  line's terminus for its own `cfg.dir` (the hardcoded 番禺广场方向 is gone). The
  inspector is now a column of folding `Folder` / `Disclosure` blocks (信息 /
  出入口 / 线路), each exit is an editable, selectable card linked to a 3D
  highlight box (`SceneRenderer.setSelection`), and the view gained a 隐藏墙壁
  toggle with 显示其他层 now defaulting off (auto ceiling hiding is always on).
* The **exit kit** has landed (`sim/exits.ts`, `sim/placement.ts`,
  `render/models.ts`, `app/Viewport.tsx`, `game/test/exits.test.mjs`): 出入口 is a
  nested sub-menu of six variants (有盖 / 无盖 × 单向 / 双向 / 三向). `cfg.bays`
  widens the floor/frame/glass to 3.0 / 3.8 / 5.8 m, `cfg.covered: false` trades
  the red-framed, blue-roofed canopy for a glass railing over the same barriers,
  a straight ramp dropped inside snaps into the nearest bay (`exitRunSnap`), and a
  fresh exit names itself `A口` … (`nextExitName`). The 3D view selects and deletes
  by drawn mesh (`SceneRenderer.pickModule`), so the whole head-house is hit, not
  just its reserved cells.
* The **屏蔽门 and 自动贩卖机** work landed with it: each line chooses 全高 (default)
  or 半高 屏蔽门 (`cfg.psd`), which re-derives its edges and shrinks the screen's
  collision envelope from 3.1 m to 1.5 m; and 自动贩卖机 (`vending`) is a
  TVM-footprint drinks machine that is the same unpaid-zone `stop` at `TVM_RATE`,
  sharing the ticket/vending detour on a street entry.
* The **stock classification** gained the **L** linear-motor car (`sim/stock.ts`,
  `game/test/stock.test.mjs`): `STOCK_CLASSES` (`['A','B','C','L']`) is now the
  single ordering source, so the worker's pose index (`STOCK_CLASSES.indexOf`) and
  the renderer's decode (`STOCK_CLASSES[stockIdx]`) cannot desync, and the
  inspector's 车型 chips iterate it too. L is the 2.8 m wide, 16.8 m long,
  three-door, third-rail 广州 4/5/6 stock. `LineDef.stock` is now the imported
  `StockClass` (a `stock.ts` → `types.ts` edge that stays inside `sim/`). The save
  needs no migration — stock is a plain string with no whitelist.
* `PLAN.md` was deleted, but `README.md`, `GAME-SPEC.md` and many source
  comments still reference it. Treat those references as historical.
* The crowd micro-benchmark (`game/bench/crowd.mjs`,
  `tools/bench-crowd-tick.mjs`) and the `budget` / `pathcache` tests were
  removed. The test suite that remains is listed in `game/README.md` and lives
  in `game/test/`.
* The demo loads `data/reference-station.ts` cold at 07:27 sim time, seed
  `1234567`, warmup 0.

## Deploy (Cloudflare Workers)

Everything is static assets; there is no server runtime beyond the prefix
rewriter. Two Workers, two Workers Builds projects on the same repo, so a push
to `main` ships both:

* `metro` — site, root `wrangler.jsonc`, served at `ericpzh.rest/metro/`.
* `metro-game` — game, `game/wrangler.jsonc`, served at
  `ericpzh.rest/metro-game/` with routes declared in its config.

Route gotchas: each Worker needs **two** routes (bare + `/*`) because `/metro/*`
does not match `/metro`; never collapse them to `/metro-game*` — `*` spans `/`
and would swallow paths belonging to the other Worker. Routes need the hostname
proxied in DNS. See the root `README.md` for the full routing table.

## Testing and changes to sim behaviour

```powershell
cd game
npm test          # node --test "test/**/*.test.mjs"
npm run typecheck
```

Tests import `src/sim/*.ts` directly (and `src/build/rail.ts` for the rail
suite). When you add behaviour to the sim, add a focused `.test.mjs` beside the
others and update `game/README.md`'s test list and milestone notes if the change
is player-visible. Keep `sim/` pure — a test will fail if it imports three,
React, or reaches outside `sim/`.
