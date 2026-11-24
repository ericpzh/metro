# `game/test/` Suite & Support Map

Categorized index of every `*.test.mjs` file in `game/test/`, shared helpers, and fixtures. Suites marked `[P]` belong to `npm run test:perf` (`game/package.json`).

## Support harnesses & fixtures

| Path | Role |
|---|---|
| `support/scenario-station.ts` | Controlled 3-storey Wusi Square rig (`upEscalators`, `downEscalators`, `gates`) |
| `support/stub-canvas.mjs` | Recording 2D canvas capturing fills, strokes, text, images, rotations |
| `support/tracking-canvas.mjs` | Transform-tracking 2D context measuring painted ink bounding boxes |
| `support/pictograms.mjs` | Reads shipped `src/assets/pictograms/*.png` off disk for sign tests |
| `support/camera-rig.mjs` | Headless `CameraSystem` + DOM-shaped `OrbitControls` stub (no WebGL) |
| `support/palette-models.mjs` | `SINGLE_MODEL_OPTIONS` (`MODULE_OPTIONS` minus compound `tv-double`) |
| `fixtures/covered-rail-clearance.metro.json` | Saved station fixture for 5 m covered-rail and PSD clearance |
| `fixtures/tanwei-exit-b.json` | Saved station fixture for exit-bay wellway and stair mesh probes |
| `wasm-routing.mjs` | Opt-in Rust/WASM A* parity suite (`npm --prefix game run test:wasm`) |

## Architecture, benchmarks & build guards

| Suite | Covers |
|---|---|
| `layering.test.mjs` | One-way `app/ -> render/ -> sim/`; `sim/` DOM/three/React-free |
| `scene-wiring.test.mjs` [P] | `SceneRenderer` sibling wiring, atlas drain, coalescing, fast paths |
| `benchmark-camera-tour.test.mjs` | LOD0 close-up tour (`D ∈ [10, 15] m`), ±5 m `Q`/`E` hotspots, 7/60/240 FPS + stall invariance, Web↔Unity bounds convergence |
| `benchmark-route.test.mjs` | Benchmark quality isolation, `FrameTimeChart`, `tour` mode wiring, pure-DOM station selector guard (no `<select>`) |
| `benchmark-stats.test.mjs` | Benchmark FPS, 1% low, and `FrameTimeChart` ceiling/SVG path math from frame intervals |
| `editor-action-benchmark.test.mjs` | Action-benchmark manifest for all palette subtypes, settings, demos |
| `editor-action-matrix.test.mjs` | Focused action-matrix merging, ordering, incomplete-run refusal |
| `editor-build-fingerprint.test.mjs` | Canonical build/audit source hash and stale-input detection |
| `placement-benchmark.test.mjs` | Authored placement benchmark targets with extra visible cells |

## Simulation core, demand, routing & worker

