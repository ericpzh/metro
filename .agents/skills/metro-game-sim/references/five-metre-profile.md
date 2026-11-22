# Five-Metre Construction and Train Profile

Stations use 5 m storeys (`STOREY_HEIGHT = 5` in `sim/constants.ts`) and 1 m editable blocks.
`storeyHeight` (`5`) is authoritative across factories, previews, placement, graph construction,
persistence, and scene slicing.

## Covered Tracks, Catenary, and PSD Datums

All elevations below are relative to the track module's anchor (`track.z`). Both third-rail and
catenary power fit this 5 m envelope (`trackHeadroom` reserves 3 clear courses above the bed,
or 4 clear courses for open catenary bridges and gantry-style tracks).

| Surface | Height above track anchor | Source |
|---|---:|---|
| Full concrete block underside | `−1.000 m` | `BRIDGE_DECK_DEPTH = 1` / dug bed course |
| Running-rail head (`RAIL_HEAD_Z`) | `+0.160 m` | `0.65 − (0.45 + 0.49)` in `sim/constants.ts` |
| Train origin at 98% scale | `+0.3924 m` | `trainOriginForScale(0.98) = 1 − 0.62 × 0.98` |
| Train cabin floor and platform surface | `+1.000 m` | `CABIN_FLOOR_Z = 0.62` scaled at 98% |
| Pantograph carbon / wire underside | `+3.891 m` | `0.3924 + 3.57 × 0.98` (`CONTACT_STRIP_Z`) |
| Contact wire centre (`CONTACT_WIRE_Z`) | `+3.903 m` | `trainContactWireZ(0.98) = 3.891 + 0.012` |
| Ceiling block underside | `+4.000 m` | `trackCeilingUnderside` in `sim/track.ts` |

- **Vertical budget** — Total span is 5 m from concrete underside (`−1 m`) to ceiling underside
  (`+4 m`), leaving `9.7 cm` above the contact wire for compact rigid rail and ceiling brackets.
- **Ceiling block ownership** — A ceiling block belongs to the storey above (mounted on
  `cell.z`, never `cell.z + 1`).
  - `trackCeilingUnderside(track, cells)` in `sim/track.ts` caps overhead clearance at
    `track.z + trackHeadroom(track) + 1` or the lowest solid block above `track.z + 1`.
  - `trackCeilingUnderside(mod)` in `sim/placement.ts` resolves the underside of a platform or
    bridge deck (`mod.z - BRIDGE_DECK_DEPTH`) for fittings hanging beneath it.
- **Uniform vehicle scaling** — `trainScaleForStorey()` returns `0.98`, applied once at the
  train root. `doorCentres` and `doorRunOffsets` (`sim/stock.ts`) multiply by `line.modelScale`
  once so car doors, PSD openings, door servers, and floor boarding marks (`sim/floorDecor.ts`)
  stay aligned. `CABIN_CEILING_Z` is `2.99 m` in the authored train frame.
- **Platform screen doors (PSDs)** — Full-height PSDs finish `PSD_FULL_HEIGHT = 3 m` above the
  platform (`2.35 m` glass/door, `0.6 m` printed information plate, `0.05 m` top cap, no top
  padding; `PSD_FULL_DOOR_WIDTH_SCALE = 1.5`). Half-height PSDs finish `PSD_HALF_HEIGHT =
  1.45 m` above the platform. Lateral alignment uses `PSD_WALL_OFFSET = 0.34 m` and
  `trackSideFixtureOffset` (`sim/track.ts`), accounting for wide D-class cars (`3.3 m`).

## Blocks, Ceilings, and Vertical Circulation

- **Storey grid (`sim/constants.ts`)** — `LEVEL_STEPS` spans 15 storeys from `−40 m` to `+30 m`
  in 5 m steps, shifted by `levelBase ∈ 0..4` via `levelSteps(base)` and `storeyBand(z, base)`.
- **Suspended ceilings** — `suspended-ceiling` blocks are ordinary editable 1 m cells that keep
  normal finish, move, delete, undo, and save rules. They are excluded from floor zoning
  (`build/model/Zones.ts`) and from contact-finish stripping (`sim/contactFinishes.ts`).
- **Ramps (`sim/rampLengths.ts`, `sim/stairs.ts`, `sim/escalators.ts`)** — Three contiguous
  rise families are shared by both stairs and escalators:
  - `single`: `2 / 3 / 4 / 5 / 6 m` rise (`long` 5 m default; stair 2:3 run `3 / 5 / 6 / 8 / 9`
    cells).
  - `double`: `7 / 8 / 9 / 10 / 11 m` rise (`long` 10 m default; stair run
    `11 / 12 / 14 / 15 / 17` cells).
  - `triple`: `12 / 13 / 14 / 15 / 16 m` rise (`long` 15 m default; stair run
    `ceil(rise × 1.5)`).
- **Escalator incline** — Escalators use a strict `30°` incline inside integer landings
  (`run = ceil(rise / tan 30°)`; `9` cells for a 5 m rise); excess horizontal run becomes level
  terminal tracks (`escalatorInclineRun`).
- **Turning stairs** — Internal turning landings sit at half-rise (`2.5 m` for a 5 m climb);
  outer endpoints and editable cells stay integer while `buildGraph` synthesizes fractional
  virtual landing nodes. Multi-storey `centerForward` stairs place one platform per storey;
  `leftForward`/`rightForward` keep a single mid-landing.
- **Lifts (`sim/lifts.ts`)** — Shafts stack independent intervals from
  `LIFT_INTERVALS = [3, 4, 5, 6, 7]` m (`5 m` default, stored in `cfg.rises`), decoupling
  floor-to-floor stops from the 5 m viewing grid.

## Persistence and Verification

- **Single profile** — `build/model/State.ts` (`toState`, `toData`) and `persistence/save.ts`
  (`serialize`, `parse`) enforce `storeyHeight: STOREY_HEIGHT` (`5`) and normalize every line's
  `modelScale` to `trainScaleForStorey()` (`0.98`) without mutating the open document or
  shifting authored cell coordinates on import.
- **Verification suites** — `storey-height`, `covered-clearance`, `psd-end`, `train-lod`,
  `train-pantograph`, `catenary-model`, `train-bogie`, `rail`, `escalator-length`,
  `three-storey-ramps`, and `lift-interval` cover these contracts; the covered-track fixture is
  `game/test/fixtures/covered-rail-clearance.metro.json`.
