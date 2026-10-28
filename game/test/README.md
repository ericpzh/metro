`editor-build-fingerprint` pins canonical cross-platform source hashes and stale-input detection.

`editor-action-benchmark` guards the complete production palette/demo manifest,
discrete setting families, cut orientations, valid production factories, compound
double TVs and actual PSD-cover support. `npm run bench:editor-actions` drives
the production preview/build/store APIs across every case on every demo, measuring
generation and first rendered feedback separately against 100 ms. Reports retain
failures, settings, build/demo hashes, source-stage maps and per-case profile links;
see the shared performance reference for reproduction and the API/pointer boundary.

`local-cell-edit` guards bounded cell deltas, immutable source documents, module-owned
street-window cache keys, live floor/occupancy indexes, monitor/signal dependencies,
actual ramp wall/landing inputs across all styles/rotations, shared preview occupancy
through block/wall commits, and stair-block place/move/delete retention. `line-edit`
pins immutable local-cell undo frames. `floor-geometry` compares incremental commits
with fresh triangles (positions, winding, normals, colours and UVs), including
chunk seams, ceiling support, painting and undo, while retaining remote geometry.
`floor-geometry` compares every stair family and escalators in all four rotations across place, move, delete and undo with a fresh remesh, including duplicate records, cuts, ceiling/ground passes, AO, floor ownership and remote allocation retention. `equipment-retention` pins duplicate-aware immutable cell diffs, retained activity discovery and live registry ownership; `storey-height` pins zero level-list allocations during storey lookup.
`equipment-retention` also pins zero repeated batch/detail work for retained roots
and resynchronisation when the graphics view changes. Browser timings belong in
the shared performance reference; run `npm run bench:block-edits` for real pointer
place/delete gestures across blocks, walls, half walls, both triangle families,
stair blocks, wall column erase and stair-block move.

Structural tool-index comparisons also cover generated holes, expanded/shrunk street
windows, duplicate records and above/below floor dependencies. `line-edit` pins exact
immutable structural history through repeated undo/redo. `batching-lifecycle` checks
replacement/deletion/reordering against fresh batches and zero remote geometry reads;
`cut-clipping` checks retained roots, new materials and plane/view invalidation.
`builder-attributes` guards inactive action rows against live store subscriptions
and retaining full document/history/graph snapshots;
the production tutorial checker exercises the bilingual builder controls.

`monitor-signal` pins bottom-to-top yellow/red/green aspect order, nearest-platform selection shared with TVs, and live lenses excluded from equipment batches. `station-display` checks the real dispatcher phase through departure and disappearance. Signals show green from berth through departure, red during approach and between services.

`audio` pins the six approved assets, four bilingual volume sliders, the 10% default
music level, master scaling, local preference validation/persistence, outcome-only interaction cues, repeated
refusal attempts, finite-radius Z-up distance/pan, bounded crowd sampling,
eight one-shots / three ambient buses, the approved per-layer speed policies,
passenger-loop retention, sample offsets/pitch, mute release and hidden-tab/late-decode
cancellation. `tools/check-game-audio.mjs` separately exercises production browser
pointer actions, source/file routing, event pick counts, sliders and ambient frames.

`train-cab` additionally pins upright compact A/B/L crew doors and at least 10 cm clearance across full passenger-door opening travel at both ends and sides. It also checks that both A/B/C/L front lower cab strips use the consist's line colour. `train-cab` checks curved moving passenger doors, black lower panels against the shared body profile, at both sides and every rotation, open/closed and High/Low.

`train-cab` also checks exact High/Low roof/skirt joins, C lamps inside the colour band and removal of floating skirt blocks. `train-bogie` also checks 0.8 m wheels around the outer door bays, vertical wheel/suspension clearance below the door sills, no raised wheel housings and the uninterrupted platform-height floor. `train-cab` also checks High/Low paint sections conserve the original shell surface without overlaps or protrusion, fully below-glass wiper pivots and smooth circular lenses. `train-cab` pins the mirrored A/B/C/L rake with unchanged rear seams, glazed A/B/L crew doors, small centred emblems, C evacuation-door clearance, windshield-fitted wipers on all five classes and High/Low geometry ownership.

`train-bogie` pins complete bogies on every A/B/C/D/L car, actual rail-crown contact in High/Low, inboard flanges, fixed cabin-floor clearance, suspension/brake details, authored Low budgets and geometry disposal. It runs in `test:perf`; `train-lod` pins the regenerated per-consist inventory.

`move` pins ground-exit attachment courses through hover and confirmation: Tanwei D's west-facing drop against `(33,37,4)`, course changes within the same storey anchor, preserved current settings, undo/redo, and a course-only move counting as an edit.

`catenary-model` covers flexible messenger sag, level contact at every seam/rotation/width, droppers, return wire, insulated registration arms, lattice portals, seated post/cleat/arm and upper-chord joints in every rotation, rigid tunnel/canopy fittings, crown clearance, authored Low contact/budgets and exactly-once disposal. It runs in `test:perf`.

`train-pantograph` also checks the broad downturned bow, tapered lower spine, upper fork, five-shed insulators, pivot/spring/bonding hardware, wire clearance and authored Low triangle budget.

`train-pantograph` and `module-build` pin the compact collector, short insulators, low arm angles, and common station/canopy/tunnel/bridge contact. `rail` pins the extra clear course, taller bores, resizing, power changes and idempotent legacy-shell upgrades.

# `game/test` — how the game is tested

`ceiling-cells` covers untagged horizontal ceiling detection in Tianhe Park,
preserved floor/wall/shape cases, explicit plate tags and upper-floor lining that
continues across a stair opening. `floor-geometry` checks its visibility in its own storey and chunk-seam invalidation on stair edits. `floor-geometry`
also checks the actual ceiling mesh pass and cache invalidation on support edits.

`tv-pair` pins the legal opposite-facing shared-cell rule, one shared housing and
two readable faces. `tv-double` checks the TV palette's 单面/双面 choices and
that 双面 previews and commits both opposite-facing screens as one undoable action.

`cab-front-surface` pins exact cab-skin intersections against the full raycaster
across widths, detail levels, both ends, shoulders and bucket seams, with bounded
triangle tests and no repeated shell reads. `train-preparation` matches the
prepared fleet to the real Zoo/Tanwei worker anchors, preserves the dormant-model
bound, reuses exact geometry/door rigs and correct paused/resume poses at first arrival, evicts changed configurations,
and guards latest-only train snapshots while the editor is suspended. Production
playback attribution lives in `tools/bench-sim-stalls.mjs`; FPS is diagnostic.
It also checks one spare per existing appearance within the eight-model bound,
new-platform reuse across yaw/door-side changes, and power-system invalidation.
`train-cab` checks exact curved-door cache reuse, independent geometry ownership
and bounded eviction. `floor-geometry` compares rail, shaft and furniture commits
with fresh meshes in all rotations, including street-window expansion and undo.
`equipment-retention` bounds envelope work on large tunnel edits; `exits` and
`ramp-surface` pin warm support/shape cache reuse and immutable-array invalidation.

`placement-surface` pins low-angle visible beam targeting ahead of distant ground,
fresh preview/click/move/undo agreement for supported props, one shared raycast,
nearer-block occlusion, hidden-source exclusion and unchanged unsupported-host
surface cells. `check-geometry-snapping.mjs` drives the same low-angle beam case
with real production pointer events across three editing bases.
The production check also verifies block, wall, rail and tunnel hover picks on the
visible beam instead of distant ground.

`geometry-snap` covers the geometry snapping audit: real rendered
ceiling contact and preview/commit/move/undo agreement across 360 slab cases,
off-grid wall/floor anchors independent of editing base, actual hanger suspension,
pillar/lift targeting across nominal boundaries and unchanged fixture anchors
when inserting suspended ceilings. `storey-height` also pins ordinary block preview
cache reuse, fixture collision refusal and preview/release agreement without relocation. Snap targets must never be inferred from storey bands.
The audit records the completed 199-check and 56-check focused instrumented runs,
per-module line/branch/function coverage, production browser checks and the
incomplete broad in-process coverage attempt.

`hanger` pins Tanwei's 11 m floor anchor for fresh and carried ceiling props,
both hanger mounts and all rotations, with/without a slab overhead. Preview,
click and undo agree while off-beam aiming keeps the general ceiling policy.

`delete-tool` also pins floor-triangle hover, deletion and undo beneath ceiling
cameras, clocks, lights, vents, signs and monitors, while direct model hits still
target and delete those fittings.

`delete-tool` pins Tanwei D's thin roof at `(33,45,9)`: a direct roof hit keeps
hover/delete priority over the road terrain behind it, with one undoable removal.

`equipment-retention` also checks that ceiling-mounted fixtures allocate no contact
shadow batches, while floor-mounted variants retain their shadows through edits.
Fixed PSD infill and elevated cover panels also allocate no contact shadows.
It checks that contact shadows draw only on the active
floor band, that Hide UI/cutaway restore every floor's shadows, and that Hide Ground
still hides street shadows. `level-slicing` pins shifted floor bands;
`passenger-lod` pins active-only shadow packing, paused layer/cutaway changes and
unchanged instance buffers in High and Low quality.

The settings-rebuild audit extends `population-edit` to headways, opening hours,
peak windows, demand curves and calendar settings. It pins normalized World
caches, dispatch-cadence adjustment without crowd/queue/RNG reset, immutable
history reuse, no-op edits and pending-build ordering (`worker-preview` and
`line-edit`). `tools/bench-settings-audit.mjs` drives production headway/curve
controls and checks first/repeated updates plus Undo/Redo for zero scene work.

`population-edit` guards the fail-closed population-only classifier, retained tool
geometry and immutable patches. `line-edit` checks compact worker messages and
Undo/Redo; `worker-preview` pins zero routing rebuilds, retained graph/crowd/queue
identity, updated spawn inputs, pending-build ordering and load cancellation.
`tools/bench-population-edit.mjs` drives first and repeated production slider edits.

`glass-panel` pins cold and repeated curtain/wall-glass collision checks against
2,048 remote fences with bounded document scans, exact turning-arm collisions,
same-tile curtain sharing and neighbour-index invalidation. It runs in `test:perf`.
`tools/bench-curtain-preview.mjs` measures first and repeated production pointer
hovers on Tanwei (or `BENCH_DEMO=zoo`), with CPU profiles under `.preview/perf/`.

`preview-pipeline` sweeps all 121 palette options for immutable preview documents
and exact geometry versus a merged candidate document. It covers candidate-only
TV/tactile/stair/glass/bridge neighbours, cached floor finishes, local ordered
equipment collision queries and broad imported pieces, material retention and
single disposal, multi-layer cancellation, 5,000-cell face previews, inactive-tool
ownership, and paint/zone latest-target scheduling with one release commit.
`preview-lod` compares all 121 tinted previews with placed-equipment batching at
High/Low, near/far, other-storey and Hide UI settings, preserves instanced-roof Low
geometry and exact High restoration, handles multi-material hover meshes, and
pins preview/commit glass height and refusal across every rotation and shifted
storey. Both run in `test:perf`.
`tools/bench-preview-audit.mjs` drives production model/hover/drag/move paths;
`tools/check-preview-lod.mjs` checks real wall picks, GPU-facing topology and
preview-to-placement agreement, saving screenshots under `.preview/perf/preview-audit/`.

Placement invalidation: `equipment-retention` sweeps all 121 palette options
against the remote catalogue, pins prepared tool occupancy and shadow-buffer
reuse/partial uploads/bounded capacity/exact disposal, and compares
incremental road/bridge/pillar/hanger geometry with fresh builds in both edit
directions. `worker-preview` pins deferred/coalesced topology updates, coherent
old-world ticks, no edit-induced tick, undo cancellation and load cancellation.
`scene-wiring` guards the chunk-preparation fast path; `calligraphy` guards
unchanged plate pixels across structural placements and repainting on rename.

`covered-clearance` checks that full PSD warnings, arrows and safety bands fit
the compact glass for every stock on both platform sides, with aligned bands
and clear space between stickers. `storey-height` pins the full-height screen's
2.35 m glazing, top-mounted 0.6 m information plate and absence of top padding.
`catenary-model` pins the roughly 10 cm covered/tunnel wire assembly below the
ceiling; `storey-height` checks 98% trains keep floor, wheels and collectors aligned.

