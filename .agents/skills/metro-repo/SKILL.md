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
| `game/plan.md` | The parallel-edit code organisation rules (R1–R6) and the folder layout. **Read before adding a window, tool, model or scene system.** |
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
* `data/` — the demo station save (`demo-station.json`, the 动物园 Line 5 document) and the palette.
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
  touches `postMessage`. Messages in: `init` / `build` / `control` / `restart`;
  out: `ready`
  (graph) / `state` (agent `Float32Array`s, metrics, density, train poses,
  `intervalMs`). Payloads are copied, not transferred; the renderer interpolates
  over `intervalMs`. Each tick is synchronous. `build` is a live edit: it calls
  `World.rebuild()` and keeps the crowd. A station switch (打开 / 新建 / 示例车站)
  re-sends `init`, which calls `World.load()` — a full reset of agents, trains,
  queues, clock and RNG — so no old passenger walks the new document. `restart`
  calls `World.restart()`: it empties every agent, train and queue and reseeds
  the RNG, but keeps the document and the clock (the top bar's 重启 button).
* **Zones are barriers** (`sim/zones.ts`), and *only a gate may cross the fare
  line* — if the gate's policy permits that direction. A same-side relabelling
  (`outside`↔`unpaid`, `paid`↔`platform`) is not a crossing at all: `crossingDir`
  returns 0, so `buildGraph` skips the gate check and the floor stays continuous.
  An ungated line strands the crowd. A two-way gate is a single lane: first come
  fixes the direction until that side drains (`sim/gates.ts`).
* **A 闸机 is either a lane or a fence** (`sim/gates.ts`, §5.2). `cfg.door` is `lane`
  (default) or `fence`, toggled on the rail with **Tab** like the stair width and
  escalator direction; `gateDoorOf` also reads the spellings an older save may
  carry (`right` / `left` → lane, `none` → fence). The machine body is always built
  on the cell's local −x half with its lane — and the sliding leaf — on the other;
  **`R` turns the piece**, so which hand the lane is on is not a setting at all (
  `gateMachineSide` is just that half turned by `rot`, and `gateSolidFaces` says
  which neighbour a 围栏 run may butt into — a fence on the lane side ends at the
  doorway with its own end post instead). `fence` is the **doorless** machine: the
  same body with fence on the lane's half (drawn by `drawFence`, the shared fence
  geometry), and `buildGraph` gives it no node and no server, so it blocks its cell
  and crosses no fare line — the piece for finishing a run. `buildGate`
  (`render/models.ts`) is the 广州地铁 photo gate: a 1250 mm machine with a 957 mm
  shoulder and a head tapering at 115° (its top shorter than its base, via `prism`),
  a stainless body, a navy head carrying the tilted screen, the round reader, the
  QR window and the lane lights, a black fascia with a single **up** green arrow,
  and the translucent red leaf.
* **Fences are barriers too** (`sim/fences.ts`, 围栏 §5.2). A fence is a 1 m
  thin panel through its cell's middle and its cell is not a walkable node, so a
  dragged run plus the gate row it plugs into divides the floor into areas the
  crowd only crosses at a gate. The renderer builds every panel from its
  neighbours (`fenceArms`), so a straight run is continuous, a dead end caps
  itself, and an L / T / + turns through the shared centre post with no
  overhang. A gate neighbour counts only on its machine side (`gateSolidFaces`),
  and `railLandingAt` also treats a stair/escalator landing as a
  neighbour, so a run butts up to the handrail instead of stopping short. A run
  reserves exactly the tile it stands in, so the cell beside it is free ground and
  `placementBlocked` needs no exemption for that pair (only a single piece wider
  than a cell — an old 1.6 m stair, or a 2–3 lane turning stair — reaches its
  neighbour at all). A run met by **flat** equipment is measured by the body it
  draws (`collisionBoxes` → `openings.ts` `rampBodyBoxes`) instead of by that
  reservation: one box per tile, cut to the slope *at* that tile, and a stair's
  treads stop half a landing cell short of each landing (`stairTreadTrim`). So a
  stair's landing tiles and any slab the flight merely climbs *underneath* are
  free ground — a 围栏, a 闸机 or a bench stands at the head of a well or over the
  low half of a flight, which is how the demo guards each of its platform stairs —
  while two runs still meet on the full envelope and can never share a landing. An
  escalator is the exception that proves it: its truss, step band and balustrades
  run landing centre to landing centre, so every tile of its run, landings
  included, is its own.
  A fence *on* a landing is read the same way as one beside it: the fence cell is
  not a walkable node, so that flight drops out of the walk graph and fencing the
  head of a stair really closes it off.
