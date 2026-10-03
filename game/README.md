# Metro Station Designer — the game

The playable vertical slice (V0–V5) of draft 1 of [`../PLAN.md`](../PLAN.md) — a URL where you dig
a box into the ground and watch three thousand people break it. That plan is now superseded: the
current plan grows this slice into the **base game** (B1–B6, single line), and this README tracks
the milestones as they land.

It is its own application. Its own `package.json`, Vite config, tests and Cloudflare
Worker (`metro-game`). It imports nothing from `web/` or `art/`.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc --noEmit && vite build -> dist/
npm run test       # node --test: determinism, tick budgets, capacity ladder
```

## Where things live

```
src/
  sim/       PURE TypeScript. No DOM, no worker, no three. Runs in Node.
    constants.ts     every tuning number, including the time base
    stock.ts         A/B/C car classification
    finishes.ts      surface finishes: the family decides behaviour, §4.3
    zones.ts         fare zones: the boundary is a barrier, §4.5
    worker.ts        the only file that touches postMessage
  render/    three.js: chunk mesher, procedural materials, module models, outline, shadows, agents
  build/     station document, cell commands, paint, undo
  persistence/ save schema (serialise / parse / migrate *.metro.json)
  app/       React shell: HUD, rails, inspector. Panels only, no sim logic
  data/      the reference station and the art palette