| Suite | Covers |
|---|---|
| `rng.test.mjs` | Seeded PRNG determinism and distribution (`sim/rng.ts`) |
| `clock.test.mjs` | Sim clock civil date, weekday/day-type mapping, readouts |
| `demand.test.mjs` | Weekday/weekend arrival curves, peak windows, demand knobs |
| `headway.test.mjs` | Consist menu, headway clamping, train dispatch curve |
| `history.test.mjs` | Per-minute metrics history, LOS order, baseline sample, resets |
| `determinism.test.mjs` | Same seed + tick replay producing identical crowd positions |
| `capacity.test.mjs` | Station-wide LOS comparison (under-built vs expanded rig) |
| `demo.test.mjs` | Zoo/Tanwei/Tianhe saves: circulation, entrances, clean zones |
| `load.test.mjs` | Station switches resetting crowd, trains, queues, clock |
| `sparse-routing.test.mjs` | Sparse router, soft claims, Spanish-solution clearance, work caps |
| `crowd-routing.test.mjs` | Congestion detours, itinerary tails, bounded search waves |
| `wayfinding.test.mjs` | Path costs, mode shares, ramp/lift relief, retries, replan caps |
| `diagonal-walk.test.mjs` | Diagonal `sqrt(2)` cost, 2×2 clearance, barrier checks |
| `walking-profiles.test.mjs` | Slow/medium/fast passenger speed profile distribution |
| `walking-space.test.mjs` | Corridor lanes, detours, PSD queue/alighting aisles, edges |
| `agent-route.test.mjs` | Selected passenger route preview polyline and 1.5 m scale |
| `gates.test.mjs` | Entry-only, exit-only, and two-way turnstile graph policies |
| `gate-door.test.mjs` | Working lane vs closed fence turnstile state, Tab, ghost key |
| `gate-traffic.test.mjs` | Approaching lane reservations, opposing drain, wait totals |
| `sim-pause.test.mjs` | Paused freeze for escalators, gates, doors; consist settle |
| `worker-preview.test.mjs` [P] | Worker acks, skipped cosmetic rebuilds, routes, cancellations |
| `global-stats.test.mjs` | Client ID, opt-out, station/passenger deltas, queue, beacons |

## Document, grid, structure, zones & persistence

| Suite | Covers |
|---|---|
| `save.test.mjs` | `formatVersion` 1 round-trip, errors, initial storey restore |
| `autosave.test.mjs` | Dirty-only autosave, undo/redo, replacement, quota retries |
| `grid.test.mjs` | 1 m integer editing grid invariants and bounds |
| `storey.test.mjs` | 5 m storey bands and 0–4 m `levelBase` offset semantics |
| `storey-height.test.mjs` [P] | Single 5 m profile: factories, ceilings, lookup, scaled trains |
| `ground.test.mjs` | Inverted `z = 0` street plane, holes, window, cache parity |
| `walls.test.mjs` | Auto wall rings, scoped floor gestures, wall ownership |
| `halfwall.test.mjs` | Half-thickness wall tags, faces, paint, placement |
| `wall-cuts.test.mjs` | Shared-cell cut mixes (half walls and thin-wall corners) |
| `triangle.test.mjs` | 45° wedge drag lines, ridge joins, paint, cap finishes |
| `surfaces.test.mjs` | Floor/wall/ground finishes, walk cost, whole-wall/underside paint |
| `contact-finishes.test.mjs` | Contacting face cleanup across cuts, slopes, ceilings, undo |
| `ceiling-cells.test.mjs` | Explicit/inferred horizontal ceilings and hide boundaries |
| `zones.test.mjs` | Fare-zone barriers, room overlays, track beds, ceiling exclusion |
| `facility.test.mjs` | Legacy facility footprint helpers, booth fronts, benches |
| `openings.test.mjs` | Ramp shaft carving, wall preservation, cached reads |
| `slope-cut.test.mjs` | Sloped block carving beneath ramps/rails and upper landings |
| `ramp-fill.test.mjs` | Terrain filling up to ramp soffits and escalator trusses |
| `ramp-surface.test.mjs` | Rotated stair/escalator soffit contact vs cuts and seams |
| `ramp-block-placement.test.mjs` | Underside wedge carving and block/door placement by ramps |
| `structures-gaps.test.mjs` | Structural repair edges, bridge railing cycle, base repair |
| `validation.test.mjs` | Single placement verdict shared by preview and commit |
| `placement.test.mjs` | Collision footprints, stair/escalator footing, wall ranking |
| `local-cell-edit.test.mjs` [P] | Bounded cell deltas, immutable docs, live occupancy indexes |
| `population-edit.test.mjs` [P] | Population/timetable/curve edits keeping geometry and crowd |
| `nonstructural-updates.test.mjs` [P] | Artwork-only presentation patches and exit open flags |

## Vertical circulation, ramps, lifts & exits