`stock` pins D's four doorways per car and mirrored cab-end single-door widths.
`draw-batching` checks exactly two small panes in each of its three inter-door
bays per side, clear apertures and independent door banks in both travel directions.

`draw-batching` pins B's single windshield at both ends, three inset passenger
windows per side between four doorways in every car, unobstructed glass apertures,
and independent door-bank motion for both travel directions and consist sizes.

`module-build` compares actual PSD glass planes with bridge barriers, ground
barriers and both gantry models on both sides, at 3/4 m bed widths and every
rotation. `fence` checks that R-selected barrier sides survive line previews and
commits and that the collision envelope contains the offset model.

Ground-decor 隔音屏 shares the bridge profiles and the fence run gesture.
`fence` covers all three variants' floor contact, height/envelope, live preview,
line placement/right-delete, undo and save identity; `pick-tool` covers its palette
round-trip. `rail-families` and `rail-folders` pin the final ground-decor tile,
three-option family and full sound-barrier thumbnail default.

`module-build` checks raised bridge concrete meets all three barrier/railing
variants without a gap, preserves rail drainage and avoids gantry overlap.
`overground` pins the raised shoulders sharing the painted deck finish.

`module-build` checks bridge noise-barrier panels, rails and gantry uprights for
intersections, overlapping exposed faces and 3 mm glass-to-frame clearance, including both barrier heights,
both power types, repeated gantries and every quarter turn.
The same suite builds platform–bridge joins at both ends and every rotation,
checks barrier/glass clearance from the platform gantry, and restores the full
barrier when that platform changes to a canopy.

`train-art-pipeline` pins the bilingual train sheets: five classes in shared order,
animated D door details, eight-car D figures and capture bounds inside each canvas,
plus stock-default capture power across car, side, front and detail frames.
Sheet 05 also keeps every animated front/side pose inside its own stock card,
with bottom padding so later row backgrounds cannot cover the wheels.

`psd-header` pins independent directional terminal matching, platform-facing arrows,
bilingual station/terminal printing, schematic routes and the lower line-colour band.
`module-build` also checks mixed D door widths against the matching full/half-height
platform openings. `stock` pins narrow cab-end doors and wider paired doorways.
`module-build` and `psd-end` pin the taller fascia, shorter full-height glazing, and
the amber oval lamp centred below each doorway plaque. `psd-end` also covers the
white one metre 屏蔽门盖板, full-run and one-tile ground placement, direct end-door sizing,
and vertical stacking with preserved width/depth and save/load.
`batching-lifecycle` pins cover targeting through end-door seams, nearer-wall occlusion,
and hidden-storey exclusion; `psd-end` checks hover/click agreement without a floor hit.
Its real snapped-corner regression places beside an already covered PSD in the same
tile, checks fitted model/collision bounds and duplicate support handling, and clears both
endpoints and track sides in every rotation. Clicking an existing cover itself must preview
and commit the next course with the same dimensions.

`autosave.test.mjs` covers dirty-only local saves, undo/redo, immediate new/import/demo
replacement, invalid saved data, quota failures and retries.

`level-view-cache.test.mjs` covers 1,024-module Q/E batch reuse without source
traversal, four-view eviction, exact disposal, transform/appearance/clip invalidation,
and move masking after cache restoration. It also pins prewarming both five-metre
neighbours of the edited storey (shifted bases and boundary storeys included),
retained grid allocations on Q/E, and grid disposal/rebuild on bounds changes.
`tools/bench-level-switch.mjs` drives real
Q/E input on both demos, including the first press; `--uncached` provides a paired
baseline, `--baseline` records a pre-fix opening-cache miss without suppressing
render/correctness assertions, and `--no-multi-draw` checks the fallback renderer.

`geometry-detail.test.mjs` covers generated fixture approximations, original
attributes/indices, complete near restoration, fixed allocation identity for
opaque instances/merged meshes and sorted ghost batches, orthographic zoom,
disposal, UV attributes, alpha-cut exclusions and moving rigs. `floor-geometry`
pins chunk picking against full source geometry and train rig/restoration/disposal.
It also covers unbatched moving equipment, hidden/batched-source exclusions and
source-owned approximation disposal.
`module-build` checks the urinal cavity at both detail levels and its bounds in all rotations; `move`, `placement`, `performance-policy` and `worker-preview` pin wall support, movement and skipped routing rebuilds.
`model-detail.test.mjs` sweeps every palette option: models above ten triangles
must have a nonempty, smaller Low variant before and after batching, with restored
source geometry. Every option also meets a strict <10% target or its explicit
minimum-shape cap in `tools/equipment-low-budgets.mjs`. Low retains every real stair
tread and riser, their full extent and both end heights; folded exit glazing meets
the Low canopy, and merged open-exit pads retain all floor/wellway samples in four
rotations. Printed monitor artwork retains High vectors at any distance, switches
coherently through global batches and Hide UI, and owns one bounded texture.
`npm run check:equipment-lod` renders all 122 options at both qualities, checks actual
GPU submissions/blank pixels and global monitor/open-exit batches, and saves contact sheets. Conservative Near/Low bounds are pinned for instanced, merged and transparent batches, including frustum visibility outside the original source bounds. Local batches preserve and isolate coherent detail metadata.
Primitive panels also pin UVs, exact edge picks, cached swaps and
single disposal. It covers authored Low triangle budgets for all shelf,
restroom, CCTV, cabinet, AC, tactile, track, ramp, lift and stair models; exact
instanced stock picks, retained motion/geometry, painted finishes, local/cross-model
batching, Hide UI restoration and single disposal. Clock Low keeps two animated,
readable faces and exact picking; static-rendering pins the far-tree triangle budget.
Furniture, extinguisher, exit, gate and fence variants have Low budgets; joined
fences, both panel faces, combined-fitting bounds and doorless gates in all rotations
are covered. Gate leaves retain their live motion and entry-direction artwork.
Rail signals keep three visible aspects and exact lens picks. Noise-barrier Low
variants cover every rotation plus long shared bridge runs, gantry/post cutouts,
glazing bounds, batching and full restoration.
Beam approximations retain four side faces and exact source end-cap picks on all axes.
It runs in `test:perf`.
`graphics-quality` pins floor/presentation policy and preference persistence without
document edits. `static-rendering` also pins all three
tree levels, canopy bounds, leaf UVs and exact disposal. Production
`tools/check-geometry-detail.mjs` drives first/repeated real wheel zoom on both
demos, checks restored triangles/batch identities and captures screenshots;
`--no-multi-draw` covers the fallback path. It also checks the live settings menu,
quality controls, opposite-language labels, Escape and full Hide UI geometry.

`sky.test.mjs` pins hidden-UI sky brightness through dawn, daylight, dusk and night,
including daily wrapping, backward clock seeks and midnight continuity. Since the Node
suite does not exercise WebGL, check scene integration in a browser when changing it.

`tutorial.test.mjs` covers empty, paused startup at ground level and the tutorial's
local-storage progress/opt-out, including corrupted, stale and blocked storage.
Run `npm run check:tutorial` from the repo root for the separate production-browser
regression: bilingual layout, first-card language switching and localized Music
pause/resume control with its icon, row alignment and persisted shared pause state, separate shortcut
keycaps, live keyboard/mouse controls, tool-only activation before revealing the
construction area, new-line expansion, whole-folder highlighting/scrolling, and
reload/skip/completion/opt-out/reopening. It uses Chrome or Edge and saves its
report/screenshots under ignored `.preview/tutorial/`. These UI checks do not
contribute to the Node suite's V8 coverage figures.

`roof-tool` pins stair-block previews without placement validation or document edits;
release validates the run and commits only accepted tiles once.
`roof-preview` pins exact instanced roof geometry/rotation for all roof variants,
all 10,000 tiles in bounded 16 m/storey buckets sharing one geometry, and exact geometry/instance-buffer disposal. `roof-tool`
also guards bulk roof release against per-tile collision-cache preparation.
`frame-preview` guards continuous latest-target previews without resetting the
frame wait, cancellation and duplicate-target reuse; `solid-cell-index` guards
the roof's indexed floor collision candidates and immutable invalidation.
`preview-material-cache` guards shader-owner reuse across roof targets, refusal
tints, source ownership, clipping refresh, bounded eviction and disposal.
It also checks a 1,334-module station produces one mouse-down raycast for both
an empty hit and a hit on the final module, preserving the chosen anchor.
`block-collision-cache` guards remembered cell verdicts across growing/shrinking
blocked drags, zero rescans of unrelated modules, immutable snapshot invalidation,
bounded verdict retention, and exact blocker identity/order against the original
geometry scan on both demo stations. `blocktool` also guards immediate red cursor
witness reuse across growing/unchanged rectangles, clearing the witness, Shift
lines, and immutable blocker removal.
`multi-place-drag` covers the shared equipment/decor limit, context-scoped
ownership, 50 ms non-starving latest-target preview scheduling and cancellation, plus whole
refusal for fence, tactile, wall, outdoor-tile and road drags over 10,000 cells.
It also guards geometry-identity invalidation of both preview schedulers when an
edit/undo leaves `stationEpoch` and the pointer key unchanged.
`multi-place-drag` also drives accepted block, wall, fence, tactile, stair-block,
sidewalk, lawn and road movement through one 50 ms timer, keeps the previous
preview visible, reuses unchanged targets and cancels pending work on release.
`roof-preview` additionally guards sparse block-ghost candidate visits against
full chunk-volume scans and compares their exact geometry with the chunk mesher, including ramp filling above pending cells.
`equipment-placement-input` guards one scene pick per event for tactile placement,
floor-mark deletion and exit snapping with large-document misses and late hits.
It also pins bridge snapping across visible track/screen surfaces above lower floors,
outer platform cells, both ends and all rotations, with matching preview/click.

`batching-lifecycle` also pins move pickup/cancel retaining batch allocations and
restoring neighbour rendering. `performance-policy` pins immutable collision-body
cache invalidation; `draw-batching` pins 16 m High / 64 m Low equipment batch
boundaries, original source picking IDs and unaffected batch allocation retention,
and checks repeated services reuse train geometry
with an eight-dormant-consist bound and exact disposal on eviction. `passenger-library`
checks the native base64 decoder and the compatibility path preserve every byte.

`train-pantograph` covers all five overhead-wire variants, mirrored inward cab-car
placement at every rotation and direction, contact-wire height, one-car placement,
third-rail absence, worker power flags, door-mask isolation and cached power changes.
`train-lod` pins the published full triangle count of every consist (asset integrity),
its 10% Low budget for all five stocks, one through eight cars and both power systems
through the real TrainSystem path, one prepared swap per drawn piece
with full sources kept, door-bank and sorted-glass geometry swaps under Low, the
authored parts a passenger still recognizes (straps, ring lights, benches, bellows,
D plug doors), the `TRAIN_DETAIL_MAX_RADIUS` guard that keeps a consist-wide merged
mesh out of the relative-error simplifier, and batching carrying both variants.
Door apertures and hollow strap loops must remain visible from both sides.
`passenger-lod` pins a hard 10% Low triangle budget for every appearance and the
shared padded draw, each Low vertex's membership in its source appearance, flat
palette boundaries, and exact silhouette bounds/ground contact in all 73 poses.
Projected-surface coverage at standing and four phases per gait catches missing
limbs that isolated extremum triangles could hide from a bounds-only check.
It also checks that offline reduction leaves the source topology and poses intact;
`tools/check-passenger-lod.mjs` compares production High/Low renders for every
eligible appearance and age, all three gaits and three views, saving the worst
silhouette pairs for review. Node bounds alone cannot detect missing body surfaces.
The suite retains
the baked Low topology (every variant, padded the same way), the
coarser body's unchanged shader contract and silhouette, one shared pose atlas with a
separate index table and 70% High / 45% Low opacity, the per-storey split (the edited storey full, a ghosted storey
reduced, one draw when the crowd shares the edited storey), 低画质/隐藏UI, the recorded
`passengerLevel` attribute, pause and clipping of both draws, and single shared-atlas
disposal.