test/        node --test suite (imports src/sim/*.ts directly)
bench/       crowd-tick benchmark
```

Dependency direction is one-way: `app/ → render/ → sim/`, and `sim/` imports nothing.

## The milestones

Draft 1's vertical slice is **done** (V0–V5). The base game plan picks it up at B1.

| | Contents | Acceptance | State |
|---|---|---|---|
| V0 | Shell: dark canvas, orbit camera, grid, FPS/tick readout | — | done |
| V1 | Rounded-corner mesher + material lab at `/lab` | reads as a designed building; chunk build < 4 ms | done |
| V2 | Build loop: 2×2 seed, extrude/dig, work plane, level slicing, undo | the spec's M0 test | done |
| V3 | Crowd: worker at 5 Hz, station graph, agents, LOS overlay | 3,000+ agents, p99 tick < 8 ms, determinism asserted in Node | done |
| V4 | Train, per-door queues, boarding, left-behind, the fix | an under-built station breaks and the fix works | done |
| V5 | Own Worker project, deployed | the deploy section below | done |
| **B1** | Cell faces, finish catalogue, per-face materials, paint tools, tactile strips, static save v1 | distinct materials, a floor finish that changes path cost, save round-trip | **done** |
| **B2** | Fare zones, the zone boundary as a movement barrier, zone paint + overlay | an ungated fare line strands the crowd; a gate restores flow | **core done** |
| B3–B6 | Capacity kit, draw kit, authored time + charts + snapshot, ship | see [`../PLAN.md`](../PLAN.md) §4 | planned |

**B1** shipped `sim/finishes.ts` (the finish table), faces in `sim/types.ts`, one chunk-mesh part per
finish, the walk-speed rule, the `N`/`M`/`I` paint tools, the tactile-strip decal layer along
platform edges, and `persistence/save.ts` (`formatVersion: 1`, static). The mesher's cell-key
packing was also fixed — the old bit-shift `key()` collided neighbouring cells, which would have
made finish lookups wrong.

**B2's core** shipped `sim/zones.ts`, `Cell.zone`, a graph rule that emits no walk edge across a
zone line except through a gate cell, a zone drag-paint tool (a rectangle of the chosen zone over
the floor it covers), the `分区` overlay (a tint on the walkable floor plus a text label naming each
area), and an inspector zone control. Still open in B2: zone inference (a room enclosed by gates
proposed `paid`), module zone-legality feedback for ticket machines, and the gate direction/anchor
UI.

**The module art pass** (part of PLAN §3 item 6, ahead of B3/B4) replaced the unit-cube modules with
`render/models.ts`: procedural ticket machines, turnstile cabinets, escalators, exits and platform
screen doors, plus rolling stock. PSDs are drawn from the `platform-edge` run (the screen the graph
already models as doors); trains are posed by `World.trainRenderState()`, sent through the worker
protocol, and drawn per consist by `SceneRenderer.setTrains`. The models are pure three.js geometry
over one shared material kit — no image or GLB assets. Modules are level-aware, so a tall escalator
or exit ghosts with the floor it belongs to instead of drawing through it.

**The 装饰 folder holds seating, room furniture and wall-mounted advertising.** 座椅 (the bench, moved
out of 设备), 货架 (the store's shelf unit), 办公桌 (the office desk + monitor + chair unit),
厕所隔间 (the restroom cubicle) and 洗手池 (the wash basin) are all free-standing, rotatable pieces,
and 广告牌 and 电视 all live under 装饰 in the build rail. The two advertising pieces are *wall-mounted*:
`sim/placement.ts`'s `wallMountMissing` refuses them unless the facing neighbour has a solid block at
its first course (`z + 1`), which is exactly where the 地基 auto-wall ring and the 墙 tool both start —
so the player must build a wall and use **R** to turn the panel's back to it. `wallSide` turns that
requirement with the module rotation and the renderer mounts the model on the same local −y face, so
what the ghost shows is what the click builds. 广告牌 is a nested sub-menu of four formats — 横版 /
竖版 / 方形 / 大横版 — whose run length (one cell, or two for 大横版) and poster aspect come from the
shared `sim/billboards.ts` table, so the palette thumbnail, the collision envelope and the drawn
housing cannot disagree. A multi-cell banner needs a wall behind every cell of its run. Every screen
cycles three procedural, unlit ad posters on wall time, driven by `SceneRenderer.updateAds`; the
posters come in wide / square / portrait sets (`render/models.ts`'s `adFramesWide` / `adFramesSquare` /
`adFramesPortrait`) so a portrait billboard is not a stretched landscape, and the decoration reads as
"playing ads" even while the sim is paused. Room furniture (shelf / desk / cubicle / sink / bench) may
stand inside a walled room or booth (`placementBlocked` exempts the furniture ↔ room pair, and
`moduleAt` prefers the furniture over the room around it). A store stocks one `shelf` module per layout
spot (`storeShelfSpots`: island rows plus wall runs), an office one `desk` per grid spot
(`officeDeskSpots`), a restroom one `cubicle` per back-row cell and one `sink` per front-row cell
(`restroomSpots`), and a booth one `bench` per back-row cell (`boothBenchSpots`), so every auto unit is
individually right-clickable; bulldozing the room takes its auto (`cfg.auto`) furniture but leaves
hand-placed pieces, and rooms drawn before this carry a `cfg.stocked` migration
(`ensureRoomFurniture`, via `toState`) instead of drawn units.

**Rails are equipment: a fixed piece centred on the cursor.** A rail is a `track` module — a car-width
bed (`d = 3` m) and a run the length of the bound line's consist (`w = ceil(stock length × cars)`) —
so the whole module is pre-rendered as the placement ghost, centred on the highlighted tile (it grows
evenly both ways, so a long consist lands under the pointer rather than off one end) and turned with
**R** like any other equipment. `R` is a true quarter-turn: `sim/track.ts` is the single source of orientation (run axis,
footprint, edge run, anchor), so a rail can run east–west or north–south, and the consist, its screen
doors and the platform-edge services all turn with it. Placing a rail removes the bed course, so the
mesher exposes the platform block's side face as a half-metre drop and the module supplies the recessed
slab and rails; `World.computeLineAnchors` reads the module (the bed cells are gone) and rides the
consist half a metre below the platform, now along the track's run axis with a matching yaw. The anchor
needs only a track — the platform edge is for boarding — so a freshly laid rail runs a train
immediately, before any platform or screen doors exist. `sim/placement.ts` asks "is this a track bed?"
by *either* the `floor.track` finish (the hand-built path) or a track module's footprint, so the demo
and the renderer agree. `build/rail.ts` is the pure placement + derivation: it lays the bed, then
generates one `platform-edge` per contiguous run of walkable exposed floor beside it (an island
platform yields two — the Spanish solution), each bound to the rail's line and direction and carrying
the rail's rotation. Every derived edge records which side the track lies on (`cfg.side`, read from the
screen's own frame), and the renderer, the auto-derive and `World.computeLineAnchors` share that one
meaning, so the printed header always faces the platform, never the rail. Editing a line's 车型/编组 re-cuts its tracks to the new run length. Each track carries its line's 供电 in `cfg.power`: 第三轨 draws a guarded conductor rail beside the running rails, 接触网 draws an overhead contact wire hung from a ceiling — a canopy the model raises over a platform, or the bore's shell in a tunnel — kept under the 4 m storey line so it never buries in the floor above (and, unlike a mast, it cannot foul the screen doors of an island platform). Switching a line's 供电 (`setLinePower`) carries the new mode to every track bound to that line — platform and tunnel runs alike — and rebuilding the module meshes re-cuts them all together. The 轨道 folder has
two tools, both gated by one eligibility check (`trackBlockReason`): anything already sharing the run's
space — equipment, a room, a screen door, a ramp, another rail/tunnel — blocks placement rather than
being demolished, and the preview flags it red. **站台** is the fixed consist-length piece above; it must
rest on solid floor under its whole bed (three cells wide, `trackFloorMissing`) and refuses a wall in its
headroom (`trackClearanceBlocked`) — a platform is open air. **隧道** is a pure tunnel run: hover an
existing rail and it extends off the free end nearest the pointer (a slider sets the length), keeping
the source's axis, rotation and bed depth, flagged `cfg.tunnel` so it never spawns platform doors. A
tunnel may hang over void, and it bores: it deletes any wall (or ground) poking into its three clear
courses, then raises a solid side wall either side and a ceiling one storey up wherever they are missing
(`boreTunnel`, shell blocks tagged `tunnel-shell:<id>` so removing the tunnel takes them too). Both
refuse to overlap another track (`commitTrack` / `placeTunnel` return the same state when they would).
The ghost draws the run's 上行/下行 direction as arrows on the bed (Tab toggles it in platform mode)
and a tunnel inherits its source's direction; `computeLineAnchors` takes the train's travel sign from
the track's `cfg.dir`, so the button turns the real consist, not just the preview. The 轨道 folder shows
the platform-only controls — 方向 (上行/下行), 线路, 重置屏蔽门 — only while placing or editing a
**platform**; a tunnel tool or a selected tunnel shows just the two tools and the length slider. The 重置屏蔽门 button re-derives the selected
rail's doors, or every rail's when nothing is selected. Line management lives in the right inspector's
**线路** section (线路名/颜色, 车型/编组/供电/下车, plus **+ 新建线路**). The reference station builds its
bed from the same dig, so the demo shows the recessed track too.

**Escalators are staircases, and they turn over.** `models.ts` builds each run as a band of
instanced steps whose treads stay world-horizontal (riser, then the yellow nosing along the
leading edge), so the incline reads as a staircase rather than a smooth ramp. `rollEscalator`
slides the band up the run every frame at `ESCALATOR_SPEED`, wrapping it at the comb plates and
driven by the sim clock (`stateIntervalMs`) so fast-forward turns the steps faster, not the crowd.

**Stairs are real steps, and the turn is walked.** The catalogue carries four staircase shapes —
straight, right-hand and left-hand 90°, and a 180° switchback — each climbing exactly one storey
like an escalator, but walked both ways. `models.ts` builds each flight as level treads with a riser
under every leading edge (never a ramp with grooves), and wears the **floor finish of its lower
landing**, so a granite hall gets a granite staircase instead of a steel one. `sim/stairs.ts` exposes
a stair's ordered flights; the graph gives every flight its own two-way capacity edge, and the
half/quarter landing between them is a real walkable node and a stair-width platform in the same
surface and slab thickness as the treads, wrapped by a balustrade that carries the flight handrails
around the turn — the block mesher skips those cells, so a landing is never a floating 1 m cube. The
**楼梯** group has four buttons, one per shape (straight, left 90°, right 90°, 180° switchback),
each placed as fixed-length equipment: its base sits on the hovered floor cell, the finished stair
previews as a translucent ghost, and **R** turns the run; **Tab** cycles its width between narrow (an
escalator bay) and normal. A turning stair also lays its half-landing as a walkable cell, so the two
flights connect. The demo keeps a single pre-placed stair — the straight run
that replaces exit A's down escalator; `carveRampOpenings`
opens the slab each flight climbs through while keeping every landing, so each stairwell is a real
hole in the ground.

**Escalators are placed the same way.** The **扶梯** button drops a fixed one-storey escalator: its
base sits on the hovered floor cell, it rises `ESCALATOR_RUN` cells along the placement rotation, and
the finished run previews as a translucent ghost; **R** turns it and **Tab** flips its travel
direction between up and down. The placement ghost carries a bright arrow over the run pointing the
way it will carry people. Direction only orders `from`/`to` — the single one-way edge the sim reads —
so an up and a down piece share one footprint, and any two runs still keep to separate columns. The
one piece lives in `sim/escalators.ts`, and the reference station builds its pre-placed runs from
that exact constructor too, so the demo and the builder place the same equipment at the same
dimensions.

**Ramps carve their way in.** `sim/openings.ts` (`carveRampOpenings`) removes the solid cells an
escalator, stair or lift climbs through, so a placed ramp surfaces from an opening rather than
through the slab; the landing cells are protected because the graph uses them as the ramp's nodes.
The corridor is as wide as the whole assembly — balustrades and handrails included — so the rails
never surface through the floor blocks to the left and right of the opening, not just the treads.
`data/reference-station.ts` runs the same carve, so the demo no longer shows escalators punching
through the concourse floor. An escalator is single-direction and carries **one passenger per step**
at 0.5 m/s over a 0.4 m pitch — 75/min, and exactly one rider per step on the run.

**Every demo exit is a head-house over an up + down pair.** Each of the three surface exits owns a
descending run and an up run two metres apart, landing on the exit's own row; `models.ts` draws the
exit as a steel-and-glass canopy whose roof reaches over that pair, so the runs surface from a hole
in the plaza under cover — the reference photo. The exit's drawn floor leaves each bay open to
`EXIT_BAY_HALF`, so the balustrade and handrail pass through the wellway rather than the strips
beside it. Exit A's west bay is a **stair** beside its up escalator (a mixed entrance), the other two
keep a down escalator. An exit does **not** auto-face the nearest run: like the rest of the
equipment it is turned with **R**, and its floor, street-opening node and glass/back walls all turn
with it, so the mouth points where the player sets it. A surface exit is rooted at the street
(z = 0); dropping one on a concourse or platform slab is refused.

**The head-house is solid, and the opening is the way.** `sim/exits.ts` holds the geometry the sim
and the renderer share. The exit's graph node is the street opening (the doorway cell, not the cell
under the canopy), and the glass sides and back wall are barriers in the walk graph, so the crowd
walks in and out through the opening and never through a wall. A bare portal opts out with
`cfg.headHouse: false` (the small test stations do).

**No ramps stacked.** A ramp also has a collision envelope (`rampEnvelope` / `rampBlocked`): a
bounding box around the run, the truss and the balustrade — for a stair, widened to its tread width.
Up and down runs must sit in separate columns (the demo's banks are two metres apart), and
the builder refuses a column an existing ramp already occupies, so a second escalator can never
be dropped immediately below a first.

**Floors grow their own walls, and the 墙 tool lays one by hand.** A deliberate 建造 drag is not
just a slab: `build/model.ts` tags its cells `auto-floor` and raises a 4 m `auto-wall` ring on the
patch's outer edge, so a drawn surface reads as a room-sized shell. The rule is the room union,
generalised to tagged cells: overlap or abut two patches and the shared edge inside the union loses
its wall while the new outer edge gains one, an L-shape keeps only its true perimeter, hand-built
floor is treated as continuous ground (no wall grows against it), and only `auto-floor` cells are
tracked so a wall the player placed by hand — or the new 墙 tool's run — is never deleted or
re-tagged. A hole dug through the middle stays open rather than getting boarded up. Single clicks
and stacked blocks stay plain, and the drag's live ghost shows the wall ring before release. See
`test/walls.test.mjs`.

**Fences divide areas with gates.** The 设备 folder's 围栏 (§5.2) is a 1 m high, very thin
metal frame around a glass panel standing through the middle of its block. A single click drops
one panel turned with **R**; press-and-drag lays a straight run like the 墙 tool with the panels
following the drag direction, and right-drag lifts the run back out. The run previews as real
translucent fence models while you drag. Every panel is built from its neighbours
(`sim/fences.ts`), so a straight run is continuous, a dead end caps itself with an end post, and
an L, T or + junction turns through the shared centre post with no overhang — dragging a new
segment up to an existing end regenerates that end on the spot, dropping its old cap and post.
A run plugs straight into a 闸机 row. The sim treats a fence cell as not walkable, so the run
plus its gates is a barrier the crowd only crosses at a gate — paint different zones each side
and the fare line holds. See `test/fence.test.mjs`.

`test/` holds the acceptance tests. Run them with `npm test`:

* `determinism.test.mjs` — same seed + tick ⇒ byte-identical positions, and no unseeded
  randomness anywhere in `sim/`.
* `capacity.test.mjs` — the §7.8 capacity ladder as a comparison: one platform escalator
  jams, three fix it; a saturated platform leaves people behind.
* `layering.test.mjs` — `sim/` imports nothing and touches no DOM; `render/` never reaches
  up into `app/`; `build/` imports neither.
* `surfaces.test.mjs` — a slow floor finish is a real detour, a track bed is not a walkable
  node, paint/fill/erase are immutable, and the mesher groups by finish (B1).
* `save.test.mjs` — the `metro-save` v1 envelope round-trips the static station and names
  every failure mode (B1).
* `load.test.mjs` — loading a station is a full sim reset: `World.load` clears the crowd,
  trains, server queues, clock and throughput counters and reseeds the RNG, while the edit path
  `rebuild` keeps the crowd in place.
* `zones.test.mjs` — an ungated fare line strands the crowd (zero boardings); a gate restores
  flow; the graph has no edge across the line; the zone bucket respects a drawn boundary (B2).
* `trains.test.mjs` — a dispatched train gets a pose on the track beside its platform edge,
  a stop is a fixed berth/open/dwell/close/hold/depart sequence, and the pose is deterministic
  (the rolling-stock render path).
* `placement.test.mjs` — `sim/placement.ts` gives every module a world footprint: two may not
  share space (a gate line in adjacent cells is fine, a module on the storey above is not a
  conflict), a ramp corridor blocks flat equipment inside it, `moduleAt` finds a module from any
  cell it covers, `removeModule` bulldozes exactly one module and leaves its block, and the block
  brush refuses a cell reserved by a ramp opening or an exit's floor (`reservedOpening`). The
  装饰 广告牌 / 电视 are wall-mounted: `wallMountMissing` refuses them without a solid wall block
  at the facing neighbour's first course, and `wallSide` turns that requirement with the module's
  rotation.
* `openings.test.mjs` — a placed ramp carves the slab it climbs through but keeps its landings as
  graph nodes, the carve clears the blocks the balustrade and handrail sweep either side of the
  run (not just the tread width), and every cell the carve opens reads as reserved so a hand-built
  block cannot cover it back up.
* `stairs.test.mjs` — the four stair shapes, each one storey; every flight is a two-way graph edge
  between walkable landings, a switchback is walked bottom to top across its half-landing, the turn
  landings are the cells between flights, the width cycle runs narrow → normal, the four stair
  buttons each build their fixed one-storey shape, a placed turning stair lays its half-landing as a
  walkable cell and carves its slab, and a carve keeps the landings while opening the slab a turning
  stair climbs through.
* `escalators.test.mjs` — the placed escalator is a fixed one-storey piece: an up run travels from
  the dropped cell to the storey above, a down run keeps the same footprint entered from the top,
  the direction cycle flips up ↔ down, two runs may not share a footprint but the next bay over is
  free, placing one carves its slab, and the demo's pre-placed runs are that same piece at the same
  dimensions.
* `rail.test.mjs` — placing a rail digs the bed, lays the track module and derives one platform-edge
  per contiguous platform run (two on an island); the derived screen's `side` names the side the track
  lies on, so the header faces the platform and never the rail (checked on both sides of an island and
  on a quarter-turned run); a wall above a platform cell splits the edge;
  regeneration is idempotent and follows the current floor; the dug bed blocks equipment and reads
  as track by either rule; a piece is sized from the line (a car-width bed, the train length), centred
  on the highlighted cell, and a quarter-turned track digs a north–south bed, derives north–south
  screen doors and runs its train in y with a matching yaw; a 供电 switch (`setLinePower`) re-cuts every
  track bound to the line — platform and tunnel — and leaves other lines untouched; a tunnel auto-extends a rail off its free
  end, clears the wall it pokes through and raises its own side walls and ceiling without spawning
  doors; a platform needs its whole bed on solid floor and refuses a wall in its headroom; either one
  is blocked by any existing equipment, room, screen door or track; re-cutting a line's consist resizes
  its platform tracks; the reference station builds its bed from the same dig and its hand-authored edge
  matches what the derive would place.
* `facility.test.mjs` — the rectangle-drag facilities: 商店 / 厕所 / 办公室 are walled rooms (one
  `shop` module type, the fit-out in `cfg.kind`) while 售票亭 is an open desk; same-fit-out drags
  extend a room, different ones clash; right-click carves wall openings (the renderer then hangs a
  3D door on a 厕所 / 办公室 opening and leaves the 商店 front open) and a room with no wall left is
  removed; the demo's shop and booth stay connected with live sim stops.
* `walls.test.mjs` — the 建造 tool's deliberate drag draws a walled floor patch: a 4 m auto wall
  ring rises on the patch's outer edge, overlapping or abutting two patches unions them (the buried
  wall goes, the new edge is walled) while a hand-placed wall survives, digging an edge moves the
  ring and a hole through the middle stays open, and 墙 lays tagged four-course columns that a
  right-click or right-drag lifts whole.
* `fence.test.mjs` — the 围栏 (§5.2): a 1 m high thin panel through the block middle (R turns a
  single, a drag lays a run along the drag direction); a dragged run plugs into a gate row, the
  fence cell is not a walkable node so the run plus its gates is a barrier the crowd only crosses
  at a gate, and `fenceArms` builds every joint from the neighbours — a lone panel caps both ends,
  a run end caps its free side, and an L / T / + turns through the centre with no overhang or cap.
* `storey.test.mjs` — the renderer's storey bands key every cell to the fixed 4 m grid line at or
  below it (`storeyBand`), so a floor and its 4 m auto walls share a storey while a second floor one
  storey down stays its own; a lower floor's wall reaching the floor above must not merge the two
  floors into one band.
* `shelf.test.mjs` — the 货架 (§5.7): the factory builds it with the hover rotation, it may stand
  inside a walled room or booth (either side of the shelf ↔ room pair, while shelves still collide
  with each other and other equipment does not enter rooms), `moduleAt` prefers the furniture over
  the room around it, placing a store stocks one auto shelf per layout spot, each shelf deletes on
  its own while bulldozing the room keeps hand-placed ones, merges never stack two units on a cell,
  legacy rooms migrate once on load (a cleared `cfg.bare` room stays empty), and everything
  round-trips the save.
* `desk.test.mjs` — the 办公桌 (§5.7), same model as shelves: the factory builds it with the hover
  rotation, it may stand inside a walled room, `moduleAt` prefers it over the room, placing an
  office stocks one auto desk per grid spot, each desk deletes on its own while bulldozing keeps
  hand-placed ones, legacy offices migrate once, and everything round-trips the save.
* `restroom.test.mjs` — 厕所 fixtures and the 售票亭 staff seats (§5.7): cubicles and sinks build
  with the hover rotation and stand inside a walled room, placing a restroom stocks cubicles on the
  back row and sinks on the front (a door cell gets none) and a booth one bench per back-row cell,
  each unit deletes on its own while bulldozing keeps hand-placed ones and drops auto ones, legacy
  rooms migrate once, and everything round-trips the save.

## The simulation's time base

GAME-SPEC §10.3 asks for 24 simulated hours in ~12 real minutes *and* a 5 Hz continuous
crowd. Those two cannot both hold: 12 min/day is 24 simulated seconds per 200 ms tick,
and 24 s of walking is 32 m — a crowd that teleports 32 m per tick cannot be separated,
queued or watched. PLAN §2.1's own benchmark steps agents at the 0.2 s tick.

This build keeps the crowd honest and runs the clock fast instead:

* **one simulated second per tick**,
* **1× is real time**: one tick per real second, so the crowd walks at true speed, the
  AM peak is ~90 real minutes, and a train every 150 s of sim time is every 150 real
  seconds,
* **fast-forward multiplies ticks per second, never the step size**, so §7.6 determinism
  is untouched.

`SIM_SECONDS_PER_TICK` in `src/sim/constants.ts` is the one number to change, and the
comment there explains the trade.

## Deliberate divergences from PLAN / GAME-SPEC

* **No react-three-fiber.** The scene is a plain three.js `SceneRenderer` driven by a
  React `Viewport` component. The renderer we judge at `/lab` is the renderer the game
  keeps either way; R3F would have added a reconciler between us and the chunk mesher.
* **Inner fillets are dropped.** PLAN R2's named fallback: the mesher rounds convex
  outer corners and chamfers exposed top edges by 12.5 cm, but does not fillet concave
  inner corners.
* **The day clock is real time at 1×, not 120×** (above).
* **Zones, surfaces, save/load, settings, charts and the module catalogue beyond
  escalator / gate / TVM / bench / exit are out of scope**, exactly as PLAN §7 lists.
* **One line.** Transfers therefore resolve to an exit; §7.5 is not exercised.
* **No named levels.** GAME-SPEC §4.3 defines a `levels` list of
  `{ id, z, kind, height }` bands. The game dropped it: the street is simply `z = 0`
  (`GROUND_Z`), and the renderer derives each storey from the fixed 4 m editing grid
  (`LEVEL_STEPS` in `sim/constants.ts`) — every solid cell belongs to the grid line at or
  below it (`storeyBand`). A floor slab and the 4 m walls on it share a storey; a second
  floor one storey down keeps its own, even when the lower floor's wall column reaches the
  floor above, so two stacked floors never merge into a single band. A plate with nothing
  below it stays on screen when the active level drops beneath it. A new station can
  therefore be dug below 0 immediately, with no B1/B2 declaration, and the save no longer
  carries a `levels` field (old saves load with it ignored).

## Measured

On this machine (Node 24, desktop):

| Measure | Value | Budget |
|---|---|---|
| Crowd, p99 worker tick | 2.2 ms at 3,257 agents | < 8 ms comfort, 200 ms hard |
| Crowd, mean worker tick | 0.9 ms | — |
| Chunk mesh build, before B1 | ~3.7 ms warm, ~5 ms on the very first chunk (JIT) | < 4 ms |
| Chunk mesh build, per-face finishes (B1) | **1.9 ms** for a one-layer station floor chunk, 2.7 ms for two, 4.4 ms for a fully solid 8-layer block | < 4 ms |
| Frame | 60 fps in a windowed GPU; the headless software rasteriser used for
  CI screenshots is the limit there, not the scene | 16.6 ms |

B1's per-face materials make the mesher sort faces into one part per finish. A real station
chunk is a thin floor slab and stays well inside the budget (1.9 ms); the figure that misses
is a *fully solid* 16×16×8 block, which is geometry-bound rather than finish-bound and was
near the line before B1 too. PLAN R2's fallback if that ever gets worse is to drop the rounded
vertical corners and keep the top bevels only.

## Deploy

```bash
npm run build
npx wrangler deploy -c wrangler.jsonc
```

From the repository root, `npm run deploy:game` does both steps and also attaches the routes.

`wrangler.jsonc` serves the game from the path prefix `https://ericpzh.rest/metro-game/` via
[`worker/index.js`](worker/index.js), so the website's 游戏 tab can embed it same-origin. The two
routes `ericpzh.rest/metro-game` and `ericpzh.rest/metro-game/*` are declared under `routes` in the
same file, so `wrangler deploy` creates them — there is no dashboard step. Two routes, not one: the
bare path needs its own. The Worker's own `workers.dev` root keeps working at the same time.

Two notes:

* `wrangler` warns that the routes "will attempt to serve Assets on a configured path" (it looks for
  `dist/metro-game/*`). Nothing lives there, so those requests fall through to the Worker, which
  strips the prefix and reads from the asset root. The warning is cosmetic.
* This Worker has its **own** Workers Builds project (`metro-game`), connected to `ericpzh/metro`.
  A push to `main` runs `npm run build:game` and then `npx wrangler deploy -c game/wrangler.jsonc`,
  so the game ships on every push the same way the site does. You can still deploy it by hand with
  `npm run deploy:game`.

To host it at the `workers.dev` root only, delete `main`, the `assets.binding`, the `routes` and the
`ASSET_PREFIX` var, and set `assets.not_found_handling` back to `"single-page-application"`. The
build needs no change either way.

If the site's tab should point somewhere else — a preview URL, a different domain — set
`VITE_GAME_URL` when building `web/`.
