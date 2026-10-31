# Performance work in metro

This is a living performance guide and measured-state record, not a changelog.
Update an existing section only when new evidence changes a performance budget,
measurement, benchmark procedure or known bottleneck. Include the scenario,
workload, observed result and limits. Do not add dates or feature summaries.
Functional behavior and unrelated validation belong in their owning code, tests or
documents. If a change has no measured performance result, leave this file alone.
## Exploded floor arrangement

`node tools/check-exploded-view.mjs` measures a real click on visible floor geometry,
then a left press, 120 px right / 80 px up move and release, ending after two RAFs.
The production capture in `.preview/perf/exploded-view/report.json` uses the shipped
Zoo and Tanwei fixtures, five trays each, a 1384 × 690 canvas, paused simulation,
local headless Chrome with hardware GPU requested, and two fresh viewer openings
per station. No build, test or profiler runs competed with this capture.

| Fixture | First / second opening to ready | First / second drag round trip | First / second hide-show round trip |
| --- | --- | --- | --- |
| Zoo | 6887 / 6160 ms | 94.7 / 80.0 ms | 77.4 / 78.1 ms |
| Tanwei | 9477 / 9051 ms | 167.1 / 116.3 ms | 69.0 / 71.4 ms |

These interaction values include five CDP input calls, a selection assertion and
two RAFs, so they are diagnostic upper bounds rather than isolated
input-to-first-render measurements. Both Tanwei drags do
not meet the strict <100 ms budget on this conservative measure; this capture does
not establish its handler latency, sustained dragging FPS or a performance gain
over a prior implementation. Initial shader/geometry preparation is accounted for
separately in opening time, rather than hidden in a warmed interaction claim.

The workload retains front perimeter walls at opening and partitions their baked
chunk triangles by owning cell for the wall control. These measurements include
that preparation; they are not a controlled before/after performance comparison.
Floors are baked and ramp triangles physically clipped once during opening.
Each press resolves one scene raycast; movement changes a retained floor Group's
translation, with no scene pick, document commit or geometry rebuild. The former
per-vertex-height displacement was rejected because faces could stretch between
different floors. `exploded-layout.test.mjs` guards immutable vertex buffers,
physical cuts, picking after movement, selection/highlight/reset, source ownership
and paused/live pose offsets. The browser check guards direct rendered-floor
selection, camera/document isolation, unchanged geometry/vertices, empty-space
deselection, reset, live playback and shader compilation on both fixtures. Baked
floors use ordinary transformed bounds and retain frustum culling.
The capture includes dashed stair/escalator/elevator guides. Movement rewrites
their retained endpoint and dash-distance buffers only, with no added scene pick
or floor rebuild; `exploded-connections.test.mjs` pins that reuse and independent
endpoint motion. The browser check verifies attachment and reset on both fixtures.
The side panel shows only the selected floor's wall/floor controls and toggles retained batches, without geometry
rebuilds or scene picks; wall classification is a separate bake bucket. Hide-show
timings include two complete native-pointer clicks (four CDP input calls), two RAFs
after each click, and state assertions. They are combined diagnostic round trips,
not per-toggle handler timings or a new FPS gate. Incident guides use retained
buffers/draw ranges and live poses omit hidden trays. Panel placement projects
eight cached bounds corners per drawn frame, rather than walking meshes or picking
the scene. Browser checks keep the hidden selection's panel open and restore it.
The same capture reproduces a cross-floor passenger transfer after aligning two
trays to the same displayed height. The old displayed-Z test interpolated through
the guide gap; original floor identities now travel with agent IDs before manual
displacement and visibility compaction. The interpolated position must equal the
destination at 10/50/90% of the packet interval. The two injected setAgents calls
take 0–0.1 ms at the browser timer's resolution (setup/restoration excluded); this
is a functional transition probe, not population-wide throughput or visible-frame
latency. It adds no pick, geometry rebuild, worker request or document commit.

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

### Repeatable editor action matrix

`npm run bench:editor-actions` builds the production app and audits every shipped
example station (`EXAMPLE_STATION_IDS`: Zoo and Tanwei). Its shared manifest,
`app/benchmark/editorActionCases.ts`, derives every structural/equipment/decor
palette entry from `MODULE_OPTIONS` and adds each discrete action-row setting:
roof widths/snap, pillar lengths/positions, stair widths and single/double/triple
length families, escalator/walkway width/direction/length, lift sizes/intervals/styles,
gate styles, bench/door widths, hanger lengths, curtain sizes, light positions,
PSD heights, bridge lengths/railings and road widths/direction. It also includes
blocks, auto-wall floor patches, full walls, suspended ceilings and all
half-wall/triangle orientations. Platform/tunnel tools live outside
`MODULE_OPTIONS`: they are explicit cases, including platform direction, each
demo's available line binding, catenary style and every tunnel length.
Settings are varied individually around the default; this is not a Cartesian
product with all rotations. Compound double TVs use both actual screen payloads.
The completeness regression rejects omitted palette entries, duplicate case IDs,
missing size families and invalid production factories.

Each case records `preview`, `place`, `pickup`, `move-preview`, `drop` and `delete`
separately, with three samples by default. **Every supported stage has a <100 ms
target**, including first rendered feedback. A product-unsupported action is
explicitly `unsupported` with its reason (for example raw-cell Move), never a zero
millisecond pass. Missing renders, wrong commit counts, unexpected preview
commits, failures and over-budget rows remain visible. Strict runs exit nonzero
on failures; `--record-only` collects a baseline without hiding failed rows.

The measurement driver calls the production preview, builder and store APIs in
the browser, including actual `confirmMove` and demolition helpers. It measures
preview generation CPU time, synchronous action time, and time to the first
renderer completion containing the committed document. It excludes CDP/network
round trips and is **API-to-render**, not DOM input latency or compositor
presentation. Real-pointer tools (`bench:placement`, `bench:block`,
`bench:block-edits` and `bench:usage-tour`) remain necessary to investigate input,
geometry targeting, gesture scheduling and the one-scene-pick-per-event rule.
Do not substitute API timings for a reported pointer stall.

The complete authored demo remains installed. Each case has a declared empty
staging bay, required walls/ceiling supports, fixed camera and paused simulation;
fixture preparation and screenshot readback are untimed. This isolates repeatable
subtype operations while retaining the demo's full document and scene allocations;
the GPU workload is the declared staging-camera view, not a whole-station FPS test.
It does not claim each staged payload could be aimed at every point in the demo.
Compare only matching fixture, view, canvas, pixel ratio, quality and GPU backend.
Use hardware for latency evidence; SwiftShader is an explicit diagnostic option.

Reports and per-case checkpoints live in unique run directories under
`.preview/perf/editor-actions/`; ordinary reruns preserve previous captures.
They include source/build/demo/script SHA-256 hashes, Git revision, CPU/OS,
Chrome/GPU, camera/canvas/quality, sample index, exact case settings and action
inputs, commit counts, generation/handler/frame timings and stage work counts.
Stage keys map back to the owning source file. Preview screenshots are replayed
outside timing. `--profile` creates per-demo/per-case CPU profiles in a separate
run; never combine profile timings with clean baseline timings.
The runner retains the captured source tree and exact driver/harness alongside
the build so dirty working-tree changes remain attributable after later edits.

```powershell
npm run bench:editor-actions
# Initial complete baseline, retaining all failures:
node tools/bench-editor-actions.mjs --record-only
# Reproduce one row, using the same build and declared fixtures:
$env:BENCH_DEMO='tanwei'
$env:BENCH_CASE='stair-right90'
$env:BENCH_SAMPLES='3'
node tools/bench-editor-actions.mjs
# Optional source maps for original-file/line CPU attribution:
$env:BENCH_SOURCE_MAP='1'
npm --prefix game run build
node tools/bench-editor-actions.mjs --profile --record-only
Remove-Item Env:BENCH_SOURCE_MAP
```

`BENCH_CASE` accepts exact comma-separated case IDs; `--list` shows the manifest.
`BENCH_SAMPLES` accepts 1–10. `BENCH_ACTION_OUTPUT` selects an exact artifact directory.
`BENCH_DIST` can point to a fixed production-build copy. `BENCH_RESUME=1` reuses
only complete checkpoints matching source, build, demo, driver, host/browser/GPU,
case and sample count. Resume is marked explicitly: it does not replay preceding
cases' cache history. Use a fresh ordered run for matched comparisons; partial,
filtered and resumed runs must not be represented as a fresh full-matrix pass.
To resume, point `BENCH_ACTION_OUTPUT` at the original run directory explicitly.
`BENCH_SOURCE_DIR` pairs a saved source snapshot with `BENCH_DIST` for historical
reproduction. The build emits a source fingerprint, rejects concurrent source
edits during compilation, and the driver refuses stale source/build pairs.
The runner serves a verified copy of the build, rejects a source/build manifest
mismatch, and stores profiling artifacts in a separate `profiles/` directory by
default. The double-TV move row carries the picked screen; placement/deletion
retain the compound two-screen operation.
Benchmark maps omit embedded sources to stay under the normal asset-size cap;
use the captured source snapshot for original files. Asset integrity limits stay
enabled in these local builds.

The initial one-sample baseline covers all 404 Zoo and 405 Tanwei cases (809 total) on the i7-14700KF / RTX 4080 SUPER, High quality, 892 × 815 canvas at pixel ratio 1. Tanwei resumed matching checkpoints from the same frozen source/build pair after the initial capture stopped; its report marks `resumeRequested: true` and `complete: true`. Results include one sample per setting value, not a warmed distribution.

| Demo | Cases | Preview max frame | Move-preview max frame | Place max frame | Drop max frame | Delete max frame |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Zoo | 404/404 | 48.3 ms | 74.7 ms | 1,112.6 ms | 855.3 ms | 872.6 ms |
| Tanwei | 405/405 | 75.6 ms | 67.1 ms | 2,327.7 ms | 2,498.8 ms | 2,285.7 ms |

Across both demos, 2,654 of 4,854 stages passed, 1,757 exceeded 100 ms, two had functional errors, and 441 actions are unsupported by the product. All 809 previews and all 662 supported move previews passed. Place passed 307/809; drop passed 69/662 supported cases, with two PSD-cover move/drop refusals; delete passed 145/809. The target is met for preview generation and move preview, but broadly missed for drop/delete and often for place. These maxima include time through the first rendered feedback, so they identify work that still needs optimization.

The current per-equipment matrices for both demos, with each setting value and action breakdown, are in [the readable matrix](editor-action-matrix.md). The [machine-readable capture](editor-action-matrix.jsonl) retains all 809 cases, exact inputs, stage timings and work counters under its declared source/build hashes. These companions track the newest full inventory; the follow-up sections below distinguish their source builds and repeated selected-case captures from this initial baseline.
#### Shared ceiling-support indexes in structural commits

The existing separate `profile-check` capture maps repeated ceiling support work
to `ceilingMountHeight` during model-retention checks. Each hanging fixture scanned
the complete cells/modules arrays, including nested solid-cell scans. Immutable
cell arrays now own a shared solid-coordinate set and exposed-underside columns;
module arrays own filtered hanger/ceiling-track lists. Replacing either array
invalidates its index, while undo can reuse the old arrays. WeakMap ownership adds
derived memory proportional to the retained document, without retaining discarded
documents globally. Placement rules, document commits and pointer picking are unchanged.

Fresh sequential, unprofiled three-sample captures compare the same current
workspace with and without only this index change. Tanwei, paused staging view,
High, 892 × 815 canvas, pixel ratio 1, HeadlessChrome 156, i7-14700KF / RTX 4080
SUPER / ANGLE D3D11. Cases run in manifest order, straight then short left-180.
The baseline source/build hashes are
`bc06d5c996945d34f33bcb828c7cd236d7feb955e98f82475802d394e87914b5` /
`e93fae68d509c02a2707643ec72bc10b79b51fd9cc226a284650b879393cd6ce`;
patched hashes are
`5ca83725a88e203050d0badcc26c1cad4d677dfce5ccf345a7a36bd97403d87b` /
`9116335700e1a91779c1dcd5985f2a31091be14c2c01b0ec5b5eedc7f6720627`.

| Case / action | Median API-to-render, before → after | Median module build, before → after |
| --- | ---: | ---: |
| Straight / place | 1539.9 → 1002.4 ms | 755.9 → 302.7 ms |
| Straight / drop | 1490.5 → 1036.3 ms | 747.8 → 293.1 ms |
| Straight / delete | 1333.4 → 825.7 ms | 649.6 → 177.0 ms |
| Left-180 short / place | 1499.6 → 1054.2 ms | 732.7 → 328.4 ms |
| Left-180 short / drop | 1530.9 → 1043.3 ms | 733.0 → 309.4 ms |
| Left-180 short / delete | 1407.9 → 962.0 ms | 697.3 → 293.5 ms |

