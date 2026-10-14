---
name: metro-game-test
description: Run, extend or fix the game's test suite in game/test/ of the ericpzh/metro repo. Use when adding tests for game/src behaviour, when `npm test` / a suite fails, when a new sim rule needs a pin, or when deciding what the suite does and does not cover.
---

# The game's test suite (`game/test/`)

**`game/test/README.md` is the authority** — the seven rules a test here follows,
the `test/support/` harnesses, what is deliberately untested and the coverage
table. Read it before adding a suite. This skill is the short version.

```powershell
cd game
npm test                 # node --test "test/**/*.test.mjs"
npm run typecheck        # tsc --noEmit — the other half of "it works"
node --test --test-isolation=none test/openings.test.mjs   # one file while iterating
```

If the runner cannot spawn a child process per file (a confined sandbox reports
`spawn EPERM`), run the whole suite in **one** process — same tests, same result:

```powershell
node --test --test-isolation=none "test/**/*.test.mjs"
```

A Vite `build` may be blocked the same way; `tsc --noEmit` is the gate you can
always run. Coverage, when the numbers in `game/test/README.md` need refreshing:

```powershell
node --test --test-isolation=none --experimental-test-coverage "test/**/*.test.mjs"
```

## What the suite is

Nothing runs in a browser. Tests import the TypeScript sources **directly** (Node
strips the types) and drive them the way the app does: the sim in-process, the
drawing helpers headless, and the React store through its own actions. Tests
import `src/sim/*.ts`, `src/build/validation.ts` (the placement verdict),
`src/build/rail.ts`, the pure `src/render/*.ts` helpers and the `src/app/`
modules written to run without a DOM (`app/sweep.ts`, `app/rail/helpers.ts`,
`app/store.ts`'s actions).

That is a property of the sources, not of the harness: `sim/` is pure and
DOM-free, and `layering.test.mjs` fails if that stops being true — **keep `sim/`
pure: a test will fail if it imports three, React, or reaches outside `sim/`.**
`scene-wiring.test.mjs` is the other architecture guard: it reads `src/` as text
and checks that every sibling a scene system claims is actually wired by the
orchestrator.

`render-performance.test.mjs` pins batching bounds, triangles, ray picking and
geometry disposal, plus the exclusions for animated, transparent and shared parts.
It also guards the station changes that must invalidate floor-paint module reuse.
The renderer/GPU is not exercised by Node tests; use the root `npm run bench:browser`
for local frame-rate, draw-call and edit-latency measurements, and `npm run bench:sim`
for simulation tick and build-helper timings. These diagnostics are hardware-dependent
and are not test assertions or CI thresholds; see `game/PERFORMANCE.md`.

### Performance regression coverage

Root `npm run test:perf` runs `batching-lifecycle`, `draw-batching`,
`performance-policy`, `worker-preview`, `render-performance` and `scene-wiring`
with V8 coverage. Flags must precede test paths: appending a coverage flag after
the npm test glob does not collect coverage. Read per-file line/function/branch
results; imported dependencies inflate the overall denominator. Do not claim
100% GPU coverage from Node percentages.

- `batching-lifecycle`: mapped equipment/atlas UV integration without changing
  source picking UVs; revision reuse and disable/re-enable; exact ownership and
  disposal of geometry, instance buffers and batch matrix/indirection textures;
  distinct culling/render/material/clip policies; unsupported/hidden/skinned/morph
  and partial-range exclusions; nested landing doors and moving cabins; real
  ModuleSystem/LevelSystem hide/ghost/cut transitions and local retained objects;
  actual CameraSystem source-layer IDs, layer restoration and nearer-wall occlusion,
  invisible descendant rejection and hidden storey module roots. `delete-tool`,
  `move`, `pick-tool` and `select-agent` pin the hidden-target behavior for module
  ray picks and cell-based fallbacks.
- `draw-batching`: A/B/C/L stock in all four rotations, exact geometry/bounds,
  independent door banks and moving glass, paused/hidden buffer holds, resume,
  eviction and profiling toggles; full-resolution atlas redraw/recycling and
  legacy/explicit age eligibility.
- `performance-policy`: indexed/unindexed placement equivalence, fresh array
  invalidation, ground/holes/exits, bulk-paint deduplication/no-op/immutability,
  fail-closed cosmetic and dependency policies, local/owned/sign-board retention,
  stair-block-only module additions retaining existing groups while other module
  additions remain conservative,
  RAF release/cancel behavior, paused camera repacking and stable crowd poses/IDs.
- `worker-preview`: actual worker edit acknowledgement with no cosmetic routing
  rebuild and no paused tick; speed/topology edits must still rebuild.
- `scene-wiring`: source contracts for sign-only chunk skipping, pointer
  touch/delete preservation, release-before-commit, unmount cancellation, and the
  camera-aim notification (`SceneRenderer.onCameraAim` firing once per real aim
  move) with the viewport's re-aim of the equipment and 移动 ghosts.

For the inverted street plane, `ground.test.mjs` pins a z=0 delete/re-add cycle:
removing a dug hole through `addCells` returns to implicit ground without keeping a
plain solid record, while `addFloor` keeps its tagged floor record. `save.test.mjs`
pins that re-added default ground adds nothing to the save and later custom finishes
or zones still round-trip as authored data.

Run the full `npm --prefix game test` and production build after focused checks.
Then run root `npm run check:render-batching` for real production GLSL/WebGL and
open/closed GPU geometry checks, and `npm run check:perf-tools` for CPU/trace
exports. Browser checks require Chrome and have no FPS threshold; software GPU
is available by running the checker with `--software-gpu` after a build.
`--no-multi-draw` disables the extension before renderer initialization and checks
the fallback against the same geometry; its report is separate. Use paired
unprofiled benchmarks for speed evidence, keeping hardware/fixture/assets fixed.

## Rules that matter most when adding a test

1. Import the source, not a copy — no build step, no `dist/`. If a module is hard
   to test, that is a statement about the module.
2. Pin a number and say what it means (`assert.equal(height, 1.25, 'the 闸机 is
   the reference's 1250 mm machine, not a 1 m cube')`).
3. **Test the silent failure** — a lit pane buried in its own backing, a plate
   that prints no ink, a crowd that never boards. Ask what a broken version would
   *look* like.
4. Keep the helper pure if you want to test the drawing: anything with pixels is
   split so the arithmetic lives in a three-free module (`render/section.ts`,
   `render/levelSlicing.ts`, `render/stationDisplay.ts`, `render/signFace.ts`)
   while the scene owns the GPU. Canvas-touching suites use the recording
   contexts in `test/support/`.
5. No sleeps, no network, no snapshots on disk — everything is deterministic or
   seeded (`rng.test.mjs`, `determinism.test.mjs`).
6. A new behaviour goes in a `.test.mjs` beside the others, and **two documents
   get a line**: `game/README.md`'s test list (what it pins, in the repo's own
   words) and `game/test/README.md`'s area table (where it sits).
