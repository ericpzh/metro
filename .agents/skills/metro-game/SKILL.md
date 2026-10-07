---
name: metro-game
description: Work in game/ of the ericpzh/metro repo — the React 19 + three.js + Web Worker metro-building sandbox. Use when changing game/src (sim, builder, renderer, app shell, save format), the module catalogue, rails and trains, the crowd's day, or the metro-game Worker. Covers the dependency rule, the sim's load-bearing invariants and the app/rail architecture.
---

# The game (`game/`)

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

### Conventions

* **Imports carry the file extension** (`./foo.ts`, `./Bar.tsx`) and types use
  `import type`. The tsconfig is strict with `verbatimModuleSyntax`,
  `erasableSyntaxOnly`, `noUnusedLocals`, `noUnusedParameters`.
* **No enums** (`erasableSyntaxOnly`). Use `as const` objects, e.g. `AgentState`.
* **ASCII ids, Simplified Chinese labels** for anything a player reads (§9.2).
* **Pack cell coordinates with `packKey`** (number arithmetic, ±4096 m). Never use
  bit shifts — the old `(x + 4096) << 20` collided neighbours.
* **Axes:** `+z` is up; `n` is `+y`, `e` is `+x`, `+z` = top face.
* **All tuning numbers live in `sim/constants.ts`** (or `stock.ts`).
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

### Placement is one verdict, asked twice