That ceiling-index-only comparison still misses the interim <500 ms goal; the normal <100 ms target remains.
Patched first feedback ranges from 770.7 to 1217.9 ms across these commit samples.
Patched median chunk meshing remains 352.8–387.2 ms. The existing mesh cache
retains geometry but structural edits still rebuild storey grouping, chunk keys
and halo coordinate lists. Reusing those dependency lists and bounding structural
invalidation to old/new footprints plus classification/face/AO neighbors is the
follow-up described below. At this point they were not implemented. Unknown structural
inputs must retain the conservative path. Stage timings are nested, not additive.
These filtered runs do not repeat the historical complete matrix, establish
real-pointer latency or measure compositor/GPU completion.

Raw source/build snapshots, browser metadata, fixtures, per-stage counters and
screenshots are under `.preview/perf/ceiling-cache-{baseline-clean,patched}/`.
The earlier `ceiling-cache-baseline/` is a preparatory capture, excluded from the
comparison. `ceiling-cache-equivalence.json` confirms identical mount heights for
all 234 Zoo / 436 Tanwei hanging fixtures against the frozen original helper.
`ceiling-decor` pins zero reads of 2,000 unrelated cell/module records across 20
warm queries, cell/module replacement, lower-course occlusion and undo. Focused
tests: 56 pass; placement focused coverage: 80.15% lines, 59.51% branches, 62.21%
functions, with no uncovered lines in the new index/helper range. Full suite:
2492 pass; `test:perf`: 749 pass; production build passes. The instrumented suite
took 565 seconds and completed normally. Browser timing captures ran without
build/test/profiler competition; the production audit reports no runtime/GL errors.

#### Stair commits below 500 ms

The next investigation found four separate costs: structural edits rebuilt cache
keys/halos for remote chunks; underground ceiling checks still scanned all cells
and modules through `virtualSolidAt`; a coordinate-to-single-cell diff invented
changes for Tanwei's duplicate authored records; and ramp placement cloned every
cell even though carving replaces changed records. The separate module-breakdown
diagnostic builds 35 models on place/drop and 34 on delete for a staged remote
stair. After duplicate-aware comparison, the same diagnostic retains all 9,694
existing models and builds only the new stair. Authored duplicates stay intact.

Ramp placement now copies the array while sharing untouched Cell/finish/tag
records. `changedCellRecords` compares ordered duplicate records, caches comparisons
against immutable array pairs and shares the result between chunk preparation and
model retention. Integer underground support checks use the existing block index;
fractional imported anchors retain their original ground predicate. `storeyBand`
uses the same clipped grid arithmetic without allocating a 15-entry list per query.
Retained model roots also cache activity-rig discovery and retain their live poses.
The latter removes deterministic repeated tree work; its isolated browser run did
not establish a material latency improvement.

Structural stair/escalator edits still prepare the full exact geometry state.
They compare old/new cell records, ground/solid membership, finishes, hidden cells,
thin sides, slope cuts/fills and platform insets, then rebuild changed columns at
every height with the two-cell classification/face/AO margin. Remote chunks skip
hashing and retain their GPU allocations. Changed windows, storey grids, unknown
module changes and more than 64 affected chunk columns keep the conservative path.
Custom effective-cell inputs retain full record comparison. The chunk cell index
preserves duplicate records, and a vanished column clears its former floor entry.
Preview work, saved geometry and one-pick input dispatch are unchanged.

A fresh frozen baseline follows the ceiling-cache build above, with source/build
`5ca83725a88e203050d0badcc26c1cad4d677dfce5ccf345a7a36bd97403d87b` /
`9116335700e1a91779c1dcd5985f2a31091be14c2c01b0ec5b5eedc7f6720627`.
Final source/build hashes are
`469d5edc8d846cb959278c48ad90a2c7f2103dd132c1f40ee1040ced54f8a1d9` /
`ee75e054a54ed2d415ec4bc0a644e6bf79e89f3f6843555f5aacb026bf1cc43f`.
Fresh baseline and final captures run sequentially, without competing builds,
tests or profiles: Tanwei, High, paused staging camera, 892 × 815 canvas, ratio 1,
HeadlessChrome 156, i7-14700KF / RTX 4080 SUPER / ANGLE D3D11. Both use three samples
per case and the same authored demo, staging supports and camera for matching cases.

| Case / action | Median API-to-render, baseline → final | Final maximum of three samples |
| --- | ---: | ---: |
| Straight / place | 1071.8 → 366.6 ms | 372.7 ms |
| Straight / drop | 1094.1 → 390.6 ms | 436.6 ms |
| Straight / delete | 904.9 → 328.8 ms | 331.2 ms |
| Left-180 short / place | 1083.9 → 347.3 ms | 357.5 ms |
| Left-180 short / drop | 1081.4 → 351.7 ms | 420.3 ms |
| Left-180 short / delete | 1061.1 → 326.9 ms | 403.3 ms |

The final sweep covers all eight default stair families, default escalators,
left-180 width 2.04, single ultra-short/short and double/triple ultra-long settings:
14 cases × three samples × place/drop/delete = **126 commits, all <500 ms**.
Feedback ranges 301.9–491.5 ms; the maximum is a center-forward stair drop.
All non-commit stages remain <100 ms and there are no functional/runtime/GL errors.
This is an interim 500 ms pass for the selected cases, not the full 809-case matrix
or the normal 100 ms commit target. It measures submitted API-to-render feedback,
not real-pointer latency, compositor presentation or GPU completion. The 8.5 ms
margin in the slowest sample does not guarantee the same bound on other runs or hosts.

For the two matched cases, final median chunk meshing is 7.8–18.5 ms versus
379.0–415.0 ms; module building is 53.2–74.6 ms versus 208.3–343.4 ms. Full chunk
preparation remains 58.6–69.7 ms. Stage times are nested, not additive. Final
place/drop builds exactly one model and deletion zero; chunk-key cell visits are
zero, and 256–1,536 cells are meshed. These counts describe bounded remeshing, not
zero document-wide preparation. The audit now records retained-ID/model/cleanup
stages plus hashed/meshed cell counts per commit.

Raw reports, source/build snapshots, environment, fixtures and screenshots are
`.preview/perf/stair-500-baseline-fresh/` and `stair-500-shared-cells/`.
`stair-500-profile-{before,second}/` are separate profiling runs; module timing
breakdown and pure retention diagnostics are under the same prefix. Intermediate
`first`, `second`, `third`, `fourth`, `final`, `sweep` and `sweep-final` captures
are retained, including their 500–850 ms misses; only `shared-cells` is the selected
final sweep. The broad sweep is ordered differently from the two-case baseline;
per-case fixture/camera/sample settings match, but previous-case cache history differs.

The first one-sample full action matrix after the stair work ran against that same
source/build and complete Zoo/Tanwei fixtures. It recorded 57 action stages over
500 ms in 38 cases. Its complete report remains at
`.preview/perf/editor-actions/run-2026-10-26T05-13-20-296Z-44188/report.json`.
Platform and
tunnel commits now dominate the largest stalls. The full ordered run also measured
Tanwei `stair-left180/span=triple;length=ultra-long` drop at 502.0 ms once, while
the selected three-sample sweep for that case peaked at 455.9 ms. The follow-up
below includes this boundary miss in its slow-case set; the 14-case sweep result
applies to that build's matched staging fixture and sample history, not every run.
The full matrix is an inventory with one sample per case, not a distribution.

`floor-geometry` checks all eight stair families and escalators in all four rotations
across place/move/delete/restoration against fresh rendered triangles, normals and
UVs, plus identical floor ownership, retained remote allocations and bounded key
work. Its source cells, finishes and tags are frozen; unchanged records retain
identity. Duplicate records are included. `equipment-retention` pins duplicate-aware
diff invalidation and activity registries; `ceiling-decor` pins bounded warm
underground queries, excavation invalidation and fractional fallback; `storey-height`
pins shifted/clipped grid equivalence and zero list allocations. Focused coverage
passes 89 checks; the final sharing change also passes 75 focused checks and a
separate frozen-carve coverage run covering the changed array-sharing lines.
The production build passes, the full game suite passes all 2,496 tests, and
`test:perf` passes all 753 checks in 516.9 seconds. Its reported changed-module
line / branch / function coverage is:

| Module | Lines | Branches | Functions |
| --- | ---: | ---: | ---: |
| cellChanges | 100% | 100% | 100% |
| moduleDependencies | 100% | 97.65% | 100% |
| ChunkSystem | 97.93% | 97.48% | 89.66% |
| ModuleSystem | 84.19% | 92.61% | 72.22% |
| Equipment | 90.44% | 92.59% | 78.38% |
| constants | 99.11% | 83.33% | 100% |
| placement | 95.87% | 87.87% | 89.78% |

Logs are `.preview/perf/stair-500-{full-tests,perf-tests,focused-coverage,carve-coverage}.log`.

#### Remaining structural commits below 500 ms

The 57 stages above 500 ms are the baseline for this follow-up: 55 Tanwei stages
and two Zoo stages, across 38 cases. Separate profiles of platform placement,
128 m tunnel edits and wide glass doors show whole-station chunk hashing,
repeated model/cell dependency checks, and new train construction on platform
placement. Profiling captures live in `.preview/perf/remaining-500-profile-before/`;
their times are diagnostic and are not mixed with clean comparisons.

Known rail, shaft, exit and furniture edits now compare the same exact prepared
chunk inputs as stairs. Generated street membership participates in that diff,
including window expansion/shrink. Only affected columns update their cell index
and remesh; remote geometry stays allocated. Unchanged ramp/exit and platform-edge
records retain their derived cuts/insets. Unknown module kinds, changed storey
settings and more than 256 affected chunk columns retain the full path. The
complete solid/finish preparation still runs; this is bounded index rebuilding
and meshing, not zero document-wide work.

Large cell diffs use spatial buckets for model dependencies, rather than testing
every fixture against every changed tunnel cell. Independent models skip that
query, each dependent envelope is prepared once, and bridge-support comparisons
search a shared list of bridge tracks. Bridge validation shares one proposed
module array across its piers. Immutable module arrays cache their exit readers;
cell/module array pairs share readonly thin-wall derivation between viewport and
mesher. These weak caches expire with their source documents.

Train geometry selection now excludes yaw and door-side bits: they update the
live pose. Stock, car count, direction, scale and power still select geometry.
Available space within the existing eight-dormant-model cap prepares a second
copy of each existing appearance, so a new platform can consume a spare. Live
consists are not stolen during document preparation. Curved door parts additionally
use an exact 64-entry LRU keyed by all source vertex/index data and curve inputs;
each caller receives an independent geometry copy. This spends bounded derived
memory and more construction during station opening to avoid construction on an
ordinary platform commit. Station-opening latency is not measured by this audit.

Final source/build hashes are
`152fa034a3a25d2ac358de0deabd4822ae4d6fa30f55a747f0ee9666f1846fcb` /
`c6ded93328f98c171f9a4d21c13da43d24f587ed3177a9e68b9915cff08a7a89`.
The clean three-sample recheck of all 38 previously slow cases records 423 timed
stages, including 255 commits, all below 500 ms. The maximum is 421.1 ms for
Tanwei `platform/line=5` deletion; Zoo peaks at 264.4 ms. All 171 repetitions of
the original 57 slow case/action pairs are below 500 ms. The other 261 stages are
product-unsupported actions, with no timing or pass claim. There are no functional,
runtime or WebGL errors in this selected recheck. Reports are
`.preview/perf/remaining-500-targeted-{zoo,tanwei}/`. Intermediate clean captures
`remaining-500-{first,second,third,fourth,fifth,sixth}/` retain their misses and work
counters; they are not represented as final passes.

The final fresh ordered full matrix, `.preview/perf/remaining-500-full/`, completes
all 404 Zoo and 405 Tanwei cases. **All 4,411 timed stages are <500 ms**, with a
464.9 ms maximum on Tanwei `platform/line=5` placement (Zoo maximum 351.6 ms).
Every one of the original 57 slow case/action pairs is now below 500 ms in this
matching one-sample inventory. The remaining 443 rows are 441 unsupported actions
and the two pre-existing Zoo/Tanwei PSD-cover drop refusals, which have no completed
feedback timing. There are no runtime/GL errors. This full capture originally populated the readable matrix and
JSONL companion, independently of the selected repeats.
Its 100 ms result was 2,910 passes and 1,501 over-budget stages; the next section owns the current companions.

