# PLAN.md — from the vertical slice to the base game

**Status:** draft 2 · 2026-09-30
**Supersedes:** draft 1 — the vertical-slice plan (V0–V5). That plan is *done*: the slice is
built, tested and deployed (§1). This document replaces it.
**Scope:** grow the shipped slice in [`game/`](game/) into the **base game**: the nine-stage core
loop of [`GAME-SPEC.md`](GAME-SPEC.md) §3, playable end to end on a station the player builds from
the 2×2 seed. **Single line.** Transfers and a second line stay out (§8).
**Reads with:** `GAME-SPEC.md` (draft 10). This file is the build order and the deltas, not a
replacement for the spec.

---

## 1. Where we are

Draft 1 set out to settle two unknowns and one budget before investing in UX. All three are now
answered by shipped code, not by argument.

| What draft 1 doubted | What the slice proved |
|---|---|
| Is the look good enough? | **Yes.** Autotile, inverted-hull outline, AO, contact blobs and procedural granite/enamel/baffle all ship at `/lab`. The gate passed. |
| Does the crowd tick hold up? | **Yes, with room.** p99 worker tick ≈ **2.2 ms at 3,257 agents** (comfort target 8 ms, hard budget 200 ms). |
| Is A* over a real station affordable? | **Yes, because of the cache.** 520 synchronised searches collapse onto the `(from, to, needsClass)` cache; the per-tick budget is asserted in CI. |
| Chunk mesh cost? | **≈ 3.7 ms warm**, ≈ 5 ms on the first chunk (JIT) — the one honest miss, and R2's bevels-only fallback is still in reserve. |
| Determinism? | **Held.** `seed + tick → identical crowd` is a Node test, and `sim/` is scanned for `Math.random`. |

Everything below builds on that: `game/` is a working single-line demo of one hardcoded station.
The base game is the same machinery, but the station is the player's, and every stage of §3's loop
is real. The risky parts are behind us; what remains is breadth, a data model, and the interface.

**Draft 1's architectural rules are carried forward unchanged** and remain non-negotiable:

- `sim/` is pure TS — no DOM, no worker, no three.js; it runs in Node.
- Determinism is a commit-one constraint: fixed tick, one seeded RNG, stable iteration order.
- One tick is one synchronous task; no `await` per agent.
- The interface is **Simplified Chinese only** (§9.2); ids and save keys stay ASCII.
- `game/` is its own app, its own tests, its own Worker (`metro-game`). It shares no code with
  `web/` or `art/`. The only coupling is the site's 游戏 tab URL.

---

## 2. What "base game" means

**Definition.** The base game is the §3 core loop working end to end on a station the player builds,
with the spec's own numbers, one line, and a save:

```
1 起点  2×2 seed                        ── already exists
2 毛坯  massing / extrude / dig          ── already exists (block tool)
3 饰面  surfaces, finishes, track bed    ── B1
4 设备  the module catalogue             ── B2 (zones) + B3 (capacity kit) + B4 (draw kit)
5 列车  line manager + timetable + trains── exists in a stub; B3/B5 make it real
6 出入口 exit config, in/out rates        ── exists; zones make it honest (B2)
7 运行  demand curves, day, charts        ── B5
8 存档  *.metro.json snapshot             ── B1 (static) + B5 (full)
9 迭代  read the charts, move a wall      ── undo exists; B5 completes it
```

**The one acceptance test for the whole thing.** A stranger opens the URL, starts from the 2×2
seed, digs a station with a concourse and a platform, paints and zones it, places gates,
escalators, turnstiles and a platform edge, sets a line and an exit demand, presses play, watches
the AM peak break it, reads *why* in the charts, fixes it — and saves the exact crush to a
`*.metro.json` a colleague can load paused and inspect.

**What "base" deliberately leaves out** is §8. Air quality, mods, Steam packaging, multiplayer, a
second line, transfers, queue-lane *ordering* semantics beyond capacity, and the full analytics
suite are all later series.

---

## 3. The structural gaps

The slice is shallow in six places, and five of them are in the data model, not the UI. Fixing the
model first is why B1 is not "add a paint button."

1. **A cell has no faces.** `Cell` is `{ x, y, z, fill, tags? }`. Surfaces (§4.3), decals, wall
   signage, track beds and PSD headers all need a place to live. Today the mesher invents faces from
   neighbours and paints them all one material.
2. **There are no zones.** §4.5's fare line is the most consequential decision in a station, and the
   slice does not have it: gates are optional queue servers, not the only legal crossing. An agent
   can walk around a gate.
