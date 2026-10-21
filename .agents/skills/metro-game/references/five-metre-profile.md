# Five-metre construction and train profile

New stations use 5 m storeys and ordinary 1 m editable blocks. The station's
`storeyHeight` is authoritative; pass it through factories, previews, placement,
graph construction and scene slicing. There is no separate demo geometry or
automatic repositioning of authored station blocks.

## Covered tracks and tunnels

All coordinates below are relative to the track module's anchor. Both power
types fit the same envelope; open bridges and 门架式 can extend higher.

| Surface | Height above track anchor |
|---|---:|
| Full concrete block underside | −1 m |
| Train and platform floor | +1 m |
| Train origin at 98% scale | +0.3924 m |
| Pantograph carbon top / contact wire underside | +3.891 m |
| Contact wire centre | +3.903 m |
| Ceiling block underside | +4 m |

The total is 5 m from concrete bottom to ceiling underside. The ceiling block
belongs to the floor above: mount on `cell.z`, never `cell.z + 1`, and do not add
a duplicate canopy plate. `trackCeilingUnderside` caps the result at the owning
track's clearance. Covered/tunnel conductor and support hardware fits within
roughly 10 cm below that ceiling. Track concrete fills the full dug block depth.

`trainScaleForStorey` and `trainOriginForScale` in `sim/stock.ts` keep the cabin
floor aligned; `trainContactWireZ` shares the collector plane with `CatenaryModel`.
Apply uniform scale once at the train root. Build doors at authored dimensions;
scale sim/PSD door centres and widths once. Keep rider slots, running-rail height,
consist length, pickup width and arrival/departure distances on the same profile.
Stock-aware barrier/mast clearance must include wide D cars. Cache identical
models as separate consist occurrences; one appearance key cannot own two poses.

Full-height PSDs finish 3 m above the platform: 2.35 m glass/door, 0.6 m printed
information plate, 0.05 m top cap. No top padding. Keep vinyl inside the glazing,
retain its aspect and align fixed/moving bands. Half-height/absent PSD behavior
and the platform yellow line remain independent of the full-height layout.

## Blocks and vertical circulation

吊顶 is a normal block-tool variant, selected by Tab; Shift+Tab toggles generated
walls. Tagged blocks retain normal finish, move, delete, undo and save behavior.
Ceiling decor mounts to their lower face through the ordinary decor tools.
Placing ceilings rehangs existing fixtures in the same storey without moving
fixtures on another floor. Hidden-ceiling mode hides the tiles; fixtures remain
visible. Do not recreate removed chunk outline hulls.

The stair catalogue's 长 5 m run spans 8 cells, and the staircase-only 超长 6 m
rung spans 9. Turning flights use a 2.5 m
internal landing; the graph supplies fractional landing nodes, never fractional
editable cells. Import validation must use the station height even when the
module tag is missing/stale. Outer endpoints stay integer. Five-metre escalators
use exactly 30° inclines within integer landings (9 cells for 5 m rise); spare
horizontal length becomes flat terminals. Lifts offer 3–7 m intervals with 5 m
as the default. Explicit equipment intervals remain independent of grid spacing.

## Persistence and validation

Five metres is the only supported station profile. Saves write
`storeyHeight: 5`; state construction and the worker use that profile uniformly.
Do not add 4 m compatibility paths, alternate train scales or tunnel migrations.
`toState`, `toData` and `serialize` set current model scale on lines, including
stale or absent scale metadata; saving must not mutate the open document. Never move cells on import.

`storey-height`, `covered-clearance`, `psd-end`, `train-lod`, `train-pantograph`,
`catenary-model`, `train-bogie`, `rail`, `escalator-length` and `lift-interval`
cover these contracts. The reported save is
`game/test/fixtures/covered-rail-clearance.metro.json`; it retains all 870 blocks.
Use a production browser for cold save opening, actual rendering and GPU checks.
Refresh coverage and geometry counts using the owning test/performance skills;
do not infer GPU correctness or FPS improvements from Node coverage.