| Family | Originally slow case/action pairs | Baseline maximum | Optimized maximum |
| --- | ---: | ---: | ---: |
| Platform | 16 | 1571.4 ms | 464.9 ms |
| Tunnel | 12 | 939.4 ms | 431.1 ms |
| Bridge | 11 | 876.1 ms | 420.8 ms |
| Lift | 5 | 557.8 ms | 275.1 ms |
| Exit | 4 | 551.9 ms | 320.5 ms |
| Glass/wood door | 6 | 587.9 ms | 212.4 ms |
| Shelf/cubicle | 2 | 523.0 ms | 198.9 ms |
| Triple ultra-long left-180 stair | 1 | 502.0 ms | 278.9 ms |

These are maxima across the same affected pairs in the baseline and optimized full
one-sample captures; a family's maximum can come from different variants. The
source fingerprint of that measured build matched its captured source.

The host/protocol remains i7-14700KF / RTX 4080 SUPER, HeadlessChrome 156 / ANGLE
D3D11, High, paused staging camera, 892 × 815 canvas, pixel ratio 1. Captures run
sequentially without competing builds, tests or profiles. Three-sample fixtures
reserve three sample positions; only the complete one-sample matrix is directly
comparable to the baseline matrix's per-case camera/fixture and sample count.
API-to-render feedback does not measure real pointer dispatch, compositor
presentation or completed GPU work, and no finite capture guarantees every future
run or imported station stays below the bound. The normal budget remains 100 ms.

Fresh-mesh regressions cover rail, shaft and furniture edits in all rotations,
street expansion/shrink, duplicate records, existing ramp cuts, floor ownership,
remote allocations and undo. Work-count regressions pin dependency-envelope and
warm exit/thin-wall cache reuse. Train checks pin independent door/LOD buffers,
exact cache copies/eviction, spare reuse across yaw/door flags, incompatible power
changes and bounded GPU eviction. The production build and all 2,502 game tests
pass. Production batching preserves open/closed train triangles with no
GLSL/WebGL/runtime errors; CPU/trace export checks pass. Logs are
`.preview/perf/remaining-500-{full-tests,render-batching,perf-tools}.log`.

#### Work toward the 100 ms editor budget

The preceding 500 ms inventory is the baseline for this pass: 1,501 completed
stages exceeded the normal 100 ms budget. Separate profiles of decor, wide doors,
turning stairs, auto-wall patches, platforms and tunnels exposed repeated model
catalogue serialization, whole-station batch aggregation, retained animation/tree
registration, occupancy/floor classification, and subscriptions in hidden build-menu
action rows. Profiles are diagnostic and include fixture preparation unless filtered
to the audited-stage stack; they are not used as clean latency samples. Captures are
`.preview/perf/target-100-profile-{before,next}/`.

Paint reuse now checks immutable module identities before serialization. Shared
module-array comparisons are weakly cached, and ordinary additions avoid the
stair-block-only scan. Remote opening edits skip unrelated raised-floor, ceiling
and surface dependency readers. Doors, shelves, cubicles and sinks retain chunk
inputs while continuing to update functional worker routing. Deleting a module
without stair landing cells no longer enumerates every remaining footprint.

Equipment batches apply root replacements/removals to affected bucket source lists
and preserve remote geometry signatures. They preserve source order, fall back on
reordering/view/mutable-input changes, and retire old views without publishing the
current tree twice. Source-only coverage reuses unchanged entry ownership. Retained
model roots preserve live animation registrations, and clipping skips their trees
only when both plane and storey view agree. Removed owners leave every registry.

Structural undo/redo retains immutable documents within the existing history caps.
Tool occupancy still derives the complete generated street, then merges its ordered
ground tails and all authored-cell differences to update only affected solid/floor
keys, including above/below dependencies and duplicate records. It does not skip
street derivation or thin-wall correctness. Closed build-menu rows retain a small
control snapshot for their fold animation and have no live store subscription;
those snapshots exclude document/history/graph/buffer state. Benchmark work counters
now separately include `tools.resolve` for this tool-index preparation.

Final source/build are `b63047800650b01abde1b061e2e4d62f2e9c06598735b885403cf2ade98c1765` /
`86e0634203bba21d074211f2613908a49c6574eca1fe89ba9a4c5aab1fb6dd54`. The matched six-case, three-sample recheck uses complete Zoo
and Tanwei documents, identical fixtures/camera/canvas/quality and normal hardware
rendering. It records 216 stages: 162 completed timings and 54 unsupported actions.
Passing timings increase **94 → 119**, and timings at/above 100 ms decrease
**68 → 43**. Both captures complete without functional/runtime/WebGL errors.
Reports are `.preview/perf/target-100-matched-{before,final}/report.json`.

The following medians and maxima aggregate place/drop/delete in each selected case;
unsupported moves are excluded. Three repetitions do not establish a tail distribution.

| Demo | Case | Before commit median | After commit median | Before → after maximum | After commits <100 ms |
| --- | --- | ---: | ---: | ---: | ---: |
| zoo | bench-steel-1 | 51.9 ms | 42.0 ms | 64.0 → 48.8 ms | 9/9 |
| zoo | stair-left180 | 151.2 ms | 113.8 ms | 167.8 → 125.5 ms | 3/9 |
| zoo | door-glass-1/wide | 99.4 ms | 38.2 ms | 106.9 → 42.6 ms | 9/9 |
| zoo | block/auto-walls | 73.5 ms | 66.2 ms | 308.2 → 280.3 ms | 4/6 |
| zoo | platform/line=5 | 176.6 ms | 143.5 ms | 199.6 → 167.2 ms | 0/6 |
| zoo | tunnel/length=64 | 169.1 ms | 128.3 ms | 180.1 → 159.6 ms | 0/6 |
| tanwei | bench-steel-1 | 98.8 ms | 66.1 ms | 164.4 → 83.0 ms | 9/9 |
| tanwei | stair-left180 | 313.7 ms | 171.9 ms | 409.8 → 191.2 ms | 0/9 |
| tanwei | door-glass-1/wide | 254.8 ms | 62.4 ms | 298.7 → 69.8 ms | 9/9 |
| tanwei | block/auto-walls | 142.6 ms | 96.4 ms | 189.5 → 135.0 ms | 4/6 |
| tanwei | platform/line=5 | 347.1 ms | 224.2 ms | 386.1 → 284.3 ms | 0/6 |
| tanwei | tunnel/length=64 | 297.3 ms | 209.3 ms | 358.6 → 230.9 ms | 0/6 |

The final fresh, ordered, one-sample inventory completes all **809 cases** and
**4,854 stages**. Of 4,411 completed-feedback timings,
**3,534 pass <100 ms and
877 remain over budget**, compared with
2,910 passes and 1,501 over budget in the baseline. 650 formerly
slow stages now pass; 26 formerly passing stages exceed the threshold
in this new sample. The maximum is **421.4 ms**, and
0 timed stages are at/above 500 ms. The two existing PSD-cover
drop refusals remain functional errors with no completed-feedback timing; all 441
unsupported actions remain explicit. Runtime/GL errors are absent. The current
readable matrix and JSONL companion contain only this full capture, not selected
samples merged into it. Report: `.preview/perf/target-100-full-final/report.json`.

Stair-family commits account for **639 of the 877 remaining misses**: 182 Zoo
and 457 Tanwei stages. Remaining over-budget rows have these mean measured work
times (nested counters must not be summed with their parent scene/level counters):

| Remaining family | Misses | Tool preparation | Chunk preparation | Chunk meshing | Module build/registration | Batch synchronization |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Zoo stairs | 182 | 20.7 ms | 12.0 ms | 8.1 ms | 17.4 ms | 10.0 ms |
| Tanwei stairs | 457 | 32.8 ms | 26.0 ms | 7.5 ms | 26.5 ms | 19.3 ms |
| Tanwei platforms | 14 | 61.8 ms | 37.9 ms | 45.6 ms | 42.4 ms | 35.3 ms |
| Tanwei tunnels | 12 | 66.3 ms | 38.3 ms | 31.9 ms | 44.1 ms | 47.5 ms |

These are means across each family's over-budget rows, not timings for every
variant or independent tail estimates. Full prepared street/chunk input reuse
across structural edits is the main remaining shared opportunity. Tanwei's shaped
cell edits also spend roughly 48–49 ms in batch synchronization despite short
dependency checks; long rail edits retain substantial local meshing/validation work.
Detailed grouped counters are in `.preview/perf/target-100-remaining-costs.json`.

The target is not yet met for every stage. The readable matrix lists remaining
counts by demo/action and the largest exact cases; the JSONL retains every affected
variant and measured work counter. Structural preparation, local chunk meshing,
track validation/construction and cell-dependent model work remain the next costs.
The audit retains full geometry and worker routing; neither a delayed document commit
nor reduced staging geometry is counted as an optimization.

The host/protocol remains i7-14700KF / RTX 4080 SUPER, HeadlessChrome 156 / ANGLE
D3D11, High, paused staging camera, 892 × 815 canvas and pixel ratio 1. Final captures
run sequentially after builds/tests/browser checks. Intermediate captures
`target-100-{first,second,third,fourth,fifth,matched-after}/` retain their results;
`target-100-baseline-clean/` overlapped an investigation build and is diagnostic,
not the matched baseline. The interrupted `target-100-full/` inventory is incomplete
and is not combined with the final run. API-to-render feedback excludes pointer
routing, compositor presentation and completed GPU work; one-sample inventories
and three selected repetitions cannot guarantee every future run stays below a bound.

All **2,509 game tests** pass on the final source. New checks pin fresh occupancy
through holes/duplicates/window changes/undo, exact structural history, zero remote
batch geometry reads, replacement/deletion/reordering equivalence, retained clipping
and hidden-menu subscription/snapshot ownership. Typecheck/production build pass;
production GPU batching preserves station/train geometry with no shader/runtime/GL
errors. The live tutorial passes all 18 steps and builder controls in both languages,
including reload/resume/escape and fixture lifecycle. CPU/trace export checks pass.
Logs are `.preview/perf/target-100-{final-tests,narrow-build,final-render,final-tutorial,perf-tools}.log`.

### Local place, drop, move and delete optimization

Local edits previously restarted station-wide tool indexes, chunk hashing,
equipment dependencies and batching. On the supplied 37,759-cell/135-module
save, original block pointer commits took 608–783 ms and revisited about 163,000
cells per edit. The optimized focused pointer audit measured 70 committing
place/delete/erase/stair-block-move gestures at 32.5–95.2 ms on an i7-14700KF /
RTX 4080 SUPER, High quality, 892 × 815 canvas and pixel ratio 1. This evidence
applies to that focused local workload; it is not a pass for the broad demo matrix.

Bounded cell deltas are shared across live tool indexes, model dependencies and
chunk preparation. Only affected chunk columns, vertical bands and face/AO halos
are remeshed. Remote geometry and unchanged equipment batches retain allocations;
known-dirty chunks avoid redundant content hashes. Commit helpers reuse prepared
preview occupancy without mutating it. Deletes preserve module identity when no
hosted equipment is removed, and retain old floor classifications until the mesher
compares them, so unchanged upper storeys survive. Local undo frames share immutable
records. Stair blocks use the equipment-content path; real ramps still compare
actual wall and landing inputs. Preview never commits the document.

Deterministic gates compare incremental/fresh mesh triangles, winding, normals,
colour and UVs, all cut orientations, support changes, deletion and undo; they pin
occupancy equivalence, remote/upper-storey retention, disposal and immutable history.
Large edits (>256 changed records), street-window expansion, virtual-ground holes,
hosted-module removal and unknown dependencies keep the conservative path. Keep
those cases visible against the same 100 ms target rather than excluding them
from the general action matrix. The fixed save-specific reproduction remains
available through `BENCH_STATION` in the focused pointer tools.

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
vehicles use 45%; passenger bodies are now opaque at both LODs. Low road vehicles stay at or below 10%
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

The current inventory covers 122 palette models totalling **9,947 Low / 162,011
High triangles**. **61 options are strictly below 10%** of their High geometry;
**61 use a minimum usable shape** (45 explicit exceptions, including the shared
housing and two faces of the double TV, plus 16 two-triangle artwork/floor quads).
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
| 小便池 | `urinal` | 6,880 | 648 | 9.4% |
| 移动网篮架 | `shelf-wire` | 6,524 | 412 | 6.3% |
| 厕所隔间 | `cubicle` | 5,688 | 72 | 1.3% |
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
| 双面 | `tv-double` | 132 | 28 | 21.2% |
| 屏蔽端门 | `psd-end` | 114 | 30 | 26.3% |
| 单面 | `tv` | 114 | 22 | 19.3% |
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

#### Urinal placement and model retention (27 October 2026)

A focused production-API capture on an i7-14700KF / RTX 4080 SUPER, 892 × 815
canvas at pixel ratio 1, used one sample per action in each demo. After declaring
`UrinalModel` standalone and cell-independent, all twelve first-render timings
were below 100 ms:

