# `game/test` — how the game is tested

The suite is `node --test` over `test/**/*.test.mjs`. Nothing here runs in a browser:
the tests import the TypeScript sources **directly** (Node strips the types) and drive
them the way the app does — the sim in-process, the renderer helpers headless, and the
React store through its own actions. That is a property of the sources, not of the
harness: `sim/` is pure and DOM-free (`layering.test.mjs` fails if it stops being),
the drawing helpers that have pixels take a 2D context, and `app/store.ts` is zustand
with no view attached.

`escalators` also pins the inspector's selected-run direction switch and its undo: travel reverses
by swapping `from`/`to` together with `cfg.dir`. `escalators` and `module-build` also pin the
single two-block-wide escalator: its continuous
moving band, outer rails, rotated footprint, landing support and two-column opening.
They also check the wider metal shoulders, flattening risers and covered step return;
`slope-cut` checks the recessed upper landing beneath the terminal deck.
`module-build` also checks floor/apron clearance and the body's inset, buried joins.
It pins train roof/body paint and non-overlapping cab seams, plus half-height screen-door caps
that slide clear with their leaves. `train-cabin` pins spawning at the stopped berth before opening,
and clearing riders after closing while the train is still stationary.
`module-build` also checks clear train-door window apertures and screen-door slide-lane clearance
for both screen heights, both track sides, and closed, partial and fully open poses.
It also pins the slim half-height rails, cap/rail vertical separation, single glass surfaces,
reference cabin fittings, and train interpolation between snapshots including early updates and reappearance.
`escalator-length` checks the 8 m 长 variant in both widths, rotations and directions,
its two-floor openings, graph ride time, exit snap, preview refresh, move and save round-trip;
`pick-tool` checks copying 短/长 and restoring the previous length with Esc.
`ramp-join` checks shared metal caps between escalators and stair-escalator pairs,
including wide pieces, rotation, reversed travel, single seam ownership and neighbour removal.
It also checks the closed end shells and centreline hemispheres seated on the metal cap.

The `shelf` suite also pins tall/short, wire and cooler variants, their save/preview/sweep identity, rotated model bounds, ceiling clearance and cooler shell and tall/short gondola plinth/trim separation to prevent flickering.

## Running them

`ceiling-decor` also covers the 监控 枪机 / 球机 / 半球机 variants: legacy saves, variant save round-trips, ceiling support, ghost refresh, same-variant sweeps and rotated dome bounds. The 枪机 checks also pin the curved hood, rounded white surround, inset dark panel, contained IR ring and downward-facing circular lens. `pick-tool` checks copying each camera variant and restoring the previous selection with Esc.

```powershell
cd game
npm test                 # node --test "test/**/*.test.mjs"
npm run typecheck        # tsc --noEmit — the other half of "it works"
```

If the runner cannot spawn a child process per file (a confined sandbox reports
`spawn EPERM`), run the whole suite in **one** process — same tests, same result, a few
seconds slower:

```powershell
node --test --test-isolation=none "test/**/*.test.mjs"
```

While iterating, one file:

```powershell
node --test --test-isolation=none test/openings.test.mjs
```

And the coverage the numbers below come from (V8, per file, lines / branches / funcs):

```powershell
node --test --test-isolation=none --experimental-test-coverage "test/**/*.test.mjs"
```

## What is here

`test/support/` holds the shared harnesses — the only files here that are not
`*.test.mjs`:

| File | What it is |
|---|---|
| `support/scenario-station.ts` | The hand-built **Wusi Square** rig the sim suites use as a controlled station (the shipped 动物园 save is `src/data/demo-station.json`, loaded by `demo.test.mjs`). |
| `support/stub-canvas.mjs` | A recording 2D context: every fill, stroke, word (with its size and ink colour) and drawn image is kept, so a "does this print pixels" test asserts **what** a plate says, not that it did not throw. |
| `support/pictograms.mjs` | The 指示牌 pictogram PNGs off disk, for the sign render tests. |
| `support/camera-rig.mjs` | A live `CameraSystem` with no canvas and no GL: a plain three.js camera plus a DOM-shaped stub for `OrbitControls` to attach to, for the widget's camera tests (`camera-vertical-pan`, `camera-fov`, `camera-orbit`). |

