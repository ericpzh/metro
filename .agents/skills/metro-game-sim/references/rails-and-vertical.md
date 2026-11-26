# Rolling Stock, Rails, Vertical Circulation, Exits, and Placement

## Rolling Stock, Tracks, and Train Service

### Stock Classes and Door Cadence (`sim/stock.ts`)

`STOCK_CLASSES = ['A', 'B', 'C', 'D', 'L']` is the single ordering source shared by worker pose
encoding (`World.trainRenderState`) and renderer decoding.

| Class | Width | Car length | Doors/side | Door width | Rated / Crush per car | Default power |
|---|---:|---:|---:|---:|---:|---|
| `A` | 3.0 m | 22.0 m | 5 | 1.4 m | 250 / 310 | `catenary` |
| `B` | 2.8 m | 19.5 m | 4 | 1.3 m | 200 / 240 | `third-rail` |
| `C` | 2.6 m | 19.0 m | 4 | 1.2 m | 170 / 200 | `third-rail` |
| `D` | 3.3 m | 20.1 m | 4 | 1.4 m (`0.8 m` cab-end) | `1758/8` / `2600/8` | `catenary` |
| `L` | 2.8 m | 16.8 m | 3 | 1.4 m | 170 / 215 | `third-rail` |

- **Authoritative doorways** — `doorCentres(line)` spaces doors uniformly inside each car
  (holding `DOOR_END_INSET = 2.8 m` from non-cab car ends, or `cabLength + singleEndDoorWidth/2
  + 0.3` at D cab ends), rounds symmetrically about the consist centre, and scales by
  `line.modelScale` (`0.98`). `doorRunOffsets(line, railW)` projects those offsets onto a track
  run so PSD openings, graph door servers (`sim/station.ts`), and floor boarding marks
  (`sim/floorDecor.ts`) share one list.
- **Formations and headways (`sim/headway.ts`, `sim/trainSchedule.ts`)** — Formations snap to
  `FORMATION_OPTIONS = [2, 3, 4, 6, 8]` (ties round down). Headways clamp to
  `HEADWAY_MIN_S = 60` .. `HEADWAY_MAX_S = 1200` s across `peak` / `offpeak` / `late`.
  `serviceTrackCount` counts platform tracks (non-tunnel, non-bridge) per line, matching
  `World.serviceTracks` dispatch and `trainAlightSeries`. `serviceArrivals` computes the next
  three arrivals purely from active train phase and headway profile without advancing `World`
  or `Rng`.

### Tracks, Power, and Train Choreography (`sim/track.ts`, `sim/trainFlags.ts`, `World.ts`)

- **Track orientation & berth centering** — `rotateLocal(rot, i, j)` turns local `+x` (run) and `+y` (across bed)
  counter-clockwise (`0: +x`, `1: +y`, `2: −x`, `3: −y`). Standard beds are 3 cells deep
  (4 cells for 3.3 m D stock). `trackTrainCentreV` aligns single-platform berths to their
  boarding side and centres dual-platform (Spanish-solution) tracks at `track.d / 2` (`1.50 m`)
  so wide Type A open plug doors clear both PSDs. Tunnel and bridge extensions share
  `TRACK_RUN_LENGTHS = [4, 16, 32, 64, 128]`.
- **Third-rail side (`thirdRailSide`)** — Tunnels and bridges place the conductor rail on
  travel right (`−1` = local `−y` for `up`, `+1` = local `+y` for `down`). Platform tracks with
  PSDs on one side place the third rail on the screen-free side; two-sided (Spanish) or
  screen-free platforms fall back to travel right.
- **Per-`(line, track)` service** — `World.dispatchTrains` runs at most one active consist per
  `(line, track)` key, boarding only at PSD door servers derived from that track
  (`doorsByTrack` via `platform-edge.cfg.from`). `connectedRun` extends approach/departure
  travel end-to-end across collinear attached tunnels and bridges.
