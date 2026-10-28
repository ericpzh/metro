---
name: metro-game-test
description: Run, extend or fix the game's test suite in game/test/ of the ericpzh/metro repo. Use when adding tests for game/src behaviour, when `npm test` / a suite fails, when a new sim rule needs a pin, or when deciding what the suite does and does not cover.
---

# The game's test suite (`game/test/`)

`ui-theme` covers the three theme preference, fallback and storage behavior;
`game-loading` covers shell visibility and bilingual failure text. After building,
`node tools/check-game-themes.mjs` blocks the entry bundle to check the early shell,
checks special-route bypasses, then drives real theme switching, scene clear colors,
the Night View list, station-version isolation and persistence across reload. The
browser check does not establish subjective visual quality or every dialog state.

`audio.test.mjs` covers outcome routing, repeated refusal notices, cancellation
and no-op silence, four local volume preferences with master scaling, language/deployment asset paths,
native Z-up distance/pan, finite radius and the 256-passenger sample bound. Its
fake AudioContext drives the actual service's eight-one-shot / three-bed limits,
mute release, hidden-tab suspension and pending-decode cancellation. Preserve the
six approved asset/provenance checks and four settings sliders.
The speed-policy regression pins passengers at 1×, traffic at full rate through
4× then skips, and trains skipping above 1×. The studio's `sound-ambient` suite
exercises the same game-owned player for bounded grains and cleanup.
After a production build, `node tools/check-game-audio.mjs` separately drives
actual pointer actions and bilingual sliders, checks one pick and one cue per
action, reload persistence, zero-output mute and camera-relative ambient sources.
Its ambient fixture feeds production renderer poses; it is not a simulated-day
or subjective listening test. Raw reports live in `.preview/perf/game-audio/`.
Add conclusions to the shared performance reference only when they contain
reproducible performance evidence; functional audio checks stay with these tests.

The settings report action is pinned by `topbar-report-issue.test.mjs` and
`report-issue-route.test.mjs`: the FaBug anchor follows the active locale to the
stats Worker’s `/stats/report` or `/stats/en/report` page and uses the local stats
origin during game development. Keep both route cases and the source contract in
sync if the feedback page or worker routing changes.

For performance regressions, follow [the shared performance guide](../metro-repo/references/performance.md).
Guard work counts and ownership invariants; use browser measurements for latency.
`node tools/check-editor-move-caches.mjs` checks production guidepost/walkway
drop, undo and redo on the GPU against forced fresh batch aggregation, retaining
model/artwork identities. It is a functional check, separate from latency captures.
Ground-cache tests must compare against independently cloned inputs, preserve
caller-owned arrays and invalidate for new authored cells or structural records.
`editor-action-benchmark` guards every palette entry and discrete builder setting
in the shared production action manifest. Add new settings/subtypes there rather
than a benchmark-only substitute model. `bench:editor-actions` records the full
demo matrix against 100 ms per preview/commit stage; unsupported actions and
failed rows remain explicit, and API timings do not replace pointer regressions.
`editor-action-matrix.test.mjs` also checks focused-run merging, capture ordering,
strict threshold presentation and incomplete-run refusal.
`tools.resolve` separately measures live tool occupancy/floor preparation in those
captures. `local-cell-edit` compares structural occupancy deltas with fresh indexes
through generated holes, street expansion, duplicates and undo. `line-edit` pins
exact immutable structural history through repeated undo/redo. `batching-lifecycle`
pins replacement/deletion/reordering equivalence and zero remote geometry reads;
`cut-clipping` pins retained-tree skips and new-root/view/plane invalidation.
`floor-geometry` also compares the 64-entry plain-pavement cache against an
uncached mesher across window growth/shrink, holes, ramps and overhead support,
and checks independent chunk/storey ownership. `ground` pins exact pavement
resizing and fractional-window fallback. `walls` pins scoped floor gestures and
overlapping wall owners; explicit full repair remains available. `move` checks
exact verdict reuse and revalidation. `equipment-retention` pins moved guidepost
geometry/ink, selection-program ownership and rail-index invalidation;
`render-performance` pins one AO neighbourhood sample per cap with unchanged
colours, and `level-view-cache` pins line-material retention across grid resizing.
`batching-lifecycle` also pins exclusive batch translation, repeated moves,
shared-bucket refusal, masking and fresh bounds after a view change;
`equipment-retention` pins translated walkway phase and exact model bounds.
`openings` checks zero repeated structural-record reads across non-carving edits
and fresh-equivalent openings after a ramp replacement.
`builder-attributes` guards closed action rows against hidden store subscriptions
and retaining full document/history/graph snapshots;
the production tutorial check exercises the live bilingual builder controls.
Live-panel regressions belong in `draw-batching`: pin one guttered rectangle per
frame, fair latest-pixel queueing, unchanged static pages/UVs, deletion/reuse and
complete CPU restoration pixels. `scene-wiring` guards demand frames after pause.
Use `node tools/check-panel-atlas.mjs` for actual GPU colour, row orientation,
gutters and reallocation; mocks cannot establish those pixel contracts. Keep
first-Play FPS captures separate from tests and report existing failures honestly.