| Suite | Covers |
|---|---|
| `stairs.test.mjs` | Straight/turning stairs, block-grid widths, landings, Tab |
| `escalators.test.mjs` | 1–3 block escalators, openings, rates, return glass, reverse |
| `escalator-length.test.mjs` | One-floor (2–6 m) and double-storey (7–11 m) 30° runs |
| `three-storey-ramps.test.mjs` | Triple-storey (12–16 m) family, 15 m default, exit snap |
| `walkways.test.mjs` | Level walkways (30/60/90 m), 1–3 widths, step-free, model |
| `bay.test.mjs` | Flush 1 m ramp bays, balustrades, sloped per-tile clearance |
| `ramp-join.test.mjs` | Shared steel infill caps and widened connectors |
| `ramp-passengers.test.mjs` | Lane columns, swept clearance, rail poses, turn traversal |
| `lift.test.mjs` | Elevator walk-graph stops, ride edges, shaft placement |
| `lift-doors.test.mjs` | Per-level front/back/both/none doors, telescoping, save |
| `lift-extension.test.mjs` | Shaft extension snap (`liftAt`) and batched shaft picking |
| `lift-interval.test.mjs` [P] | 3–7 m intervals, uneven stacking, shaft height, caps |
| `lift-size.test.mjs` | Small (2×2) and large (3×3) plans, landings, cabin bounds |
| `lift-style.test.mjs` | Lift interval/housing tile preview refresh and Esc restore |
| `exits.test.mjs` | 1–4 bay exits, 6 m 4-way, virtual 1×1, two-way ramp snap |
| `exit-banner.test.mjs` | Bilingual exit banner typography and red/white rendering |
| `canopy.test.mjs` | Canopy column collision while keeping aisles walkable |
| `overground.test.mjs` | Pillars, thin/truss/shell roofs, stair blocks, doorway exits |
| `pillar-extension.test.mjs` | Anchor-cell pillar snap, 9 slim offsets, turning-stair box |
| `pillar-length.test.mjs` | Pillar width tiles and 2–6 m section height Tab cycling |

## Rails, PSDs, catenary & rolling stock

| Suite | Covers |
|---|---|
| `rail.test.mjs` | Rail carving, derived PSDs, tunnel/bridge snap, power |
| `track-run-length.test.mjs` | Five named run lengths shared by tunnels and bridges |
| `track-third-rail.test.mjs` | Third-rail side (`thirdRailSide`) across tunnels/platforms |
| `covered-clearance.test.mjs` [P] | 5 m covered envelope, blocks, 98% train scale, PSD vinyl |
| `catenary-model.test.mjs` [P] | Wire sag, droppers, portals, shallow mounts, Low, dispose |
| `psd-decals.test.mjs` | Platform-face PSD safety vinyl graphics and clearance |
| `psd-end.test.mjs` | Fixed PSD end doors, snapped corners, 1 m covers, picking |
| `psd-header.test.mjs` | Directional terminal matching, bilingual/EN headers, bands |
| `stock.test.mjs` | A/B/C/D/L pose-index order, dimensions, capacities, D doors |
| `trains.test.mjs` | Deterministic train poses, PSD alignment, tunnel runs |
| `train-cabin.test.mjs` | Rider boarding/alighting lifecycle without raising LOS |
| `train-cab.test.mjs` [P] | A/B/C/D/L cab shells, crew/curved doors, city marks, wipers |
| `cab-front-surface.test.mjs` [P] | Indexed cab-skin rays vs full raycaster at seams/shoulders |
| `train-bogie.test.mjs` [P] | Wheelsets, rail-crown contact, flanges, clearance, Low |
| `train-gangway.test.mjs` | Corrugated inter-car bellows (A/B/C/L) and D gangways |
| `train-interior.test.mjs` [P] | Raised cabin ceiling, route boards, sightlines (High/Low) |
| `train-lod.test.mjs` [P] | Authored Low stock (<10%), door/glass swaps, pose reuse |
| `train-pantograph.test.mjs` [P] | 25 overhead formations, elbows, roof wells, HVAC, wire |
| `train-preparation.test.mjs` [P] | Prepared fleet vs worker anchors, 8-consist bound, power |

