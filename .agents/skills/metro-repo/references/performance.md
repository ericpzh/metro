# Performance work in metro

## In-game passenger activities — 2026-10-24

Passenger service now owns the complete activity dwell. TVM/vending customers
approach the real front; cabinets block walking, and benches/sinks/cubicles have
front-only terminal access. Bench seats are independent servers. Errands can be
on a concourse below a street entrance, use the existing budgeted route requests,
and skip missing/unreachable stops. Nearby sinks follow toilets. Service queues
retain connected floor and one active customer per slot; queue ranks update once
per server/tick rather than searching the queue for every body. Gate gestures
continue walking and use the reader-facing hand in either crossing direction.
Lift gestures are selective, while handrail use varies by identity and free hand.
These updates perform no scene pick, station document commit or routing rebuild.

The crowd retains its prepared High/Low instanced draws. A generated activity
asset shares 113,584 bind vertices and two rigs, fitted at eight heights with
24 samples per clip. Its actual padded topology is 9,286 High / 822 Low triangles,
within the existing 9,370 / 841 draw strides; each entry's Low table stays within
10% of its High topology. Pose-only bakes verify every current GLB hash before
updating palettes. The additional packed binary delivery is 10,108,859 bytes;
the largest activity file is the 6,389,615-byte index table, within the 25 MiB
asset limit. Padded activity GPU storage is 16,646,144 bytes for Low alone or
42,500,096 bytes after both detail tables have been used. Bind/index data inflate
on demand, with temporary decoded index buffers released after texture creation.
The walking atlas and all three reviewed GLB walks remain unchanged.

Waiting looks keep the walking atlas, so queues still walk when advancing.
Carrying poses can suppress a large hand gesture; walking skirts retain their
reviewed cloth animation. Seated skirts have an authored lap/knee/shin drape;
the production side-view check measures 61 pixels of seated garment depth against
40 pixels standing for the reviewed long-skirt fixture. Seated picking/eye height
read the same pelvis palette as the shader. Pause and resume retain the displayed
activity, and hold-loop/release interpolation never crosses into another hand
or rail variant. Rail reach/release first lifts inside the belt, then moves onto
its top; the actual-asset regression checks sleeve clearance through intermediate
samples, wrist contact, forward elbows and neutral hands across adult heights,
both sides, directions and lane widths. Source IK solves in the rig frame to
avoid shear from independent appearance dimensions.

`tools/check-game-passenger-activities.mjs` exercises 56 combinations of activity,
adult/child and High/Low detail, including ordinary bodies, backpacks, side bags,
purses, skirts and trousers. Its six-fixture production scene pins pause,
running water, opening doors and closing an occupied cubicle. Isolated captures
retain one crowd draw and report zero shader failures. Raw JSON and screenshots
are under `.preview/game-passenger-activities/`; the model studies retain their
separate `.preview/model-interactions/` checks. These are functional/GPU checks,
not a matched FPS or input-latency comparison.

Final verification: the production build, all 18 model tests and the passenger
regressions pass. The full game run reports 2,407/2,410 passing; its three failures
are Settings-menu source assertions in concurrent audio/upscaling work, outside
this activity change (`.preview/passenger-activities-suite-complete.log`).

The seeded `tools/bench-passenger-activities.mjs` run uses seed 99, 08:00 and
1,200 one-second ticks per authored demo. Raw results are in
`.preview/perf/passenger-activities/report.json`:

| Station | Maximum crowd | Mean tick | p95 tick | p99 tick | Started service visits | Slot conflicts |
|---|---:|---:|---:|---:|---|---:|
| Zoo | 760 | 5.37 ms | 10.86 ms | 16.11 ms | 42 bench, 29 vending, 10 TVM, 7 shelf, 2 toilet, 1 sink | 0 |
| Tanwei | 2,002 | 34.75 ms | 76.28 ms | 94.39 ms | 61 bench, 82 vending, 30 TVM, 8 toilet, 7 sink | 0 |

These local diagnostics include changed journeys and service timing, so they
are not a controlled speedup comparison or a certification of real-time 64×
playback. The sampled demos also report 69/55 unroutable trip endings; this work
does not establish that every authored route is reachable. Normal circulation,
optional-stop abandonment and finite poses are covered separately by deterministic
tests. Dynamic swing rigs retain their fittings and stay outside static equipment
batches. The sink's hidden stream leaves its static inventory at 4,972 High / 224
Low triangles; the lift's new cabin panel brings its inventory to 1,776 / 144.

## Model passenger activity previews — 2026-10-23

The model viewer now previews thirteen passenger activities against the existing
equipment builders. This path owns no station document or worker and performs
no scene picking. Selecting an activity constructs its fixture once; paused
frames and timeline changes retain that fixture. Queue skeletons are prepared
when the selected character loads and are visible only in the queue study.

`node tools/check-model-interactions.mjs` captures all thirteen production
scenes and checks five timeline samples each for finite bone matrices and GPU
shader errors. The first scripted selections in one 1440 × 1000 headless Chrome
run took 1.3–10.1 ms including fixture construction and first pose evaluation.
These are synchronous scripted-selection timings, not pointer-to-present
latency or a matched performance comparison. Raw results and captures are in
`.preview/model-interactions/report.json` and the adjacent PNGs. The deterministic
`model/test/interactions.test.mjs` guards limb lengths, reachable contact,
unreachable-target clamping, arbitrary timeline order and loop repetition on
both reviewed skeletons. Full catalogue contact/garment approval and production
crowd atlas integration remain outside this preview validation.
The model build and all 16 model tests passed. The browser activity check also
pins fixture retention while scrubbing, paused time, activity URL state, door
hinge movement, gate retraction and recovery of the original walk transform.
The existing preview-options and model-service browser checks also passed.

The contact-cleanup pass removes all handheld preview objects and uses closed,
simple activity sleeves/hands while retaining the original source for walks and
downloads. Its focused tests include the original stretched coat as a negative
control, source-geometry restoration, seat-top clearance, planted soles and bent
knees on both reviewed rigs. Escalator targets come from the actual model basis;
six production samples (including the next loop) keep the wrist within 2 mm of
its target and the empty palm within −8/+12 mm of the rail's top plane. Actual
recorded wrist error is below 1e−15 m and the sampled palm clearance is below
1e−8 m. `rail-contact.json` and side/close-up PNGs live beside the main report.
The revised thirteen scripted selections took 0.9–10.3 ms in the final captured run;
this remains a functional check, not a matched latency benchmark. The sink's
faucet is now across the basin from the passenger; sitting uses the actual
bench/toilet seat heights rather than the previous pelvis/ankle estimates.
The cleanup build, all 18 model tests, the production interaction browser check,
and the existing preview-options/model-service browser checks passed. The final
focused seat check additionally pins upright toilet shins; it passed after the
last foot-position adjustment.
The subsequent escalator reach correction keeps rail contact ahead of the
shoulder, rather than accepting a physically touching but backward arm pose.
The production regression now requires at least 8 cm of forward reach; all six
ride/loop samples measure 12.8 cm while retaining the palm-plane contact bounds.
The build, side-view inspection and interaction browser regression passed.
The follow-up overhead check caught the cuff/upper sleeve crossing the rail
despite correct palm contact. The passenger now stands at the step centre,
the elbow bends inboard, and the wrist stays 9 cm inside the rail centreline;
the hand reaches sideways onto the inner top edge. The browser regression
samples sleeve vertices, triangle centres and edge midpoints against the solid
rail cross-section at six ride/loop times, requiring zero penetrations. Palm
clearance is checked only for hand points within the rail's actual width.
Side and overhead captures are retained under `.preview/model-interactions/`.
The build, four focused model tests and the updated production browser check
passed after this correction, including zero sleeve penetrations at all six
sampled ride/loop times and palm contact within the actual belt width.
The final bend-direction correction removes the overly inward elbow pole that
folded the forearm across the chest. The contact point sits farther ahead and
the elbow pole points mostly downward, allowing the elbow to stay outside the
shoulder while the forearm continues forward. The regression additionally
requires over 1 cm outward elbow offset and over 3 cm forward wrist offset from
the elbow, alongside the unchanged rail-clearance/contact checks. A straight
overhead `escalator-top.png` capture now complements the oblique overhead view.
The build, focused model tests and production browser check passed.
The wrist correction removes the explicit hand-orientation override: the hand
now inherits the forearm orientation without a sideways twist. The activity
cuff tapers to a 34 mm radius, with a recessed skin wrist overlapping the cuff
by more than 15 mm. The rail wrist target is 8 cm inboard and 15 mm above the
belt's top plane, preserving sleeve clearance with the neutral wrist. The
browser regression requires an unchanged local hand quaternion and measurable
cuff/hand overlap, in addition to the forward elbow, belt-width palm contact
and sleeve clearance checks. Source walking and downloadable geometry remain
unchanged.

## Game audio integration — 2026-10-23

Final validation: `npm --prefix game run build` passed, the production browser
audio check passed, and the final `npm --prefix game test` run passed all 2,381
tests (132.3 s). The local Vite service serves the game and all baked audio files
at port 5174. No deployment was performed.

The approved sound-studio cues are baked once into `game/public/audio/` by
`tools/prepare-game-audio.mjs`, including pitch and level shaping. Runtime audio
never imports model assets or performs DSP inside pointer handlers. Settings
contains exactly two local volume sliders (Sound effects / Ambient sound, also
translated to Chinese); zero mutes its group without station commits or history.

`node tools/check-game-audio.mjs` serves the production build in a fresh headless
Chrome at 1440 × 1000 and drives actual pointer place/select/delete/pick/move/refusal
operations. Each produced exactly one correct cue and one scene intersection.
Handler / source-scheduling delay in ms: place 1.3/17.9; select 1.0/5.7; delete 1.0/19.5; pick 1.7/9.3; move 1.5/9.6; refused 0.8/6.2. These
are first actual actions in that browser run (source scheduling, not speaker-output
latency); the longer driver round-trip times include frame waits and are not UI
latency. Raw report, log and settings capture are under
`.preview/perf/game-audio/`; the run followed the build and tests sequentially.

The browser seeded production renderer passenger/train poses and a long road
fixture to keep all source families present while their buffers decoded. Exactly
three ambient loops started with one fetch each. Raising the actual camera 100 m
reduced the same traffic source's computed gain from 0.3818 to
0.0938. Both bilingual labels, zero-output mute, ambient voice
release, reload persistence and unchanged document version during slider edits
passed, with no browser errors. The fixture is integration evidence, not a full
simulated passenger-day or a subjective listening approval.

Ambient snapshots run at most 10 Hz from the final active render camera, with no
raycast or worker request: at most 256 passenger position samples, up to 64 already
rendered road positions, and the retained live train pool. One crowd bed, nearest
active train and nearby road vehicle bed feed three reusable ambient voices;
there are at most eight overlapping one-shots plus a 65 ms interaction cooldown.
Muted ambience detaches its render callback, and hidden tabs stop voices and
suspend their AudioContext. The exploded viewer uses its own active camera and
snapshot coordinates while the suspended editor contributes no sound frame.

`game/test/audio.test.mjs` guards accepted/refused/cancelled outcomes (including
a refusal notice already visible from hover), no-op silence, local preference
repair and persistence, deployed/English asset paths, Z-up distance/pan and finite
radius, 256-sample work bound, source licensing and exactly two sliders. A fake
AudioContext drives the actual audio service's eight-voice cap, three-bed pool,
muting, hidden-tab suspension and cancellation of late decodes. The existing
`tool-picking` and `scene-wiring` tests continue to protect one event pick and
renderer ownership. This feature adds no document or simulation fields.

## Sound audition preview — 2026-10-23

Listening-balance revision: Place is raised about 5 dB (20 ms RMS 0.205),
Select about 6 dB (0.230), and Delete is replaced with a louder damped wooden /
brushed-noise cue (0.200), removing the mechanical switch and pitch glide.
Pick/Move/Refused stay at 0.115. The browser check guards the individual targets,
all six remain below the 0.5 sample-peak ceiling, and mute/lifecycle/layout checks
pass. Cold/warm scheduling: 55.3/0.1 ms.
Equal RMS did not match the user's perceived loudness; these deliberate offsets
supersede the previous uniform-level targets. Raw evidence is in the same folder.

Level-balance follow-up: Move now runs eight semitones below the original
(rate 0.62996); Delete has an 1800 Hz low-pass and an 8 ms rounded attack.
Cached shaping matches all other selected cues to 0.115 maximum 20 ms RMS,
with Delete at 0.050 and a common 0.5 sample-peak ceiling. The production browser
check measures each played buffer's stereo-window RMS and guards these levels
within 0.001, along with the selected rates and peak ceiling. All six passed;
master mute, three ambient loops, stop/cancel, persistence and both layouts still
pass. Cold / warm Place source scheduling: 66.2 / 0.3 ms.
This is signal-level balance for audition, not a perceptual loudness guarantee.

Selected-set follow-up: the interaction panel now contains six fixed cues and
no candidate selectors. A production browser check plays each actual action,
verifies softened impact/pick buffer peaks (0.121 / 0.296), and verifies move and
refusal playback rates (0.79370 / 0.74915, four/five semitones lower). Buffer
shaping runs once after decode and uses the existing cache; the warm Place
scheduling check remained 0.2 ms (cold 54.3 ms). Existing source-budget and
pending-decode regressions still pass; the browser guard checks the selected
tuning reaches playback and that menus remain absent. Three ambient loops,
mute/stop/cancel, persistence and desktop/mobile checks also pass. This supersedes
the earlier all-procedural default; Felt tap alone remains selected from that set.

Soft-cue follow-up: six project-authored mono WAVs are now the default, with
18 ms attacks and measured decoded peaks of 0.105–0.172 (original interaction
candidates measured 0.629–0.877). The original files remain selectable. The
updated browser check decodes all 22 files; the repeated sequential production
run recorded 58.7 ms cold / 0.2 ms warm source scheduling, three ambient loops,
silent master mute, zero remaining voices after stop/cancel, retained mixer
settings, and no overflow/browser errors. Raw results replace the previous
capture under `.preview/sound-research/`. Listening preference remains subjective.