`sim/placement.ts` holds the rules (`blockReason` — may a block be laid here,
answering `opening` / `equipment` / `track` and naming the piece in the way;
`equipmentReason` — may this module stand here) and `build/validation.ts` gathers
a whole preview's worth of them (`checkBlockCells` / `checkModulePlacements` →
accepted cells, refused cells, offending pieces). So the red ghost, the refusal
notice and the release all read one answer, and `moveDropReason` is that verdict
in words. **Never inline a placement rule in a tool**: add it to the verdict and
both the preview and the release get it. `game/test/validation.test.mjs` pins the
agreement cell for cell.

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
  The generated cells wear **`zone: 'outside'` (站外)** and no finish, and that is
  load-bearing rather than cosmetic: `outside`↔`unpaid` is not a fare crossing
  (`crossingDir`), so the plane never invents an ungated fare line around an unpaid
  concourse, while a painted `paid` patch still needs a gate. The live solid set the
  tools read (`app/Viewport.tsx` → `ToolContext.solids`) is the **effective** list,
  or the plane is real to the crowd and the mesher and invisible to the pointer. A
  dig is the one edit that writes the plane — `removeCells` records the `void` at
  grade and nowhere else, and `addCells` / `addFloor` **fill it back** by
  *replacing* that record, which is why both count **blocks** rather than records;
  the 材质 brush materialises the pavement it paints, refused by the same
  `blockReason` the 方块 brush asks and refused outright on a `void`, because a hole
  is not a surface. Two things deliberately stay on the **document's** cells:
  `build/model/Floors.ts`'s 生成墙壁 ring at grade (the plane is one continuous
  floor, so a patch drawn on virgin ground has no outer edge to wall — and
  `BlockTool` hands `addFloor` the preview's own `acceptedCells`, so the release
  lays what the ghost drew) and `build/rail.ts`'s platform-edge derivation (the
  open street beside a track bed is not a platform). `ground.test.mjs` pins both
  halves; `ground-visibility.test.mjs` pins the window as its own mesh pass and the
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
  one car whose every ordered pair of stops is an edge; gates, doors and stops are
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
  foot of its column), the 分区图 draws the storey being edited (`zoneMapFloorsAt`),
  and the folder's sixth tile is 无分区 as the *eraser* (`eraseZoneCells`,
  `isEraseBrush`) — see `zonetool.test.mjs`.
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
* **The worker** (`sim/worker.ts`, `sim/protocol.ts`) is the only sim code that
  touches `postMessage`. Messages in: `init` / `build` / `control` / `restart` /
  `seek`; out: `ready` (graph) / `state` (agent `Float32Array`s, metrics, density,
  train poses, `intervalMs`). Payloads are copied, not transferred; the renderer
  interpolates over `intervalMs`. Each tick is synchronous. `build` is a live edit:
  it calls `World.rebuild()` and keeps the crowd. A station switch (打开 / 新建 /
  示例车站) re-sends `init`, which calls `World.load()` — a full reset of agents,
  trains, queues, clock and RNG — so no old passenger walks the new document.
  `restart` calls `World.restart()`: it empties every agent, train and queue and
  reseeds the RNG, but keeps the document and the clock (the top bar's 重启 button).
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
  run. `buildGate` (`render/models/`) is the 广州地铁 photo gate: a 1250 mm machine
  with a 957 mm shoulder and a head tapering at 115° (its top shorter than its base,
  via `prism`), a stainless body, a navy head carrying the tilted screen, the round
  reader, the QR window and the lane lights, a black fascia with a single **up** green
  arrow, and the translucent red leaf.
* **Fences are barriers too** (`sim/fences.ts`, 围栏 §5.2). A fence is a 1 m thin
  panel through its cell's middle and its cell is not a walkable node, so a dragged
  run plus the gate row it plugs into divides the floor into areas the crowd only
  crosses at a gate. The renderer builds every panel from its neighbours (`fenceArms`),
  so a straight run is continuous, a dead end caps itself, and an L / T / + turns
  through the shared centre post with no overhang. A gate neighbour counts only on its
  machine side (`gateSolidFaces`), and `railLandingAt` also treats a stair/escalator
  landing as a neighbour, so a run butts up to the handrail instead of stopping short.
  A run reserves exactly the tile it stands in, so the cell beside it is free ground
  and `placementBlocked` needs no exemption for that pair (only a single piece wider
  than a cell — an old 1.6 m stair, or a 2–3 lane turning stair — reaches its neighbour
  at all). A run met by **flat** equipment is measured by the body it draws
  (`collisionBoxes` → `openings.ts` `rampBodyBoxes`) instead of by that reservation:
  one box per tile, cut to the slope *at* that tile, and a stair's treads stop half a
  landing cell short of each landing (`stairTreadTrim`). So a stair's landing tiles and
  any slab the flight merely climbs *underneath* are free ground — a 围栏, a 闸机 or a
  bench stands at the head of a well or over the low half of a flight, which is how the
  demo guards each of its platform stairs — while two runs still meet on the full
  envelope and can never share a landing. An escalator is the exception: its truss,
  step band and balustrades run landing centre to landing centre, so every tile of its
  run, landings included, is its own. A fence *on* a landing is read the same way as
  one beside it: the fence cell is not a walkable node, so that flight drops out of the
  walk graph and fencing the head of a stair really closes it off.
* **A stair is lanes** (`sim/stairs.ts`, §5.1). Tab cycles three **sizes**, which the
  action tile names 窄 / 中 / 宽 (`STAIR_WIDTH_LABELS`, `stairWidthLabel`) rather than
  quoting a width — a straight stair is one, two or three **lanes**, each exactly
  `ESCALATOR_BAND` (0.68 m) and each fitting one cell. `stairLanes(width)` reads the
  tool's width (a width that is not a whole number of lanes — an old 1.6 m stair — reads
  as the nearest) and `planStairLanes(base, rot, lanes, placeable)` picks where the
  flight goes: the hovered cell as the first lane, then shifted back one lane at a time,
  so it butts against whatever stands beside it instead of overlapping, and flagged when
  nowhere fits. Neighbouring lanes always **join their steps** — `buildStairFlight` runs
  each flight's treads and risers out to the cell edge — but being *one* staircase is a
  property of the pieces: every lane of a wide stair laid in one action carries the same
  `cfg.flight` token, and only along a seam between lanes sharing it does the model drop
  the stringer, handrail and posts and does `sim/station.ts` leave out the balustrade
  wall, so the crowd may cross between lanes at the landings. A side a **wall hugs from
  bottom to top** (`stairWallSides(...)`) loses its handrail, rail posts and newel return
  the same way — the wall is the barrier there — but keeps its stringer; the wall must
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
  railings too. Anything that measures a flight's body (the carve, `rampBodyBoxes`,
  `rampSlopeCuts`, the envelope, `rampWalls`, `stairWallSides`, `stairTurnCells`) has to
  read `stairFlightSlides`. The two hands are two pieces, not one turned: **R** rotates
  the whole stair about its base and never swaps the hand. A 180° turn lands on a **row**,
  not a shared cell, so the crowd has to walk it: `sim/station.ts` cuts each flight's
  balustrade wall off at the flight end that meets an interior landing
  (`stairTurnConnectors`), because the 0.6 m over-run an outer landing keeps would seal
  the landing's own cells apart and leave the two flights disconnected. A stair's
  **walking surface is a finish of its own** (`stair.cfg.finish`, 材质): its treads,
  risers and half-landing platform are one material, chosen by the floor it climbs from
  unless the player painted the piece (`paintStairSurface`), and that finish reaches the
  ground under the run, since the cut's cap is the piece's own surface. A turning stair's
  half-landing floor is the **stair's** cell: `addEquipment` lays it, the mesher skips it
  (the model draws the platform) and `removeModule` takes it back out with the piece.
  `isMovableModule` refuses a stair outright, so it leaves and returns through delete and
  place.