* **A stair is lanes** (`sim/stairs.ts`, §5.1). Tab cycles one, two or three
  **lanes**, each exactly `ESCALATOR_BAND` (0.7 m) and each fitting one cell, so a
  wide stair is that many one-lane pieces the builder drops together.
  `stairLanes(width)` reads the tool's width (a width that is not a whole number
  of lanes, an old 1.6 m stair, reads as the nearest) and
  `planStairLanes(base, rot, lanes, placeable)` picks where the flight goes: the
  hovered cell as the first lane, then shifted back one lane at a time, so it
  butts against whatever stands beside it instead of overlapping, and flagged when
  nowhere fits. Neighbouring lanes always **join their steps** — `buildStairFlight` runs each
  flight's treads and risers out to the cell edge — but being *one* staircase is a
  property of the pieces: every lane of a wide stair laid in one action carries the same
  `cfg.flight` token, and only along a seam between lanes sharing it does the model drop
  the stringer, handrail and posts (rails then only at the outer edges) and does
  `sim/station.ts` leave out the balustrade wall, so the crowd may cross between lanes at
  the landings. A side a **wall hugs from bottom to top** (`stairWallSides`) loses its
  handrail, rail posts and newel return the same way — the wall is the barrier there — but
  keeps its stringer, so a staircase in a stairwell is railed on its open side alone; the
  wall must run the flight's whole length at the flight's own heights, or the rail stays.
  Two 0.7 m stairs dropped separately keep both of their own railings and
  their walls, with their steps meeting between them; a lane against an *escalator* keeps
  its balustrade and does not reach under it. The hover ghost is built with its own pieces
  in the context (`setModulePreview`), so a wide stair previews as the one flight it will
  be. A **turning** stair
  is one piece at the chosen width — its flights turn, so its landings cannot be
  shared lane by lane — and needs a bay of its own at 2–3 lanes. The lanes step
  along `stairRight(rot)`, the same "right of forward" a switchback's second
  flight is offset by. The two **switchbacks** (`stair-right180` / `stair-left180`,
  右 / 左双跑楼梯) lay that return flight one cell across per lane
  (`stairSwitchbackOffset`) — as close as two walking lines can stand — and then
  **slide its treads, rails and collision body** the rest of that step
  (`stairReturnSlide` / `stairFlightSlides`) until the two balustrades meet back to
  back. The paths stay on the grid, so the half-landing is still one cell per lane
  plus the one the pair shares; what moves is the band, never the walk. The piece
  claims one block per lane plus what the two bands need — 2 / 4 / 5 blocks at
  0.7 / 1.4 / 2 m, and the slide is capped so the 0.7 m run's walkers stay on the
  flight. Anything that measures a flight's body (the carve, `rampBodyBoxes`, the
  envelope, `rampWalls`, `stairWallSides`, `stairTurnCells`) has to read
  `stairFlightSlides`. The two
  hands are two pieces, not one turned: **R** rotates the whole stair about its
  base and never swaps the hand. A 180° turn lands on a **row**, not a shared
  cell, so the crowd has to walk it: `sim/station.ts` cuts each flight's
  balustrade wall off at the flight end that meets an interior landing
  (`stairTurnConnectors`), because the 0.6 m over-run an outer landing keeps would
  seal the landing's own cells apart and leave the two flights disconnected. A
  stair's **walking surface is a finish of its own** (`stair.cfg.finish`, 材质):
  its treads, risers and half-landing platform are one material, chosen by the
  floor it climbs from unless the player painted the piece (`paintStairSurface`,
  the pointer taking the module over the cell, since treads belong to no cell).