The isolated model-app `/sounds.html` is a research preview, with no game scene,
document, simulation or picker changes. `node model/node_modules/vite/bin/vite.js
build model` builds both model entries; `node tools/check-sound-preview.mjs`
serves that production build and drives a fresh headless Chrome session.
Raw results and desktop/mobile captures are in `.preview/sound-research/`.

The final run was sequential after builds and model tests finished, at 1424 px
desktop and 390 px mobile. The first actual Place button activation took 51 ms
from click to AudioBufferSourceNode.start (including AudioContext resume, fetch
and decode); the repeated activation took 0.2 ms with one cached decode. These
are source scheduling times, not measured speaker-output or hardware latency.
All 16 local files decoded to nonzero signals. Scene playback retained exactly
three ambient loops, output peak was 0.02285 in the sampled window, master mute
reached zero, and Stop All/startup cancellation left zero active sources. Increasing
camera height from 8 to 45 m changed crowd distance from 23.8 to 54.5 m and its
distance gain from 50% to 22%. Settings survived reload, neither viewport overflowed,
and no browser errors were recorded. This is functional audition evidence, not
a game FPS measurement or a listening approval.

`model/test/sound-spatial.test.mjs` pins full-height distance, monotonic falloff,
finite radius, bearing reversal and persisted-setting validation.
`model/test/sound-engine.test.mjs` pins the eight-one-shot budget, node release
and cancellation of a pending decode. The preview keeps three ambient voices and
decoded-buffer reuse; game integration must preserve bounded sources and reuse
the existing event pick without additional scene queries or document commits.

This is the repo's single performance reference: the contracts that keep the game
interactive, the current model inventory, and the measured state of the production
paths. Raw profiles, reports and screenshots belong in ignored `.preview/perf/`.

Performance work is part of `metro-game` and `metro-game-test`. For every change,
measure the reported interaction — including its first invocation — and leave a
deterministic work-count regression that fails if the measured cause returns.
Browser timings are evidence; deterministic assertions are the gates.

## Reproduce the reported interaction

Measure the actual event sequence before choosing an optimization. For a drag,
separate hover, pointer-down, first movement, continued movement, release and
cancel. Compare the first invocation with warmed repetitions. A smooth steady drag
can hide a long initialization stall; placement-helper timings alone do not measure
the pointer handler or the first rendered frame.

Use the supplied station through `BENCH_STATION` without replacing the shipped
demo. `node tools/bench-stair-drag.mjs` drives real browser input and counts
raycasts on initial stair-block pickup. `bench:sim` measures CPU helpers and
simulation; `bench:browser` measures the app, worker and rendered frames.

Record work counts alongside time: raycasts per event, graph/model rebuilds,
allocations, uploads and cache hits. Do not locate a picked module by scanning with
a scene raycast per document entry (`modules.find(m => m.id === pickModule(...))`
repeats a full scene raycast on every miss). Pick once, then find the document entry
by ID. Test both a miss and a hit near the end of a realistically large module list.

The demo workflow tour (`npm run bench:usage-tour`) loads Zoo and Tanwei in separate
fresh browser sessions, records fixture size, browser, viewport and GPU backend,
and writes `.preview/perf/usage-tour.json`. It sweeps all 120 palette options
through cold and warmed production model previews, measures first and repeated
hover for all 11 pointer tools, performs a real bench place, move, pick, delete and
undo round trip, and records WASD pan, Q/E storey changes, wheel zoom, orbit drag,
line colour, exit open/restore, date selection and play/pause. Set `BENCH_DEMO`
for one fixture and `BENCH_OUTPUT` for another report path; `METRO_BROWSER_GPU=hardware`
opts out of the default SwiftShader backend. Tour timings include protocol round
trips and are diagnostic, not pass/fail thresholds.

### Q/E level switching

Use `node tools/bench-level-switch.mjs` against both shipped demos after building
`game/dist`. Record the first real Q/E press separately from warmed presses,
opening prewarm time, batch-cache hits, retained allocations, draw calls and
triangles. `--no-multi-draw` checks the fallback renderer. A level-cache hit must
preserve exact batch allocations and must not advance the paused simulation.

Opening prepares the actual editing storey and both valid Q/E neighbours from
`levelBase`, using `STOREY_HEIGHT` and `levelSteps(levelBase)`. Never infer
neighbours from the lowest rendered chunk or assume a four-metre step. The editing
grid translates on Q/E while retaining its geometry and buffer, rebuilding only
when horizontal station bounds change. Pin neighbour boundaries, shifted bases,
cache invalidation/disposal and grid allocation identity in
`game/test/level-view-cache.test.mjs`.

## Keep interactive work bounded

- Hoist event-invariant queries out of loops and predicates. Reuse the hit,
  camera aim and document indexes throughout the event.
- Keep previews out of undo/commit and worker routing paths. Validate on release
  and commit the accepted run once.
- Coalesce replaceable pointer previews per frame; flush before release and
  cancel stale callbacks on cancellation, tool changes or unmount. Preserve all
  samples for deletion sweeps and touch gestures that depend on the path.
- Count a drag's footprint arithmetically before allocating it. The shared
  `MultiPlaceDrag` scheduler uses a 50 ms latest-target throttle for block, wall,
  fence, tactile, road, tile-equipment and related placement drags: target changes
  replace pending work without restarting the timer, so motion does not starve
  preview. It skips an unchanged rendered target, keeps the prior accepted preview
  visible while work is pending, and flushes/cancels on release/cancel. Roofs use
  a one-callback frame scheduler. Preserve each tool's preview/refusal contract;
  known over-budget targets clear accepted layers immediately and remain refused
  whole. The 10,000-cell budget applies to all supported placement drags and
  includes generated auto walls.
- Never assume the configured wait is the full delay. Profile callback work,
  ghost submission and event-through-two-RAF separately, for both the first and
  repeated interaction. Keep CPU readiness distinct from displayed-pixel/GPU
  latency. Demo stations expose collision cascades that empty-floor fixtures miss.
- Cache block occupancy and exact blocker verdicts by immutable `cells`/`modules`
  arrays; prepare collision bodies once per module snapshot and query local spatial
  buckets. Bound per-snapshot verdict retention. A blocked drag may retain one
  refused coordinate as a constant-time red-cursor witness while its footprint
  covers that coordinate; clear it on geometry/settings/footprint changes. Do not
  reuse scheduler output across document identity changes just because the pointer
  key or station epoch is unchanged. Preserve refusal priority, blocker order,
  exact geometry and partial-acceptance/release semantics.
- Retain unaffected geometry and GPU allocations. Move pickup/cancel masks the
  lifted piece and restores neighbours without rebuilding the station.
- Key prepared data by immutable document inputs and test invalidation. Bound
  caches that retain GPU resources and verify disposal on eviction and teardown.
- Preserve picking IDs, storey visibility, material ownership, animation and
  geometry. Hidden drawing must not change simulation ticks, RNG, train dispatch,
  routes or passenger identity.

### Pointer picking and geometry snapping

Pointer tools resolve one event-scoped scene ray and a lazy scene intersection
snapshot, then reuse the visible hit or miss for every block, module, surface,
normal, bounds and roof query. Overlapping lift roots are traversed once;
plane-only queries do not traverse scene geometry. Each interpolated deletion
sample keeps its own cached position. Queued movement is flushed before the
release event's pick scope opens. The shared snapshot lives in
`render/scene/systems/CameraSystem.ts` and is dispatched through `Viewport.tsx`.
Never invoke a scene raycast inside a document search predicate.

Placement and move snapping follow actual scene geometry, never a nominal storey
band or editing base: floor, wall, ceiling, beam and shaft surfaces decide the
anchor. Prefer the nearest visible object surface over terrain behind it; map
hanger hits to the hanger's real attachment anchor and leave support/refusal to the
shared validator. Preserve erase and floor-paint policies.

Fresh and carried module anchors resolve through `app/tools/moduleAim.ts`. Selection,
picking and deletion fallbacks resolve through `app/tools/moduleTarget.ts`; coarse
stair/escalator/walkway envelopes cannot make a run selectable through a nearer
visible block, and forgiving bounds queries reject runs whose actual surface lies
behind that block. Preserve outdoor canopy and paving priority.

`tools/check-geometry-snapping.mjs` drives real mouse placement/move fixtures for
slabs, hangers and wall mounts across editing bases 0, 2 and 4, plus low-angle
object picks for construction tools: 69 dispatches, maximum one raycast per
dispatch, no browser errors. The slab preview/commit/move anchor stays at 17 m and
the hanger anchor at 11 m at every base. `tools/check-tool-picking.mjs` covers
ceiling props, ramp occlusion, deletion, undo/redo and all eleven tools' first/warm
hovers: 38 dispatches, one raycast maximum, no browser errors. Pin event reuse in
`tool-picking.test.mjs`, ramp occlusion/deletion/undo in `ramp-targeting.test.mjs`,
geometry anchors in `geometry-snap.test.mjs`, and low-angle targeting/occlusion in
`placement-surface.test.mjs`.

### Placement invalidation and model retention

Every equipment, structure and decor module is classified against the inputs its
builder actually reads. Unknown future dependencies keep the conservative rebuild
path. The current policy retains remote models as follows:

| Placement work | Current behaviour |
|---|---|
| Roads | Rebuild only when a road's ink, junction sides, arrival markings or signals change |
| Tracks/platform screens | Compare third-rail side and neighbouring gantry posts; screens retain their owning-track dependency |
| Screen-end returns | Rebuild the return when its referenced corner changes |
| Pillars/roof hangers | Compare supporting bridge height or actual suspension heights |
| Hung decor | Compare the actual common ceiling height |
| Ramps/lifts/exits | Retain remote pieces; conservatively rebuild intersecting columns and nearby landings |
| Sidewalk/lawn | Compare actual opening/ground visibility |
| Tool occupancy and chunk preparation | Reuse prepared inputs for equipment-only edits within the existing street window |
| Road, screen end, moving walkway | Skip chunk preparation/remeshing when cells and street bounds are unchanged |
| Existing signs/inscriptions/maps | Repaint only changed plate inputs; name/line edits still propagate |
| Contact shadows | Retain batches and power-of-two capacity; upload changed matrices only; shrink excessive capacity and release empty levels |
| Functional simulation edits | Install the latest snapshot in one queued worker task per 100 ms window |

The worker retains its old document and graph together until installation; ticks
continue against that coherent pair. Cosmetic edits join pending topology work.
Installing an edit does not advance the simulation clock. Loading another station
cancels pending edits, and a burst undone to the applied document skips the graph
rebuild. Initial station loading remains immediate. The queued job still performs
a complete graph rebuild; the change coalesces and defers that work rather than
making graph construction incremental.

Structural edits invalidate dependent model families. Functional equipment edits
inside the existing street window skip chunk remeshing independently of the
worker's routing decision. Common hover previews use the prepared station; move
pickup caches its one removal, and coupled previews keep their candidate list.
Curtain lookup uses the immutable glass index rather than scanning unrelated
modules.

Deterministic work counts live in `placement-invalidation` and the related
`stationGeometry`/`moduleDependencies`/`structuralModelInputs` suites. The current
policy adds the 119 palette options beside a remote catalogue containing every
option and replaces no remote models on placement or deletion. Remaining
document-wide work is dependency/index bookkeeping and structural chunk-input
derivation. Actual structural/cell changes, street-window expansion, station
metadata/language/artwork changes and unknown model dependencies retain their
conservative invalidation paths. Chunk meshes and equipment draw buckets still
reuse unchanged GPU allocations.

### Settings and presentation edits

Settings and presentation edits have a separate fast path. Line/station/exit
labels, line colours, termini (including optional English secondary names),
population, exit policy, headways, opening hours, peak windows and demand curves
must not rebuild station geometry or routing. The RHS line editor
(`app/windows/inspector/LineCard.tsx`) uses compact square tiles and fixed-width
headway inputs; keep its bilingual terminus drafts in one commit/undo step.
English terminus names persist in `LineDef` and appear beneath the matching
directional destination on platform signage.

Names, line colours and termini repaint only artwork whose declared inputs changed,
retaining module roots, geometry, materials, atlas slots and static batches. PSD
colour bands use live textures; train recolouring updates the owned livery material
and retains door buffers. Unknown artwork dependencies keep the conservative
rebuild path. Invisible population and exit-policy edits must not request a frame.

Exit open/closed and population changes patch the running document without
rebuilding connectivity or requesting a 3D redraw. Closing an exit excludes new
spawns/destinations while allowing existing journeys to complete. A separate
geometry revision prevents metadata/history changes from rebuilding zone and move
overlays. Restart reuses the static graph, node indexes and collision buffers while
resetting dynamic queues, servers, lifts, dispatch, route caches and routing
scratch state.

Settings history shares the immutable document instead of deep-copying its
geometry. Undo/Redo send compact settings patches and preserve the same prepared
scene/geometry. Structural edits retain the conservative snapshot/build behaviour.
Same-document commits, stale line IDs and unchanged scalar line patches do no work.
Explicit stock/cars/power/PSD retries still run: an identical geometry option can
legitimately retry a previously refused rail resize after removing a blocker.

`nonstructural-updates`, `equipment-retention`, `train-lod`, `line-edit`,
`population-edit` and `scene-wiring` pin these contracts.

### Build-rail thumbnails

The build rail's module previews are checked-in 132 × 132 PNGs generated by
`tools/render-menu-thumbnails.mjs`; do not restore startup WebGL thumbnail
rendering. The source PNGs total 648 KiB for all 120 options. The rail uses async
decoding and native lazy loading. After changing the module catalogue or preview
renderer, regenerate them with `npm --prefix game run build`,
`npm --prefix game run render:menu-thumbnails`, then build again. Keep the
catalog/asset regression in `menu-thumbnails.test.mjs`.

