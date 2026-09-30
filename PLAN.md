# PLAN.md — Base demo game

**Status:** draft 1 · 2026-09-29
**Scope:** build a playable *vertical slice* of Metro Station Designer in this repository, as a
**separate application** from the concept-art site in [`web/`](web/).
**Reads with:** [`GAME-SPEC.md`](GAME-SPEC.md) (the full vision, draft 10). This file is the
build order and the deltas, not a replacement for the spec.

---

## 1. What we decided

Three things are settled before any code is written.

**1.1 — The game is a pure JS/TS project. No engine.** We re-checked this against the whole spec.
Nothing in it needs C++. React + Vite + TS for panels, three.js + R3F for the scene, a Web Worker
for the sim, JSON snapshots for saves, Vite → static assets for distribution. That is the stack in
§10.1 of the spec and we're not changing it. The open questions were never "can JS do this" — they
were about two specific budgets, and one of them is now measured (§2).

**1.2 — The game is its own app, its own deploy, its own Worker.** `web/` stays exactly as it is.
The game lives in a new top-level `game/` directory with:

- its own `package.json` and dependency tree (no shared imports, no relative escapes either way),
- its own Vite config and `tsconfig.json`,
- its own `wrangler.jsonc` and its own Cloudflare Worker project (`metro-game`),
- its own build and deploy scripts.

It does **not** consume `art/`. The concept sheets are the spec's diagrams; the game's art comes
from the 3D renderer (§2.2). Sharing nothing between the two apps means a change in one can never
break the other's build.

**1.3 — The target is a vertical slice, not M0.** Per §12, M0 is "grid in the browser" and ships no
crowd. We're deliberately skipping ahead: go wide and shallow across the whole core loop instead of
deep on build tooling. The reason is that our two unproven risks — the rounded-corner chunk mesher
and whether the look actually reads as good art in 3D — plus the one risky budget (crowd stepping)
all get settled in the first fortnight, before we invest in UX that assumes them.

**The elevator pitch for the demo:** a URL where you dig a box into the ground, and watch three
thousand people break it.

---

## 2. Findings from the spike

Run before writing this plan, so the plan rests on measurements rather than enthusiasm.

### 2.1 The crowd tick is not a problem — and we were worried about the wrong number

We benchmarked the shape the spec asks for in §7.1–7.3: struct-of-arrays agents, uniform-grid
neighbour search, 2 m personal space, per-agent state machine, density speed derate, 5 Hz tick.
Script: [`tools/bench-crowd-tick.mjs`](tools/bench-crowd-tick.mjs) (plain Node, no deps).

| agents | density | mean ms/tick | p99 | max | % of the 200 ms tick |
|---:|---|---:|---:|---:|---:|
| 1,000 | sparse | 0.10 | — | — | 0.05% |
| 3,000 | sparse (spec target) | 0.58 | 1.24 | 2.26 | 0.29% |
| 3,000 | **crush** 0.21 m²/pax | 3.92 | 5.31 | 6.40 | 1.96% |
| 3,000 | crush + per-tick allocation | 3.91 | 4.32 | 5.80 | 1.95% |
| 8,000 | crush | 14.18 | 19.80 | 22.26 | 7.09% |
| 15,000 | sparse | 3.72 | — | — | 1.86% |
| 30,000 | sparse | 15.29 | — | — | 7.65% |

Three conclusions:

- **An arrival rate is not a load.** 800 agents/min is 13.3/s, or 2.7 spawns per 200 ms tick.
  Spawning an agent is a weighted RNG draw plus a path request — microseconds. What matters is
  concurrency (Little's law, `L = λ × W`): 800/min at a ~8 min mean stay is ~6,400 agents in the
  station. At crush density that's roughly 11 ms of a 200 ms tick.
- **The §10.4 budget of "< 8 ms in the worker" is a comfort target, not a ceiling.** At 5 Hz the
  worker owns 200 ms per tick. A 40 ms tick still runs the sim in real time and still answers
  messages. Tick-time exhaustion doesn't begin until ~30–60k agents at crush — ten to twenty times
  the spec's target.
- **Density, not agent count, is the multiplier.** The same 3,000 agents cost 0.58 ms spread out
  and 3.92 ms at LOS F. The worst case is always a crush-loaded platform, which is also the case
  worth optimising for on purpose (§2.3, item 1).

Note the honest caveats: these are a desktop's numbers (a 2-core laptop will be 2–3× slower, still
fine); per-tick allocation showed no cost here because V8 scavenges short-lived objects well, but
that measures throughput, not pause variance — so the tick stays allocation-free anyway.