## Station equipment, furniture, signage & city styles

| Suite | Covers |
|---|---|
| `bench.test.mjs` | Stainless/upholstered/wood benches (1/2 m) & 1 m chair |
| `billboard.test.mjs` | Ad panel WebP catalogue, centred crop, shared materials |
| `booth-model.test.mjs` | Ticket kiosk & info counter notches, glazing, fronts |
| `booth-sign.test.mjs` | Booth-header wall sign snap, width refusal, clearance, ray |
| `calligraphy.test.mjs` | Station-name wall calligraphy, edit retention, rename |
| `ceiling-decor.test.mjs` | Ceiling clocks & CCTV (bullet/dome/hemi), stems, index |
| `checkout.test.mjs` | Four shop counter styles/lengths, support, café, chair |
| `city-style.test.mjs` | GZ/SZ/SH/BJ/CD/CQ/WH/NJ palettes, undo, badges, cab marks |
| `court.test.mjs` | 14×7 m ball courts & dividers: nets, bounds, drag delete |
| `decor.test.mjs` | Litter bins, fire cabinets (S/M/L), glazing, footprints |
| `desk.test.mjs` | Office desks: placeable, rotatable furniture in rooms |
| `door-panel.test.mjs` | Standalone/room swing doors, both-face handles, bounds |
| `fence.test.mjs` | Glass/gate/iron/blue fences, sound barriers, decals, joins |
| `floor-decor.test.mjs` | Floor markings & tactile tiles: variants, rotation, save |
| `glass-panel.test.mjs` [P] | Wall glass courses, curtains, fitted doors, bounded checks |
| `hanger.test.mjs` | Ceiling hanger mounts, raised-floor priority, rotations |
| `lights.test.mjs` | Ceiling light luminous clearance, slab snap, shifted bases |
| `line-map.test.mjs` | Network line maps, dynamic drawing, lazy city poster cache |
| `monitor-signal.test.mjs` | 12-screen CCTV monitors & 3-aspect signals (unbatched) |
| `restroom.test.mjs` | Restroom footprints, urinal placement, booth seating |
| `restroom-model.test.mjs` | 3-sided toilet cubicles, privacy doors, partitions |
| `room-model.test.mjs` | Walled room square perimeter panels and corner geometry |
| `shelf.test.mjs` | Shop gondolas, cooler/clothing/food/fruit/café seams |
| `sign.test.mjs` | Wayfinding sign layout, deletions, compaction, empty faces |
| `sign-editor.test.mjs` | Sign editor draft, deferred drag preview sync, ✓ commit |
| `sign-model.test.mjs` | 3D sign board housing, hangers, panel sizing (`buildSign`) |
| `sign-render.test.mjs` | Sign canvas pixels, arrows, pictograms, 0.4 m boards |
| `station-display.test.mjs` | TV timetable (`sim/trainSchedule.ts`), track, signals |
| `street-decor.test.mjs` | Outdoor street furniture requiring above-ground floor |
| `tv-double.test.mjs` | Single/double-sided TV palette option committing as 1 |
| `tv-pair.test.mjs` | Back-to-back opposite-facing TVs sharing tile & housing |
| `tv-screen.test.mjs` | Lit TV screen panes proud of dark backing slab |
| `vending.test.mjs` | Vending machine footprint, unpaid stop rate, cabinet |
| `vent.test.mjs` | Ceiling vent grille snapping, sweep/move, save round-trip |
| `outdoor-surfaces.test.mjs` [P] | Sidewalk/lawn tiles, trees (walkable, collision), bulk |

## Roads & road traffic