### Suspended ceilings

The 吊顶 variant follows the same `checkBlockCells` preview and release path as
ordinary blocks. Keep the original station arrays intact during hover so the block
index and verdict cache remain reusable; never prepare a copied module list or
relocate existing hung fixtures. `addSuspendedCeiling` validates every cell against
the original station, tags and finishes accepted cells, and leaves fixture anchors
unchanged. Normal collision refusals remain in effect. Deterministic coverage pins
preview-cache reuse, fixture anchor retention, overlap refusal, release refusal and
reuse of the ordinary block preview cache in `storey-height.test.mjs`.

## Collect comparable evidence

Run benchmarks sequentially, without builds, tests or other profilers competing
for the host. Use distinct `BENCH_OUTPUT` paths for comparable, final and profiled
runs. Record fixture counts, population, seed, hardware, browser, viewport, storey,
duration, edit count and GPU backend. Changed assets or camera/population are not
a controlled FPS comparison; use the browser harness's paired batching mode for
that question.

Separate CPU submission, asynchronous GPU time and presentation delay. CPU
sampling and Chrome tracing are separate collectors. Discard disjoint or stale
GPU queries. Buffer upload counters exclude textures and uniforms. Capture
console/shader/runtime failures rather than accepting timings from a broken render.

Use `profile:sim` for V8 CPU samples and `profile:browser` for Chrome CPU/trace
exports and GPU diagnostics. Separate application startup, opening a save, cold
resource creation and cache reuse; local HTTP startup is not a WAN measurement.

### Shared interactive previews

`GhostSystem` owns all module/fence preview contexts and resource release.
`ModulePreviewDocument` keeps the immutable station (or one source-removal document
per carried piece); proposed geometry neighbours go through `modelNeighbours`,
never a copied station per pointer cell. Unknown future module kinds retain the
conservative resolver until their dependencies are audited.

Ordinary and carried equipment share `EquipmentPreview`, `EquipmentBatches`,
`SourceGeometryDetail` and `detailHeight` with placed equipment: Low, camera
distance, other-storey and Hide UI must select the same authored geometry.
Instanced roofs retain their source Low link. Restore High references before
disposal. Long roof runs use matching 16 m/storey buckets with shared geometry, so
their far end can reduce independently while all 10,000 tiles remain visible.

Use `clearToolPreview` for cross-tool cancellation, including face ghosts and road
handles; clearing an unused layer must not allocate it. Paint and zone rectangles
share the existing 50 ms latest-target scheduler, while release computes its own
final edit and cancels queued drawing. Face pools grow to cover the full edit.

Equipment collision previews/release share immutable spatial buckets and the fence
connection index; keep fence-arm tile bounds, hypothetical new joints,
carried-origin exclusion, ordered blockers and broad-import fallback intact.
Tactile runs use an anchor index rather than one module search per tile. Glass
joints reject against the full possible fence-arm tile before resolving the four
neighbour directions.

Fence/gate/landing indexes are prepared with the document; candidate connections
overlay that index without copying or scanning the station document, and only the
neighbouring buckets are masked. Keep hidden lower-storey source roots alive
through cancel and release.

`node tools/bench-preview-audit.mjs` sweeps the production palette plus
hover/drag/carry cancellation; `node tools/check-preview-lod.mjs` checks real glass
wall picks, Low/High topology and preview/commit height agreement.
`node tools/check-tool-picking.mjs` covers event reuse and ramp occlusion/deletion.
Keep the `preview-pipeline` and `preview-lod` all-palette geometry equivalence,
local work counts, single ownership and LOD restoration assertions.

### Drag previews and collision

Placement drags share the 50 ms latest-target cadence: blocks, walls, fences
(including the fence-run decor), tactile paving, stair blocks, sidewalks, lawns and
roads. Changing a snapped cell replaces pending work without restarting the timer.
Today's accepted preview remains visible until its replacement is ready. A known
oversized target clears accepted layers immediately and draws the whole refused
footprint on the same cadence. The 10,000-placement limit and release verdicts are
unchanged. Roofs retain their faster one-callback frame scheduler.

Every multi-cell drag that places equipment or decor shares the 10,000-cell budget
in `app/tools/geometry/multiPlaceDrag.ts`. Block patches include generated
auto-wall courses; full-height wall columns count each course; fence and tactile
lines count panels; roof, stair-block and outdoor drags count generated tiles;
roads count their rectangular cell footprint. The count is checked before the
large preview allocation. Over-budget drags are refused whole, show a red footprint
after the pointer target settles, and commit nothing. A 10,000-cell release remains
accepted.

Block collision keeps a per-snapshot verdict cache bounded to 20,000 cells.
Growing/shrinking drags reuse covered cells and check only unseen coordinates.
Changing either the cells or modules array invalidates its verdicts, including
blocker removal/movement and undo/redo. Level occupancy and exact block-collider
bodies are prepared once per module array; lazy 16 × 16 buckets per height course
find nearby blockers. The block cursor keeps one refused coordinate as a
constant-time witness: it remains red while the rectangle covers that coordinate
in the same snapshot, and an unchanged preview key cannot reset it to cyan.
Shrinking clear, station/settings changes, cancel and release invalidate it. The
shared preview scheduler invalidates cached rendered keys when cells/modules
identity changes; `stationEpoch` alone only tracks opening a station. Shift lines
conservatively require the exact preview key before reuse. Broad imported bounds
use a bounded fallback in document order.

Roof previews build one exact model per homogeneous run and instance its geometry;
all variants retain their full shape and rotation. Placement checks use one
immutable document, skip existing tiles through a cached footprint index, and
append accepted disjoint roofs in one edit. Roof collision queries use immutable
cell buckets at each height, retaining the exact collision-box verdict and
naturally invalidating on a new cell array. Accepted roofs use the frame scheduler:
at most one pending animation-frame callback, latest target wins without restarting
the wait, and an unchanged rendered target does no work. The viewport flushes the
work inside its existing coalesced pointer frame. Explicit release drains avoid
building a preview that is about to be discarded. Over-limit refusals keep
immediate red cursor/notice feedback.

The hover and drag paths share the instanced preview path and a 16-entry material
cache keeps the shader owner alive across target replacements. Clearing geometry
does not dispose the last material using that program. Refusal tints are distinct,
source materials stay scene-owned, clipping changes propagate, and eviction/teardown
release cached clones.

`block-collision-cache`, `multi-place-drag`, `frame-preview`, `solid-cell-index`,
`roof-tool`, `roof-preview`, `preview-material-cache` and `blocktool` pin these
contracts. Existing placement and block-tool tests pin release agreement.

### Fence drags and equipment placement

Two production pointer benchmarks cover the station-wide invalidation paths:

- `node tools/bench-fence-drag.mjs` drives hover, press, a long press, three drag
  movements, Escape/cancel and a repeated drag/release over 256 fences. It records
  preview CPU, event-through-two-RAF latency, group counts, `syncBatches` calls and
  hidden-source leaks per phase. Build `game/dist` first; set
  `METRO_BROWSER_GPU=hardware` for hardware timing and give each run a distinct
  `BENCH_OUTPUT` path. `BENCH_CLOSE=1` captures the close view.
- `node tools/bench-tree-placement.mjs` with
  `BENCH_EQUIPMENT_FIXTURE=1 SKIP_LAWN=1 COUNT=1 PIECE=bench` (or `PIECE=tvm`)
  measures the first hover/press/release of one functional piece against 128
  untouched fences. It separates retained/replaced/added models, chunk remesh,
  `setStation` CPU and worker acknowledgement from end-to-end frame latency.

Keep preview work local: prepare the fence/gate/landing index with the document,
overlay the drag's candidate joints, and mask only the affected equipment buckets.
Do not copy the station document for an ordinary hover, and do not remesh or rebuild
unrelated models for a functional equipment edit. `fence-preview` and
`equipment-retention` pin the deterministic work counts.

### Block collision in demo stations

Use `node tools/bench-drag-latency.mjs` with `BENCH_PIECE=block` and
`BENCH_DEMO=zoo` or `tanwei`; choose `BENCH_SIDE` to include the real collision
footprint. This loads the shipped example without replacing its authored data.
Measure cold and warm movement through the real pointer path, including a blocked
rectangle, then compare accepted/refused counts, callback CPU, ghost CPU and the
two-RAF presentation proxy. `BENCH_ASSERT_WITNESS=1` checks that tiny movement
within the same snapped blocked target leaves the cursor red without another
preview draw. `BENCH_PROFILE=1` captures CPU profiles and `BENCH_CONTINUOUS=1`
measures intermediate previews during ongoing movement. Browser timing is
supporting evidence; the deterministic work-count regression is the gate.

## Per-model geometry detail inventory

Triangle counts are for one model built from each palette option's default
configuration. High is the full model geometry; Low uses the renderer's reduced
geometry wherever that model part has a supported approximation, and keeps
unsupported parts at full detail. These are model triangles, not totals across all
placed copies. Width, length, style and material controls can create additional
variants; the table lists the 120 shipped palette options.

Regenerate all four tables with `node tools/model-triangle-inventory.mjs`; it writes
ignored `.preview/perf/model-triangles.{json,md}`, `train-triangles.{json,md}` and
`passenger-triangles.{json,md}`. The inventory builds equipment and trains through
the real renderer path (batching included) and reads passengers from the baked
atlas records. Update this reference after changing models or the detail policy.

### Ambient road vehicles

Ambient road vehicles are seeded into the six models listed below. Counts are per
vehicle instance and include the colour geometry plus its matching depth-only
prepass; the prepass suppresses far-side fittings. High uses 70% opacity; Low
vehicles and Low passenger bodies use 45%. Low road vehicles stay at or below 10%
of High's submitted triangles (including the depth pass). Low is an authored
geometry variant selected by the game's Low graphics setting, not a runtime
simplification. Regenerate the production counts and front/rear captures with
`node tools/check-road-vehicles.mjs`; the ignored report and images are in
`.preview/road-vehicles/`. The app keeps only the active quality visible and packs
traffic into its matching instance buffers.

| Ambient road vehicle | Low triangles | High triangles |
|---|---:|---:|
| Guangzhou bus, pale/orange | 956 | 11,224 |
| Guangzhou bus, red mosaic | 1,014 | 11,506 |
| SUV | 464 | 5,136 |
| Sedan | 436 | 4,984 |
| Moped with rider | 612 | 7,120 |
| Step-through bicycle with rider | 764 | 8,160 |

Each Low model preserves the body outline, windows and required fittings while
reducing wheels, repeated rods, spokes, fender tessellation and bus-window
mullions. Low uses diamond hubs, four-corner body sections, coarse rounded
fittings, flat outward arch strips and LED segments; cars omit door handles and
chrome belt strips. Thin fittings keep their outward face, rods use open triangular
tubes, and bicycle wheels retain two-sided open rims and spokes. The basket keeps
its perimeter. `road-vehicles.test.mjs` pins the reduction, instance switch, pause
behaviour and exact resource release.

### Equipment and decor

The current inventory covers 120 palette models totalling **9,279 Low / 154,963
High triangles**. Every individual High count is unchanged by the Low work. **60
options are strictly below 10%** of their High geometry; **60 use a minimum usable
shape** (44 user-approved exceptions plus 16 two-triangle artwork/floor quads).
`tools/equipment-low-budgets.mjs` shares the strict integer limit
(`ceil(High / 10) - 1`) and explicit exception caps between inventory, regression
and browser checks. No High geometry is inflated to meet the ratio.

Counts are for one built model through the production batching/detail path;
configured sizes and neighbouring pieces can change them. Low combines authored
reductions and supported prepared approximations; unchanged parts keep their High
geometry. A 100% share means that default model has no reduction.

