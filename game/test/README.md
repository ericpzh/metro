# `game/test` — how the game is tested

`psd-header` pins independent directional terminal matching, platform-facing arrows,
bilingual station/terminal printing, schematic routes and the lower line-colour band.
`module-build` and `psd-end` pin the taller fascia, shorter full-height glazing, and
the amber oval lamp centred below each doorway plaque.

`autosave.test.mjs` covers dirty-only local saves, undo/redo, immediate new/import/demo
replacement, invalid saved data, quota failures and retries.

`tutorial.test.mjs` covers empty, paused startup at ground level and the tutorial's
local-storage progress/opt-out, including corrupted, stale and blocked storage.
Run `npm run check:tutorial` from the repo root for the separate production-browser
regression: bilingual layout, first-card language switching, separate shortcut
keycaps, live keyboard/mouse controls, tool-only activation before revealing the
construction area, new-line expansion, whole-folder highlighting/scrolling, and
reload/skip/completion/opt-out/reopening. It uses Chrome or Edge and saves its
report/screenshots under ignored `.preview/tutorial/`. These UI checks do not
contribute to the Node suite's V8 coverage figures.

`roof-tool` pins stair-block previews without placement validation or document edits;
release validates the run and commits only accepted tiles once.
It also checks a 1,334-module station produces one mouse-down raycast for both
an empty hit and a hit on the final module, preserving the chosen anchor.
`equipment-placement-input` guards one scene pick per event for tactile placement,
floor-mark deletion and exit snapping with large-document misses and late hits.

`batching-lifecycle` also pins move pickup/cancel retaining batch allocations and
restoring neighbour rendering. `performance-policy` pins immutable collision-body
cache invalidation; `draw-batching` checks repeated services reuse train geometry
with an eight-dormant-consist bound and exact disposal on eviction. `passenger-library`
checks the native base64 decoder and the compatibility path preserve every byte.

`draw-batching` covers reflection winding and rays, actual train door-bank and glass
transforms, buffer disposal, equipment instance/merge/sort paths, original module
picking IDs, local allocation reuse and visibility, live atlas UVs/repaints, rig
exclusions and legacy/explicit passenger age metadata compatibility.

`batching-lifecycle` covers atlas-backed equipment without source UV mutation,
revision reuse/disable/re-enable, exact geometry/buffer/texture ownership, material
and culling boundaries, unsupported/hidden/deforming mesh exclusions, nested landing
doors/cabins and real ModuleSystem/LevelSystem hide/ghost/cut transitions. Its camera
rays reject invisible nested surfaces and hidden storey roots; `delete-tool`, `move`,
`pick-tool` and `select-agent` pin the corresponding pointer-tool behavior and ensure
cell fallbacks do not resolve a module hidden by the active level slice.
`draw-batching` exercises A/B/C/L stock in all four track rotations and compares
exact submitted geometry, then drives TrainSystem pause/hide/resume/eviction.

Run `npm run test:perf` from the repository root for renderer, stair/roof input,
equipment picking, passenger binary/pose and placement/worker/crowd/frame/sign
coverage. Coverage flags precede test paths;
appending `--experimental-test-coverage` after the npm test glob does not measure
coverage. Line/function percentages are source evidence, not proof of GPU behavior.
`npm run check:render-batching` builds the game and checks production GLSL/WebGL,
whole-station draw reduction and open/closed train triangle preservation with no
runtime errors. It requires Chrome; it asserts no FPS threshold. Its report and
benchmark/profile artifacts live in ignored `.preview/perf/`.
After a build, `node tools/check-render-batching.mjs --no-multi-draw` from the root
also verifies the extension-free fallback, with a separate report. Real CameraSystem
rays in `batching-lifecycle` cover source IDs, restored layers and wall occlusion.

`performance-policy` covers cached placement equivalence and invalidation, cosmetic
worker edits, per-model cell dependencies, stair-block-only addition retention and
owned-material retention/disposal,
pointer frame coalescing with release/cancel, paused/hidden crowd upload ranges,
storey/frustum packing and eye following, and train shell bounds/triangles/door rigs.
It also pins the boards-only sign preview: the one-sign verdict, the keep-set module
rebuild that retains every other group, and the in-place plate repaint that skips a
resized panel.

`passenger-library` also pins the 75% and 87.5% standard backpacks: all thirty-six
resized variants stay visible and shallower than full size through every walk,
with equal adult selection and unchanged child restrictions.
The 232-entry library also covers left/right shoulder, crossbody and hand-held
purse templates. Adult/child pools contain 212/114 choices: children may use small
backpacks and crossbody bags, while shoulder bags and purses remain adult-only.
Adult crossbody bags are male-only, and adult purses female-only. Tests pin these
rules, mirror placement, all gait poses and atlas sizes as the catalogue grows.
The same suite compares the browser's packed-buffer decoder with Node's inflater
byte for byte and preserves legacy raw-base64 atlas compatibility.
It measures actual baked standing poses for all seven added male styles with
every bag, requiring crowns below 1.70 m and at least 2 cm below the original.
Source model tests independently pin lock topology, attachments and separation.
`passenger-assets` checks lossless production binary delivery, failed-fetch rejection
and the strict Cloudflare asset guard: every emitted file must be smaller
than 25 MiB, including rejection when a file is exactly 25 MiB.
`passenger-library` also pins signed integer pose-texture types and exact pose reconstruction.
The baked strap/handle surfaces must remain above the legs with short triangle
spans, so free anchors collapsing to the origin cannot reintroduce dangling debris.
Still and walking art captures both use bounded model batches.