3. **The line is a stub.** `dispatchTrains` ignores `line.stations[]`; `sampleTripFromStreet` boards
   `lineIds[0]`; `metrics.trainsLate` is `trains.length`. There is no line manager and no route.
4. **There is no save.** `SaveDoc` is declared in `sim/types.ts`; nothing serialises it. The schema
   must be frozen *before* content grows, or every milestone rewrites the file format.
5. **Time is not authored.** The clock runs at a fixed 1 s/tick; there is no scrub, no day type, no
   curve, no fast-forward and no chart. §7.4, §7.9 and §8.1 are all missing.
6. **Modules are ad-hoc boxes.** `scene.ts` draws gates/TVMs/benches as unit cubes from a 4-item
   `MODULE_OPTIONS`. The spec's catalogue is ~25 modules with footprints, rotation, validity,
   variable areas and rounded silhouettes.

Two debt items from the slice ride along and are repaid in the milestones that touch them:
`setUpEscalators` hardcodes the reference-station fix by id prefix (dies in B3), and the game opens
on the reference station rather than the seed (B6).

---

## 4. Milestones

Six milestones, strict order, each independently shippable and each with a Node-testable
acceptance. Sizes are relative (S/M/L), for one focused person.

**Progress.** B1 **done**: faces, the finish catalogue, per-face materials, the `N`/`M`/`I` paint
tools, tactile-strip decals, and the static save v1. B2 **core done**: `sim/zones.ts`, `Cell.zone`,
the graph barrier (no walk edge across a zone line except through a gate), the zone bucket tool, the
`分区热力` overlay and the inspector control. B2 still open: zone inference, module zone-legality
feedback (a TVM in the paid zone), and the gate direction/anchor UI. The rest is planned.

### B1 — Faces and finishes · **L (4–6 d)**

The data model the rest of the game writes against, plus the paint loop and the first save.

**Contents**

- **The cell grows six faces** (§4.1): `Cell.finish?: Partial<Record<'top'|'bottom'|'n'|'e'|'s'|'w', FinishId>>`,
  sparse — an absent face is that face's family default. ASCII ids, Chinese labels.
- **The finish catalogue** (`sim/finishes.ts`, pure data): four families 地面/天花/墙面/轨道, each
  finish with a walk-speed multiplier (and cover/light as cosmetic fields for now). The family
  decides behaviour, the finish decides look (§4.3).
- **Floors are gameplay.** The station graph reads the top finish: a slow finish costs more to walk,
  a track bed (speed 0) is not a node at all. This is the first surface with a mechanical effect.
- **Per-face materials in the mesher.** `meshChunk` groups emitted faces by finish and returns parts;
  the rounded profile, bevel, AO and outline pass are unchanged. Measured against §10.4's `< 4 ms`.
- **Paint tools** (§9.5): `N` 单块 — paint one exposed face; `M` 整面 — flood-fill the connected
  exposed region on that plane; `I` 取色 — eyedrop; `右键` erases to the family default. Ghost
  preview, undoable, marks dirty.
- **Track bed + tactile strip decals** (§4.2): the transparent quad layer that never breaks a merge.
- **Save/load v1 (static).** `persistence/save.ts`: the `metro-save` envelope, `formatVersion: 1`,
  static `levels/cells/modules/lines` only. This freezes the cell schema immediately and exercises
  the versioning contract before content grows. Top bar `保存`/`读取`, drag-and-drop, station-name
  field. The full movement snapshot is B5.

**Acceptance**

- From the 2×2 seed, hand-build an 8×8 room, paint a granite floor, a concrete strip, an enamel wall
  run and a track bed; the wall reads as enamel and the floor as granite, not one material.
- `test/surfaces.test.mjs`: a concrete top finishes a slower path than granite; a track-bed top is
  not a graph node; `paintFace` / `fillSurface` / `eraseFace` round-trip through undo.
- `test/save.test.mjs`: serialise → parse is identity for cells-with-finishes, modules and lines;
  wrong magic / bad JSON / newer `formatVersion` fail with the named Chinese error and change nothing.
- Chunk build stays `< 4 ms` warm; the crowd tests are unaffected.

**Not in B1:** zones, real module meshes, wall signage, the trait/comfort model, dynamic state in
the save.

---

### B2 — Zones and the fare line · **L (4–5 d)**

Where the station stops being a box and becomes a fare-controlled building. This is a *sim* change,
not a paint layer.

**Contents**