| Demo | Preview | Place | Pickup | Move preview | Drop | Delete |
|---|---:|---:|---:|---:|---:|---:|
| Zoo | 21.5 ms | 53.5 ms | 19.4 ms | 21.7 ms | 43.7 ms | 34.8 ms |
| Tanwei | 16.6 ms | 88.1 ms | 32.3 ms | 46.6 ms | 88.9 ms | 88.0 ms |

The preceding capture, with valid wall supports but without those declarations,
measured Zoo place/drop/delete at 795.4/812.2/638.6 ms and Tanwei at
1792.5/1638.3/1542.6 ms; the unknown builder invalidated unrelated models.
The paired reports are `.preview/perf/editor-actions/run-2026-10-27T23-16-25-535Z-8148/report.json`
and `.preview/perf/editor-actions/run-2026-10-27T23-17-16-554Z-10932/report.json`
(after source `e6275872e210`, build `40ffea4c335d`). Reproduce with
`BENCH_CASE=urinal`, `BENCH_SAMPLES=1`, `BENCH_MATRIX_UPDATE=0` and
`node tools/bench-editor-actions.mjs --record-only` after a build. These are
single-sample API-to-render timings, not real-pointer latency or a tail estimate;
the focused exploratory capture did not update the full action matrix.
`performance-policy` pins model retention on add/remove and cell edits;
`worker-preview` pins the skipped routing rebuild. `module-build` raycasts the
actual High and Low bowls and checks their envelopes in all four rotations.
The catalogue WebGL check rendered the urinal at 6,880 High and 648 Low triangles
(9.4%); its 12-sided Low shell and reduced fittings preserve the open bowl.
A focused V8-instrumented run of `model-detail`, `preview-lod`,
`performance-policy`, `worker-preview`, `equipment-placement-input` and `move`
passed 327 tests; `UrinalModel.ts` reached 100% lines, branches and functions in
that run. The raw report is `.preview/urinal/focused-coverage.log`.
The broader `test:perf` coverage run was stopped while the existing
`draw-batching` and `floor-geometry` files were still running, so it is not a
full-suite pass; the focused instrumented run and WebGL check above completed.

#### Equipment minimum-shape exceptions

Low targets strictly less than 10% of High. The documented exceptions below
keep a minimum usable shape, including the two-triangle artwork and floor quads.
Caps and reasons live in `tools/equipment-low-budgets.mjs` and are enforced by the
inventory and regression suite; High geometry is unchanged. Counts describe model
geometry; transparent two-sided materials can submit an additional GPU pass.

| Equipment / decor model name | Low / High | Minimum-shape exception |
|---|---:|---|
| bin | 26 / 196 | Two open hoppers, outer cabinet faces, dark wells and sorting label. |
| vent | 32 / 168 | Frame, dark duct and three louver strips visible above and below. |
| bench-seat-1 | 20 / 156 | Seat and back surfaces plus two supports. |
| door-wood-1 | 20 / 144 | Four frame members and a two-sided leaf. |
| tv-double | 28 / 132 | Two back-to-back TV screens with shared housing and suspension. |
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
| pillar-slim | 16 / 36 | Shaft and end collars, preserving height and support footprint. |
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

The selected soft-human catalogue has **440 appearances**: twenty clothing
choices per male/female category × eleven bag choices, all eligible at both ages.
`game/src/assets/passenger-approved.json` supplies standing plus three 24-frame
walks; `passenger-activities.json` supplies shared bind geometry and one 16-bone
activity rig with default/right/left action palettes per height fit. Runtime draws prepared instances with no per-agent GLB, skeleton,
animation mixer or geometry fitting. Skirts use the source body's waist/hips and
a local inner-thigh connection, with source smooth normals retained across colors.

The current shared draw stride is **8,101 High / 788 Low triangles
(9.73%)**. Every appearance's real Low row stays at or below
`floor(highTriangles * .10)` and references that appearance's existing animated
vertices. `passenger-low-topology.mjs` separates anatomy and palette regions,
preserves each pose's extrema and reduces the moving cloth topology separately.
Real appearances reference 2,562,491 High / 246,484 Low triangles in total;
short rows pad with degenerate triangles. The atlas has **218,396 vertex entries,
73 frames and 90 RGB colors**.

Both LODs share pose/normal/region and activity data. The full index table widens
to 2,048 pixels before exceeding the 8,192-row budget; the standing/walk atlas is
2,048 × 7,785 texels. Palette/geometry changes compile with the recipe
hash in the shader cache key. People are fully opaque at both LODs, with depth
testing and depth writes. Storey classification still uses `passengerLevel`: one crowd draw per
visible LOD, with a second possible for ghosted floors. No new draw per outfit.

Measured allocation inventory (`tools/measure-passenger-assets.mjs`):

| Asset workload | Previous 220 appearances | Current 440 appearances |
|---|---:|---:|
| Vertex entries | 110,385 | 218,396 |
| Padded High / Low triangles | 8,170 / 793 | 8,101 / 788 |
| Packed walking + activity payload, MiB | 23.57 | 44.63 |
| Prepared textures, both LODs, MiB | 147.92 | 296.30 |
| Prepared textures, High only, MiB | 143.92 | 288.36 |

Texture bytes follow actual allocation dimensions/formats and exclude driver,
render-target, instance-buffer and CPU-object overhead. This is not browser
process memory. Low reduces submitted geometry while retaining the shared pose
storage. Color regions currently duplicate some vertex entries: catalogue growth
therefore increases texture storage even though draw count stays bounded.
The current three-mode action matrix texture is 10.125 MiB, 6.75 MiB above the
previous single-mode 440-appearance build (289.55 MiB total). Bind geometry,
walking atlas and index strides are unchanged. Current allocation/build hashes
are in `.preview/perf/passengers-440/assets-handedness.json`.

Matched production playback uses Zoo, regular view, High, 16×, the first 30 seconds
of Play, 1,400 × 900 canvas, pixel ratio 1, active storey −15 with ground hidden and
ghosted floors visible. Both captures use Chrome 156 / ANGLE D3D11 / RTX 4080 SUPER
on an i7-14700KF, 14,073 cells, 4,291 modules and seed 7654321.
This earlier opacity comparison uses the same 440-appearance catalogue and source-body
bridge: the previous material was 70% High / 45% Low with no depth writes; the
current material is opaque and depth-writing at both LODs. The allocation table
above separately compares the earlier 220-appearance atlas with the expanded
440-appearance atlas. Traffic retains its own 70% High / 45% Low alpha policy.

| Submitted-frame measurement | 440 translucent | 440 opaque |
|---|---:|---:|
| Average FPS | 44.95 | 46.30 |
| 1% low FPS | 19.65 | 20.02 |
| Worst frame, ms | 53.30 | 52.50 |
| Frames over 100 ms | 0 | 0 |
| End tick / population | 484 / 330 | 484 / 330 |
| Final scene draws / triangles | 3,271 / 1,360,954 | 3,271 / 1,360,186 |

There is one unprofiled 30-second capture per build, with no overlapping tests or
other benchmark browsers. These observations do not establish a statistically
significant FPS difference or performance on Tanwei, Low, mobile GPUs or every
crowd density or cold page/atlas initialization. Both captures report zero runtime/GL errors. Fixture SHA-256:
`2792e9ea2bc455c7e9d04155c70cdb15d1bfb9f56c9262c585c28a8b673b6c3a`. Opacity-comparison recipe SHA-256:
`35d03d68723c0d201b9ffdc83aee8e5e4c819b4773f89fbb17905b525d0eacf6`. Build fingerprints and per-file hashes, raw frame/work
samples and exact payload/texture counts are in
`.preview/perf/passengers-440/assets-{220,440}.json` and
`playback-440-translucent.json` / `playback-440.json`.

Reproduce with a production game build, then set `BENCH_DEMO=zoo`,
`BENCH_MODE=regular`, `BENCH_QUALITY=high`, `BENCH_SPEED=16`, `BENCH_SECONDS=30`,
`BENCH_CANVAS_SIZE=1400,900`, `BENCH_PIXEL_RATIO=1` and a unique `BENCH_OUTPUT`
before `node tools/bench-sim-stalls.mjs`. Record asset/build fingerprints with
`node tools/measure-passenger-assets.mjs <output.json>` against that same build.
Do not mix timing with CPU profiles, traces or parallel test/visual runs.

The latest opaque build also walks on stairs, applies rail poses to every
escalator rider, and selects default/right/left action palettes while reserving
a hand-carried bag's hand. A separate clean capture uses the same production
configuration above, after the full suite and browser checks finished:

| Submitted-frame measurement | Prior opaque | Current stair/hand actions |
|---|---:|---:|
| Average FPS | 46.30 | 44.18 |
| 1% low FPS | 20.02 | 19.05 |
| Worst frame, ms | 52.50 | 57.70 |
| Frames over 100 ms | 0 | 0 |
| End tick / population | 484 / 330 | 484 / 330 |
| Final scene draws / triangles | 3,271 / 1,360,186 | 3,271 / 1,360,810 |

The new capture is slower in these samples; one run per build does not establish
a statistically significant difference or isolate hand-palette indexing from the
increased rail/stair animation workload. Both materials remain opacity 1,
transparent false and depth-writing, with 110 High / 11 Low passengers in the
final packed draws. Runtime/GL errors are zero. Current recipe SHA-256:
`fa6f335242edadba1eb1a298bb7c68903801acc0396bfb3b255b4fda97d014bb`.
Exact source/build allocation hashes are in `assets-handedness.json` and raw
frame/work samples in `playback-handedness.json`, both under
`.preview/perf/passengers-440/`. Keep the earlier opacity captures as the
historical comparison; the current three-mode storage inventory is separate.

Prior catalogue functional coverage exhausts **10,560 renders**: 440 appearances × two
ages × three views × standing/three walking samples. A separate **240 paired
High/Low** check covers ten named recipes, both ages, slow gait and the same
three views/four samples, including all four skirt cuts/palettes. Its minimum
High-mask coverage is 94.45% and minimum intersection-over-union
70.50%; the fixed gates remain 80% coverage / 70% IoU. This focused
pairing is not an exhaustive interpolation or all-gait visual audit. Numeric
`passenger-lod` tests independently cover all appearances and all 73 frame extrema,
10% budgets, shared disposal, storey routing and the widened index table's first,
middle and last appearance rows. `passenger-clothing` pins source hashes, exact
RGB colors, filled skirts and matching normal samples across the waist boundary.

`npm run bake:passengers` runs the selected-base baker and regenerates both
walking and activity assets. Legacy export and Low-only bakers do not own these
assets. `node tools/check-passenger-lod.mjs --quick` regenerates the focused pairs;
omitting `--quick` requests every appearance, both ages and all three gaits.
`tools/model-triangle-inventory.mjs` can regenerate the per-appearance table;
current raw counts are `.preview/perf/passenger-triangles.json`.
The standing-pose rebake retains 218,396 vertices and 8,101 padded High triangles;
the Low envelope now pads to 791 triangles (2,373 corners), up from 788 (+0.38%).
Every one of the 440 appearances remains within its 10% Low budget. All 72 walking
position/normal frames are byte-identical to the previous atlas. These are direct
bake counts, with no new FPS claim; earlier playback captures retain their recorded
strides and timings. The full inventory command stops at the existing
`cubicle-toilet` Low-budget assertion, so this passenger table is regenerated
directly from the baked per-appearance records.