7. **Set state in the test, not in a `test.beforeEach` — unless the file owns the
   state.** The suite runs in **one process** (`--test-isolation=none`), so the
   store and the globals (`Worker`, `self`, `document`) are shared across files,
   and a top-level hook in one file runs around *another* file's tests. A file
   that stubs a global or seeds the store for its own suite may use a hook; a file
   that only reads them arranges itself inside the test.

## Not tested, deliberately

* **The GPU** — anything needing a real WebGL context. The quietly-wrong parts of
  that path are covered by their arithmetic instead (`chunk-cache` observes the
  buffer objects a rebuild reuses, `cut-clipping` walks the material assignment).
* **The React views** — no test imports a `.tsx` file, which is why none appears in
  the coverage table at all: `app/Viewport.tsx`, `app/ViewCube.tsx`, `AppShell.tsx`
  and `app/windows/**` are a thin shell over the store and the scene, and it is
  those two that are tested.
* **Vite-only modules** — `render/adArt.ts`, `render/pictograms.ts`,
  `render/lineMapArt.ts` and (for the same reason) `SceneRenderer` resolve artwork
  through `import.meta.glob`, which plain Node does not implement. Tests stub the
  art cache; the pixel code it feeds is tested directly.
* **`/lab`, `boot.tsx`, `mobile.ts`** — the manual harness, the lazy bootstrap and
  the phone gate, all browser-shaped by construction.

When a behaviour change touches the sim, the README's rule stands: keep `sim/`
pure, add a focused `.test.mjs`, and update `game/README.md` if the change is
player-visible.

The build rail's category membership and tile order are pinned in
`rail-families.test.mjs`; its top-level folder names, shortcuts, and diagonal tab
positions are pinned in `rail-folders.test.mjs`. Update both the corresponding
README test lists and `.agents/skills/metro-game/SKILL.md` when those palette
rules change.

Room-purpose paints (`store`, `toilet`, `office`) are ordinary `ZONE_PAINT_LIST`
entries. Pin their existing room-type icons and counter-only facility brush list
in `rail-families.test.mjs`; pin no module/wall generation and fare-zone
preservation in `zonetool.test.mjs`; pin overlay color regions and fare-index
preservation in `zones.test.mjs`. Keep `game/README.md`, `game/test/README.md` and
`.agents/skills/metro-game/SKILL.md` aligned when this palette contract changes.

