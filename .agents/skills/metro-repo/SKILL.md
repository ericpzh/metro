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
  escalator, each stair flight, lift — is a capacity-limited edge with a server;
  gates, doors and stops are servers too. CSR adjacency; A* with a
  `(from|to|needsClass)` path cache, a per-tick re-path budget, and live queue
  wait folded into edge cost. `PathFinder.search()` bypasses the cache for the
  fare-line gate choice, which must see queues as they are now.
* **The worker** (`sim/worker.ts`, `sim/protocol.ts`) is the only sim code that
  touches `postMessage`. Messages in: `init` / `build` / `control`; out: `ready`
  (graph) / `state` (agent `Float32Array`s, metrics, density, train poses,
  `intervalMs`). Payloads are copied, not transferred; the renderer interpolates
  over `intervalMs`. Each tick is synchronous.
* **Zones are barriers** (`sim/zones.ts`), and *only a gate may cross the fare
  line* — if the gate's policy permits that direction. An ungated line strands
  the crowd. A two-way gate is a single lane: first come fixes the direction
  until that side drains (`sim/gates.ts`).
* **Finishes** (`sim/finishes.ts`): the *family* decides behaviour (floor walk
  speed, track bed not walkable, wall blocks), the finish decides look. The
  renderer reads the same table, so a surface cannot look like one thing and
  behave like another.
* **Placement** (`sim/placement.ts`): every module has a world footprint
  (`moduleEnvelope`); `placementBlocked` refuses overlaps with strict box tests
  (adjacent cells are fine), except that a stair/escalator may pass through an
  exit head-house. `carveRampOpenings` (`sim/openings.ts`) opens the slab a ramp
  climbs through while keeping its landings as graph nodes.
* **Rails and lines** (`build/rail.ts`, `sim/placement.ts`, `sim/world.ts`). A
  rail is a `track` module bound to a line, an `up`/`down` direction and a bed
  depth `d`. Placing one **digs** its bed course, so the mesher exposes the
  platform edge as a half-metre drop and the module supplies the recessed slab
  and rails; the consist rides at `track.z + 0.5`. The train anchor needs only a
  track — a platform edge is for boarding — so a fresh rail runs a train before
  any screen doors exist. `derivePlatformEdges` generates one `platform-edge` per
  contiguous run of walkable exposed floor beside the bed (an island platform
  yields two — the Spanish solution), and `regenerateRailEdges` re-derives them
  after the floor changes. A track bed is **either** the `floor.track` finish
  **or** a `track` module's footprint (`trackBedKeys` / `isTrackCell`), so the
  hand-built demo and placed rails agree. `station.lines` now holds many lines
  (added in the inspector); each carries stock/cars/headway, an `up`/`down`
  `direction`, and a `travelSign` (±1) — and its colour comes from
  `data/line-colours.ts` (real 广州地铁 sign colours by line number).

### Rendering and the app

* `render/models.ts` builds all module geometry procedurally — turnstiles,
  ticket machines, escalators (rolling step band via `rollEscalator`), the four
  stair shapes, exits, platform screen doors, rolling stock. **No image or GLB
  assets.** `render/materials.ts` is the shared procedural material kit;
  `render/chunkMesher.ts` emits one mesh part per finish.
* A **walled facility room** is the one `shop` module type; its fit-out lives in
  `cfg.kind` (`store` / `toilet` / `office`, plus the open `booth` counter and
  the `retail` shell). `build/model.ts`'s rectangle drag creates 商店 / 厕所 /
  办公室 / 售票亭 through it, and `render/models.ts` draws the matching interior
  and sign — 厕所 / 办公室 hang a real door on their openings, 商店 keeps an open
  front. Two rooms merge only when their type *and* fit-out match.
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
* The **track kit** has landed: rails are `track` modules with dug beds and
  derived screen doors (`build/rail.ts`, `game/test/rail.test.mjs`). The left rail
  has a 轨道 folder (tool, 上行/下行, 重置屏蔽门) and the inspector a 线路 section
  for multi-line management (name/colour/stock/cars/direction, + 新建线路); a new
  line wears its real 广州地铁 colour from `data/line-colours.ts`. The README still
  files the draw kit under **B4** and its milestone table is not yet updated.
  Walled facility rooms (商店 / 厕所 / 办公室) share the `shop` module and pick
  their fit-out with `cfg.kind`; 售票亭 is the open `booth`.
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