`fence` also checks the glass/gate/iron variants, legacy saves, variant previews and drag placement,
raised gate clearance, eight iron uprights, ground decals in either placement order, and deletion
that leaves the ground decal intact.

`booth-model` checks the information counter's accessible notch, the ticket kiosk's
transfer openings, open overhead frames, visible sign faces, footprint bounds and translation.

The suites, by the thing they are about. Each one's full description is in
`../README.md`'s test list — that list is the detail, this is the map:

| Area | Files |
|---|---|
| Architecture | `layering`, `scene-wiring` |
| Numbers | `rng`, `clock`, `demand` |
| 屏蔽端门 | `psd-end` — fixed glass stack, matching heights, Tab preview refresh, shortened corner snapping and exact 1 m extensions, tile-contained meshes/reservations and adjacent block/equipment placement, hover/click placement, undo, walk barrier and save/load; curtain-wall widths and picking |
| The crowd and the graph | `determinism`, `capacity`, `demo`, `gates`, `gate-door`, `zones`, `lift`, `placement`, `openings`, `stairs`, `escalators`, `escalator-length`, `slope-cut`, `ramp-fill`, `trains`, `train-cabin`, `stock`, `load`, `agent-route` (including the 1.5 m figure scale), `worker-preview`, `wayfinding` — `gates`, `zones` and `wayfinding` force `zoneBarriers: true`, because §4.5's fare line is off by default (`ZONE_LINES_BLOCK`) while the demo's zone paint is unfinished; `train-cabin` is the cabin the crowd rides in and `worker-preview` the worker path that must not step the sim to show a route |
| The document and its edits | `save`, `grid`, `pick-cell`, `ground`, `walls`, `halfwall`, `triangle`, `blocktool`, `zonetool`, `facility`, `fence`, `storey`, `exits`, `bay`, `surfaces`, `rail`, `validation`, `overground`, `roof-tool`, `track-run-length`, `structures-gaps` — `storey` checks the 0–3 m height base and `save` checks its persistence and older-save default; `overground` + `roof-tool` are the pillars/roofs/doorway-exits/stair-blocks/bridges, `track-run-length` the shared tunnel/bridge lengths, `structures-gaps` the repair-shaped edges; `ground` is the city's own floor: the plane at `z = 0` is stored **inverted** (`sim/ground.ts`), so it owns the window `withGround` materialises, the dig that records a hole and the edits that fill it back |
| The furniture and the decor | `hanger`, `shelf`, `desk`, `checkout` (shop placement, saves, rotated bounds, screen/stock visibility and workstation chair), `restroom`, `bench`, `vending`, `decor`, `ceiling-decor`, `lights`, `vent`, `floor-decor`, `street-decor`, `sign`, `sign-model`, `sign-editor`, `billboard`, `glass-panel`, `calligraphy`, `line-map`, `booth-model`, `room-model` |
| The models | `module-build` (including slab-track sleepers, seats, clips and rail heads; enclosed double bins, hopper face winding, sealed full-height PSDs and moving decals), `restroom-model` (three-sided cubicles, privacy doors, flush joins, shared partitions, rotations, previews and neighbour removal), `lift-style`, `psd-decals`, `ramp-join`, `tv-screen`, `tv-pair` |
| The scene | `chunk-cache`, `level-slicing`, `grid-visibility`, `ground-visibility`, `section`, `section-drag`, `cut-clipping`, `floor-surface`, `camera-vertical-pan`, `camera-fov`, `camera-orbit`, `view-home`, `refused-ghost` — `ground-visibility` is the street's own mesh pass and the 隐藏地面 tile that takes it away |
| The pixels | `sign-render`, `station-display` (TV layout, per-track timetable and seconds/minutes), `exit-banner` |
| The app | `move`, `delete-tool` (block delete rectangles, Shift lines and one-step undo), `sweep`, `paint-mode`, `tool-shortcuts` (B/P/M toggle back to the previous tool), `rail-folders`, `rail-families`, `line-edit`, `select-agent` — `escalators` covers the placed-run direction action and undo |