`draw-batching` covers reflection winding and rays, actual train door-bank and glass
transforms, buffer disposal, equipment instance/merge/sort paths, original module
picking IDs, local allocation reuse and visibility, live atlas UVs/repaints, rig
exclusions and legacy/explicit passenger age metadata compatibility.
Live-panel cases pin one guttered upload per frame, fair latest-pixel refresh,
stable UVs, removal/reuse, CPU restore pixels and no static-page invalidation.
`scene-wiring` pins demand frames that finish the queue after pause.
`node tools/check-panel-atlas.mjs` separately checks actual GPU pixels, colour,
orientation, gutters and reallocation against the retained CPU image.

`batching-lifecycle` covers atlas-backed equipment without source UV mutation,
revision reuse/disable/re-enable, exact geometry/buffer/texture ownership, material
and culling boundaries, unsupported/hidden/deforming mesh exclusions, nested landing
doors/cabins and real ModuleSystem/LevelSystem hide/ghost/cut transitions. Its camera
rays reject invisible nested surfaces and hidden storey roots; `delete-tool`, `move`,
`pick-tool` and `select-agent` pin the corresponding pointer-tool behavior and ensure
cell fallbacks do not resolve a module hidden by the active level slice.
`draw-batching` exercises A/B/C/D/L stock in all four track rotations and compares
exact submitted geometry, then drives TrainSystem pause/hide/resume/eviction.
It pins L's single cab windshield, small end windows, two broad inter-door panes
per side, real glazing apertures, unchanged shell and independent door banks.
It also checks D cab bounds, slim central shield proportions, broad line-color
coverage down the front, four-sided side windows
and lamps with finite end edges, close windshield spacing, both shared boundary
curves continuing across window/lamp/accent gaps, shared inner-edge clipping to
the black mask for panes, lamps, housings and accents, elliptical surround outlines in plan,
absence of a rectangular rear band, short rear pane edges, detail-to-shell ray
distances, joined cab/car shoulder rays, rounded car roof/sill bounds, a narrow
flat crown and a lowered skirt, smooth panel tangents, paired upper marker
lights and brow, low nose, U trim, absence of extra cab doors, small passenger panes,
paired passenger-door motion with only single cab-end doors, stationary corner
closure rays, extended cab-side paint, and exact carriage/cab paint-edge joins,
enclosed gangway side/roof ray hits, a shared cab/car crown,
dedicated car shells, mixed seating, door counts and independent plug-door
banks. `stock` pins the D dimensions, eight-car capacities and mirrored 3/4-door
layout; `trains` checks L and D screen alignment in both directions at all rotations,
and that a consist runs its whole connected rail, in from beyond the entrance tunnel
and out through the far end.

Run `npm run test:perf` from the repository root for renderer, stair/roof input,
equipment picking, passenger binary/pose and placement/worker/crowd/frame/sign
coverage. The performance runner isolates files with two concurrent test processes, bounding
the lifetime of retained model/atlas fixtures and coverage state. Global test
fixtures must still be restored between cases within each file.
Coverage flags precede test paths; appending `--experimental-test-coverage` after the npm test glob does not measure
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
equipment model retention for functional edits and owned-material retention/disposal,
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

`ceiling-decor` pins shared ceiling-support index reuse without warm station-array scans, invalidation on cell/module replacement and undo. It also pins explicit underground ceiling anchors beneath 0 m and
−5 m, with physical slabs or the virtual ground plane and a taller fallback.

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
It also pins the shipped files themselves as clean under the zone rule: no ceiling
plate (吊顶 or shaft plate) carries a zone or room label, and the load path has
nothing to clean in either demo. `stairs` also pins size labels and Tab cycling
for explicit fitted widths.

`psd-end` checks that screens, snapped corners and continuations fit below their
overhead blocks, match their reserved height, and still refuse blocks inside extensions.
It also checks both screen heights and every snapped orientation for competing
coplanar fitting faces after trimming and overlap with the screen housing at the
corner joint, while preserving the snapped glass plane. Fascia/cap joints must
also close without a clearance slit; rays through exposed PSD ends must not
hit duplicate faces, and moving leaf fittings retain their full geometry.

`trains` checks stopped train centres and every screen-door opening in all four
track rotations and both directions, using the four-car, 68 m Line 6 layout. It
also grows a tunnel off each end of a platform rail and pins the run: the consist
is drawn in from beyond the entrance tunnel's outer end and out until its tail
clears the far (exit) tunnel end, and only ever runs forward.

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
reserve an entire shared shaft. `placement` also pins that escalator support is required only at its lower landing, not across the incline's full projected footprint. `escalators` also pins the inspector's selected-run direction switch and its undo: travel reverses
by swapping `from`/`to` together with `cfg.dir`. `escalators` and `module-build` also pin the
two- and three-block-wide escalators: their continuous
moving band, outer rails, rotated footprint, landing support and per-column openings, at every
single/double/triple span as well as every rotation and direction.
They also check seamless glass filling both rounded handrail returns at either end,
for narrow/wide/extra-wide escalators in every rotation and travel direction; the glass stays
inside the rail curve and makes one pane per side. The wider metal shoulders, flattening
risers and covered step return are checked too;
`slope-cut` checks the recessed upper landing beneath the terminal deck.
`ramp-block-placement` pins the reported Tianhe stair wedges, including a multi-storey
中直跑楼梯's interior landing: the ground beside a mid-storey platform follows the
flight's sloped soffit, while the flight standing on the stair's outer lower landing
keeps the base-plane clamp that holds the floor block level.
`module-build` also checks floor/apron clearance and the body's inset, buried joins.
It pins train roof/body paint and non-overlapping cab seams, plus half-height screen-door caps
that slide clear with their leaves. `train-cabin` pins spawning at the stopped berth
before opening, and clearing riders after the doors have closed on the closing phase
while the train is still stationary. `train-gangway` pins the
black bellows an A/B/C/L consist wears in every gap between two cars: the car's own section
scaled by one factor (same shape, lightly smaller), strictly inside the car's skin, one mesh for
the whole consist, corrugated, and D keeping its own curved gangway.
`module-build` also checks clear train-door window apertures and screen-door slide-lane clearance
for both screen heights, both track sides, and closed, partial and fully open poses.
It also pins the slim half-height rails, cap/rail vertical separation, single glass surfaces,
reference cabin fittings, and train interpolation between snapshots including early updates and reappearance.
It pins the 地面 X向 exit header's full-width red fill and unchanged font sizes as wider bays add spacing between text blocks.
`three-storey-ramps` checks every 12–16 m triple-family size across escalators and all stair shapes/rotations, the 15 m default, endpoint-derived span/length, straight-stair placement and exit-bay snap in all three families, the stair span cycle, and the tile's three planes with exactly one highlighted. Focused coverage with `escalator-length`, `escalators` and `stairs` passes 66 tests; it measures `sim/rampLengths.ts` at 100 % lines / 96.88 % branches.
`escalator-length` checks the run families — the one-floor 超短 2 m / 短 3 m / 中 4 m / 长 5 m /
超长 6 m for the 扶梯 and every staircase, the 双层 7–11 m and 三层 12–16 m families for stairs and escalators
— in every width, rotation and direction, each with its own passage, landing graph nodes, ride
time, exit snap (a stair as well as a 扶梯), preview refresh, move, save round-trip and drawn
model, with endpoint-derived sizes saves reading back in each family, contiguous 6/7 m and 11/12 m
boundaries, 10 m / 15 m double- and triple-storey defaults, and the five-metre grid's strict 30° runs pinned;
`pick-tool` checks copying a run's length and span and restoring the previous ones with Esc,
and the same for a **自动步道**'s level length, width and direction.
`walkways` checks the escalator's flat twin: the three level lengths 短 30 m / 中 60 m /
长 90 m in every rotation, direction and width; the wide / extra-wide belt's centring being
direction-independent; the belt's interior cells not being walkable while both
landings are (a step-free passenger is carried too); the lane-scaled rates and
1.84 m/s ride; placement carving nothing (every belt cell keeps its floor, and all
of them are required); the block brush reserving the plan; move/rebuild, the
preview-key and ghost-key identity; the save round trip; and the shared flat model's own span.
`ramp-join` checks shared metal caps between escalators and stair-escalator pairs,
including wide pieces, rotation, reversed travel, single seam ownership and neighbour removal —
and that a bank fills its seam at every one of the four lengths while two differing lengths never
share one. Two parallel escalators one empty block apart bridge the gap with the widened cap, while
a run crossing the seam, a wider void and a non-flush stair grow none; a run that shares the lane
but ends beyond one landing (the saved 天河公园 pair) does not suppress the cap. A floor course above two cleared shaft cells permits the cap even while adjacent upper-floor cells are still present during preview. Stairs, other modules and solid blocks crossing the sloped span suppress the connector, while blocks below it do not.
It also checks the closed end shells, the flush cap's single centreline row and the widened cap's
two evenly spaced columns of double-size hemispheres, all seated on the metal cap.
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
equipment tool's ghost carrying the same piece the factory builds, the whole square left out
of the document and walked as the stair's **virtual** landing, its 0.5 m model slab at half
the chosen rise, a legacy landing block cleaned up with the stair, and a piece saved at an
older off-grid width keeping its band and its single corner cell.
`module-build` checks continuous full-width treads and glass beneath outer stair rails and returns,
including exact 1/2/3-block outer bounds in every rotation,
plus medium/wide straight-flight offsets along the block side in all rotations and unchanged legacy
off-grid centrelines. It also measures a 90° turn's **drawn** platform against the block square
the landing covers — whole cells along the departing leg, the band's rails `STAIR_RAIL_PROUD`
inside on the other axis — in both hands, all three sizes and all four rotations, so the model
cannot draw a landing the sim does not walk. `move` carries that square with the piece: every
cell of a 中 turn's 4-cell landing goes with it and comes back laid at the new cell.

The `shelf` suite also pins tall/short, wire and cooler variants, their save/preview/sweep identity, rotated model bounds, ceiling clearance and cooler shell and tall/short gondola plinth/trim separation to prevent flickering.

`ramp-passengers` covers single-file narrow ramps and one spaced column per extra
plan block on wider ramps; same-tick boarding and wide / extra-wide escalator throughput; swept collision clearance;
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

`crowd-routing.test.mjs` covers committed walkers choosing clearer floor around a crowd,
preserving their itinerary and cached peers, narrow-corridor access, service boundaries,
the cooldown, the initial wave's search budget and deterministic replay.

`walking-space.test.mjs` covers stable lanes across corridor width, real passenger
progress and occupied rows, single-width access, whole-segment hole/fare clearance,
platform waiting cells and depth, paired PSD queue slots with a clear alighting aisle,
PSD collision recovery, walking to an open door, and counting approaching passengers
when balancing door choices. It also exercises sustained pressure on unqueued
walkers at every Tanwei platform bank, edge-parallel sliding, both sides at all
four rotations, and removal of the floor constraint after a graph rebuild.

`history.test.mjs` covers the run's minute-by-minute record (§8.1, the 数据 window): one
sample a sim minute rather than one a tick, the letter stored as its LOS order, the first
sample's per-minute columns as a **baseline** rather than the run so far, climbing counters
whose minutes add up to the total, the world starting the record over on load / restart /
seek, the app appending each posted minute (its buffer growing without moving an index) or
replacing the lot on a reset, and the chart axes — the round-number ceiling and the
class axis drawn the way the letter reads, A at the top and F at the bottom.