| Suite | Covers |
|---|---|
| `roads.test.mjs` | Road widths, opposing lanes, long-axis drags, support |
| `road-document.test.mjs` | Road nodes, splits, merges, one-way flip, migration, undo |
| `road-network.test.mjs` | Crossroads/T-joins, turns, signals, stop lines, buses |
| `road-performance.test.mjs` [P] | Road preview preparation without per-m² document rescans |
| `road-vehicles.test.mjs` [P] | Six vehicles High/Low (<10%), opacity, prepass, disposal |

## Passengers & passenger assets

| Suite | Covers |
|---|---|
| `passenger-activities.test.mjs` | Service stops (machines/seats/toilets/errands), Float32 |
| `passenger-activity-assets.test.mjs` | 16-bone hashes, palettes, both-hand reach, arms, Low |
| `passenger-assets.test.mjs` [P] | Binary asset delivery, fetch errors, `<25 MiB` Worker cap |
| `passenger-atlas.test.mjs` | Lossless temporal delta packing (16-bit pos, 8-bit norm) |
| `passenger-clothing.test.mjs` | FBX/recipe hashes, RGB stops, skirt shell bridge, faces |
| `passenger-library.test.mjs` [P] | Adult/child appearance/bag pools, decoders, poses, straps |
| `passenger-lod.test.mjs` [P] | Hard 10% Low budget, zero arm/body webbing, silhouette/ground checks, dispose |
| `passenger-size.test.mjs` | 20% child pool, 98% scale, height/width ranges, shadows |
| `passenger-view.test.mjs` | Instanced crowd, stair stride, handedness, bags, picking |

## Scene, camera, batching, LOD & exploded view

| Suite | Covers |
|---|---|
| `module-build.test.mjs` | Procedural model dispatcher, bounds, apertures, handles |
| `model-detail.test.mjs` [P] | Palette sweep for `<10%` (or cap) Low pre/post batching |
| `geometry-detail.test.mjs` [P] | Distance/storey detail swaps, allocation reuse, dispose |
| `batching-lifecycle.test.mjs` [P] | Batching lifecycle, UVs, exclusions, move masking, picks |
| `draw-batching.test.mjs` [P] | Train stock/doors, 16/64 m buckets, panel atlas, eviction |
| `chunk-cache.test.mjs` | Chunk GPU buffer reuse across edits and teardown |
| `floor-geometry.test.mjs` [P] | Incremental remesh vs fresh mesh, pavement cache, ceilings |
| `floor-surface.test.mjs` | Flat floor plane merging and square rim meshing |
| `static-rendering.test.mjs` [P] | Outdoor instancing, transparent order, 3-level trees |
| `render-performance.test.mjs` [P] | Static batching bounds/picks, single cap AO, paint reuse |
| `threejs-tianhe-perf.test.mjs` | Canonical untextured keys, exploded deferred instancing, budgeted TV repaints & O(1) visibility, escalator phase resync, stamped sim replay |
| `render-regressions.test.mjs` | Label fit, thick-pillar collars, obsidian pixels, rough |
| `performance-policy.test.mjs` [P] | Placement caches, fail-closed policies, RAF, culling |
| `equipment-retention.test.mjs` [P] | Remote retention, dependencies, contact shadows, hovers |
| `level-slicing.test.mjs` | Storey slicing, ghosts, occupied-storey rule, dense cap |
| `level-view-cache.test.mjs` [P] | Q/E view reuse, 4-view eviction, 5 m prewarm, grid reuse |
| `grid-visibility.test.mjs` | Hide UI editing lattice toggle and slice restoration |
| `ground-visibility.test.mjs` | Hide Ground street mesh, painted ground, tiles, roads |
| `cut-clipping.test.mjs` | Section-cut clipping assignment, skips, invalidation |
| `section.test.mjs` | Pure section-cut plane arithmetic (`render/section.ts`) |
| `section-drag.test.mjs` | Pointer-driven section-cut handle dragging and clamping |
| `sky.test.mjs` | Hidden-UI sky brightness across day/night and seeks |
| `graphics-quality.test.mjs` [P] | High/Low quality storage, fallback, Hide UI detail policy |
| `upscaling.test.mjs` [P] | FSR 1.0 preset scale ratios and Native default |
| `camera-adapter.test.mjs` | Unity v2 bridge `ViewCube` basis/command sync, `view.set` |
| `camera-fov.test.mjs` | Perspective FOV slider arithmetic (`CameraSystem.fov`) |
| `camera-orbit.test.mjs` | Navigation cube yaw/pitch dragging (`orbitBy`) |
| `camera-vertical-pan.test.mjs` | Ctrl+Q/E vertical pan, plan WASD, `activeZ + 1 m` |
| `touch-zoom.test.mjs` | Pinch/spread zoom limits, cancel, release suppression |
| `view-home.test.mjs` | Reset-to-home camera action (`app/viewHome.ts`) |
| `exploded-view.test.mjs` | Exploded floor ownership, front walls, doc isolation |
| `exploded-layout.test.mjs` | Immutable baked trays, direct picking, reset, front walls |
| `exploded-connections.test.mjs` | Dashed stair/escalator/lift seam guides, reuse, dispose |
| `exploded-passengers.test.mjs` | Live/paused exploded poses and cross-floor transfers |
| `exploded-ramps.test.mjs` | Sliced ramp sections following trays with shared anim |
| `exploded-support.test.mjs` | Omitting street/roof walkers; raised/underground live |
| `exploded-wall-decor.test.mjs` | Wall art following visible panel storey when lower |