`passenger-clothing` covers forty appended jacket-free entries: ten presets per
sex in both grey arrangements, all eligible for both ages. It checks exact grey
stops and current source hashes, then compares the actual baked skirt vertices
with the exported moving shells through all three gaits. A static-shell negative
control detects skeleton-only baking; a small skinned fixture detects lost morph
weights and invalid welding. Art validation requires complete adult and child
strides for both arrangements, and rendered sheets must show the new clothing.
Actual baked faces must be outward-only and hidden thigh vertices absent.
`passenger-atlas` verifies lossless temporal frame differences for signed 16-bit
positions and 8-bit normals, including overflow, legacy data and malformed formats.

`column-delete` covers G's +1..+4 column erase above the floor: plain and tagged blocks,
gaps, negative heights, all height bases, drag deduplication, adjacent storeys
and preserved street floors, plus controller preview/release agreement and
one commit per click or drag, native context-menu drag preservation (also used by
right-button 分区 erasure) and available erase cursors.

`monitor-signal` pins the 监视器's two mounts, all rotated wall backing courses,
3×2 m wall dimensions, twelve 1×0.5 m screens in four rows facing away from their backing in every rotation,
hanging suspension to a taller slab, variant save/preview/sweep behavior and palette wiring.
信号机 checks its one-metre total height and scaled placement bounds, three vertically
aligned lenses, red below, concrete base and post, and rays reaching each lens before
its backing or hood.

`decor` also covers the 0.5 m tall compact fire cabinet and the 1.5 × 2 m glass-front
cabinet: 小 / 中 / 大 stay consistent in both catalogues, alongside rotated bounds,
two-cell floor support and collision, save/move/ghost/sweep identity, and unblocked
glazed apertures. `pick-tool` checks copying cabinet variants.

`demo` pins complete stairs from the current catalogue, explicit block-fitted
widths and unchanged landing plans. Its circulation check resolves platform door
server IDs through `graph.servers[id].node`; a negative case substitutes an
unreachable node to ensure the check still rejects a disconnected boarding point.
`stairs` also pins size labels and Tab cycling for explicit fitted widths.

`psd-end` checks that screens, snapped corners and continuations fit below their
overhead blocks, match their reserved height, and still refuse blocks inside extensions.
It also checks both screen heights and every snapped orientation for competing
coplanar fitting faces after trimming and overlap with the screen housing at the
corner joint, while preserving the snapped glass plane. Fascia/cap joints must
also close without a clearance slit; rays through exposed PSD ends must not
hit duplicate faces, and moving leaf fittings retain their full geometry.

`trains` checks stopped train centres and every screen-door opening in all four
track rotations and both directions, using the four-car, 68 m Line 6 layout.

`render-performance` checks static module batching preserves transformed bounds,
triangle counts, ray picking and buffer disposal, keeps animated/shared/transparent
parts intact, and invalidates floor-paint reuse for structural edits, station metadata,
stair start finishes and room wall finishes. Performance timings live outside the test
suite in `tools/bench-sim.mjs` and `tools/bench-browser.mjs`.

The suite is `node --test` over `test/**/*.test.mjs`. Nothing here runs in a browser:
the tests import the TypeScript sources **directly** (Node strips the types) and drive
them the way the app does — the sim in-process, the renderer helpers headless, and the
React store through its own actions. That is a property of the sources, not of the
harness: `sim/` is pure and DOM-free (`layering.test.mjs` fails if it stops being),
the drawing helpers that have pixels take a 2D context, and `app/store.ts` is zustand
with no view attached.