`module-build` checks lift landing doors at each level (a story's base), independent car doors,
synchronized opening only at the aligned landing in both styles and all rotations, and the
1 cm sink that keeps the drawn top cap out of the slab above.

`menu-thumbnails.test.mjs` checks that each `MODULE_OPTIONS` id has a generated 132 × 132 PNG
and that the rail uses lazy static image URLs rather than the runtime WebGL thumbnail pass.

`test/support/` holds the shared harnesses — the only files here that are not
`*.test.mjs`:

| File | What it is |
|---|---|
| `support/scenario-station.ts` | The hand-built **Wusi Square** rig the sim suites use as a controlled station (the shipped 动物园 save is `src/data/demo-station.json`, loaded by `demo.test.mjs`). |
| `support/stub-canvas.mjs` | A recording 2D context: every fill, stroke, word (with its size and ink colour) and drawn image is kept, so a "does this print pixels" test asserts **what** a plate says, not that it did not throw. |
| `support/pictograms.mjs` | The 指示牌 pictogram PNGs off disk, for the sign render tests. |
| `support/camera-rig.mjs` | A live `CameraSystem` with no canvas and no GL: a plain three.js camera plus a DOM-shaped stub for `OrbitControls` to attach to, for the widget's camera tests (`camera-vertical-pan`, `camera-fov`, `camera-orbit`), including screen-relative WASD at the plan-view pole. |

`fence` also checks the glass/gate/iron variants, legacy saves, variant previews and drag placement,
raised gate clearance, eight iron uprights, ground decals in either placement order, deletion that
leaves the ground decal intact, and the far lane of the Tanwei right-turn stair's upper rail joining
the fence at `(39,36,6)`.

`fence-preview` covers 1,024 unrelated fences with no remote preview rebuilds,
document scans or equipment-batch allocations; only orthogonal same-height joints
change. It compares local replacement geometry against a complete build, pins
gate/ramp connection-index equivalence and immutable invalidation, and checks a
hover's own candidate joint without copying the document. It also pins local bucket
masking: the replaced joint's bucket is hidden while an unreplaced member of that
bucket keeps drawing from its source, and cancel restores every source's batch layer.
Cancel, view changes, hidden storeys, ghost materials, clipping and exact disposal
are covered too. `tools/bench-fence-drag.mjs` measures the real production pointer
sequence, including the first press, first/continued movement, cancellation and release.

`equipment-retention` covers additions/deletions/moves with 1,024 unrelated models,
functional routing versus render-only chunk skipping, coupled glass/door/cubicle/TV/
fence/gate/hanger dependencies, structural family invalidation, combined module/cell
edits and unknown types.
It compares locally rebuilt geometry against a fresh build, checks real ModuleSystem
allocation ownership, and pins cached move removal and ordinary hover indexes.
Both suites run in `test:perf`. Production first-placement measurements use
`tools/bench-tree-placement.mjs` with `BENCH_EQUIPMENT_FIXTURE=1` and distinct outputs.

`booth-model` checks the information counter's accessible notch, the ticket kiosk's
transfer openings, open overhead frames without built-in banners, editable sign placement in
both booth types, footprint bounds and translation, plus the desktop facing each of four fronts.
`zonetool` checks 商店 / 厕所 / 办公室 as ordinary room-color floor labels: their tile icons stay,
fare-zone values survive, and painting adds no room module or wall; it also checks the booth's live
rotated 3D drag preview and release, and that a counter anchors to the block under the pointer — a
raised slab, or the foot of a wall course — rather than to the active storey, while an open-air
press keeps the edited storey. `zones` pins room-color overlay regions without module-name
labels, and that only real floor takes a zone: a ceiling plate — the 吊顶 brush's tile or
the `opening-ceiling` plate a ramp carve leaves over its shaft — stays out of the brush and
the overlay even where its own top face is the only exposed one, and the load path drops a
zone or room label a save already carries there, because no overlay would draw it and the
无分区 brush cannot reach it (`clearCeilingZoneLabels`). `facility` checks the
staff benches remain opposite the selected front. `sign-render` covers the reusable
customer-service pictogram.
`booth-sign` checks wall signs snapping to either booth's header, all four faces,
centred geometry and collision bounds, saving, moving and missing support. The snapped
booth is the one the pointer **picked** (so a grazing surface point, or the board already
on the face, still means that booth), and a board wider than the header is refused as
`booth-width` with its own notice rather than as a missing wall.
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
thick-pillar one continuous shaft with end-only collars, periodic obsidian pixels, and material roughness.

| Area | Files |
|---|---|
| Local editor commits | `walls` pins edited wall-height ownership and explicit full repair; `ground` pins exact pavement resizing/fractional fallback, independently generated cache equivalence and caller-owned arrays; `floor-geometry` compares bounded pavement templates with the uncached mesher across growth/shrink, holes, ramps and supports and preserves separate chunk/storey ownership. `move` pins exact preview-verdict reuse and invalidation; `equipment-retention` pins guidepost ink/geometry, selection resources, retained rail inputs and walkway band phase; `render-performance` pins one cap AO query with identical colours; `level-view-cache` pins scene-lifetime grid materials. `node tools/check-editor-move-caches.mjs` separately checks production drop/undo/redo GPU parity against forced fresh aggregation. |
| Authored road nodes | `road-document.test.mjs` — segment splits, shared-node lifetime, legacy migration, duplicate/elevation rules, width merges, snapped starts keeping the selected width/direction, save/undo, node input, hidden/refused pieces and node-buffer ownership. |
| Road vehicle models | `road-vehicles.test.mjs` — six silhouettes at both detail levels, Low at most 10% of High, fixed High counts, outward fittings at both details, grayscale, 70% High / 45% Low opacity, depth prepass, seeded variant packing, quality switching, pause and disposal. Production GPU views/counts: `tools/check-road-vehicles.mjs`. |
| Road network and traffic | `road-network.test.mjs` — crossings/T joins, a crossing on every junction side whatever the one-way setting, directed turns, bounded topology cache/vehicle capacity, signals, lane gaps, bus tail reservations, clock seeks, derived facilities and traffic-light decor; right-hand rotations, lane-specific turns/T splits, preview arrows and incoming-only stop lines. |
| Elevator doors | `lift-doors.test.mjs` — per-level front/back/both/none choices, landing geometry, two-track telescoping cabin/landing panels and bounded opening travel (`module-build`), graph stops and ride edges, render-facing snapshot, and save round trip. `check:info-panel` covers the browser dialog and per-level undo. |
| Elevator floor intervals | `lift-interval.test.mjs` — the 超短 3 m / 短 4 m / 中 5 m / 长 6 m / 超长 7 m 层高 tile (named by rung only; the metres live in the mark), a 5 m default, one-story fresh pieces, uneven stacking on both sides, exact mixed-shaft levels, the graph's one-car edges, ghost/preview keys, save round trip, and a drawn shaft exactly the stacked stories (a 5 m piece is 5 m) closed by a cap at each end, with landing portals at every level and glazing on the door side. |
| Elevator extension snap | `lift-extension.test.mjs` — `liftAt` reads the shaft's own plan (2 × 2 小, 3 × 3 大) instead of the first envelope that covers the cell, so a canopy or a run envelope cannot shadow it in either document order; the hover and its release grow the same shaft; and a batched lift's shaft answers `CameraSystem.pick` above the cabin/doors, with the ray's source layer restored afterwards. |
| Elevator plan size | `lift-size.test.mjs` — the 小 2 × 2 piece stores no size while the 大 3 × 3 piece stores `cfg.size: 3`; nine-cell support and collision reservations; a three-cell landing row on each face; nine cabin cells excluded from the walk graph; a rider pinned inside the 2.25 m car; save/load and legacy default; the 大/小 action tile and the editor-action manifest. |
| Architecture | `layering`, `scene-wiring` — the sibling-wiring guard, and the `setStation` boards-only/equipment fast paths: one-sign verdict, chunk-only equipment classification independent of worker routing, chunk remesh skipped, station-wide plate repaints kept on the full path |
| Numbers | `rng`, `clock`, `demand`, `headway`, `history` |
| 屏蔽端门 | `psd-end` — fixed glass stack, matching heights, Tab preview refresh, shortened corner snapping and exact 1 m extensions, tile-contained meshes/reservations and adjacent block/equipment placement, hover/click placement and undo; `psd-end-cover` spans a picked PSD run, resolves same-footprint levels by picked module or ground z, places one tile from ground or a picked end door, previews the same snap, stacks upward, and saves/loads; curtain-wall widths and picking |
| The crowd and the graph | `determinism`, `capacity`, `demo`, `gates`, `gate-door`, `zones` (room-purpose overlay regions preserve fare-zone values; synthetic track floors follow rotated `trackCells` footprints, not unrotated bounds), `lift`, `lift-interval`, `lift-size`, `placement` (stair shapes require only foot-level ground; escalator collision clearance follows its sloped body), `openings`, `stairs`, `escalators`, `escalator-length`, `three-storey-ramps` (the one-floor, 双层 and 三层 run families on the 扶梯 and every staircase, including 6/7 m and 11/12 m family boundaries, straight-stair placement and snap, three-span rail control and layer highlight), strict 30° five-metre runs, carve, landing nodes, ride time, exit snap, save round-trip, both drawn models, the catalogue's fallbacks and the one armed length a bank is built at), `ramp-passengers` (ramp lane spacing, body clearance, collision recovery, stair-turn access and queue-preserving detours), `slope-cut`, `ramp-fill`, `trains`, `train-cabin`, `train-interior` (raised route boards, continuous ceiling and aisle sightlines in High/Low), `stock`, `load`, `agent-route` (including the 1.5 m figure scale), `worker-preview`, `wayfinding` — `gates`, `zones` and `wayfinding` force `zoneBarriers: true`, because §4.5's fare line is off by default (`ZONE_LINES_BLOCK`) while the demo's zone paint is unfinished; `train-cabin` is the cabin the crowd rides in and `worker-preview` the worker path that must not step the sim to show a route |
| The document and its edits | `save`, `grid`, `pick-cell`, `ground`, `walls`, `halfwall`, `triangle` (wedge paint and adjacent cap material), `blocktool` (10,000-cell drag cap, whole-footprint refusal with an all-red preview and auto-wall total), `zonetool` (ordinary room-color labels add no walls/modules and preserve fare zones; rotated booth drag preview and release; right-click taps and drags erase labels like 无分区 while preserving floor), `facility` (legacy footprint-module helpers and booth fronts/benches), `fence`, `storey`, `storey-height`, `exits`, `bay`, `surfaces`, `rail` (virtual street footing at z = 0, derived bed openings that restore after removal, refusal on dug ground, tunnel / bridge snapping from exposed platform and 屏蔽门 cells with left/right end selection by hovered half, and width updates with stock), `track-third-rail` (the 第三轨 travel-right side in tunnels/bridges, travel-left platform fallback, off-platform screen-door selection and drawn placement), `validation`, `overground`, `roof-tool`, `track-run-length`, `structures-gaps` — `storey` checks the 0–4 m base offset within a 5 m storey and `save` checks its persistence, plus opening a save on the basis floor (or the lowest user placement) without the worker's 0 m ground level resetting it; `storey-height` is the single five-metre profile through level controls, stairs, lifts, escalators, suspended ceilings, hung decor and scaled rolling stock; `overground` + `roof-tool` are the pillars/roofs/doorway-exits/stair-blocks/bridges, `track-run-length` the shared tunnel/bridge lengths, `structures-gaps` the repair-shaped edges; `ground` is the city's own floor: the plane at `z = 0` is stored **inverted** (`sim/ground.ts`), so it owns the window `withGround` materialises, the dig that records a hole, re-adding default ground without a record, and authored paint/zone persistence |
| The furniture and the decor | `hanger`, `shelf`, `desk`, `checkout` (shop placement, saves, rotated bounds, screen/stock visibility and workstation chair), `restroom`, `bench`, `vending`, `decor`, `ceiling-decor`, `lights`, `vent`, `floor-decor`, `street-decor`, `sign`, `sign-model`, `sign-editor` (including rejection before hover insertion, and a live drag that defers the scene redraw to a scheduled trailing sync the drop flushes once, evaluated once per frame), `billboard` (WebP headers, compact sizes, panel filling, shared per-poster materials and per-size geometry), `glass-panel` (including fitted doors and edge decor backed against a curtain), `door-panel` (both-face handles), `calligraphy`, `line-map`, `booth-model`, `room-model` |
| Passenger activities | `passenger-activities` — full service ownership, queue advance, front access, multiple seats, concourse errands from street entrances, unreachable/deleted stops, toilet/sink sequencing, walking gate taps, selective lift presses and deterministic stream packing. `passenger-activity-assets` — actual export hashes and complete catalogue, shared skin weights, flat palette faces, existing High/Low strides and 10% budgets, up/down/narrow/wide rail reach across adult heights, forward elbows and neutral wrists. Production GPU, adult/child and pause captures use `tools/check-game-passenger-activities.mjs`; seeded service/tick diagnostics use `tools/bench-passenger-activities.mjs`. |
| Passenger library | `passenger-library` — all 232 approved variants with ten hairstyles per sex, including eighteen small backpacks, equal selection within adult/child pools independent of size/speed, every walk on every model, pack presence/absence, valid padded topology, single instanced draw and atlas disposal; `passenger-lod` pins the baked Low topology, the second prepared crowd draw, the 低画质/隐藏UI switch, pause and shared-atlas disposal; `passenger-size` pins the 20% child population, small-backpack/crossbody/bagless non-bald child pool, independent 80–120% height, 90–110% adult horizontal variation and 80–90% child horizontal variation, stable identity and body/shadow matrices; `passenger-view` retains identity, ground contact, flat greys, 70% crowd opacity, pause, picking and eye view. |
| The models | `module-build` (including slab-track sleepers, seats, clips and rail heads; shared contact-wire height across station/tunnel/bridge models, stock-aware portal clearance, bridge barrier posts omitted at catenary gantry uprights, enclosed double bins, hopper face winding, sealed full-height PSDs and moving decals), `restroom-model` (three-sided cubicles, privacy doors, flush joins, shared partitions, rotations, previews and neighbour removal), `lift-style`, `psd-decals`, `ramp-join` (the shared seam at every run length, the widened one-block span, and never between two differing lengths), `tv-screen`, `tv-pair` |
| Touch navigation | `touch-zoom` — pinch direction, cancellation and release suppression; shared zoom and limits in both projections |
| The scene | `chunk-cache`, `level-slicing`, `grid-visibility`, `ground-visibility`, `section`, `section-drag`, `cut-clipping`, `floor-surface`, `render-performance`, `camera-vertical-pan`, `camera-fov`, `camera-orbit`, `view-home`, `refused-ghost`, `sim-pause` — `render-performance` pins static module batching and safe reuse after floor paint; `ground-visibility` covers the street mesh, placed outdoor tiles/roads/traffic lights and ambient cars under 隐藏地面; `sim-pause` is the paused-sim freeze: escalator bands, 闸机 leaves and train/screen doors hold their pose while consists glide to their latest snapshot |
| Performance policy | `static-rendering` (outdoor chunk instances, transparent ordering, LOD retention/disposal and framebuffer wakeups), `outdoor-surfaces` (bulk edits, indexed support, refusals and shared geometry), `equipment-retention`, `fence-preview`, `performance-policy`, `worker-preview` — placement index equivalence/cache invalidation, cosmetic edits and graph rebuilds, equipment model dependencies (fence/gate/tactile, glass/door, cubicle, TV, hanger, track/pillar, ramp/exit and PSD families), render-only chunk classification, prepared hover documents, local fence previews and bucket masking, material disposal, pointer coalescing, crowd upload ranges/culling, retained rigs and train shell batching |
| The pixels | `sign-render` (short 0.4 m signs, nine-arrow capacity and centred existing content, primary-only labels at twice the size and centred on both axes in a square tile, the divider line and the blank divider), `station-display` (TV layout, per-track timetable and seconds/minutes), `exit-banner` |
| Concept art | `passenger-art-pipeline` — growing catalogues, bounded browser batches, complete standing/stride coverage, stale build rejection and duplicate capture files; `capture-passengers` — the `?capture-passengers` route wiring, the live crowd mesh photographed with alpha, every field the sheet tools place by (foot origin, scale, stride) and full-stride gait captures in plan, elevation and isometric views. `art-passenger-heading` projects facing through the capture camera and compares it with all eight isometric travel directions, preventing sideways walking. Browser playback is checked separately with `node tools/test-passenger-animation.mjs` after captures and art generation. |
| Languages and routes | `i18n` — both catalogues and interpolation slots, live notice translation, canonical labels, explicit-language formatting without changing UI state, and the `/game` + `/game/en` routes with their asset resolution at the deployed prefix and the workers.dev root; `report-issue-route` — the public feedback URLs (`/stats/report`, `/stats/en/report`) and local stats Worker origin; `site-worker` — the site's `/en` → `/en/` pin, English asset paths and untouched non-`/en` requests; `demo-route` — the demo URLs (`/game/zoo`, `/game/en/tanwei`), their trailing-slash redirect, the boot that opens the named station over the autosave, and the one-shot URL rewrite; `site-demo-links` — the concept site's picker wiring, its two triggers and its copied game previews |
| Startup and tutorial | `tutorial` — empty paused startup at ground level, resilient progress/opt-out storage, and automatic tutorial suppression on benchmark routes without changing the saved preference. `benchmark-route` — the selected benchmark graphics quality is applied before renderer mount and does not overwrite the regular game's saved preference. `ui-theme` and `game-loading` cover preference fallback, persistence, visibility and bilingual failure text. After a build, `node tools/check-game-themes.mjs` checks the early loading shell, special-route bypasses, first rendered frame, theme switching and persistence, scene void and Night's list. `npm run check:tutorial` separately exercises the production UI in both languages, including live input, practice activation, dynamic spotlights, keycaps and reload behavior. |
| Global stats | `global-stats` — a stable stored client id, default-on opt-out preference, built-station counts (solid cells, modules, lines, tracks, platform tracks), cumulative passenger deltas, sim-reset and station-switch baselines, a persisted retry queue that keeps its `submitId`, pagehide beacons, API host resolution and the gear-menu source contract. |
| The app | `move` (including no lift when the visible-layer picker has no target), `delete-tool` (block delete rectangles, Shift lines and one-step undo; hidden modules do not start a module delete; top/bottom lift extensions trim independently while base/interior clicks remove the shaft; 人行道 / 草坪 resolve from the pointed cell and tear down exactly as the armed tile tool's right-click does, tap and run alike), `equipment-deletion` (visible module before underlying grid cell, and a ray that crossed a canopy or a neighbour's raised plate never stealing the pointed cell's piece), `equipment-placement-input` (wall/ceiling support placement from open air, an exit preview and click aligned by picking a stair through tread gaps even with a floor hit, and bridge snap across track, screen-door and outer-platform surfaces in every rotation with preview/click agreement), `sweep`, `paint-mode`, `tool-shortcuts` (B/P/M toggle back to the previous tool and the room front R tile), `builder-attributes` (shared module capability order and selected dimension marks, centred width artwork with start-aligned length artwork for modules/tunnels/bridges, stacked single/double-storey planes, shared platform/module directions and rotation marks, R/Tab/Shift+Tab dispatch, the shared one-floor and 双层 run lengths plus 超长 6 m, the straight-stair predicate the exit-bay snap uses), `tool-hover-preview` (blue previews for move/picker/select, red preview for bulldoze), `rail-folders` (all ten Shift+number keys, four top-level decor folder titles, diagonal tab positions through the last two rows, and the half-height catenary style tile beside rotation), `rail-families` (per-section decor membership and order, cross-section families with complete variant menus, and the equipment-to-decor TVM move), `line-edit`, `new-station-confirmation` (the top-bar button and Ctrl+N require confirmation before replacing the station), `topbar-report-issue` (the FaBug issue-tracker link beside restart), `topbar-playback` (the paused play button resumes like Space, keeping the speed tiles' own resume), `select-agent` (cell fallback ignores modules hidden by level slicing) — `pick-tool` also pins the hidden-module fallback and the full-palette sweep: every `MODULE_OPTIONS` id round-trips through the picker, including the setting-free 空调风机 and 设备柜 |

## The rules a test here follows

Roof placement coverage in `roof-tool.test.mjs` includes pointer-centred footprints for plain, shell and truss roofs at all widths and rotations, matching hover and click anchors, the shell bay's truss-less variant passthrough, roof-height ray projection in perspective and orthographic views, and thin-roof snap priority (existing slab, block outside face, active view height), Tab/action tile state and preview/release agreement. `overground.test.mjs` pins upper/lower slabs against their exact rendered and collision boundaries and keeps them on the correct storey.

`overground.test.mjs` covers pillar dimensions and 5 m extension. `pillar-length.test.mjs` pins the Tab cycle of 2 / 3 / 4 / 5 / 6 m sections for both pillar widths; `pick-tool.test.mjs` pins copying the choice and restoring it on Esc; `move.test.mjs` pins moving a free-standing pillar (same shaft, translated, floor-checked at the drop) and refusing a bridge-owned pier; `pillar-extension.test.mjs` pins the anchor-cell extension snap in both document orders, the nine slim offsets, stacked-pillar storey bands, the info-card lift, the flight-only turning-stair hitbox, the stair-naming refusal and the hover/release highlight agreement.

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

### Five-metre profile coverage (2026-10-19)

The focused profile run passed 29/29 tests in `storey-height`, `covered-clearance`
and `grid`. Across the five loaded instrumented files it measured 89.30% lines, 73.39%
branches and 71.79% functions. Per-file coverage:

| File | Lines | Branches | Functions |
|---|---:|---:|---:|
| `sim/constants.ts` | 95.42% | 100% | 50% |
| `sim/stock.ts` | 91.73% | 91.89% | 76.92% |
| `sim/track.ts` | 82.04% | 75% | 66.67% |
| `render/models/pieces/PsdModel.ts` | 92.38% | 63.27% | 95.24% |
| `render/models/pieces/TrackModel.ts` | 67.90% | 71.43% | 54.55% |

`moduleDependencies.ts` was selected but not loaded by these three suites, so it
has no measurement in this focused report. The earlier 72-failure report is superseded by the audit below. See the
[performance reference](../../.agents/skills/metro-repo/references/performance.md)
for current validation and inventory evidence.

Measured over the whole suite (`--experimental-test-coverage`, one process): **1392 tests,
94.02 % lines / 88.74 % branches / 89.39 % functions** across the loaded source files. This
snapshot includes the run lengths — 超短 / 短 / 中 / 长 / 超长 on the 扶梯 and every staircase —
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

Rows marked `(focused)` come from the focused coverage command over
`equipment-retention`, `fence-preview`, `performance-policy`, `batching-lifecycle`,
`scene-wiring`, `static-rendering` and `level-view-cache`; they are not whole-suite
percentages.

| File | Before | Now | The test that closed it |
|---|---|---|---|
| `sim/globalStats.ts` | — (new) | 100 % lines / 100 % branches / 100 % functions | `global-stats` — station counts (solid cells, tracks/platform tracks), cumulative deltas, run resets, station-switch baselines, empty-station skipping and the submit body. Reproduce the four rows with `npm --prefix game run coverage:global-stats`. |
| `app/globalStats.ts` | — (new) | 100 % lines / 82.7 % branches / 93.9 % functions | `global-stats` — client id and opt-out storage, five-minute/dev-five-second tick, dev initial snapshot, persisted queue retry with one `submitId`, 4xx/429/5xx/network handling, pagehide beacon, host resolution and boot hook |
| `app/statsSettings.ts` | — (new) | 100 % lines / 100 % branches / 100 % functions | `global-stats` — default-on preference, valid/invalid client ids, blocked storage and the randomUUID fallback |
| `app/store/slices/StatsSlice.ts` | — (new) | 100 % lines / 100 % branches / 100 % functions | `global-stats` — persisted opt-out without dirtying the document |
| `sim/rampLengths.ts` (the run-length families) | — (new) | 100 % lines / 96.88 % branches (focused) | `escalator-length` + `three-storey-ramps` — the shared one-floor 2–6 m, double 7–11 m and triple 12–16 m families for escalators and stairs, their cycles and labels, 5 / 10 / 15 m defaults, endpoint-derived span and length, family fallback and nearest-entry behavior; the focused four-suite run covers 66 tests. `ramp-join` covers the seam at every one-floor length |
| `sim/ground.ts` (the street plane) | — (new) | 100 % lines / 97.6 % branches | `ground` — the window, the three answers at a coordinate, the dig and the fill-back, the brushes that materialise the plane, and the two predicates that read it |
| `render/models.ts` (the dispatcher) | 100 % | 100 % | `module-build` (now including the 灯具/通风口/导向柱/公交站/地面 rows, which closed the new dispatch arms) |
| `render/models/pieces/PsdModel.ts` (站台门) | 11.1 % | 100 % | `module-build` |
| `render/models/pieces/ExitModel.ts` | 95.7 % | 97.8 % | `module-build` |
| `render/models/pieces/TrackModel.ts` | 100 % | 95.1 % | `module-build` |
| `render/models/pieces/TvmModel.ts` | 28.6 % | 100 % | `module-build` |
| `render/models/pieces/TrainModel.ts` | 99.1 % | 99.2 % | `module-build` |
| `render/models/pieces/CabModel.ts` | 37.5 % | 97.2 % | `module-build` |
| `render/models/pieces/LiftModel.ts` | 94.6 % | 91.7 % | `module-build`, `lift-style`, `lift-interval`, `lift-size` (uneven levels, the exact story height, both end caps, the door-side glazing and the landing doors at every level, and the 大 plan scaled in x/y; the glass housing added branches faster than pins) |
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
| `render/modelDetail.ts` | — (new) | 100 % lines / 95.65 % branches / 100 % functions (focused `model-detail` coverage) | `model-detail` (authored triangle budgets, source picks, finish colours, batching, motion, restoration and disposal) |
| `render/retainPaintedModules.ts` | — (new) | 100 % lines / 94.4 % branches | `render-performance` (paint reuse and structural invalidation) |
| `render/moduleDependencies.ts` | — (new) | 100 % lines / 97.72 % branches / 100 % functions (`test:perf`) | 748 passing performance checks, including `local-cell-edit`, `equipment-retention`, `floor-geometry`, `geometry-snap`, `scene-wiring` and `performance-policy`. Per-model inputs, cell edits, ramp wall/landing signatures, remote monitors/signals, unknown types and the boards-only sign verdict. |
| `render/localCellEdit.ts` / `app/stationGeometry.ts` | — (new) | 93.62 / 100 % lines; 93.48 / 100 % branches; 100 / 100 % functions (`test:perf`) | Bounded deltas, module-owned bounds, append/replace/delete/undo and live derived indexes without document mutation. |
| `render/scene/systems/ChunkSystem.ts` / `render/structuralModelInputs.ts` | — (changed) | 96.34 / 100 % lines; 94.77 / 94.74 % branches; 87.23 / 96.15 % functions (final focused chunk run / broad `test:perf`) | Exact incremental triangles, all cut-shape orientations, retained remote geometry and upper storeys on delete, disposal and bounded stair signatures against full builder inputs. |
| `render/modulePreviewDocument.ts` | — (new) | 100 % lines / 100 % branches / 100 % functions (focused) | `equipment-retention`, `fence-preview` (prepared-station hover reuse, cached move removal and coupled candidate merging) |
| `render/equipmentBatches.ts` | — (changed) | 100 % lines / 92.9 % branches / 97.2 % functions (focused) | `fence-preview`, `batching-lifecycle` (local bucket masking, unreplaced source drawing and layer restoration) |
| `sim/fences.ts` | — (changed) | 97.8 % lines / 96.3 % branches / 100 % functions (focused) | `fence-preview`, `equipment-retention` (prepared fence/gate/landing lookups, candidate overlay and immutable invalidation) |
| `sim/lights.ts` / `sim/vents.ts` / `sim/inCellPositions.ts` | — (new) | 100 % lines | `lights`, `vent` |
| `render/models/pieces/LightModel.ts` / `VentModel.ts` / `StreetDecorModel.ts` | — (new) | 100 % lines | `lights`, `vent`, `street-decor`, `module-build` |
| `render/models/pieces/RampJoinModel.ts` | — (new) | 98.7 % lines | `ramp-join`, `module-build` |
| `render/models/pieces/EscalatorModel.ts` (rebuilt band) | — (rebuilt) | 98.0 % lines | `module-build`, `escalators`, `ramp-fill`, `escalator-length` (the same body at every one-floor and 双层 length) |
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
| `render/scene/systems/CameraSystem.ts` | 70 % | The `OrbitControls` rig: its own limbs are driven by real pointer events on a canvas. The pieces of it that are pure arithmetic are pinned (`camera-vertical-pan`, `camera-fov`, `camera-orbit`, `section-drag`), including WASD screen directions at the straight-down plan view, and 回到默认视角 through it is pinned by `view-home`. `camera-vertical-pan` also checks the frame loop tracks `activeZ + 1 m` while retaining orbit and zoom. |
| `sim/world/World.ts` | ~96 % | The branches a crowd reaches only in a long, rare run: a stuck agent, a lift car arriving at the wrong moment, an invalid trip. Covered by the tightest tests that exist (`determinism`, `capacity`, `demo`) rather than by a targeted one. |
| `render/scene/systems/*` | 80-100 % | The GPU half of each system; their arithmetic is covered (`chunk-cache`, `cut-clipping`, `level-slicing`, `section-drag`, `grid-visibility`). |
| `sim/sign.ts`, `sim/station.ts`, `sim/openings.ts` | 97-99 % | Branch tails: an unreachable save spelling, a degenerate run, a fallback for a document that cannot exist. |



Above-ground equipment: `overground.test.mjs` pins slim/thick support dimensions and 5 m extensions, slim-pillar R cycling through nine offsets shared by the model and collision envelope, the 1×1 m thin roof and the truss and shell bays in 4/8/12 m widths, full-height collision bounds, and material painting of roof cladding while the supporting truss stays steel in 单块 / 整面 mode, doorway exits aligned to the near block edge in all rotations, in three widths at any supported height ≥ 0 m (with an explicit backing wall, preview/release agreement and a graph node that exists), bridge connections in both directions and all rotations, support attachment, and save/load preservation. Roof and pillar variants sit below the triangular blocks in 工具; doorway exits live under 设备; 轨道桥 lives under 轨道 and extends an existing rail without platform doors or a tunnel shell. Roof bays place by click or rectangular drag and are painted through 材质.

`roof-tool.test.mjs` verifies rectangular thin-roof previews, full truss-bay placement and removal including rotated 8 m bays, collision refusal, right-drag removal, and one undo step per drag. Thin roof Tab/action controls cycle 上 / 下 with the matching arrow-to-line icons; a hovered roof slab overrides block placement height and half, blocks anchor the tile outside their face, and click preview/release agree. Each bay style has one tile, the shell bay carrying no truss; Tab or its action tile cycles 窄 4 m / 中 8 m / 宽 12 m and redraws the hover. `overground.test.mjs` also pins exact lower/upper quarter-metre model and collision bounds at the cell boundaries, plus 4 m of truss assembly height including the skin, contact with support posts, continuous 40 cm bottom chords across bay seams, and half-density internal ribs in 收束 at all widths and rotations.

Small stair blocks: 楼梯块 under 楼梯 has a 1×1 m footprint and no railings. Tab switches 高 (1 m, four treads) / 矮 (0.5 m, two treads), with a live placement preview; the palette preview is turned 90° counter-clockwise. Click places one tile; a drag lays a straight row across the stair's rotated width, ignoring pointer movement along the treads. R rotates the steps, and 材质 paints the whole stepped surface. The high block connects adjacent lower/upper floors without carving blocks; the short building piece does not create a full-metre walking connection on the whole-metre floor grid. `overground.test.mjs` pins dimensions, painting, collisions, floor preservation, save/load and both walking directions; `roof-tool.test.mjs` pins the rotated drag axis, preview/release agreement, undo and removal.

Bridge deck and barriers: `overground.test.mjs` checks the one-metre underside without coplanar edge girders, eight-metre centre-pier spacing in every rotation, zero generated piers on short bridges and migration of older spacing, reuse and owned teardown, B deletion persisting across edits/load with undo/redo, full-deck ground clearance, pillar contact, collision refusal below the deck, deck-only material painting, half/full sound-barrier height, preview identity and save/load. `structures-gaps.test.mjs` checks the three-name cycle and wraparound. `pick-tool.test.mjs` checks copying the barrier and length and restoring both on Esc.

Truss roof finishes: the truss bays use neutral white vertex colours and metre-scaled UVs on cladding and beams, so 材质 painting renders the selected finish on the roof sheets instead of black. Beams and braces keep the shared steel material. `overground.test.mjs` checks every mesh across all three widths.

`structures-gaps.test.mjs` pins the repair-shaped edges the feature suites use but never assert: `normalizeLevelBase` clamping/rounding, the roof width cycle/clamp/labels and ridge formula, the three ways a pillar refuses a bridge, and the roof-paint no-ops.

Roof visibility: `ground-visibility` pins 隐藏天花板 off by default in the view store and scene. 隐藏天花板 leaves actual roof modules visible. 隐藏屋顶 is a separate view toggle, off by default, hiding all roof styles even in 隐藏UI / 剖切. It sits below 隐藏天花板 with 分区图 to its right. `ground-visibility.test.mjs` pins independent ceiling/roof visibility; `rail-folders.test.mjs` pins the nine-tile order and header count.

`street-decor.test.mjs` verifies above-ground-only placement and movement, whole shelter floor support, track rejection, rotated model bounds, live station/exit labels, the 公交站's displays (a **double-sided** landscape lightbox per cabinet, one upright panel on the route cabinet's back, and its own campaign on every panel — `billboard.test.mjs` pins the choice itself), and persistence of exit references and frozen shared posters.