## The rules a test here follows

Roof placement coverage in `roof-tool.test.mjs` includes pointer-centred footprints for plain, shell and truss roofs at all widths and rotations, matching hover and click anchors, the shell bay's truss-less variant passthrough, and roof-height ray projection in perspective and orthographic views.

`overground.test.mjs` covers pillar dimensions and 4 m extension. `pillar-length.test.mjs` pins the Tab choice of 2 m / 4 m sections for both pillar widths; `pick-tool.test.mjs` pins copying the choice and restoring it on Esc.

1. **Import the source, not a copy.** `import { buildGraph } from '../src/sim/station.ts'`
   — no build step, no bundler, no `dist/`. If a module is hard to test, that is a
   statement about the module: `sim/` is kept pure for exactly this reason.
2. **Pin a number and say what it means.** `assert.equal(height, 1.25, 'the 闸机 is the
   reference’s 1250 mm machine, not a 1 m cube')` beats `assert.ok(height > 1)`: the
   failure message is then the spec, and a reviewer can check it against the source.
3. **Test the silent failure.** The bugs this suite exists for are the ones that throw
   nothing: a lit pane buried in its own backing (`tv-screen`), a plate that prints no
   ink (`sign-render`, and `station-display`'s drawing half), a piece that draws nothing
   (`module-build`), a chunk cache that re-uploads the station on every edit
   (`chunk-cache`), a crowd that never boards (`demo`). Ask what a broken version would
   *look* like — if it looks like the working one, that is the test to write.
4. **Keep the helper pure if you want to test the drawing.** Anything with pixels in it
   that a test needs is split so the arithmetic lives in a three-free module
   (`render/section.ts`, `render/levelSlicing.ts`, `render/stationDisplay.ts`,
   `render/signFace.ts`, `app/sweep.ts`) while the scene owns the GPU. `layering.test.mjs`
   and `scene-wiring.test.mjs` guard the two rules that keep that possible.
5. **No sleeps, no network, no snapshots on disk.** Everything is deterministic or it is
   seeded: `rng.test.mjs` pins the generator and `determinism.test.mjs` pins the crowd.
6. **A new behaviour goes in a `.test.mjs` beside the others, and two documents get a
   line**: `../README.md`'s test list (what it pins, in the repo's own words) and this
   file's table above (where it sits).
7. **Set state in the test, not in a `test.beforeEach` — unless the file owns the
   state.** The suite runs in **one process** (`--test-isolation=none`), so the store
   and the globals (`Worker`, `self`, `document`) are shared by every file, and a
   top-level hook in one file runs around *another* file's tests: a `beforeEach` that
   resets the document under `pick-tool` leaves it looking for fixtures that are no
   longer there. A file that stubs a global or seeds the store for its own suite may
   use a hook; a file that only *reads* them should arrange itself inside the test
   (`worker-preview`, `select-agent`).

## What is not tested, deliberately

* **The GPU.** Anything that needs a real WebGL context — shadow rendering, the actual
  buffer upload, `SceneRenderer`'s visual output — is out. The parts of that path that
  can be wrong quietly are covered by their arithmetic instead (`chunk-cache` observes
  the buffer objects a rebuild reuses, `cut-clipping` walks the material assignment).
* **The React views.** No test imports a `.tsx` file — which is why none of them appears in the
  coverage table at all rather than at 0 %: `app/Viewport.tsx`, `app/ViewCube.tsx`, `AppShell.tsx`
  and `app/windows/**` are never loaded by the suite. They are a thin shell over the store and the
  scene, and it is those two that are tested (`move`, `sign-editor`, `paint-mode`, `line-edit`,
  and the camera tests, which drive `CameraSystem` behind the widget rather than the widget
  itself). Pure inspector selection logic is tested without importing the view: `line-edit` pins
  how a selected screen door resolves to its owning platform. Cell zones are painted and erased by
  the 分区 rail tool (`zonetool`), not by a selected-cell inspector card. A component that renders
  nothing fails visibly; a store action that forgets a field
  does not.