**`game/test/README.md` is the authority** — the seven rules a test here follows,
the `test/support/` harnesses, what is deliberately untested and the coverage
table. Read it before adding a suite. This skill is the short version.

`tv-pair.test.mjs` owns the geometry and shared-cell contract for TVs facing back
to back. `tv-double.test.mjs` covers the 单面/双面 palette choices and confirms
that the 双面 option previews and commits the two opposite-facing modules as one
undoable placement.

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

The 5 m grid and train profile span several suites: `storey-height` covers
factories, ordinary 吊顶 gestures, visibility, contextual import validation and
fractional internal stair landings; `covered-clearance` uses the reported save
and actual mesh bounds for the 5 m envelope, full concrete blocks, current 98%
train scale and glass vinyl. `catenary-model` pins the shallow covered/tunnel
mounting; `psd-end` pins 2.35 m full glazing; `psd-header` pins the optional English
second line under each platform destination and its legacy single-line fallback;
`train-lod` checks that identical
consists keep separate cached poses and reuse their existing models. Preserve
the single 5 m profile and reject fractional editable cells/outer endpoints.
Do not skip demo or scenario regressions to make a profile change pass. Update
fixture coordinates and distinguish shared upper landings from different lower
rows on 8 m stairs / 9 m escalators; preserve the circulation helper and its
unreachable-door negative control. Remove tests for 4 m grid compatibility; independently selected equipment sizes
such as a 4 m ramp or lift interval remain valid dimensions.
Current dimensions and ownership live in
[the profile reference](../metro-game/references/five-metre-profile.md).

`three-storey-ramps.test.mjs` covers the three contiguous ramp families (2–6, 7–11 and 12–16 m), 15 m default, endpoint-derived span/length, every stair shape and rotation, both escalator directions, and the straight-stair placement/exit-snap path. It also pins the stair span cycle and three-layer tile selection contract. Run it with `node --test test/three-storey-ramps.test.mjs`; whole-suite coverage and the per-file coverage map are documented in `game/test/README.md`.

`autosave.test.mjs` covers committed-change saves, undo/redo, immediate new/import/demo
replacement, invalid storage, quota failure invalidation and retries. It drives
the autosave flush directly without waiting for timers. Startup restores a valid
autosave before worker initialization; the slice default remains empty and paused.

`tutorial.test.mjs` covers empty paused startup, browser-preference persistence,
invalid/outdated values and unavailable storage. React interactions are checked
separately by `npm run check:tutorial` from the root: it builds the production
game, launches Chrome/Edge through `tools/browser-harness.mjs`, and checks both
locales, live controls, per-visit tool activation, dynamic line/folder spotlights,
keycap layout and reload/opt-out/reopen behavior. Reports/screenshots go to ignored
`.preview/tutorial/`. Do not count these browser checks as Node/V8 source coverage.