`placement` and `bay` pin escalator collision against its per-tile sloped body: space above the
lower section stays free, same-storey treads still collide, and vertically adjacent runs do not
reserve an entire shared shaft. `escalators` also pins the inspector's selected-run direction switch and its undo: travel reverses
by swapping `from`/`to` together with `cfg.dir`. `escalators` and `module-build` also pin the
single two-block-wide escalator: its continuous
moving band, outer rails, rotated footprint, landing support and two-column opening.
They also check seamless glass filling both rounded handrail returns at either end,
for narrow/wide escalators in every rotation and travel direction; the glass stays
inside the rail curve and makes one pane per side. The wider metal shoulders, flattening
risers and covered step return are checked too;
`slope-cut` checks the recessed upper landing beneath the terminal deck.
`module-build` also checks floor/apron clearance and the body's inset, buried joins.
It pins train roof/body paint and non-overlapping cab seams, plus half-height screen-door caps
that slide clear with their leaves. `train-cabin` pins spawning at the stopped berth before opening,
and clearing riders after closing while the train is still stationary.
`module-build` also checks clear train-door window apertures and screen-door slide-lane clearance
for both screen heights, both track sides, and closed, partial and fully open poses.
It also pins the slim half-height rails, cap/rail vertical separation, single glass surfaces,
reference cabin fittings, and train interpolation between snapshots including early updates and reappearance.
It pins the 地面 X向 exit header's full-width red fill and unchanged font sizes as wider bays add spacing between text blocks.
`escalator-length` checks all four run lengths — 超短 2 m / 短 3 m / 中 4 m / 长 8 m — in both widths,
rotations and directions, each with its own passage, landing graph nodes, ride time, exit snap (a
单跑楼梯 as well as a 扶梯), preview refresh, move, save round-trip and drawn model, with old 4 m / 8 m
saves reading back as 中 / 长;
`pick-tool` checks copying a run's length and restoring the previous one with Esc.
`ramp-join` checks shared metal caps between escalators and stair-escalator pairs,
including wide pieces, rotation, reversed travel, single seam ownership and neighbour removal —
and that a bank fills its seam at every one of the four lengths while two differing lengths never
share one.
It also checks the closed end shells and centreline hemispheres seated on the metal cap.
`exits` pins one-to-four-bay head-house geometry, including the 6 m 四向 ground exit, placement from a picked
straight stair or escalator (all rotations, both escalator travel directions, bay alignment, offset top-landing
rows in the rendered wellway, and rejected
turning/virtual pieces), and the reverse ramp-into-exit snap; `module-build`
checks its rendered 6 m width and `pick-tool` checks that picking it restores the matching palette tile.
`module-build` also probes actual concrete meshes around the Tanwei B save fixture and all
1/2/3 m straight-stair bands in four rotations, keeping both flight edges open and both side floors solid.
`exits` also pins the 虚拟 1×1 surface exit (its own cell, no walls, no floor, no run snap),
`module-build` its 导向柱-sized render, `pick-tool` its tile round-trip, and `overground` its
surface placement and graph node.

`stairs` checks standalone straight-stair placement at every size and rotation.
It also checks saved catalogue sizes fill their block band in carving and collision,
detect walls at the outer edges and preserve adjacent blocks without thinning. For the
**turning** shapes it pins the block-grid rule end to end: both hands' 90° legs built a block
wide with each band slid across its **own** run, the quarter-landing the `lanes × lanes`
square the legs meet on with the departing leg on its far edge (so no flight body, tread or
walk stands over a landing cell), the walk across that square in all four rotations, the
equipment tool's ghost carrying the same piece the factory builds, the whole square laid and
bulldozed as the stair's own floor, and a piece saved at an older off-grid width keeping its
band and its single corner cell.
`module-build` checks continuous full-width treads and glass beneath outer stair rails and returns,
including exact 1/2/3-block outer bounds in every rotation,
plus medium/wide straight-flight offsets along the block side in all rotations and unchanged legacy
off-grid centrelines. It also measures a 90° turn's **drawn** platform against the block square
the builder lays — whole cells along the departing leg, the band's rails `STAIR_RAIL_PROUD`
inside on the other axis — in both hands, all three sizes and all four rotations, so the model
cannot draw a landing the sim does not walk. `move` carries that square with the piece: every
cell of a 中 turn's 4-cell landing goes with it and comes back laid at the new cell.

The `shelf` suite also pins tall/short, wire and cooler variants, their save/preview/sweep identity, rotated model bounds, ceiling clearance and cooler shell and tall/short gondola plinth/trim separation to prevent flickering.

`ramp-passengers` covers single-file narrow ramps and two spaced columns on wide
ramps; same-tick boarding and wide escalator throughput; swept collision clearance;
routes and recovery around rail ends; queue order and journey retention; opposing
traffic on narrow stairs; and actual access across each stair-turn landing in every
rotation.

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

`module-build` checks lift landing doors at real floors, independent car doors,
and synchronized opening only at the aligned landing in both styles and all rotations.

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
transfer openings, open overhead frames without built-in banners, editable sign placement in
both booth types, footprint bounds and translation, plus the desktop facing each of four fronts.
`zonetool` checks 商店 / 厕所 / 办公室 as ordinary room-color floor labels: their tile icons stay,
fare-zone values survive, and painting adds no room module or wall; it also checks the booth's live
rotated 3D drag preview and release. `zones` pins room-color overlay regions without module-name
labels. `facility` checks the
staff benches remain opposite the selected front. `sign-render` covers the reusable
customer-service pictogram.
`booth-sign` checks wall signs snapping to either booth's header, all four faces,
centred geometry and collision bounds, saving, moving and missing support.
Wall signs render only the printed sheet with 3 mm of surface clearance, including ordinary wall
mounts in all rotations; booth signs keep the same thin sheet. The suite also drives the real camera
ray, including its block-occlusion rule.

The suites, by the thing they are about. Each one's full description is in
`../README.md`'s test list — that list is the detail, this is the map:

`surfaces` also covers the four material categories, all-face application, and custom
涂料 colours surviving save/load and meshing. `paint-mode` covers independent 涂料
and 搪瓷板 picker colors, persistent 单块 / 整面 mode, Tab cycling, saved station color
swatches, and the compact picker-tile UI source contracts.
`render-regressions` pins model-label shrink-to-fit arithmetic, the round/recessed
thick-pillar shaft and collars, periodic obsidian pixels, and material roughness.