- **Zones** (§4.5): `outside | unpaid | paid | platform | restricted` per cell; a bucket paint tool.
- **A zone boundary is a movement barrier.** The graph emits no walk edge across `unpaid ↔ paid`,
  `paid ↔ platform` or into `restricted` — **except through the module that legitimately crosses it**:
  a gate for the fare line, a platform edge/PSD for the platform, an exit for `outside`. This is how
  "a gate is the only legal crossing" becomes true without special-casing in the sim (§13.2).
- **Validation**: a TVM or retail unit only in a legal zone; ghosts turn red otherwise.
- **Zone inference** (§4.5): a room enclosed by gates and platform edges is *proposed* `paid` with a
  dashed tint until confirmed.
- **Trip sampling respects zones**: stops must be reachable in the agent's current zone; an
  unreachable draw is dropped, and an agent that cannot reach its destination is counted in the
  existing `metrics.stuck` and shown in the HUD.
- **Zone overlay** and a right-inspector zone readout; gate config (`dir`, queue anchor).

**Acceptance**

- `test/zones.test.mjs`: a station with no gate produces **zero boardings** (the crowd cannot reach
  the platform); adding turnstiles restores flow; a TVM in the paid zone is flagged invalid.
- The reference station is zoned and still reproduces the same bottleneck.

**Depends on:** B1 (zones are painted on the same cells).

---

### B3 — The capacity kit · **L (5–6 d)**

The modules that move people. This is where the slice's hardcoded fixes are replaced by real
catalogue items, and where the escalator stops being the only place a crowd can pile up.

**Contents**

- **The module catalogue** (`data/modules.ts`): ASCII id, Chinese label, footprint, rate, zone rule
  and a render factory. Ceiling on ad-hoc boxes in `scene.ts`; modules are rounded-corner meshes with
  the outline and contact blobs of §11.
- **Capacity modules:** turnstile (bidirectional, queue anchor), accessible gate, wide barrier, swing
  door, add-value machine, ticket window, vending machine, bench, info pillar, vent shaft.
- **Vertical circulation:** escalator / stair / lift placeable as a run from one level to the next
  with a live rise/validity readout; ramp. `setUpEscalators`' id-prefix hack is deleted; the reference
  station is rebuilt from catalogue placements.
- **Platform edge and PSDs** (§5.3): edge bound to line/dir/side and requiring the tactile strip;
  full and half-height PSDs, one server pair per car door, opening only with a train and locking the
  platform from the track.
- **Queue furniture** (§5.5): queue rail, belt barrier, single-file and two-abreast lanes and
  switchbacks — a lane is a **server with storage**: `capacity = floor(L/0.80)+1`, ≈45 pax/min,
  no overtaking, no lateral exit. The lane's wait is knowable before the crowd arrives, which is the
  point.
- **Build UX:** `J` opens a categorised catalogue; `R` rotates; ghosts show footprint, zone legality
  and predicted pax/min; drag places runs (rails, PSDs); right-click deletes a module and leaves the
  block.

**Acceptance**

- `test/lanes.test.mjs`: a lane holds `floor(L/0.8)+1` agents, serves ≈45/min, and no agent overtakes
  or leaves sideways; a PSD holds the platform while no train is present.
- The reference station's platform still breaks on one escalator and is fixed by a second — now built
  through the catalogue rather than a function.

**Depends on:** B1, B2.

---

### B4 — The draw kit · **M (3–4 d)**

What pulls people and makes a station legible: variable-area buildings and player text.

**Contents**

- **Variable-area buildings** (§5.7): shops, cafes and restrooms placed by rectangle drag ≥ min size,
  flow scaled by floor area (`0.2–0.3 × area` shoppers/min), overflow queuing outside, resize by
  handles, saved as `w, h`.
- **Signage and displays** (§5.8): info pillars, guide stickers, billboards, ad towers, hanging
  signs and the three TV mounts with player text; live quads in 3D; PSD header auto-text from the
  timetable. Wayfinding is mechanical (info pillar −decision time, guide sticker −15 s search);
  the rest is legibility.
- **Stops** (§7.4a): agents roll 0–3 intermediate stops from modules on their corridor — TVM, retail,
  restroom, bench, browsing — with patience-based skip.

**Acceptance**

- `test/stops.test.mjs`: a corridor with a TVM produces `buying` agents and a queue; a bigger shop
  draws proportionally more stops; an agent whose stop queue exceeds patience drops it and continues.
- A shop, a restroom, a pillar and a billboard place, resize, carry text and render.

**Depends on:** B3 (catalogue).

---