* **Vite-only modules.** `render/adArt.ts`, `render/pictograms.ts` and
  `render/lineMapArt.ts` resolve their  artwork through `import.meta.glob`, which plain Node does not implement. Tests that
  need an ad face stub it (`module-build`, `tv-screen`); the pixel code they feed
  (`render/stationDisplay.ts`, `render/signFace.ts`) is tested directly, and the map
  plate tests (`line-map`) stub the art cache rather than the glob. `SceneRenderer` is in
  this family for a different reason — importing the class runs the same glob — so its
  two one-line wrappers (`pickAgent`'s blocker distance and the `id >= 0 ? id : null`
  mapping, and `setRoute`) are covered by the `CrowdSystem` and tool tests they hand off
  to rather than directly.
* **`/lab`, `boot.tsx`, `mobile.ts`** — the manual harness, the lazy bootstrap and the
  phone gate, all of which are browser-shaped by construction.

## Coverage, and the gaps that were closed

Measured over the whole suite (`--experimental-test-coverage`, one process): **1094 tests,
93.29 % lines / 87.78 % branches / 89.01 % functions** across the `game/src` files the suite
loads — a denominator that grew by several features' worth of code (floor decor, screen returns,
the shelf and camera variants, the room rebrand, the train rebuild) in the same
passes, which is why the percentages step back while the suite grows.
The snapshot before this pass was 1035 at 92.79 / 88.52 / 88.80, and before that 938 at 95.02 / 88.36 / 88.94, and before that 897 at
95.50 / 88.64 / 89.79, and before that 891 at 95.23 / 88.63 / 89.41, and before that 855 at
94.94 / 88.47 / 88.23 — **these numbers are a snapshot of a moment, not a target**;
regenerate them with the command above whenever the suite grows. The point of the table is
the column that shows what an untested file was hiding.