### 2.2 The one number that does miss the budget

A train docks and 520 agents all unlock their boarding leg in the same tick. Measured A* over a
200×200 grid with 20% obstacles:

```
520 uncached searches  =  395 ms for one tick   (0.76 ms per search, ~9,750 nodes each)
```

That is 2× over the 200 ms tick. It is the only measurement in the spike that fails.

It also confirms that the path cache in §7.2 point 3 is **load-bearing, not an optimisation**.
Those 520 agents share maybe 3–6 distinct corridors; with a cache keyed on
`(from, to, needsClass)` the 395 ms collapses to single-digit milliseconds. A second guard is a
per-tick re-path budget: amortise searches across ticks, because a 200 ms delay in a boarding
agent's path decision is invisible while a 395 ms sim stall is not.

This matters specifically because train-borne waves are *synchronised* re-paths. Spread the same
800 agents/min evenly and pathfinding is free. Dump them in 40 seconds behind a train's doors and
the cache has to already exist.

### 2.3 The SVG sheets are diagrams, and that's fine

We inspected the thirteen sheets. `tools/iso.mjs` gives every box three flat tones
(`top ×1.13`, `right ×0.80`, `left ×0.58`) and one 0.8 px outline. Across all thirteen sheets:
zero gradients inside any drawing, no per-face lighting, no texture, no contact shadows.

That flatness is *structural* — the missing information is lighting and material, which a flat
polygon renderer has no channel for — so adding more polygons cannot fix it. Which is why:

> **The sheets are spec diagrams. They are not the art-direction target.**

§1 of the spec claims the sheets "double as an art-direction target." We're retiring that claim.
The sheets have done their job: a reader can see where the fare gates go and what a 2.8 m B-type car
looks like. They stay, unchanged, as diagrams on the art site.

The real art target is four renderer features, and all four are missing from the SVG pipeline:

1. **Outline pass** — inverted hull or post-process edge detect, for §11's "dark, 0.8 px at design
   scale, drawn per face."
2. **Contact-shadow blobs** — §11 literally asks for them.
3. **Ambient occlusion + a real key/ambient rig** — this alone is most of the difference between
   "chunky toy building" and "spreadsheet."
4. **Procedural material detail** — UV-noise granite speckle, enamel panel seams, brushed-metal
   roughness.

Consequence for the plan: milestone **V1 is a material lab, and it is a hard gate.** If the look
isn't good in V1, we change the art direction before building a game on top of it.

### 2.4 Architectural rules we're adopting from the spike

- **The sim core is a pure TS package with no DOM, no worker, and no three.js imports.** It must run
  in Node. This is what makes `node sim.mjs --seed 1 --hours 24` and CI budget tests possible; it
  cannot be retrofitted once the sim is tangled into Comlink.
- **Determinism is a commit-one constraint.** Fixed tick, one seeded RNG, no `Math.random`
  anywhere in `sim/`, stable sort orders. §7.6 is a hard requirement and it is cheap to hold and
  expensive to retrofit.
- **Don't treat the worker as an event loop.** Each tick is one synchronous task: integrate all
  agents, then post, then yield. No `await` per agent, no per-item microtasks.
- **Interpolate cheaply.** The worker posts a `Float32Array` at 5 Hz (zero-copy transfer); the main
  thread keeps prev/next buffers. Start by writing instance matrices on the CPU each frame — that's
  ~0.5 ms for 3,000 agents and it's simple. Only move the lerp into a vertex shader with an `alpha`
  uniform if we measure a need.

---

## 3. Repository layout after this plan