### B5 — Authored time, charts and the snapshot · **L (5–6 d)**

The "read the station" half, and the save that makes it shareable.

**Contents**

- **Demand** (§7.4): a non-homogeneous Poisson per exit, shaped by curve × calendar × event ×
  exitControl; weekday / Saturday / Sunday / holiday; peak windows; boarding vs exit share;
  service window.
- **The timeline is a tool** (§7.9): scrub to any minute, play, fast-forward (headless tick batches,
  never a bigger step — §7.6 stays intact), and re-run the same window after a change for a true A/B.
- **Metrics at 2 Hz into 5-minute buckets**: per exit, per gate group, per escalator group, per
  platform-door group, plus population and worst LOS.
- **The `数据` drawer** (§8.1, key `T`): 进出站客流, 列车载客, 等待时间, 站内人数 — actual vs
  configured, hover to frame the offending asset.
- **Overlays** beyond LOS (§8): queues, throughput, boarding, dead weight.
- **Full snapshot save/load** (§9.4, §10.5): `formatVersion: 2` adds the dynamic block — RNG state,
  every agent (full §7.1 struct + quantised position + path/queue slot), trains, per-server queues,
  spawn timers. A `v1 → v2` migrator keeps B1 saves loadable. Save pauses at a tick boundary; load
  restores paused at that tick. `Ctrl+S` / `Ctrl+O`, dirty dot.
- **Settings page** (§9.3): global per-browser `localStorage`, display/camera/operate/sim groups,
  IndexedDB autosave slots.

**Acceptance**

- `test/time.test.mjs`: a full day runs headless; the peak lands where the curve says; two runs with
  the same seed and inputs are identical; a change to the layout changes the outcome.
- `test/snapshot.test.mjs`: run to mid-peak, snapshot the worker, restore into a fresh world, and the
  next 500 ticks are byte-identical to the uninterrupted run; the file is `< 2 MB`; a corrupt or
  newer file fails by name and leaves the open station untouched.

**Depends on:** B1–B4 (the schema it freezes).

---

### B6 — Ship the base game · **M (3–4 d)**

**Contents**

- **Camera** (§9.1): the nav cube and the five presets (`1` 等距 / `2` 俯视 / `3` 自定义 / `4`
  X-Z 正立面 / `5` Y-Z 侧立面), `F` frame, `X` ghost, `C` cutaway.
- **Minimap** and the bottom-rail line/exit lists.
- **Blueprints** (§9.5): copy/paste a selection, so a 120 m station is not thousands of clicks.
- **Open on the seed**, not the reference station: a new station starts as the 2×2 slab with a
  one-line prompt (build a gate, reach the platform), and 参考站（五四广场） stays a one-click sample.
- **Performance pass** against §10.4 on a 60×60 × 5-level station and 3,000 agents, on a slow
  machine, not this one.
- Docs and deploy: README, this plan, the site tab.

**Acceptance:** the §2 acceptance test, performed by someone who has not read this file.

**Depends on:** B1–B5.

**The line is still one line.** When the base game ships, a second line and transfers open the next
series (§8); the same graph and the same save already have room for them.

---

## 5. Time, determinism and the tick

This is the one durable decision the slice left half-made, and B5 finishes it.

- **The crowd's clock stays honest.** A tick advances ~1 simulated second; a walking agent moves
  ~1 m. §10.3's "24 sim-hours in ~12 real minutes" is *incompatible* with a 5 Hz continuous,
  separable crowd — 12 min/day is 24 s per tick, and 24 s of walking is 32 m. The slice chose the
  crowd; the base game keeps that choice.
- **Fast-forward multiplies ticks, never the step** (§7.6). 16× runs 80 ticks/s in headless batches;
  at the measured p99 the worker still has room. The timeline scrubs by re-simulating from a
  snapshot (or the day start), which determinism makes exact.
- **A day is authored and pointed at.** The default speed is 4×, the peak window is 1.5 h ≈ 18 real
  minutes at 1×, and the tool is the scrubber plus fast-forward, not an unstoppable clock.
- **Budgets are asserted, not assumed:** p99 worker tick < 8 ms at 3,000+ agents, chunk build
  < 4 ms, frame 16.6 ms. `SIM_SECONDS_PER_TICK` in `sim/constants.ts` remains the one number that
  changes the time base, and the comment there explains the trade.

---

## 6. The save format

Frozen in two steps, on purpose.

- **`formatVersion: 1` (B1).** The envelope, plus static `levels / cells / modules / lines`. Cells
  carry sparse `finish` maps. No movement. This is enough to share a *layout* and to keep long builds
  across development.