The Node suites do not run in a browser. Tests import the TypeScript sources **directly** (Node
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
and are not test assertions or CI thresholds; see the
[performance reference](../metro-repo/references/performance.md).

`level-view-cache.test.mjs` pins prepared Q/E view reuse and disposal, actual
five-metre neighbour selection from a shifted `levelBase`, the top/bottom level
boundaries, and retention of the editing-grid geometry across storey changes.
When profiling level changes, use the production `tools/bench-level-switch.mjs`
and record the first key press separately from warmed presses; Node tests pin
work and allocation identity but do not exercise WebGL presentation.

### Performance regression coverage

`test:perf` also includes `train-pantograph`, `storey-height`,
`covered-clearance`, `lift-interval`, `equipment-retention`, `fence-preview`,
`glass-panel`, `tool-picking`, `ramp-targeting`, `geometry-snap`,
`placement-surface`, `preview-pipeline` and `preview-lod`:
collector geometry, scale/rail alignment, ceiling gestures, mixed lift stops,
equipment model retention, fence/curtain collision, one shared event raycast,
ramp target/occlusion, geometry and low-angle beam snapping, and preview/placed LOD
equivalence must stay in the performance gate.

### Geometry snapping audit (2026-10-22)

The snapping change follows actual geometry rather than storey bands; `metro-game`
owns the anchor matrix. `geometry-snap` pins real rendered ceiling contact,
preview/commit/move/undo agreement over 360 slab cases, off-grid wall columns,
multiple editing bases, hanger backing heights, shaft boundary picks and
suspended-ceiling rooms. `placement-surface` pins low-angle beam targeting ahead
of distant terrain, fresh preview/click/move/undo agreement, one shared raycast,
nearer-block occlusion, hidden-source exclusion and unchanged unsupported-host
surface cells. `hanger`, `wall-ceiling-snap`, `equipment-placement-input`, `move`,
`lights`, `storey-height`, `sign`, `ceiling-deck`, `psd-end`, `booth-sign` and
`delete-tool` cover the owning contracts, including floor-triangle deletion.

`ceiling-cells` and `floor-geometry` define the hide-ceiling boundary. An inferred
ceiling needs a floor below, a clear column, a neighboring block on the same
course, and at least 3 m of height above the storey base. Lower courses remain
floor geometry even with ceiling tags. `floor-geometry` pins Tanwei's raised
platforms `(15,2,11)` and `(22,-5,11)` at the 10 m editing level through level
changes and both ceiling tags, exercising actual ray hits against the production
mesher. `tools/check-tanwei-raised-floors.mjs` verifies their WebGL draw callbacks.

Validation for the change: all 2,313 owning tests and the production build pass.
`tools/check-geometry-snapping.mjs` passes nine real pointer placement/move
fixtures for slabs, hangers and wall mounts across editing bases 0, 2 and 4
(69 dispatches, including low-angle block/wall/rail/tunnel hover picks), and
`tools/check-tool-picking.mjs` passes its 38 picking/occlusion/delete/undo
dispatches; both keep one scene raycast maximum per dispatch and report no browser
errors. Raw reports are under ignored `.preview/perf/geometry-snapping/` and
`.preview/perf/tool-picking/`. The visible-object follow-up adds the 18-check
`placement-surface` focused run: `placementSurface.ts` 100% lines/functions and
84.62% branches; `CameraSystem.ts` 71.08% lines, 80.34% branches and 50% functions
(other camera operations are outside that focused run).

The broad `test:perf` in-process coverage attempt emitted no test results after
roughly seven minutes and was stopped; a supplementary separate-process run of the
complete list was stopped after roughly 7.5 minutes with `draw-batching` and
`train-lod` still running. Both are incomplete, not passes. Focused instrumented
runs passed 199 owning checks plus a 56-check tool run; per-module figures are in
the [performance reference](../metro-repo/references/performance.md).

Root `npm run test:perf` runs `batching-lifecycle`, `draw-batching`,
`performance-policy`, `worker-preview`, `render-performance`, `scene-wiring`,
`roof-tool`, `equipment-placement-input`, `passenger-assets` and `passenger-library`
with V8 coverage. Flags must precede test paths: appending a coverage flag after
the npm test glob does not collect coverage. Read per-file line/function/branch
results; imported dependencies inflate the overall denominator. Do not claim
100% GPU coverage from Node percentages.

For placement drags, `blocktool` pins the 10,000-cell boundary, exact-cap
placement, over-cap all-red preview with no commit, auto-wall inclusion and the
Shift/三角 counts; the shared `MultiPlaceDrag` scheduler tests pin one 50 ms
latest-target timer across changing cells, no starvation, unchanged-key reuse,
retained previews, immediate over-budget refusal, release/cancel behavior and
the per-tool commit/refusal contract. Roofs keep their frame scheduler.
`refused-ghost` pins the red-box pool growing past its 4,096 starting capacity.
`StablePreviewDelay` timing is driven with fake timers, never sleeps. Measure real
pointer sequences with `node tools/bench-drag-latency.mjs` (or the focused
`npm run bench:block-drag` harness); report cold and warm timings in the
[performance reference](../metro-repo/references/performance.md) as evidence, not
thresholds.

`block-collision-cache.test.mjs` guards the demo-station collision cascade: exact
verdict and blocker-order equivalence, bounded per-snapshot retention, cached
occupancy/body-index work counts as a blocked patch grows, snapshot invalidation,
blocker removal, broad imported geometry and refusal priority. `blocktool` pins the
red blocked-coordinate witness through unchanged/metadata-only previews and its
invalidation when the footprint, settings or geometry changes. `multi-place-drag`
also pins that replacing cells/modules arrays refreshes a rendered target even
when station epoch and pointer key are unchanged. Keep these deterministic work
and stale-cache regressions alongside cold/warm browser profiles for both shipped
demos; do not turn noisy timing into a unit-test threshold.

Crowd distribution regressions belong in the focused deterministic suites:
`crowd-routing.test.mjs` pins live detours around congestion, itinerary/cached-path
ownership and a bounded repeatable search wave; `walking-space.test.mjs` pins stable
lanes across legal corridor width, actual passenger progress, fare/hole clearance,
platform waiting space, walk-to-door boarding and early door balancing. Ramp mode
preference and the lift relief path belong in `wayfinding.test.mjs`; keep the
seeded long-run mode-share measurement documented in `game/README.md` instead of
turning hardware-sensitive timing or a full-day run into a unit-test threshold.

The status bar's **station-wide crowd level** (§7.3) is pinned in `capacity.test.mjs`:
a station with nobody in it reads LOS A, and the under-built station reads a worse
letter than the fixed one. `train-cabin.test.mjs` pins that a consist's riders cannot
lift it. It is a mean over the station's own floor (`StationGraph.stationArea`, one
node per square metre, street plane excluded), **not** a per-node worst — so a
per-platform letter, if §9.3's 高峰预警 needs one, must be derived from
`platforms[].cells` and the per-node `density` buffer rather than read off `metrics`.

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
- `draw-batching`: A/B/C/D/L stock in all four rotations, exact geometry/bounds,
  independent door banks and moving glass, paused/hidden buffer holds, resume,
  repeated-service reuse, eight-dormant-consist eviction and profiling toggles; full-resolution atlas redraw/recycling and
  legacy/explicit age eligibility.