For a thin roof snap change, keep the quarter-metre model bounds, collision bounds and
storey slicing in agreement in `overground.test.mjs`; keep pointer priority (roof,
then block outside face, then active view height), the 上 / 下 control and icon wiring,
and preview/release agreement in `roof-tool.test.mjs`.

For small stair blocks, `roof-tool.test.mjs` also pins the drag to the rotated width axis,
ignores pointer travel along the treads, and checks the placed row matches the preview. Thin
roof tiles remain rectangle drags.

Exit snapping is two-way: `exits.test.mjs` pins the pure bay/rotation calculation when a
head-house is placed from a picked straight stair or escalator, plus the rendered wellway's
along-run row when a saved stair landing is offset from the exit anchor; `batching-lifecycle`
pins a ramp-only bounds pick through stair tread gaps, retaining nearer-wall occlusion; and
`equipment-placement-input.test.mjs` pins that the preview and click use the picked ramp
even when the ray also hits a floor tile. Keep turning stairs and virtual/doorway exits out of this path.
`module-build.test.mjs` uses `fixtures/tanwei-exit-b.json` and actual floor meshes to probe both
edges of the rendered 1/2/3 m stair band in all rotations. Coordinate-only endpoint assertions
cannot detect a wellway ignoring `stairFlightSlides`; verify clear flight edges and solid floor
immediately outside both rails when changing exit/ramp alignment.

For fence neighbours, pin that ramp stairs and escalators connect at their landings but
楼梯块 has no handrail neighbour in `fence.test.mjs`. When equipment settings refresh while
方块 is active, pin that the shared stair-block setting cannot recreate its ghost in
`tool-hover-preview.test.mjs`.

New-behaviour pins: `booth-sign` (booth-header snap, faces, bounds, save/move —
plus that a booth board keeps its turn against a camera aim, the one mount the
wall search may not re-aim), `gate-traffic` (forecast reservations, directional
drain, cleanup, wait
accounting), `diagonal-walk` (√2 cost, 2×2 clearance, barrier awareness),
`passenger-view` (instanced humans, gait, pause, picking, eye restore),
`touch-zoom` (pinch direction, cancel, release suppression),
`sim-pause` (escalator bands, gate leaves and train/screen doors hold while
paused; consists settle; orchestrator forwarding),
`escalator-length` (the four run lengths on both the 扶梯 and the 单跑楼梯: spans,
envelope, carve, landing nodes, ride time, exit-bay snap, save round-trip, both
drawn models, and the catalogue's fallback and nearest-match answers — with
`ramp-join` for the seam at each length and `builder-attributes` for the tile,
the predicate and the dispatch).