| Area | Files |
|---|---|
| Architecture | `layering`, `scene-wiring` — the sibling-wiring guard, and the `setStation` boards-only/inert-decor fast paths: one-sign verdict, chunk remesh skipped, station-wide plate repaints kept on the full path |
| Numbers | `rng`, `clock`, `demand`, `headway` |
| 屏蔽端门 | `psd-end` — fixed glass stack, matching heights, Tab preview refresh, shortened corner snapping and exact 1 m extensions, tile-contained meshes/reservations and adjacent block/equipment placement, hover/click placement, undo, walk barrier and save/load; curtain-wall widths and picking |
| The crowd and the graph | `determinism`, `capacity`, `demo`, `gates`, `gate-door`, `zones` (room-purpose overlay regions preserve fare-zone values; synthetic track floors follow rotated `trackCells` footprints, not unrotated bounds), `lift`, `placement` (stair shapes require only foot-level ground; escalator collision clearance follows its sloped body), `openings`, `stairs`, `escalators`, `escalator-length` (all four run lengths, on the 扶梯 and the 单跑楼梯 alike: spans, carve, landing nodes, ride time, exit snap, save round-trip, both drawn models, the catalogue's fallbacks and the one armed length a bank is built at), `ramp-passengers` (ramp lane spacing, body clearance, collision recovery, stair-turn access and queue-preserving detours), `slope-cut`, `ramp-fill`, `trains`, `train-cabin`, `stock`, `load`, `agent-route` (including the 1.5 m figure scale), `worker-preview`, `wayfinding` — `gates`, `zones` and `wayfinding` force `zoneBarriers: true`, because §4.5's fare line is off by default (`ZONE_LINES_BLOCK`) while the demo's zone paint is unfinished; `train-cabin` is the cabin the crowd rides in and `worker-preview` the worker path that must not step the sim to show a route |
| The document and its edits | `save`, `grid`, `pick-cell`, `ground`, `walls`, `halfwall`, `triangle`, `blocktool`, `zonetool` (ordinary room-color labels add no walls/modules and preserve fare zones; rotated booth drag preview and release; right-click taps and drags erase labels like 无分区 while preserving floor), `facility` (legacy footprint-module helpers and booth fronts/benches), `fence`, `storey`, `exits`, `bay`, `surfaces`, `rail`, `track-third-rail` (the 第三轨 travel-left / off-platform side and its drawn model), `validation`, `overground`, `roof-tool`, `track-run-length`, `structures-gaps` — `storey` checks the 0–3 m height base and `save` checks its persistence and older-save default; `overground` + `roof-tool` are the pillars/roofs/doorway-exits/stair-blocks/bridges, `track-run-length` the shared tunnel/bridge lengths, `structures-gaps` the repair-shaped edges; `ground` is the city's own floor: the plane at `z = 0` is stored **inverted** (`sim/ground.ts`), so it owns the window `withGround` materialises, the dig that records a hole, re-adding default ground without a record, and authored paint/zone persistence |
| The furniture and the decor | `hanger`, `shelf`, `desk`, `checkout` (shop placement, saves, rotated bounds, screen/stock visibility and workstation chair), `restroom`, `bench`, `vending`, `decor`, `ceiling-decor`, `lights`, `vent`, `floor-decor`, `street-decor`, `sign`, `sign-model`, `sign-editor` (including rejection before hover insertion, and a live drag that defers the scene redraw to a scheduled trailing sync the drop flushes once, evaluated once per frame), `billboard` (WebP headers, compact sizes, panel filling, shared per-poster materials and per-size geometry), `glass-panel` (including fitted doors and edge decor backed against a curtain), `door-panel` (both-face handles), `calligraphy`, `line-map`, `booth-model`, `room-model` |
| Passenger library | `passenger-library` — all 232 approved variants with ten hairstyles per sex, including eighteen small backpacks, equal selection within adult/child pools independent of size/speed, every walk on every model, pack presence/absence, valid padded topology, single instanced draw and atlas disposal; `passenger-size` pins the 20% child population, small-backpack/crossbody/bagless non-bald child pool, independent 80–120% height, 90–110% adult horizontal variation and 80–90% child horizontal variation, stable identity and body/shadow matrices; `passenger-view` retains identity, ground contact, flat greys, 70% crowd opacity, pause, picking and eye view. |
| The models | `module-build` (including slab-track sleepers, seats, clips and rail heads; enclosed double bins, hopper face winding, sealed full-height PSDs and moving decals), `restroom-model` (three-sided cubicles, privacy doors, flush joins, shared partitions, rotations, previews and neighbour removal), `lift-style`, `psd-decals`, `ramp-join` (the shared seam at every run length, and never between two differing lengths), `tv-screen`, `tv-pair` |
| Touch navigation | `touch-zoom` — pinch direction, cancellation and release suppression; shared zoom and limits in both projections |
| The scene | `chunk-cache`, `level-slicing`, `grid-visibility`, `ground-visibility`, `section`, `section-drag`, `cut-clipping`, `floor-surface`, `render-performance`, `camera-vertical-pan`, `camera-fov`, `camera-orbit`, `view-home`, `refused-ghost`, `sim-pause` — `render-performance` pins static module batching and safe reuse after floor paint; `ground-visibility` is the street's own mesh pass and the 隐藏地面 tile that takes it away; `sim-pause` is the paused-sim freeze: escalator bands, 闸机 leaves and train/screen doors hold their pose while consists glide to their latest snapshot |
| Performance policy | `performance-policy`, `worker-preview` — placement index equivalence/cache invalidation, cosmetic/inert-decor edits and graph rebuilds, model dependencies including stair-block-only and inert-decor-only additions (tactile/hanger neighbours plus edge decor leaning on a curtain), material disposal, pointer coalescing, crowd upload ranges/culling, retained rigs and train shell batching |
| The pixels | `sign-render` (short 0.4 m signs, nine-arrow capacity and centred existing content, primary-only labels at twice the size, the divider line and the blank divider), `station-display` (TV layout, per-track timetable and seconds/minutes), `exit-banner` |
| Concept art | `passenger-art-pipeline` — growing catalogues, bounded browser batches, complete standing/stride coverage, stale build rejection and duplicate capture files; `capture-passengers` — the `?capture-passengers` route wiring, the live crowd mesh photographed with alpha, every field the sheet tools place by (foot origin, scale, stride) and full-stride gait captures in plan, elevation and isometric views. `art-passenger-heading` projects facing through the capture camera and compares it with all eight isometric travel directions, preventing sideways walking. Browser playback is checked separately with `node tools/test-passenger-animation.mjs` after captures and art generation. |
| Languages and routes | `i18n` — both catalogues and interpolation slots, live notice translation, canonical labels, explicit-language formatting without changing UI state, root/prefixed English routes and assets |
| Startup and tutorial | `tutorial` — empty paused startup at ground level and resilient progress/opt-out storage. `npm run check:tutorial` separately exercises the production UI in both languages, including live input, practice activation, dynamic spotlights, keycaps and reload behavior. |
| The app | `move` (including no lift when the visible-layer picker has no target), `delete-tool` (block delete rectangles, Shift lines and one-step undo; hidden modules do not start a module delete), `equipment-deletion` (visible module before underlying grid cell), `equipment-placement-input` (wall/ceiling support placement from open air, plus an exit preview and click aligned by picking a stair through tread gaps even with a floor hit), `sweep`, `paint-mode`, `tool-shortcuts` (B/P/M toggle back to the previous tool and the room front R tile), `builder-attributes` (shared module capability order, common width icon, R/Tab/Shift+Tab dispatch, the four run lengths and the straight-stair predicate the length tile is gated on), `tool-hover-preview` (blue previews for move/picker/select, red preview for bulldoze), `rail-folders` (all ten Shift+number keys, four top-level decor folder titles and diagonal tab positions through the last two rows), `rail-families` (per-section decor membership and order, cross-section families with complete variant menus, and the equipment-to-decor TVM move), `line-edit`, `new-station-confirmation` (the top-bar button and Ctrl+N require confirmation before replacing the station), `topbar-report-issue` (the FaBug issue-tracker link beside restart), `topbar-playback` (the paused play button resumes like Space, keeping the speed tiles' own resume), `select-agent` (cell fallback ignores modules hidden by level slicing) — `pick-tool` also pins the hidden-module fallback and the full-palette sweep: every `MODULE_OPTIONS` id round-trips through the picker, including the setting-free 空调风机 and 设备柜 |

## The rules a test here follows

Roof placement coverage in `roof-tool.test.mjs` includes pointer-centred footprints for plain, shell and truss roofs at all widths and rotations, matching hover and click anchors, the shell bay's truss-less variant passthrough, roof-height ray projection in perspective and orthographic views, and thin-roof snap priority (existing slab, block outside face, active view height), Tab/action tile state and preview/release agreement. `overground.test.mjs` pins upper/lower slabs against their exact rendered and collision boundaries and keeps them on the correct storey.

`overground.test.mjs` covers pillar dimensions and 4 m extension. `pillar-length.test.mjs` pins the Tab choice of 2 m / 4 m sections for both pillar widths; `pick-tool.test.mjs` pins copying the choice and restoring it on Esc; `move.test.mjs` pins moving a free-standing pillar (same shaft, translated, floor-checked at the drop) and refusing a bridge-owned pier; `pillar-extension.test.mjs` pins the anchor-cell extension snap in both document orders, the nine slim offsets, stacked-pillar storey bands, the info-card lift, the flight-only turning-stair hitbox, the stair-naming refusal and the hover/release highlight agreement.

1. **Import the source, not a copy.** `import { buildGraph } from '../src/sim/station.ts'`
   — no build step, no bundler, no `dist/`. If a module is hard to test, that is a
   statement about the module: `sim/` is kept pure for exactly this reason.
2. **Pin a number and say what it means.** `assert.equal(height, 1.02, 'the 闸机 is a
   1020 mm machine, not a 1 m cube')` beats `assert.ok(height > 1)`: the
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

Measured over the whole suite (`--experimental-test-coverage`, one process): **1392 tests,
94.02 % lines / 88.74 % branches / 89.39 % functions** across the loaded source files. This
snapshot includes the four run lengths — 超短 / 短 / 中 / 长 on both the 扶梯 and the 单跑楼梯 —
and, since that pass, the staircase's block-grid work: a 90° turn's legs built block-wide, its
quarter-landing the `lanes × lanes` square with the departing leg on that square's far edge
(`sim/stairs.ts` reaches 100 % lines / 92.4 % branches on the back of it) — plus the
draw-batching suites that landed in the same window. The denominator grows as
features and diagnostics become testable, so these percentages are a record, not a target.
The snapshot before this pass was 1367 at 93.95 / 88.44 / 89.16, and before that 1355 at
93.92 / 88.38 / 89.12, and before that 1035 at
92.79 / 88.52 / 88.80, and before that 938 at 95.02 / 88.36 / 88.94, and before that 897 at
95.50 / 88.64 / 89.79, and before that 891 at 95.23 / 88.63 / 89.41, and before that 855 at
94.94 / 88.47 / 88.23; regenerate the figures above whenever the suite grows. The point of the table is
the column that shows what an untested file was hiding.

| File | Before | Now | The test that closed it |
|---|---|---|---|
| `sim/rampLengths.ts` (the four run lengths) | — (new) | 100 % lines / 100 % branches | `escalator-length` — the catalogue both runs and the rail read: the four spans, the 超短 → 短 → 中 → 长 cycle, the label per size, the length a placed run's endpoints name (an old 4 m / 8 m save is 中 / 长), the 中 fallback for a size another build wrote, and the nearest entry for a span the catalogue never built; `ramp-join` covers the seam at every length |
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
| `sim/headway.ts` (formation and train curve) | — (new) | 100 % lines / 82.5 % branches | `headway` (repair, dispatch count, readouts and the train curve) |
| `render/batchStaticModule.ts` | — (new) | 100 % lines / 90 % branches | `render-performance` (bounds, triangles, picking, disposal and exclusions) |
| `render/retainPaintedModules.ts` | — (new) | 100 % lines / 94.4 % branches | `render-performance` (paint reuse and structural invalidation) |
| `render/moduleDependencies.ts` | — (new) | 99.0 % lines / 89.5 % branches | `performance-policy` (per-model dependencies, stair-block-only and inert-decor-only additions, tactile/hanger neighbours and the boards-only sign verdict) |
| `sim/lights.ts` / `sim/vents.ts` / `sim/inCellPositions.ts` | — (new) | 100 % lines | `lights`, `vent` |
| `render/models/pieces/LightModel.ts` / `VentModel.ts` / `StreetDecorModel.ts` | — (new) | 100 % lines | `lights`, `vent`, `street-decor`, `module-build` |
| `render/models/pieces/RampJoinModel.ts` | — (new) | 98.7 % lines | `ramp-join`, `module-build` |
| `render/models/pieces/EscalatorModel.ts` (rebuilt band) | — (rebuilt) | 98.0 % lines | `module-build`, `escalators`, `ramp-fill`, `escalator-length` (the same body at all four run lengths) |
| `render/models/pieces/DoorwayExitModel.ts` | 31 % | 100 % lines | `module-build` (doorway rows: one row per bay, widths 3/4/5 m) |

`gate-traffic.test.mjs` covers committed approaching passengers, route changes to a spare lane,
opposing-direction drain forecasts, reservation cleanup, gate-node pressure and total wait accounting.
`wayfinding.test.mjs` also pins deferred choices staying outside the queue and patience retries on the
next tick; the eight-search gate budget remains bounded during a wave.

Two behaviour pins move no coverage line — the rationed searches were already
executed, just never capped — so they are verified by mutation instead: with the
cap removed the crush test fails 6 ≠ 4 and the at-gate test fails 11 ≠ 8
(`wayfinding`: `REROUTE_REPLAN_PER_TICK`, and the fare-line ration at the gate's
own cell). The 幕墙 height pin in `glass-panel` is the same shape: `createModule`'s
trailing settings were already executed, so nothing moves when the height is
*dropped* on the way through the tool — the test asserts the value that arrived,
not the call, because every curtain would otherwise silently be four storeys tall.

The files still lowest after this pass, and why they are:

| File | Lines | What is left |
|---|---|---|
| `build/model/Reference.ts` | 31 % | A barrel whose one consumer is the demo path; nothing imports it directly. |
| `render/scene/systems/GhostSystem.ts` | 85 % | The hover-ghost limbs and the back-to-back face mesh: they build meshes for a live scene and are driven by pointer moves (`gate-door`, `triangle` and `tv-pair` cover the keys and the wedge slope they read). |
| `app/store/slices/RailSlice.ts` | 46 % | The rail actions the UI calls; the pure edits underneath are covered by `rail` (`build/rail.ts`) and `line-edit`. |
| `app/tools/BlockTool.ts`, `geometry/cells.ts`, `ToolController.ts` | 50-59 % | The pointer path: press/move/release against a canvas, of which `blocktool` and `triangle` drive the parts that need no DOM. |
| `render/scene/systems/CameraSystem.ts` | 70 % | The `OrbitControls` rig: its own limbs are driven by real pointer events on a canvas. The pieces of it that are pure arithmetic are pinned (`camera-vertical-pan`, `camera-fov`, `camera-orbit`, `section-drag`), and 回到默认视角 through it is pinned by `view-home`. `camera-vertical-pan` also checks the frame loop tracks `activeZ + 1 m` while retaining orbit and zoom. |
| `sim/world/World.ts` | ~96 % | The branches a crowd reaches only in a long, rare run: a stuck agent, a lift car arriving at the wrong moment, an invalid trip. Covered by the tightest tests that exist (`determinism`, `capacity`, `demo`) rather than by a targeted one. |
| `render/scene/systems/*` | 80-100 % | The GPU half of each system; their arithmetic is covered (`chunk-cache`, `cut-clipping`, `level-slicing`, `section-drag`, `grid-visibility`). |
| `sim/sign.ts`, `sim/station.ts`, `sim/openings.ts` | 97-99 % | Branch tails: an unreachable save spelling, a degenerate run, a fallback for a document that cannot exist. |



Above-ground equipment: `overground.test.mjs` pins slim/thick support dimensions and 4 m extensions, slim-pillar R cycling through nine offsets shared by the model and collision envelope, the 1×1 m thin roof and the truss and shell bays in 4/8/12 m widths, full-height collision bounds, and material painting of roof cladding while the supporting truss stays steel in 单块 / 整面 mode, doorway exits aligned to the near block edge in all rotations, in three widths at any supported height ≥ 0 m (with an explicit backing wall, preview/release agreement and a graph node that exists), bridge connections in both directions and all rotations, support attachment, and save/load preservation. Roof and pillar variants sit below the triangular blocks in 工具; doorway exits live under 设备; 轨道桥 lives under 轨道 and extends an existing rail without platform doors or a tunnel shell. Roof bays place by click or rectangular drag and are painted through 材质.

`roof-tool.test.mjs` verifies rectangular thin-roof previews, full truss-bay placement and removal including rotated 8 m bays, collision refusal, right-drag removal, and one undo step per drag. Thin roof Tab/action controls cycle 上 / 下 with the matching arrow-to-line icons; a hovered roof slab overrides block placement height and half, blocks anchor the tile outside their face, and click preview/release agree. Each bay style has one tile, the shell bay carrying no truss; Tab or its action tile cycles 窄 4 m / 中 8 m / 宽 12 m and redraws the hover. `overground.test.mjs` also pins exact lower/upper quarter-metre model and collision bounds at the cell boundaries, plus 4 m of truss assembly height including the skin, contact with support posts, continuous 40 cm bottom chords across bay seams, and half-density internal ribs in 收束 at all widths and rotations.

Small stair blocks: 楼梯块 under 楼梯 has a 1×1 m footprint and no railings. Tab switches 高 (1 m, four treads) / 矮 (0.5 m, two treads), with a live placement preview; the palette preview is turned 90° counter-clockwise. Click places one tile; a drag lays a straight row across the stair's rotated width, ignoring pointer movement along the treads. R rotates the steps, and 材质 paints the whole stepped surface. The high block connects adjacent lower/upper floors without carving blocks; the short building piece does not create a full-metre walking connection on the whole-metre floor grid. `overground.test.mjs` pins dimensions, painting, collisions, floor preservation, save/load and both walking directions; `roof-tool.test.mjs` pins the rotated drag axis, preview/release agreement, undo and removal.

Bridge deck and barriers: `overground.test.mjs` checks the one-metre underside without coplanar edge girders, eight-metre centre-pier spacing in every rotation, zero piers on four-metre bridges and migration of older spacing, reuse and owned teardown, B deletion persisting across edits/load with undo/redo, full-deck ground clearance, pillar contact, collision refusal below the deck, deck-only material painting, half/full sound-barrier height, preview identity and save/load. `structures-gaps.test.mjs` checks the three-name cycle and wraparound. `pick-tool.test.mjs` checks copying the barrier and length and restoring both on Esc.

Truss roof finishes: the truss bays use neutral white vertex colours and metre-scaled UVs on cladding and beams, so 材质 painting renders the selected finish on the roof sheets instead of black. Beams and braces keep the shared steel material. `overground.test.mjs` checks every mesh across all three widths.

`structures-gaps.test.mjs` pins the repair-shaped edges the feature suites use but never assert: `normalizeLevelBase` clamping/rounding, the roof width cycle/clamp/labels and ridge formula, the three ways a pillar refuses a bridge, and the roof-paint no-ops.

Roof visibility: 隐藏天花板 leaves actual roof modules visible. 隐藏屋顶 is a separate view toggle, off by default, hiding all roof styles even in 隐藏UI / 剖切. It sits below 隐藏天花板 with 分区图 to its right. `ground-visibility.test.mjs` pins independent ceiling/roof visibility; `rail-folders.test.mjs` pins the nine-tile order and header count.

`street-decor.test.mjs` verifies above-ground-only placement and movement, whole shelter floor support, track rejection, rotated model bounds, live station/exit labels, and persistence of exit references and frozen shared posters.

`hanger.test.mjs` covers 挂架: roof suspended and central post supports in 4/6/8m, roof attachments, sign/clock/TV mounting, rotated steel geometry, open walking space, post footing, preview identity and save/load.

`wall-ceiling-snap.test.mjs` pins wall and ceiling aiming on a shifted `levelBase` (the wall snap asks the station's 基准高度 for its storey floor, never the fixed 0 / 4 / 8 lines) and accepts an actual overhead slab at a nonstandard height; it also pins that a **side face is a wall whatever the block is tagged**, so a plain 方块 wall mounts a panel in front of the face rather than inside the block, and that a **玻璃板** — cladding from its base, and the only wall piece that is (`wallMountFollowsCourse`) — **hangs over the course the pointer is on**, keeping the storey floor for the wall's first course while a piece drawn at its own `panelZ` stays there. `equipment-placement-input.test.mjs` pins the tool's half of that (the 玻璃板 covers the clicked course, the 广告牌 beside it keeps its band) and `move.test.mjs` the carried piece's. The same file pins the **hung** piece's anchor: `hungCeilingAim` takes it to the free cell under the first **underside** above the pointer — `top block - 1` — from the floor, a wall course or a slab's own underside of one column alike (`topBlockZ` skipping a wall's own courses), with the storey floor and the station's `levelBase` standing in when nothing is overhead, `topBlockOver` for a cell with its top block over it, and the verdict passing a piece under that block while refusing one with no ceiling. `lights.test.mjs` and `vent.test.mjs` pin the tool's half and the drawn fixture (the real slab on a shifted base, and the top block when the piece's own cell is the one under it), `module-build.test.mjs` the drawn mount and pinned size of every hung piece, and `ceiling-decor.test.mjs` the 监控 stems against a tall slab. `sign-model.test.mjs` checks that the hanging sign's rods terminate at that slab.

`door-panel` checks all six 单开 / 双开 × 不锈钢 / 木 / 玻璃 variants, palette and width selection, the translucent glass pane in its steel frame, satin stainless and timber finishes, exposed hinges, both-face handle clearance and mirrored double-door pulls, plus placement bounds. It also pins 1 cm of lintel clearance in two-block-high wall openings for every variant, rotation and tested storey, while permitting the overhead block and refusing a block through the leaf. `glass-panel` pins all four 玻璃幕墙 orientations on one tile, rejection of same-facing duplicates, and removal of one intersecting corner post with shortened rails, alongside door snapping to rotated curtain runs, fitted placement, crosswise refusal, and the lower-pane opening while retaining upper and uncovered glazing.

`gate-door` also checks the 新/旧 turnstiles: slim cabinets, smaller opposing leaves retracting left and right, approach arrows and red crosses on fence-only machines, legacy/save compatibility and separate variant sweeps. `pick-tool` checks copying and cancelling 新/旧 choices.

`gate-door` pins the curved fan leaves (long top, short bottom) and the old gate's longer sloping fascia, flush reader sticker and absence of red/green reader lamps.

`passenger-view.test.mjs` pins the anime silhouettes, shallow head/body proportions, opaque unlit ink, complete eye/hair/clothing colour regions, CC0 clothed walking poses, six animated hairstyles per outfit, child/adult height and build ranges, child eye height and picking, stable outfit/build/height/tone variation through buffer reordering, grounded animated arm/leg poses, travel-driven gait, idle/riding transitions, mid-stride pause/resume through duplicate and reordered snapshots, selection at the displayed head/legs, phase identity through crowd compaction, interpolated eye position, departure handling, click-held first-person mouse look after the initial heading, and restoration of the camera and display settings.


`diagonal-walk.test.mjs` pins eight-direction walking in clear space (§7.2):
diagonal edges cost their actual √2 m distance with their endpoint finish speeds, require both cardinal routes
around a clear same-height square, and cannot cut past holes, walls, fare
barriers or turnstiles. `wayfinding.test.mjs` also checks diagonal ramp-glass
barriers at the ramp's own storey and clear diagonal movement below it.

`stairs.test.mjs` covers 左/中/右直跑楼梯: two forward flights, block-fitted middle landings, all widths and rotations, and bidirectional passenger routes. It also pins the turning shapes' block grid — a 双跑楼梯's flush pair and a 90° turn's two perpendicular legs each built block-wide, with the turn's quarter-landing the square its legs meet on (as deep as it is wide, its departing leg on the square's far edge), the equipment tool placing that piece and the builder laying and bulldozing its whole square. `module-build.test.mjs` checks visible treads, railing glass and landing geometry for all three styles, sizes and rotations, and measures a 90° turn's drawn platform against the square the sim lays.


Approved library integration: the live crowd uses all 232 reviewed templates from passenger-approved.json. `passenger-library` and `passenger-view` pin selection, flat greys, walks, identity, picking and eye view; `passenger-art-pipeline` and `capture-passengers` pin scalable model captures and stale-build rejection.

`walking-profiles` pins stable randomized slow/medium/fast speed assignment,
pool reuse and physique scaling, plus matching sim speed and full-cycle travel.
`passenger-view` checks all three longer walk ranges and less than 1 cm of planted
shoe motion in world space, then profile-aware compaction, pause and resume.
## Capacity fixture

`capacity` uses a one-car train with zero alighting for its boarding-heavy fixture,
so the left-behind assertion measures boarding queues across body/stride changes.

## Small backpack coverage

`passenger-art-pipeline` additionally requires every eligible child template's
standing samples and complete walks, rejects bagged/bald child captures and pins
physical stride scaling. The art browser check covers both age groups in all
three capture views; `check-game-passenger-library` renders 2,544 adult and 1,368
child samples and validates the live material, scales and model restrictions.

`passenger-library` pins all 232 catalogue entries, including eighteen small
backpacks, equal selection within each age pool, and the smaller pack's visible
depth throughout walking.
`passenger-view` pins the expanded catalogue alongside the shared draw and gait.