```
metro/
  GAME-SPEC.md            the full vision (draft 10) — unchanged
  PLAN.md                 this file
  README.md               add one line pointing at game/
  package.json            add game dev/build/deploy scripts
  wrangler.jsonc          art site Worker — UNCHANGED (name: metro, ASSET_PREFIX /metro)
  worker/index.js         art site prefix Worker — UNCHANGED
  art/                    concept sheets — UNCHANGED, not consumed by the game
  tools/                  art generators + bench-crowd-tick.mjs
  web/                    concept-art site — UNCHANGED, deploys to /metro/
  game/                   NEW — the game
    index.html
    package.json
    tsconfig.json
    vite.config.ts
    wrangler.jsonc        own Worker project (name: metro-game)
    src/
      main.tsx
      app/                React shell: HUD, level strip, clock/speed  (panels only, no sim logic)
      render/             three: camera rig, nav cube, chunk mesher, materials, outline, shadows
      build/              tools, commands, undo, validation, level slicing
      sim/                PURE TYPESCRIPT — no DOM, no worker, no three imports
        worker.ts         the thin worker wrapper (the only file that touches postMessage)
      data/               constants.ts, stock.ts, materials.ts, reference-station.ts
    bench/                moved from tools/ once the app exists; wired into CI in V3
    test/                 node-run sim tests (determinism, budgets, capacity ladder)
```

**Dependency direction is one-way: `app/ → render/ → sim/`, and `sim/` imports nothing.** A lint
rule should enforce it. `game/` and `web/` share no code and no dependencies.

Gitignore needs no change: the existing bare `node_modules/` and `dist/` patterns already match at
any depth, so they cover `game/node_modules/` and `game/dist/`.

---

## 4. The vertical slice — work breakdown

Six milestones, strict order. Each has an explicit acceptance test; none is "done" until it passes.

Rough sizing for one person, focused: **~2–3 weeks total.** Sizes are relative (S/M/L), not promises.

### V0 — Shell · S (0.5 d)

`game/` app boots: Vite + React 19 + TS, a dark full-viewport canvas, an orbit camera, a grid
plane on the active level, and an FPS/tick readout.

**Acceptance:** `npm run dev -w game` serves a dark 3D viewport you can orbit and zoom, at 60 fps,
with a visible 1 m grid.
**Depends on:** nothing.

### V1 — Mesher + material lab · **L (3–5 d) — THE GATE**

The risk spike. One 16³ chunk of blocks, meshed with the §4.2 rounded-corner autotile (8-neighbour
mask, 12.5 cm bevel on exposed top edges), plus the four art features from §2.3: outline pass,
contact shadows, AO + light rig, procedural granite/enamel/baffle materials.

Ship it as a route inside the real app (`/lab`), not a throwaway page, so the renderer we judge is
the renderer we keep.

**Acceptance:** an 8×8 slab with a hole and a step in it renders with rounded corners and reads as
a *designed building*, not a spreadsheet — and you would be happy shipping that exact look.
**Also measure:** chunk mesh build time against the §10.4 budget (`< 4 ms`, chunk-local).
**Depends on:** V0.
**Kill criteria:** if the look still isn't there after 5 days, stop and change the art direction
(candidates: real cel shading with a stronger outline, or a stylised 2.5D approach) rather than
grinding on materials.

### V2 — Build loop · M (2–3 d)

The §12 M0 acceptance test, on top of V1's mesher: the 2×2 seed at `(0,0,0)`, extrude and dig with
the base-block tool (click, drag, box-drag), the work-plane so void clicks land on something (§9.5),
level slicing with `Q`/`E` and dimming of non-edited levels, and undo.

Deliberately **not** in V2: surfaces/paint, zones, modules, the module catalogue. Blocks only.

**Acceptance:** the spec's own M0 test — you can grow the seed into a detached underground box,
orbit it, and look at it edge-on.
**Depends on:** V1.

### V3 — Crowd · L (4–6 d)

The sim core, as a pure TS package. Worker at 5 Hz, station graph, agents per §7.1, flow-field
steering plus grid separation, `InstancedMesh` rendering at scale, and the LOS density overlay.

Two things must land here or V4 is impossible:

- **the path cache** keyed on `(from, to, needsClass)`, plus a per-tick re-path budget (§2.2),
- **the escalator as a capacity-limited server with a queue**, so the crowd has somewhere to pile up.

**Acceptance:** a hardcoded reference station (§7.8 — the "Wusi Square" numbers) carries 3,000
agents at ≥ 55 fps on the main thread, with **p99** worker tick < 8 ms, and determinism holds:
same seed, same tick, identical positions, asserted in a Node test.
**Depends on:** V0–V2 (needs geometry to walk on).
**Note:** V1's mesher and V3's sim are independent and could be built in parallel by two people.