| Equipment / decor | Model ID | High triangles | Low triangles | Low / High |
|---|---|---:|---:|---:|
| 树木 | `tree` | 18,432 | 396 | 2.1% |
| 白色冷柜 | `shelf-cooler` | 9,852 | 420 | 4.3% |
| 深色冷柜 | `shelf-cooler-dark` | 9,852 | 420 | 4.3% |
| 轨道桥 | `bridge` | 9,576 | 720 | 7.5% |
| 白色高架 | `shelf-white-tall` | 7,556 | 240 | 3.2% |
| 深色高架 | `shelf-dark-tall` | 7,244 | 240 | 3.3% |
| 移动网篮架 | `shelf-wire` | 6,524 | 412 | 6.3% |
| 厕所隔间 | `cubicle` | 5,688 | 84 | 1.5% |
| 半球机 | `cctv-dome` | 5,208 | 336 | 6.5% |
| 自动步道 | `walkway` | 5,162 | 290 | 5.6% |
| 立柱球机 | `cctv-post` | 5,096 | 352 | 6.9% |
| 洗手池 | `sink` | 4,972 | 224 | 4.5% |
| 球机 | `cctv-ptz` | 4,924 | 308 | 6.3% |
| 白色矮架 | `shelf-white-short` | 4,420 | 192 | 4.3% |
| 扶梯 | `escalator` | 3,410 | 204 | 6.0% |
| 空调风机 | `ac-unit` | 2,924 | 140 | 4.8% |
| 左直跑楼梯 | `stair-leftForward` | 2,336 | 232 | 9.9% |
| 右直跑楼梯 | `stair-rightForward` | 2,336 | 232 | 9.9% |
| 左双跑楼梯 | `stair-left180` | 2,288 | 222 | 9.7% |
| 右双跑楼梯 | `stair-right180` | 2,288 | 222 | 9.7% |
| 中直跑楼梯 | `stair-centerForward` | 2,240 | 212 | 9.5% |
| 左转角楼梯 | `stair-left90` | 2,240 | 212 | 9.5% |
| 右转角楼梯 | `stair-right90` | 2,240 | 212 | 9.5% |
| 时钟 | `clock` | 1,940 | 188 | 9.7% |
| 单跑楼梯 | `stair-straight` | 1,940 | 150 | 7.7% |
| 枪机 | `cctv` | 1,888 | 124 | 6.6% |
| 电梯 | `lift` | 1,776 | 144 | 8.1% |
| 设备柜 | `electrical-cabinet` | 1,224 | 36 | 2.9% |
| 大 | `extinguisher-glass` | 918 | 86 | 9.4% |
| 有盖 单向 | `exit-covered-1` | 902 | 68 | 7.5% |
| 有盖 双向 | `exit` | 902 | 68 | 7.5% |
| 有盖 三向 | `exit-covered-3` | 902 | 68 | 7.5% |
| 有柱雨棚 | `roof-canopy` | 840 | 56 | 6.7% |
| 圆点提示 | `tactile-warning` | 812 | 4 | 0.5% |
| 铁围栏 | `fence-iron` | 768 | 72 | 9.4% |
| 收银台 | `checkout` | 750 | 64 | 8.5% |
| 新 | `gate-new` | 720 | 68 | 9.4% |
| 信号机 | `rail-signal` | 708 | 64 | 9.0% |
| 自动售货机 | `vending` | 676 | 40 | 5.9% |
| 旧 | `gate` | 668 | 64 | 9.6% |
| 办公桌 | `desk` | 652 | 60 | 9.2% |
| 粗支柱 | `pillar-thick` | 576 | 48 | 8.3% |
| 无盖 双向 | `exit-uncovered-2` | 554 | 52 | 9.4% |
| 无盖 三向 | `exit-uncovered-3` | 554 | 52 | 9.4% |
| 无盖 单向 | `exit-uncovered-1` | 530 | 52 | 9.8% |
| 门 | `fence-gate` | 432 | 38 | 8.8% |
| 收束桁架 | `roof-tapered` | 396 | 38 | 9.6% |
| 售票机 | `tvm` | 372 | 30 | 8.1% |
| 长 | `busstop-long` | 372 | 30 | 8.1% |
| 玻璃围栏 | `fence` | 360 | 26 | 7.2% |
| 不锈钢 | `door-steel-1` | 324 | 20 | 6.2% |
| 玻璃 | `door-glass-1` | 324 | 18 | 5.6% |
| 桁架 | `roof-truss` | 264 | 26 | 9.8% |
| 短 | `busstop-short` | 260 | 24 | 9.2% |
| 圆形 | `light-circular` | 256 | 18 | 7.0% |
| 壁挂式 | `monitor-wall` | 213 | 8 | 3.8% |
| 草坪 | `lawn` | 204 | 12 | 5.9% |
| 垃圾桶 | `bin` | 196 | 26 | 13.3% |
| 通风口 | `vent` | 168 | 32 | 19.0% |
| 靠背座椅 | `bench-seat-1` | 156 | 20 | 12.8% |
| 中 | `extinguisher` | 146 | 12 | 8.2% |
| 小 | `extinguisher-compact` | 146 | 12 | 8.2% |
| 木 | `door-wood-1` | 144 | 20 | 13.9% |
| 人行道 | `sidewalk` | 132 | 12 | 9.1% |
| 屏蔽端门 | `psd-end` | 114 | 30 | 26.3% |
| 电视 | `tv` | 114 | 22 | 19.3% |
| 全高声屏障 | `noise-barrier` | 108 | 46 | 42.6% |
| 半高声屏障 | `noise-barrier-half` | 108 | 46 | 42.6% |
| 交通灯 | `traffic-light` | 108 | 28 | 25.9% |
| 不锈钢 | `bench-steel-1` | 84 | 16 | 19.0% |
| 吊挂指示牌 | `sign-ceiling` | 74 | 18 | 24.3% |
| 吊挂式 | `monitor-ceiling` | 72 | 20 | 27.8% |
| 条形导向 | `tactile-guide` | 60 | 10 | 16.7% |
| 导向柱 | `guidepost` | 60 | 57 | 95.0% |
| 玻璃幕墙 | `curtain-wall` | 60 | 18 | 30.0% |
| 玻璃板 1×1 | `glass-1x1` | 60 | 18 | 30.0% |
| 玻璃板 2×1 | `glass-2x1` | 60 | 18 | 30.0% |
| 玻璃板 3×1 | `glass-3x1` | 60 | 18 | 30.0% |
| 玻璃板 1×2 | `glass-1x2` | 60 | 18 | 30.0% |
| 玻璃板 2×2 | `glass-2x2` | 60 | 18 | 30.0% |
| 玻璃板 3×2 | `glass-3x2` | 60 | 18 | 30.0% |
| 虚拟 | `exit-virtual` | 60 | 46 | 76.7% |
| 道路 | `road` | 50 | 10 | 20.0% |
| 楼梯块 | `stair-block` | 48 | 34 | 70.8% |
| 横版 16:9 | `billboard-wide` | 40 | 6 | 15.0% |
| 标准 2.25:1 | `billboard-standard` | 40 | 6 | 15.0% |
| 大横版 16:9 | `billboard-large` | 40 | 6 | 15.0% |
| 长幅 3.75:1 | `billboard-panorama` | 40 | 6 | 15.0% |
| 竖版 0.7:1 | `billboard-portrait` | 40 | 6 | 15.0% |
| 方形 1:1 | `billboard-square` | 40 | 6 | 15.0% |
| 立式线网图 | `linemap-stand` | 40 | 16 | 40.0% |
| 吊装 | `hanger-roof` | 36 | 6 | 16.7% |
| 立柱 | `hanger-post` | 36 | 14 | 38.9% |
| 细支柱 | `pillar-slim` | 36 | 16 | 44.4% |
| 墙面线网图 | `linemap-wall` | 26 | 4 | 15.4% |
| 地面 单向 | `exit-doorway-1` | 26 | 10 | 38.5% |
| 地面 双向 | `exit-doorway-2` | 26 | 10 | 38.5% |
| 地面 三向 | `exit-doorway-3` | 26 | 10 | 38.5% |
| 地面 四向 | `exit-doorway-4` | 26 | 10 | 38.5% |
| 无桁架 | `roof-shell` | 24 | 8 | 33.3% |
| 栏杆 | `noise-barrier-railing` | 24 | 16 | 66.7% |
| 直条 | `light-rectangular` | 24 | 6 | 25.0% |
| 薄板 | `roof` | 12 | 4 | 33.3% |
| 屏蔽门盖板 | `psd-end-cover` | 12 | 4 | 33.3% |
| 屏蔽门箭头 | `floor-mark-boarding` | 2 | 2 | 100.0% |
| 排队等候线 | `floor-mark-waiting` | 2 | 2 | 100.0% |
| 方向指引 | `floor-mark-direction` | 2 | 2 | 100.0% |
| 墙面指示牌 | `sign-wall` | 2 | 2 | 100.0% |
| 楷书 横排 | `calligraphy-kai-h` | 2 | 2 | 100.0% |
| 楷书 竖排 | `calligraphy-kai-v` | 2 | 2 | 100.0% |
| 行书 横排 | `calligraphy-xing-h` | 2 | 2 | 100.0% |
| 行书 竖排 | `calligraphy-xing-v` | 2 | 2 | 100.0% |
| 隶书 横排 | `calligraphy-li-h` | 2 | 2 | 100.0% |
| 隶书 竖排 | `calligraphy-li-v` | 2 | 2 | 100.0% |
| 魏碑 横排 | `calligraphy-wei-h` | 2 | 2 | 100.0% |
| 魏碑 竖排 | `calligraphy-wei-v` | 2 | 2 | 100.0% |
| 黑体 横排 | `calligraphy-hei-h` | 2 | 2 | 100.0% |
| 黑体 竖排 | `calligraphy-hei-v` | 2 | 2 | 100.0% |
| 宋体 横排 | `calligraphy-song-h` | 2 | 2 | 100.0% |
| 宋体 竖排 | `calligraphy-song-v` | 2 | 2 | 100.0% |

#### Equipment minimum-shape exceptions

Low targets strictly less than 10% of High. The user-approved exceptions below
keep a minimum usable shape, including the two-triangle artwork and floor quads.
Caps and reasons live in `tools/equipment-low-budgets.mjs` and are enforced by the
inventory and regression suite; High geometry is unchanged. Counts describe model
geometry; transparent two-sided materials can submit an additional GPU pass.

| Equipment / decor model name | Low / High | Minimum-shape exception |
|---|---:|---:|
| bin | 26 / 196 | Two open hoppers, outer cabinet faces, dark wells and sorting label. |
| vent | 32 / 168 | Frame, dark duct and three louver strips visible above and below. |
| bench-seat-1 | 20 / 156 | Seat and back surfaces plus two supports. |
| door-wood-1 | 20 / 144 | Four frame members and a two-sided leaf. |
| psd-end | 30 / 114 | Shortened fixed glass, separate housing/trim faces and artwork. |
| tv | 22 / 114 | Two suspension rods, bezel, live station board, video window and status light. |
| noise-barrier | 46 / 108 | Posts and separate opaque/glazed bands, keeping all bay cutouts. |
| noise-barrier-half | 46 / 108 | Posts and separate opaque/glazed bands, keeping all bay cutouts. |
| traffic-light | 28 / 108 | Pole, base, closed housing and three separate lenses. |
| bench-steel-1 | 16 / 84 | Two-sided seat pan plus two supports. |
| sign-ceiling | 18 / 74 | Two suspension rods, backing and readable sign face. |
| monitor-ceiling | 20 / 72 | Two rods, housing, printed camera view and status light. |
| tactile-guide | 10 / 60 | Tile top and four continuous raised guide ribs. |
| guidepost | 57 / 60 | Three independently printed sides, shaped logo collar and triangular column sections. |
| curtain-wall | 18 / 60 | Four frame members and one double-sided glass surface. |
| glass-1x1 | 18 / 60 | Four frame members and one double-sided glass surface. |
| glass-2x1 | 18 / 60 | Four frame members and one double-sided glass surface. |
| glass-3x1 | 18 / 60 | Four frame members and one double-sided glass surface. |
| glass-1x2 | 18 / 60 | Four frame members and one double-sided glass surface. |
| glass-2x2 | 18 / 60 | Four frame members and one double-sided glass surface. |
| glass-3x2 | 18 / 60 | Four frame members and one double-sided glass surface. |
| exit-virtual | 46 / 60 | Three printed sides and shaped metro-logo collar. |
| road | 10 / 50 | Road surface plus four lane/edge markings. |
| pillar-slim | 16 / 36 | Shaft and end collars, preserving height and support footprint. |
| stair-block | 34 / 48 | All four solid treads, exposed risers and closed side silhouette. |
| billboard-wide | 6 / 40 | Original cropped artwork, frame surface and illuminated AD label. |
| billboard-standard | 6 / 40 | Original cropped artwork, frame surface and illuminated AD label. |
| billboard-large | 6 / 40 | Original cropped artwork, frame surface and illuminated AD label. |
| billboard-panorama | 6 / 40 | Original cropped artwork, frame surface and illuminated AD label. |
| billboard-portrait | 6 / 40 | Original cropped artwork, frame surface and illuminated AD label. |
| billboard-square | 6 / 40 | Original cropped artwork, frame surface and illuminated AD label. |
| linemap-stand | 16 / 40 | Base, support and two separately oriented readable map faces. |
| hanger-roof | 6 / 36 | Support bar visible from every direction. |
| hanger-post | 14 / 36 | Bar, upright and base. |
| linemap-wall | 4 / 26 | Frame surface and original cropped map face. |
| exit-doorway-1 | 10 / 26 | Doorway framing and independently readable header faces. |
| exit-doorway-2 | 10 / 26 | Doorway framing and independently readable header faces. |
| exit-doorway-3 | 10 / 26 | Doorway framing and independently readable header faces. |
| exit-doorway-4 | 10 / 26 | Doorway framing and independently readable header faces. |
| roof-shell | 8 / 24 | Two pitched sheets visible from above and below. |
| noise-barrier-railing | 16 / 24 | Open railing silhouette and supports. |
| light-rectangular | 6 / 24 | Steel rim visible above/below and a two-sided luminous diffuser. |
| roof | 4 / 12 | One sheet with both opposing faces. |
| psd-end-cover | 4 / 12 | One sheet with both opposing faces. |
| floor-mark-boarding | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| floor-mark-waiting | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| floor-mark-direction | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| sign-wall | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-kai-h | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-kai-v | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-xing-h | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-xing-v | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-li-h | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-li-v | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-wei-h | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-wei-v | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-hei-h | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-hei-v | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-song-h | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |
| calligraphy-song-v | 2 / 2 | A single printed quad is already the minimum usable rectangular surface. |

The authored Low variants remove shelf stock, cubicle interiors and fine hardware;
keep simplified sink/CCTV/AC silhouettes, track sleepers/rails, ramp bands, lift
doors and stair surfaces. Source picks and rigs stay exact. `model-detail` guards
per-model triangle budgets, batching, restoration, finish colours and disposal.

Tree far/Low uses sparse, enlarged intact crossed leaf cards and a continuous
six-sided trunk; retain canopy extrema and valid leaf UVs when rebaking with
`node tools/bake-street-tree-lod.mjs`. Clock Low retains two readable hour-marked
faces and moving hands, using flat marks/hands and a twelve-sided case.

Every palette model above ten High triangles has a nonempty Low variant with fewer
triangles, guarded by the catalogue sweep in `model-detail` and the inventory
script. The smaller primitive families retain source UVs, colours and artwork:
thin box sheets keep both broad faces, and rods omit their end caps. Round pillar
shafts keep eight sides, narrow support rods use triangular tubes, and circular
lights use a hexagonal rim and two-sided diffuser; guide columns omit buried
bottom caps. Source picking and animated rig identities remain exact.