- **`formatVersion: 2` (B5).** Adds the dynamic block of §10.5: `rng`, `agents[]`, `trains[]`,
  `queues[]`, `spawns{}`. Loading restores the exact paused tick; the graph and meshes are rebuilt
  from `static` and never serialised.
- **One migrator per breaking change**, shipped forward (`v1 → v2`, …). A file newer than the game is
  rejected whole (`存档版本过新，请更新游戏`), never partially loaded. Corrupt, wrong-magic or missing
  sections fail by name and leave the open station untouched.
- Settings (§9.3) are global and never written into a station file, so sharing a save leaks nothing.

---

## 7. Risk register

Only the first two are genuinely new; the rest are managed.

| # | Risk | Status | Mitigation |
|---|---|---|---|
| R1 | **Per-face materials blow the chunk budget.** Rounded cells can't greedy-merge, and now each face can differ | **Unproven, measured in B1** | Group by finish; measure `< 4 ms` in CI. R2's fallback (bevels-only, fewer finish variants) still stands. |
| R2 | **Zones as graph barriers surprise players** — an ungated station silently traps everyone | Unproven | Make it the first lesson, not a silent rule: the seed prompt points at the gate, and the `stuck` counter explains a trapped station. |
| R3 | **Save format churn** — every milestone changes the schema | Preventable | v1 in B1, a migrator per break, round-trip tests in CI from the first version. |
| R4 | **Scope creep back toward the full spec** | Ongoing | §8 is enforced; every addition needs a B-milestone acceptance test. Transfers are explicitly deferred. |
| R5 | **Determinism breaks as zones/stops/trains are added** | Preventable | The existing scan + identical-output tests stay; new randomised draws go through the one RNG. |
| R6 | **The reserve speed budget is spent by zones + stops + modules** | Measured safe at the slice | p99 2.2 ms of 8 ms at 3,257 agents leaves 3–4×; re-measure at each milestone on the slow machine too. |
| R7 | **Low-end hardware is 2–3× slower** | Known | Budget on the slow machine; keep the tick allocation-free. |

---

## 8. Explicitly not in the base game

In `GAME-SPEC.md` and staying there. Each is a later series, not a natural next step.

- **Transfers between lines** (§7.5) and **a second line** — the base game is single-line by decision.
  The graph, the save and the metrics keep room for them.
- **Line tool for curved alignment** (§13.1) — the base game keeps straight track; the edge is bound
  to a line, not a spline.
- **Air quality, depth and enclosure** (§7.7) — comfort model, deferred.
- **Full analytics**: OD/transfer matrices, flow arrows, the day-report export (§8) beyond the four
  charts.
- **Module catalogue beyond what B3/B4 need** — no depot sidings, no crossovers, no event-day venues.
- **Settings beyond §9.3's rows**, cloud saves, multiplayer, mods, Steam/Electron packaging.

**Kept from day one:** Simplified-Chinese-only interface (§9.2); ASCII ids in the save; the pure
`sim/` package; determinism.

---

## 9. Spec deltas

Places where this plan does not follow the spec literally. Each is one line in the spec.

| Spec | Says | This plan | Why |
|---|---|---|---|
| §10.3 | 24 sim-hours in ~12 real minutes | the crowd's tick is honest; the clock is authored and scrubbed | §5 — 12 min/day is 24 s/tick, incompatible with a separable 5 Hz crowd |
| §12 | M0 → M1 → … → M6 in order | base game B1–B6 covers M1–M4 single-line; M5's transfers deferred | §1 — the slice already crossed M0/M2/M3; the remaining risk is the model and the interface |
| §13.1 | line tool generates the alignment | straight track bound to a line | keeps the base game focused; the editor is B7+ |
| §5.5 | lanes give *order* (no overtaking) | lanes are servers with storage and no lateral exit; strict single-file ordering is simplified | the capacity effect is what the §7.8 ladder needs; ordering is polish |
| §1 | the sheets double as the art target | they are diagrams only (carried from draft 1) | unchanged |

---

## 10. Next action

**Start B1.** It has no dependencies, it freezes the data model and the first save format, and every
other milestone writes against it. The gate for B1 is §4's acceptance: a hand-built room whose
materials are visibly distinct, a floor finish that changes the path cost, a static save that
round-trips, and the chunk budget still green.

Then **B2** — zones — is the milestone that turns the demo into the game, because that is the moment
the fare line becomes the decision it is in the spec.