- `stock`: the A/B/C/D/L pose-index order, D's dimensions and eight-car capacity,
  mirrored 3/4-door layout, narrow single cab-end doors and wide paired doors elsewhere.
  `trains` checks D's screen alignment; `module-build` checks D-width platform openings and
  interior gantries; `train-art-pipeline` checks both-language sheets, captured poses and bounds.
- `performance-policy`: indexed/unindexed placement equivalence, fresh array
  invalidation, ground/holes/exits, bulk-paint deduplication/no-op/immutability,
  fail-closed cosmetic and dependency policies, local/owned/sign-board retention,
  stair-block-only module additions retaining existing groups, equipment retention
  for additions/deletions/moves (fence/gate/tactile, glass/door, cubicle, TV,
  hanger and structural families; unknown types fail closed), render-only chunk
  classification, RAF release/cancel behavior, paused camera repacking and stable
  crowd poses/IDs.
  `batching-lifecycle` also pins move lift/cancel retaining GPU allocations and
  respecting a storey change during the lift. Passenger asset/library checks cover
  binary delivery, native/fallback decoding and signed integer pose reconstruction.
- `equipment-retention`: 1,024 unrelated models surviving equipment edits, functional
  routing versus render-only chunk skipping, coupled dependency directions, structural
  family invalidation, combined module/cell edits, unknown types, local-vs-fresh geometry,
  real ModuleSystem allocation ownership, cached move removal and ordinary hover documents.
  Contact-shadow cases keep ceiling fixtures and PSD infill/covers blob-free, retain
  floor-mounted equipment shadows through edits, and pin active-storey/presentation visibility.