Furniture/cabinets omit stock and fine fittings; vending drinks become thin colour
panels. Fences use open triangular tubes without clamps/feet fittings and fewer
iron bars. Fare gates retain reader/entry artwork and animated leaves. Exit Low
retains openings, printed headers and the wave profile, with thin roof/glass
surfaces and fewer frame posts. `panelModelDetail` retains two broad faces;
approximation bounds include both full and reduced shapes so combined fittings do
not disappear at the screen edge.

Rail-signal Low keeps three six-sided aspects, diamond rims and coarse hood shells.
Noise barriers retain full posts and all bay/gantry cutouts, using two broad faces
per thin panel/middle rail. Top beams retain thickness with hidden end caps
omitted; the shared bridge builders also prepare these Low variants.

Low uses exposed faces, triangular support tubes, simpler silhouettes and a
bounded print of the original static monitor vectors. Live TV artwork, clock hands,
moving escalator/walkway/lift rigs, exact source picks and material ownership
remain intact. Every real stair tread/riser remains at its original height and
extent. Touching coplanar exit pads merge without filling actual stair wellways;
folded canopy and glass surfaces remain joined. Models with coherent
artwork/surfaces switch together through local and global batches, including
Hide UI and ghost-storey transitions. All three equipment batch paths retain
conservative union bounds for Near and Low, so simplified geometry outside a
source part's bounds remains visible and picked through the original source.

`npm run check:equipment-lod` renders all 120 High and Low options in a real
browser, checks visible pixels, geometry budgets and WebGL/shader errors, and
checks monitor and open-exit counts through real local/global batching. Contact
sheets and raw GPU/model counts are in `.preview/perf/equipment-10pct/`. The table
measures geometry; transparent DoubleSide materials can submit an extra pass. The
browser report records this separately (for example, the narrow open exit has 52
model triangles and 58 GPU triangles). Not every complete GPU submission is below
10%.

### Train models (车辆)

One row per reviewed consist built by `buildTrain`. D-8 is the shipped eight-car
formation and D-6 the six-car formation. Counts are model triangles for one train,
not totals across services. High is the complete consist — both cabs, gangways,
the rideable cabin interior, bogies and the closed door leaves (open/closed poses
submit the same triangles). Low is what the same consist draws after its prepared
swaps: a part with an authored §9.3 approximation swaps geometry, a part outside
that set (a 12-triangle slab, a fixed 5 m surface) keeps its full geometry. Counts
are drawn totals through the renderer's own path — static batching, door banks and
sorted glass batches — not a sum of unmerged parts. Uniform 0.98 scaling does not
change topology.

Third-rail counts exclude pantographs:

| Train model | Low triangles | High triangles |
|---|---:|---:|
| D-8 | 76,672 | 1,308,000 |
| D-6 | 60,092 | 1,011,484 |
| A-8 | 69,544 | 735,088 |
| A-6 | 53,508 | 577,676 |
| C-6 | 49,412 | 538,320 |
| B-6 | 47,520 | 518,976 |
| L-6 | 43,168 | 468,008 |
| C-4 | 34,880 | 397,940 |
| B-4 | 33,388 | 381,628 |
| L-4 | 30,396 | 346,780 |

Overhead-wire counts include collectors and their roof mounts:

| Train model | Low triangles | High triangles |
|---|---:|---:|
| D-8 | 78,264 | 1,321,112 |
| D-6 | 61,684 | 1,024,596 |
| A-8 | 71,200 | 748,776 |
| A-6 | 55,164 | 591,364 |
| C-6 | 51,068 | 552,008 |
| B-6 | 49,176 | 532,664 |
| L-6 | 44,824 | 481,696 |
| C-4 | 36,536 | 411,628 |
| B-4 | 35,044 | 395,316 |
| L-4 | 32,052 | 360,468 |

Train bogies are centred 0.25 m inward of the outer passenger-door centre, with
1.44 m axle spacing. Wheel and suspension hardware clear the passenger sill, and
continuous passenger floors have flat thresholds. `train-bogie` pins positions,
rail contact, sill clearance and aisle continuity. Train sheet cards size to their
largest front/side capture with bottom padding; `train-art-pipeline` pins animated
poses to their own rows.
The shared `TrainBogie.ts` wheelsets, sculpted frames, suspension and brakes are
included in these counts; Low keeps profiled eight-sided tyre treads and flanges,
six-sided wheel webs, and omits coils, bolts, pipes, dampers and fine
brake/bearing fittings.

D's layout: each side has four doorways and three bays of two small windows, with
painted end bays. Middle cars have four double doors; cab cars have three double
doors and one single door nearest the cab, mirrored at opposite ends.
`DTrainShell.ts` owns the curved shell and panes; `stock.ts` shares door centres
and widths with the platform screens. `stock`, `draw-batching` and `train-lod` pin
the cadence, apertures, moving doors and geometry totals.

L's three-door car keeps its shell and platform cadence, with one broad cab
windscreen, small framed end windows and paired wide inter-door windows. The window
builder keeps the real glazing apertures and uses one-segment corner curves for Low
geometry.

B keeps the shared shell and four-door cadence, with a single broad windshield at
each cab and three inset, rounded, rubber-framed side windows between the doors.
End bays remain painted. Low detail keeps the cut-out glazing and rubber frame
while reducing the corner segments.

Every selectable stock, one through eight cars, with either third rail or catenary,
draws at most 10% of its own High triangles. `train-lod` checks all 80 combinations,
moving door banks and exact High restoration through the real TrainSystem path. The
interior carries most of the reduction for A/B/C/L: straps become hollow, two-sided
triangular loops; handrails use open three-sided tubes over two path segments; ring
lights use eight ring segments and three tube sides. Door and window frames retain
real apertures and both broad faces while omitting thin edge walls. Door leaves
follow the Low shell profile. D keeps its authored lofted shell, plug doors and
bellows; clipped cab trim also carries explicit 12×3 Low surfaces.

High quality draws the active storey at High and ghosted storeys at Low; Low quality
uses Low throughout. Hide UI restores High. Train detail follows quality/storey,
not projected size. Prepared swaps retain source picking geometry, door motion and
allocations. Identical consists keep separate poses; up to eight dormant
configurations are retained for reuse.

Train parts are authored in their builders (`render/modelDetail.ts`);
`batchStaticParts` merges both variants so a batch carries its own Low geometry, and
the door banks and sorted-glass batches reserve theirs when they are built. A part
with no authored variant may fall back to the bounded-error simplifier only inside
`TRAIN_DETAIL_MAX_RADIUS` — a merged car spans a whole consist, and 2% of that is
metres. Preparing both variants costs roughly 10% (D) to 30% (B/C) more on a
consist's first build, once per cached configuration.

`tools/check-transport-lod.mjs` captures both details, both power systems,
front/side elevations and three door poses; reports and images live in
`.preview/perf/transport-10pct/train-captures/`. Production captures cover 50
High/Low pairs; the 20 elevation comparisons pass with minimum High-mask coverage
98.31% and minimum intersection-over-union 98.29%, and the other 30 pairs record
the three door poses for visual review. The shipped 动物园 Line 5 runs **L-6**. The
shipped overhead-wire counts are in
`.preview/perf/train-5m-audit/train-catenary-triangles.json`.

### Passenger models (乘客)

One row per reviewed appearance in the baked crowd atlas
(`game/src/assets/passenger-approved.json`, prepared instanced draws with no
per-agent GLB or skeleton). High is each variant's full topology; Low is a second
index table over the same animated vertex pool. Every appearance has a hard budget
of `floor(highTriangles * 0.10)`; the shared padded draw also stays below 10% of
High. The current shared stride is **9,370 High / 841 Low triangles (9.0%)**.

`tools/passenger-low-topology.mjs` builds separate faceted envelopes for each
anatomical part and palette region, keeping heads, arms, legs, shoes, skirts and
bags separate. Closed envelopes avoid the missing legs produced by unconstrained
grid clustering. Envelope simplification does not prune components; original
source faces retain extrema from every one of the 73 pose frames. Every output
corner references an existing animated vertex from that appearance, and every
triangle keeps one original flat palette region. Skirts retain their original
cloth topology with motion-aware reduction instead of a standing envelope. Other
parts use convex envelopes that remove concavities and small detail. Full geometry,
pose frames, normals, regions, source hashes and eligibility metadata are unchanged.

Each packed instance records its storey in `passengerLevel`. 高画质 draws the
edited storey full and ghosted storeys reduced; 低画质 draws the whole crowd reduced;
隐藏UI restores full bodies. One-storey crowds use one draw; ghosted crowds can add
a second. High bodies use 70% opacity and Low bodies 45%. The pose, normal and
region textures remain shared, so the triangle reduction does not reduce their
memory. Switching quality retains the prepared GPU allocations.