| Passenger model | Low triangles | High triangles |
|---|---:|---:|
| soft-female-blue-navy-skirt-hiking | 791 | 8,101 |
| soft-female-tee-skirt-hiking | 791 | 8,101 |
| soft-female-blouse-skirt-hiking | 774 | 8,016 |
| soft-female-rose-slate-skirt-hiking | 774 | 8,016 |
| soft-female-blue-navy-skirt-daypack | 715 | 7,382 |
| soft-female-tee-skirt-daypack | 715 | 7,382 |
| soft-female-blouse-skirt-daypack | 704 | 7,297 |
| soft-female-rose-slate-skirt-daypack | 704 | 7,297 |
| soft-female-beige-blazer-hiking | 684 | 7,149 |
| soft-female-charcoal-suit-hiking | 684 | 7,149 |
| soft-female-navy-suit-hiking | 690 | 7,149 |
| soft-male-beige-blazer-hiking | 684 | 7,149 |
| soft-male-charcoal-suit-hiking | 684 | 7,149 |
| soft-male-navy-suit-hiking | 690 | 7,149 |
| soft-male-slate-suit-hiking | 684 | 7,149 |
| soft-male-beach-hiking | 678 | 7,145 |
| soft-female-trail-hiking | 670 | 7,021 |
| soft-female-cream-navy-hiking | 673 | 6,976 |
| soft-female-olive-charcoal-hiking | 673 | 6,976 |
| soft-male-casual-shirt-hiking | 673 | 6,976 |
| soft-male-cream-navy-hiking | 673 | 6,976 |
| soft-male-olive-charcoal-hiking | 673 | 6,976 |
| soft-female-stripe-hiking | 664 | 6,968 |
| soft-male-stripe-hiking | 664 | 6,968 |
| soft-female-commuter-hiking | 672 | 6,961 |
| soft-male-commuter-hiking | 672 | 6,961 |
| soft-male-sport-shorts-hiking | 668 | 6,894 |
| soft-female-blue-cream-hiking | 659 | 6,888 |
| soft-female-burgundy-sand-hiking | 659 | 6,888 |
| soft-female-polo-shorts-hiking | 659 | 6,888 |
| soft-male-blue-cream-hiking | 659 | 6,888 |
| soft-male-burgundy-sand-hiking | 659 | 6,888 |
| soft-male-polo-shorts-hiking | 659 | 6,888 |
| soft-female-blue-navy-skirt-handbag-right | 671 | 6,862 |
| soft-female-blue-navy-skirt-purse-right | 669 | 6,862 |
| soft-female-tee-skirt-handbag-right | 671 | 6,862 |
| soft-female-tee-skirt-purse-right | 669 | 6,862 |
| soft-female-blue-navy-skirt-purse-left | 669 | 6,861 |
| soft-female-tee-skirt-purse-left | 669 | 6,861 |
| soft-female-blue-navy-skirt-handbag-left | 669 | 6,860 |
| soft-female-tee-skirt-handbag-left | 669 | 6,860 |
| soft-female-coral-navy-hiking | 660 | 6,858 |
| soft-female-navy-sand-hiking | 660 | 6,858 |
| soft-female-sage-stone-hiking | 660 | 6,858 |
| soft-female-tee-shorts-hiking | 660 | 6,858 |
| soft-female-white-denim-hiking | 660 | 6,858 |
| soft-male-black-khaki-hiking | 660 | 6,858 |
| soft-male-coral-navy-hiking | 660 | 6,858 |
| soft-male-navy-sand-hiking | 660 | 6,858 |
| soft-male-sage-stone-hiking | 660 | 6,858 |
| soft-male-tee-shorts-hiking | 660 | 6,858 |
| soft-male-white-denim-hiking | 660 | 6,858 |
| soft-female-blouse-skirt-handbag-right | 653 | 6,777 |
| soft-female-blouse-skirt-purse-right | 654 | 6,777 |
| soft-female-rose-slate-skirt-handbag-right | 653 | 6,777 |
| soft-female-rose-slate-skirt-purse-right | 654 | 6,777 |
| soft-female-blouse-skirt-purse-left | 654 | 6,776 |
| soft-female-rose-slate-skirt-purse-left | 654 | 6,776 |
| soft-female-blouse-skirt-handbag-left | 653 | 6,775 |
| soft-female-rose-slate-skirt-handbag-left | 653 | 6,775 |
| soft-female-blue-navy-skirt-crossbody-left | 655 | 6,761 |
| soft-female-blue-navy-skirt-shoulder-left | 658 | 6,761 |
| soft-female-tee-skirt-crossbody-left | 655 | 6,761 |
| soft-female-tee-skirt-shoulder-left | 658 | 6,761 |
| soft-female-blue-navy-skirt-crossbody-right | 657 | 6,760 |
| soft-female-blue-navy-skirt-shoulder-right | 658 | 6,760 |
| soft-female-tee-skirt-crossbody-right | 657 | 6,760 |
| soft-female-tee-skirt-shoulder-right | 658 | 6,760 |
| soft-female-blouse-skirt-crossbody-left | 640 | 6,676 |
| soft-female-blouse-skirt-shoulder-left | 643 | 6,676 |
| soft-female-rose-slate-skirt-crossbody-left | 640 | 6,676 |
| soft-female-rose-slate-skirt-shoulder-left | 643 | 6,676 |
| soft-female-blouse-skirt-crossbody-right | 642 | 6,675 |
| soft-female-blouse-skirt-shoulder-right | 645 | 6,675 |
| soft-female-rose-slate-skirt-crossbody-right | 642 | 6,675 |
| soft-female-rose-slate-skirt-shoulder-right | 645 | 6,675 |
| soft-female-beige-blazer-daypack | 616 | 6,430 |
| soft-female-charcoal-suit-daypack | 616 | 6,430 |
| soft-female-navy-suit-daypack | 616 | 6,430 |
| soft-male-beige-blazer-daypack | 616 | 6,430 |
| soft-male-charcoal-suit-daypack | 616 | 6,430 |
| soft-male-navy-suit-daypack | 616 | 6,430 |
| soft-male-slate-suit-daypack | 616 | 6,430 |
| soft-male-beach-daypack | 614 | 6,426 |
| soft-female-trail-daypack | 604 | 6,302 |
| soft-female-cream-navy-daypack | 603 | 6,257 |
| soft-female-olive-charcoal-daypack | 603 | 6,257 |
| soft-male-casual-shirt-daypack | 603 | 6,257 |
| soft-male-cream-navy-daypack | 603 | 6,257 |
| soft-male-olive-charcoal-daypack | 603 | 6,257 |
| soft-female-stripe-daypack | 594 | 6,249 |
| soft-male-stripe-daypack | 594 | 6,249 |
| soft-female-commuter-daypack | 592 | 6,242 |
| soft-male-commuter-daypack | 592 | 6,242 |
| soft-male-sport-shorts-daypack | 590 | 6,175 |
| soft-female-blue-cream-daypack | 593 | 6,169 |
| soft-female-burgundy-sand-daypack | 593 | 6,169 |
| soft-female-polo-shorts-daypack | 593 | 6,169 |
| soft-male-blue-cream-daypack | 593 | 6,169 |
| soft-male-burgundy-sand-daypack | 593 | 6,169 |
| soft-male-polo-shorts-daypack | 593 | 6,169 |
| soft-female-coral-navy-daypack | 590 | 6,139 |
| soft-female-navy-sand-daypack | 590 | 6,139 |
| soft-female-sage-stone-daypack | 590 | 6,139 |
| soft-female-tee-shorts-daypack | 590 | 6,139 |
| soft-female-white-denim-daypack | 590 | 6,139 |
| soft-male-black-khaki-daypack | 590 | 6,139 |
| soft-male-coral-navy-daypack | 590 | 6,139 |
| soft-male-navy-sand-daypack | 590 | 6,139 |
| soft-male-sage-stone-daypack | 590 | 6,139 |
| soft-male-tee-shorts-daypack | 590 | 6,139 |
| soft-male-white-denim-daypack | 590 | 6,139 |
| soft-female-beige-blazer-handbag-right | 564 | 5,910 |
| soft-female-beige-blazer-purse-right | 565 | 5,910 |
| soft-female-charcoal-suit-handbag-right | 564 | 5,910 |
| soft-female-charcoal-suit-purse-right | 565 | 5,910 |
| soft-female-navy-suit-handbag-right | 574 | 5,910 |
| soft-female-navy-suit-purse-right | 569 | 5,910 |
| soft-male-beige-blazer-handbag-right | 564 | 5,910 |
| soft-male-beige-blazer-purse-right | 565 | 5,910 |
| soft-male-charcoal-suit-handbag-right | 564 | 5,910 |
| soft-male-charcoal-suit-purse-right | 565 | 5,910 |
| soft-male-navy-suit-handbag-right | 574 | 5,910 |
| soft-male-navy-suit-purse-right | 569 | 5,910 |
| soft-male-slate-suit-handbag-right | 564 | 5,910 |
| soft-male-slate-suit-purse-right | 565 | 5,910 |
| soft-female-beige-blazer-purse-left | 562 | 5,909 |
| soft-female-charcoal-suit-purse-left | 562 | 5,909 |
| soft-female-navy-suit-purse-left | 568 | 5,909 |
| soft-male-beige-blazer-purse-left | 562 | 5,909 |
| soft-male-charcoal-suit-purse-left | 562 | 5,909 |
| soft-male-navy-suit-purse-left | 568 | 5,909 |
| soft-male-slate-suit-purse-left | 562 | 5,909 |
| soft-female-beige-blazer-handbag-left | 563 | 5,908 |
| soft-female-charcoal-suit-handbag-left | 563 | 5,908 |
| soft-female-navy-suit-handbag-left | 573 | 5,908 |
| soft-male-beige-blazer-handbag-left | 563 | 5,908 |
| soft-male-charcoal-suit-handbag-left | 563 | 5,908 |
| soft-male-navy-suit-handbag-left | 573 | 5,908 |
| soft-male-slate-suit-handbag-left | 563 | 5,908 |
| soft-male-beach-handbag-right | 561 | 5,906 |
| soft-male-beach-purse-right | 564 | 5,906 |
| soft-male-beach-purse-left | 565 | 5,905 |
| soft-male-beach-handbag-left | 564 | 5,904 |
| soft-female-beige-blazer-crossbody-left | 550 | 5,809 |
| soft-female-beige-blazer-shoulder-left | 554 | 5,809 |
| soft-female-charcoal-suit-crossbody-left | 550 | 5,809 |
| soft-female-charcoal-suit-shoulder-left | 554 | 5,809 |
| soft-female-navy-suit-crossbody-left | 560 | 5,809 |
| soft-female-navy-suit-shoulder-left | 558 | 5,809 |
| soft-male-beige-blazer-crossbody-left | 550 | 5,809 |
| soft-male-beige-blazer-shoulder-left | 554 | 5,809 |
| soft-male-charcoal-suit-crossbody-left | 550 | 5,809 |
| soft-male-charcoal-suit-shoulder-left | 554 | 5,809 |
| soft-male-navy-suit-crossbody-left | 560 | 5,809 |
| soft-male-navy-suit-shoulder-left | 558 | 5,809 |
| soft-male-slate-suit-crossbody-left | 550 | 5,809 |
| soft-male-slate-suit-shoulder-left | 554 | 5,809 |
| soft-female-beige-blazer-crossbody-right | 552 | 5,808 |
| soft-female-beige-blazer-shoulder-right | 554 | 5,808 |
| soft-female-charcoal-suit-crossbody-right | 552 | 5,808 |
| soft-female-charcoal-suit-shoulder-right | 554 | 5,808 |
| soft-female-navy-suit-crossbody-right | 560 | 5,808 |
| soft-female-navy-suit-shoulder-right | 558 | 5,808 |
| soft-male-beige-blazer-crossbody-right | 552 | 5,808 |
| soft-male-beige-blazer-shoulder-right | 554 | 5,808 |
| soft-male-charcoal-suit-crossbody-right | 552 | 5,808 |
| soft-male-charcoal-suit-shoulder-right | 554 | 5,808 |
| soft-male-navy-suit-crossbody-right | 560 | 5,808 |
| soft-male-navy-suit-shoulder-right | 558 | 5,808 |
| soft-male-slate-suit-crossbody-right | 552 | 5,808 |
| soft-male-slate-suit-shoulder-right | 554 | 5,808 |
| soft-male-beach-crossbody-left | 546 | 5,805 |
| soft-male-beach-shoulder-left | 548 | 5,805 |
| soft-male-beach-crossbody-right | 548 | 5,804 |
| soft-male-beach-shoulder-right | 550 | 5,804 |
| soft-female-trail-handbag-right | 549 | 5,782 |
| soft-female-trail-purse-right | 560 | 5,782 |
| soft-female-trail-purse-left | 560 | 5,781 |
| soft-female-trail-handbag-left | 549 | 5,780 |
| soft-female-cream-navy-handbag-right | 556 | 5,737 |
| soft-female-cream-navy-purse-right | 555 | 5,737 |
| soft-female-olive-charcoal-handbag-right | 556 | 5,737 |
| soft-female-olive-charcoal-purse-right | 555 | 5,737 |
| soft-male-casual-shirt-handbag-right | 556 | 5,737 |
| soft-male-casual-shirt-purse-right | 555 | 5,737 |
| soft-male-cream-navy-handbag-right | 556 | 5,737 |
| soft-male-cream-navy-purse-right | 555 | 5,737 |
| soft-male-olive-charcoal-handbag-right | 556 | 5,737 |
| soft-male-olive-charcoal-purse-right | 555 | 5,737 |
| soft-female-cream-navy-purse-left | 554 | 5,736 |
| soft-female-olive-charcoal-purse-left | 554 | 5,736 |
| soft-male-casual-shirt-purse-left | 554 | 5,736 |
| soft-male-cream-navy-purse-left | 554 | 5,736 |
| soft-male-olive-charcoal-purse-left | 554 | 5,736 |
| soft-female-cream-navy-handbag-left | 553 | 5,735 |
| soft-female-olive-charcoal-handbag-left | 553 | 5,735 |
| soft-male-casual-shirt-handbag-left | 553 | 5,735 |
| soft-male-cream-navy-handbag-left | 553 | 5,735 |
| soft-male-olive-charcoal-handbag-left | 553 | 5,735 |
| soft-female-stripe-handbag-right | 549 | 5,729 |
| soft-female-stripe-purse-right | 544 | 5,729 |
| soft-male-stripe-handbag-right | 549 | 5,729 |
| soft-male-stripe-purse-right | 544 | 5,729 |
| soft-female-stripe-purse-left | 545 | 5,728 |
| soft-male-stripe-purse-left | 545 | 5,728 |
| soft-female-stripe-handbag-left | 550 | 5,727 |
| soft-male-stripe-handbag-left | 550 | 5,727 |
| soft-female-commuter-handbag-right | 551 | 5,722 |
| soft-female-commuter-purse-right | 548 | 5,722 |
| soft-male-commuter-handbag-right | 551 | 5,722 |
| soft-male-commuter-purse-right | 548 | 5,722 |
| soft-female-commuter-purse-left | 547 | 5,721 |
| soft-male-commuter-purse-left | 547 | 5,721 |
| soft-female-commuter-handbag-left | 550 | 5,720 |
| soft-male-commuter-handbag-left | 550 | 5,720 |
| soft-female-trail-crossbody-left | 545 | 5,681 |
| soft-female-trail-shoulder-left | 547 | 5,681 |
| soft-female-trail-crossbody-right | 545 | 5,680 |
| soft-female-trail-shoulder-right | 545 | 5,680 |
| soft-male-sport-shorts-handbag-right | 543 | 5,655 |
| soft-male-sport-shorts-purse-right | 546 | 5,655 |
| soft-male-sport-shorts-purse-left | 549 | 5,654 |
| soft-male-sport-shorts-handbag-left | 544 | 5,653 |
| soft-female-blue-cream-handbag-right | 540 | 5,649 |
| soft-female-blue-cream-purse-right | 543 | 5,649 |
| soft-female-burgundy-sand-handbag-right | 540 | 5,649 |
| soft-female-burgundy-sand-purse-right | 543 | 5,649 |
| soft-female-polo-shorts-handbag-right | 540 | 5,649 |
| soft-female-polo-shorts-purse-right | 543 | 5,649 |
| soft-male-blue-cream-handbag-right | 540 | 5,649 |
| soft-male-blue-cream-purse-right | 543 | 5,649 |
| soft-male-burgundy-sand-handbag-right | 540 | 5,649 |
| soft-male-burgundy-sand-purse-right | 543 | 5,649 |
| soft-male-polo-shorts-handbag-right | 540 | 5,649 |
| soft-male-polo-shorts-purse-right | 543 | 5,649 |
| soft-female-blue-cream-purse-left | 544 | 5,648 |
| soft-female-burgundy-sand-purse-left | 544 | 5,648 |
| soft-female-polo-shorts-purse-left | 544 | 5,648 |
| soft-male-blue-cream-purse-left | 544 | 5,648 |
| soft-male-burgundy-sand-purse-left | 544 | 5,648 |
| soft-male-polo-shorts-purse-left | 544 | 5,648 |
| soft-female-blue-cream-handbag-left | 541 | 5,647 |
| soft-female-burgundy-sand-handbag-left | 541 | 5,647 |
| soft-female-polo-shorts-handbag-left | 541 | 5,647 |
| soft-male-blue-cream-handbag-left | 541 | 5,647 |
| soft-male-burgundy-sand-handbag-left | 541 | 5,647 |
| soft-male-polo-shorts-handbag-left | 541 | 5,647 |
| soft-female-cream-navy-crossbody-left | 543 | 5,636 |
| soft-female-cream-navy-shoulder-left | 543 | 5,636 |
| soft-female-olive-charcoal-crossbody-left | 543 | 5,636 |
| soft-female-olive-charcoal-shoulder-left | 543 | 5,636 |
| soft-male-casual-shirt-crossbody-left | 543 | 5,636 |
| soft-male-casual-shirt-shoulder-left | 543 | 5,636 |
| soft-male-cream-navy-crossbody-left | 543 | 5,636 |
| soft-male-cream-navy-shoulder-left | 543 | 5,636 |
| soft-male-olive-charcoal-crossbody-left | 543 | 5,636 |
| soft-male-olive-charcoal-shoulder-left | 543 | 5,636 |
| soft-female-cream-navy-crossbody-right | 543 | 5,635 |
| soft-female-cream-navy-shoulder-right | 545 | 5,635 |
| soft-female-olive-charcoal-crossbody-right | 543 | 5,635 |
| soft-female-olive-charcoal-shoulder-right | 545 | 5,635 |
| soft-male-casual-shirt-crossbody-right | 543 | 5,635 |
| soft-male-casual-shirt-shoulder-right | 545 | 5,635 |
| soft-male-cream-navy-crossbody-right | 543 | 5,635 |
| soft-male-cream-navy-shoulder-right | 545 | 5,635 |
| soft-male-olive-charcoal-crossbody-right | 543 | 5,635 |
| soft-male-olive-charcoal-shoulder-right | 545 | 5,635 |
| soft-female-stripe-crossbody-left | 524 | 5,628 |
| soft-female-stripe-shoulder-left | 524 | 5,628 |
| soft-male-stripe-crossbody-left | 524 | 5,628 |
| soft-male-stripe-shoulder-left | 524 | 5,628 |
| soft-female-stripe-crossbody-right | 524 | 5,627 |
| soft-female-stripe-shoulder-right | 524 | 5,627 |
| soft-male-stripe-crossbody-right | 524 | 5,627 |
| soft-male-stripe-shoulder-right | 524 | 5,627 |
| soft-female-commuter-crossbody-left | 540 | 5,621 |
| soft-female-commuter-shoulder-left | 538 | 5,621 |
| soft-male-commuter-crossbody-left | 540 | 5,621 |
| soft-male-commuter-shoulder-left | 538 | 5,621 |
| soft-female-commuter-crossbody-right | 538 | 5,620 |
| soft-female-commuter-shoulder-right | 536 | 5,620 |
| soft-male-commuter-crossbody-right | 538 | 5,620 |
| soft-male-commuter-shoulder-right | 536 | 5,620 |
| soft-female-coral-navy-handbag-right | 539 | 5,619 |
| soft-female-coral-navy-purse-right | 548 | 5,619 |
| soft-female-navy-sand-handbag-right | 539 | 5,619 |
| soft-female-navy-sand-purse-right | 548 | 5,619 |
| soft-female-sage-stone-handbag-right | 539 | 5,619 |
| soft-female-sage-stone-purse-right | 548 | 5,619 |
| soft-female-tee-shorts-handbag-right | 539 | 5,619 |
| soft-female-tee-shorts-purse-right | 548 | 5,619 |
| soft-female-white-denim-handbag-right | 539 | 5,619 |
| soft-female-white-denim-purse-right | 548 | 5,619 |
| soft-male-black-khaki-handbag-right | 539 | 5,619 |
| soft-male-black-khaki-purse-right | 548 | 5,619 |
| soft-male-coral-navy-handbag-right | 539 | 5,619 |
| soft-male-coral-navy-purse-right | 548 | 5,619 |
| soft-male-navy-sand-handbag-right | 539 | 5,619 |
| soft-male-navy-sand-purse-right | 548 | 5,619 |
| soft-male-sage-stone-handbag-right | 539 | 5,619 |
| soft-male-sage-stone-purse-right | 548 | 5,619 |
| soft-male-tee-shorts-handbag-right | 539 | 5,619 |
| soft-male-tee-shorts-purse-right | 548 | 5,619 |
| soft-male-white-denim-handbag-right | 539 | 5,619 |
| soft-male-white-denim-purse-right | 548 | 5,619 |
| soft-female-coral-navy-purse-left | 549 | 5,618 |
| soft-female-navy-sand-purse-left | 549 | 5,618 |
| soft-female-sage-stone-purse-left | 549 | 5,618 |
| soft-female-tee-shorts-purse-left | 549 | 5,618 |
| soft-female-white-denim-purse-left | 549 | 5,618 |
| soft-male-black-khaki-purse-left | 549 | 5,618 |
| soft-male-coral-navy-purse-left | 549 | 5,618 |
| soft-male-navy-sand-purse-left | 549 | 5,618 |
| soft-male-sage-stone-purse-left | 549 | 5,618 |
| soft-male-tee-shorts-purse-left | 549 | 5,618 |
| soft-male-white-denim-purse-left | 549 | 5,618 |
| soft-female-coral-navy-handbag-left | 538 | 5,617 |
| soft-female-navy-sand-handbag-left | 538 | 5,617 |
| soft-female-sage-stone-handbag-left | 538 | 5,617 |
| soft-female-tee-shorts-handbag-left | 538 | 5,617 |
| soft-female-white-denim-handbag-left | 538 | 5,617 |
| soft-male-black-khaki-handbag-left | 538 | 5,617 |
| soft-male-coral-navy-handbag-left | 538 | 5,617 |
| soft-male-navy-sand-handbag-left | 538 | 5,617 |
| soft-male-sage-stone-handbag-left | 538 | 5,617 |
| soft-male-tee-shorts-handbag-left | 538 | 5,617 |
| soft-male-white-denim-handbag-left | 538 | 5,617 |
| soft-male-sport-shorts-crossbody-left | 536 | 5,554 |
| soft-male-sport-shorts-shoulder-left | 534 | 5,554 |
| soft-male-sport-shorts-crossbody-right | 534 | 5,553 |
| soft-male-sport-shorts-shoulder-right | 536 | 5,553 |
| soft-female-blue-cream-crossbody-left | 531 | 5,548 |
| soft-female-blue-cream-shoulder-left | 533 | 5,548 |
| soft-female-burgundy-sand-crossbody-left | 531 | 5,548 |
| soft-female-burgundy-sand-shoulder-left | 533 | 5,548 |
| soft-female-polo-shorts-crossbody-left | 531 | 5,548 |
| soft-female-polo-shorts-shoulder-left | 533 | 5,548 |
| soft-male-blue-cream-crossbody-left | 531 | 5,548 |
| soft-male-blue-cream-shoulder-left | 533 | 5,548 |
| soft-male-burgundy-sand-crossbody-left | 531 | 5,548 |
| soft-male-burgundy-sand-shoulder-left | 533 | 5,548 |
| soft-male-polo-shorts-crossbody-left | 531 | 5,548 |
| soft-male-polo-shorts-shoulder-left | 533 | 5,548 |
| soft-female-blue-cream-crossbody-right | 533 | 5,547 |
| soft-female-blue-cream-shoulder-right | 533 | 5,547 |
| soft-female-burgundy-sand-crossbody-right | 533 | 5,547 |
| soft-female-burgundy-sand-shoulder-right | 533 | 5,547 |
| soft-female-polo-shorts-crossbody-right | 533 | 5,547 |
| soft-female-polo-shorts-shoulder-right | 533 | 5,547 |
| soft-male-blue-cream-crossbody-right | 533 | 5,547 |
| soft-male-blue-cream-shoulder-right | 533 | 5,547 |
| soft-male-burgundy-sand-crossbody-right | 533 | 5,547 |
| soft-male-burgundy-sand-shoulder-right | 533 | 5,547 |
| soft-male-polo-shorts-crossbody-right | 533 | 5,547 |
| soft-male-polo-shorts-shoulder-right | 533 | 5,547 |
| soft-female-coral-navy-crossbody-left | 530 | 5,518 |
| soft-female-coral-navy-shoulder-left | 530 | 5,518 |
| soft-female-navy-sand-crossbody-left | 530 | 5,518 |
| soft-female-navy-sand-shoulder-left | 530 | 5,518 |
| soft-female-sage-stone-crossbody-left | 530 | 5,518 |
| soft-female-sage-stone-shoulder-left | 530 | 5,518 |
| soft-female-tee-shorts-crossbody-left | 530 | 5,518 |
| soft-female-tee-shorts-shoulder-left | 530 | 5,518 |
| soft-female-white-denim-crossbody-left | 530 | 5,518 |
| soft-female-white-denim-shoulder-left | 530 | 5,518 |
| soft-male-black-khaki-crossbody-left | 530 | 5,518 |
| soft-male-black-khaki-shoulder-left | 530 | 5,518 |
| soft-male-coral-navy-crossbody-left | 530 | 5,518 |
| soft-male-coral-navy-shoulder-left | 530 | 5,518 |
| soft-male-navy-sand-crossbody-left | 530 | 5,518 |
| soft-male-navy-sand-shoulder-left | 530 | 5,518 |
| soft-male-sage-stone-crossbody-left | 530 | 5,518 |
| soft-male-sage-stone-shoulder-left | 530 | 5,518 |
| soft-male-tee-shorts-crossbody-left | 530 | 5,518 |
| soft-male-tee-shorts-shoulder-left | 530 | 5,518 |
| soft-male-white-denim-crossbody-left | 530 | 5,518 |
| soft-male-white-denim-shoulder-left | 530 | 5,518 |
| soft-female-coral-navy-crossbody-right | 528 | 5,517 |
| soft-female-coral-navy-shoulder-right | 528 | 5,517 |
| soft-female-navy-sand-crossbody-right | 528 | 5,517 |
| soft-female-navy-sand-shoulder-right | 528 | 5,517 |
| soft-female-sage-stone-crossbody-right | 528 | 5,517 |
| soft-female-sage-stone-shoulder-right | 528 | 5,517 |
| soft-female-tee-shorts-crossbody-right | 528 | 5,517 |
| soft-female-tee-shorts-shoulder-right | 528 | 5,517 |
| soft-female-white-denim-crossbody-right | 528 | 5,517 |
| soft-female-white-denim-shoulder-right | 528 | 5,517 |
| soft-male-black-khaki-crossbody-right | 528 | 5,517 |
| soft-male-black-khaki-shoulder-right | 528 | 5,517 |
| soft-male-coral-navy-crossbody-right | 528 | 5,517 |
| soft-male-coral-navy-shoulder-right | 528 | 5,517 |
| soft-male-navy-sand-crossbody-right | 528 | 5,517 |
| soft-male-navy-sand-shoulder-right | 528 | 5,517 |
| soft-male-sage-stone-crossbody-right | 528 | 5,517 |
| soft-male-sage-stone-shoulder-right | 528 | 5,517 |
| soft-male-tee-shorts-crossbody-right | 528 | 5,517 |
| soft-male-tee-shorts-shoulder-right | 528 | 5,517 |
| soft-male-white-denim-crossbody-right | 528 | 5,517 |
| soft-male-white-denim-shoulder-right | 528 | 5,517 |
| soft-female-blue-navy-skirt-none | 523 | 5,422 |
| soft-female-tee-skirt-none | 523 | 5,422 |
| soft-female-blouse-skirt-none | 512 | 5,337 |
| soft-female-rose-slate-skirt-none | 512 | 5,337 |
| soft-female-beige-blazer-none | 430 | 4,470 |
| soft-female-charcoal-suit-none | 430 | 4,470 |
| soft-female-navy-suit-none | 426 | 4,470 |
| soft-male-beige-blazer-none | 430 | 4,470 |
| soft-male-charcoal-suit-none | 430 | 4,470 |
| soft-male-navy-suit-none | 426 | 4,470 |
| soft-male-slate-suit-none | 430 | 4,470 |
| soft-male-beach-none | 424 | 4,466 |
| soft-female-trail-none | 415 | 4,342 |
| soft-female-cream-navy-none | 413 | 4,297 |
| soft-female-olive-charcoal-none | 413 | 4,297 |
| soft-male-casual-shirt-none | 413 | 4,297 |
| soft-male-cream-navy-none | 413 | 4,297 |
| soft-male-olive-charcoal-none | 413 | 4,297 |
| soft-female-stripe-none | 408 | 4,289 |
| soft-male-stripe-none | 408 | 4,289 |
| soft-female-commuter-none | 410 | 4,282 |
| soft-male-commuter-none | 410 | 4,282 |
| soft-male-sport-shorts-none | 402 | 4,215 |
| soft-female-blue-cream-none | 399 | 4,209 |
| soft-female-burgundy-sand-none | 399 | 4,209 |
| soft-female-polo-shorts-none | 399 | 4,209 |
| soft-male-blue-cream-none | 399 | 4,209 |
| soft-male-burgundy-sand-none | 399 | 4,209 |
| soft-male-polo-shorts-none | 399 | 4,209 |
| soft-female-coral-navy-none | 400 | 4,179 |
| soft-female-navy-sand-none | 400 | 4,179 |
| soft-female-sage-stone-none | 400 | 4,179 |
| soft-female-tee-shorts-none | 400 | 4,179 |
| soft-female-white-denim-none | 400 | 4,179 |
| soft-male-black-khaki-none | 400 | 4,179 |
| soft-male-coral-navy-none | 400 | 4,179 |
| soft-male-navy-sand-none | 400 | 4,179 |
| soft-male-sage-stone-none | 400 | 4,179 |
| soft-male-tee-shorts-none | 400 | 4,179 |
| soft-male-white-denim-none | 400 | 4,179 |

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