- `fence-preview`: prepared fence index equivalence, 1,024 remote fences with no
  document scans or preview rebuilds, hover candidate joints, local equipment-bucket
  masking/restoration, adjacent-joint geometry matching a fresh build, storey/view/
  ghost/clipping transitions and exact preview teardown.
- `worker-preview`: actual worker edit acknowledgement with no cosmetic routing
  rebuild and no paused tick; speed/topology edits must still rebuild; inert-decor
  builds skip routing while bench stops still rebuild.
- `history`: the run's minute-by-minute record (§8.1, the 数据 window) — one sample a
  sim minute rather than one a tick, the LOS letter stored as its order, the first
  sample's per-minute columns as a **baseline** rather than the run so far, climbing
  counters whose minutes add up to the total, `World` starting the record over on
  load / restart / seek, the app appending a posted minute (its buffer growing without
  moving an index) or replacing the lot on a reset, and the chart axes — the round-number
  ceiling and the upside-down A–F class axis. The record rides the `state` message, so a
  change to that payload touches this suite.
- `scene-wiring`: source contracts for sign-only and equipment chunk skipping
  (both fast paths clear the slice key so batch resync still runs), pointer
  touch/delete preservation, release-before-commit, unmount cancellation, and the
  camera-aim notification (`SceneRenderer.onCameraAim` firing once per real aim
  move) with the viewport's re-aim of the equipment and 移动 ghosts.
- `graphics-quality`: the 画质 preference — 低画质 / 高画质 read from local storage
  with a missing or invalid value falling back to high, persisted independently of
  the station save, surviving an unavailable store and restored by a fresh store on
  load — plus the floor/presentation detail policy (`detailPolicy`, Hide UI
  restoring full visible geometry) and the dropdown's labelled actions.

For the inverted street plane, `ground.test.mjs` pins a z=0 delete/re-add cycle:
removing a dug hole through `addCells` returns to implicit ground without keeping a
plain solid record, while `addFloor` keeps its tagged floor record. `save.test.mjs`
pins that re-added default ground adds nothing to the save and later custom finishes
or zones still round-trip as authored data, plus that opening a save keeps the basis
floor (or lowest user placement) as the edited storey without the worker's 0 m
ground level resetting it.

Run the full `npm --prefix game test` and production build after focused checks.
Then run root `npm run check:render-batching` for real production GLSL/WebGL and
open/closed GPU geometry checks, and `npm run check:perf-tools` for CPU/trace
exports. Browser checks require Chrome and have no FPS threshold; software GPU
is available by running the checker with `--software-gpu` after a build.
`--no-multi-draw` disables the extension before renderer initialization and checks
the fallback against the same geometry; its report is separate. Use paired
unprofiled benchmarks for speed evidence, keeping hardware/fixture/assets fixed.

## Coverage completion gate