`hanger.test.mjs` covers 挂架: roof suspended and central post supports in 4/6/8m, roof attachments, sign/clock/TV mounting, rotated steel geometry, open walking space, post footing, preview identity and save/load.

`wall-ceiling-snap.test.mjs` pins wall and ceiling aiming on a shifted `levelBase` (the wall snap asks the station's 基准高度 for its storey floor, never the fixed 0 / 5 / 10 lines) and accepts an actual overhead slab at a nonstandard height; it also pins that a **side face is a wall whatever the block is tagged**, so a plain 方块 wall mounts a panel in front of the face rather than inside the block, and that a **玻璃板** — cladding from its base, and the only wall piece that is (`wallMountFollowsCourse`) — **hangs over the course the pointer is on**, keeping the storey floor for the wall's first course while a piece drawn at its own `panelZ` stays there. `equipment-placement-input.test.mjs` pins the tool's half of that (the 玻璃板 covers the clicked course, the 广告牌 beside it keeps its band) and `move.test.mjs` the carried piece's. The same file pins the **hung** piece's anchor: `hungCeilingAim` takes it to the free cell under the first **underside** above the pointer — `top block - 1` — from the floor, a wall course or a slab's own underside of one column alike (`topBlockZ` skipping a wall's own courses), with the storey floor and the station's `levelBase` standing in when nothing is overhead, `topBlockOver` for a cell with its top block over it, and the verdict passing a piece under that block while refusing one with no ceiling. The same anchor path accepts a platform underside hit; `CameraSystem.pick` includes visible track surfaces in its single pointer raycast so the hover does not fall through to the floor behind the platform. `lights.test.mjs` and `vent.test.mjs` pin the tool's half and the drawn fixture (the real slab on a shifted base, and the top block when the piece's own cell is the one under it), `module-build.test.mjs` the drawn mount and pinned size of every hung piece, and `ceiling-decor.test.mjs` the 监控 stems against a tall slab. `sign-model.test.mjs` checks that the hanging sign's rods terminate at that slab.

`door-panel` checks all six 单开 / 双开 × 不锈钢 / 木 / 玻璃 variants, palette and width selection, the translucent glass pane in its steel frame, satin stainless and timber finishes, exposed hinges, both-face handle clearance and mirrored double-door pulls, plus placement bounds. It also pins 1 cm of lintel clearance in two-block-high wall openings for every variant, rotation and tested storey, while permitting the overhead block and refusing a block through the leaf. `glass-panel` pins all four 玻璃幕墙 orientations on one tile, rejection of same-facing duplicates, and removal of one intersecting corner post with shortened rails, alongside door snapping to rotated curtain runs, fitted placement, crosswise refusal, and the lower-pane opening while retaining upper and uncovered glazing.

`gate-door` also checks the 新/旧 turnstiles: slim cabinets, smaller opposing leaves retracting left and right, approach arrows and red crosses on fence-only machines, legacy/save compatibility and separate variant sweeps. `pick-tool` checks copying and cancelling 新/旧 choices.

`gate-door` pins the curved fan leaves (long top, short bottom) and the old gate's longer sloping fascia, flush reader sticker and absence of red/green reader lamps.

`passenger-view.test.mjs` pins the anime silhouettes, shallow head/body proportions, opaque unlit ink, complete eye/hair/clothing colour regions, CC0 clothed walking poses, six animated hairstyles per outfit, child/adult height and build ranges, child eye height and picking, stable outfit/build/height/tone variation through buffer reordering, grounded animated arm/leg poses, travel-driven gait, idle/riding transitions, mid-stride pause/resume through duplicate and reordered snapshots, selection at the displayed head/legs, phase identity through crowd compaction, interpolated eye position, departure handling, click-held first-person mouse look after the initial heading, and restoration of the camera and display settings.


`diagonal-walk.test.mjs` pins eight-direction walking in clear space (§7.2):
diagonal edges cost their actual √2 m distance with their endpoint finish speeds, require both cardinal routes
around a clear same-height square, and cannot cut past holes, walls, fare
barriers or turnstiles. `wayfinding.test.mjs` also checks diagonal ramp-glass
barriers at the ramp's own storey and clear diagonal movement below it.

`stairs.test.mjs` covers 左/中/右直跑楼梯: forward flights, block-fitted middle landings, all widths and rotations, and bidirectional passenger routes. A 中直跑楼梯 spanning two or three storeys climbs one flight per storey with a platform in the middle of each (two and three platforms); the 左/右 variants keep their single middle landing. It also pins every staircase's chosen length — a straight flight climbs it in one run, a turning stair splits it into two flights with its platform at half the rise — and the turning shapes' block grid: a 双跑楼梯's flush pair and a 90° turn's two perpendicular legs each built block-wide, with the turn's quarter-landing the square its legs meet on (as deep as it is wide, its departing leg on the square's far edge), the equipment tool placing that piece, the platform drawn as the stair's own 0.5 m slab, and no document block laid (every landing cell still a virtual graph node), with a legacy landing block cleaned up by the bulldozer. `module-build.test.mjs` checks visible treads, railing glass and landing geometry for all three styles, sizes and rotations, and measures a 90° turn's drawn platform against the square the landing covers.


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

