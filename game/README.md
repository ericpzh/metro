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
with it, so the mouth points where the player sets it. A surface exit is rooted at the at-grade
level (h = 0 m); dropping one on a concourse or platform slab is refused.

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
* `zones.test.mjs` — an ungated fare line strands the crowd (zero boardings); a gate restores
  flow; the graph has no edge across the line; the zone bucket respects a drawn boundary (B2).
* `trains.test.mjs` — a dispatched train gets a pose on the track beside its platform edge,
  a stop is a fixed berth/open/dwell/close/hold/depart sequence, and the pose is deterministic
  (the rolling-stock render path).
* `placement.test.mjs` — `sim/placement.ts` gives every module a world footprint: two may not
  share space (a gate line in adjacent cells is fine, a module on the storey above is not a
  conflict), a ramp corridor blocks flat equipment inside it, `moduleAt` finds a module from any
  cell it covers, and `removeModule` bulldozes exactly one module and leaves its block.
* `openings.test.mjs` — a placed ramp carves the slab it climbs through but keeps its landings as
  graph nodes, and the carve clears the blocks the balustrade and handrail sweep either side of the
  run, not just the tread width.
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