| Passenger model | Low triangles | High triangles |
|---|---:|---:|
| male-original-bag | 820 | 9,370 |
| male-short-bag | 811 | 9,314 |
| male-bald-bag | 801 | 9,296 |
| male-short-small-bag | 831 | 8,872 |
| male-short-standard-87.5-bag | 841 | 8,867 |
| male-bald-small-bag | 827 | 8,854 |
| male-bald-standard-87.5-bag | 835 | 8,849 |
| male-short-standard-75-bag | 825 | 8,832 |
| male-bald-standard-75-bag | 821 | 8,814 |
| male-side-part-bag | 776 | 8,772 |
| male-quiff-bag | 776 | 8,772 |
| male-swept-bag | 776 | 8,752 |
| male-crop-bag | 765 | 8,673 |
| female-rounded-bob-bag | 760 | 8,636 |
| female-lob-bag | 758 | 8,594 |
| female-bob-bag | 758 | 8,584 |
| female-angled-bob-bag | 758 | 8,582 |
| female-side-part-bob-bag | 758 | 8,580 |
| female-shoulder-bag | 754 | 8,579 |
| female-shoulder-swept-bag | 754 | 8,579 |
| female-cropped-bob-bag | 758 | 8,578 |
| male-crew-bag | 752 | 8,569 |
| male-buzz-bag | 752 | 8,526 |
| male-rounded-bag | 752 | 8,524 |
| male-original-small-bag | 791 | 8,425 |
| male-original-standard-87.5-bag | 798 | 8,409 |
| male-original-standard-75-bag | 788 | 8,389 |
| male-side-part-small-bag | 787 | 8,363 |
| male-quiff-small-bag | 787 | 8,363 |
| male-side-part-standard-87.5-bag | 794 | 8,347 |
| male-quiff-standard-87.5-bag | 792 | 8,347 |
| male-swept-small-bag | 787 | 8,343 |
| male-swept-standard-87.5-bag | 790 | 8,327 |
| male-side-part-standard-75-bag | 782 | 8,327 |
| male-quiff-standard-75-bag | 784 | 8,327 |
| male-swept-standard-75-bag | 782 | 8,307 |
| female-rounded-bob-small-bag | 785 | 8,269 |
| male-crop-small-bag | 782 | 8,264 |
| male-crop-standard-87.5-bag | 787 | 8,248 |
| female-rounded-bob-standard-87.5-bag | 784 | 8,241 |
| female-rounded-bob-standard-75-bag | 779 | 8,235 |
| male-crop-standard-75-bag | 775 | 8,228 |
| female-lob-small-bag | 781 | 8,227 |
| female-bob-small-bag | 779 | 8,217 |
| female-angled-bob-small-bag | 779 | 8,215 |
| female-side-part-bob-small-bag | 779 | 8,213 |
| female-shoulder-small-bag | 779 | 8,212 |
| female-shoulder-swept-small-bag | 779 | 8,212 |
| female-cropped-bob-small-bag | 779 | 8,211 |
| female-lob-standard-87.5-bag | 780 | 8,199 |
| female-lob-standard-75-bag | 777 | 8,193 |
| female-bob-standard-87.5-bag | 780 | 8,189 |
| female-angled-bob-standard-87.5-bag | 780 | 8,187 |
| female-side-part-bob-standard-87.5-bag | 780 | 8,185 |
| female-shoulder-standard-87.5-bag | 780 | 8,184 |
| female-shoulder-swept-standard-87.5-bag | 780 | 8,184 |
| female-cropped-bob-standard-87.5-bag | 780 | 8,183 |
| female-bob-standard-75-bag | 777 | 8,183 |
| female-angled-bob-standard-75-bag | 777 | 8,181 |
| female-side-part-bob-standard-75-bag | 777 | 8,179 |
| female-shoulder-standard-75-bag | 777 | 8,178 |
| female-shoulder-swept-standard-75-bag | 779 | 8,178 |
| female-cropped-bob-standard-75-bag | 777 | 8,177 |
| male-crew-small-bag | 763 | 8,160 |
| male-crew-standard-87.5-bag | 772 | 8,144 |
| male-crew-standard-75-bag | 764 | 8,124 |
| male-buzz-small-bag | 761 | 8,117 |
| male-rounded-small-bag | 759 | 8,115 |
| male-buzz-standard-87.5-bag | 766 | 8,101 |
| male-rounded-standard-87.5-bag | 764 | 8,099 |
| male-buzz-standard-75-bag | 760 | 8,081 |
| male-rounded-standard-75-bag | 760 | 8,079 |
| female-midi-pleated-swapped-no-bag | 569 | 5,832 |
| female-long-a-line-swapped-no-bag | 565 | 5,806 |
| female-long-pleated-swapped-no-bag | 570 | 5,805 |
| female-midi-pleated-no-bag | 571 | 5,802 |
| female-midi-a-line-swapped-no-bag | 551 | 5,785 |
| female-long-a-line-no-bag | 563 | 5,775 |
| female-long-pleated-no-bag | 565 | 5,775 |
| female-midi-a-line-no-bag | 563 | 5,773 |
| female-full-pleated-swapped-no-bag | 564 | 5,771 |
| female-full-pleated-no-bag | 562 | 5,770 |
| female-slim-long-skirt-no-bag | 561 | 5,749 |
| female-slim-long-skirt-swapped-no-bag | 558 | 5,718 |
| male-short-crossbody-right-bag | 481 | 5,071 |
| male-short-crossbody-left-bag | 474 | 5,070 |
| male-bald-crossbody-right-bag | 479 | 5,053 |
| male-bald-crossbody-left-bag | 474 | 5,052 |
| male-short-shoulder-right-bag | 452 | 4,764 |
| male-short-shoulder-left-bag | 451 | 4,762 |
| male-bald-shoulder-right-bag | 450 | 4,746 |
| male-bald-shoulder-left-bag | 451 | 4,744 |
| male-short-no-bag | 450 | 4,705 |
| male-bald-no-bag | 440 | 4,687 |
| male-original-crossbody-right-bag | 451 | 4,650 |
| male-original-crossbody-left-bag | 446 | 4,649 |
| female-long-swept-crossbody-right-bag | 446 | 4,612 |
| female-long-swept-crossbody-left-bag | 446 | 4,611 |
| female-long-crossbody-right-bag | 446 | 4,605 |
| female-long-crossbody-left-bag | 444 | 4,604 |
| male-side-part-crossbody-right-bag | 447 | 4,588 |
| male-quiff-crossbody-right-bag | 447 | 4,588 |
| male-side-part-crossbody-left-bag | 440 | 4,587 |
| male-quiff-crossbody-left-bag | 440 | 4,587 |
| male-swept-crossbody-right-bag | 443 | 4,568 |
| male-swept-crossbody-left-bag | 438 | 4,567 |
| male-crop-crossbody-right-bag | 438 | 4,489 |
| male-crop-crossbody-left-bag | 435 | 4,488 |
| female-rounded-bob-crossbody-right-bag | 432 | 4,482 |
| female-rounded-bob-crossbody-left-bag | 432 | 4,481 |
| female-lob-crossbody-right-bag | 429 | 4,440 |
| female-lob-crossbody-left-bag | 421 | 4,439 |
| female-bob-crossbody-right-bag | 428 | 4,430 |
| female-bob-crossbody-left-bag | 420 | 4,429 |
| female-angled-bob-crossbody-right-bag | 428 | 4,428 |
| female-angled-bob-crossbody-left-bag | 420 | 4,427 |
| female-side-part-bob-crossbody-right-bag | 428 | 4,426 |
| female-side-part-bob-crossbody-left-bag | 420 | 4,425 |
| female-shoulder-crossbody-right-bag | 425 | 4,425 |
| female-shoulder-swept-crossbody-right-bag | 425 | 4,425 |
| female-shoulder-crossbody-left-bag | 421 | 4,424 |
| female-shoulder-swept-crossbody-left-bag | 421 | 4,424 |
| female-cropped-bob-crossbody-right-bag | 428 | 4,424 |
| female-cropped-bob-crossbody-left-bag | 420 | 4,423 |
| male-crew-crossbody-right-bag | 427 | 4,385 |
| male-crew-crossbody-left-bag | 424 | 4,384 |
| male-buzz-crossbody-right-bag | 419 | 4,342 |
| male-original-shoulder-right-bag | 423 | 4,341 |
| male-buzz-crossbody-left-bag | 418 | 4,341 |
| male-rounded-crossbody-right-bag | 419 | 4,340 |
| female-long-swept-purse-left-bag | 415 | 4,340 |
| female-long-swept-purse-right-bag | 414 | 4,340 |
| male-original-shoulder-left-bag | 419 | 4,339 |
| male-rounded-crossbody-left-bag | 418 | 4,339 |
| female-long-purse-left-bag | 415 | 4,333 |
| female-long-purse-right-bag | 414 | 4,333 |
| female-long-swept-shoulder-right-bag | 414 | 4,318 |
| female-long-swept-shoulder-left-bag | 416 | 4,316 |
| female-long-shoulder-right-bag | 414 | 4,311 |
| female-long-shoulder-left-bag | 416 | 4,309 |
| male-short-straight-no-bag | 411 | 4,294 |
| male-short-straight-swapped-no-bag | 404 | 4,292 |
| male-crew-straight-no-bag | 411 | 4,285 |
| male-relaxed-straight-swapped-no-bag | 413 | 4,281 |
| male-side-part-shoulder-right-bag | 415 | 4,279 |
| male-quiff-shoulder-right-bag | 417 | 4,279 |
| male-side-part-shoulder-left-bag | 411 | 4,277 |
| male-quiff-shoulder-left-bag | 413 | 4,277 |
| male-relaxed-straight-no-bag | 410 | 4,277 |
| male-fitted-straight-no-bag | 410 | 4,268 |
| male-original-no-bag | 409 | 4,262 |
| male-crew-straight-swapped-no-bag | 408 | 4,262 |
| male-swept-shoulder-right-bag | 415 | 4,259 |
| male-swept-shoulder-left-bag | 413 | 4,257 |
| female-long-swept-no-bag | 410 | 4,231 |
| female-long-no-bag | 408 | 4,224 |
| male-fitted-straight-swapped-no-bag | 404 | 4,224 |
| male-short-wide-no-bag | 407 | 4,217 |
| male-relaxed-wide-swapped-no-bag | 405 | 4,215 |
| female-rounded-bob-purse-left-bag | 407 | 4,210 |
| female-rounded-bob-purse-right-bag | 410 | 4,210 |
| male-relaxed-wide-no-bag | 405 | 4,209 |
| male-long-relaxed-no-bag | 410 | 4,205 |
| male-side-part-no-bag | 403 | 4,200 |
| male-quiff-no-bag | 403 | 4,200 |
| female-rounded-bob-shoulder-right-bag | 404 | 4,188 |
| female-rounded-bob-shoulder-left-bag | 404 | 4,186 |
| male-swept-no-bag | 401 | 4,180 |
| male-crop-shoulder-right-bag | 408 | 4,180 |
| male-short-wide-swapped-no-bag | 400 | 4,179 |
| male-crop-shoulder-left-bag | 406 | 4,178 |
| female-lob-purse-left-bag | 395 | 4,168 |
| female-lob-purse-right-bag | 398 | 4,168 |
| female-bob-purse-left-bag | 395 | 4,158 |
| female-bob-purse-right-bag | 396 | 4,158 |
| female-angled-bob-purse-left-bag | 393 | 4,156 |
| female-angled-bob-purse-right-bag | 396 | 4,156 |
| female-side-part-bob-purse-left-bag | 395 | 4,154 |
| female-side-part-bob-purse-right-bag | 396 | 4,154 |
| female-shoulder-purse-left-bag | 399 | 4,153 |
| female-shoulder-swept-purse-left-bag | 401 | 4,153 |
| female-shoulder-purse-right-bag | 400 | 4,153 |
| female-shoulder-swept-purse-right-bag | 402 | 4,153 |
| female-cropped-bob-purse-left-bag | 395 | 4,152 |
| female-cropped-bob-purse-right-bag | 396 | 4,152 |
| male-crew-tapered-swapped-no-bag | 399 | 4,152 |
| female-lob-shoulder-right-bag | 402 | 4,146 |
| female-lob-shoulder-left-bag | 400 | 4,144 |
| male-crew-tapered-no-bag | 402 | 4,144 |
| male-long-relaxed-swapped-no-bag | 403 | 4,144 |
| female-bob-shoulder-right-bag | 400 | 4,136 |
| female-bob-shoulder-left-bag | 398 | 4,134 |
| female-angled-bob-shoulder-right-bag | 400 | 4,134 |
| female-angled-bob-shoulder-left-bag | 398 | 4,132 |
| female-side-part-bob-shoulder-right-bag | 400 | 4,132 |
| male-fitted-tapered-no-bag | 393 | 4,132 |
| female-shoulder-shoulder-right-bag | 402 | 4,131 |
| female-shoulder-swept-shoulder-right-bag | 406 | 4,131 |
| female-side-part-bob-shoulder-left-bag | 398 | 4,130 |
| female-cropped-bob-shoulder-right-bag | 400 | 4,130 |
| female-shoulder-shoulder-left-bag | 404 | 4,129 |
| female-shoulder-swept-shoulder-left-bag | 404 | 4,129 |
| female-cropped-bob-shoulder-left-bag | 398 | 4,128 |
| male-fitted-tapered-swapped-no-bag | 389 | 4,128 |
| male-long-tapered-no-bag | 405 | 4,105 |
| male-crop-no-bag | 389 | 4,101 |
| female-rounded-bob-no-bag | 398 | 4,101 |
| male-long-tapered-swapped-no-bag | 402 | 4,089 |
| male-crew-shoulder-right-bag | 393 | 4,076 |
| male-crew-shoulder-left-bag | 395 | 4,074 |
| female-lob-no-bag | 392 | 4,059 |
| female-bob-no-bag | 390 | 4,049 |
| female-angled-bob-no-bag | 392 | 4,047 |
| female-side-part-bob-no-bag | 390 | 4,045 |
| female-shoulder-no-bag | 394 | 4,044 |
| female-shoulder-swept-no-bag | 394 | 4,044 |
| female-cropped-bob-no-bag | 390 | 4,043 |
| female-straight-trousers-no-bag | 390 | 4,040 |
| female-straight-trousers-swapped-no-bag | 393 | 4,034 |
| male-buzz-shoulder-right-bag | 389 | 4,033 |
| male-buzz-shoulder-left-bag | 389 | 4,031 |
| male-rounded-shoulder-right-bag | 389 | 4,031 |
| male-rounded-shoulder-left-bag | 389 | 4,029 |
| male-crew-no-bag | 383 | 3,997 |
| female-wide-trousers-swapped-no-bag | 384 | 3,976 |
| female-wide-trousers-no-bag | 382 | 3,960 |
| male-buzz-no-bag | 379 | 3,954 |
| male-rounded-no-bag | 377 | 3,952 |
| female-relaxed-trousers-no-bag | 377 | 3,921 |
| female-relaxed-trousers-swapped-no-bag | 376 | 3,900 |
| female-tapered-trousers-swapped-no-bag | 376 | 3,830 |
| female-tapered-trousers-no-bag | 371 | 3,821 |

Across all 232 variants, the atlas references **1,308,230 High / 123,928 Low**
triangles over the unchanged pool of **226,731 animated vertices**, 73 frames and
21 palette stops. Real Low rows range from **371 to 841 triangles**. The padded
Low row is `lowCorners` **2,523 corners**, versus 28,110 High corners.

Production GPU validation compares **11,736 paired High/Low renders**: every
eligible adult/child appearance, all three gait profiles, standing and three
walking samples per profile, in isometric/elevation/plan views. Every comparison
passes the fixed gates (80% High-mask coverage, 70% intersection-over-union).
Worst overlap is **78.59%**, and minimum High-mask coverage **86.15%**. The 864
skirt-only comparisons reach minimum overlap 92.49% and coverage 95.63%. These
samples do not claim exhaustive visual coverage of all interpolated poses, camera
angles or age-size extremes.

`passenger-lod` pins both 10% budgets, per-appearance vertex membership, flat
palette boundaries, all-frame extrema, quality/storey routing and shared disposal.
`node tools/check-passenger-lod.mjs` performs paired production GPU captures for
both eligible ages, all variants, all three gaits and three camera views; review
its worst silhouette pairs in ignored `.preview/perf/passenger-10pct/`.
`node tools/model-triangle-inventory.mjs` regenerates the table. A full
`npm run bake:passengers` regenerates reviewed exports and the complete atlas;
for Low-policy-only changes, `node tools/bake-approved-passenger.mjs --low-only`
first verifies every export hash and then regenerates only Low topology fields.

### Five-metre clearance and other geometry

| Datum | Height above track anchor |
|---|---:|
| Concrete underside | −1 m |
| Train/platform floor | +1 m |
| Scaled train origin | +0.3924 m |
| Collector carbon / wire underside | +3.891 m |
| Wire centre | +3.903 m |
| Covered ceiling underside | +4 m |

Covered track has a 5 m bottom-to-ceiling envelope. Open bridges/gantries use their
own taller clearance. Full PSDs stand 3 m above the platform: 2.35 m of glass, a
0.6 m information plate and a 0.05 m cap.

Passenger atlas draw strides are 9,370 High / 841 Low triangles per instance;
individual variants can be smaller. Both LODs share animation data. Rendered
passenger dimensions use the train's 0.98 uniform scale, including shadows,
picking, stride phase and eye height; simulation physique/speed and the atlas
topology are unchanged. A single-storey crowd uses one draw; a visible ghosted
storey can add a second. Passenger and road-vehicle opacity is 70% at High and 45%
at Low.

Current inventory sizes:

| Inventory | Current report |
|---|---|
| Equipment/decor | `.preview/perf/model-triangles.json` |
| Trains, third rail | `.preview/perf/train-triangles.json` |
| Trains, overhead wire | `.preview/perf/train-5m-audit/train-catenary-triangles.json` |
| Passenger variants | `.preview/perf/passenger-triangles.json` |
| Road vehicles, including colour + depth pass | `.preview/road-vehicles/report.json` |

## Current performance state

This section is a snapshot of the production paths and their known limits. It replaces
chronological investigation notes. Keep only reproducible current behavior here;
put raw captures and profiles under ignored `.preview/perf/`.

### Interaction contracts

- Resolve one scene pick per pointer event. Reuse its hit or miss for module, block,
  surface, normal, bounds and roof queries. Plane-only queries stay lazy. Flush queued
  movement before opening the release event's pick scope.
- Keep preview work out of document commits, undo history and worker routing. Coalesce
  replaceable movement, preserve path-dependent samples, and flush or cancel on release,
  cancellation, tool change and unmount.
- Shared multi-placement drags use a 50 ms latest-target scheduler. The latest snapped
  target replaces pending work without restarting the timer. Keep the accepted preview
  visible while work is pending; show over-budget or known-refused footprints as refused.
  The 10,000-cell cap is checked before large allocations and includes generated walls.
  Roofs use a one-callback frame scheduler.