`roads.test.mjs` covers the 站外 道路 node builder: centerline drags, one-way
and two-way lane counts (3 m per lane; two-way counts round down to equal pairs),
R flow reversal and immediate width/direction preview refresh, ground support at 0 m or above,
intersection ink clipping, save/load, vehicle geometry and a single undoable
placement gesture. Road traffic is ambient: directed lane connectors join crossings and T junctions,
vehicles queue at signals, and their movement follows the simulation clock. It does
not carry passengers; derived zebra markings remain visual. Seeded spawns use half the original density with 10% buses,
60% scooters and 30% cars. Multi-lane seeded and boundary spawns are staggered across lanes.

Roads cut pedestrian routing on their own floor and swept movement keeps crowd
pressure off the pavement. Editing a road beneath walkers relocates them to the
nearest remaining pedestrian floor before replanning. Vehicle materials are
grayscale and share the passenger material's 70% High / 45% Low opacity, with a depth prepass for self-occlusion.
`road-vehicles.test.mjs` covers all six procedural variants: grounded finite geometry,
a 10% triangle cap with fixed High counts, visible outward tyres/hubs on both sides and windscreens, distinct rooflines,
curb-side bus doors and exposed route/lamp surfaces, open bicycle spokes/basket,
moped luggage, deterministic variant selection, actual six-way instance packing,
paused buffer retention and exactly-once disposal. `node tools/check-road-vehicles.mjs`
renders the production instanced models with the station light rig from front/rear;
screenshots and triangle/draw reports live in `.preview/road-vehicles/`.
`npm run check:roads` drives the real
production viewport in Chinese and English: centerline node drags, R flow reversal,
Tab width / Shift+Tab direction refresh, endpoint extension, mid-road branches,
segment-only deletion and undo/redo. Each gesture commits once on release.
This catches release dispatch falling through to the block tool and ghost keys
omitting road dimensions/direction. Screenshots/reports live in `.preview/roads/`.