- **Stop choreography (`sim/constants.ts`)** — Fixed phase durations:
  `approach (6 s) → berth (2 s) → opening (2 s) → dwell (30 s) → closing (2 s) → hold (5 s) →
  depart (6 s)`.
  - At `approach → berth`, `loadAlighting` seats the alighting cohort inside cabin doorway
    queues (`cabinSlot`, up to `CABIN_MAX_ROWS = 12` rows × 2 abreast per door; excess stays on
    `train.alightLeft` and refills as front rows step out) and increments
    `metrics.trainArrivals`.
  - During `opening` and `dwell`, `stepAlighting` steps pairs out every
    `CABIN_ALIGHT_PAIR_S = 1.2 s` up to `CABIN_ALIGHT_MAX_S = 15 s`; once a doorway's own cabin
    queue and `inFlight` count drain, that doorway opens boarding at `DOOR_RATE = 1.2 pax/s`.
    Past `CABIN_ALIGHT_MAX_S`, remaining unalighted arrivals add to `metrics.leftBehind` and
    all doorways open for boarding.
  - At `dwell → closing`, `closeDoors` abandons queued platform boarders (counting them in
    `leftBehind`). Riders aboard (`agent.train >= 0`) pin to `World.trainAt` and are excluded
    from collision separation, density derate, congestion pricing, and LOS.
  - `World.rebuild` sets riders down without a `leftBehind` penalty only if an edit alters that
    consist's doorway server list.
- **Train pose buffer (`World.trainRenderState`)** — 10 floats per train:
  `[x, y, z, cars, stockIdx, doorsOpen, colour, dirSign, yaw, flags]`, where `trainFlags` packs
  `doorSides` (bits 0–1: `+y` / `−y` banks facing PSDs), catenary power (bit 2), and 1-based
  line index (bits 3+).

## Vertical and Horizontal Circulation

### Stairs, Escalators, and Moving Walkways

- **Length families (`sim/rampLengths.ts`)** — Endpoints are authoritative (`rampSpanOf`,
  `rampLengthOf`). Both escalators and stairs share three contiguous rise families: `single`
  (2–6 m, default `long` 5 m), `double` (7–11 m, default `long` 10 m), and `triple` (12–16 m,
  default `long` 15 m).
- **Stairs (`sim/stairs.ts`)** — Styles: `straight`, `left90`, `right90`, `left180`,
  `right180`, `leftForward`, `centerForward`, `rightForward`, plus solid 1×1 m `cfg.block`
  stair blocks (1 m connects storeys; 0.5 m does not).
  - Widths cycle narrow / medium / wide (`1 / 2 / 3` blocks); `stairTreadWidth` and
    `stairBuildWidth` resolve block-grid tread widths to `0.79 / 1.79 / 2.79 m`
    (`blocks − 2 × STAIR_RAIL_PROUD`).
  - `stairFlightSlides` aligns multi-lane straight flights, 180° switchback pairs (`2 / 4 / 6`
    blocks wide), and 90° quarter-turn legs (`lanes × lanes` corner square landing) onto whole
    blocks so balustrades land on cell edges and drop when hugged top-to-bottom by a wall
    (`stairWallSides`, `stairLandingWalls`).
  - Interior turn landings are virtual walk nodes (`stairTurnCells`), not document blocks;
    `stairTurnConnectors` stops balustrade walls at interior landing boundaries so flights stay
    connected.
  - Throughput: `STAIR_SPEED = 1.0 m/s`, `STAIR_RATE_UP = 25/60 pax/s/m`,
    `STAIR_RATE_DOWN = 33/60 pax/s/m`, `STAIR_AVOID_S = 32 s` route preference penalty.
- **Escalators (`sim/escalators.ts`)** — Plan widths `EscalatorWidth = 1 | 2 | 3` blocks
  (`ESCALATOR_BALUSTRADE = 0.82 m`, `ESCALATOR_BAND = 0.68 m`, `ESCALATOR_SKIRT_INSET =
  0.08 m`); wide/extra-wide runs form one continuous band centred via `escalatorRun` with outer
  balustrades only. Direction is encoded by both `cfg.dir` and ordered `from`/`to` endpoints —
  reverse both together. Speed `ESCALATOR_SPEED = 0.5 m/s`, `ESCALATOR_RATE = 1.25 pax/s` per
  lane.
- **Moving walkways (`sim/walkways.ts`)** — Level (`rise = 0`) twin of the escalator in lengths
  `short 30 m / medium 60 m / long 90 m` (`WALKWAY_LENGTH_DEFAULT = 'short'`), widths `1 | 2 |
  3` (`escalatorRun` breaks level endpoint ties by plan `x` then `y`). Walkways carve no slab
  (excluded from `openings.ts`), require solid floor beneath every covered cell, exclude
  interior `walkwayCoveredCells` from graph nodes (ends-only ride), run at
  `WALKWAY_SPEED = WALK_SPEED + 0.5` (`1.84 m/s`), throughput `WALKWAY_RATE = WALKWAY_SPEED /
  0.8` per lane, and remain **step-free** (`EDGE_KIND.walkway`).

### Lifts, Fare Gates, Fences, and Exits