## Editor tools, previews, snapping & build rail

| Suite | Covers |
|---|---|
| `blocktool.test.mjs` [P] | 10k-cell cap, red preview, Shift/triangle, witness reuse |
| `block-collision-cache.test.mjs` [P] | Incremental blocked-drag verdicts, retention, order |
| `builder-attributes.test.mjs` | Capability order, dimension tiles, R/Tab, row isolation |
| `column-delete.test.mjs` | G wall placement/column erase by storey, 1 commit |
| `decor-line.test.mjs` | Drag decor rows (0–6 gap), align, wall/ceiling, delete |
| `delete-tool.test.mjs` | Block/module/roof/triangle/lift-ext/outdoor delete, undo |
| `equipment-deletion.test.mjs` | Visible ray-picked module priority over grid cell |
| `equipment-placement-input.test.mjs` [P] | Wall/ceiling aim, ramp/bridge/exit snaps, 1 pick/event |
| `fence-preview.test.mjs` [P] | Local fence joint preview, bucket masking, 0 remote work |
| `frame-preview.test.mjs` [P] | Frame-scheduled latest-target preview, reuse, cancel |
| `geometry-snap.test.mjs` [P] | Real-slab ceiling contact, off-grid anchors, preview/undo |
| `line-edit.test.mjs` | Line edits, immutable undo/redo, station clear, PSD pick |
| `menu-thumbnails.test.mjs` | 132×132 PNG thumbnails for all `MODULE_OPTIONS` & URLs |
| `move.test.mjs` | Lifting, re-aim, course moves, carried landings, verdicts |
| `multi-place-drag.test.mjs` [P] | 50 ms latest-target scheduler, 10k refusal, refresh |
| `paint-mode.test.mjs` | Enamel/paint colors, single/whole-face, swatches, key |
| `palette-settings.test.mjs` | Door width and discrete palette setting previews/commits |
| `pick-cell.test.mjs` | Pointer ray hit resolution to whole 1 m cells & ramps |
| `pick-tool.test.mjs` | Full-palette eyedropper (`P`) copy & Esc restore |
| `placement-surface.test.mjs` [P] | Low-angle beam priority over ground, sidewalk, occlusion |
| `preview-lod.test.mjs` [P] | Single-model previews matching placed High/Low/Hide UI |
| `preview-material-cache.test.mjs` [P] | Preview shader reuse, refusal tints, clipping, disposal |
| `preview-pipeline.test.mjs` [P] | Single-model preview parity vs merged docs, cancel |
| `rail-families.test.mjs` | Rail category membership, order, families, room icons |
| `rail-folders.test.mjs` | Folder titles, Shift+1..0 shortcuts, diagonal tabs |
| `ramp-targeting.test.mjs` [P] | Occlusion blocking coarse PSD/ramp envelopes behind wall |
| `refused-ghost.test.mjs` | Red refused-box pool growth past 4,096 and disposal |
| `roof-preview.test.mjs` [P] | Instanced roof previews (10k tiles/16 m) & block ghost |
| `roof-tool.test.mjs` [P] | Thin/shell/truss roof & stair-block drags, snaps, release |
| `select-agent.test.mjs` | Selection tool passenger pick & hidden-storey rejection |
| `solid-cell-index.test.mjs` [P] | Indexed floor collision candidates for roofs across grid |
| `sweep.test.mjs` | Same-type drag deletion sweep family (`app/sweep.ts`) |
| `tool-hover-preview.test.mjs` | Blue move/pick/select hover tints, red bulldoze, clean |
| `tool-picking.test.mjs` [P] | One shared scene raycast per pointer dispatch |
| `tool-shortcuts.test.mjs` | B/P/M previous-tool toggle and room-front R tile |
| `wall-ceiling-snap.test.mjs` | Storey-base wall snap, glass courses, ceiling anchors |
| `zonetool.test.mjs` | Fare/room brushes, right-click eraser, booth drag |