`road-performance.test.mjs` pins one document-index preparation per immutable
cell/module pair, no full cell scans in warmed road previews, original placement
verdict equivalence, equipment allocation retention on road edits, road-ink
invalidation/disposal, and continued pedestrian graph invalidation. `bench:road`
drives cold and warm hover/press/drag/cancel/release through the production viewport;
its raw reports and optional CPU profiles go under `.preview/perf/`. See the
[performance reference](../../.agents/skills/metro-repo/references/performance.md)
for current measurements.


The production browser check `node tools/check-road-network.mjs` covers both locales,
actual road signal meshes, turning/waiting vehicles, paused buffers and WebGL errors;
its timings/screenshots live under ignored `.preview/perf/road-network/`.

人行道 (Sidewalk) and 草坪 (Lawn) in 站外装饰 drag rectangular patches raised 0.1 m. Ground equipment follows the finish; 树木 (Tree) places individually on grass or bare ground. `outdoor-surfaces` pins height, ground-equipment compatibility, collisions, save/pick and support rebuilds; `roof-tool` pins immediate rectangular drag, erase and undo. One finish per tile: `outdoor-surfaces` pins the replacement verdict and that a refused cell replaces nothing, and `roof-tool` pins the gesture — the ghost is not red where the release accepts, and the replacement is one commit and one undo. Removal is one teardown, not two: the 删除 (B) tool hands a resolved tile to the tile tool exactly as it hands it a roof bay, so a press, a run drag and their undo steps match the armed 人行道 / 草坪 tool's right-click (`delete-tool`).