* **A lift is one car per shaft** (`sim/lifts.ts`, 电梯 §5.1). The piece is a 2 × 2 m
  assembly with a 1.5 m carriage, dropped on a floor and serving the floor one storey up
  (`LIFT_RISE`); hovering its upper/lower half grows it a storey up/down
  (`LIFT_EXTEND`). A fresh piece must stand on all four of its footprint cells, but
  extending never checks for floor, so a shaft may run past a floorless level (it simply
  has no landing there). `buildGraph` makes the walkable floor tile in front of the cabin
  door (`liftLandingCells`, turned by the piece's `rot`) at every storey a *stop* and
  gives the single `lift` server an edge between every ordered pair, so a rider goes
  straight to their floor. The whole 2 × 2 footprint is cabin interior and is never a
  walkable node, so the crowd boards and alights only through the door the model draws.
  The car is a real state machine (`World.stepLift`: park → open → dwell → close → move,
  eased), and riders are `STATE_RIDING` pinned inside the cabin by `stepLiftRide`, so
  they visibly move with it; `World.liftRenderState` sends one car pose per snapshot.
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
  dropped to that wall's own storey floor (`storeyBand`) — so an ad can bolt to the
  station wall across the track where there is no floor in front of it. The **hanging**
  指示牌, the 电视, the 时钟 and the 监控 are instead *ceiling-hung*:
  `ceilingMountMissing` refuses them unless a solid slab sits above every cell of the
  piece one storey up (`LEVEL_STEPS`, the 4 m grid), and `ceilingMountStandCell` resolves
  the hover to the floor the piece hangs over from any face. A 指示牌's **wall** mount is
  the panel rule again rather than this one: one piece, two palette tiles
  (`sign-ceiling` / `sign-wall`), and the mount lives in `cfg.mount` (`SignMount`,
  `sim/sign.ts`) so `isWallMounted` / `isCeilingHung` / `wallMountCourses` ask the module.
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
  tile-sized run (an escalator, a stair lane) reaches nothing beside it. A **半墙** the
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
  direction: a fixed, pre-rendered piece — a car-width bed (`d = 3`) and a run the length
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
  printed header always faces the platform, never the rail. That same side sets the
  consist's **door-side mask** (`LineAnchor.doorSides`, the 10th value of a train pose),
  and the door cadence itself is `doorRunOffsets` off the rail, so the train opens only the
  bank that meets screen doors. Editing a line's 车型/编组 re-cuts its tracks
  (`resizeTrack`). A track bed is **either** the `floor.track` finish **or** a `track`
  module's footprint (`trackBedKeys` / `isTrackCell`), so the hand-built demo and placed
  rails agree. The 轨道 folder has two tools, both gated by `trackBlockReason`: any
  interference blocks placement instead of demolishing it. **站台** places the fixed
  consist-length piece, which must rest on solid floor under its whole bed
  (`trackFloorMissing`) and refuses a run with a wall in its headroom
  (`trackClearanceBlocked`); **隧道** extends an existing rail off the free end nearest the
  pointer (`makeTunnel` / `placeTunnel`, a pure run flagged `cfg.tunnel` that never spawns
  platform doors; a slider sets the length), may hang over void, clears the wall it bores
  through, and raises a side wall + ceiling around itself where missing (`boreTunnel`,
  shell cells tagged `tunnel-shell:<id>`). The placement ghost draws the run's 上行/下行
  direction as arrows (`buildTrack`; Tab toggles it in platform mode), a tunnel inherits
  its source's direction, and `computeLineAnchors` reads the train's travel sign from
  `cfg.dir`. `station.lines` holds many lines (added in the inspector, `LineCard`); each
  carries stock/cars/headway and a power mode, and its colour comes from
  `data/line-colours.ts` (real 广州地铁 sign colours by line number). Platform-only
  controls (方向, 线路, 重置屏蔽门) show only while placing or editing a platform, not a
  tunnel. `LineDef.upTerminus` / `downTerminus` are the per-direction destinations, and
  every platform screen prints the bound line's terminus for its own `cfg.dir` (falling
  back to 上行/下行). Each line also chooses its 屏蔽门 height (`cfg.psd`, 全高 by default):
  `full` reserves the whole storey with the header on a top band, `half` is a 1.5 m screen
  with the header on the glass; switching re-derives every edge on the line
  (`regenerateRailEdges`), so the model and the collision envelope agree
  (`PSD_FULL_HEIGHT` / `PSD_HALF_HEIGHT`).
* **`STOCK_CLASSES` (`['A','B','C','L']`) is the single ordering source** (`sim/stock.ts`), so
  the worker's pose index (`indexOf`) and the renderer's decode (`STOCK_CLASSES[stockIdx]`)
  cannot desync, and the inspector's 车型 chips iterate it too. L is the 2.8 m wide, 16.8 m
  long, three-door, third-rail 广州 4/5/6 stock. `LineDef.stock` is the imported `StockClass`
  (a `stock.ts` → `types.ts` edge that stays inside `sim/`); the save needs no migration,
  because stock is a plain string with no whitelist.
* **Both ends of a train are cabs, and the doors follow the screens.** `buildTrain`
  (`render/models/`) re-skins the last 2 m of each end car through `buildCab` — the dark face
  mask, centre windscreen and crew-door windows, the 广州地铁 mark (`drawMetroMark`, shared with
  the exit banner), twin round lamp clusters and corner marker bars, the cream bumper band, the
  number plates and the coupler — so the body stays exactly `cars × carLength` long, the cab
  stops short of the car's first passenger door, and only the coupler hangs past the nose. The
  two ends differ only in their lamps (the `headlight` / `taillight` unlit materials). Door
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
  no-platform cases and one train per track on a two-direction line; `stock.test.mjs` the cadence.