Passenger service and animation integration has two owning suites:
`passenger-activities.test.mjs` drives real journeys, service occupancy, physical
front access, multiple seats, cross-storey errands, unreachable/deleted stops,
walking taps, selective lift gestures and deterministic Float32 packing.
`passenger-activity-assets.test.mjs` reads the actual generated asset and reviewed
exports: catalogue hashes, weights, palette faces, topology budgets and fitted
up/down/narrow/wide rail wrists, elbows and neutral hand orientation. Source
matrices alone do not compile GLSL: build and run
`node tools/check-game-passenger-activities.mjs` for High/Low, adult/child, clothing,
pause, doors, running sinks and actual seated skirt silhouettes. The focused model
interaction suite additionally guards source geometry restoration and IK.

Coverage means the changed behaviour has a deterministic regression for each affected
contract, the `game/test/README.md` map names the owning suite, and the **full** game
suite completes. A focused file, V8 percentage, build, or browser check cannot stand
in for the full suite. Run the focused tests while iterating, then run
`npm --prefix game test` before reporting completion. If that run exposes an unrelated
failure, preserve it and identify it explicitly; do not claim full-suite coverage or
change unrelated code to make the result green. For performance work, retain the
additional measurement and work-count requirements in the performance guide.

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
preservation in `zones.test.mjs`. That suite also pins synthetic track floors to
the actual rotated bed from `trackCells` — a north/south run must not tint the
unrotated `w × d` rectangle across X. Keep `game/README.md`, `game/test/README.md` and
`.agents/skills/metro-game/SKILL.md` aligned when this palette contract changes.