Passenger atlas draw strides are 8,101 High / 791 Low triangles per instance;
individual variants can be smaller. Both LODs share animation data. Rendered
passenger dimensions use the train's 0.98 uniform scale, including shadows,
picking, stride phase and eye height; simulation physique/speed and the atlas
topology are unchanged. A single-storey crowd uses one draw; a visible ghosted
storey can add a second. Passengers are opaque and depth-writing at both LODs; road vehicles retain
70% High / 45% Low opacity.

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

  The supplied Tianhe Park save (`天河公园.metro (1).json`) reproduces a concave
  packing case with four bands at −20/−15/−10/−5 m. Comparing the original
  `explodedView` from `e0c4c02` with the revised transform on the same input in Node
  v24.15.0 (six sequential calls per version, no competing build/test/browser)
  changes the direction from `[0,1]` to `[1,1]` and offsets from
  `[0,0,22,235]` to `[0,0,22,87]`. The retained-cell projected bounding area
  (`sx=1.2x+y`, `sy=−x+1.2y`, including a one-tile extent) falls from 513,240
  to 327,092, about 36%. This is a plan-space proxy for the default isometric
  view, not a measurement of pixels or packing optimality for arbitrary camera
  angles. Clear headroom beneath an overhead slab seeds the unlabelled transfer
  room, following its connected floor through ceiling openings: −15 m retains
  386 cells instead of 75, without retaining the adjoining tunnel roof.
  First pure-transform calls measured 321.9/248.2 ms before/after; warmed
  five-call medians were 292.4/198.8 ms. These exclude GPU/model preparation
  and modal opening. Raw comparison and reproduction script are under
  `.preview/perf/exploded-view/{packing-report.json,measure-packing.mjs}`.
  The deterministic L-plan test keeps all four floors, zero tile overlap and
  direction-aware poses; the transfer-room fixture preserves ceiling openings
  while rejecting a separate exposed roof. `BENCH_STATION=<save>` now runs the
  production exploded-view lifecycle check against an external save.
  Input SHA-256 is
  `cc27de658669dc1b98ca4738b989c826de6746f8d87511d066a768179b457ae6`.
  The rebuilt supplied-save browser check at 1384 × 702 canvas passed all four
  level labels, document/version/history isolation, playback, WASD, orbit/pan,
  Escape and reopening with no runtime errors. First/repeated opening measured
  12,468.8/12,447.6 ms; these are current diagnostics with no matched old-build
  browser baseline. Its screenshot/report are `station.png` and `report.json`
  in the same directory. Zoo's lifecycle check passed; Tanwei's camera-drag
  input check timed out, so the complete two-demo browser check is incomplete.

  Tianhe Park `天河公园.metro (2).json` exercises solid infill incorrectly cut
  away as a tunnel roof, ceiling course and front enclosure. Its 115,924 cells /
  2,272 modules include a completely solid `(140,-100)` column from −15 through
  −6 m; the former transform retained only −10 through −7 m. Preserving thick
  infill retains all ten courses and increases presentation cells from 58,806
  to 94,575. Reserving those concrete footprints changes diagonal offsets from
  `[0,0,22,68]` to `[0,34,70,135]`, keeping the extra sections separate.
  On Windows / Node v24.15.0 / i7-14700KF, seven alternating sequential calls
  per version with GC between calls measured first calls of 456.2 / 589.9 ms
  and six-call warm medians of 319.7 / 479.2 ms before / after. This is a
  correctness cost, not a speedup; it excludes renderer preparation. No build,
  test or profiler from this task competed with either timing capture.
  Hardware Chrome 156 / RTX 4080 SUPER at 1384 × 702 passed the supplied-save
  lifecycle check on both versions, including unchanged document/history,
  playback, controls and reopening with zero runtime errors. Single first /
  repeated opening samples were 14,320 / 20,109 ms before and 19,025 / 21,447 ms
  after; these are noisy diagnostics, not a statistically established latency
  regression bound. A separate 2184 × 1002 hardware close-up comparison installs
  the old/new presentation snapshots in the same current renderer, confirming
  continuous concrete with real shaft openings; its cameras reframe each layout,
  so it is a geometry review rather than a pixel or timing comparison.
  Reports, exact source baseline, reproduction scripts and screenshots live in
  `.preview/perf/exploded-infill/`; reproduce the transform with
  `node --expose-gc .preview/perf/exploded-infill/measure.mjs <save.json>`.
  Input SHA-256 is
  `acd001d9a4a837750512c2cbf6bd2705eda49507afc78b7481cf0da10375603c`.
  Deterministic ordinary/shifted-baseline infill, shaft-hole and packing checks
  live in `exploded-support`, alongside the Tanwei thin-roof-ring exclusion.
  The current Zoo and Tanwei lifecycle checks also complete with zero runtime
  errors; their functional report is `browser-demos.json` in the same directory.

  The filled Tianhe copy also exercises per-storey stair/escalator display
  sections. A production hardware Chrome capture at 2184 × 1002 opens in
  20,368 ms and creates 77 extra sections / 3,321 paired scene nodes. Geometry
  and rolling-step instance buffers are shared with the original models, while
  each section owns its clipping materials and extra instanced-mesh allocation.
  Ramp sources bypass equipment aggregation so the uncut model cannot leak
  through the clipped copies. This increases draw/preparation work; the single
  opening sample has no matched baseline and establishes no performance bound.
  The capture checks unchanged station/version/history and zero runtime errors,
  then photographs the sliced and unsliced representations with the same camera.
  Script, report and screenshots are `sections-browser.mjs`,
  `sections-browser.json` and `sections-{before,after}.png` under
  `.preview/perf/exploded-infill/`. `exploded-ramps` pins clip extents, offsets,
  instance-buffer sharing, visibility after batching, clip restoration and teardown.
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