* **A lift is one car per shaft** (`sim/lifts.ts`, 电梯 §5.1). The piece is a
  2 × 2 m assembly with a 1.5 m carriage, dropped on a floor and serving the
  floor one storey up (`LIFT_RISE`); hovering its upper/lower half grows it a
  storey up/down (`LIFT_EXTEND`). A fresh piece must stand on all four of its
  footprint cells, but extending never checks for floor, so a shaft may run past
  a floorless level (it simply has no landing there). `buildGraph` makes the
  walkable floor tile in front of the cabin door (`liftLandingCells`, turned by
  the piece's `rot`) at every storey a *stop* and gives the single `lift` server
  an edge between every ordered pair, so a rider goes straight to their floor.
  The whole 2 × 2 footprint is cabin interior and is never a walkable node, so
  the crowd boards and alights only through the door the model draws — never
  through a side or back wall. The car is a real state machine
  (`World.stepLift`: park → open → dwell → close → move, eased),
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
  exit head-house and room furniture (a shelf / desk / cubicle / sink / bench /
  bin / 灭火器箱) may stand inside a walled room or booth (`moduleAt` then answers
  with the furniture, not the room). A 广告牌 is *wall-mounted*: `wallMountMissing`
  refuses it unless the facing neighbour — turned by the placement rotation via
  `wallSide` — has a solid block at its first course (`z + 1`, exactly where auto
  walls and the 墙 tool start), and a two-cell banner needs a wall behind every
  cell of its run (`billboardCells`). `wallMountStandCell` stands the panel on
  the hovered floor, or on the face-adjacent cell when the pointer is on a wall
  itself, so an ad can bolt to the station wall across the track where there is
  no floor in front of it. The 指示牌, 电视, 时钟 and 监控 are instead
  *ceiling-hung*: `ceilingMountMissing` refuses them unless a solid slab sits above
  every cell of the piece one storey up (`LEVEL_STEPS`, the 4 m grid), the ceiling
  their rods bolt to. A 2 m
  bench is a real two-cell run — `benchCells` fixes its collision envelope and
  base cells, so it blocks and is found from both cells.
  `carveRampOpenings` (`sim/openings.ts`) opens the slab a ramp climbs through
  while keeping its landings as graph nodes — but only the cells the run's
  **centreline** crosses (`RAMP_CORE_HALF`). Every other block the body or
  handrail reaches is kept and marked by `rampThinCells` (a wall the rail grazes,
  or a floor a single wide piece's 1.6 m body enters), and the **mesher** draws it a
  half block thick on the side away from the run — the same path a player's own 半墙
  takes, so its faces keep their finishes and the 材质 brush can paint it
  (`thinWallCells` is the one list both come through; `buildRampThins` is gone). The
  floor beside a run stays buildable and a railing can sit against a wall; a
  tile-sized run (an escalator, a stair lane) reaches nothing beside it, so
  nothing there is thinned at all. A **半墙** the player laid is skipped: that cell
  is already a half block thick, and its side is theirs.
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
  changes. Every derived edge records which side the track lies on (`cfg.side`, read from the screen's own frame and shared by the derive, the renderer and `World.computeLineAnchors`), so the printed header always faces the platform, never the rail. That same side sets the consist's **door-side mask** (`LineAnchor.doorSides`, the 10th value of a train pose), and the door cadence itself is `doorRunOffsets` off the rail, so the train opens only the bank that meets screen doors and the screen is cut exactly where the car doors are — never onto the tunnel wall, and never a bay off the car door it serves. Editing a line's 车型/编组 re-cuts its tracks (`resizeTrack`). A track
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

* `render/models.ts` is a **dispatcher + barrel** over `render/models/` (the
  `PieceBuilder` base + shared kit, and one `pieces/*Model.ts` per piece). It
  builds all module geometry procedurally — turnstiles,
  ticket machines, escalators (rolling step band via `rollEscalator`), the five
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
  hand-placed pieces. A room's walls meet at mitred corners (`mitreCap`: each run
  stops one thickness short and one diagonal cap fills the corner, so no corner is
  two walls thick), and rooms and the booth wear no name plate — the shelves and
  the glass already say what the piece is. The 房间 folder's tiles are line icons
  of use (商店 / 售票亭 / 办公室 / 厕所), not colour chips, and
  `app/zoneThumbnails.ts` renders the 分区 brushes alone. Brush ids are `store` /
  `toilet` / `office` / `ticket` (`FacilityKind` / `FacilityBrush`, the same words
  the fit-out uses; the walled rooms share the `shop` module, the booth is `booth`).
  The **售票亭** (`buildBooth`) is the odd one out: hand-built
  geometry rather than voxels, and it must be a **closed box inside the module's own
  cells** — every side measures *inward from that side's outer face* (the cell
  boundary), the west and east counter runs own the four corner squares while the
  north and south runs butt between them, and the four glass sheets run out to each
  other's inner faces with a corner mullion over every joint. Measuring a run from
  the wrong line is what hung the east counter 0.55 m out in the next cell and stood
  the north one a cell inside the room, and stopping the screens a counter-depth short
  is what left a hole in the glass beside every corner; `test/booth-model.test.mjs`
  pins the box (inside the cells, flush on all four faces, no gap round the band, the
  same on all four sides).
* The **装饰 folder** holds the free-standing, rotatable pieces — 座椅, 货架,
  办公桌, 厕所隔间, 洗手池, 垃圾桶 and 灭火器 — plus 广告牌 (wall-mounted) and 电视 /
  指示牌 / 时钟 / 监控 (ceiling-hung). 座椅 is a nested sub-menu of four variants from `sim/benches.ts`:
  a plain stainless bench with no back and an upholstered seat with a back and
  arm rests, each 1 m or 2 m; the 2 m piece is a real two-cell run. 货架 draws a
  stocked supermarket gondola (perforated back panel, five shelves, price rails,
  instanced goods). 垃圾桶 is the stainless double bin (`buildBin`: two recessed
  mouths in one top rim, a centre divider, a slatted drain tray, one transparent
  decal carrying 可回收物 and 其它垃圾), and 灭火器 is the red steel extinguisher
  cabinet on four legs (`buildExtinguisher`: overhanging lid, two doors over a dark
  seam, a recessed side handle, one white lettered decal over both doors). Both are
  cosmetic — no server, no stop — and both count as room furniture. 时钟 is the round
  station clock (`buildClock`: an **open-ended** dark bezel ring over a white dial
  disc, with **sixty divisions** — twelve hour marks and 48 minute ticks, at reference
  proportions (hour 0.20 R by 0.055 R, tick 0.10 R by 0.02 R, all ending at the same inner rim) —
  plus two hands and a centre boss per face, and **no numerals or name**. The clock is
  **double-faced**: a slim white body whose two ends are the dials, with an open-ended black wrap
  round the barrel between them. Twelve bars alone read as a plate; the ticks make it a clock. Every mark and hand carries its length along its box's local **x**, so one
  turn — **`a − π/2`** — aims them all **radially** (the 12 and 6 marks vertical, the 3 and 9 marks
  horizontal along the radius). Aimed across the rim instead, the cardinals come out the wrong way
  round. That turn was read off the matrix, not derived: at each clock angle `a − π/2` dots 1.000
  against the radius where `π/2 − a` gives 0.105 to 0.5. The two faces are **one dial mounted twice**,
  the far one inside a group turned half a turn. The dial is in the **X-Z plane and carries no
  rotation**: a `CylinderGeometry` is Y-up, so its caps already face ±y and the printed face
  is the `−y` cap, out at the camera. A quarter-turn about x (`±π/2`) lays the disc flat in
  the X-horizontal plane instead — the wrong plane, and no sign of that turn fixes it, which is
  how the piece twice read as a clock facing the floor or the ceiling.
  The face is **geometry, not a printed canvas**: a texture on the cap measured wrong on
  the built page — it carried the marks' ink across the whole face while every unit test
  passed, because a test's canvas is a stub that records calls rather than rasterising —
  and a *closed* bezel cylinder caps the dial with a dark disc, which is why the ring is
  `openEnded`. Every disc is a `CylinderGeometry` (Y-up) turned a quarter about x. 监控
  is the bracketed bullet camera (`buildCctv`: a ceiling plate, thin stem, swivel
  clamp and arm carrying a slim dark head with its lens, two-LED illuminator and sun
  hood — the drawn housing is under 8% of the cell it reserves). Both are cosmetic props hung
  the whole storey, and neither is room furniture: a hung fitting reserves the whole
  column, so it may not be stacked over another piece. 广告牌 is a nested sub-menu of six formats
  (横版 16:9 / 标准 2.25:1 / 大横版 16:9 / 长幅 3.75:1 / 竖版 0.7:1 / 方形 1:1) whose run length and poster aspect come from the shared
  `sim/billboards.ts` table, so the thumbnail, the collision envelope and the
  drawn housing cannot disagree. 电视 and 指示牌 hang by rods from the ceiling. The
  指示牌 prints a lit double-sided wayfinding board, so it reads from either side;
  the 电视 is **single-sided** — its station board (line shield, 本趟/下趟/第三趟
  cards, clock) and its content window both ride the local −y face, so the back is a
  plain dark panel. Every lit pane there lies over a dark backing slab, so it must
  stand half a slab out plus `LIT_STAND_OFF`: a pane on the slab's centre line is
  buried in it and reads as a black rectangle with no error. `电视` cycles the
  shared ad posters in that window while the board around it stays put; each screen
  rolls its own period, so a row of them drifts apart rather than flipping as one
  wall, and only artwork cut for a landscape panel is eligible (cropping is not
  stretching). `render/stationDisplay.ts` owns the board's derivation and pixels,
  and `stationDisplayLayout` keeps its geometry testable without a canvas. Its plate
  canvas is the **whole screen** — the layout is expressed against that surface —
  while the board mesh is only the column, so the mesh samples the canvas' left
  `TV_POSTER_RECT.x`. Mapping the full width onto it instead squeezes the plate into
  that fraction and leaves the rest of the column as bare backing: a black band
  between the text and the artwork, and text condensed by `1 / TV_POSTER_RECT.x`,
  with nothing in the console to say so. `test/tv-screen.test.mjs` pins the sampling
  as well as the depth and the tiling.
  **Two 电视 may share one tile back to back** (`sim/tvs.ts`, `test/tv-pair.test.mjs`):
  turned exactly 180° apart (`rot` two apart) the pair is one object — a housing **two
  panels thick** (0.2 m through, `TV_HALF_DEPTH` either side of centre, *not* a
  cell-filling box: a metre-deep one reads as concrete hung from the ceiling), one
  bezel, one suspension, a lit face each side — and it is the one `placementColliders`
  exemption that is not a pair of *different* kinds. A quarter-turn apart or facing the
  same way is still refused. Drawing two solo models instead is visibly wrong, not just
  wasteful: the housing is symmetric about its centre, so the two backings are
  left-half-coincident and each station board lands exactly coplanar with the far face of
  the opposite backing (it z-fights it and loses its outer 0.006 m). Which side a member
  prints on is `placeLocal`'s job and **not** a field on the pair slot: both panes are
  built on local −y, and the two members land on opposite sides purely because their
  `rot` values differ by a half-turn — passing a direction as well rotates the same turn
  twice and drops both screens on one side. `moduleAt` therefore takes the camera's look
  direction (`scene.pickFacing`) so a right-click on either face takes the 电视 the
  pointer is on. **A screen has a back**: `render/adArt.ts` mints poster materials
  `FrontSide` (a double-sided poster prints through the backing slab it is bolted to, so
  the piece shows content from behind and R cannot say which way it faces), and
  `SceneRenderer.tintModuleGhost` doubles the sides of everything except a material the
  model already made single-sided, so the placement ghost keeps a black back.
  Wall-mounted pieces must bolt to a
  wall (see `wallMountMissing`), and because that check is a function of `rot`
  alone the panel **turns itself** to face its wall (`autofaceWallMount`) — the
  orientation is an output of the geometry, not something **R** has to be pressed
  into beforehand; a valid turn is kept so flipping a panel between two walls
  still works, and the pointer's aim breaks a corner tie. Hovering
  a wall block itself mounts the panel in the facing floor cell
  (`wallMountStandCell`), so an ad can hang on the station wall across the track.
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
  三向, and their runs always stand **side by side**. `cfg.bays` (1, 2 or 3) is
  how many adjacent columns the house holds — 0, then 0 and 1, then 0, 1 and 2 —
  and `exitSpan` builds the plan around that group with one full block of floor
  each end, so `exitWidth` is 3 / 4 / 5 blocks: a 双向 is four blocks across with
  a whole block of pad either side. `cfg.covered: false` drops the canopy and
  walls for a glass railing, but `exitWallPlanes` returns the same barriers (over
  the same plan), so only the look changes; `models.ts` draws the covered piece as
  a red steel portal frame under a blue waved roof, and the exit's name board moves
  with the roof: 有盖 hangs it at the street doorway with its top edge meeting the
  roof underside (`topAt`, the profile the roof and the glazing share), while 无盖
  — which has nothing to hang from — lays the same board over the *mouth* railing's
  glass, facing back up the runs toward the wellway the crowd descends; the railing
  carries it, so it needs no posts of its own. `exitRunSnap` snaps a straight
  stair/escalator dropped inside a head-house into the column under the pointer,
  clamped to the bay group: its upper landing on the
  street, its base one storey down toward the mouth, so the pointer positions the
  run on the floor the exit opens onto and the runs stay side by side. Turning
  stairs are left un-snapped. A head-house's plan is `cfg.bays` **alone** — one full
  block of pad at each end, so 3 / 4 / 5 blocks across and no other width exists —
  and `exitRunOpenings` walks the runs actually placed and keeps the ones that
  fixed span covers, so the wellways and the interior dividers follow the runs
  while the house never widens for one.
* **View toggles and the bottom bar.** The level slice is `render/levelSlicing.ts` (pure, covered by
  `test/level-slicing.test.mjs`): **显示其他层** (`ghostOtherLevels`, default on) is all-or-nothing —
  off, the edited storey is the *only* thing drawn at every camera angle; on, the active storey stays
  crisp and the rest are 35% ghosts that keep their depth, so a storey the active one covers loses the
  depth test and never blocks the depth being edited. **隐藏天花板** (`autoCeiling`, default on, `H`)
  is the one exception above the active storey: a slab one storey up is that room's ceiling, so with
  the toggle on a storey above keeps only the pieces with nothing under them (the chunk mesher's
  `float` plate, a fixture whose column's lowest storey is above the active one). It only has an
  effect while 显示其他层 is on — with the other storeys off there is nothing left to hide.
  **隐藏墙壁** (`hideWalls`) fades every wall face and platform screen door to 16%
  with `depthWrite` off and drops their outline. **The crowd obeys the same storeys**: the rule is
  `crowdVisible`, never a storey above the active one, and the depth cutaway clips the agent meshes
  too, so nobody floats in front of a slab or shows through one. **Trains are sliced like
  everything else** — a consist is tagged with the storey of the floor block it stands on
  (`storeyBand` of the rounded track surface, not the raw `z - 1`), and `applyGroupLevel` combines the
  slice with the sim's own `parked` flag instead of the old "leave `visible` alone", which used to
  draw every train at every level. **The nav cube only moves the camera**: no face, corner or Home
  click may rewrite the slice. The top bar's 重启 button empties the crowd, trains
  and queues but keeps the station and clock, and **Space** toggles play/pause
  (the 暂停 / 播放 button does the same); the speed chips are multipliers only
  (there is no 0× chip). The bottom bar shows FPS and 方块数 (the old sim-timing
  and chunk-build metrics were dropped).
* The 地基 tool's *deliberate drag* is not a bare slab: `build/model.ts` tags the
  drawn cells `auto-floor` and raises a 4 m `auto-wall` ring on the patch's outer
  edge — the room-union rule generalised to cells, so overlapping/abutting patches
  union, hand-built floor is continuous ground, and a hole dug through a patch
  stays open. A single click stays a plain block. While previewing, a badge pinned
  to the pointer reads the patch's live 长 × 宽 in metres (`Viewport.tsx`
  `buildMeasure`). With **半墙** on (its own tile — click-only, no shortcut; Tab
  only flips 自动生成墙壁 and the store refuses that while 半墙 owns the tool)
  that click is instead one
  half-block wall column, one per click — no patch and no run — and the two are
  exclusive, so 自动生成墙壁 is off and greyed while it is on. The 墙 tool lays tagged
  four-course columns a right-click lifts whole, and 删除 is button-agnostic: it
  lifts a whole module under the pointer (through its own teardown for a rail or
  room), else a single block or a dragged line. A **reserved opening** — the corridor a ramp
  carves or an exit's floor (`reservedOpening` in `sim/placement.ts`) — refuses a
  hand-built cell, so the block brush cannot seal a run the player can see
  through.
* `app/Viewport.tsx` owns the `SceneRenderer` lifecycle and routes pointer events
  to the tool controllers in `app/tools/` (`ToolController` base + `ToolContext`,
  one controller per tool, `geometry/` for the pure pointer math); the Viewport is
  the only app file that touches three directly. The
  first station build frames the home (iso) view — the constructor's preset ran
  before the station existed — while later edits leave the camera alone
  (`framedRef`). The equipment hover ghost is rebuilt in place off
  `placementPreviewKey`, so R and a Tab cycle (stair width, escalator direction,
  闸机 door side) redraw the piece already under the pointer — which needs the
  matching entry in `render/moduleGhostKey.ts` as well, or the scene skips the
  rebuild (`setModulePreview`).
  `app/LeftRail.tsx` is now a barrel over `app/rail/` (shell + `folders/`,
  `menus/`, `actions/`, `items/`, `shared/`); thumbnails are rendered from
  the real models by `app/moduleThumbnails.ts` / `app/zoneThumbnails.ts`.
* **The code is organised for parallel edits** (`game/plan.md`): every window,
  subwindow, list item, tool and 3D model is its own unit in its own file, and
  shared UI/behaviour uses a base class or shared chrome rather than a shared
  god-file. The former giants are now barrels over their folders —
  `app/App.tsx`→`windows/`, `app/LeftRail.tsx`→`rail/`, `app/store.ts`→`store/`,
  `app/SignEditor.tsx`→`windows/sign/`, `build/model.ts`→`model/`,
  `render/models.ts`→`models/`, `render/scene.ts`→`scene/`, `sim/world.ts`→`world/`
  — so every deep import still resolves. Follow R1–R6 before adding a unit.
* `app/store.ts` is zustand (a barrel over `app/store/`: `Store.ts` wiring + one
  slice per concern + `catalog.ts`): the station document lives here, the sim
  lives in the worker. `app/boot.tsx` is lazy-imported so `app/mobile.ts` +
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
  ramp corridor or an exit's floor. `game/README.md`'s test list documents it.
* The **半墙 kit** has landed (`sim/types.ts`, `sim/constants.ts`
  `HALF_WALL_T`, `build/model.ts`, `render/chunkMesher.ts`, `render/scene.ts`,
  `app/store.ts` `halfWall`, `app/Viewport.tsx`, `app/LeftRail.tsx`,
  `game/test/halfwall.test.mjs`): the **地基** tool's **半墙** tile (click-only, no
  shortcut) lays
  one 4 m column half a block thick per click — the wall a facility room's own walls
  and a wide run's side panel are made of, as a piece the player can put anywhere.
  It sits on the 地基 tool because it *is* the wall that tool grows, so the two wall
  modes are exclusive: turning 半墙 on switches 自动生成墙壁 off and the store refuses
  that toggle while it is on (its tile greys out), and leaving hands the ring back.
  Tab only flips the generated ring on/off (refused while 半墙 owns the tool), and a 半墙
  click is one column where it landed, never a patch or a run (`addWalls`'s `side`,
  `d.single` in the viewport). A 半墙 is still an ordinary solid wall cell — `WALL`
  plus a `half-wall:<side>` tag (`halfWallTag` / `halfWallSide`), so the column
  lift, the storey slice, `isWallBlock`, the ramp carve and the crowd all read it as
  a wall — and the mesher draws it, squashing the standard rounded profile into the
  half it keeps (`buildThinProfile`), which is what keeps its **per-face finishes**:
  both sides are ordinary surfaces the 材质 brush paints where the pointer hits them.
  **R** picks the side — the geometry's own faces first (`halfWallSideDirs`, so a
  半墙 along a patch edge hugs the edge with no key pressed), only the two
  perpendicular ones for a run (a side along the run would leave a slot between
  columns), all four for a single column in open floor; switching modes resets
  the face cycle with the mode. A 半墙's **inner** face is the one
  surface that is not on its cell's boundary, so `facePresent` (shared by the
  viewport's paint rectangle and the `M` 整面 flood) offers it even with a solid
  cell behind it and `render/scene.ts` insets the paint ghost onto the panel
  itself, while `rampThinCells` skips a player's 半墙 rather than thinning it twice.
  **A ramp's kept blocks are drawn the same way** (`thinWallCells` is the one list —
  tagged 半墙 plus `rampThinCells` — that the mesher, the build ghost and the brush
  all read, and `buildRampThins` is gone): that is what makes a stair's own half wall
  paintable, where a single-material panel over a hidden voxel left the brush
  painting half a block away from the surface it aimed at.
  `game/README.md`'s test list documents it. Named levels are gone (`LevelDef` deleted): the street is `z = 0`, a storey keys each solid cell to the fixed 4 m grid line at or below it (`storeyBand` in `sim/constants.ts`, so a lower floor's wall reaching the floor above cannot merge two floors into one band), exits refuse non-street slabs, and `platform-edge.cfg.side` names the side the track lies on so headers face platforms. The 地基 tool carries a 自动生成墙壁 toggle (default on) instead of a separate 方块 tool.