### V4 — Train and the breaking point · M (3–4 d)

One line, one train: dispatch on a headway, approach, doors, per-door queues, boarding and
alighting, dwell per §6.4, departure — and **people left behind** when dwell runs out.

This is where the game becomes a game, because this is the moment the §7.8 conclusion is visible:
the platform exit is the binding constraint and it is bursty.

**Acceptance:** an AM peak visibly breaks a deliberately under-built station — the escalator queue
grows train over train, and the "left behind" counter climbs — and the fix (add an escalator, widen
a stair) visibly fixes it.
**Depends on:** V3.

### V5 — Ship it · S (0.5 d)

Own Cloudflare Worker project, deployed. A URL you can send someone.

**Acceptance:** `https://metro-game.<account>.workers.dev` loads the demo, and a stranger can figure
out the two things to do (dig, watch) without instructions.
**Depends on:** V0–V4.

---

## 5. Deploy — the game gets its own Worker

The art site keeps its current setup untouched: Worker `metro`, assets from `./web/dist`, prefix
worker, route `ericpzh.rest/metro/*`.

The game gets a **second, independent Worker project**:

```jsonc
// game/wrangler.jsonc
{
  "name": "metro-game",
  "compatibility_date": "2026-09-29",
  "assets": { "directory": "./dist", "not_found_handling": "single-page-application" }
}
```

**Recommended: deploy assets-only at the domain root of the Worker's own `workers.dev` URL.** No
prefix worker script is needed at all, which removes the whole class of trailing-slash and
relative-asset problems the art site had to solve with `worker/index.js`. Vite's `base: './'` keeps
it portable if we later move it behind a path.

**Alternative, if it should live under `ericpzh.rest`:** reuse the proven pattern — add
`"main": "./worker/index.js"`, `"assets": { "binding": "ASSETS" }` and
`"vars": { "ASSET_PREFIX": "/metro-game" }`, copy the prefix Worker, and attach the two routes
`ericpzh.rest/metro-game` and `ericpzh.rest/metro-game/*`. Same two-route rule as the art site: the
bare path needs its own route, and never collapse them into `/metro-game*`.

**Decided, 2026-09-30: the prefix, plus a 游戏 tab.** The site links to the game rather than
deploying it separately, so the game moved to the alternative above — `/metro-game/` behind a
prefix Worker, which also keeps the `workers.dev` root working. No code is shared: the site adds a
full-viewport iframe route at `/metro/game/` and points it at the game Worker through one URL
(`gameUrl` in `web/src/site.js`, overridable with `VITE_GAME_URL`). A change in either app still
cannot break the other's build; only the embed URL is a coupling, and it fails soft (the tab shows
a "check the game Worker is deployed" hint).

Root `package.json` gains, mirroring the existing `web/` delegation style:

```
setup:game   npm --prefix game ci
dev:game     npm --prefix game run dev
build:game   npm --prefix game ci && npm --prefix game run build
deploy:game  npm run build:game && wrangler deploy -c game/wrangler.jsonc
```

---

## 6. Risk register

Ordered by how much damage they do if unaddressed. Only the first two are genuinely scary.

| # | Risk | Status | Mitigation |
|---|---|---|---|
| R1 | The look still reads as flat and undetailed in 3D — the same problem the SVGs have | **Unproven** | V1 is a hard gate with a 5-day kill criteria and named fallbacks. Do not build a game on top of a look we don't like. |
| R2 | Rounded-corner autotile is expensive: rounded cells can't greedy-merge, so it's near per-cell geometry | **Unproven** | Measure in V1 against `< 4 ms`/chunk. If it misses, fall back to bevels-only on exposed edges (drop the inner fillets) — cheaper and still reads as "designed." |
| R3 | Synchronised re-path storms blow the tick | **Measured, 395 ms** | Path cache + per-tick re-path budget, landed in V3. Non-negotiable. |
| R4 | Determinism breaks and we lose A/B re-runs (§7.6) | **Preventable** | One seeded RNG, no `Math.random` in `sim/`, fixed tick, stable sorts, a Node test asserting identical output. Held from commit one. |
| R5 | Crowd stepping at scale | **Measured safe** | 3,000 at crush is 3.9 ms of a 200 ms tick. 20× headroom. No work needed. |
| R6 | GC pauses cause tail-latency spikes that the mean hides | **Partly unmeasured** | Keep the tick allocation-free; assert p99 not mean in CI; re-measure over long runs once V3 lands. |
| R7 | Scope creep — the demo grows into the spec | **Ongoing** | The §7 "not in the demo" list is enforced. Every addition needs a V-milestone acceptance test. |
| R8 | Low-end hardware (2-core laptop) is 2–3× slower than the benchmark machine | **Known** | Budget on the slow machine, not this one. Still ~10 ms tick and ~20 fps at 3,000 agents. |