- Block collision verdicts are cached against immutable `cells` and `modules` arrays,
  with bounded retention and local spatial indexes. A refused block coordinate may
  remain a constant-time red-cursor witness while the current footprint covers it.
  Invalidate it when geometry, settings, footprint, release or cancellation changes.
- Snapping follows visible scene geometry, not nominal storey bands. Prefer a nearer
  visible object over terrain; hanger hits use their actual attachment anchor. Shared
  placement validation owns support and refusal decisions.
- Local equipment edits retain unaffected model roots, batch buckets and GPU buffers.
  Unknown builder dependencies keep conservative invalidation. Functional edits may
  install asynchronously in a coalesced worker job; the applied document and routing
  graph stay paired until installation, and simulation ticks continue on that pair.
  Initial station loads remain immediate.
- Settings and presentation edits (names, colours, termini, population, exit policy,
  headways, opening hours, peak windows and demand curves) do not rebuild station
  geometry or routing. Repaint only artwork with changed declared inputs. Invisible
  population and exit-policy edits do not request a frame. Restart reuses static
  connectivity and collision indexes while resetting dynamic simulation state.
- Suspended ceilings use ordinary block validation without copying station arrays or
  relocating hung fixtures. A ceiling plate is never a zone floor. Hidden ceiling
  geometry must not cast culling votes against ordinary block faces, including across
  chunk halos.
- Graphics Low remains Low in every view, including Hide UI. The standalone exploded
  view is presentation-only: it leaves the saved document, worker, routes and simulation
  buffers untouched. Its prepared geometry retains usable raised/underground floors,
  labelled ground rooms and circulation landings; removes outdoor ground decor, soil
  caps, near-facing enclosure and unsupported street passengers; and translates static
  geometry and live poses consistently. Story boundaries use actual exposed floor
  surfaces. Live cross-storey passengers teleport only in this viewer.
- Build-rail previews are checked-in 132 × 132 PNG assets generated by
  `tools/render-menu-thumbnails.mjs`; startup WebGL thumbnail rendering is not used.

Pin deterministic work counts and behavior in the existing focused suites. In
particular: `tool-picking`, `geometry-snap`, `placement-surface`, `ramp-targeting`,
`multi-place-drag`, `block-collision-cache`, `roof-preview`, `placement-invalidation`,
`equipment-retention`, `worker-preview`, `nonstructural-updates`, `floor-geometry`,
`exploded-view` and `exploded-passengers`. Keep the game test coverage map current.

### Response budget and placement state

The response budget is **100 ms from pointer-down to visible placement feedback**,
including the first placement. This is an engineering target, not a test threshold.
Renderer-submission completion and event-through-two-animation-frames are proxies, not
GPU fences or compositor timestamps. Measure worker installation separately.

A controlled production audit against the shipped Zoo and Tanwei demos recorded the
following optimized pointer-to-renderer-submission samples (ms):

| Demo | First | Repeated samples | Worst |
|---|---:|---|---:|
| Zoo | 134 | 62, 132, 176, 156 | 176 |
| Tanwei | 118 | 110, 107, 241, 100 | 241 |

All ten placements succeeded, each event used at most one scene raycast, authored
cells were preserved, and browser/GL errors were zero. Two-frame samples were Zoo
159/81/163/201/178 ms and Tanwei 157/149/142/283/133 ms. Every measured placement
still exceeds 100 ms on at least one response proxy. These are five-sample diagnostics,
not percentile estimates. The worst remaining paths are street-window boundary changes,
local module/batch registration, ground-edge remeshing and scene traversal/program
warmup. Profile timers can overlap and must not be added together.

The principal bounded-work results are:

| Path | Current behavior / observed limit |
|---|---|
| Scene picking | Production tool check covers 38 dispatches, at most one raycast each; geometry snapping check covers 69 dispatches with the same limit. |
| Multi-placement | Latest-target cadence is 50 ms; arithmetic footprint limit is 10,000 cells. A 10,000-cell block preview reaches CPU readiness in about 86–89 ms on the recorded SwiftShader fixture. |
| Roof preview | A 10,000-roof preview reaches readiness in about 11–19 ms on the recorded fixture. Large synchronous releases still take hundreds of milliseconds. |
| Block collision | The shipped Tanwei blocked drag reuses cached verdicts for 2,243 accepted / 107 refused cells; deterministic tests ensure growth does not rescan unrelated module types. |
| Settings / presentation | Production audits show zero station, chunk, module or batch rebuild work for covered edits. Visible response time varies by flow and browser; it is not a CPU/GPU metric. |
| Placement invalidation | The current dependency audit retains remote models on local equipment edits and keeps structural or unknown dependencies on the conservative path. |
| Exploded view | Snapshot preparation is one-time per opening. Simulation frames reuse pose buffers where lengths match and filter passengers through prepared support indexes. Viewer startup takes several seconds on the measured demos; this is not a per-frame cost. |

Four constraints remain material: cold first interaction includes renderer initialization;
placement exceeds the 100 ms response target; queued worker installation still performs a
complete graph rebuild after its intentional coalescing window; and large document commits
remain synchronous. Playback FPS samples are diagnostic; repeat equivalent runs before
making a general throughput claim.

### Simulation playback frame tails

`npm run bench:sim-stalls` measures actual renderer submissions from the first
Play at 16x, with tick/population snapshots and timed train, plate, crowd, road
and renderer work. `BENCH_DEMO=zoo|tanwei`, `BENCH_MODE=regular|explode`,
`BENCH_QUALITY=high|low`, `BENCH_SECONDS` and `BENCH_SPEED` select the scenario.
`BENCH_PIXEL_RATIO` changes renderer scale for a diagnostic run. `BENCH_ABLATE=render|crowd|chunks|modules|station`
removes only the named drawing path while simulation continues. Use `BENCH_PROFILE=1`
for CPU samples or `BENCH_TRACE=1` for a separate Chrome timeline (`BENCH_TRACE_GPU=1`
adds GPU/compositor events). Keep clean timing runs separate from both. RAF cadence
is retained separately from submitted-frame cadence; neither is a compositor
presentation timestamp. Reports live in
`.preview/perf/sim-stalls/`.

For regular playback runs, `tools/browser-harness.mjs` exports
`configureBenchmarkView(page, stationId, mode)` to match the player's `/benchmark`
presets after loading a demo. Tanwei keeps its authored default opening level and
enables Hide UI; Zoo hides the ground, selects −15 m and looks from the TOP/N/W
view-cube corner. Both regular views use the route's 2/3 camera-distance factor
(50% closer). Exploded runs keep the standalone viewer's own camera. Both
`bench:sim-stalls` and `bench:explode` call this helper so station-specific setup
does not drift between diagnostics and the in-game route. Each JSON run records
the selected setup and, for regular view, the renderer's applied level/visibility
state plus camera position and target.

#### Tanwei Low at 1×

The 1× target is 30 average / 15 1% low FPS in the regular editor. A matched
40-second run of the shipped Tanwei fixture, seed 7654321, zero starting
population, Low quality, 1400 × 900 browser and 852 × 715 canvas on Chrome 155,
i7-14700KF and RTX 4080 SUPER measured 27.71 / 11.60 FPS before the change.
Increasing Low quality cross-module equipment buckets from 16 m to 64 m reduced
batch meshes from 1,583 to 986 and submitted draw work from 4,571 to 3,775 (17.4%).
The paired run finishes at the same tick 40 and population 535, with the same
861,374 triangles and no runtime or GL errors. Two Low/64 m runs measure
32.72 / 12.51 and 32.19 / 11.35 average / 1% low FPS, with 153 / 150 ms worst
submitted-frame gaps. Average clears 30 in both runs; the 15 FPS 1% low target
does not. The baseline is one run, so the roughly 17% average increase is
promising but still needs repeated confirmation.

These are single browser runs and the 1% low is the mean of the slowest 1% of
submitted-frame intervals, not a compositor presentation percentile. At 128 m,
average rises to 33.19 but the 1% low falls to 12.09 and larger buckets reduce
frustum-culling precision, so 64 m is the selected balance. A 0.75 pixel ratio
did not improve throughput. The GPU trace shows main-thread waits for available
WebGL command slots and ~41 ms GPU WebGL work during a stall. Drawing ablations
isolate the equipment/module path: removing chunks keeps performance near
33/13 FPS, while removing module drawing reaches the 60 FPS cap and 45 FPS 1%
low. The next target is equipment submission/detail work; the 15 FPS tail goal
still needs more improvement.

Raw before/after, 32/64/128 m, scale, profile, GPU trace and ablation captures
are under `.preview/perf/sim-stalls/`. Low quality uses the wider buckets while
High retains 16 m locality. `draw-batching.test.mjs` pins both boundaries, source
picking IDs and preservation of unaffected GPU batches.

#### Contact shadows on the active storey

Equipment and passenger contact shadows now draw only on the active editing
storey. Ghosted floors retain their geometry and passengers without shadow blobs.
Hide UI, cutaway and the standalone presentation restore shadows for their drawn
floors. Equipment shadow batches keep their original buffers and instance values;
passenger shadows pack and upload only the active-storey prefix. Floor membership
uses `storeyBand`, including Tanwei's 1/6/11 m decks and shifted editing grids,
rather than comparing the raw module altitude with the editing height.

A fresh matched 40-second Tanwei Low/1× editor capture at the default -10 m layer,
seed 7654321, 852 × 715 canvas, tick 40 / population 535, reduces visible equipment
shadow batches from 21 to 2 and instances from 7,674 to 542. Submitted work falls
from 3,775 to 3,756 draws and 861,374 to 775,790 triangles. The 136 passenger shadows
in this capture already belong to the active floor. Average / 1% low FPS measures
27.24 / 10.11 before and 24.68 / 9.94 after; this pair shows no FPS improvement,
so only the work reduction and visibility fix are claimed. Both runs report zero
runtime/GL errors. Raw captures are `tanwei-low-1x-shadows-{before,after}.json` under
`.preview/perf/sim-stalls/`.

Production browser checks cover -10/0/5/10 m Tanwei layers with other storeys shown,
whole-station restoration, and zero GL errors; `active-shadow-check.json` and
`tanwei-active10-shadows.png` retain the evidence in the same folder. Focused
equipment retention, level slicing, view cache and batching lifecycle suites pass
54 checks. Passenger shadow tests also pin High/Low, paused layer switches,
cutaway transitions, active instance counts and unchanged GPU buffers.

Ceiling-mounted equipment now contributes no contact blobs in any view. The
module shadow builder uses the shared `isCeilingHung` classification, covering
lights, vents, clocks, hanging CCTV, signs, monitors and roof-mounted hangers;
floor-mounted CCTV and hanger posts retain their contact shadows. The production
Tanwei Low check at -10 m now draws 384 equipment shadow instances instead of 542.
Four-layer visibility and whole-station restoration checks pass with zero GL
errors, alongside the production build and 31 equipment-retention/level-slicing
checks. The fixture regression pins zero shadow allocations for ceiling props
and preserved floor-equipment counts through additions and removals. This is a
visibility and submitted-work reduction; no new FPS claim is made.

The remaining repeated dark marks along the PSD header came from `psd-end`
cover panels, which also inherited the generic equipment blob. Fixed PSD infill
and cover panels now share the main `platform-edge` no-blob policy. Tanwei has
144 covers at -6 m and eight infill panels at -10 m; removing their 152 blobs
reduces active -10 m equipment shadows from 384 to 232 and removes the -6 m shadow
batch entirely. The production four-layer/whole-station check passes with zero
GL errors, the build passes, and 32 equipment-retention/level-slicing checks pass.
The added regression checks both panel variants and a retained bench shadow.

The large first-arrival freezes occur when a new consist appears, rather than on
every simulation tick. Tanwei's first four services arrive at ticks 1/13/26/39
(06:30:01/13/26/39). A first-Play Low/exploded capture showed 2.3–2.5 s frame gaps:
the visible viewer and suspended editor each spent roughly 1.1–1.2 s building
the same train. CPU samples identify repeated full-shell triangle raycasts while
seating cab glass/trim as a major part of that build. Steady pose updates are
sub-millisecond; reducing passenger triangles does not remove this construction.

Matched first-Play captures use a 20 s window, speed 16x, Low graphics, zero initial
population, seed 7654321, hardware Chrome 155 / ANGLE D3D11 on an i7-14700KF and
RTX 4080 SUPER. Tanwei has 16,869 cells / 9,694 modules; the 1400 x 900 browser
has an 852 x 715 editor canvas or 1384 x 702 exploded canvas. Each view's original
and current implementation use the same authored fixture, camera and assets in
separate fresh browser sessions, with no competing tests/builds from this task.

| Tanwei view | Average FPS, original → current | 1% low FPS, original → current | Worst submitted-frame gap, original → current |
|---|---:|---:|---:|
| Regular | 12.07 → 16.09 | 0.74 → 2.94 | 1,445 → 396 ms |
| Exploded | 14.73 → 31.12 | 0.40 → 3.76 | 2,656 → 303 ms |

These are single runs, not stable percentiles or GPU presentation measurements.
Regular runs finish at ticks 288/287 with 1,154 passengers in both; exploded runs
finish at ticks 291/289 with 1,151/1,153 passengers. Final draw calls match exactly
within each pair (4,571 regular / 3,919 exploded); small triangle differences follow
the slightly different final population/poses. All captures report zero runtime/GL
errors. `matched-{before,after}-{regular,explode}.json` holds the raw samples.
`comparison.json` summarizes the pairs; `frame-tail-comparison.png`/`.svg` plots
the full interval timeline and identifies the first four service-arrival stalls.