* **The crowd's day is four document fields** (`sim/clock.ts`, `sim/demand.ts`,
  `sim/constants.ts`, `sim/world/World.ts`, `build/model/State.ts`, `persistence/save.ts`).
  日期类型 / 营业时间 / 高峰时段 / 客流曲线 are `StationData.service` / `peaks` / `demand` /
  `calendar`, saved per station, repaired per field on load and re-normalized on every
  `rebuild()` (`World.day` + `World.calendar`), so an edit lands through the same path a
  save does. `periodOf(simTime, service, peaks)` checks **shut first** — a station that
  opens at 08:00 is not in its 高峰 at 07:00 — and `DEFAULT_SERVICE` is 06:30–23:30.
  `DAY_TYPE_FACTOR` is 工作日 1.0 / 周六 0.45 / 周日 0.35 / **节假日 1.15** (a holiday is the
  crush, not the lull). `demandSeries` samples a **uniform grid** so the last point closes
  onto the first for any step. `LOS_LABELS` is the single map both the status bar and the
  时刻 strip print. The knobs span 0–2.5 (peaks) and 0.4–2 (sharpness); a value past its
  slider is repaired by `normalizeDemand`, never refused. **The calendar is the 2026
  arrangement** (`DEFAULT_CALENDAR`: 国务院办公厅 国办发明电〔2025〕7号, day 0 =
  2026-01-01) and the day type is **derived, never picked**: `dayTypeOf` reads holidays
  first, then 调休 workdays, then the weekday. `normalizeCalendar` repairs rather than
  refuses (`02-30` becomes `02-28`), and `normalizePeaks` keeps the peak pair in order —
  早高峰 ends no later than 晚高峰 begins. `monthGrid` lays a Monday-first month of whole
  weeks so the view is pinned by a test, and `simTimeAtDate` turns a picked date plus the
  kept time of day into sim seconds. **The pick is a seek**: `SimSlice.seekToDate` keeps
  the time of day, posts a `seek`, and `World.seek` moves the clock and drops the
  absolute-time dispatch schedule (a backwards scrub would otherwise stall every train)
  while the crowd, queues, trains and counters stay. The chart's six boundaries (both
  营业时间 ends, both peaks') are grips on the curve itself (`curveBoundaries`: draft on
  move, one undo frame and one rebuild on release, arrow keys nudge-and-commit as one
  step). `game/test/clock.test.mjs`, `demand.test.mjs` and `line-edit.test.mjs` (the store
  half) pin it.