- **Lifts (`sim/lifts.ts`, `World.stepLift`)** — One car per shaft; `2 × 2` (`size: 2`) or
  `3 × 3` (`cfg.size: 3`) plan footprint. Stories stack upward or downward (`liftExtendedUp` /
  `liftExtendedDown`) with arbitrary intervals from `LIFT_INTERVALS = [3, 4, 5, 6, 7]` m stored
  in `cfg.rises`. Each story serves the level at its base (`liftLevels`; the top of the highest
  story is a cap, not a landing). Per-level `cfg.doors[z]` selects `front` (default, local
  `−y`), `back` (local `+y`), `both`, or `none`; only `liftLandingCells` outside the shaft are
  walkable boarding tiles. Car state machine: `idle → move` (smoothstep at `LIFT_SPEED =
  1.5 m/s`) `→ open` (`LIFT_DOOR_S = 2 s`) `→ dwell` (`LIFT_DWELL_S = 6 s`, `LIFT_BOARD_S =
  0.6 s`) `→ close → idle`. `liftRenderState` emits 7 floats per car:
  `[x, y, fromZ, toZ, carZ, doorOpen, sideMask]`.
- **Fare gates and fences (`sim/gates.ts`, `sim/fences.ts`)** — A gate is either `cfg.door =
  'lane'` (working turnstile, `GATE_RATE = 25/60 pax/s`, modes `in` / `out` / `both`) or
  `'fence'` (solid barrier, no node or server). `gateDoorOf` reads `'right' | 'left'` as
  `'lane'` and `'none'` as `'fence'`. Two-way gates commit their single lane to the first
  direction served until that side drains (`nextGateIndex`). `fenceArms` joins adjacent fences,
  gate machine sides (`gateSolidFaces`), and ramp/walkway landings (`railLandingAt`, skipping
  stair blocks).
- **Exits (`sim/exits.ts`, `sim/exitLanding.ts`)** — Three styles: head-house
  (`isExitHeadHouse`, 1–4 `cfg.bays` → 3–6 m width, doorway node at local `+2`, concrete pad
  virtual floor, `EXIT_BASE_HEIGHT = 0.25 m` visual plinth, `exitRunSnap` for straight ramps),
  `doorway` (wall/edge-aligned 1 m pad via `exitDoorwayOffset`, no carve/walls/snap), and
  `virtual` (1×1 surface guidepost exit at its own cell, `z >= 0`, no carve/walls/snap).

## Placement Verdicts and Exact Ramp Undersides

- **Single verdict (`sim/placement.ts`, `build/validation.ts`)** — `blockReason`,
  `equipmentReason`, `trackBlockReason`, and `moveDropReason` are the sole authorities shared
  by hover previews and commits. Never inline placement rules in UI tools.
- **Exact ramp undersides and carving (`sim/openings.ts`, `sim/rampSurface.ts`)** — Vertical
  underside drops below the walking line are `RAMP_FOOT = 0.5 m` (escalators) and
  `STAIR_BODY_DROP = 0.36 m` (stairs). `carveRampOpenings` opens only the run's lane span
  (`Ramp.coreHalf`); grazed side blocks become derived `rampThinCells` (preserving user-cut
  `CellShape`s). `rampBodyBoxes` builds per-tile sloped boxes for ramp-vs-flat equipment
  collision (`1e-9 m` surface-contact tolerance on ramp pairs) while leaving stair landing
  tiles and slabs below a flight buildable when `rampSurfaceRetainsVolume` proves non-zero
  remaining volume.
- **Support and anchoring (`sim/placement.ts`, `sim/hangers.ts`, `sim/boothSigns.ts`,
  `sim/psdEnds.ts`)** — Escalators and stairs require pre-existing floor only at their lower
  landing (`moduleFloorOk`), not under the full incline; fresh lifts require full 2×2 or 3×3
  base floor while extensions never check floor. Wall mounts validate crossed 1 m courses
  (`sim/courses.ts`) against solid blocks or same-side half-walls (`wallMountMissing`,
  `autofaceWallMount`), except booth-header signs (`boothSupportsSign`) and pillar-mounted
  vertical station names (`calligraphyOnPillar`). Ceiling props resolve the nearest exposed
  slab or track deck underside (`hungCeilingAim`, `topBlockZ`, `trackCeilingUnderside`) or a
  supporting roof/post hanger bar (`hangerSupports`, `hangerLiftFor`).
- **Move rules (`sim/placement.ts`)** — `isMovableModule` allows flat equipment, decor, exits,
  pillars, and runs (`stair` / `escalator`, which tear down and rebuild via `moveRebuilds`);
  lifts, rooms, tracks, platform edges, and bridge-owned piers (`cfg.bridgeId`) are
  non-movable.