Matched first-Play captures were rerun from baseline commit `128cb6d`
(before train preparation in `53aa944`) and current commit `1950b68`, using the same
`configureBenchmarkView` setup in separate fresh browser sessions. Runs use a 20 s
window, speed 16x, Low graphics, zero initial population and seed 7654321 on Chrome
155 / ANGLE D3D11, i7-14700KF and RTX 4080 SUPER. Tanwei has 16,869 cells / 9,694
modules; the 1400 x 900 browser has an 852 x 715 editor canvas or 1384 x 702 exploded
canvas. Regular view is Hide UI at -10 m, default isometric direction and 2/3 camera
distance; exploded view uses its standalone camera. No tests or builds competed with
the timed captures.

| Tanwei view | Average FPS, original → current | 1% low FPS, original → current | Worst submitted-frame gap, original → current |
|---|---:|---:|---:|
| Regular | 18.64 → 29.01 | 0.95 → 3.17 | 1,079 → 396 ms |
| Exploded | 21.04 → 47.98 | 0.61 → 4.16 | 2,102 → 382 ms |

These are single runs, not stable percentiles or GPU presentation measurements.
Regular runs finish at ticks 308/311 with 1,063/1,061 passengers; exploded runs
finish at ticks 316/317 with 1,057/1,054 passengers. All four captures report zero
runtime/GL errors. The raw samples are
`tanwei-{regular,explode}-low-preset-{original,current}.json` under
`.preview/perf/sim-stalls/`. The 1% low remains the mean of the slowest 1% of
submitted-frame intervals, and the worst gap remains sensitive to arrival timing.

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

#### Live TV atlas uploads and 1% lows

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

### Three remaining actions toward 100 ms — 2026-10-26

Matched production API-to-first-render recheck: complete Zoo and Tanwei demos,
High quality, paused staging camera, 892 × 815 canvas at ratio 1, Chrome 156,
i7-14700KF / RTX 4080 SUPER through ANGLE D3D11. Run
`BENCH_CASE=walkway/length=long,guidepost,block/auto-walls`, `BENCH_SAMPLES=5`
with `node tools/bench-editor-actions.mjs --record-only`; set a unique
`BENCH_ACTION_OUTPUT` for each capture. Baseline and recheck use identical fixtures,
case order and sample count, without concurrent tests or profiles.

| Demo / action | Baseline first / median / max | Recheck first / median / max | Recheck <100 ms |
| --- | --- | --- | ---: |
| Tanwei long walkway drop | 293.2 / 284.0 / 310.0 ms | 97.0 / 84.5 / 97.0 ms | 5/5 |
| Zoo guidepost drop | 185.3 / 271.2 / 320.8 ms | 65.4 / 39.3 / 65.4 ms | 5/5 |
| Zoo auto-wall block placement | 379.5 / 61.0 / 379.5 ms | 54.9 / 54.9 / 59.8 ms | 5/5 |