| File | Before | Now | The test that closed it |
|---|---|---|---|
| `sim/ground.ts` (the street plane) | — (new) | 100 % lines / 97.6 % branches | `ground` — the window, the three answers at a coordinate, the dig and the fill-back, the brushes that materialise the plane, and the two predicates that read it |
| `render/models.ts` (the dispatcher) | 100 % | 100 % | `module-build` (now including the 灯具/通风口/导向柱/公交站/地面 rows, which closed the new dispatch arms) |
| `render/models/pieces/PsdModel.ts` (站台门) | 11.1 % | 100 % | `module-build` |
| `render/models/pieces/ExitModel.ts` | 95.7 % | 97.8 % | `module-build` |
| `render/models/pieces/TrackModel.ts` | 100 % | 95.1 % | `module-build` |
| `render/models/pieces/TvmModel.ts` | 28.6 % | 100 % | `module-build` |
| `render/models/pieces/TrainModel.ts` | 99.1 % | 99.2 % | `module-build` |
| `render/models/pieces/CabModel.ts` | 37.5 % | 97.2 % | `module-build` |
| `render/models/pieces/LiftModel.ts` | 94.6 % | 91.7 % | `module-build`, `lift-style` (the glass housing added branches faster than pins) |
| `render/models/pieces/BenchModel.ts` | 38.5 % | 100 % | `module-build` |
| `render/models/pieces/ShelfModel.ts` | 42.9 % | 100 % | `module-build` |
| `render/models/pieces/BillboardModel.ts` | 50.9 % | 100 % | `module-build` |
| `RoomModel` / `Desk` / `Cubicle` / `Sink` | 96-100 % | 98-100 % | `module-build` |
| `render/stationDisplay.ts` (the plate's pixels) | 56.7 % | 100 % | `station-display` |
| `sim/rng.ts` | 83.5 % | 100 % | `rng` |
| `data/reference-station.ts` | 75.0 % | 100 % | `demo` |
| `app/store/slices/LineSlice.ts` | 34.0 % | 100 % | `line-edit` |
| `app/store/slices/StationSlice.ts` | 91.7 % | 100 % | `line-edit` (the authored day: window, peaks, knobs) |
| `app/store/slices/SimSlice.ts` | 93.2 % | 93.9 % | `line-edit` (the route token), `select-agent` (the pick) |
| `sim/stock.ts` (the cabin box) | 96.3 % | 100 % | `stock` |
| `sim/world/World.ts` | 96.6 % | 96.9 % | `train-cabin`, `worker-preview` |
| `sim/demand.ts` | 100 % | 100 % | `demand` — but the *crowd* it shapes was untested, which is the row that mattered |
| `sim/station.ts` (the re-path queue) | 97.1 % | 97.5 % | `wayfinding` (the budgeted drain and the consumed-prefix compaction) |
| `render/scene/systems/GridSystem.ts` (scene teardown) | 88.5 % | 100 % | `grid-visibility` |
| `render/scene/systems/ChunkSystem.ts` (scene teardown) | 92.6 % | 93.7 % | `chunk-cache` (the wall-pick singletons and the tint caches) |
| `render/scene/systems/GhostSystem.ts` (scene teardown) | 73.5 % | 85.1 % | `refused-ghost` (the remove-drag pool mesh) |
| `sim/trainSchedule.ts` (the timetable forecast) | — (new) | 100 % lines / 100 % branches | `station-display` (forecasts checked against the real dispatcher) |
| `sim/lights.ts` / `sim/vents.ts` / `sim/inCellPositions.ts` | — (new) | 100 % lines | `lights`, `vent` |
| `render/models/pieces/LightModel.ts` / `VentModel.ts` / `StreetDecorModel.ts` | — (new) | 100 % lines | `lights`, `vent`, `street-decor`, `module-build` |
| `render/models/pieces/RampJoinModel.ts` | — (new) | 98.7 % lines | `ramp-join`, `module-build` |
| `render/models/pieces/EscalatorModel.ts` (rebuilt band) | — (rebuilt) | 98.0 % lines | `module-build`, `escalators`, `ramp-fill` |
| `render/models/pieces/DoorwayExitModel.ts` | 31 % | 100 % lines | `module-build` (doorway rows: one row per bay, widths 3/4/5 m) |

Two behaviour pins move no coverage line — the rationed searches were already
executed, just never capped — so they are verified by mutation instead: with the
cap removed the crush test fails 6 ≠ 4 and the at-gate test fails 5 ≠ 2
(`wayfinding`: `REROUTE_REPLAN_PER_TICK`, and the fare-line ration at the gate's
own cell).

The files still lowest after this pass, and why they are:

| File | Lines | What is left |
|---|---|---|
| `build/model/Reference.ts` | 31 % | A barrel whose one consumer is the demo path; nothing imports it directly. |
| `render/scene/systems/GhostSystem.ts` | 85 % | The hover-ghost limbs and the back-to-back face mesh: they build meshes for a live scene and are driven by pointer moves (`gate-door`, `triangle` and `tv-pair` cover the keys and the wedge slope they read). |
| `app/store/slices/RailSlice.ts` | 46 % | The rail actions the UI calls; the pure edits underneath are covered by `rail` (`build/rail.ts`) and `line-edit`. |
| `app/tools/BlockTool.ts`, `geometry/cells.ts`, `ToolController.ts` | 50-59 % | The pointer path: press/move/release against a canvas, of which `blocktool` and `triangle` drive the parts that need no DOM. |
| `render/scene/systems/CameraSystem.ts` | 70 % | The `OrbitControls` rig: its own limbs are driven by real pointer events on a canvas. The pieces of it that are pure arithmetic are pinned (`camera-vertical-pan`, `camera-fov`, `camera-orbit`, `section-drag`), and 回到默认视角 through it is pinned by `view-home`. |
| `sim/world/World.ts` | ~96 % | The branches a crowd reaches only in a long, rare run: a stuck agent, a lift car arriving at the wrong moment, an invalid trip. Covered by the tightest tests that exist (`determinism`, `capacity`, `demo`) rather than by a targeted one. |
| `render/scene/systems/*` | 80-100 % | The GPU half of each system; their arithmetic is covered (`chunk-cache`, `cut-clipping`, `level-slicing`, `section-drag`, `grid-visibility`). |
| `sim/sign.ts`, `sim/station.ts`, `sim/openings.ts` | 97-99 % | Branch tails: an unreachable save spelling, a degenerate run, a fallback for a document that cannot exist. |



Above-ground equipment: `overground.test.mjs` pins slim/thick support dimensions and 4 m extensions, slim-pillar R cycling through nine offsets shared by the model and collision envelope, the 1×1 m thin roof and the truss and shell bays in 4/8/12 m widths, full-height collision bounds, and material painting of roof cladding while the supporting truss stays steel in 单块 / 整面 mode, doorway exits aligned to the near block edge in all rotations, in three widths at any supported height ≥ 0 m (with preview/release agreement and graph registration), bridge connections in both directions and all rotations, support attachment, and save/load preservation. Roof and pillar variants sit below the triangular blocks in 工具; doorway exits live under 设备; 轨道桥 lives under 轨道 and extends an existing rail without platform doors or a tunnel shell. Roof bays place by click or rectangular drag and are painted through 材质.

`roof-tool.test.mjs` verifies rectangular thin-roof previews, full truss-bay placement and removal including rotated 8 m bays, collision refusal, right-drag removal, and one undo step per drag. Each bay style has one tile, the shell bay carrying no truss; Tab or its action tile cycles 窄 4 m / 中 8 m / 宽 12 m and redraws the hover. `overground.test.mjs` also verifies exactly 4 m of truss assembly height including the skin, contact with support posts, continuous 40 cm bottom chords across bay seams, and half-density internal ribs in 收束 at all widths and rotations.

Small stair blocks: 楼梯块 under 楼梯 has a 1×1 m footprint and no railings. Tab switches 高 (1 m, four treads) / 矮 (0.5 m, two treads), with a live placement preview; the palette preview is turned 90° counter-clockwise. Click or rectangular drag places independent tiles on floor, R rotates them, and 材质 paints the whole stepped surface. The high block connects adjacent lower/upper floors without carving blocks; the short building piece does not create a full-metre walking connection on the whole-metre floor grid. `overground.test.mjs` pins dimensions, painting, collisions, floor preservation, save/load and both walking directions; `roof-tool.test.mjs` pins drag, rotation, undo and removal.

Bridge deck and barriers: `overground.test.mjs` checks the one-metre underside without coplanar edge girders, eight-metre centre-pier spacing in every rotation, zero piers on four-metre bridges and migration of older spacing, reuse and owned teardown, B deletion persisting across edits/load with undo/redo, full-deck ground clearance, pillar contact, collision refusal below the deck, deck-only material painting, half/full sound-barrier height, preview identity and save/load. `structures-gaps.test.mjs` checks the three-name cycle and wraparound. `pick-tool.test.mjs` checks copying the barrier and length and restoring both on Esc.

Truss roof finishes: the truss bays use neutral white vertex colours and metre-scaled UVs on cladding and beams, so 材质 painting renders the selected finish on the roof sheets instead of black. Beams and braces keep the shared steel material. `overground.test.mjs` checks every mesh across all three widths.

`structures-gaps.test.mjs` pins the repair-shaped edges the feature suites use but never assert: `normalizeLevelBase` clamping/rounding, the roof width cycle/clamp/labels and ridge formula, the three ways a pillar refuses a bridge, and the roof-paint no-ops.

Roof visibility: 隐藏天花板 leaves actual roof modules visible. 隐藏屋顶 is a separate view toggle, off by default, hiding all roof styles even in 隐藏UI / 剖切. It sits below 隐藏天花板 with 分区图 to its right. `ground-visibility.test.mjs` pins independent ceiling/roof visibility; `rail-folders.test.mjs` pins the nine-tile order and header count.

`street-decor.test.mjs` verifies above-ground-only placement and movement, whole shelter floor support, track rejection, rotated model bounds, live station/exit labels, and persistence of exit references and frozen shared posters.

`hanger.test.mjs` covers 挂架: roof suspended and central post supports in 4/6/8m, roof attachments, sign/clock/TV mounting, rotated steel geometry, open walking space, post footing, preview identity and save/load.

`door-panel` checks satin stainless throughout the service doors, exposed hinges, upright pull clearance and mirrored double-door pulls, alongside the timber variant and placement bounds.