* **A consist is a cabin the crowd rides in** (`sim/stock.ts`, `sim/agents.ts`,
  `sim/world/World.ts`, `render/models/pieces/TrainModel.ts`,
  `game/test/train-cabin.test.mjs`). The alighting wave is not dumped onto the platform at
  door-open: the whole cohort is **seated in the doorway queues it will leave by at
  dispatch** (`World.loadAlighting` / `seatAlighter`), so the car draws full as the train
  runs in. `stock.ts` owns the cabin box both sides are cut from (`cabinSlot`,
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
* **The 移动 action moves a placed 设备 / 装饰 piece** (`isMovableModule` / `movedModule` /
  `moveCandidate` / `moveDropReason` in `sim/placement.ts`, `replaceEquipment`,
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
  `wallMountStandCell` and a hung fitting through `ceilingMountStandCell`
  (`MoveController.moveAnchorAt`, reading the placed module's own mount), and either
  previews with no floor cursor: the ghost is the highlight. The ways out are a left press
  on the ground, the card's 确认 (or `Enter`), and 取消 / `Esc` / a right press. A ghost
  carries a private id (`MOVE_GHOST_ID`), because a 指示牌's printed plate and a 电视's
  station plate are cached per module id and a preview may only dispose what it minted
  itself. Structural pieces — 楼梯 / 扶梯 / 电梯, 出入口, rooms, 轨道 / 站台门 — are refused:
  a translation would strand the openings they carved and the geometry derived from them.

## The document and the demo station

* **Both boundaries repair rather than refuse.** `persistence/save.ts` owns the `metro-save`
  v1 envelope (`SAVE_FORMAT`, `SAVE_VERSION`, `serialize`, `parse`); a refusal (`文件损坏` /
  不是地铁车站存档 / 存档太新了 / 缺少车站数据) is reserved for a broken **envelope**, and never
  partially loads. Everything else is repaired by the one grid rule in `build/model/State.ts`:
  `isGridCell` / `isGridModule` / `repairGrid` drop cells and modules at fractional coordinates
  no tool can address (a pick names whole cells, `removeCells` matches an exact coordinate), and
  `parse` reports `droppedCells` / `droppedModules` so the 打开 notice can say the station was
  repaired. Nothing in the game can *mint* an off-grid cell: a pick names whole cells
  (`render/pickCell.ts`), pinned against real meshed geometry by `test/pick-cell.test.mjs`.
  `test/grid.test.mjs` is the guard on the commands downstream of the pick — extend it if you add
  a tool that writes cells — and `save.test.mjs` pins both boundaries.
* **The demo is the author's real 动物园 (广州地铁 5号线) save**, shipped as
  `data/demo-station.json` (12,035 cells, 397 modules, seed `7654321`) and handed out by
  `referenceStation()` as a `structuredClone` so an edit never leaks back into the shared
  document. It opens cold at 07:27 sim time, warmup 0 (`REFERENCE_BOOT` in
  `data/reference-station.ts`), and `app/boot.tsx` seeds the world from `station.seed`, so a cold
  boot and an 打开 of the same document run the same crowd. The old hand-built Wusi Square rig
  moved to `test/support/scenario-station.ts`, so the capacity / stair / escalator / opening tests
  keep their controlled knobs; `demo.test.mjs` guards that the shipped save is one connected
  circulation that actually boards and clears a crowd. **Refreshing it** (the author keeps editing
  the station): `node tools/bake-demo-station.mjs [动物园.metro.json]` parses the author's save
  envelope with the game's own loader and writes `toData(toState(…))` — the document the open path
  builds — as one line with no trailing newline, so the demo cannot carry anything a load would
  have repaired away. After a refresh, re-check `data/reference-station.ts`'s header comment and
  the demo facts `placement.test.mjs` pins, and make sure `demo.test.mjs` still passes.

## Rendering and the app

* `render/models.ts` is a **dispatcher + barrel** over `render/models/` (the
  `PieceBuilder` base + shared kit, and one `pieces/*Model.ts` per piece). It builds all
  module geometry procedurally — turnstiles, ticket machines, escalators (rolling step
  band via `rollEscalator`), the five stair shapes, exits, platform screen doors (printed
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
  There are no named levels: the street is `z = 0` (`GROUND_Z`), a storey is the fixed 4 m
  editing grid (`LEVEL_STEPS` / `storeyBand`) — every solid cell belongs to the grid line
  at or below it, so a floor and its walls share a storey while a second floor one storey
  down keeps its own even when a wall column connects them — and the depth rail slices
  those bands. The save carries no `levels` field; old saves load with it ignored.
* A **walled facility room** is the one `shop` module type; its fit-out lives in
  `cfg.kind` (`store` / `toilet` / `office`, plus the open `booth` counter and the `retail`
  shell). The rectangle drag runs through `placeFacility` (`build/model/Facilities.ts`) to create
  商店 / 厕所 / 办公室 / 售票亭, and the matching model draws the sign — 厕所 / 办公室 hang a real door on
  their openings, 商店 keeps an open front. Two rooms merge only when their type *and*
  fit-out match. A room stocks its furniture as individual modules (a store one `shelf` per
  island row and wall run, an office one `desk` per grid spot, a restroom its
  `cubicle`/`sink`, a booth its `bench`), so every unit is right-clickable; the room carries
  `cfg.stocked` and old saves migrate once via `ensureRoomFurniture` in `toState`. Deleting
  a room takes its `cfg.auto` furniture but leaves hand-placed pieces. A room's walls meet
  at **square** corners — `mitreCap` is deleted — with the west/east panel taking the corner
  cell's outer half across the cell's whole depth and the south/north panel stopping one
  `WALL_T` short to butt its inner face, so three quarters of the corner cell are wall and
  the room-facing quarter is left free for furniture (`room-model.test.mjs` pins the square
  ring, the empty quarter, and that every wall mesh is a `BoxGeometry`). Rooms and the booth
  wear no name plate. The 房间 folder's tiles are line icons of use (商店 / 售票亭 / 办公室 /
  厕所), not colour chips, and `app/zoneThumbnails.ts` renders the 分区 brushes alone. Brush
  ids are `store` / `toilet` / `office` / `ticket` (the walled rooms share the `shop`
  module, the booth is `booth`). The **售票亭** (`buildBooth`) is hand-built geometry rather
  than voxels, and it must be a **closed box inside the module's own cells** — every side
  measures *inward from that side's outer face*, the west and east counter runs own the four
  corner squares while the north and south runs butt between them, and the four glass sheets
  run out to each other's inner faces with a corner mullion over every joint
  (`booth-model.test.mjs` pins the box).
* The **装饰 folder** holds the free-standing, rotatable pieces — 座椅, 货架, 办公桌,
  厕所隔间, 洗手池, 垃圾桶, 灭火器 and 门 — plus 广告牌 and the **墙面指示牌** (wall-mounted,
  `wallMountMissing`) and 电视 / **吊挂指示牌** / 时钟 / 监控 (ceiling-hung) — the 指示牌
  being one piece with both mounts, offered as two tiles (`sign-ceiling` / `sign-wall`) and
  read from its own `cfg.mount`. 座椅 is a nested sub-menu of four variants from
  `sim/benches.ts`: a plain stainless bench with no back and an upholstered seat with a back
  and arm rests, each 1 m or 2 m; the 2 m piece is a real two-cell run. 货架 draws a stocked
  supermarket gondola (perforated back panel, five shelves, price rails, instanced goods).
  垃圾桶 is the stainless double bin (`buildBin`) and 灭火器 the red steel cabinet on four
  legs (`buildExtinguisher`); both are cosmetic — no server, no stop — and both count as
  room furniture. 门 (`sim/doors.ts`) is the folder's one **doorway**: a threshold, a post at
  each end, a head across them and the leaf hung between, so the piece carries its own frame
  and stands on a floor tile like a 货架 — it is *not* wall-mounted (`WALL_MOUNTED` leaves it
  out) and it reserves its whole cells from the floor top to its head. Four variants, 单开 /
  双开 × 不锈钢 / 木, and **R** turns it; nothing on a leaf is glazed, and every fitting
  stands proud of the leaf's face by `DOOR_FRAME`'s own stand-off, because a plate lying a
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
  built page while every unit test passed), which is why the ring is `openEnded`. 监控 is the
  bracketed bullet camera (`buildCctv`) — the drawn housing is under 8% of the cell it
  reserves; both are cosmetic props hung the whole storey and neither is room furniture.
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
  **single-sided** — its station board (line shield, 本趟/下趟/第三趟 cards, clock) and its
  content window both ride the local −y face, so the back is a plain dark panel — and every
  lit pane there lies over a dark backing slab, so it must stand half a slab out plus
  `LIT_STAND_OFF` (`test/tv-screen.test.mjs` pins the sampling, the depth and the tiling).
  `电视` cycles the shared ad posters in that window, each screen rolling its own period, and
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
  (`autofaceWallMount`) — a valid turn is kept so flipping a panel between two walls still
  works, and the pointer's aim breaks a corner tie. A wall/ceiling piece is highlighted as
  itself, never as the floor beneath it: the build preview, the 选择 hover ghost, the 删除 red
  ghost and the 移动 ghost all draw the piece with `setCursor(null)` — selection still commits
  the blue `setSelection` box round the model, picked from the drawn mesh (`pickModule`) before
  the cell. **Three more wall pieces sit beside it.** 玻璃板 (`sim/glassPanels.ts`, six sizes)
  is the 围栏's wall-mounted cousin: **one outer frame** round the whole run, with a single
  pane between them. 站名 (`sim/calligraphy.ts` + `render/calligraphyFace.ts`) is the
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
  **半墙 / 上三角块 / 下三角块** cut tiles are **click-only** (each arms its own mode). The
  deliberate drag also tags its cells `auto-floor` — the room-union rule generalised to cells,
  so overlapping/abutting patches union, hand-built floor is continuous ground, and a hole dug
  through a patch stays open — while a single click stays a plain block. A badge pinned to the
  pointer reads the patch's live 长 × 宽 in metres (`Viewport.tsx` `buildMeasure`). A
  **reserved opening** — the corridor a ramp carves or an exit's floor (`reservedOpening`) —
  refuses a hand-built cell, so the block brush cannot seal a run the player can see through.
  The 墙 tool lays tagged four-course columns a right-click lifts whole, and 删除 is
  button-agnostic: it lifts a whole module under the pointer (through its own teardown for a
  rail or room), else a single block or a dragged line.
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
  crowd all treat it as a wall. The mesher draws the 半墙 by squashing the square profile
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
  the sawn plane (`wedgeSlope`). `thinWallCells` / `thinWallSideMap` hand out a `CellShape`
  (`{kind:'half'}` | `{kind:'triangle'}`) rather than a bare `WallSide`, which is the type the
  mesher, the build ghost, the chunk hash and `facePresent` all read. The three cut pieces are
  **three rail tiles** — **半墙**, **上三角块**, **下三角块** — and an armed one folds out a
  **旋转 row under its own tile** (`cutAnchor` is the cut's tile *and* its action anchor, so
  the row arrives through the very `ActionRow` a 座椅's 旋转 does), which steps the counter
  **R** turns (`rotateWallSnap`).
* The **围栏 tool** (设备) drags out a straight run like 墙, but lays one 1 m panel per cell with
  the panels following the drag direction (R turns a single); a right-drag lifts the run.
  `app/Viewport.tsx` drives a live fence preview that rebuilds the existing runs with the
  dragged line merged in, so an end you drag up to loses its cap as you move
  (`SceneRenderer.setFencePreview`).
* The **电梯** (设备) draws a full-height shaft in world space (`buildLift`): corner posts and
  back/side walls, a threshold sill and green call panel at each real landing, and a cabin
  group left in `userData.liftCabin` whose two leaves are registered `doors`. The base cell
  stays solid (the shaft stands on it) but every slab at a stop above is hidden
  (`SceneRenderer` `hiddenCells`), so the mesher cuts a real opening while the graph still sees
  the nodes. `SceneRenderer.setLifts` pairs each 6-float car pose with its shaft and glides the
  cabin / eases the doors between snapshots; the hover finds a shaft via `moduleAt` and
  previews the extension, its upper/lower half choosing up/down.
* **An exit is named and selected in both views.** The RHS 出入口 folder lists one card per
  exit (`app/windows/inspector/ExitCard.tsx`): name (Enter/blur commits, and the model's street
  header reprints it), demand and open toggle. Clicking or focusing a control selects the exit,
  and clicking the exit in 3D selects it, so `SceneRenderer.setSelection` draws a box around
  the model. A click tests the drawn meshes (`SceneRenderer.pickModule`) before the collision
  envelope, so a large head-house is selected (or deleted) by any visible part of its model; a
  fresh exit letters itself for the first free A ~ Z (`nextExitName`), and a delete frees its
  letter. **Exits come in six variants** (`sim/exits.ts`): 有盖 / 无盖 × 单向 / 双向 / 三向, and
  their runs always stand **side by side**. `cfg.bays` (1, 2 or 3) is how many adjacent columns
  the house holds, and `exitSpan` builds the plan around that group with one full block of
  floor each end, so `exitWidth` is 3 / 4 / 5 blocks. `cfg.covered: false` drops the canopy and
  walls for a glass railing, but `exitWallPlanes` returns the same barriers, so only the look
  changes; the covered piece is a red steel portal frame under a blue waved roof, and the exit's
  name board moves with the roof (有盖 hangs it at the street doorway meeting the roof
  underside; 无盖 lays the same board over the *mouth* railing's glass, which carries it).
  `exitRunSnap` snaps a straight stair/escalator dropped inside a head-house into the column
  under the pointer, clamped to the bay group; turning stairs are left un-snapped. A
  head-house's plan is `cfg.bays` **alone**, and `exitRunOpenings` walks the runs actually
  placed and keeps the ones that fixed span covers.
* **View toggles and the bottom bar.** The level slice is `render/levelSlicing.ts` (pure,
  covered by `test/level-slicing.test.mjs`): **显示其他层** (`ghostOtherLevels`, default on) is
  all-or-nothing — off, the edited storey is the *only* thing drawn at every camera angle; on,
  the active storey stays crisp and the rest are 35% ghosts that keep their depth.
  **隐藏天花板** (`autoCeiling`, default on, `H`) is the one exception above the active storey:
  a slab one storey up is that room's ceiling, so with the toggle on a storey above keeps only
  the pieces with nothing under them (the chunk mesher's `float` plate, a fixture whose column's
  lowest storey is above the active one). It only has an effect while 显示其他层 is on.
  **隐藏墙壁** (`hideWalls`) fades every wall face and platform screen door to 16% with
  `depthWrite` off and drops their outline — except while a **剖切** cut is on, where a wall
  goes completely instead. **隐藏UI** (`hideUI`, `U`) is the mode that hides no interface: it
  takes the editing lattice and the storey slice away and draws the station whole. **The crowd
  obeys the same storeys**: `crowdVisible`, never a storey above the active one, and the depth
  cutaway clips the agent meshes too. **Trains are sliced like everything else** — a consist is
  tagged with the storey of the floor block it stands on (`storeyBand` of the rounded track
  surface), and `applyGroupLevel` combines the slice with the sim's own `parked` flag. **The nav
  cube only moves the camera**: no face, corner, Home click (⌂ or `Ctrl+H`), arrow or
  lens-slider drag may rewrite the slice. The top bar's 重启 button empties the crowd, trains and
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
  `app/store.ts` barrel — the piece, its `rot` and every Tab cycle, `gateDoor` included, plus the
  方块 tool's `halfWall` mode and wall-face cycle) so the effect re-runs, and the renderer's ghost
  identity
  (`render/moduleGhostKey.ts`) has to name the same setting — a stair's painted `finish`
  included — because `SceneRenderer.setModulePreview` skips a rebuild whose key is unchanged.
  Naming a setting in only one of the two is a stale ghost that only a pointer move clears
  (`gate-door.test.mjs` pins both halves).
* **A variant family is one row in one table.** `app/store/catalog.ts`'s `MODULE_FAMILIES`
  (`ModuleFamily` = key + label + folder + the ids it `owns` + its variants' tile label) is read
  by every half of that UI: `familyOptions` is the sub-menu, `familyAnchor` the parent tile,
  `familyFor` / `subMenuForModule` the rail's single open slot, `actionsAnchorFor` where the
  action row folds out, `folderTiles(folder)` a folder's tiles **in rail order** (with
  `RAIL_ORDER` the one place that order is written down), and the folder header's count. The
  cut pieces themselves are `CUT_MODES` beside the family table (one row per piece: label and
  glyph, its own `cutAnchor`). `rail/shared/TileGrid.tsx` is the one grid the 设备 and 装饰
  folders render, and `rail/menus/VariantMenu.tsx` the one variant list for every family.
  Adding a family is one row; `test/rail-families.test.mjs` pins the contract — including that
  **a predicate answers for a palette id exactly as for the module type it builds**
  (`isDecorType('sign-ceiling')`), because the rail folds a folder open and the tool guards a
  right-click by the **id** it is armed with, before any module exists. **The action row is one
  component for the whole rail** — `rail/actions/ActionRow.tsx` holds the fold, the open rule
  (`actionRowOpen`) and every action tile (旋转 / 自定义 / 窄 中 宽 / 上行-下行 / 有门-围栏), and
  the **工具 folder mounts the very same row** under its cut pieces. The 旋转 tile is
  `rail/shared/RotateTile.tsx` (one glyph and one **R** badge for the piece, a cut piece, a
  轨道 run and the 剖切 surface alike); which tile a row belongs to is one derivation for pieces
  and cuts alike (`rail/helpers.ts` `armedTiles` → `armedRailTile` / `armedActionsAnchor`).
  **No tile anywhere carries a tooltip** (`Block` has no `title` at all): `aria-label` — not
  `title` — is how an icon-only control is named. `app/LeftRail.tsx` is a barrel over
  `app/rail/`; thumbnails are rendered from the real models by `app/moduleThumbnails.ts` /
  `app/zoneThumbnails.ts`.
* **The 材质 brush keeps its mode.** `N` 单块 / `M` 整面 are the 材质 folder's own setting
  (`paintBaseMode`), not a property of a tile: clicking a finish tile — or a fresh 搪瓷板
  colour, which reaches the brush in the same click — leaves the mode alone, so it survives a
  detour through another folder on the left rail. `P` 吸取 (the 工具 folder's eyedropper) lifts
  a bare face's finish into the brush and a placed piece into the placement; a **指示牌** is
  copied as its own printed **boards** (`SignSlice.adoptSignBoards`), not merely as its tile,
  and the whole gesture is put back by **Esc** through the `PickSlice` draft the picker notes
  before it writes (`beginPick` / `cancelPick` — the tool, the piece, its settings, the brush
  and the boards); the rail scrolls to the armed tile as it changes (`armedRailTile` +
  `revealScrollDelta`, run twice so the 280 ms fold has settled). `paint-mode.test.mjs` and
  `pick-tool.test.mjs` pin them.
* **The 指示牌 board is a document with an editor** (`sim/sign.ts`,
  `app/windows/sign/`, `render/signFace.ts`, `render/pictograms.ts`, §5.8). The board is an
  ordered list of components (arrows, line badges, text, icon labels) laid out in metres and
  dragged in the board editor. A sign is **two boards**, front and back — independent documents,
  either of which may be empty, and an empty side is the unlit black plate — but that pair is
  the **hung** board's (`signMountSpec(...).doubleSided`); a **wall** 指示牌 mounts 正面 alone.
  `signPanelSize` sizes the panel to what it carries between a floor and a ceiling, so a board
  never grows into a wall. `sim/sign.ts` is pure (no DOM, canvas or three): `signFace.ts` owns
  the only pixels and the editor the drag surface, both reading the same geometry, so the editor
  preview, the hover ghost and the lit face are one layout drawn three times. Six of the eight
  pictograms are thresholded photo-to-bitmap assets (`tools/prep-sign-icons.py` turns
  `tools/sign-icons-source/` into `src/assets/pictograms/`), and two marks are **drawn
  geometry** instead — the green 出口/EXIT plate and the red 禁止 roundel, listed in
  `SIGN_DRAWN_ICONS` (`signIconIsDrawn`), which is what `pictograms.ts` asks before reporting a
  missing asset (`tools/sign-icons-sheet.py` prints the contact sheet for review).
* **The 删除 drag sweeps same-type runs** (`app/sweep.ts`, §9.5). A tap removes the piece under
  the pointer; a held drag keeps collecting same-family neighbours — rotation and 自动 origin
  ignored, variant matched, so a 2 m 座椅 never takes the 1 m ones and a 闸机 row never takes the
  售票机 at its end — sampling the path between pointer events so a fast flick skips none, and
  the release bulldozes the run in **one** commit (one Ctrl+Z puts it back). Rooms, rails,
  出入口, 楼梯, screen doors and 围栏 are never swept — one piece, own teardown — while a bank of
  **escalators** or of **lift** shafts does sweep, each strictly inside its own family; that pair
  is a deliberate divergence from §9.5, which lists both as unsweepable, and `test/sweep.test.mjs`
  is where the decision is written down. `sweep.ts` is the one app module written browser-free so
  Node can import it.
* **The 广告牌 / 电视 posters are a catalogue, cropped never stretched** (`sim/billboards.ts`
  `AD_POSTERS`, `render/adArt.ts`, `render/panelUv.ts`). Twelve campaign slugs in
  `src/assets/posters/`, each tagged with the silhouettes it is cut for, so a panel is only ever
  offered artwork cut for its own shape; `panelUvWindow` takes the centred fitting crop and
  `croppedPlane` walks it in three's UV order, and every offered crop stays under 1.45×. The
  posters live beside the code as `posters/`, not `ads/` — EasyList blocks `/assets/ads/*`, which
  in dev would reject the importing module's whole graph. `test/billboard.test.mjs` pins the
  catalogue, the crop and the UVs.
* `app/store.ts` is zustand (a barrel over `app/store/`: `Store.ts` wiring + one slice per
  concern + `catalog.ts`): the station document lives here, the sim lives in the worker.
  `app/boot.tsx` is lazy-imported so `app/mobile.ts` + `MobileNotice.tsx` can show a plain notice
  on phones without downloading the three.js bundle. `/lab` renders `app/Lab.tsx`, the
  material/renderer lab.
* **A pass over what a rebuild costs** (`render/scene/systems/*`, `render/materials.ts`,
  `sim/worker.ts`, `build/model/State.ts`, `app/store/slices/*`). The chunk cache is released
  exactly once, keep-aware (`meshStation` used to release the last rebuild twice), and
  `chunk-cache.test.mjs` pins the very buffer objects a kept chunk comes back with. 电视 / 指示牌
  plates are **retained** across a rebuild (`PlateSystem.retainTvPlates` / `retainSignPlates`:
  the station's name and its lines are the only inputs a rebuild can change), a consist
  configuration that left is evicted after a few snapshots (`TRAIN_MISSES_ALLOWED` /
  `dropConsist`), an overlay's quad and material are freed where the overlay is replaced
  (`CrowdSystem.dropOverlay`), the 区域 map is rebuilt only when the picture changes
  (`setZoneOverlayVisible`, `zoneKeyRef`), the scene stops its own animation frame on `dispose`
  (`SceneRenderer.raf`), and a painted colour the document no longer names gives its canvas
  texture back (`finishesInUse` / `MaterialSet.retain`). The undo stack is capped by frames
  **and memory** (`StationSlice.pushPast`), `cloneState` uses `structuredClone`, and a **live**
  指示牌 preview raises `signVersion` rather than the document's `version`, so a preview stops
  looking like a document edit. In the sim the worker stays quiet while paused with nothing
  `dirty`, and `AgentPool` drops a dead agent's id entry as it recycles the object.

## Current state, and where its history lives

Milestones: **V0–V5 done, B1 done, B2 core done.** Still open in B2: zone inference, module
zone-legality feedback for ticket machines, and the gate direction/anchor UI. **B3–B6** (capacity
kit, draw kit, authored time + charts + snapshot, ship) are planned. `game/README.md`'s milestone
table is the authority; it still files the draw kit under **B4** and its table is a step behind
the code.

`game/README.md` is also where the project's narrative history lives — what a feature replaced,
and the bug a rule exists to prevent. This skill keeps only the rules and the traps.