For a wall mount, keep the aiming rules in the pure placement module
(`wallMountStandCell` + `autofaceWallMount`) and pin each half where it lives:
`wall-ceiling-snap` for the **基准高度** storey snap and for a **side face being a
wall whatever the block is tagged** (a plain 方块 wall mounts in front of the face,
a top face still stands the piece on the block it hit), plus the **玻璃板's course
rule** — the predicate `wallMountFollowsCourse` (a palette id answers as a module
does, and only the wall glass answers true), `wallMountStandCell`'s `followCourse`
(the first wall course is the storey floor, a higher one hangs the pane over itself,
a floor slab's own edge keeps the storey reading) and that the verdict accepts a pane
hanging over a course; `placement` for the camera
ranking, its carried-turn / pointer / rotation-order tie-breaks and that the
search asks `wallMountMissing` per direction (a 半墙 facing away is skipped, not
chosen and refused); `glass-panel` and `move` for the tool and controller halves —
the stand cell, the station's `levelBase`, an orbit changing the ghost, and a carried
玻璃板 following the course it is aimed at;
`equipment-placement-input` for the one mount the view may not re-aim (a 地面出入口
on its clicked block face) and for the tool's half of the course rule — the 玻璃板
covers the clicked course where a 广告牌 on the same hover keeps its band. All of it
is preview-and-release agreement: the ghost
and the click ask one function.

For a **hung** piece the same split applies to `hungCeilingAim` + `hangCeilingLocal`:
`wall-ceiling-snap` pins the anchor itself — the free cell under the first underside
above the pointer (`topBlockZ` skipping a wall's own courses, `topBlockOver` for a cell
with its top block over it) from a floor hover, a wall course, a slab's underside and the
work plane, the storey floor and `levelBase` when nothing is overhead, and the verdict
(`ceilingMountMissing` passing a piece under a top block, refusing one with no ceiling);
`lights` pins the tool's half (floor hover and slab underside reaching the same cell) and
the drawn light — the real slab on a shifted base, and the top block when the piece's own
cell is the one under it; `vent` the grille the same way; `module-build` the drawn mount of
every hung piece and its pinned sizes (a hung row is built on a column with nothing over
the cell, so the nominal storey slab is its ceiling exactly as it always was); `ceiling-decor`
the 监控 stems against a tall slab. Assert on the **cell** and the drawn mount, not on a
height the piece carries: an older save anchored on a floor draws identically, which is the
migration-free promise to keep.

`placement.test.mjs` pins stair footing: every stair shape may be placed with ground
only at its foot, regardless of width or rotation, and is still refused if that foot
has no ground. The upper landing and interior turn platform must not become additional
pre-existing-floor requirements.

Model integration coverage lives in `passenger-library`, `passenger-size`,
`passenger-view`, `capture-passengers` and `passenger-art-pipeline`: the complete
reviewed catalogue and walks, equal explicit adult/child pools, 20% child selection, separate age
size ranges, body/shadow axes, 70% opacity, pause, picking and physical stride.
The approved male additions must retain lower crowns in the actual baked poses:
all seven styles and every bag stay below 1.70 m and at least 2 cm below the
original standing crown. Source model tests separately pin original-lock topology,
head/neck weights and pairwise silhouette separation; catalogue checks alone do
not prove that regenerated geometry reached the game.
Side bag assertions must inspect the accessory's baked surface, including frame
zero: broad faces along body depth, left/right mirroring, thin bodies between arm
and torso, torso-following shoulder/crossbody bags and hand-following purses.
Check the baked strap/handle surfaces for long triangles or ink escaping below
their attachment region, allowing the atlas simplifier's larger planar triangles.
Model tests pin missed fitting rays and carrying-arm metadata; the browser
crossbody checker samples shoulder pixels to catch hidden or missing strap patches.
The art validator must reject missing child frames and age-ineligible/bald child
cards; approved small/crossbody bags can be child-eligible. Never freeze the
catalogue length or infer modern eligibility only from bag presence.
Browser geometry/strap/hem/GPU checks live in `tools/check-model-*.mjs` and
`check-game-passenger-library.mjs`; model preview rules have their own deterministic
`npm --prefix model test`. The boarding capacity fixture uses a one-car train and
no alighting, so changes in stride do not turn its counter into an alighting test.

For a **turning stair**, keep the whole block-grid rule in `stairs.test.mjs`: every turning
shape built at `stairSwitchbackRunWidth`, a 90° turn's two perpendicular legs each slid
across **their own** run (the two hands mirroring), its quarter-landing the `lanes × lanes`
square the legs meet on with the departing leg on that square's far edge and no flight body
over any landing cell, the walk across the square in both hands × all three sizes × all four
rotations, the equipment tool's ghost carrying the piece the factory builds, the builder
laying and bulldozing every cell of the square, and a piece saved at an older off-grid width
keeping its band and its single corner cell. The same rule is pinned from the other three
sides: `openings.test.mjs` (the wall a 90° leg stands flush against stays whole),
`pillar-extension.test.mjs` (the flight-only hitbox at that landing), `module-build.test.mjs`
(the **drawn** platform measured against the square the sim lays) and `move.test.mjs` (the
whole square travelling with the piece).

For the fitted 门 / 玻璃幕墙 joint, keep the snap arithmetic in the pure placement
module and pin a rotated curtain, a door clamped inside its run, allowed fitted overlap,
rejected crosswise overlap, and the clipped lower-pane geometry in `glass-panel.test.mjs`.
Pin front and back handle geometry and stand-off in `door-panel.test.mjs`; room and
standalone doors share `DoorModel.buildDoor`, so both use the same assertion.

For the 指示牌 board editor, keep the drag arithmetic in `sim/sign.ts` and pin, in
`sign-editor`, the store contract (preview never commits, ✓ makes the pair current)
and the deferred live-drag path (`applyLocal` writes the bins, `schedulePreview` trails
the scene redraw, the drop flushes once). Keep `signBoardsOnlyChange`'s fail-closed
verdict and `buildModules`' keep-set retention in `performance-policy`, and the
`setStation` fast path (no chunk remesh, station-wide plate repaints skipped) in
`scene-wiring` — `SceneRenderer` itself needs WebGL, so that contract is source-text.
For 三角 runs, keep the drag arithmetic in the pure geometry module
(`app/tools/geometry/cells.ts` `triangleRidgeAxis` / `triangleLineCells`) and pin the
ridge-only line, the one-shape-per-course release, the neighbour side a wedge leaves
open, and the seamless ridge join in `triangle.test.mjs`.