Outdoor surface performance: `outdoor-surfaces` now guards one snapshot for bulk placement/removal, bounded document reads, exact floor/track/road refusals, immutable support indexes, retained unaffected equipment and shared geometry disposal. `worker-preview` guards no routing rebuild or paused tick for sidewalk/lawn/tree edits within the existing ground window — a 树木 is **planting, not structure**: `buildGraph` deliberately leaves its tile a walk node (pinned by `outdoor-surfaces`' "a tree draws without walking"), so the crowd walks through it like every other street prop, and only its equipment collision remains (production click-to-two-frames is 215 ms; a planting that widens the drawn plane still pays its ground and graph, 583 ms — see the [performance reference](../../.agents/skills/metro-repo/references/performance.md)). Trees use the offline EZ-Tree ash bake (`node tools/bake-street-tree.mjs`), two shared meshes and a scene-owned leaf texture. `node tools/bench-outdoor-surfaces.mjs` measures cold and warm production pointer phases, and `node tools/bench-tree-placement.mjs` measures the tree gesture end to end; reports belong under `.preview/perf/`.

`outdoor-surfaces` also pins Tanwei B exit protection: sidewalk/lawn refuse exit-owned floors and ramp openings, and existing saved tiles draw no cap when an exit or hole is created afterward. Hidden finishes do not lift the exit away from its stairs. Ground edits invalidate the affected finish so digging and restoring ground update its visibility.

`move` pins moving trees through the move tool/inspector eligibility, cancel, collision refusal, lawn support height and one-step undo/redo.


`static-rendering.test.mjs` pins retained 16 m outdoor tile/tree instance batches,
original picking layers and move masking, transparent instance ordering with stable
buffers, near/far geometry reuse and exact disposal, distant tile/canopy bounds,
and paused framebuffer invalidation for camera, projection, edits and animation.
The production `tools/check-static-rendering.mjs` check covers actual idle draws,
camera/preview/view/edit wakeups, retained chunk allocations and both demo fixtures.

`ceiling-decor` also pins the ground-mounted pole PTZ: outdoor floor support, no ceiling requirement, 4 m height and rotated footprint; `model-detail` pins its authored Low budget and restoration.

`canopy.test.mjs` pins 有柱雨棚 in the roof family: a 4 m ridge / 3 m eaves, exactly two symmetric round-column rows at 4/8/12 m widths, open ground collision and walking, roof-hanger backing, paint/save, every rotation, and exact Low picks/restoration. `roof-tool`, `pick-tool` and `model-detail` cover centred ground previews, straight drags, undo/deletion, variant/width identity and reduced geometry budgets.

`draw-batching` also pins C's two front panes and evacuation-door fittings,
small end windows and three large inter-door windows per side, clear apertures,
and independent passenger door banks in both directions for four/six-car consists.

`draw-batching` pins Type A's five doors alternating with four Type B-sized
passenger windows per side, painted end bays, unobstructed apertures and independent
door banks in six/eight-car consists travelling in both directions.

`draw-batching` checks C cab glazing contacts its backing in profile and the
smaller emblem clears both panes and the front door at both ends.

`module-build` pins track-side PSD slides, gapless closed leaves, cadence pillars and persistent yellow lines in all rotations. `rail` pins no-screen/deleted-screen boarding, arrow snapping, save round-trip and regeneration.

`train-bogie` pins the lowered rail crown and wheel contact; `train-cabin` pins the train floor flush with platform height. `module-build` covers flush PSD thresholds, pocket overlaps and black half-height meeting stiles; `floor-decor` snaps boarding and waiting ink in all three PSD modes.

`floor-geometry` pins full-volume platform cuts under PSD bases in every rotation/bank, intact yellow-line support, and chunk-cache invalidation/restoration when screens are removed.

`train-cab` pins gapless passenger-door centre joins for every stock, flush curved outer skins, separate outward/sideways plug phases and the reverse closing order, with the opposite bank held closed.

`catenary-model` pins single-mast cantilevers and braced joints; `module-build` pins gantry/third-rail agreement for full, half and absent PSD banks, both directions and every rotation, including bridge barrier and shoulder cutouts only on the mast side. `track-third-rail` pins travel-right fallback with both or neither PSD bank.

The underfloor equipment regression in `train-bogie` pins cabinet/tank/conduit coverage, bogie clearance, rail and floor bounds, reduced detail and the unchanged roof height. Passenger doors stay about half the wheel-to-roof height across all five stocks, with the original doorway and roof retained above the deeper wheelsets. `rail` pins two-course excavation without cutting platform support.

`train-cab` checks each leaf owns a thin rubber perimeter through both motion phases, without a broad black kick panel. `train-pantograph` pins thin rooftop AC housings, fan grilles, cab bounds and collector-well clearance for all five stocks and both power modes. `train-bogie` retains deep upper cheek frames, body load pads and secondary air cushions above the full-size wheelsets.

`module-build` also pins stock-aware mast/railing clearance on legacy narrow D beds and concrete foundation contact beneath the full PSD sill, down to the recessed bed, for both heights, banks and every rotation.


`storey-height.test.mjs` pins the single supported five-metre station profile,
level controls, stairs/lifts/walls, exact escalator inclines, half-storey stair
landings (model-only, at 2.5 m for a 长 stair) through save/load and routing, normal
suspended-ceiling block gestures,
undo/delete, decor mounting and stacked-floor rehangs, ceiling visibility and mesh
reuse, full-height PSD glazing and top information plates without padding, the covered/tunnel five-metre bottom-to-ceiling envelope and open gantry allowance,
and scaled rolling stock floor, wheel
contact, track slab, door cadence and pantograph contact for every stock and power.

`storey-height` also guards five-metre track construction, the absent canopy plate/fascia, and
wire mounts touching the upper floor rather than a duplicate rail-owned slab.

`storey-height` also pins the street plane ceiling only the storey whose own top
it lands on — the top below-grade storey still mounts while a deeper one is
refused — a hung fitting on a shifted editing base hanging from the block over
its own cell, a roof hanger finding its slab one storey up with an envelope of
its own steel rather than a ceiling drop, and an exit-bay snap descending the
station's own grid with hover and click building the same run.

`covered-clearance.test.mjs` loads the reported two-level save, verifies profile
loading without changing its 870 blocks, and builds its actual A trains, PSDs and
covered wires. It pins the 7 m / 12 m slab undersides, wheel/floor and carbon-wire
contact, no duplicate roof plate, and lower-face mounting below real ceiling blocks.

`covered-clearance` also checks full-depth concrete beneath the reported tracks,
flush with the bottom and full footprint of the blocks dug by the track tool.

### Train / five-metre audit coverage (2026-10-19)

The nine demo/scenario skips have been removed. `demo` restores the shared
circulation assertion and its unreachable-door negative control, and checks both
authored demos load with zero dropped records and unchanged cells/modules. `bay`,
`facility`, `openings` and `placement` use current landing coordinates; unequal
8 m stairs / 9 m escalators meet at the upper exit row. `save` additionally pins
current 0.98 scale in serialized lines for absent/stale/current source metadata,
source immutability and serialized/loaded agreement.

`test:perf` includes `train-pantograph`, `storey-height`, `covered-clearance` and
`lift-interval`; Node geometry/work-count coverage remains separate from the
production WebGL and cold-save browser checks. Raw audit reports live under
`.preview/perf/train-5m-audit/`.

Audit validation: complete normal suite **1,921 passing, zero failures/skips**.
Focused save coverage is 100% lines / 88.24% branches / 100% functions.
The seven-contract coverage pass measures `build/model/Ceilings.ts` at
87.18 / 91.67 / 77.78%, `sim/stock.ts` at 77.44 / 100 / 36.36%, and
`sim/track.ts` at 56.80 / 52.94 / 33.33% (lines / branches / functions).
These focused results leave other functions unexercised; do not read them as
whole-suite coverage. Full instrumented geometry coverage exceeded 11 minutes
and was stopped without a completed result. The
[performance reference](../../.agents/skills/metro-repo/references/performance.md)
records this limitation and the separate production-browser checks.

The expanded same-process performance selection was also attempted without
instrumentation and stopped after roughly four minutes without completion
(`.preview/perf/train-5m-audit/perf-tests-uninstrumented.txt`). Its constituent
tests pass in the complete standard run with process isolation; the expanded
same-process gate is not certified by this audit.

Passenger visual scale: `passenger-size` pins adults and children to the train's
0.98 ratio on every rendered axis, preserving tone and grounding; its body/shadow
matrix regression and `passenger-view` keep picking and eye height aligned.
`passenger-library` verifies scaled appearance independently of simulation physique.

Passenger-scale validation: full suite 1,922 passing, zero failures/skips; build
and production High/Low/High adult/child matrix checks pass. Focused rendering
coverage measures `passengerModel.ts` at 100% lines / 93.33% branches / 100%
functions. Reports: `.preview/perf/passenger-scale/`.

`train-interior.test.mjs` checks the route boards above every train doorway,
continuous full-cabin 2.94 m ceiling clearance, curved-roof
containment and unchanged exterior roof geometry for A/B/C/D/L, both banks, High/Low
and open/closed doors. `TrainInterior.ts` owns these fittings.

Door-header focused coverage: `TrainInterior.ts` 100% lines / 97.96% branches /
100% functions; `CarShellProfile.ts` 100% / 98.85% / 100%. Production close-up
and batching checks pass with zero captured WebGL/runtime errors. Reports are
in `.preview/perf/train-raised-ceiling/`.

Continuous-ceiling final validation: full suite 1,925 passing, zero failures/skips;
production build, interior close-up and open/closed batching checks pass.
Full log: `.preview/perf/train-raised-ceiling/full-tests-final.txt`.

`builder-attributes` pins the shared selected-size artwork, centred width marks with start-aligned bridge/tunnel/module length marks, stacked single/double-storey planes, platform/module direction marks, and rotation marks.

`nonstructural-updates` pins presentation patch classification/dependency retention,
exit closure without rerouting existing journeys, and seeded fast-restart equivalence
with full reconstruction (including dynamic server state and 24 subsequent ticks).
`equipment-retention` checks original texture/geometry identity and unaffected-line
uploads; `train-lod` pins live/parked recolouring and simultaneous services;
`draw-batching` retains GPU eviction coverage with distinct orientations.
`line-edit` and `scene-wiring` pin geometry revisions and overlay dependencies so
metadata edits, undo and redo avoid structural redraw work.

Secondary terminus names: population-edit pins presentation patches, clearing and retained document geometry; psd-header pins direction-specific secondary destination ink and legacy fallback.
`module-build` also pins extra-long stair rail contact, full landing frames and vertical support joints for every turning/forward shape, width and rotation. Platform bounds are measured on the surface, excluding projecting rails.
StairModel coverage from module-build: 98.20% lines, 85.61% branches, 100% functions. The bay suite uses precise support vertices for fitted landing ends and retains wall-side rail suppression checks.


`tool-picking` pins one shared scene intersection for every tool query in a
pointer dispatch (including nested touch dispatch), cached misses, fresh next-event
visibility, layer restoration and overlapping lift/block roots. It also covers
fresh/moved ceiling props sharing `moduleAim` and the equipment verdict beneath
platform decks. Tool gestures retain their own document edits; support refusals
come from the shared validator. `node tools/check-tool-picking.mjs` exercises actual
production placement/movement beneath a platform and first/repeated hovers for
all eleven tools, with dispatch CPU and raycast counts in `.preview/perf/tool-picking/`.


`ramp-targeting` rays actual stair/escalator meshes in all four rotations, all
seven stair shapes and three stair widths, plus all three escalator widths. A block
inside the run's coarse envelope but in front of its drawn surface must remain
the hover/delete/inspection/eyedropper target; delete and undo preserve the run.
An exposed tread remains directly deletable. The forgiving exit snap may span a
tread gap, but cannot ignore a nearer block when the exact run surface is behind
it. All pointer cell fallbacks use `moduleTarget`, which requires a drawn-surface
hit for stair/escalator/walkway runs. Geometry-free `moduleAt` callers retain their
coordinate-query contract. This regression runs in `test:perf`.

`floor-geometry` also pins Tanwei `(16,6,-1)` wall sides beside hidden suspended ceilings, the `(18,14,-3)` report’s stepped-wall ledge closure from above and -y, toggle geometry retention, ordinary shared-side culling and cross-chunk cache invalidation when a neighbour is retagged. Local delete/fill commits retain one tracked scene group per storey; remote floor meshes preserve their GPU allocations and follow repeated -15/-5 m visibility switches.

Placement latency regressions: `equipment-retention` pins scene-parent retention,
append-only animation/fence registries without duplicates, and ground-window tool
occupancy against fresh preparation. `batching-lifecycle` pins retained source
discovery, conservative transform/view invalidation, idle disposal and teardown
cancellation. `floor-geometry` compares expanding and shrinking ground-only updates
with fresh meshing and preserves authored GPU geometry. `line-edit` pins immutable
equipment history; `cut-clipping` pins unchanged shader versions and actual clip
transitions. `tools/bench-placement-latency.mjs` measures first/repeated real pointer
placements on both demos, including generated-ground boundary changes; browser
timings are evidence, never Node pass thresholds.

`exploded-view.test.mjs` covers the independent presentation document in
`render/explodedView.ts`: immutable source arrays, baseline-aware story bands,
separated full equipment footprints, retained unfurnished floors, roof/outdoor and
ceiling removal, open near perimeter with retained back/internal walls, ramp endpoint
translation and per-story lift segments. `tools/check-exploded-view.mjs` separately
checks both production demos, modal lifecycle, blocked editor shortcuts, unchanged
station/version/history and first/repeated opening times. Browser results belong in
`.agents/skills/metro-repo/references/performance.md`; no numeric V8 coverage was
collected for the new helper.

The exploded-view fixture regressions additionally verify every saved `cfg.flights`
endpoint in Zoo and Tanwei (7 and 19 flights) translates with its parent staircase,
including fractional half landings, with the original station unchanged. The
irregular-tray test pins compact projected packing without empty bounding-box corners.

Exploded-view live rendering adds pose-buffer immutability/reuse, train-origin
rounding and segmented-cabin ownership (including the terminal stop) to
`exploded-view.test.mjs`. `line-edit` pins secondary frame subscriptions alongside
the main viewport, paused replay, unsubscribe and stale-frame clearing on station
reset. `topbar-playback` now checks shared `SimulationControls`; both toolbars use
it. The production exploded-view check also drives live playback, real WASD and
left/middle drags while checking that the original editor camera and document stay
unchanged. See the shared performance reference for measured run details.

The current exploded layout regressions use solid floor boundaries and permit 15%
overlap across the station's short axis, preserving its longitudinal alignment.
They cover interlocking irregular plans, ignored remote props and direction-aware
live streams. Exposed soil caps are removed while finished floors/supporting walls
remain. `exploded-passengers.test.mjs` drives the real CrowdSystem to pin immediate
storey transfers in the standalone view, smooth same-floor walking, and unchanged
normal-game interpolation. The production check includes right-drag pan as well as
middle drag, orbit and WASD. Current measurements and visual review are recorded in
the shared performance reference.

Exploded-view wall regressions now include a three-course near wall, its corner
intersections and a column without a floor base, while preserving the back wall.
Ground-decor coverage includes fences, guideposts, cameras, cabinets and benches,
with retained exits and underground/elevated equipment. Real saved stair-flight
fixtures also keep structural grade connections intact.

Raised-floor exploded-view coverage selects broad exposed floor surfaces at their
actual height within a story, rather than only cells at the nominal storey base.
Synthetic sparse-base fixtures and real Tanwei exposed concrete tiles at 1, 6 and
11 m pin footprint-based offsets and protection from the front-wall filter. Explicit
opening/suspended ceilings remain excluded. See the shared performance reference
for the production visual check and first/repeated opening measurements.

`exploded-support.test.mjs` covers the prepared support index and presentation-only
passenger compaction in `render/explodedPassengers.ts`: hidden street/removed-roof
pedestrians, retained raised/underground floors and riders, authored ramps/lifts,
identity/order retention, and Tanwei tunnel-cap removal with preserved raised decks.
Ground-decor fixtures distinguish physical street anchors at 0 m from actual raised
station fixtures at 1 m. The production browser check now compares visible versus
total passengers and rejects non-riding pedestrians on the hidden street plane.
Measurements and visual review are recorded in the shared performance reference.

Ground-height room regressions in `exploded-support` distinguish authored interior
floor labels from outdoor paving. They pin retained room furnishings and pedestrians,
removed outdoor pillars, immutable source data, and the real Tanwei restricted/toilet
room cells and fixtures. Passenger support excludes covered solid cells and no longer
rejects every walker solely for being at 0 m. The production check retains Tanwei's
ground-room cells and rejects detached bridge pillars instead of banning all 0 m people.

The roof-ring regression adds an upper wall course and hanging fixture outside an
actual mezzanine landing, and checks the real Tanwei `(25,-9,-5)` roof-edge cell is
removed. Focused coverage of `exploded-view` and `exploded-support` reports 100% lines
for both helpers; `explodedView.ts` has 93.75% branches / 93.94% functions and
`explodedPassengers.ts` has 81.25% branches / 100% functions. The broad coverage run
was stopped after over eight minutes without a reported test result; it is incomplete.

Above-ground room filtering is pinned with a labelled concourse connected to a
bare support beam, a detached rooftop utility pad and exterior-only stair/exit.
The real Tanwei regression expects only -10/-5/0/5/10 m trays, preserves labelled
usable floors and omits its detached virtual entrance. Stair-flight translation
checks apply to every retained flight; exterior-only connections are intentionally
absent. Documents without authored above-ground floor labels retain their existing
unfurnished-floor fallback.

The global-stats suite also covers memory-only lease acquisition/renewal,
expired-token retries, stable submission ids, 403 preservation, and Retry-After
with an injected clock. Worker tests in `stats/test` separately use real SQLite
to verify transactional duplicate suppression and station metadata preservation.

Music: `music.test.mjs` covers full-track licenses/hashes/asset limits, streaming rotation, pause persistence, mute, visibility, retry and late-start cancellation.

`three-storey-ramps` pins the contiguous 12–16 m range, 15 m default, endpoint-derived span/length and all rotations for both escalator directions and straight/turning stairs.

The ceiling-cells and floor-geometry suites pin untagged upper-floor linings at (79,-101,-11), current-storey slicing, seam edit restoration, and diagonal ambient-occlusion cache votes.