Raw reports: `.preview/perf/target-three-100-{before,bounds}/report.json`.
Baseline source/build SHA-256 are
`b63047800650b01abde1b061e2e4d62f2e9c06598735b885403cf2ade98c1765` /
`86e0634203bba21d074211f2613908a49c6574eca1fe89ba9a4c5aab1fb6dd54`.
Recheck source/build are
`4719d7c09d009d0741c77642953719b654bc7d03f21fa0b0e84484f1661a386d` /
`8b746a9dd86292b0642d4f9bea4456eedaaaf72990806cbb20c87611a303f3f6`.
At this capture the full inventory and JSONL retained their original results. This six-case subset
contains 180 rows: 137 below budget, 13 over budget, 30 unsupported. Remaining
over-budget rows belong to other stages, including walkway placement/deletion
and Tanwei guidepost move preview. No functional/runtime/WebGL errors occurred.
Five repetitions do not establish p95, pointer-to-compositor latency or GPU completion.

The improvements remove repeated work rather than lower quality: guideposts
retain artwork and local geometry; rigid flat walkways retain their model and band
phase when endpoint heights/support/configuration agree. Exclusively owned draw
buckets translate without rebuilding GPU buffers; shared buckets fall back.
Dormant views and source discovery invalidate after translation. Selection/grid
materials survive for the scene lifetime, including warming selection's onscreen
shader during opening. Track-bed and structural opening inputs reuse immutable
records. Floor gestures reconcile only their edited wall-height ranges, including
overlapping owners: unrelated imported auto-wall records survive (the first Zoo
gesture previously removed 147 remote records). Explicit full reconciliation
remains available; this is an intentional change to gesture scope.

Chunk edits classify affected storeys per column; the two-cell classification
halo probes at most four chunk coordinates instead of 25 cell offsets. Immutable
authored-cell membership and station bounds are reused across derived consumers;
returned bounds remain caller-owned, with margins applied outside the cache.
A non-carving street resize
updates only edge strips and preserves unrelated meshes/materials. A 64-entry
plain-ground template cache requires exact shape and halo proof; authored terrain,
holes and support fall back. Generated pavement caches four windows per immutable
cell/structural-module input, returning fresh arrays with immutable shared records.
A valid walkway move preview may prepare its prospective ground tail without
editing the document/history or live indexes; confirmation revalidates inputs.
All five Tanwei walkway move previews also pass in the recheck. Renderer mount,
document installation and carried-module state use ordered layout effects to
avoid an extra passive-effect paint gap. Original picking geometry remains intact.

Intermediate reports are retained: nineteenth first Tanwei drop 103.5 ms;
twentieth 97.4 ms, followed by verification misses of 109.1/104.4 ms;
corners 103.4 ms, belts 100.3 ms and anchor 102.3 ms. The halo capture overlapped
a focused test and is diagnostic only. Final bounds reuse reduces the first drop
to 97.0 ms. Flat belts skip dependency readers they cannot affect while fences,
exit openings and linked owners still invalidate. Proven translation-only edits
check changed roots' ground bands, retaining other anchors within the unchanged
authored ground and content margin. Separate CPU profiles are diagnostic,
not timing evidence. Early custom software-GPU probes must not be interpreted as
hardware latency results.

Validation: production build and all 2,523 game tests pass; the independent
ground/layering recheck passes 19 tests. Deterministic regressions cover fresh mesh
equivalence, duplicate records, shrinking/fractional windows, ownership/disposal,
work counts, artwork invalidation, animation phase, batch fallback and view reuse.
`tools/check-editor-move-caches.mjs` checks actual production drop/undo/redo against
forced fresh aggregation: guidepost differences 4/0/4 pixels and walkway 0/10/0,
with a 128-pixel tolerance for RGB differences above 1. Both retain root/artwork
identity and exercise direct translation at every phase; no runtime/WebGL errors.
Report: `.preview/perf/target-three-validated-move-gpu/report.json` (functional, untimed).
Batching check: station draws 3,786 → 1,105, closed/open train draws 779 → 29,
triangles preserved, native multi-draw and no shader/runtime/WebGL errors.
Profiling-tool CPU export and trace-stream checks also pass.
Bilingual tutorial browser checks pass all 18 steps, live controls, persistence,
completion/skip/opt-out and explicit demo loading after the layout-effect change.

### Refreshed complete editor-action inventory — 2026-10-27 UTC

The complete ordered Zoo and Tanwei inventory was rerun with one sample per
case using the same High-quality hardware API-to-first-render protocol as the
prior full inventory. The 809 cases produced 4,854 rows: 3,599 timings below
100 ms, 812 over budget, 441 unsupported actions and two PSD-cover drop
refusals. Maximum completed feedback was 262.8 ms. The previous full inventory
had 3,534 below 100 ms and a 421.4 ms maximum. One sample is not a tail
distribution, and these timings do not include pointer dispatch, compositor
presentation or completed GPU work.

The source/build SHA-256 were
`4719d7c09d009d0741c77642953719b654bc7d03f21fa0b0e84484f1661a386d` /
`8b746a9dd86292b0642d4f9bea4456eedaaaf72990806cbb20c87611a303f3f6`.
The complete report and frozen inputs are under
`.preview/perf/editor-actions-current/`. The [latest matrix](editor-action-matrix.md)
is regenerated after completed hardware captures and may also contain newer
focused measurements; each row identifies its capture and sample count. The
original full JSONL remains available in repository history; the existing JSONL
now holds the latest per-action index.
The automatic-update integration check then reran the three previously targeted
cases on both demos with five samples (`.preview/perf/editor-matrix-auto-check/`).
All five requested Tanwei walkway drops and Zoo guidepost drops/auto-wall placements
were below 100 ms, with respective maxima of 79.7, 81.1 and 48.3 ms. Three Tanwei
guidepost move-preview samples exceeded the budget. At that point the focused run
replaced only its 36 demo/case/action rows; the remaining rows identified the
complete one-sample capture. Subsequent runs supersede those rows in the matrix.
The follow-up timestamp-aware integration run
(`.preview/perf/editor-matrix-auto-timestamps/`) again exercised five samples
of those six demo/case combinations. The requested Tanwei walkway drop, Zoo
guidepost drop and Zoo auto-wall placement maxima were 88.1, 55.3 and 52.5 ms;
other stages included 11 samples over budget. After merging, the latest index
contains 818 actions above 100 ms, 3,593 at or below 100 ms and 443 unsupported
or incomplete actions. Per-action capture timestamps prevent older resumed
checkpoints from superseding newer measurements.

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

### Exact ramp terrain cuts — 2026-10-25

`node tools/check-ramp-fit.mjs` runs the production build in HeadlessChrome
156 on Windows, with an 852 × 715 render canvas. The fixture has a three-lane
escalator and three-lane straight stair over 339 solid blocks (75 derived slope
cells). It alternates deleting/restoring the stair through the production store,
then waits two RAFs for feedback. The isolated run recorded synchronous commit
costs of 0.3–0.5 ms and feedback times of 196.0 / 74.4 / 102.7 / 109.2 / 94.5 /
89.6 ms (delete/restore, alternating). Cold deletion and two later actions exceed
100 ms. These are diagnostic API-to-frame timings, not a real-pointer placement
budget pass; there is no matched pre-change timing, GPU-completion guarantee or
large-demo throughput claim. Pointer picking is unchanged. Raw fixture, browser
metadata, hashes and the contact screenshot are under `.preview/ramp-fit/`.
Fixture SHA-256: `b78f73aa6913391ff4b8a3a5f9ca098a2169ac6222b12790e941a337bd1face3`;
build index SHA-256: `d125d3f2626e47f6ab46a76193b51ebe79a07dac765ba42aa52f9f5a873ab8f7`.

Cut generation is derived during station geometry preparation, never a document
mutation or a new per-pointer scene pick. The uncut mesher retains its ordinary
profile path. `ramp-surface` pins actual model/terrain contact, planar cap
triangles, partial/crossing footprints, adjacent wall exposure and footprint-only
invalidation across a chunk seam. The complete suite passed 2475 tests; the
additional seam regression passed in its six-test focused suite.

### Local edit storey-group retention — 2026-10-25

A local delete/fill retained remote chunks in an existing storey group, then
replaced that storey's map entry with a new group for rebuilt chunks. The former
group remained attached to the scene and stopped receiving visibility updates.
Its last state explains both the -5 m floor missing at -5 m and remaining visible
at -15 m. `floor-geometry` reproduces the group ownership failure on the original
implementation and passes after reusing the retained group. It covers edits from
both initial levels, repeated switches, no orphan scene meshes and unchanged
remote GPU mesh identity. Roof tags and cell occupancy are unchanged.

Production browser check `node tools/check-level-retention.mjs` uses two separated
2 × 2 floor patches at -15/-5 m, then deletes/fills one cell while retaining the
remote -5 m floor. HeadlessChrome 156 on Windows, 852 × 715 canvas: all four
commits retained 27 tracked/drawn chunk meshes, zero group ownership errors and
zero orphan meshes. Sixteen -15/-5 m switches gave the expected floor visibility.
Synchronous commits were 0.1–0.3 ms; two-RAF feedback was 64.3 / 52.1 / 45.0 /
38.4 ms. These are diagnostic API-to-frame timings on a small fixture, without a
GPU-completion or real-pointer latency claim. Picking and previews are unchanged.
Raw script, fixture and browser results are under `.preview/level-retention/`.
Fixture SHA-256: `5b29adc8b73dfa1b414f6d6a711dd7f4cde77043f6ae0ee64ceeeee37f2f12ee`;
build index SHA-256: `a22b8bcac6d60289059079ac21aa74b89d5d67103992f7f7937f39b07db16f77`.

### Tianhe underside block placement — 2026-10-25

The reported save `天河公园.metro (10).json` (SHA-256
`60baa1aabe0f040400a3caea588f3460c72e8ed8ad1a9868d6e85f155d3955a7`)
refused `(77,-100,-16)` as an opening despite its stair underside retaining a
wedge with local heights 0.73090909 / 0.04909091 m. `rampList` now prepares
per-run retained cell keys from the exact underside patches once per immutable
module array. Direct/indexed block checks, preview, release and carving share
that allowance; retained core wedges bypass side-panel thinning. A cut from
another run cannot excuse blocking a passenger passage. Pointer picking is unchanged.

Reproduce with `node tools/check-ramp-block-placement.mjs <save.json>` after a
production build. A real pointer placed the target block in the imported save;
the source save was untouched. On HeadlessChrome 156 / Windows / SwiftShader,
852 × 715 canvas, the recorded move/down/up sequence used three scene
intersections total. Handler times were 0.2 / 4.0 / 66.3 ms; submitted-render
feedback was 470.7 / 11.9 / 73.4 ms. Move picking is queued, so its scene ray
occurs after the synchronous handler. The complete protocol-driven sequence was
1312.3 ms. The cold hover exceeds the 100 ms budget; these single-run values
were collected with concurrent test/benchmark activity, have no matched baseline
and establish neither an overall latency improvement nor GPU completion.
Raw metadata and a placement screenshot are under `.preview/ramp-block-placement/`.

`ramp-block-placement.test.mjs` keeps the minimal reported run and guards
preview-cache reuse, direct/indexed agreement, post-placement survival, every
stair/escalator rotation and direction, zero-volume and overlapping-run refusals.
Existing carve tests now distinguish retained wedges from fully removed passage
cells. Full suite: 2485 passed; typecheck and production build passed.

### Tianhe door under stair — 2026-10-27

In `天河公园.metro (29).json` (SHA-256
`d5ade5520833f649c2b08b9958fcbcfe6749bc2c83944ab3ae4d29e4455499817`),
the steel door at `(-10,-73,-10)` meets the stair clearance at -7.01 m.
Floating-point rounding introduced approximately 1e-15 m of apparent overlap.
Ramp collision comparisons now tolerate 1e-9 m at contact, including either
placement order; the regression also refuses a 1 cm overlap. Other equipment
collision comparisons retain their existing strict rule. Pointer picking,
previews and document commits are unchanged.

A direct Node validation on the unmodified save (38,578 cells, 430 modules)
accepted the door. One cold `equipmentReason` call took 6.90 ms and ten warm
calls took 0.05–0.15 ms on this machine. These are diagnostic CPU timings,
not a matched baseline or a pointer-to-render measurement. The focused placement
regressions and production build passed. The full suite reported 2,535 passes
and two failures in local-cell-edit ramp model inputs and the existing modified
toilet cubicle Low-geometry budget; neither is a door collision test.