* The **装饰 kit** has landed (`sim/billboards.ts`, `sim/benches.ts`,
  `sim/placement.ts`, `render/models.ts`,
  `game/test/shelf|desk|restroom|bench|decor|ceiling-decor|sign.test.mjs`): 座椅 /
  货架 / 办公桌 / 厕所隔间 / 洗手池 are free-standing, rotatable
  `bench`/`shelf`/`desk`/`cubicle`/`sink` modules, and 垃圾桶 / 灭火器 joined them as
  the cosmetic `bin` / `extinguisher` pieces (`game/test/decor.test.mjs`) with the
  ceiling-hung `clock` 时钟 / `cctv` 监控 beside the hung signs
  (`game/test/ceiling-decor.test.mjs`), a walled room stocks
  one per layout spot (migrated
  once from the old drawn interior by `ensureRoomFurniture`, guarded by
  `cfg.stocked`; each store wall unit backs its panel onto its own wall).
  座椅 offers four variants from `sim/benches.ts` (stainless / backed × 1 m / 2 m),
  the 2 m run spanning two cells; 货架 draws a stocked supermarket gondola. 广告牌
  is wall-mounted (`wallMountMissing`) with the four formats sharing
  `sim/billboards.ts`; 电视, the new 指示牌 and the 时钟 / 监控 pair are *ceiling-hung*
  (`ceilingMountMissing`; the 指示牌 is lit double-sided, the 电视 single-sided and —
  two of them turned 180° apart on one tile — sharing a single two-panel-thick (0.2 m)
  housing with a screen each side, `sim/tvs.ts` / `test/tv-pair.test.mjs`). The 设备 folder's 货架 / 座椅 moved
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
* **A lift boards only at its door.** `liftLandingCells` / `liftDoorDir`
  (`sim/lifts.ts`) turn the door opening by the piece's `rot`; `buildGraph` makes
  the walkable landing tile in front of it the stop and marks all four footprint
  cells non-walkable, and `world.ts` stands the queue just off the threshold.
  Before this the graph boarded at the fixed lower-left corner, so a rotated lift
  (the demo's `lift-14` rot 2, `lift-15` rot 1) had the crowd walking in through a
  side/back wall and could even drop a stop. `game/test/lift.test.mjs` pins the
  door contract, including a rotated piece.
* The **line direction termini** and the inspector's folding landed with it: each
  line carries `upTerminus` / `downTerminus`, and every platform screen prints its
  line's terminus for its own `cfg.dir` (the hardcoded 番禺广场方向 is gone). The
  inspector is now a column of folding `Folder` / `Disclosure` blocks (信息 /
  出入口 / 线路), each exit is an editable, selectable card linked to a 3D
  highlight box (`SceneRenderer.setSelection`), and the view gained a 隐藏墙壁
  toggle. The ceiling hiding that landed with it is its own 隐藏天花板 tile since
  (default on), and the slice is all-or-nothing: 显示其他层 off is the deliberate
  "one storey only" view and 幽灵 is the default (see the view-toggle bullet above).
* The **exit kit** has landed (`sim/exits.ts`, `sim/placement.ts`,
  `render/models.ts`, `app/Viewport.tsx`, `game/test/exits.test.mjs`): 出入口 is a
  nested sub-menu of six variants (有盖 / 无盖 × 单向 / 双向 / 三向). `cfg.bays`
  builds the house around 1 / 2 / 3 side-by-side run columns with a full block of
  pad at each end — 3 / 4 / 5 blocks across — `cfg.covered: false` trades
  the red-framed, blue-roofed canopy for a glass railing over the same barriers,
  a straight ramp dropped inside snaps into the column under the pointer
  (`exitRunSnap`), and a
  fresh exit names itself `A口` … (`nextExitName`). The 3D view selects and deletes
  by drawn mesh (`SceneRenderer.pickModule`), so the whole head-house is hit, not
  just its reserved cells.
* The **屏蔽门 and 自动贩卖机** work landed with it: each line chooses 全高 (default)
  or 半高 屏蔽门 (`cfg.psd`), which re-derives its edges and shrinks the screen's
  collision envelope from 3.1 m to 1.5 m; and 自动贩卖机 (`vending`) is a
  TVM-footprint drinks machine that is the same unpaid-zone `stop` at `TVM_RATE`,
  sharing the ticket/vending detour on a street entry.
* **Both ends of a train are cabs, the doors follow the screens, and the cadence
  spreads to the car ends.** `buildTrain` (`render/models.ts`) re-skins the last
  2 m of each end car through `buildCab` — the dark face mask, centre windscreen
  and crew-door windows, the 广州地铁 mark (`drawMetroMark`: the real two-stroke
  mark, drawn once and shared with the exit banner), twin round lamp clusters and
  corner marker bars, the cream bumper band, the number plates and
  the coupler — so the body stays exactly `cars × carLength` long, the cab stops
  short of the car's first passenger door, and only the coupler hangs past the
  nose. The two ends differ only in their lamps (the `headlight`
  / `taillight` unlit materials): white on the end that leads, red on the end that
  trails. Door leaves carry the side they belong to (`registerDoorLeaf`'s `side`),
  and `setDoorsSides` slides the two banks independently; the pose's 10th value
  (`LineAnchor.doorSides`, built in `World.computeLineAnchors` from the berth's
  `platform-edge` runs) says which of them may open, so `SceneRenderer.advanceTrainDoors`
  opens only the bank with screen doors to meet and leaves the tunnel-wall side shut.
  The cadence itself is `doorCentres` (`sim/stock.ts`): one uniform pitch per car,
  held `DOOR_END_INSET` (2.8 m) off both car ends, rounded symmetrically about the
  consist centre — so a three-door L car spreads its outer doors to the ends rather
  than bunching them mid-car. `doorRunOffsets` projects that list onto a rail's run,
  and it is the single list `models.ts` cuts the screen open with *and* the one
  `buildGraph` seats a door server on (anchored on the edge's own rail, so a screen
  shorter than its bed still lines up; a rail-less legacy edge falls back to
  spreading over its own run).
  `game/test/trains.test.mjs` pins the platform-side / island / no-platform cases
  and that every screen door stands on a car door, `game/test/stock.test.mjs` the
  cadence itself.
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
* The **ramp carve, fence ramp-join and crowd honesty** change landed
  (`sim/openings.ts`, `sim/fences.ts`, `sim/placement.ts`, `sim/world.ts`,
  `sim/protocol.ts`, `render/models.ts`, `render/scene.ts`, `app/Viewport.tsx`,
  `app/App.tsx`, `app/store.ts`): a ramp carves only its centreline
  (`RAMP_CORE_HALF`) and keeps every block the body or handrail grazes as a
  half-metre panel (`rampBodyHalf` / `rampThinCells` / `buildRampThins`), which
  closes the hole a wide stair used to leave and lets a railing meet a wall; a
  fence joins a stair/escalator landing (`railLandingAt`) and
  `placementBlocked` exempts that pair off the landing nodes; a 广告牌 mounts on
  the wall across the track (`wallMountStandCell`); the crowd hides with the
  storey it stands on and clips with the cutaway; and the top bar gained 重启
  (`World.restart`, the `restart` worker message) and **Space** play/pause.
* The demo is the author's real **动物园** (广州地铁 5号线) save, shipped as
  `data/demo-station.json` and handed out by `referenceStation()` as a
  `structuredClone` so an edit never leaks back into the shared document. It
  opens cold at 07:27 sim time, warmup 0, on its own seed `7654321` — a cold boot
  and 打开 of the same document run the same crowd (`boot.tsx` seeds from
  `station.seed`). The old hand-built Wusi Square rig moved to
  `test/support/scenario-station.ts`, so the capacity / stair / escalator /
  opening tests keep their controlled knobs; `demo.test.mjs` guards that the
  shipped save is one connected circulation that actually boards and clears a
  crowd.
  **Refreshing it** (the author keeps editing the station): `动物园.metro.json` is
  a `metro-save` v1 *envelope* — `{format, formatVersion, gameVersion, savedAt,
  name, seed, static}`, where `static` carries `cells` / `modules` / `lines` — while
  the shipped file is the bare station document. So take `name`, `seed` and the
  three `static` arrays, `JSON.stringify` the lot on **one line** with no trailing
  newline and write it as UTF-8; for the current save that is byte-identical to
  `JSON.stringify(toData(parse(save)))`, because `toState` finds nothing to migrate
  (a save it *does* migrate would need the migrated form written instead). **Off-grid
  cells are not a problem to fix by hand**: the author's saves carry a handful of
  blocks at fractional coordinates (19 in the 2026-10 one) which no tool can address
  and which draw as offset junk, so both boundaries **drop** them — `toState` on the
  way in (`build/model.ts` `repairGrid`) and `serialize` on the way out. Nothing is
  ever *refused*: refusal is for a broken envelope (`文件损坏`, 不是地铁车站存档,
  存档太新了, 缺少车站数据), and a station that is otherwise fine is not worth losing
  over a block no tool can see. A load that had to repair says so in the 打开 notice,
  the shipped file is nonetheless kept clean (11305 cells where the save has 11324),
  and `demo.test.mjs` fails if one ever arrives. Nothing in the game can *mint* one —
  `test/grid.test.mjs` is the guard on that, and it is the file to extend if you add
  a tool that writes cells. After a
  refresh, re-check `reference-station.ts`'s header comment — it names the
  station's levels, lifts, stairs, escalators, rooms and exits — plus the demo
  facts `placement.test.mjs` pins (the two straight platform stairs, and which
  panels the save already ships on their wells), and that `demo.test.mjs` still
  passes.
* The **材质 brush keeps its mode.** `N` 单块 / `M` 整面 are the 材质 folder's own setting
  (`store.ts` `paintBaseMode`), not a property of a tile: clicking a finish tile — or a fresh
  搪瓷板 colour, which now reaches the brush in the same click instead of the previous render's
  value — leaves the mode alone, so it survives a detour through another folder on the left rail.
  `I` 取色 only borrows the brush and hands it back in the mode it was entered with
  (`resumePaintMode`); `selectPaintFinish` is the finish tile's whole click.
  `game/test/paint-mode.test.mjs` pins it.
* The **闸机 piece** landed (`sim/gates.ts`, `sim/station.ts`,
  `sim/types.ts`, `render/models.ts`, `app/LeftRail.tsx`, `app/App.tsx`,
  `app/store.ts`, `game/test/gate-door.test.mjs`): `cfg.door` is `lane` (default)
  or `fence`, toggled with **Tab** on the 设备 rail beside 旋转, and the turnstile
  model was rebuilt from the 广州地铁 reference photos and elevation — a 1250 mm
  machine (957 mm shoulder) whose head is a **trapezoid** (`prism`: top shorter
  than base, 115° shoulder, the screen tipped up on the slope), stainless body,
  navy head with the round card reader, QR window and lane lights, a black fascia
  with a single **up** green arrow, a blue foot band, and the translucent red
  leaf. The body is flush with its cell edge, so a 围栏 run butts the machine's
  solid side (and ends at the doorway on the lane side); a `fence` machine is not
  a gate at all — no node, no server, no crossing — and closes a run with fence
  drawn through its own half-block. The **left / right setting was dropped**: the
  model is built one way and `R` turns it, so a half turn is the mirror and the
  mode only has to answer lane-or-fence.
* **A Tab cycle must redraw the ghost already under the pointer**, and that takes
  two keys, not one: the viewport subscribes to `placementPreviewKey`
  (`app/store.ts` — the piece, its `rot` and every Tab cycle, `gateDoor`
  included, plus the 地基 tool's `halfWall` mode and wall-face cycle) so the effect
  re-runs, and the renderer's ghost identity
  (`render/moduleGhostKey.ts`) has to name the same setting — a stair's painted
  `finish` included — because
  `SceneRenderer.setModulePreview` skips a rebuild whose key is unchanged. Naming
  a setting in only one of the two is a stale ghost that only a pointer move
  clears; `game/test/gate-door.test.mjs` pins both halves.
* The **指示牌 board is a document with an editor** (`sim/sign.ts`,
  `app/SignEditor.tsx`, `render/signFace.ts`, `render/pictograms.ts`, §5.8). A sign
  used to print one fixed wayfinding canvas for the whole station; the board is now
  an ordered list of components (arrows, line badges, text, icon labels) laid out in
  metres and dragged in the board editor. A sign is **two boards**, front and back —
  independent documents, either of which may be empty, and an empty side is the unlit
  black plate (what the back of a fresh sign is). `signPanelSize` sizes the panel to
  what it carries between a floor and a ceiling, so a board never grows into a wall.
  `sim/sign.ts` is pure (no DOM, canvas or three): `signFace.ts` owns the only pixels
  and `SignEditor.tsx` the drag surface, both reading the same geometry, so the editor
  preview, the hover ghost and the lit face are one layout drawn three times. The six
  pictograms are thresholded photo-to-bitmap assets (`tools/prep-sign-icons.py` turns
  `tools/sign-icons-source/` into `src/assets/pictograms/`; 出口 is the drawn plate,
  `tools/sign-icons-sheet.py` prints the contact sheet for review);
  `game/test/sign-editor.test.mjs`, `sign-model.test.mjs` and `sign-render.test.mjs`
  pin the session, the document path and the pixels.
* The **删除 drag sweeps same-type runs** (`app/sweep.ts`, §9.5). A tap removes the
  piece under the pointer; a held drag keeps collecting same-family neighbours —
  rotation and 自动 origin ignored, variant matched, so a 2 m 座椅 never takes the
  1 m ones and a 闸机 row never takes the 售票机 at its end — sampling the path
  between pointer events so a fast flick skips none, and the release bulldozes the
  run in **one** commit (one Ctrl+Z puts it back). Rooms, rails, 出入口, 楼梯,
  screen doors and 围栏 are never swept — one piece, own teardown — while a bank of
  **escalators** or of **lift** shafts does sweep, each strictly inside its own
  family (an escalator never takes a lift); that pair is a deliberate divergence
  from §9.5, which lists both as unsweepable, and `test/sweep.test.mjs` is where
  the decision is written down. `sweep.ts` is the one app module written browser-free so Node can
  import it; `game/test/sweep.test.mjs` pins it.
* The **广告牌 / 电视 posters are a catalogue, cropped never stretched**
  (`sim/billboards.ts` `AD_POSTERS`, `render/adArt.ts`, `render/panelUv.ts`). Twelve
  campaign slugs in `src/assets/posters/`, each tagged with the silhouettes it is cut
  for, so a panel is only ever offered artwork cut for its own shape; `panelUvWindow`
  takes the centred fitting crop and `croppedPlane` walks it in three's UV order, and
  every offered crop stays under 1.45×. The posters live beside the code as
  `posters/`, not `ads/` — EasyList blocks `/assets/ads/*`, which in dev would reject
  the importing module's whole graph. `game/test/billboard.test.mjs` pins the
  catalogue, the crop and the UVs; `tools/render-tv-plate.mjs` and
  `tools/render-sign-panel.mjs` print the real draw functions to PNG for looking at
  rather than asserting.
* A **stair needs no handrail on a side a wall hugs from bottom to top**
  (`stairWallSides` in `sim/stairs.ts`, `buildStairFlight` in `render/models.ts`,
  `game/test/stairs.test.mjs` + `bay.test.mjs`). The check reads each cell of the
  run at the height the flight is at when it passes it, and reads **solids**, not
  `wall` tags: the top course of a stairwell's wall is usually the floor slab above
  it, and all five stairs in the 动物园 demo are hugged by at least one untagged
  block (the two straight platform stairs by nothing else). The wall must run the
  whole flight, so a wall that stops at the
  half-landing, a stump beside the bottom steps or a doorway through one course
  leaves the rail on. The rail, its posts and its newel return go; the stringer
  stays, so the flight still meets the wall.
* The **移动 action moves a placed 设备 / 装饰 piece** (`sim/placement.ts`
  `isMovableModule` / `movedModule` / `moveCandidate` / `moveDropReason`,
  `build/model.ts` `replaceEquipment`, `app/store.ts` `moveDraft`, `app/App.tsx`
  the `信息` card, `game/test/move.test.mjs`). It is deliberately **neither a tool
  nor a second panel**: the piece is already selected (选择), so the way in is the
  right inspector's `信息` card — pressing `移动` there lifts the selected piece —
  and *that same card* turns into the move's whole control surface while the piece is
  in the air, with `确认` / `取消` exactly where `移动` was, over the cell the drop
  would use and the rule a refused cell broke (there is no bottom bar). The lift then
  owns the pointer whatever tool is active, because a lift is a state of the *piece*,
  not a mode (the active tool is left alone). It stops being *drawn* where it stood
  and rides the pointer as the translucent ghost a fresh placement shows, **R**
  turning it in the air. A lift is **not an edit** — the piece keeps its id and its
  whole `cfg` (a 指示牌's printed boards, a 闸机's lane, a 广告牌's frozen poster) and
  never leaves the document, so nothing reaches the undo stack and `取消` has nothing
  to restore — and the drop is **one** commit (one `Ctrl+Z`), refused by the same
  rules a fresh placement answers to (floor under every cell, no track bed, nothing in
  the space, a wall for a 广告牌, a ceiling for a 指示牌 / 电视), asked of a piece that
  already exists so the copy at its origin is never the obstacle. The three ways out
  are a left press on the ground, the card's 确认 (or `Enter`), and 取消 / `Esc` / a
  right press, which puts the piece back; switching tools mid-lift also puts it back.
  A ghost carries a private id (`MOVE_GHOST_ID`), because a 指示牌's printed plate and
  a 电视's station plate are cached per module id and a preview may only dispose what
  it minted itself. Structural pieces — 楼梯 / 扶梯 / 电梯, 出入口, rooms, 轨道 / 站台门 —
  are refused (the card's button is disabled and says why), by the same rule that keeps
  删除 from sweeping one: a translation would strand the openings they carved and the
  geometry derived from them.

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

If the runner cannot spawn a child process per file (a confined sandbox reports
`spawn EPERM`), run it in one process instead — same tests, same result:
`node --test --test-isolation=none "test/**/*.test.mjs"`. A Vite `build` may be
blocked the same way; `tsc --noEmit` is the gate you can always run.

Tests import `src/sim/*.ts` directly (and `src/build/rail.ts` for the rail
suite). When you add behaviour to the sim, add a focused `.test.mjs` beside the
others and update `game/README.md`'s test list and milestone notes if the change
is player-visible. Keep `sim/` pure — a test will fail if it imports three,
React, or reaches outside `sim/`.