## UI shell, audio, routes, Unity bridge & concept art

| Suite | Covers |
|---|---|
| `audio.test.mjs` | Outcome cues, 6 assets, 4 sliders, Z-up pan, speed caps |
| `music.test.mjs` | Approved full recordings: licenses, credits, hashes, cap |
| `i18n.test.mjs` | ZH/EN parity, interpolation, `/game` + `/game/en` routes |
| `game-loading.test.mjs` | Early loading shell visibility, dismissal, error text |
| `ui-theme.test.mjs` | Three UI themes: default fallback, apply, reload persist |
| `tutorial.test.mjs` | Empty paused startup, progress/opt-out, benchmark bypass |
| `new-station-confirmation.test.mjs` | Shared `ReplaceStationDialog` save-first confirmation for New (`Ctrl+N`), Example stations, and Open save (`Ctrl+L`) across Web & Unity |
| `topbar-playback.test.mjs` | Top-bar play/pause resuming like Space alongside speeds |
| `topbar-report-issue.test.mjs` | Settings menu report-issue tile layout & outbound action |
| `report-issue-route.test.mjs` | Locale `/stats/report` + `/stats/en/report` & dev host |
| `demo-route.test.mjs` | `/game/{zoo,tanwei,tianhe}` + `/game/en/…` deep links |
| `site-demo-links.test.mjs` | Concept-art site demo picker triggers & links (`web/`) |
| `site-worker.test.mjs` | Concept-art site Worker `/en` redirect & EN asset routing |
| `unity-host-edit.test.mjs` | Host-owned Ctrl+Z/Y, Delete, Escape over Unity bridge |
| `unity-sign-commit.test.mjs` | Revision-fenced `sign.commit` over Unity bridge |
| `art-passenger-heading.test.mjs` | Isometric passenger heading projection (8 directions) |
| `art-sheet-fixes.test.mjs` | Concept-art ramp overrides, clothing variety, PSD clip |
| `capture-passengers.test.mjs` | `?capture-passengers` wiring, foot origin, scale, gaits |
| `passenger-art-pipeline.test.mjs` | Bounded capture batches, stale-build & duplicate checks |
| `passenger-sprite-pruning.test.mjs` | Concept-art sprite pruning keeping referenced aliases |
| `train-art-pipeline.test.mjs` | Bilingual train sheet order, stock power, D doors, bounds |