`zonetool.test.mjs` also owns 分区 right-click: taps and drags temporarily use the
无分区 eraser regardless of the selected paint brush, preserve floor records and the
selected brush, and do not demolish walls or floor. Keep booth-counter removal pinned
as its existing module action. The shared viewport must retain the initiating button
in zone-drag state so right drags survive pointer-move cancellation, pointer-up routing
and the browser's early `contextmenu`; `column-delete.test.mjs` pins that source contract.

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
`escalator-length` (the run families on the 扶梯 and the 单跑楼梯 — the four
one-floor rungs, the staircase-only 超长 6 m, and the 双层 family — spans,
envelope, carve, landing nodes, ride time, exit-bay snap, save round-trip, both
drawn models, and the catalogue's family fallback and nearest-match answers — with
`ramp-join` for the seam at each length (including the widened one-block escalator span and stair/object/block obstruction
and `builder-attributes` for the tile,
the predicate and the dispatch),
`walkways` (the 扶梯's level twin: its three lengths 短 30 m / 中 60 m / 长 90 m in
every rotation, direction and width 1 / 2 / 3, the direction-independent wider centring, the
belt interior closed to walking while both landings stay nodes and a step-free
passenger is carried, the lane-scaled rate and 1.84 m/s ride, placement carving
nothing and requiring floor under the whole length, the block-brush reservation,
move/rebuild, the preview/ghost keys, and the shared flat model's span — with
`pick-tool` for the length/width/direction a pick arms).

`escalators` pins the three-block plan as well as the narrow and two-block ones:
envelope, every landing column, carved openings, lane rate and ghost key in all
rotations, directions and the single/double/triple spans; `module-build` pins the
drawn band and rails on those multi-storey widths, and `ramp-passengers` pins their
one-column-per-block boarding.

For the 第三轨, keep the side rule in the pure sim helper and pin each half where
it lives: `thirdRailSide` (`sim/track.ts`) owns the verdict — travel right in a
tunnel/bridge (local 上行 −y, 下行 +y, at every `rot`), regardless of nearby
screens; a platform rail sits on the side with no 屏蔽门, with both/neither sides
falling back to travel left (上行 +y, 下行 −y), only the rail's own edges counting
(`cfg.from`, plus legacy direction-matched edges) and an unset `cfg.dir` falling
back to the line direction — and `track-third-rail` pins the helper (tunnel/bridge
both directions, no/one/both screens, other-rail and legacy edges, rotation and
the line fallback) plus the drawn model through the real dispatcher (platform
up/down, off-platform, tunnel/bridge past a platform, island fallback).

For the A/B/C/L front livery, `train-cab` pins both `cab-livery-paint` sections
to the consist colour at both ends; retain that material assignment while keeping
the shared shell surface partition and High/Low geometry checks.

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

`move.test.mjs` also pins a 地面出入口's clicked wall course through preview and confirmation.
The moved Tanwei D exit facing west at `(33,37,4)` must commit at that height with its live
settings; changing only the mount course at the same storey anchor is still an edit, and undo
and redo restore the mount course with the module.

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
`passenger-view`, `passenger-clothing`, `capture-passengers` and `passenger-art-pipeline`: the complete
reviewed catalogue and walks, equal explicit adult/child pools, 20% child selection, separate age
size ranges, body/shadow axes, 70% opacity, pause, picking and physical stride.
Clothing tests require forty appended entries (ten presets per sex in both grey
arrangements) in both age pools, exact authored tones, source GLB hashes and
actual baked skirt points in all gaits. The small skinned fixture rejects
welding standing-coincident points with different morphs, and proves detached
bake parts follow animated morph weights. Actual-asset checks must reject a
standing shell on a moving skeleton. Art validation requires complete child and
adult strides for both grey arrangements; GPU sheet playback must show new
clothes on both ages.
Pin actual baked skirt faces as outward-only and reject hidden thigh vertices;
closed GLB support shells must not show through the game's 70% material.
`passenger-atlas` checks byte-exact temporal-delta round trips for signed positions
and normals (including overflow), absolute legacy data and malformed formats.
Scale appearance sampling with the child pool so rare templates retain enough
observations for the existing equal-selection/gait-independence thresholds.
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
`setStation` fast paths (no chunk remesh, station-wide plate repaints skipped,
slice key cleared so batches resync) in `scene-wiring` — `SceneRenderer` itself
needs WebGL, so that contract is source-text.
For 三角 runs, keep the drag arithmetic in the pure geometry module
(`app/tools/geometry/cells.ts` `triangleRidgeAxis` / `triangleLineCells`) and pin the
ridge-only line, the one-shape-per-course release, the neighbour side a wedge leaves
open, and the seamless ridge join in `triangle.test.mjs`.

`ramp-surface.test.mjs` verifies the actual rotated stair soffit/escalator truss
against derived terrain cuts across rotations, travel directions, one/two/three-storey
spans and raised exit landings. It also checks cap triangles across floor/ceiling/base
clamps, partial footprints, crossing planes, shaved half walls, neighbour exposure,
and footprint-only invalidation across a chunk seam. `tools/check-ramp-fit.mjs`
captures the production wide-run fixture and measures alternating stair delete/restore
commits through rendered feedback; timings are diagnostic, not a real-pointer budget gate.

`ramp-block-placement.test.mjs` extracts the Tianhe `(77,-100,-16)` stair into a
small deterministic fixture. It pins direct/indexed block verdicts, cached preview,
release and post-placement carving, every stair/escalator rotation, zero-volume
remnants and overlapping-run refusals. Existing carve suites distinguish retained
underside wedges from cells wholly inside the passenger passage.

### Urinal and equipment LOD inventory

`module-build` raycasts the urinal's bowl at High and Low and checks its
envelope in all rotations; `placement`, `equipment-placement-input` and `move` pin wall aiming,
placement and moving.
`model-detail` includes it in the strict <10% per-option Low budget, both before
and after static batching; `preview-lod` covers preview/placed detail policy.
`performance-policy` and `worker-preview` pin its sim-inert edit path, retained equipment and skipped
route rebuild. `tools/model-triangle-inventory.mjs` and
`tools/check-equipment-lod.mjs` build the double TV as a real shared pair, and
the latter checks all 122 catalogue options in WebGL. Record triangle counts and
measured placement results only in the shared performance reference.


The restroom cubicle family regression spans ail-families.test.mjs (family ownership and decor rail anchor), menu-thumbnails.test.mjs (generated option thumbnails), and module-build.test.mjs (the toilet-only variant has fixture geometry and no enclosure or swing door). Run these focused tests when changing the family or its model.
