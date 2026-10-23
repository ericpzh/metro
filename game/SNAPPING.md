# Geometry snapping audit — 2026-10-22

Placement and move anchors follow the pointed surface and actual supports. The
editing base and storey grid do not supply a floor or ceiling. Changing `levelBase`
without changing geometry must leave the snap result unchanged.

Construction placement and carried pieces pick the nearest visible object surface
before terrain behind it. `placementSurface` translates a directly hit hanger
beam into its attachment anchor using the actual hit column. Other object hits
keep their own surface cells; the existing validators decide whether that host
can support the proposed piece. Erase and floor-paint picks retain their own
contract. Both queries reuse the same per-event scene intersections.

| Path | Anchor/support source |
| --- | --- |
| Floor equipment, tiles, walls, rails and roads | Picked cell/deck, exact surface height and the current empty-space work plane; existing drag anchors preserve the pressed height. |
| Wall posters, signs, monitors, maps and lettering | Exposed adjacent floor or bottom of the actual contiguous backing column. |
| Wall glass | The aimed wall course; a lone slab edge retains the slab height. |
| Ceiling props | Nearest exposed slab or rail-deck underside in the aimed column, including the unexcavated street. No ceiling retains the pointed height and is refused by support validation. |
| Hanger-mounted props | The actual supporting beam's floor anchor; rod alignment remains a placement requirement. Fresh and moved pieces share this resolver. |
| Hanger suspension | Nearest real block/roof backing above the beam at each endpoint, including taller rooms and sloped roof geometry. |
| Pillar/lift extension targeting | Actual shaft overlap with the pointed air cell; a nominal storey boundary cannot hide or extend the shaft. |
| Module coordinate fallbacks | Exact air cell or matching floor anchor, followed by module bounds. Ramps and hung fittings require direct visible model hits in pointer tools. |
| Suspended-ceiling reattachment | Actual floor and existing ceiling delimit the room. Choose the nearest new slab within it; retain beam-supported fittings and the hanger itself. |
| Doors, booth signs, exits, ramp bays, PSD ends/covers and boarding marks | Authored curtain, booth, backing block, landing, screen-door or rail geometry, including its own rotation and dimensions. These paths already use their actual hosts. |

The module factory no longer infers `ceilingAnchored` from storey height or editing
base. Placement and moving set/reset that flag from the actual surface directly
above the candidate. This also prevents a carried slab-mounted piece from retaining
the slab flag when moved onto a hanger.

Authored piece dimensions (ramp rise/run, pillar section length, wall height,
screen-door height and roof shape) remain dimensions, not vertical snap targets.
Level navigation, slicing, zone grouping and column-erase grouping retain their
storey organization. Legacy unsupported preview models retain their authored local
offset rather than rounding it onto a world-height grid; these offsets cannot
provide support or make an unsupported placement valid.

`geometry-snap.test.mjs` checks real rendered ceiling contact, preview/commit/move/
undo agreement over 360 slab cases, off-grid wall columns, multiple editing bases,
hanger backing heights, shaft boundary picks and suspended-ceiling rooms.
`hanger`, `wall-ceiling-snap`, `equipment-placement-input`, `move`, `lights`,
`storey-height`, `sign`, `ceiling-deck`, `psd-end`, `booth-sign` and
`delete-tool` cover the owning contracts, including floor-triangle deletion.

Validation: all 2,313 owning tests and the production build pass.
`tools/check-geometry-snapping.mjs` passes nine real pointer placement/move fixtures
for slabs, hangers and wall mounts across three editing bases (69 dispatches,
including low-angle block/wall/rail/tunnel hover picks);
`tools/check-tool-picking.mjs` passes
its 38 picking/occlusion/delete/undo dispatches. Both preserve one scene raycast
maximum per dispatch and report no browser errors. Raw browser reports are under
ignored `.preview/perf/geometry-snapping/` and `.preview/perf/tool-picking/`.

Focused instrumented validation also passes: 199 owning checks, plus a 56-check
tool run. Coverage percentages below are line / branch / function percentages
from these focused runs, not claims about unrelated catalogue/tool behavior.

| Changed module | Lines | Branches | Functions |
| --- | ---: | ---: | ---: |
| `app/tools/moduleAim.ts` | 100 | 100 | 100 |
| `build/model/Ceilings.ts` | 100 | 80.77 | 100 |
| `build/model/Equipment.ts` | 88.05 | 89.07 | 87.50 |
| `sim/hangers.ts` | 100 | 90.14 | 100 |
| `sim/lights.ts` | 100 | 100 | 100 |
| `sim/vents.ts` | 100 | 66.67 | 100 |
| `sim/placement.ts` | 93.91 | 85.63 | 78.77 |
| `app/tools/EquipmentTool.ts` | 55.44 | 48.84 | 47.27 |

The broad `test:perf` in-process coverage attempt emitted no test results after
roughly seven minutes and was stopped. It is incomplete, not a pass. Focused
coverage completed with the normal separate-test-process runner. Logs are saved
under `.preview/perf/geometry-snapping/` as `coverage.log`, `tool-coverage.log`
and `broad-coverage-incomplete.log`.

The visible-object follow-up adds `placement-surface.test.mjs`: low-angle beam
hits beat distant terrain for cameras, clocks, TVs and signs, with fresh preview,
click, move and undo agreement. A nearer block occludes the beam and hidden
objects cannot attract placement. Its 18-check focused coverage run passes:
`placementSurface.ts` has 100% lines/functions and 84.62% branches; `CameraSystem.ts`
has 71.08% lines, 80.34% branches and 50% functions (other camera operations are
outside this focused run). Raw results: `object-coverage.log` in the same folder.
The follow-up also attempted the entire configured `test:perf` list with separate
test processes. It was stopped after roughly 7.5 minutes with `draw-batching` and
`train-lod` still running. This supplementary run is incomplete; it is not counted
as a pass. Its partial results are in `object-perf-tests.log`.