The current path prepares up to eight parked service consists during station
opening, keeps them invisible until the worker supplies their live poses, and
reuses their exact geometry, door rigs and detail buffers on arrival. Model
preparation is an opening cost, not eliminated work. Unknown configurations or
fleets beyond the preparation bound can still require a first-use build. Cab
fitting queries retain exact authored shell intersections using a prepared y/z
triangle index instead of traversing the whole shell per vertex. The suspended
editor retains only the latest train snapshot and applies it when shown, avoiding
duplicate invisible builds during exploded playback. These changes do not step
the simulation, dispatch services, change geometry detail, or commit a document.
The matched exploded run constructs eight models during original playback (four
per renderer), versus zero in the current path. Its slowest train snapshot update
is 1.2 ms. Opening prepares Tanwei's four consists in about 2.1–2.2 s CPU per
renderer; measured editor opening rises from 6.95–7.01 s to 8.87–9.21 s. Exploded
preparation is additional viewer-opening work. Zoo's High/regular sanity run
prepares two consists in 1.35 s, builds none during playback, and records 38.26
average / 4.64 1% low FPS with a 225 ms worst gap. It is not a matched speedup.

Smaller repeated frame gaps remain in the measured full station. A separate Chrome
trace shows short main-thread snapshot/render work while the GPU process handles
queued WebGL commands. Causal controls remove only drawing, leaving the worker and
poses running: removing crowd drawing does not remove the gaps; removing static
station drawing removes the repeated 100 ms+ gaps. These controls are diagnostics,
not production rendering modes or speedup claims. A two-frame GPU queue cap did
not improve the tail and is not part of the implementation. Further rendering work
should target static station submission/batching, with full visibility, transparency,
depth, picking and local-edit retention checks; lowering crowd detail alone misses
the measured cause. Opening GPU work can also spill into an immediate first Play.

`cab-front-surface` pins exact full-raycaster equivalence, source immutability and
bounded local triangle work. `train-preparation` compares the prepared appearances
with the real Zoo/Tanwei worker anchors, pins invisible preparation, first/repeated
arrival model identity, the eight-parked-consist bound and configuration eviction.
`check-exploded-view` verifies that the suspended editor does not rebuild trains
and that returning applies the latest held poses. `BENCH_ASSERT_PREPARED=1` rejects
any live train construction in the playback diagnostic.

Validation: the full game suite passes all 2,365 tests and the production build
passes. Focused coverage is 100% lines/functions for CabFrontSurface, CabSkin and
trainPreparation (92% / 97.30% / 79.31% branches); TrainSystem is 88.38% lines,
66.67% branches and 83.33% functions in that focused run. Existing full-suite
train-LOD, pause, recolour and batching tests cover the other contracts. The broad
instrumented `test:perf` run was stopped incomplete during atlas checks; do not
claim broad coverage from the focused figures. Logs and browser evidence are under
`.preview/perf/sim-stalls/`.
Both demos pass the production playback/camera/Escape lifecycle check, including
held editor train poses and latest-frame replay. Native and extension-free batching
checks preserve train triangles, reduce draws and report zero GLSL/WebGL/runtime
errors. CPU-profile and trace-stream tooling checks pass.

#### Live TV atlas uploads and 1% lows — 2026-10-23

The remaining train-correlated and periodic stalls were live TV information
textures. Arrival/approach/countdown changes repaint service cards; every simulated
minute repaints all 28 clocks. At 16× the latter repeats roughly every 3.75 wall
seconds. The old atlas marks an entire 2048² CanvasTexture page dirty for each
changed slot. CPU repaint/atlas timings stay below 2 ms while subsequent GPU
canvas transfers stall frame delivery. Train pose updates remain sub-millisecond.

Causal controls keep the simulation, trains, crowd and static station running:
at the original 852 × 715 canvas, freezing only TV information plates changes
Tanwei from 30.32 average / 3.22 1% low FPS, 421 ms worst and 47 gaps over 100 ms
to 39.61 / 23.88 FPS, 49 ms worst and zero such gaps. Freezing atlas refresh alone
also eliminates 100 ms gaps (20-second diagnostic, 17.40 1% low). These freezes
are diagnostic ablations, not shipped rendering modes.

Live plates now opt into CPU-backed source canvases and separate CPU-backed atlas
pages; static panels retain their existing canvas pages. A changed plate copies
one full-resolution guttered rectangle into its retained GPU page using a typed
pixel buffer, rather than transferring the full canvas page. Each render frame
refreshes at most one live panel. The fair queue coalesces to the newest source
pixels and schedules demand frames after pause; deletion cancels queued slots.
Full CPU pages stay current for context restoration and structural edits. The
960 × 540 TV plus gutters uploads 2,097,664 bytes instead of a 16,777,216-byte page.
This trades immediate wall-wide refresh for up to 28 rendered frames of spread
at a minute change, and adds retained CPU pixel backing for the live atlas pages.
It changes no station document, train schedule, simulation step or panel resolution.

Matched first-Play captures use Low, normal benchmark presets, 16×, 30 seconds,
seed 7654321, zero initial population, Chrome 155 / ANGLE D3D11 on i7-14700KF /
RTX 4080 SUPER. `BENCH_CANVAS_SIZE=1352,787 BENCH_PIXEL_RATIO=1.5` produces
2028 × 1180 pixels, within one pixel of the supplied screenshots. Baseline and
patched builds use the same committed simulation; an ignored isolated source
snapshot excludes concurrently arriving passenger-activity changes. Captures run
sequentially without tests/builds/profilers competing on this task.

| Station | Baseline average / 1% low FPS | Patched average / 1% low FPS (two fresh runs) | Worst gap, baseline → patched |
|---|---:|---:|---:|
| Tanwei | 28.37 / 3.17 | 35.96 / 22.70; 37.64 / 23.29 | 398 → 51 / 55 ms |
| Zoo | 34.88 / 2.72 | 58.36 / 34.45; 58.94 / 33.75 | 435 → 36 / 38 ms |

Tanwei/Zoo baselines have 43/20 gaps over 100 ms; all four patched runs have zero.
Both stations clear the 15 FPS 1% low goal in both fresh runs. Tanwei ends at
ticks 465 baseline / 471 and 474 patched, populations 880 / 876 and 874; Zoo ends
at ticks 485 / 484 and 484, populations 309 / 310 and 310. All captures report
zero runtime/GL errors. Tick differences reflect wall-clock playback scheduling.
These are
submitted-frame intervals, not compositor presentation timestamps. Headless
hardware results do not guarantee the same rates on every machine. Raw captures,
ablations and intermediate unsuccessful canvas/typed-only variants are under
`.preview/perf/sim-stalls/*tail*.json`; `*-tail-target-*` are the matched large
viewport captures. Intermediate unbounded patches improved tails but did not meet
15 FPS, and are not the selected implementation.

`draw-batching` pins bounded upload area, stable UVs, row orientation, CPU restore
pixels, unchanged static pages, fair latest-only queueing, removal/reuse and the
headless full-upload fallback. `scene-wiring` pins paused queue draining.
`node tools/check-panel-atlas.mjs` compiles the real atlas and verifies actual GPU
colour/orientation/gutter pixels before and after repaint and GPU reallocation;
its report is `.preview/perf/panel-atlas/report.json`. The pixel check passes with
zero GL errors and one 2,880-byte patch for its 32 × 16 fixture.

Validation: the isolated production build and current workspace typecheck pass.
The focused draw-batching run passes 16 checks; the final queue/pause subset
passes three checks. Production batching checks pass with native multi-draw and
with the extension disabled, preserving open/closed train triangles and reporting
zero GLSL/WebGL/runtime errors. Native station draws are 3,789 → 1,105 with
batching; fallback is 3,789 → 1,768. These are functional batching controls, not
playback FPS measurements.
The broad isolated suite records 2,364 passes / 10 failures: nine failures were
missing cross-repository fixture/import paths and all affected suites pass a
28-check rerun once those paths are restored. The remaining audio assertion at
`game/test/audio.test.mjs:64` expects two native `type="range"` strings in
SettingsMenu, which now uses the shared Slider component; it also fails in the
main workspace without this atlas change. No full-suite pass is claimed. Logs
are `tail-full-tests.log`, `tail-fixture-recheck.log`, `tail-unrelated-checks.log`
and `tail-batching-{native,fallback}.log` under `.preview/perf/sim-stalls/`.

### Benchmark protocol

Run comparable browser benchmarks sequentially, with no build, test or profiler competing
for the host. Match fixture, seed, camera, population, viewport, hardware, browser and GPU
backend. Record event work counts with timings: raycasts, model/graph rebuilds, allocations,
uploads, cache hits, fixture dimensions and worker ticks. Separate CPU readiness, renderer
submission, GPU timing and presentation delay. Keep clean timing runs separate from profile
runs and use a distinct `BENCH_OUTPUT` for each capture.

Use the shipped demos without replacing their authored data. `BENCH_STATION` selects an
external save; `BENCH_DEMO` selects Zoo or Tanwei where supported. Browser benchmarks use
hardware rendering by default; `--software-gpu` or `METRO_BROWSER_GPU=software` selects
SwiftShader. `METRO_BROWSER_GPU=hardware` opts out of software rendering where supported.
Raw JSON, screenshots, traces and CPU profiles belong in ignored `.preview/perf/`.

The in-game `/benchmark` route gives players the same first-30-seconds playback sample
in their own browser (`/benchmark/en` selects English; `/benchmark` uses Chinese).
Select Zoo or Tanwei, Low or High graphics detail, and normal or exploded view; the
route runs at 16× and charts submitted-frame FPS with the average, slowest-1%-interval
FPS and worst gap. Its result includes the browser-visible GPU,
logical-core/memory hints where exposed, viewport and fixture size. Browser access to
hardware details is limited, so unavailable values are shown as such. This route is a
local machine diagnostic, not a matched before/after performance claim; controlled
comparisons still follow the protocol above. In normal view, Tanwei uses Hide UI at
its authored default opening level and retains the default isometric direction; Zoo
hides the ground, opens at −15 m and uses the TOP/N/W view-cube corner. Both use the
same 2/3 camera-distance factor (50% closer). Exploded view uses its standalone
viewer camera. Game input is blocked for preparation and throughout the 30-second
sample. Results report the active level so the selected view can be compared with
the capture.

### Current validation routes

| Question | Command / regression |
|---|---|
| Demo workflow, palette and common edits | `npm run bench:usage-tour` |
| Pointer-to-visible placement budget | `npm run bench:placement` |
| Drag previews and blocked demo footprints | `node tools/bench-drag-latency.mjs` |
| Fence preview locality and cancellation | `node tools/bench-fence-drag.mjs` |
| Equipment placement retention | `node tools/bench-tree-placement.mjs` |
| One-pick event contract and ramp occlusion | `node tools/check-tool-picking.mjs` |
| Geometry-based snapping | `node tools/check-geometry-snapping.mjs` |
| Storey switch and view-cache behavior | `node tools/bench-level-switch.mjs` |
| Mounted settings and presentation edits | `node tools/bench-settings-audit.mjs` |
| Palette preview locality and LOD | `node tools/bench-preview-audit.mjs`, `node tools/check-preview-lod.mjs` |
| Exploded-view lifecycle and presentation | `node tools/check-exploded-view.mjs` |
| Exploded-view regular/live FPS diagnostic | `npm run bench:explode` |
| Simulation-play frame-tail attribution | `npm run bench:sim-stalls` |
| Train, passenger and equipment triangle inventory | `node tools/model-triangle-inventory.mjs` |
| Render batching and fallback path | `node tools/check-render-batching.mjs`, including `--no-multi-draw` |
| Production browser tools | `npm run check:perf-tools` |

`npm run bench:placement` measures real pointer input against both demos. Its pinned
targets must each add exactly one bench and use at most one scene raycast. The demo
collision benchmark must include blocked footprints; empty-floor fixtures miss the
expensive refusal path. `npm run bench:explode` samples regular and exploded views at
High and Low quality, with warmup and worker tick counts; camera and canvas differ by
view, so compare only matched scenarios.

For implementation changes, run the owning focused regressions, inspect changed-module
line/branch/function coverage, then run the full game suite and production build. Renderer
or performance changes also require `npm --prefix game run test:perf` and the relevant
production browser check. Browser times are evidence; deterministic work-count and
lifecycle assertions are the gates. Never weaken asset-integrity checks or alter generated
provenance to make a performance run pass.

### Model inventory upkeep

The triangle tables above are current authored per-model counts, not station totals.
Regenerate them after changing model geometry or detail policy with
`node tools/model-triangle-inventory.mjs`; generated JSON/Markdown and browser captures
remain in ignored `.preview/perf/`. Low geometry is an authored quality variant where
available; unsupported parts stay full detail. Scene totals and FPS depend on the fixture,
view, graphics quality and batching path, so do not infer them from per-model counts.

### Above-ground room filtering in exploded view

For documents with authored above-ground station floors, presentation geometry now
follows room/fare-zone/auto-floor footprints with a one-cell enclosure margin per
storey. A connected bridge beam cannot turn remote foundations into rooms, and
upper-story supports cannot borrow a floor from the story above. Fixtures and
exterior-only stairs/exits outside retained room plans are omitted; rail/platform
modules remain. Documents without authored above-ground floor labels retain the
existing unfurnished-floor fallback. Ground rooms and underground landing rules
remain intact. Tanwei now has only -10/-5/0/5/10 m trays: its roomless 15/20 m plant
fragments and detached virtual stair/exit are absent. The existing raised-floor
regression now asserts every labelled usable floor, rather than every unlabelled
concrete support slab. Every retained authored stair flight still translates intact.

`exploded-view`, `exploded-support`, `exploded-passengers` and `layering` guard
these presentation contracts. `tools/check-exploded-view.mjs` checks both demos'
camera/playback controls, unchanged editor document/history/camera, live passenger
support, suspended train updates and Escape cleanup. Raw reports/screenshots belong
under `.preview/perf/exploded-view/`; current playback measurements and validation
limits are recorded above.