---

## 7. Explicitly not in the demo

Everything below is in the spec and stays there. Adding any of it is a scope decision, not a
natural next step.

- **Track alignment tool** (§13.1) — V4 uses a hardcoded straight track.
- **Fare zones, gates, paid/unpaid** (§4.5) — V2 has no zones; agents walk freely.
- **Surfaces and paint tools** (§4.3, `N`/`M`) — V2 only extrudes and digs.
- **Module catalogue beyond three items** (§5) — V3/V4 need only escalator, stairs, and PSD.
- **Variable-area shops, restrooms, retail draw** (§5.7).
- **Custom text signage and TVs** (§5.8).
- **Queue lanes and switchbacks** (§5.5) — a big win, but V3 needs a *pile*, not order. Defer.
- **Demand curves, calendar, day types, event days** (§7.4) — V4 uses one hardcoded peak.
- **Transfers between lines** (§7.5) — one line only.
- **Air quality, depth and enclosure** (§7.7).
- **All four charts and the day report** (§8.1) — V3 ships the LOS overlay only.
- **Save/load** (§9.4, §10.5).
- **Settings page** (§9.3).
- **Camera presets beyond orbit + one flat ortho view** (§9.1) — the flat X-Z elevation is worth
  having early because it's how you read vertical circulation, but the nav cube can wait.
- **Autosave, minimap, line manager UI, exit config UI.**

**Kept, deliberately, from day one:** the **Simplified-Chinese-only interface** (§9.2). It is cheap
to do from the start and painful to retrofit, and the spec is unambiguous that it is not a
localisation toggle. Module ids, save keys and level codes stay ASCII per §9.2; every sentence a
player reads is Chinese.

---

## 8. Open questions

Decided when we get there; not blocking V0–V2.

1. **Comlink or raw `postMessage`?** The spec says Comlink (§10.1). Raw transferables are leaner and
   we only need a handful of message types. Decide at V3 against the actual message set.
2. **GPU interpolation from the start, or CPU matrices first?** Default is CPU first, measure at V3.
3. **Does `art/` get a note in `web/` explaining that the sheets are diagrams and not the art
   target?** Recommend yes, one line, so nobody re-reads §1 and starts adding detail to the SVGs
   again.
4. **Zustand + immer** (§10.1) for build state — settle in V2 when there's real state to model.
5. **Does the demo ship the `/lab` route publicly, or keep it a dev-only route?** Recommend keep it,
   it makes the art pipeline inspectable.

---

## 9. Spec deltas

Small set of places where this plan does not follow `GAME-SPEC.md` literally. Each needs a one-line
edit to the spec so the two documents agree.

| Spec | Says | This plan | Why |
|---|---|---|---|
| §1 | the sheets "double as an art-direction target" | they are spec diagrams only | §2.3 — a flat polygon renderer has no channel for lighting or material, so the claim is unattainable |
| §12 | M0 → M1 → M2 → M3 in order | vertical slice: V0–V5 crosses M0/M2/M3 shallowly | §1.3 — settle the mesher and the look before investing in build UX |
| §10.4 | "Sim tick < 8 ms in the worker" | 8 ms is a comfort target; 200 ms is the hard budget | §2.1 — at 5 Hz the worker has 200 ms per tick |
| §10.2 | "5 Hz tick" | unchanged, plus a mandatory per-tick re-path budget | §2.2 — 520 synchronised A* searches cost 395 ms |

---

## 10. Next action

Start **V0**. It's half a day, it has no dependencies, and everything else in this document is
downstream of it.

Then **V1**, which is the gate. Everything above §6 stays theoretical until V1's acceptance test
either passes or kills the art direction.
