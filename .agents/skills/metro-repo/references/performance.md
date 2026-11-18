# Performance reference

This is the current measured state and engineering contract, not a run diary.
Replace superseded values in place. Keep raw reports with source hashes and
hardware metadata outside this document. Do not describe unmatched workloads as
a speedup, or an older measurement as validation of newer code.
Record findings only when they answer a performance question or change a budget
or benchmark procedure. Functional fixes, test coverage and incidental durations
belong in their owning code, tests or reports, not in this reference.

## Reproduce the reported interaction

Measure from the first real input through visible feedback, including cold work.
Keep preview work separate from document commits. Preserve accepted/refused
outcomes.

## Current performance state

### Unity migration TypeScript simulation baseline

At source `4c0fb66e071e2aee25cd3fc055a010871942004b`, three serial
`npm run bench:sim` captures on Windows 11, Node 24.15.0 and i7-14700KF used
the shipped fixtures, seed 7654321, 600 measured ticks per phase and 12 edits.
For Tianhe's morning-peak tick, median values were 172.5, 170.9 and 176.3 ms;
p95 values were 337.2, 338.1 and 351.8 ms. The full raw reports for all three
stations are under `.preview/unity/baseline/sim-run-{1,2,3}-*.json`. Existing
development services were running during capture, so these are shared-machine
reference measurements, not an isolated hardware comparison. Match fixture,
settings and load when comparing a later implementation.

Three separate `npm run bench:browser` captures used headless Chrome 156,
RTX 4080 SUPER / ANGLE D3D11, 1384 × 805 viewport and DPR 1. In Tianhe's
`blockEdits` phase, the eight edit-to-frame samples per run had medians of
1469, 1534 and 1872 ms. This is the harness's API-to-frame boundary, not
physical display latency. Raw reports are `.preview/unity/baseline/browser-run-*`;
the same shared-machine limitation applies.

The serial three-sample editor-action matrix at the same source completed all
1,359 demo/case combinations: 18,167 action samples passed, 4,180 exceeded the
strict 100 ms target, nine reported errors and 2,106 were unsupported. The
command exited nonzero. Its checkpointed report is
`.preview/unity/baseline/editor-actions/report.json`; it was not published to
the shared matrix because the workstation was not isolated. The separate
real-pointer placement probe initially failed before timing because its pinned
camera/level and press-time commit assumptions were stale. The harness now
restores the original Z 0 and pre-closer camera, selects the same five pinned
cells even when an extra cell is visible, and checks the current release commit.
Three unprofiled shared-machine captures at the reference source gave maximum
press-to-first-render / release-to-first-render times of 25.2/101.7,
26.7/94.4 and 27.1/88.8 ms for Zoo, and 31.8/62.0, 17.7/59.0 and
17.8/57.5 ms for Tanwei. Zoo's first release misses the strict <100 ms target.
The harness waits two RAFs between synthetic press and release, so these are
separate boundaries, not a combined physical gesture latency. Raw captures are
`.preview/unity/baseline/placement-final-{1,2,3}.json`; the refactored target
selector was separately exercised in `placement-helper-check.json`.

Three additional cold/warm runs per station on the same shared workstation
measured navigation through a real canvas click and two subsequent RAFs, while
paused. Cold times were 13.1–14.5 s for Zoo, 18.0–18.9 s for Tanwei and
28.0–31.2 s for Tianhe. These include fixture loading and are not physical
presentation or proof that the click changed the document. The local static
server sent uncompressed resources. Separate three-run cold/warm captures used
a local gzip-level-6 server: encoded resource bodies were 52,671,229 bytes on
cold loads and 52,663,008 bytes on warm loads. These are not production
Cloudflare compression measurements. The per-run table and raw observations
are in `.preview/unity/baseline/baseline-results.json`, `interaction-results.json`
and `gzip-results.json`. Reproduce the startup/click workload after building the
reference game with `node tools/unity-baseline/startup.mjs`; add `--gzip` for
the local gzip transfer capture. Each command writes a fresh output directory.

### Unity Editor live-test workflow

At dirty source `6409535b6ea9aabacc72d6a0744a4eb1f9bade2f` on Windows 11,
Intel i7-14700KF / RTX 4080 SUPER, Unity `6000.6.8f1`, Unity CLI
`1.0.0-beta.17` and `com.unity.pipeline@1.0.0`, the live-Editor loop was measured
from a saved C# change to a filtered test verdict and a fresh Zoo Game view. One
comment appended to `StationSimulationSession.cs` was followed by three serial
runs of `unity/scripts/metro-editor.ps1 verify -TestFilter StationClockTests -Demo zoo`.
Wall times were 56.1, 56.5 and 56.6 s; `run.json` durations were 55.3, 55.6 and
55.9 s. Each run spent 10.9–11.5 s compiling/reloading, 7.5 s running 12 EditMode
tests, and 36.3–36.6 s in the smoke. The smoke total is dominated by a
25.8–26.0 s Editor-readiness wait after the test runner; the station load and the
two fixed-tick/capture runs themselves were 3.5 + 3.4 s.

After the measurement comment was removed, one warm no-change `verify` completed
in 22.3 s (compile 5.7 s, test 4.5 s, smoke 11.7 s), so the 26 s post-test wait
is intermittent rather than a fixed cost. The fixture rerun in an
already-playing Editor is the relevant interactive number: three serial
`smoke -Demo zoo -NoRepeat` runs took 8.5–8.6 s each,
including 2.65–2.69 s readiness, 3.27–3.36 s load/fixed ticks/capture/restore,
and the rest wrapper and Console work. All three produced state hash
`186d0638f8b28c5bff346a926a64faed9ba1e916774c54577637696065b409b8` and a
1280 × 720 PNG. The first capture after a fresh Play Mode entry can differ from
the next run's screenshot because the view is still settling (about 221 KB
versus 188 KB in these captures); the state hash is identical. Raw reports are
under `.preview/unity/editor/`.

The WebGL comparison is pending. A C# change invalidates the cached player, so
`npm start unity` must include a full Unity build plus browser startup; do not
compare a warm WebGL cache against the editor measurement. Keep domain reload at
its default until that matched capture exists. This measurement does not
establish that disabling reload improves the loop.

### Tianhe Park demo-video cadence

This measures the encoded walkthroughs, not editor or simulation performance.
The 2560 × 1440, 30 fps footage uses the High-quality game renderer on an
RTX 4080 SUPER with ANGLE D3D11. The two 1× simulation captures yielded
221 compositor frames in 15.94 s on the platform and 152 in 16.26 s in the
concourse. Capture alone therefore does not provide 30 distinct frames per
second after a 4× speed-up.

Record `05-tianhe-flythrough,05-tianhe-concourse` with
`node tools/demo-video.mjs --scene 05-tianhe-flythrough,05-tianhe-concourse --output .preview/demo-video/tianhe-cadence`.
Compare `take.json` recording timestamps and run
`ffmpeg -v error -i raw.mp4 -vf scale=640:360,mpdecimate -an -f framemd5 -`
in each take directory. The prior 4× live captures retained 66 of 120
platform frames and 45 of 123 concourse frames after this duplicate test.
The retimed, motion-interpolated exports retained 120 of 120 and 123 of 123.
These counts measure delivered cadence, including synthesized frames, and do
not establish an improvement in native game frame rate. The take reports are
under `.preview/demo-video/zh-studio-2k-refined` and
`.preview/demo-video/zh-studio-2k-retake`.

`09-demand` is a static-camera chart adjustment, so it cannot use the
fly-through speed ramp. The prior 1× take recorded 27 compositor frames in
2.90 s (median 83 ms, maximum 400 ms); its 90-frame delivery retained only 27
distinct frames at full resolution and 24 in the 640 × 360 duplicate test.
The current source capture records the three-second edit at 1× for 11.88 s
(227 frames, median 50 ms, maximum 117 ms), then retimes it 4×. The delivered
2.2-second demand cut uses its first 66 frames: 66 of 66 are distinct at full
resolution and in the coarser duplicate test. The 117 ms capture interval
becomes 29 ms after retiming, so a capture hitch no longer holds a delivered
frame. The dragged knob is a preview only: station
demand stayed `[1, 0.35]` while the visible morning peak moved to 2.07, so the
crowd is not rebuilt mid-drag. This is capture and delivery cadence, not a
change in simulation or renderer frame rate; the report is
`.preview/demo-video/zh-studio-2k-polish/takes/09-demand`.

### Response budget and placement state

Editor feedback targets strictly <100 ms; exactly 100 ms misses. Renderer
submission, two-RAF response, GPU completion and physical display are different
boundaries. Measure worker installation separately. Large synchronous commits,
cold renderer preparation and structural worker rebuilds remain costs to measure.

The complete current action records live in
[editor-action-matrix.md](editor-action-matrix.md) and
[editor-action-matrix.jsonl](editor-action-matrix.jsonl). Do not duplicate
case tables here. Keep failures, refusals and unsupported actions separate.

### City style selection

City-switch production capture: source `792ea8f73aafba37c8803a9b7b2f97118355551660b3cbfb40ccaa9c2aa7126d`, raw report at
`.preview/city-styles/tianhe-current/report.json`. i7-14700KF / RTX 4080 SUPER, ANGLE D3D11,
High quality, paused normal opening view, 1440 × 1000 window, 892 × 815 canvas,
pixel ratio 1. This High-quality capture uses full-detail models, so it does not
validate the Low-only inventories below.

The checker uses DOM `.click()` on popover tiles and ends at first render
submission. It does not measure actual pointer latency or GPU/display completion.
One observation per transition, starting each demo in Guangzhou, with no concurrent
builds, tests or profiles. No percentile or controlled speedup is claimed.

| Demo | First Shenzhen | Return Guangzhou | Repeat Shenzhen |
| --- | --- | --- | --- |
| zoo | 531.8 ms | 125.1 ms | 198.6 ms |
| tanwei | 752.8 ms | 267.0 ms | 670.1 ms |
| tianhe | 1424.1 ms | 1090.4 ms | 927.8 ms |

All nine observations miss the strict <100 ms target. All three demos perform
zero chunk remeshes/raycasts and send only population patches. Costs remain
unprofiled.

City poster images decode on demand per selected city and share pending requests;
Beijing's 6564 × 6537 source is kept whole and is not decoded when opening another
city.

Chongqing production observation: source
`c0e862b5f777e8971a65d6d90899ab4126a306b98f3f6a2110f6256e1e999ae9`, raw evidence
at `.preview/city-styles/chongqing-browser/report.json`. i7-14700KF / RTX 4080
SUPER, ANGLE D3D11, paused normal view, 1440 × 1000 window, 892 × 815 canvas,
pixel ratio 1. Fixture: one covered exit, virtual exit, guidepost, wall/standing
maps, doorway and four prepared B consists for two lines. One Guangzhou →
Chongqing DOM tile click took **155.5 ms to first render submission**, missing the
strict <100 ms target. This single observation is not a percentile, real-pointer
latency or GPU/display completion measurement. No concurrent builds/tests/profiles
ran during capture. It retained train roots and badge textures and performed zero
chunk remeshes/raycasts, and the capture does not attribute the remaining cost.

## Per-model geometry detail inventory

Actual generated counts, not station totals or FPS estimates. Equipment counts
include visible source/instanced geometry and authored Low; train counts include
static, door and transparent batching; passenger counts come from the baked atlas.
Counts exclude textures and do not establish a draw-call or GPU-time pass.

### Equipment and decor

Palette inventories come from
`node tools/model-triangle-inventory.mjs` using production builders and authored
Low geometry. Counts are geometry inventory, not frame-time measurements.

Default Guangzhou catalogue. Shared limits live in
`tools/equipment-low-budgets.mjs`: strict <10% unless an explicit minimum-shape
exception applies. Never raise a limit to conceal a regression.

Ballfield inventory: `BENCH_OUTPUT=.preview/perf/ballfields/report.json
node tools/model-triangle-inventory.mjs` (three.js r186); raw counts are in
`.preview/perf/ballfields/model-triangles.json`, with source hashes in
`.preview/perf/ballfields/source-hashes.json`. Ballfields use 88/192 triangles
(pickleball), 100/228 (badminton) and 52/132 (portable divider), Low/High. The open
nets use line primitives in addition: 129 segments for pickleball and 127 for
badminton. These are geometry counts, not drag latency, draw-call or GPU-time
measurements.

Seating inventory: `BENCH_OUTPUT=.preview/perf/seating/report.json node tools/model-triangle-inventory.mjs` (three.js r186). Raw counts: `.preview/perf/seating/model-triangles.json`. Both seating options meet the strict <10% triangle budget. These are generated geometry counts, not frame-time measurements.

Tactile trim inventory: `BENCH_OUTPUT=.preview/perf/tactile-strip/report.json INVENTORY_REPORT_ONLY=1 node tools/model-triangle-inventory.mjs` (three.js r186). 圆点提示条 (`tactile-warning-strip`) is 4 / 1932 Low/High: Low keeps the one-metre top sheet and omits its 60 instanced dots, while High adds 32 triangles per dot. A crosswise junction arm adds one sheet and 15 dots, giving 8 / 2424 with one arm and 12 / 2916 with two. Raw counts: `.preview/perf/tactile-strip/model-triangles.json`.

| Equipment / decor model name | Low triangles | High triangles |
|---|---:|---:|
| tree | 396 | 18432 |
| shelf-cooler | 420 | 9852 |
| shelf-cooler-dark | 420 | 9852 |
| bridge | 720 | 9576 |
| checkout-cafe-pastry/4m | 116 | 8620 |
| shelf-cafe-backbar-4 | 136 | 8488 |
| shelf-white-tall | 240 | 7556 |
| shelf-dark-tall | 240 | 7244 |
| shelf-fruit-island | 364 | 7100 |
| urinal | 648 | 6880 |
| shelf-wire | 412 | 6524 |
| checkout-cafe-pastry/3m | 108 | 6332 |
| shelf-food-bakery | 80 | 5884 |
| shelf-books | 64 | 5808 |
| cubicle | 72 | 5688 |
| shelf-fruit-tiered | 384 | 5672 |
| cctv-dome | 336 | 5208 |
| walkway | 290 | 5162 |
| cctv-post | 352 | 5096 |
| shelf-bags | 116 | 5048 |
| sink | 224 | 4972 |
| cctv-ptz | 308 | 4924 |
| shelf-white-short | 192 | 4420 |
| checkout-cafe-pastry/2m | 100 | 4044 |
| shelf-cafe-backbar-2 | 100 | 3712 |
| escalator | 204 | 3410 |
| cubicle-toilet | 256 | 3052 |
| shelf-cafe-backbar | 116 | 2944 |
| ac-unit | 140 | 2924 |
| shelf-clothing-shoes | 40 | 2724 |
| stair-leftForward | 232 | 2336 |
| stair-rightForward | 232 | 2336 |
| stair-left180 | 222 | 2288 |
| stair-right180 | 222 | 2288 |
| stair-centerForward | 212 | 2240 |
| stair-left90 | 212 | 2240 |
| stair-right90 | 212 | 2240 |
| checkout-cafe/4m | 100 | 1972 |
| clock | 188 | 1940 |
| stair-straight | 150 | 1940 |
| tactile-warning-strip | 4 | 1932 |
| cctv | 124 | 1888 |
| shelf-food-snacks | 80 | 1884 |
| lift | 144 | 1776 |
| checkout-cafe-pastry | 92 | 1756 |
| checkout-cafe/3m | 92 | 1684 |
| fence-steel-blue | 94 | 1668 |
| checkout-cafe/2m | 84 | 1396 |
| shelf-clothing-wall | 44 | 1372 |
| electrical-cabinet | 36 | 1224 |
| checkout-cafe | 60 | 928 |
| extinguisher-glass | 86 | 918 |
| exit-covered-1 | 68 | 902 |
| exit | 68 | 902 |
| exit-covered-3 | 68 | 902 |
| shelf-ice-cream | 68 | 900 |
| roof-canopy | 56 | 840 |
| tactile-warning | 4 | 812 |
| fence-iron | 72 | 768 |
| checkout/2m | 68 | 762 |
| checkout/3m | 68 | 762 |
| checkout/4m | 68 | 762 |
| checkout | 64 | 750 |
| shelf-clothing-table | 48 | 732 |
| gate-new | 68 | 720 |
| rail-signal | 64 | 708 |
| shelf-clothing-rail | 48 | 680 |
| vending | 40 | 676 |
| gate | 64 | 668 |
| desk | 60 | 652 |
| pillar-thick | 48 | 576 |
| exit-uncovered-2 | 52 | 554 |
| exit-uncovered-3 | 52 | 554 |
| exit-uncovered-1 | 52 | 530 |
| fence-gate | 38 | 432 |
| roof-tapered | 38 | 396 |
| tvm | 30 | 372 |
| busstop-long | 30 | 372 |
| fence | 26 | 360 |
| bench-office-1 | 16 | 360 |
| checkout-generic/4m | 28 | 352 |
| clock-digital | 28 | 352 |
| door-steel-1 | 20 | 324 |
| door-glass-1 | 18 | 324 |
| checkout-generic/3m | 28 | 304 |
| roof-truss | 26 | 264 |
| busstop-short | 24 | 260 |
| checkout-generic/2m | 28 | 256 |
| light-circular | 18 | 256 |
| court-badminton | 100 | 228 |
| monitor-wall | 8 | 213 |
| checkout-generic | 28 | 208 |
| lawn | 12 | 204 |
| bin | 26 | 196 |
| court-pickleball | 88 | 192 |
| bench-wood-1 | 14 | 180 |
| vent | 32 | 168 |
| bench-seat-1 | 20 | 156 |
| extinguisher | 12 | 146 |
| extinguisher-compact | 12 | 146 |
| door-wood-1 | 20 | 144 |
| court-divider | 52 | 132 |
| sidewalk | 12 | 132 |
| tv-double | 28 | 132 |
| psd-end | 30 | 114 |
| tv | 22 | 114 |
| noise-barrier | 46 | 108 |
| noise-barrier-half | 46 | 108 |
| traffic-light | 28 | 108 |
| bench-steel-1 | 16 | 84 |
| sign-ceiling | 18 | 74 |
| monitor-ceiling | 20 | 72 |
| tactile-guide | 10 | 60 |
| guidepost | 57 | 60 |
| curtain-wall | 18 | 60 |
| glass-1x1 | 18 | 60 |
| glass-2x1 | 18 | 60 |
| glass-3x1 | 18 | 60 |
| glass-1x2 | 18 | 60 |
| glass-2x2 | 18 | 60 |
| glass-3x2 | 18 | 60 |
| exit-virtual | 46 | 60 |
| road | 10 | 50 |
| stair-block | 34 | 48 |
| linemap-stand | 16 | 40 |
| hanger-roof | 6 | 36 |
| hanger-post | 14 | 36 |
| pillar-slim | 16 | 36 |
| billboard-wide | 4 | 26 |
| billboard-standard | 4 | 26 |
| billboard-large | 4 | 26 |
| billboard-panorama | 4 | 26 |
| billboard-portrait | 4 | 26 |
| billboard-square | 4 | 26 |
| billboard-16x9-3m | 4 | 26 |
| billboard-16x9-4m | 4 | 26 |
| billboard-4x3-3m | 4 | 26 |
| billboard-4x3-4m | 4 | 26 |
| linemap-wall | 4 | 26 |
| exit-doorway-1 | 10 | 26 |
| exit-doorway-2 | 10 | 26 |
| exit-doorway-3 | 10 | 26 |
| exit-doorway-4 | 10 | 26 |
| roof-shell | 8 | 24 |
| noise-barrier-railing | 16 | 24 |
| light-rectangular | 6 | 24 |
| roof | 4 | 12 |
| psd-end-cover | 4 | 12 |
| floor-mark-boarding | 2 | 2 |
| floor-mark-waiting | 2 | 2 |
| floor-mark-direction | 2 | 2 |
| sign-wall | 2 | 2 |
| calligraphy-kai-h | 2 | 2 |
| calligraphy-kai-v | 2 | 2 |
| calligraphy-xing-h | 2 | 2 |
| calligraphy-xing-v | 2 | 2 |
| calligraphy-li-h | 2 | 2 |
| calligraphy-li-v | 2 | 2 |
| calligraphy-wei-h | 2 | 2 |
| calligraphy-wei-v | 2 | 2 |
| calligraphy-hei-h | 2 | 2 |
| calligraphy-hei-v | 2 | 2 |
| calligraphy-song-h | 2 | 2 |
| calligraphy-song-v | 2 | 2 |

#### Shenzhen variants

| Equipment / decor model name | Low triangles | High triangles |
|---|---:|---:|
| exit-covered-1 | 168 | 1716 |
| exit | 168 | 1716 |
| exit-covered-3 | 168 | 1716 |
| guidepost | 40 | 1604 |
| exit-virtual | 40 | 1604 |
| exit-uncovered-2 | 52 | 554 |
| exit-uncovered-3 | 52 | 554 |
| exit-uncovered-1 | 52 | 530 |
| linemap-stand | 16 | 40 |
| linemap-wall | 4 | 26 |
| exit-doorway-1 | 10 | 26 |
| exit-doorway-2 | 10 | 26 |
| exit-doorway-3 | 10 | 26 |
| exit-doorway-4 | 10 | 26 |

All 14 Shenzhen variants meet the existing budgets; no limit was raised.

#### Shanghai variants

All 14 Shanghai variants meet the same budgets.
Records: `.preview/perf/current-models-shanghai/model-triangles.json`.

| Equipment / decor model name | Low triangles | High triangles |
|---|---:|---:|
| exit-covered-1 | 124 | 1518 |
| exit | 124 | 1518 |
| exit-covered-3 | 124 | 1518 |
| exit-uncovered-2 | 52 | 554 |
| exit-uncovered-3 | 52 | 554 |
| exit-uncovered-1 | 52 | 530 |
| guidepost | 36 | 164 |
| exit-virtual | 36 | 164 |
| linemap-stand | 16 | 40 |
| linemap-wall | 4 | 26 |
| exit-doorway-1 | 10 | 26 |
| exit-doorway-2 | 10 | 26 |
| exit-doorway-3 | 10 | 26 |
| exit-doorway-4 | 10 | 26 |


#### Beijing variants

All 14 Beijing variants pass the existing budgets; no limit was raised.
Records: `.preview/perf/current-models-beijing/model-triangles.json`.

| Equipment / decor model name | Low triangles | High triangles |
|---|---:|---:|
| exit-covered-1 | 154 | 1542 |
| exit | 154 | 1542 |
| exit-covered-3 | 154 | 1542 |
| exit-uncovered-2 | 52 | 554 |
| exit-uncovered-3 | 52 | 554 |
| exit-uncovered-1 | 52 | 530 |
| guidepost | 44 | 164 |
| exit-virtual | 44 | 164 |
| linemap-stand | 16 | 40 |
| linemap-wall | 4 | 26 |
| exit-doorway-1 | 10 | 26 |
| exit-doorway-2 | 10 | 26 |
| exit-doorway-3 | 10 | 26 |
| exit-doorway-4 | 10 | 26 |

#### Chengdu variants

All 14 Chengdu variants pass the existing budgets; no limit was raised. Counts
do not establish FPS or GPU cost. Records:
`.preview/perf/model-triangles.json`.

| Equipment / decor model name | Low triangles | High triangles |
|---|---:|---:|
| exit-covered-1 | 362 | 8706 |
| exit | 362 | 8706 |
| exit-covered-3 | 362 | 8706 |
| exit-uncovered-2 | 52 | 554 |
| exit-uncovered-3 | 52 | 554 |
| exit-uncovered-1 | 52 | 530 |
| guidepost | 49 | 50 |
| exit-virtual | 41 | 50 |
| linemap-stand | 16 | 40 |
| linemap-wall | 4 | 26 |
| exit-doorway-1 | 10 | 26 |
| exit-doorway-2 | 10 | 26 |
| exit-doorway-3 | 10 | 26 |
| exit-doorway-4 | 10 | 26 |

#### Chongqing variants

Production-path inventory (three.js r186, `MODEL_CITY=chongqing`):
`.preview/perf/current-models-chongqing/model-triangles.json`. All 14 Chongqing
variants meet the existing budgets; no limit was raised. These counts do not
establish FPS or GPU cost.

| Equipment / decor model name | Low triangles | High triangles |
|---|---:|---:|
| exit-covered-1 | 222 | 2350 |
| exit | 222 | 2350 |
| exit-covered-3 | 222 | 2350 |
| guidepost | 46 | 1940 |
| exit-virtual | 46 | 1940 |
| exit-uncovered-2 | 52 | 554 |
| exit-uncovered-3 | 52 | 554 |
| exit-uncovered-1 | 52 | 530 |
| linemap-stand | 16 | 40 |
| linemap-wall | 4 | 26 |
| exit-doorway-1 | 10 | 26 |
| exit-doorway-2 | 10 | 26 |
| exit-doorway-3 | 10 | 26 |
| exit-doorway-4 | 10 | 26 |

#### Wuhan variants

Production-path inventory (three.js r186):
`.preview/perf/current-models-wuhan/model-triangles.json`, generated with
`MODEL_CITY=wuhan BENCH_OUTPUT=.preview/perf/current-models-wuhan/report.json node tools/model-triangle-inventory.mjs`.
All 14 Wuhan variants meet existing budgets. These are geometry counts, not FPS
measurements.

| Equipment / decor model name | Low triangles | High triangles |
|---|---:|---:|
| exit-covered-3 | 102 | 4982 |
| exit | 102 | 4634 |
| exit-covered-1 | 102 | 4322 |
| guidepost | 40 | 1204 |
| exit-virtual | 40 | 1204 |
| exit-uncovered-2 | 52 | 554 |
| exit-uncovered-3 | 52 | 554 |
| exit-uncovered-1 | 52 | 530 |
| linemap-stand | 16 | 40 |
| linemap-wall | 4 | 26 |
| exit-doorway-1 | 10 | 26 |
| exit-doorway-2 | 10 | 26 |
| exit-doorway-3 | 10 | 26 |
| exit-doorway-4 | 10 | 26 |

#### Nanjing variants

Production-path inventory (three.js r186):
`.preview/perf/current-models-nanjing/model-triangles.json`, generated with
`MODEL_CITY=nanjing` and `tools/model-triangle-inventory.mjs`. All 14 Nanjing
variants meet existing budgets; counts do not establish FPS.

| Equipment / decor model name | Low triangles | High triangles |
|---|---:|---:|
| exit-covered-1 | 374 | 3818 |
| exit | 374 | 3818 |
| exit-covered-3 | 374 | 3818 |
| guidepost | 16 | 592 |
| exit-virtual | 16 | 592 |
| exit-uncovered-2 | 52 | 554 |
| exit-uncovered-3 | 52 | 554 |
| exit-uncovered-1 | 52 | 530 |
| linemap-stand | 16 | 40 |
| linemap-wall | 4 | 26 |
| exit-doorway-1 | 10 | 26 |
| exit-doorway-2 | 10 | 26 |
| exit-doorway-3 | 10 | 26 |
| exit-doorway-4 | 10 | 26 |

#### Equipment minimum-shape exceptions

| Equipment / decor model name | Low / High | Minimum-shape exception |
|---|---:|---:|
| cubicle-toilet | 1712 / 3052 |  |
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
| billboard-wide | 4 / 26 | Original cropped artwork and frame surface. |
| billboard-standard | 4 / 26 | Original cropped artwork and frame surface. |
| billboard-large | 4 / 26 | Original cropped artwork and frame surface. |
| billboard-panorama | 4 / 26 | Original cropped artwork and frame surface. |
| billboard-portrait | 4 / 26 | Original cropped artwork and frame surface. |
| billboard-square | 4 / 26 | Original cropped artwork and frame surface. |
| billboard-16x9-3m | 4 / 26 | Original cropped artwork and frame surface. |
| billboard-16x9-4m | 4 / 26 | Original cropped artwork and frame surface. |
| billboard-4x3-3m | 4 / 26 | Original cropped artwork and frame surface. |
| billboard-4x3-4m | 4 / 26 | Original cropped artwork and frame surface. |
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

Current budget violations remain failures:

| Model | Low | High | Limit |
| --- | --- | --- | --- |
| cubicle-toilet | 1712 | 3052 | 305 |

`INVENTORY_REPORT_ONLY=1` exposes the full inventory despite violations; it does
not waive them. Default inventory generation remains strict.

### Train models (车辆)

| Train model | Third-rail Low | Third-rail High | Catenary Low | Catenary High |
|---|---:|---:|---:|---:|
| A-2 | 21756 | 263172 | 23412 | 276860 |
| A-3 | 29774 | 341878 | 31430 | 355566 |
| A-4 | 37792 | 420584 | 39448 | 434272 |
| A-6 | 53828 | 577996 | 55484 | 591684 |
| A-8 | 69864 | 735408 | 72348 | 755940 |
| B-2 | 19576 | 244600 | 21232 | 258288 |
| B-3 | 26642 | 313274 | 28298 | 326962 |
| B-4 | 33708 | 381948 | 35364 | 395636 |
| B-6 | 47840 | 519296 | 49496 | 532984 |
| B-8 | 61972 | 656644 | 64456 | 677176 |
| C-2 | 20668 | 257880 | 22324 | 271568 |
| C-3 | 27934 | 328070 | 29590 | 341758 |
| C-4 | 35200 | 398260 | 36856 | 411948 |
| C-6 | 49732 | 538640 | 51388 | 552328 |
| C-8 | 64264 | 679020 | 65920 | 692708 |
| D-2 | 27032 | 418820 | 28624 | 431932 |
| D-3 | 35178 | 566934 | 36770 | 580046 |
| D-4 | 43612 | 715336 | 45204 | 728448 |
| D-6 | 60192 | 1011852 | 61784 | 1024964 |
| D-8 | 76772 | 1308368 | 78364 | 1321480 |
| L-2 | 17944 | 225872 | 19600 | 239560 |
| L-3 | 24330 | 286486 | 25986 | 300174 |
| L-4 | 30716 | 347100 | 32372 | 360788 |
| L-6 | 43488 | 468328 | 45972 | 488860 |
| L-8 | 56260 | 589556 | 58744 | 610088 |

Counts cover all selectable formations for both roof power modes. They include
retained city decals and use production static, door and transparent batching
plus authored detail swaps. All 50 combinations meet the 10% Low triangle budget.
Regenerate with `node tools/model-triangle-inventory.mjs`. This capture used
`INVENTORY_REPORT_ONLY=1` for the separate equipment budget violation above.
Results are in `.preview/perf/pantograph-layout/train-triangles.json` (three.js r186).

### Passenger models (乘客)

All 440 variants, grouped only when exact High/Low counts match. Individual names
remain in `.preview/perf/current-models/passenger-triangles.json`.

| Variants | Low | High |
| --- | --- | --- |
| 2 | 791 | 8101 |
| 2 | 774 | 8016 |
| 2 | 715 | 7382 |
| 2 | 704 | 7297 |
| 2 | 690 | 7149 |
| 5 | 684 | 7149 |
| 1 | 678 | 7145 |
| 1 | 670 | 7021 |
| 5 | 673 | 6976 |
| 2 | 664 | 6968 |
| 2 | 672 | 6961 |
| 1 | 668 | 6894 |
| 6 | 659 | 6888 |
| 2 | 671 | 6862 |
| 2 | 669 | 6862 |
| 2 | 669 | 6861 |
| 2 | 669 | 6860 |
| 11 | 660 | 6858 |
| 2 | 653 | 6777 |
| 2 | 654 | 6777 |
| 2 | 654 | 6776 |
| 2 | 653 | 6775 |
| 2 | 658 | 6761 |
| 2 | 655 | 6761 |
| 2 | 658 | 6760 |
| 2 | 657 | 6760 |
| 2 | 643 | 6676 |
| 2 | 640 | 6676 |
| 2 | 645 | 6675 |
| 2 | 642 | 6675 |
| 7 | 616 | 6430 |
| 1 | 614 | 6426 |
| 1 | 604 | 6302 |
| 5 | 603 | 6257 |
| 2 | 594 | 6249 |
| 2 | 592 | 6242 |
| 1 | 590 | 6175 |
| 6 | 593 | 6169 |
| 11 | 590 | 6139 |
| 2 | 574 | 5910 |
| 2 | 569 | 5910 |
| 5 | 564 | 5910 |
| 5 | 565 | 5910 |
| 2 | 568 | 5909 |
| 5 | 562 | 5909 |
| 2 | 573 | 5908 |
| 5 | 563 | 5908 |
| 1 | 561 | 5906 |
| 1 | 564 | 5906 |
| 1 | 565 | 5905 |
| 1 | 564 | 5904 |
| 2 | 558 | 5809 |
| 2 | 560 | 5809 |
| 5 | 554 | 5809 |
| 5 | 550 | 5809 |
| 2 | 558 | 5808 |
| 2 | 560 | 5808 |
| 5 | 554 | 5808 |
| 5 | 552 | 5808 |
| 1 | 548 | 5805 |
| 1 | 546 | 5805 |
| 1 | 550 | 5804 |
| 1 | 548 | 5804 |
| 1 | 549 | 5782 |
| 1 | 560 | 5782 |
| 1 | 560 | 5781 |
| 1 | 549 | 5780 |
| 5 | 556 | 5737 |
| 5 | 555 | 5737 |
| 5 | 554 | 5736 |
| 5 | 553 | 5735 |
| 2 | 549 | 5729 |
| 2 | 544 | 5729 |
| 2 | 545 | 5728 |
| 2 | 550 | 5727 |
| 2 | 551 | 5722 |
| 2 | 548 | 5722 |
| 2 | 547 | 5721 |
| 2 | 550 | 5720 |
| 1 | 547 | 5681 |
| 1 | 545 | 5681 |
| 2 | 545 | 5680 |
| 1 | 543 | 5655 |
| 1 | 546 | 5655 |
| 1 | 549 | 5654 |
| 1 | 544 | 5653 |
| 6 | 540 | 5649 |
| 6 | 543 | 5649 |
| 6 | 544 | 5648 |
| 6 | 541 | 5647 |
| 10 | 543 | 5636 |
| 5 | 545 | 5635 |
| 5 | 543 | 5635 |
| 4 | 524 | 5628 |
| 4 | 524 | 5627 |
| 2 | 538 | 5621 |
| 2 | 540 | 5621 |
| 2 | 536 | 5620 |
| 2 | 538 | 5620 |
| 11 | 539 | 5619 |
| 11 | 548 | 5619 |
| 11 | 549 | 5618 |
| 11 | 538 | 5617 |
| 1 | 534 | 5554 |
| 1 | 536 | 5554 |
| 1 | 536 | 5553 |
| 1 | 534 | 5553 |
| 6 | 533 | 5548 |
| 6 | 531 | 5548 |
| 12 | 533 | 5547 |
| 22 | 530 | 5518 |
| 22 | 528 | 5517 |
| 2 | 523 | 5422 |
| 2 | 512 | 5337 |
| 2 | 426 | 4470 |
| 5 | 430 | 4470 |
| 1 | 424 | 4466 |
| 1 | 415 | 4342 |
| 5 | 413 | 4297 |
| 2 | 408 | 4289 |
| 2 | 410 | 4282 |
| 1 | 402 | 4215 |
| 6 | 399 | 4209 |
| 11 | 400 | 4179 |

### Ambient road vehicles

Authored Low car/bus/bike/scooter meshes use bounded instance pools. Road
catalogue counts describe surface geometry, not the fleet.

## Keep interactive work bounded

### Pointer picking and geometry snapping

Resolve at most one scene pick per event and share it across tools, surface aims,
selection and audio.

The production capture from `node tools/check-geometry-snapping.mjs` in
`.preview/perf/geometry-snapping/browser.json` covers 12 fixtures and 111 pointer
events: at most one scene raycast per event, no browser errors. Its synchronous
dispatch maximum was 16.4 ms; this excludes queued hover work, render submission
and display and does **not** establish the <100 ms visible-response budget. Keep
the build identifier and timing boundary in the raw report.

### Placement invalidation and model retention

Use immutable inputs and complete dependency keys. Retain remote roots, animation
registrations and Low resources. Unknown inputs take the conservative rebuild path.
Commit accepted edits only; never scan all equipment per candidate tile.

### Atlas slot release and equipment batches

天河公园, the largest example (151,852 cells, 76,436 modules), production
API-to-render capture (`node tools/bench-editor-actions.mjs`, `BENCH_DEMO=tianhe
BENCH_CASE=guidepost BENCH_SAMPLES=1`, headless Chrome 156 / RTX 4080 SUPER via
ANGLE D3D11, 1440 × 1000 window, 892 × 815 canvas, pixel ratio 1, High quality,
paused, one sample per action). Deleting one 指示牌 measured **1,973.1 ms**, of
which `scene.setStation` was 1,787.4 ms and `modules.syncBatches` **1,590.7 ms**;
deleting one 电视 in a separate session measured 2,402.8 ms with `syncBatches`
1,985.7 ms, while deleting a 座椅 on the same station measured 384.2 ms with
`syncBatches` 77.5 ms. Guidepost place (515.0 ms) and drop (334.5 ms) in the same
paired session were unaffected. Raw reports:
`.preview/perf/editor-actions/run-2026-11-08T00-04-21-927Z-61648/report.json`
(the pre-fix build snapshot paired with its own source),
`run-2026-11-08T00-03-14-655Z-61060/report.json` (the fixed build, same protocol)
and `run-2026-11-08T00-01-41-355Z-74064/report.json` (the 座椅 / 电视 session).

Cause: `EquipmentBatches.sync` collects the atlas textures of every surviving root
and calls `PanelAtlas.retain`. A panel that left the document frees its slot and
bumps `mappingVersion`, and that bump was treated as "every baked UV may be
stale": the batch cache dropped every prepared root and rebuilt all buckets — a
full station-wide re-walk over 76 k roots, per-source atlas resolution and a
geometry re-bake of each merged bucket. A Chrome CPU profile of that delete
(`--profile`, `.preview/perf/editor-actions/profiles/`) attributed ~1.1 s under
`EquipmentBatches.sync` to `bakedGeometry`/`mergeGeometries`/`BatchedMesh`
insertion (`toNonIndexed`, `applyMatrix4`, `addGeometry`, `computeBoundingBox`),
so any deleted piece that owns printed artwork — a 指示牌, 电视, 出入口, 线网图,
匾额 or 广告牌 — paid it.

A release cannot make a surviving root's UVs wrong: `retain` only pushes the freed
rect onto its page's free list (a live slot never moves), and a panel that later
takes the freed rect carries its own map/material UUID in the entry signature. A
release now drops only the dormant storey views. The same paired capture then
measured the same delete at **547.9 ms** (`syncBatches` **113.9 ms**), i.e. the
cost of deleting an unprinted 座椅. A bucket that shrinks below the merge
threshold also puts its surviving sources back on layer 0; before, the last panel
of a deleted pair kept the batch-only layer and stopped drawing. Guard both rules
with the deterministic work counts in `batching-lifecycle.test.mjs`
(`EquipmentBatches.lastSync`).

Limits: one sample per row and API-to-first-render only (no pointer dispatch,
compositor presentation or GPU completion). The two captures above are the same
protocol back to back on the same host, and their sources differ by this fix plus
three UI-only commits (view cube, shortcut removal) that touch no render or
equipment path; their `pickup` control rows matched (101.7 vs 100.0 ms). The
row-to-row spread on this host is otherwise large (see
[the action-matrix note](#repeatable-editor-action-matrix)), so only that paired
comparison is a speedup. The remaining ~350–550 ms
of a 天河公园 equipment edit is the shared `setStation` rebuild —
`modules.retainedIds` (~30–60 ms dependency scan), `buildModules` (~100–240 ms,
whose contact-blob prepass walks all 76 k modules) and `syncBatches` (~80–160 ms)
— plus a ~60–120 ms commit/React/frame gap that no audited stage covers.

### Undo history and derived placement indexes

The reported heap-growth interaction opens the supplied 天河公园 save and places
ceiling-hung lights with the real pointer. Production build, headless Chrome 156 /
SwiftShader, 1440 × 1000, paused, no concurrent runs. The 13.8 MB save holds
130 150 cells, 75 454 modules and 2 674 suspended-ceiling cells; it opens at a
1.15 GB main-isolate heap, 18 095 draws and 1.8 GB of texture pixel data. Eight
placements, four forced GCs after each, raised the heap **29.7 MB per placement**
(1 152.9 → 1 362.2 MB; `past` 2 → 9). Clearing `past`/`future` after each commit
held the same run to 8.9 MB per placement.

The frames were not copying documents: each retained frame's immutable `modules`
array kept the station-sized derived indexes the hover built against it. A Node
harness calling `equipmentReason` on each kept version retained 44.2 MB per frame
(collision bodies and their spatial index 14.6 MB, ceiling support 11.8 MB
including `blockIndex` 4.7 MB, plus blocked levels, ground, fences and outdoor
surfaces). Multiplied by the forty-frame depth that is ~1.2 GB of derived-index
retention above the load baseline, which is what pushes an already-large tab over
its heap limit.

`sim/documentCaches.ts` releases a retired document's derived indexes from
`StationSlice` (`commit`, `undo`, `redo`, `newStation`, `loadFromText`,
`loadReference`) and the autosave restore. Frames keep their immutable records and
rebuild on demand if an undo makes them current. The same eight placements
measured **5.5–6.0 MB per placement** with history retained (1 123.7 → 1 165.7 MB
and 1 130.5 → 1 169.2 MB on the two fixture revisions); the residual is each
frame's own 75 k-element module array. Raw reports: `.preview/perf/ceiling-oom/`
(ignored). Limits: software GPU and headless Chrome; this is a JS-heap slope, not a
hardware-GPU OOM reproduction, and it does not measure first-render latency.
`ChunkSystem.authoredKeys` remains keyed by the cells array and is not registered;
it matters only for cell edits, not equipment edits.

### Outdoor paving instances

The per-tile paving source cost **~8 KB of page heap and two scene objects per
square metre** on the supplied 天河公园 save (130,158 cells; 55,545 lawn + 14,312
sidewalk modules), while its drawing was already instanced. That path loaded at
1,087.8 MB page heap, 200,438 scene objects, 18,321 draws and 3.80 M triangles
(headless Chrome 156 / SwiftShader, 1440 × 1000, paused).

`render/surfaceBatches.ts` draws paving directly from the document: one
`StaticInstances` per finish × 64 m bucket, with no per-tile mesh or contact blob;
the bare root caches its open/unsupported verdict, and pointer picks resolve
`hit.instanceId` through the bucket's module table. The same load measures
**691.1 MB page heap
(−396.7 MB, 36.5%)**, 129,879 scene objects (−70,559), 52 surface buckets,
69,857 instances, 17,729 draws and 4.11 M triangles (the coarser buckets keep
more pavers on their near detail at this camera; 3.80 M in the baseline). A one-tile delete
committed in 80.7 ms and retained 51 of the 52 bucket allocations, replacing only
the touched bucket. A storey switch's paving sync (after the cached hidden flag)
measured 9.6–11.1 ms. Reports: `.preview/perf/memory/surface-check-*.json` (ignored).

Limits: software GPU and headless; chunk geometry and canvas textures are
unchanged by this layer, and hardware-GPU memory is not measured. The remaining
~170 MB attributable to paving is the bare per-tile root plus its buckets —
removing those roots (with a document-driven level/selection path) is the next
lever. Keep the generic `EquipmentBatches` capable of static tiles as a unit, but
`ModuleSystem` must not route paving through it, or the per-tile source records
come back.

### Settings and presentation edits

City switches repaint cab textures in place, replace city-specific exit/pylon
shells and map roots, and cache map artwork by city. Ordinary label edits repaint
retained artwork; invisible settings do not dirty geometry. Preserve live rigs
and ownership on retention paths.

### Build-rail thumbnails

Checked-in, lazy-loaded 132 px PNGs avoid startup WebGL rendering. Generate them
with the real renderer after a build, then rebuild. Never restore startup WebGL
thumbnails.

### Suspended ceilings

Ceiling edits keep local invalidation.

### Shared interactive previews

Reuse bounded materials, geometry and the event's pick. Process only the newest
target; refused previews stay refused until footprint/inputs change.

### Drag previews and collision

Use 50 ms latest-target scheduling. Block drags cap at 10,000 cells including
walls; refuse oversized gestures whole before allocating their footprint. Cache
occupancy/verdicts against immutable inputs.

### Fence drags and equipment placement

`tools/bench-fence-drag.mjs` measures production builds with and without the
per-cell refusal preview on the 256-fence fixture at 1424 × 905 in headless
Chrome 156 / SwiftShader, two RAFs after real pointer events. Cold down was
157.9 / 260.6 ms and warm down 32.6 / 32.5 ms; warm move 2 was 48.9 / 50.9 ms.
Single samples are noisy and do not establish a speedup or hardware performance.
Raw reports: `.preview/perf/fence-drag-cell-before.json` and
`.preview/perf/fence-drag-cell-after.json`. This fixture has no blocked cell,
so it does not measure the extra red-box rendering.

Bound neighbour discovery and retain unrelated preview/batch contributions.

### Block collision in demo stations

Cache blocked and partial-support cases with original refusal priority, cell
ownership and immutable array reuse when introducing indexes.

## Simulation playback frame tails

Measure submitted frames separately from RAFs using `bench:sim-stalls`. The shared
benchmark-view presets are: Regular Zoo, ground hidden at −15 m from the TOP/N/W
corner; Regular Tanwei, default opening level with Hide UI; Regular Tianhe, the
−5 m concourse with the isometric camera. All three use the 2/3 camera-distance
factor.
`bench:sim-stalls` accepts all three shipped demos, and so does the in-game
`/benchmark` route. Match canvas, pixel ratio, population, speed and quality;
separate clean timings, CPU sampling and GPU traces. Low / normal view / 16×
targets at least 15 FPS 1% low over the first 30 seconds.

For a routing comparison, build once with `npm --prefix game run build:game:wasm`
and serve it with `npm --prefix game run preview:wasm`. Select TypeScript or WebAssembly
on localhost `/benchmark` and keep the other settings fixed. The result shows
the backend, searches completed in WASM, and ticks advanced during sampling.

Measured 2026-11-07 at Low / normal view / 16× for 30 s, DPR 1, 852 × 715 canvas,
headless Chrome 156 on an i7-14700KF with an RTX 4080 SUPER (hardware ANGLE).
Zoo and Tanwei were measured back to back on the build with the occupied-storey
rule and the dense below bound; Tianhe Park was re-measured on the build that
moves its Regular preset to −5 m (see below),
`BENCH_MODE=regular BENCH_QUALITY=low BENCH_SPEED=16 BENCH_SECONDS=30
BENCH_DEMO=<demo> node tools/bench-sim-stalls.mjs`:

| Demo | Cells | Station load | Submitted frames | Average FPS | 1% low FPS | Worst frame |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Zoo | 14,066 | 5.7 s | 1,795 | 59.81 | 35.55 | 45.2 ms |
| Tanwei | 16,725 | 8.9 s | 1,252 | 41.70 | 23.65 | 53.2 ms |
| Tianhe Park (−5 m preset) | 151,852 | 32.2 s | 215 | 7.16 | 5.37 | 191.3 ms |

Zoo and Tanwei clear the 15 FPS 1% low target comfortably, up from 20.40 and
16.19 before the occupied-storey rule. Tianhe Park's benchmark preset is its
−5 m concourse — the representative public floor — and that workload is far
below the target: 7.16 FPS average, 5.37 1% low, 215 of 215 frames over 100 ms.
At the −20 m opening platform the same build measured 25.00 / 11.38, so the
preset, not the rule, is the main difference: the concourse carries the courts,
shop fittings and their door families, plus the ghosted −10 m storey. The
platform-screen doors that dominate the −20 m view (about 2.7k of ~4.7k High-LOD
draws) are less of the −5 m cost. Reports:
`.preview/perf/sim-stalls/{zoo,tanwei}-hide-above.json`,
`tianhe-hide-above.json` (the −20 m reference) and `tianhe-minus5.json`; tail
figures at this sample size are not a stable ranking.

### Tianhe Park concourse profiling

The November 8 capture used the shipped Tianhe fixture (151,852 cells, source
SHA-256 `4f15bab9154fe48cb3293d55854a6e267d6f89a02d49c34390c7d302b92ca395`),
Chrome 156 hardware ANGLE/D3D11 on an i7-14700KF and RTX 4080 SUPER. Keep the
regular −5 m isometric preset, adjacent storey ghost, Low quality, 16× speed,
852 × 715 canvas and DPR 1. The first-Play timer runs for 30 seconds and the
1% low is the inverse mean interval of the slowest 1% of submitted frames.

```powershell
npm --prefix game run build
$env:BENCH_DEMO = 'tianhe'
$env:BENCH_MODE = 'regular'
$env:BENCH_QUALITY = 'low'
$env:BENCH_SPEED = '16'
$env:BENCH_SECONDS = '30'
$env:BENCH_CANVAS_SIZE = '852,715'
$env:BENCH_PIXEL_RATIO = '1'
node tools/bench-sim-stalls.mjs
```

The baseline at `c7c854c0` submitted 10,083 calls in its final frame and measured
12.91 FPS average, 6.78 FPS 1% low and a 171.6 ms worst interval. Render
submission took a median 62.0 ms and reached 142.6 ms. The separate 30-second
CPU profile sampled 4.87 seconds in `updateMatrixWorld` and 1.65 seconds in
`multiplyMatrices`. The draw inventory attributed roughly 1,700 calls per
frame to checkout counters and 2,200 to platform-screen doors. Chrome exposed
`WEBGL_multi_draw` in that inventory. The road pass rebuilt a station-wide
visibility set and signature every frame and reached 15.7 ms in the baseline.

The final production build was isolated at `c7c854c0` with the playback changes
applied, so concurrent workspace edits did not enter the comparison. Vite
source hash `1eb06eb4b487eb767f32dbe3fc4de9696af0fa108411c8f6edc0af1fbe27923c`.
The last capture ran after the test suite exited. The 15 FPS target was met
in two of the three clean captures.

| Capture | Submitted frames | Average FPS | 1% low FPS | Worst interval | Final-frame draws | Median render submission |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `baseline` | 388 | 12.91 | 6.78 | 171.6 ms | 10,083 | 62.0 ms |
| `final-1` | 872 | 29.06 | 12.89 | 111.4 ms | 2,531 | 27.5 ms |
| `final-2` | 1,110 | 36.99 | 16.37 | 94.6 ms | 2,531 | 21.2 ms |
| `final-3` | 1,045 | 34.80 | 17.03 | 64.1 ms | 2,531 | 22.7 ms |

The final captures had zero runtime and WebGL errors and reused the prepared
train fleet. `final-1` still had a 105.8 ms render submission on a frame
carrying an early train snapshot. The table reports submitted frames and
browser-side render durations.

The build batches checkout fittings, platform-door leaves and fixed billboard
art. It shares repeated light, court and floor-mark finishes, collapses uniform
track-face materials and skips empty Low draws. Render traversal excludes
hidden module roots and leaves baked chunk and equipment transforms alone.
Road traffic uses the road and signal registry and continues its fixed steps
while the street is hidden. TV clock refresh uses the station's type index.
Dense Low equipment buckets are 256 m wide, a tradeoff between submission
count and spatial culling. Their static transparent geometry retains
per-surface culling and back-to-front order in an indexed draw.

The separate 12-second equipment ablation reached 59.70 FPS average and
27.43 FPS 1% low with 683 calls in the final frame. It removed both equipment
draw trees and retained the simulation and chunk geometry. The result
isolates the equipment cost. The full-scene captures also showed individual
live-atlas updates taking up to 62.2 ms. In the separate 30-second
`ordered-tail-trace` run, four synchronous `GetProgramiv` calls occupied
about 68 ms during the first-train frame. A later atlas update spent 35.4 ms
waiting for a GL command-buffer token. These waits measure submission
backpressure and do not time GPU execution.

On dense Low stations with `KHR_parallel_shader_compile`, compile at most
one newly visible train per frame, using its actual draw meshes. The train
receives poses immediately and draws after the programs are ready. A separate
`final-probe` capture measured 6.5 ms to submit the first compilation and
133 ms for readiness. The first train drew 139 ms after submission began.
That probe also measured a median live atlas patch of 33,024 pixels, compared
with 524,416 pixels for the former full patch. One 4,064-pixel patch still
waited 34.4 ms in the copy call. Dirty rectangles reduce transfer size while
the command queue can still stall a small copy.

Raw frame intervals, CPU profiles, draw inventory and traces are under
`.preview/perf/tianhe-tail/`.

### Occupied storeys hide what is above them

`显示其他层` used to ghost **every** storey above the active one. That covered
the room being edited — at 天河公园's −5 m concourse the whole level-0 street
(grass, paving, courts) drew over it, and 隐藏天花板 could not remove it because
the street is a "plate with nothing under it" (its own exception). The crowd and
the trains already followed "active + below only"; geometry now matches.

Rules (`render/levelSlicing.ts`, `SliceOptions.hideAbove`):

* **An occupied storey draws nothing above it.** `LevelSystem.applyLevel` derives
  "occupied" from the chunk level's meshes (the generated street pass does not
  count, so an empty level 0 still shows a canopy placed above it). The whole
  storey above is hidden: structure, fixtures, roofs, unsupported street plates.
* **An empty storey still ghosts the storeys above it**, so the editor can show
  where they are; that is the only state where 隐藏天花板 has something to lift.
* Below storeys keep ghosting — bounded to the next storey down on a dense
  document (`DENSE_STATION_MODULES`).
* 隐藏UI and 剖切 still draw the station whole.

Measured effect on the same build: at −5 m with 显示其他层 on, draws fell from
14,395 to 13,388 (the level-0 layer is ~1,000 of them; most street paving is one
instanced draw, so the visual change is larger than the count). The default views
improved far more: at High, home view, Zoo paused went 3,526 → 1,071 draws and
25.65 → 60 FPS (capped), Tanwei 5,145 → 1,853 and 16.89 → 60 FPS, Tianhe Park
5,272 → 4,743 and 24.80 → 26.2 FPS. At Low / 16× the targets moved 44.92/20.40 →
59.81/35.55 (Zoo) and 30.68/16.19 → 41.70/23.65 (Tanwei); Tianhe Park at −20 m
moved 24.7/11.9 → 25.00/11.38 (within tail noise), and its benchmark preset now
runs at −5 m (the table above). The rule is pinned in `test/level-slicing.test.mjs`;
the scene walk is `LevelSystem.applyLevel`.

### Dense-station below-storey budget

`显示其他层` also had no bound on document size: a dense station ghosted every
other storey's structure and furniture, and 天河公园's five storeys (from its
−20 m platform home) drew 19,820 calls at High / 6.7 FPS (paused, home view,
RTX 4080 SUPER). Probing the same scene with the ghosted storeys removed gave
4,743 calls / 25.6 FPS, and with only neighbouring storeys kept 6,815 / 19.2 FPS.

`DENSE_STATION_MODULES` (20,000, `render/detailPolicy.ts`) now bounds the ghost
slice to the next storey for a document that large; `boundedLevelVisible`
applies it to chunk meshes, fixture roots and the paving buckets, while 隐藏UI
and 剖切 still draw every storey. Zoo and Tanwei (4,299 and 9,678 modules) keep
the full below ghost they had. With the occupied-storey rule now removing
everything above, the budget only limits distant **below** storeys; the 19,820 →
5,272 numbers above were the earlier, above-included capture.

### Production browser benchmark, all three demos

`npm run bench:browser` (production build, default High LOD, the editor's home
view, 6 s phases) now measures Zoo, Tanwei and Tianhe Park sequentially. Measured
2026-11-07 back to back on the same build and host as the Low table (DPR 1,
1384 × 805 window, hardware ANGLE). FPS is vsync-capped at 60:

| Demo | Example load | Paused FPS | 16× FPS | Draws (paused / 16×) | 16× triangles |
| --- | ---: | ---: | ---: | ---: | ---: |
| Zoo | boot document | 59.95 (cap) | 59.95 (cap) | 1,071 / 1,103 | 2.29 M |
| Tanwei | 9.6 s | 59.95 (cap) | 56.29 | 1,853 / 1,915 | 3.37 M |
| Tianhe Park | 28.4 s | 14.86 | 12.36 | 4,743 / 4,745 | 1.47 M |

All three were re-captured after the occupied-storey rule; the earlier,
above-included build measured 25.65 / 23.48 (Zoo), 16.89 / 15.94 (Tanwei) and
24.80 / 20.50 (Tianhe Park). The home view no longer draws the storeys over the
opening level, which is why Zoo and Tanwei now cap on the paused and 16× phases
and Tianhe Park lost ~530 of its draws. Load is dominated by the demo bundle and
graph build, not by the slice.

### Tanwei Low at 1×

Target 30 average and 15 FPS 1% low. Guard equipment batch sizing and active-storey
shadow behavior.

### Contact shadows on the active storey

Only floor-standing equipment on the active storey allocates contact blobs;
ceiling fixtures and fixed PSD infill/covers allocate none.

### Live TV atlas uploads and 1% lows

Upload at most one changed live panel per render frame, coalesce fairly to newest
pixels, retain CPU pages for context restoration, remove deleted pending slots
and request frames until uploads drain. Train-arrival cards and minute-clock
repaints can stall independently of train construction; use plate/atlas ablations.

## Opening a station and its exploded view, per demo

`node tools/bench-demo-load.mjs` (root `npm run bench:demo-load`) opens each
shipped demo in a fresh profile and measures both workflows on one build. Source
`4e789c4237e68247dacfebdaa93f783e8f8d140d3d3a3c9bdf51b6bddddb13a2`, i7-14700KF /
RTX 4080 SUPER, headless Chrome 156 with hardware ANGLE requested, 1400 × 900
window (852 × 715 editor canvas, 1384 × 690 exploded canvas), default High
quality, paused, one sample per phase in each of two back-to-back runs. Raw
reports: `.preview/perf/demo-load/record-1/` and `record-2/`.

Boundaries: **save** runs from the `loadReference` call (what an example-station
card executes once its shell paints) to the first presented frame — the same
`onNextFrame` signal that dismisses the loading shell. **Explode** runs from
`setExplodedView(true)` to the snapshot commit (`toData` + `explodedView` +
React), the viewer's own renderer existing, `data-ready` (structural frame) and
`data-equipped` (last equipment batch). All times end at renderer submission; they
exclude compositor presentation, display and pointer dispatch. Memory is CDP JS
heap without forced GC plus the OS working set of that run's Chrome processes,
sampled at 1 Hz and averaged over a 2.6 s idle hold at the save and equipped
milestones. Working sets include shared pages and a GPU process working set is not
dedicated VRAM.

| Demo | Cells | Modules | Save to first frame | Explode snapshot | Viewer built | Explode structure | Explode equipped |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Zoo | 14,066 | 4,299 | 4.71 / 4.49 s | 0.27 s | 2.42 s | 3.63 / 3.69 s | 4.93 / 5.28 s |
| Tanwei | 16,725 | 9,678 | 6.61 / 7.02 s | 0.34 s | 2.50 s | 3.82 / 4.18 s | 5.90 / 6.57 s |
| Tianhe Park | 151,852 | 76,436 | 16.97 / 17.05 s | 3.00 s | 10.13 s | 11.64 / 10.67 s | 26.37 / 23.66 s |

The exploded viewer is a second `SceneRenderer`: while it is open the editor
renders no frame and is torn down, which is why "viewer built" (10.1 s on
天河公园) is much larger than the snapshot it follows. These are single-run
diagnostics on one host, not percentiles.

| Demo | JS heap empty → save → explode | Renderer WS save / explode | GPU process WS save / explode | Editor draws / geometry / textures (save) | Exploded draws / geometry / textures (equipped) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Zoo | 83 → 250 → 158 MB | 1.98 / 1.44 GiB | 1.17 / 1.04 GiB | 3,526 / 4,282 / 2,665 | 1,517 / 1,416 / 231 |
| Tanwei | 56 → 564 → 190 MB | 2.79 / 1.73 GiB | 1.53 / 1.02 GiB | 5,145 / 5,675 / 4,475 | 2,251 / 2,082 / 271 |
| Tianhe Park | 83 → 776 → 468 MB | 5.04 / 2.90 GiB | 2.74 / 2.47 GiB | 5,272 / 10,884 / 6,157 | 7,766 / 7,191 / 947 |

The second run measured 281 / 355 / 774 MB at save; its Tanwei exploded sample
(508 MB JS heap, 3.21 GiB renderer working set) is an outlier of the no-forced-GC
and process-sampling boundaries. Editor triangles at save are
0.84 / 1.12 / 1.25 M; the exploded viewer draws all storeys at once, so it reaches
0.77 / 1.54 / 8.14 M. Textures, not geometry, drive the working sets: the editor
holds 2.7–6.2 k textures against the viewer's 231–947.

Cost attribution on the same build: 天河公园's save is 8.6 s of `scene.setStation`
(2.1 s `meshStation`, 5.1 s module models, 3.2 s level slicing including 2.7 s
batch sync) plus a first frame whose shader compile and texture upload dominate —
a mapped CPU profile of the same workflow put 1.8 s in `getProgramInfoLog` and
1.7 s in `texSubImage2D`. Zoo and Tanwei are the same shape an order smaller.
The exploded viewer's cost is its snapshot, the editor teardown plus the new
renderer, 0.2–2.9 s `setStation`, 0.1–0.6 s ramp sections, 0.5–2.2 s floor
layout, and then equipment streamed in 38–312 batches: 0.4–3.7 s of append work
spread over 1.3–14.7 s while the viewer also draws up to 8.1 M triangles.

### Deferred opening preparation

Two opening stages ran before the station was drawn and did not need to. Measured
by stubbing each on the same build (`BENCH_ABLATE=trains` / `buildViews`, diagnostic
only, older source): the bounded train fleet cost **1.6 / 3.0 / 4.9 s** of the
loading screen across Zoo / Tanwei / Tianhe, and the Q/E neighbour prewarm
**1.0 / 1.35 / 0.8 s**.

`SceneRenderer.setStation` now hands the fleet to `requestIdleCallback` with a
2 s timeout (`scheduleFleetPreparation`): the station opens paused, so no consist
can arrive first, and `setTrains` still builds one on demand. `Viewport` chains the
Q/E prewarm to the `onNextFrame` that dismisses the loading shell. The fleet
measurement moved with it — the same stage now starts at or just after the first
frame (4,718 ms against a 4,714 ms frame for Zoo; 16,973 against 16,970 for Tianhe)
and no longer appears inside `setStation`. A capture on this host with the change
reverted (an earlier tree revision, which also carries unrelated work in progress)
measured 6.82 / 10.44 / 23.79 s to the first frame, so only the moved stage is a
controlled comparison.

This is a move, not a removal: the deferred walks now block the main thread for
1.8–6.2 s immediately after the station appears. Keep that in the interaction
budget when measuring the first pan, edit or storey switch; the Q/E prewarm still
runs before any realistic keypress.

Remaining levers, in measured order: the first frame's shader compile (71–85
programs in the editor against 24 in the exploded viewer; parallel compilation is
untested); the editor's per-module printed textures (6,157 on 天河公园); and the
equipment streaming schedule, which yields after every batch.

## Exploded floor arrangement

Prepare geometry once per opening, reuse tray transforms and pose buffers. Drags
translate the selected group without extra picks, document commits or vertex
rewrites. Opening and dragging are different workloads. The snapshot measurement
below does not validate full viewer generation or the latest models.

Tianhe Park snapshot: 130,158 cells and 75,950 modules
(SHA-256 `fba82a60372be7bef50dac120239d37ecbd39d5c68dc40beefe2e1e4a3fe8e95`),
Windows / i7-14700KF / Node 24.15.0, source at `f604ef78` with the local
working tree. A Node CPU sample of five snapshot preparations identified
`packFloors` and its collision probes among the hot paths. Six alternating,
GC-before-sample runs after one warmup measured the string-key version at
522–664 ms (median 571 ms) and the numeric-key version at 348–486 ms (median 389 ms).
The guarded key implementation measured 330–399 ms (median 376 ms) in a
separate six-run capture. Reproduce the current snapshot-only measurement with
`node --expose-gc tools/bench-explode-snapshot.mjs <save.metro.json>`; these
numbers exclude parsing, WebGL, model building and the first rendered frame.
A full browser attempt on this machine exceeded the harness's 60-second CDP
limit before completing and did not yield a comparable viewer timing; do
not infer an end-to-end speedup from the snapshot result. Other applications
were running, so treat these as diagnostic measurements rather than a budget.

Full browser investigation of the same save: production build, Chrome
headless with hardware rendering requested, 1400 × 900 window (1384 × 690
canvas, pixel ratio 1), paused, default graphics quality. The fixture hash and
CPU are above. `node tools/bench-explode-generation.mjs <save.metro.json>` saves
stage timings and separate Chrome CPU profiles under `.preview/perf/explode-generation/`;
`BENCH_PROFILE=0` skips the explode CPU profile. Baseline unprofiled explode
(open action through ready plus two animation frames) was 166.3 s: `setStation`
58.0 s, of which `applyLevel` was 17.6 s; `enableExplodedLayout` 53.5 s; a
late artwork rebuild 19.7 s plus another 27.1 s visibility pass. These are
nested stage times, not additive independent measurements. A CPU-profiled capture
showed a large garbage-collector contribution. Diagnostic geometry counters before
instancing recorded 148,868 baked instances / 24.0m
vertices and 134,932 merge inputs; after retaining complete instances, 43,991
bakes / 16.0m vertices and 42,018 merge inputs remained.

The viewer skips equipment batches that its rigid trays immediately
hide, decodes the selected map before building, keeps whole instances in their
floor, and flushes temporary merge inputs at 131,072 vertices or 1,024 meshes.
The bounded-batch diagnostic run reached the rendered viewer in 39.7 s:
`setStation` 18.7 s (including 6.8 s modules, 9.0 s train preparation),
ramp sections 1.2 s, floor layout 11.2 s (4.5 s merge). Compare these captures as
diagnostic, not a controlled speedup: system load varied substantially (the regular
station build ranged from 15 to 27 s), tests overlapped one run's station
opening, and only one run of each build was captured. The timed explode runs
themselves did not overlap a build. GPU backend was requested, not independently
identified. Train preparation and first-frame GPU work remain material costs on
this save and this does not establish a latency target.
An unprofiled full-save browser check (`BENCH_STATION=<save> node tools/check-exploded-view.mjs`) (production source hash
`cde4b3477d52af1e828faca262d4b93975d198bd4d201425b2ae6d9499505f11`)
opened in 25.9 s and 54.7 s across two successive openings; the real-pointer
drag checks took 816 and 691 ms, including rendered feedback. Raw results and
screenshots: `.preview/perf/exploded-view/report.json` and
`station-arranged.png`. The second opening and interaction latency remain
performance gaps; the two observations are not a stable percentile.

Structure-first capture, same Tianhe save and Chrome 156 hardware requested,
1384 × 690 canvas. One unprofiled generation capture (source hash
`f82150dabd6114271db2040f46dba6c1c3eedb1784f36f687dc5ca97635ee755`)
reported **8.33 s** from open to the rendered and interactive structure,
and **23.30 s** to all equipment attached. Initial scene setup took 3.16 s,
ramp sections 0.71 s and structural layout 1.97 s. The browser benchmark reports
both `structureMs` and `equipmentMs`; raw capture in
`.preview/perf/explode-structure-first/report.json`. The separate 25.9/54.7 s
full-save openings measured a fully furnished viewer, so compare those with
equipment completion only as separate diagnostic runs under varying system load.
The first-frame metric measures the first-frame usability milestone.

### Exploded viewer memory, Tianhe Park

Chrome 156 headless with hardware requested, Windows, i7-14700KF,
1384 × 690 canvas, paused, the user save SHA-256
`fba82a60372be7bef50dac120239d37ecbd39d5c68dc40beefe2e1e4a3fe8e95`,
production source hash `25e3f0f460d5a4e203b29dac996bf99189ed19d90427e626195d14280e5f6a72`
(including the current uncommitted worktree). Process working sets sampled about
once per second within four seconds of each browser milestone; Chrome CDP heap
figures are immediate, without forced garbage collection. Values are GiB.

| Milestone | Renderer working set | GPU process working set | JS used heap | V8 backing storage |
| --- | ---: | ---: | ---: | ---: |
| Editor loaded, before explode | 5.51 | 3.66 | 1.23 | 2.53 |
| Structure ready | 5.76 | 4.20 | 1.00 | 2.87 |
| Equipment attached | 6.39 | 5.58 | 1.11 | 3.21 |

Structure was ready at 8.91 s and equipment attached at 25.38 s in this run.
The process working sets include all Chrome pages/processes associated with this
benchmark profile and shared pages can appear in multiple working sets. GPU
working set is not a direct measurement of dedicated GPU VRAM. CDP backing
storage includes ArrayBuffers and other backing allocations, not just geometry.
The non-monotonic used heap reflects normal garbage collection, not negative
allocation. The editor and exploded renderer coexist; the growth is consistent
with copied meshes, buffers and GPU resources, but these measurements do not
attribute retained bytes to specific object classes or establish release after
closing. Peak observed individual process working sets in an exploratory run
were 6.21 GiB renderer and 4.84 GiB GPU process. Reproduce with
`./tools/bench-explode-memory.ps1 <save.metro.json>` after a production build.
The benchmark writes milestone timestamps and CDP heap figures to
`.preview/perf/explode-memory/report.json`, and process samples to
`.preview/perf/explode-memory/processes.json`. Raw process samples: `.preview/perf/explode-memory-processes.json`.

### Exploded/editor renderer handoff

Windows, i7-14700KF, Chrome 156 headless with hardware requested,
1384 × 690 canvas, paused. A production build with source hash
`469e09ae2fee531fa6f28d81b724da20f1b70f2b402cc12ac8f1962555d74c42` and the
Tianhe save SHA-256
`724a40de061c6d9edfae938224a70124bf19fcb00d7ae613627a8e5e30a5252b` measured
renderer working sets of 5.11 GiB before opening, 3.19 GiB at structural ready,
3.14 GiB after equipment, and 5.96 GiB after returning to the rebuilt editor.
GPU process working sets at the same milestones were 3.65, 0.95, 2.18 and
3.87 GiB. CDP V8 backing storage was 2.38, 1.08, 1.39 and 3.10 GiB respectively
(the returned figure is before forced GC); after an explicit GC it was 2.62 GiB.
Chrome process samples are approximate and include shared pages, and GPU working
set is not dedicated VRAM. Structure-ready was 16.47 s, equipment completion
32.76 s, and returning to the rendered editor took 39.00 s in this one run.
The save hash differs from the memory-table capture above, so the two are not a
controlled before/after comparison. Source includes unrelated worktree changes.
Run `./tools/bench-explode-memory.ps1 <save.metro.json>` after a build to capture
milestones, return time, optional post-return GC and Chrome process samples;
raw files are under `.preview/perf/explode-memory/`.

## Collect comparable evidence

Keep source/build hash, fixture, hardware, GPU mode, quality, camera, canvas,
pixel ratio, sample count and timing boundary in raw reports. Never combine
profiled/clean runs or compare different scenes as a speedup. Preserve failures.
No fabricated V8 percentages.

### Repeatable editor action matrix

Keep `editorActionCases.ts` and its completeness test aligned with finite palette
settings. Complete unprofiled hardware captures update the matrix; focused runs
replace only matching cases. Incomplete, profiled and software-GPU captures must
not publish. Use `BENCH_MATRIX_UPDATE=0` for exploration.

天河公园 (tianhe) is the largest shipped example (151,852 cells, 76,436 modules).
Focused 1-sample guidepost captures on this host miss the strict 100 ms budget for
the structural actions — 537.10 ms place, 525.20 ms drop, 177.20 ms move-preview
and 547.90 ms delete — while preview (66.20 ms) and pickup (100.00 ms) sit close
to it. The edit cost is dominated by the `setStation` rebuild every document
commit performs (321–352 ms for place, 142–287 ms for drop), not by the piece
being edited. The measured rows live in
[editor-action-matrix.md](editor-action-matrix.md); they are this document's
cost, not a target for Zoo and Tanwei. This host's run-to-run spread on unchanged
code paths is large: the `pickup` row, which does ~1 ms of work, measured 79.70,
101.70 and 100.00 ms across sessions, and place/drop moved 478.30/292.20 →
537.10/525.20 while their measured stages stayed flat (`syncBatches` 113.0 →
131.5 ms for place and 4.9 → 5.3 ms for drop). Compare same-day paired captures,
never rows from different sessions, as a speedup.

#### Tianhe Park structural edits over one second

The November 8 Tianhe capture had 610 timings above 1,000 ms across 214
cases. Every row was a place, drop or delete. A matched two-sample
API-to-first-render comparison used the shipped 151,852-cell, 76,438-module
fixture on an i7-14700KF, RTX 4080 SUPER (ANGLE D3D11), headless Chrome 156,
High quality, 892 × 815 canvas at pixel ratio 1, paused. The following
values are the maximum of the two samples in milliseconds.

| Case | Place before → after | Drop before → after | Delete before → after |
| --- | ---: | ---: | ---: |
| Bridge | 1,604 → 681 | — | 1,085 → 513 |
| Exit | 1,140 → 632 | 1,202 → 622 | 1,105 → 513 |
| Escalator | 1,586 → 503 | 1,604 → 536 | 1,303 → 425 |
| Lift | 1,259 → 563 | — | 819 → 510 |
| Right-forward stair | 1,629 → 505 | 1,492 → 440 | 1,139 → 387 |
| Platform | 1,684 → 532 | — | 985 → 526 |
| Tunnel | 1,315 → 634 | — | 1,363 → 660 |

The authored-cell carve and thinning passes now query nearby runs in
document order, then apply the existing exact volume rules. Stair models read
their wall probes from the shared cell index. Rail validation and platform
edge derivation prepare only the needed courses. The renderer reuses the
prepared solid and finish indexes at unchanged coordinates and keeps paving
out of the equipment batch key. Compact worker messages send bounded
splices for large documents, applying them to the newest received snapshot
while the old simulation graph stays coherent until the next install.

The comparison cleared 500 ms in 16 of 34 individual structural samples.
Bridge and tunnel edits still have the largest remaining gaps. In the
slower bridge placement, synchronous commit work was 149 ms and the tools
and scene stages were 57 ms and 384 ms. The measurement ends at the first
matching render call and excludes pointer dispatch, compositor presentation
and GPU completion.

Reproduce from the repo root with `BENCH_DEMO=tianhe`, `BENCH_SAMPLES=2`
and `BENCH_CASE=stair-rightForward,escalator,exit,platform,bridge,lift,tunnel`
using `npm run bench:editor-actions -- --record-only`. The paired reports
are `.preview/perf/tianhe-structural-before/report.json` and
`.preview/perf/tianhe-structural-worker/report.json`. The latter overlays the
editor changes on the baseline source snapshot to exclude concurrent
renderer work. Both reports include their exact source, build and fixture hashes.

The one-sample sweep of all 214 affected cases is in
`.preview/perf/tianhe-structural-over-1s/report.json`. A separate two-sample
bridge follow-up reused tool and chunk preparation when an elevated deck and its
piers stayed inside the existing street window. Its compact rail occupancy
indexes preserve the first authored record at a duplicate coordinate and the
exact solid support rules. For the 128 m bridge, the sweep's 1,293 ms placement
became a 579 ms maximum in the follow-up
(`.preview/perf/tianhe-structural-bridges/report.json`).

The next focused runs removed repeated artwork lookups when the artwork
inputs stayed fixed, avoided temporary arrays for retained roots, and bounded
bridge support validation to one support scan plus local cell queries. The
64 m and 128 m bridge placements then took at most 324.2 and 315.1 ms,
respectively, across three samples
(`.preview/perf/tianhe-structural-piers/report.json`). The 1,158.2 ms
left-turn stair deletion from the broad sweep was at most 300.0 ms in the
three-sample artwork follow-up
(`.preview/perf/tianhe-structural-tail-after/report.json`).

The 93-case retest
(`.preview/perf/tianhe-structural-recheck/report.json`) revisited cases
with one-sample misses at 500 ms. Across the original 610 actions, the
latest measurements at that point had 560 below 500 ms and none above
one second. The median fell from 2,546 to 403 ms and the slowest row was
799.2 ms. The merged index uses the maximum of each action's latest
capture, which may have one, two or three samples. Individual timings
varied between runs.

A final focused capture reused individual ramp cuts when their exit landing
heights stayed fixed and skipped filtering authored cells for a tunnel that
removed none. Across the original 610 slow actions, the merged matrix now
has **564 below 500 ms**, 46 at or above 500 ms, and none above one second.
The median is 402.7 ms versus 2,545.5 ms in the original capture. The slowest
remaining row is 128 m tunnel placement at 864.5 ms, with its other two
samples at 603.5 and 605.6 ms. The isolated final report is
`.preview/perf/tianhe-structural-final-check/report.json`.

### Benchmark protocol

Build first; benchmark without concurrent builds, tests or profilers. API-to-render
and pointer-to-render are separate measurements. Use `BENCH_CANVAS_SIZE` and
`BENCH_PIXEL_RATIO` for playback reproductions. Keep artifacts tied to reports.

### Current validation routes

| Question | Command |
| --- | --- |
| Demo workflow | `npm run bench:usage-tour`; set `BENCH_DEMO=tianhe` for the third example |
| Pointer placement | `npm run bench:placement` |
| Action/settings matrix | `npm run bench:editor-actions` |
| Picking | `node tools/check-tool-picking.mjs` |
| Geometry snapping | `node tools/check-geometry-snapping.mjs` |
| Ramp fit | `node tools/check-ramp-fit.mjs` |
| Level switching | `node tools/bench-level-switch.mjs` |
| Presentation | `node tools/bench-settings-audit.mjs`, `node tools/check-city-styles.mjs` |
| Preview / LOD | `node tools/bench-preview-audit.mjs`, `node tools/check-preview-lod.mjs` |
| Equipment retention | `node tools/bench-tree-placement.mjs` |
| Exploded viewer | `node tools/check-exploded-view.mjs`, `npm run bench:explode` |
| Station opening + explode, per demo | `npm run bench:demo-load`; `BENCH_DEMOS=zoo`, `BENCH_ABLATE=trains\|buildViews`, `BENCH_PROFILE=1` |
| Playback tails | `npm run bench:sim-stalls` |
| Actual model counts | `node tools/model-triangle-inventory.mjs` |
| City-specific counts | Set `MODEL_CITY=<city>`, then run the inventory command |
| GPU batching / fallback | `node tools/check-render-batching.mjs`, also `--no-multi-draw` |
| Harness | `npm run check:perf-tools` |

### Unity local block edit managed stages

On 2026-11-16, commit `736a7b21422a2cec9a2f9031271ea0e60c884cad`, a managed probe alternated adding and deleting one explicit block at `(42, 37, −12)` in each generated demo save. It called the production `StationCellEdits.Apply`, `StationDocumentReader.Read`, `StationSimulationHost.StageInstall` and `CommitInstall`, passing each resulting normalized document into the next operation and checking the cell in the read-back index. The first add/delete pair warmed the path. Five samples per action remained. Each row reports medians in ms, with the range of per-operation sums.

| Demo (authored cells / modules) | Action | Patch | Read, normalize and index | Stage sim | Commit sim | Managed total (range) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Zoo (14,066 / 4,299) | Place | 121 | 1,207 | 393 | 0.2 | 1,740 (1,701–1,764) |
| Zoo | Delete | 119 | 1,204 | 410 | 0.2 | 1,736 (1,709–1,757) |
| Tanwei (16,725 / 9,678) | Place | 133 | 1,717 | 568 | 0.6 | 2,406 (2,282–2,678) |
| Tanwei | Delete | 143 | 1,672 | 615 | 0.5 | 2,515 (2,285–2,735) |
| Tianhe Park (151,852 / 76,438) | Place | 735 | 12,549 | 4,134 | 7.5 | 17,491 (16,561–18,134) |
| Tianhe Park | Delete | 1,275 | 11,952 | 2,821 | 7.9 | 16,420 (15,941–16,712) |

Run from repo root with `powershell -NoProfile -ExecutionPolicy Bypass -File tools/unity-parity/check-unity-compile.ps1 -OutSuffix BuildPerf29` then `dotnet run -c Release --project .preview/unity/plan29-managed-edit/EditStages.csproj > .preview/unity/plan29-managed-edit/results.json`. The harness and raw samples are in that scratch directory. It ran on Windows/i7-14700KF with .NET SDK 10.0.403 and the engine-free compile check's assemblies. The fixture SHA-256 values are `1be9b3a20804b0d0944ba361bc80f8c7ede8eef7b233767eecd92e2f2ca5194e` (Zoo), `620e8b459850f0d080127191eac41463dd913ffbd28b722ffd80489b11f368a4` (Tanwei) and `efc73693ef4606fe7df7ba7db93bbab2fa871ae7457fd83776b324ca2a63654e` (Tianhe).

Full document read/normalization/indexing was the largest sampled stage for each demo and action. The reader reparses and normalizes the complete save even for this one-cell delta. The simulation staging sample includes edit classification, full document projection, graph and service builds. This probe excludes pointer input, Unity view build and disposal, frame presentation, the bridge and React, and provides no Windows or WebGL player latency or web comparison. The live Editor reported `STATUS_PIPELINE_LOAD_PENDING`. The next player capture needs input-to-first-visible timing and per-stage markers, including the renderer groups, to measure the full pause and verify incremental installation.

#### Load-path reuse on the same probe (plan 29 §3)

The same probe, fixtures and machine were rerun after the local-edit load path stopped reparsing and re-serializing the whole station. `StationSaveCandidate` now exposes the normalized tree it already built, `StationSaveV1.Read` accepts a parsed envelope and hands its repaired state to the reader in place, the day repair receives only the four authored day keys instead of the whole envelope, the candidate takes the repaired module array without a second deep clone, the impact classification runs before view staging and is passed to the simulation host, and a committed cell release defers its ghost re-aim to one coalesced refresh on the next frame. Run `check-unity-compile.ps1 -OutSuffix Plan29d`/`Plan29e` and `dotnet run -c Release --project .preview/unity/plan29-after/EditStages.csproj`; raw samples are in `.preview/unity/plan29-after/results.json`. Five samples per action after the warm-up pair, same fixture hashes.

| Demo | Action | Patch | Read, normalize and index | Stage sim | Commit sim | Managed total (range) | Total vs. baseline |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Zoo | Place | 97 | 826 | 372 | 0.2 | 1,312 | −25% |
| Zoo | Delete | 71 | 916 | 357 | 0.2 | 1,374 | −21% |
| Tanwei | Place | 199 | 1,297 | 546 | 0.6 | 2,039 | −15% |
| Tanwei | Delete | 139 | 1,183 | 544 | 0.5 | 1,824 | −27% |
| Tianhe Park | Place | 833 | 8,964 | 4,185 | 6.8 | 14,148 | −19% |
| Tianhe Park | Delete | 1,079 | 7,922 | 3,920 | 5.9 | 13,217 | −24% |

The read stage is still the largest and the local edit still pays whole-document work: `StationCellEdits.Apply` parses and serializes the complete envelope for a surgical patch, and the grid/cell/line repairs take JSON text. The probe calls `StationSimulationHost.StageInstall` directly, so its stage sample still classifies internally; the coordinator path classifies first and passes the kind. These are engine-free managed numbers, not a pass threshold, and still exclude the view build, bridge payload/React adoption and every presented frame. Player capture remains blocked by the same `STATUS_PIPELINE_LOAD_PENDING` Editor, so the release-to-first-visible budget in `placement feedback` is unchanged and unmeasured here.

#### Managed spot check at the Plan 29 commit

At `6cceda189ed2f084472236a6aaed49d66e5ef48b`, the same Windows/i7-14700KF and .NET 10.0.403 probe repeated one block add and delete at `(42, 37, −12)` with the same Zoo and Tanwei fixture hashes above. The first pair warmed up and three samples per action remained. Values are medians in ms with the range of per-operation sums.

| Demo | Action | Patch | Read, normalize and index | Stage sim | Commit sim | Managed total (range) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Zoo | Place | 117 | 1,138 | 437 | 0.2 | 1,659 (1,635–1,738) |
| Zoo | Delete | 78 | 1,091 | 394 | 0.2 | 1,530 (1,529–1,563) |
| Tanwei | Place | 161 | 1,401 | 595 | 0.6 | 2,142 (2,074–2,299) |
| Tanwei | Delete | 232 | 1,473 | 647 | 0.6 | 2,362 (2,167–2,485) |

Reproduce from repo root with `powershell -NoProfile -ExecutionPolicy Bypass -File tools/unity-parity/check-unity-compile.ps1 -OutSuffix Plan30Audit` and `dotnet run -c Release --project .preview/unity/plan30-managed-edit/EditStages.csproj`. The scratch project contains the harness and `results.json`. The spot check establishes that full document read still dominates sampled managed work. It does not quantify a change from the previous run or include a fresh Tianhe sample. `StationLoadCoordinator.Install` still constructs and disposes the whole view for each successful edit. This run did not time those calls, the bridge or the first rendered frame. The live Editor again reported `STATUS_PIPELINE_LOAD_PENDING`.

#### Local edit install: full path vs. local path on the same probe (plan 30 §3/§5)

The reader now retains the parsed normalized envelope, and a whitelisted single block or module edit (and its inverse) installs from the committed typed document plus the patch instead of re-serializing and re-reading the whole save: `StationCellEdits.ApplyToEnvelope` / `StationModuleEdits.ApplyToEnvelope` patch a clone of the committed envelope tree, `StationLocalEdit.TryProject` projects only the records the patch touched (the cell repair's one ring around each written cell included), and `StationIndex.TryCreateIncremental` copies the previous lookups and applies a `StationIndexDelta`. On 2026-11-17 the engine-free probe ran both paths over the same fixtures in one process: `.preview/unity/plan30-local-edit/` alternated one explicit block place/delete at `(42, 37, −12)` and one bench add/remove, each action measured through the complete envelope path (`StationDocumentReader.Write` → `StationCellEdits.Apply` → `StationDocumentReader.Read`) and through the local path (`StationLocalEdit.TryPatchEnvelope` → `StationLocalEdit.TryProject`), then staged and committed both results through `StationSimulationHost`. Nine iterations per action; the first sample of each series is reported separately as cold-or-first and the rest are medians in ms with the range of the repeated samples.

| Demo (cells / modules) | Action | Path | History/`Write` | Patch | Read, normalize, index | Local install | Stage sim | Commit sim | Managed total (range) |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Zoo (14,066 / 4,299) | Place | full | 127 | 312 | 1,901 | — | 727 | 0.2 | 3,032 (2,485–3,246) |
| Zoo | Place | local | — | 129 (114–141) | — | 53.5 (41–64) | 635 | 0.2 | 820 (716–948) |
| Zoo | Delete | full | 148 | 330 | 2,031 | — | 749 | 0.3 | 3,263 (2,912–3,581) |
| Zoo | Delete | local | — | 126 (122–154) | — | 22.3 (21–28) | 751 | 0.3 | 899 (573–1,034) |
| Zoo | Add module | full | 109 | 152 | 1,397 | — | 655 | 0.3 | 2,347 (2,208–2,413) |
| Zoo | Add module | local | — | 125 (99–287) | — | 20.9 (17–53) | 592 | 0.3 | 828 (493–974) |
| Zoo | Remove module | full | 119 | 135 | 1,506 | — | 525 | 0.3 | 2,250 (2,231–2,454) |
| Zoo | Remove module | local | — | 120 (115–166) | — | 48.7 (17–63) | 707 | 0.3 | 845 (822–950) |
| Tanwei (16,725 / 9,678) | Place | full | 180 | 265 | 1,860 | — | 989 | 0.7 | 3,373 (3,045–3,555) |
| Tanwei | Place | local | — | 153 (143–202) | — | 29.4 (29–32) | 865 | 0.7 | 1,048 (774–1,295) |
| Tanwei | Delete | full | 157 | 170 | 2,052 | — | 843 | 0.6 | 3,211 (2,912–3,969) |
| Tanwei | Delete | local | — | 142 (121–416) | — | 28.0 (26–60) | 843 | 0.6 | 1,157 (998–1,319) |
| Tanwei | Add module | full | 260 | 277 | 2,322 | — | 986 | 0.6 | 3,810 (3,271–4,521) |
| Tanwei | Add module | local | — | 263 (144–474) | — | 43.2 (24–75) | 796 | 0.6 | 1,213 (791–1,632) |
| Tanwei | Remove module | full | 168 | 399 | 1,915 | — | 913 | 0.8 | 3,387 (3,160–3,842) |
| Tanwei | Remove module | local | — | 152 (138–153) | — | 28.1 (28–65) | 1,070 | 0.8 | 1,269 (1,229–1,274) |

The first sample of the Zoo place series is the only genuinely cold row: history/`Write` 182, patch 312, read 1,699, local patch 312, local install 82, stage 753 ms. Every repeated local row materializes the envelope text once (`Document.NormalizedJson`, the commit payload's own copy): median 9–31 ms.

The local patch is a deep clone of the committed envelope tree plus the surgical write, so it costs roughly a third of the full path's `Write` + text patch for one record; the local install (projection, the touched ring's cell repair, the incremental index and the one envelope materialization) is 21–53 ms on Zoo and 28–43 ms on Tanwei. The complete read/normalize/project/index stage disappears from the edit. The remaining measured cost is the simulation stage, unchanged by this work: it still projects the whole document, classifies the edit against the previous document and rebuilds the graph, so it is now 72–84% of the local managed chain. These are engine-free managed numbers from one process that also rebuilt a `StationIndex` and compared both documents 36 times, so the full-path totals here are slower than the 1,659/2,142 ms spot check above; compare within this table, not across runs.

Equivalence was asserted before each timing was accepted: all 36 comparisons produced an identical normalized envelope (only `savedAt` canonicalised), identical cell records in order, identical module records and ids, identical index lookups and the same index diagnostics, for both fixtures. The probe refuses to report unless every comparison matches.

Reproduce from repo root with `powershell -NoProfile -ExecutionPolicy Bypass -File .preview/unity/plan30-local-edit/run-probe.ps1`. It rebuilds `CheckCore` (`check-unity-compile.ps1 -OutSuffix LocalEdit`), builds `LocalEditStages.csproj` and runs it from the repo root, writing `results.json` and `results.err.txt` beside it. The App assembly the probe stages the simulation through comes from the last full check build (`acheckPlan30Audit`); that assembly is only used for `StationSimulationHost`, whose API this work does not change. Machine: Windows 10.0.26200, .NET 10.0.14, Intel64 Family 6 Model 183 (28 logical processors), Release. Fixture SHA-256 values are unchanged from the entries above: `1be9b3a20804b0d0944ba361bc80f8c7ede8eef7b233767eecd92e2f2ca5194e` (Zoo), `620e8b459850f0d080127191eac41463dd913ffbd28b722ffd80489b11f368a4` (Tanwei).

What is still whole-document on a local edit: `StationWorldView.Build` (every renderer still builds the whole station into a fresh world, and the transaction still disposes the previous one), `StationEditClassifier.Classify` and the simulation projection/graph build inside `StageInstall`, the commit payload (`BuildCommitPayload` serializes the whole normalized envelope and all 13 contributor snapshots), React's adoption of that payload, and `Save`, Open/New, resync, undo/redo and every fallback edit (line adds, rail/sign/road rewrites, a record a load-time repair owns, an off-grid record) which keep the complete envelope path. The local path itself is not yet wired to dirty `StationWorldView` chunks or module groups; that renderer half is the remaining step. The measured chain excludes pointer input, the view build and disposal, the bridge, React and every presented frame, and the live Editor still reports `STATUS_PIPELINE_LOAD_PENDING`, so the 100 ms first-visible budget is **not** claimed here.


### Unity Tianhe synthetic scale spike (unmatched workload)

On 2026-11-10, three serial runs of `node tools/unity-feasibility/measure-web.mjs .preview/unity/feasibility .preview/unity/feasibility/visible-run-N` exercised a Unity 6000.6.8f1 Web Release player built from the dirty `7ad810fe1867fc85c1fdae21571949fddd943ce8` checkout, Windows 11, i7-14700KF, RTX 4080 SUPER, headless Chrome 157, DPR 1, 1384 × 805 canvas. Reports and screenshots are under `.preview/unity/feasibility/visible-run-{1,2,3}/`; each records the source/artifact digests. The graph digest is `52003505ee5da485bc74a375eac3b58bd7741f2fe81f2d52a7a01e40b30593e2` and WASM digest `e3dea0af59c2bd84e540057e45d04325383f6680ab3a3bc305ea975dc0fc1b89`. A prior attempt against the older `web-release-final` artifact failed its visual check (zero blue pixels); it is not a valid measurement.

The spike uses the actual Tianhe graph (153,720 nodes, 1,172,121 edges), 943 synthetic servers, 5,171 original placeholder meshes, random adjacency walking and synthetic queues. At 1/4/16/64×, measured tick rates were approximately 0.90/4.10/16.09/64.04 per second in each 10-second phase; discrete 1× counts and the warm-up boundary limit the rate interpretation. Frame p95 was ~17 ms, and each first 1× phase included a 759–825 ms maximum frame and a browser long task of 762–829 ms near startup. The screenshot confirms visible placeholders, not the full station. Timer quantization produced 0–0.1 ms tick medians. These captures do **not** exercise TypeScript World, real routing, station geometry, matching camera/load, GPU completion or physical presentation. Chrome and viewport also differ from the TS baseline. Do not interpret this as a speedup or a passed parity/performance gate; matched traversal, queue and rendering workloads and startup-stall investigation remain open.

A subsequent Three.js synthetic counterpart uses the same graph bytes, agent count, queue capacity, pseudo-random adjacency and queue algorithm, six instancing batches, viewport/canvas and analogous orthographic camera. Three serial `node tools/unity-feasibility/measure-ts-web.mjs .preview/unity/feasibility/ts-matched-N` runs (N=1,2,3) on the same machine produced ~1.10/4.10/16.09/64.04 ticks/s and 16.8 ms frame p95 at 1/4/16/64×; median tick samples were 0–0.2 ms with browser timer quantization. Reports and screenshots are in `.preview/unity/feasibility/ts-matched-{1,2,3}/`, and the workload SHA-256 is `0cf63726c02fc645403cea0a7e6ae1c745128dbabf4ded9846d5b6ee8bb16056`. The initial import-map and favicon attempts failed, and a first camera orientation was corrected before these runs. The 1× phase counts differed (Unity nine measured ticks, TS eleven) and the accumulated queue counts consequently differ; Three.js and Unity use distinct lighting, mesh construction and frame scheduling. These are related synthetic scale checks, **not proven identical simulations or a comparison to the TS World baseline**. Do not infer an engine speedup or a full feasibility pass from them. A fixed-tick state parity check, matched station geometry and a controlled explanation of the Unity startup long task are still required.

A fixed-tick functional cross-check now uses the same synthetic graph and `Step` code: the Unity Editor invoked `Metro.Feasibility.Editor.CheckFixedTicks.Run` for 512 ticks in `.preview/unity/tianhe-feasibility-project`, writing `.preview/unity/feasibility/fixed-cs.json`; `node tools/unity-feasibility/check-fixed-ticks.mjs` passed and wrote `fixed-ts.json`. It asserts that the Node step function matches the browser workload source and compares SHA-256 of all agent nodes, agent queue assignments, queue contents, server heads, lengths and floating credits, plus counters. Both ended with 4,818 queued, 11,481 admitted and 6,663 completed. This validates fixed-step synthetic state for this fixture, not the TS World or equivalence of the timing windows, and does not eliminate the rendering and startup limitations above.

A separate sampled diagnostic, `node tools/unity-feasibility/profile-startup.mjs`, saved `.preview/unity/feasibility/startup-profile/startup.cpuprofile`. Its CPU samples attributed approximately 723 ms to `_emscripten_glGetProgramiv` and 40 ms to `_emscripten_glGetShaderiv` over the captured startup, consistent with a synchronous WebGL program/shader query during initialization. This profile was collected separately from the three timing runs and is evidence of a likely shader-program initialization stall, not proof of a particular GPU-side cause or a resolved user-facing budget. Preserve the 759–825 ms first-phase misses above; investigate shader warm-up/variant strategy and remeasure the full production workload before treating the startup gate as passed.

A material ablation rebuilt the same synthetic Unity workload with `-feasibilityShader unlit` and ran three serial `node tools/unity-feasibility/measure-web.mjs .preview/unity/feasibility .preview/unity/feasibility/unlit-run-N web-release-unlit` captures (N=1,2,3). The first 1× maximum frames were 390, 399 and 402 ms, with browser long tasks of 394, 403 and 406 ms near initialization; p95 stayed ~17 ms. The lit runs above were 759–825 ms, so the simpler shader materially reduced this synthetic startup cost, but every unlit run still exceeds the proposed 200 ms stall target. Reports and screenshots are `.preview/unity/feasibility/unlit-run-{1,2,3}/`; the Web data SHA-256 is `b532921ab8bb866ac77fd867217d38983e0b6b53e54cdaa58fcc117a661398b7`. Shader appearance differs and neither scene is a representative full station. An initial disposable-project build failed because a second copy of the editor class was present; the duplicate was disabled and the documented retry succeeded. Do not promote an unlit placeholder as a release fix or mark the startup gate passed.

### Zoo single-passenger gate proxy, cold versus warm

At dirty HEAD `7ad810fe1867fc85c1fdae21571949fddd943ce8`, the controlled Zoo `gate-243` fixture uses the actual TS World graph/A* path, seed 7654321, one passenger and seven explicit one-second click steps; ambient spawns are disabled. `node tools/unity-parity/check-zoo-gate.mjs .preview/unity/zoo-correctness-unlit .preview/unity/zoo-gate-unlit/web` and the corresponding `zoo-correctness-lit` command passed before timing: both engines queued on tick 3, served on tick 4, and finished on tick 7, matching positions, queue/lane/cooldown and wait counts. Viewport 1264 × 705, canvas 960 × 600 at the same position, DPR 1; proof screenshots are in those directories. This is a **proxy**: both sides render only simple cubes for Zoo solid cells and gates plus the original placeholder person; the C# runtime implements only this unobstructed single-passenger gate path and uses a TS-generated route. It is not the production TS station renderer or a full C# World.

A separate `node tools/unity-parity/profile-zoo-startup.mjs .preview/unity/zoo-gate-unlit/web .preview/unity/zoo-profile-unlit` capture wrote `startup.cpuprofile`; self-sample aggregation attributed ~461 ms to `_emscripten_glGetProgramiv` plus unsymbolized WASM work. It is a diagnostic, not a timed run or proof of one root cause. The two disposable Unity builds differed in their placeholder/material shader (URP Unlit versus Lit) with identical scene and fixture; reports retain their source and artifact hashes.

Three serial runs per build used `node tools/unity-parity/measure-zoo-proxy.mjs .preview/unity/zoo-gate-<unlit|lit>/web .preview/unity/zoo-perf-final-<unlit|lit>-N` for N=1,2,3, with the TS proxy then Unity proxy run sequentially. Unity unlit startup long tasks were 1,447/1,404/1,270 ms; lit were 1,758/1,984/1,902 ms. TypeScript startup long tasks in these runs were 314–363 ms. These are **cold startup**, not warmed interaction. After the readiness marker, two animation frames and three seconds of warm-up, no browser long task was recorded during the seven interactions. Across the runs the Unity pointer-down to C# acknowledgement ranged 1.8–22.8 ms and pointer-down to two subsequent animation frames ranged 34.8–50.7 ms; frame p95 was approximately 16.8–16.9 ms. Two-rAF timing is not physical presentation, seven samples are not a percentile, and the TS World does substantially more work per step than the C# slice, so do not infer a gameplay speedup or full-station budget pass. The proposed 200 ms interaction threshold applies after warm-up; the cold misses remain separately visible. A failed lit attempt due to a reused Chrome debugging port is retained in `.preview/unity/zoo-perf-lit-2/`; the final harness uses fresh ports. Raw evidence: `.preview/unity/zoo-perf-final-{unlit,lit}-{1,2,3}/`.

### Tianhe full-document proxy startup failure

At dirty HEAD `7ad810fe1867fc85c1fdae21571949fddd943ce8`, `node tools/unity-parity/check-tianhe-gate.mjs .preview/unity/tianhe-gate-correctness-retry` attempted the full normalized Tianhe save, simplified layer/gate geometry and 5,171 synthetic placeholder agents. Unity Web aborted with `OOM` while growing its WebAssembly heap; see `.preview/unity/tianhe-gate-correctness-retry/chrome-unity-29652.log` and `correctness-report.json`. The earlier `.preview/unity/tianhe-gate-correctness/` attempt also timed out. The TypeScript side completed seven gate interactions, but Unity produced no outcome or warm frame data. This is a cold-load failure, not an interaction-latency measurement, and no timing comparison or 200 ms gate result follows from it. The parser constructs and serializes several full JSON trees; investigate their peak allocations and preserve the existing cross-engine save/repair tests before reattempting. Build/input hashes and exact commands are in the handoff's Tianhe section.


#### Typed local classifier and prefab retention (November 17, 2026)
Working tree based on `a85bed54fffeb87d2aa7c446c1130403227d43ea`. The local path carries its parent read and `StationIndexDelta`; only a direct child of the committed read uses `ClassifyLocal`. It compares retained unknown-root trees and, for module-only patches, examines the changed records and ground window. TVMs, benches and other graph inputs remain structural. External envelopes retain the conservative full classifier.
Matched engine-free .NET 10 probe: add bin `retention-probe` at `(42,37,-12)`, width/depth 1, to each normalized demo without changing cells or lines. Alternate the full classifier and typed local classifier in the same process. Four iterations; first reported separately, remaining three summarized below. Timings include classification only. Allocations are current-thread bytes, without forced GC. The full comparison uses the same current typed record equality fast paths, so this isolates the full-envelope reparse and collection walk rather than claiming a historical binary comparison.
| Demo | Full first / repeat median (range), ms | Local first / repeat median (range), ms | Repeat allocated bytes, full / local |
| --- | ---: | ---: | ---: |
| zoo | 402.77 / 320.62 (262.95–328.96) | 2.37 / 0.88 (0.85–1.68) | 122,926,304 / 216 |
| tanwei | 471.12 / 302.15 (290.47–437.69) | 1.26 / 1.29 (1.20–1.34) | 164,519,624 / 216 |
| tianhe | 2340.65 / 2448.66 (1649.25–2947.95) | 13.53 / 13.71 (13.63–13.93) | 1,306,312,928 / 216 |

Fixture SHA-256 values: zoo `1be9b3a20804b0d0944ba361bc80f8c7ede8eef7b233767eecd92e2f2ca5194e`; tanwei `620e8b459850f0d080127191eac41463dd913ffbd28b722ffd80489b11f368a4`; tianhe `efc73693ef4606fe7df7ba7db93bbab2fa871ae7457fd83776b324ca2a63654e`.
Reproduce: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/unity-parity/check-unity-compile.ps1`, then `dotnet run -c Release --project .preview/unity/plan31-classification/Measure.csproj`. Harness and raw samples: `.preview/unity/plan31-classification/{Program.cs,results.json}`. Native CPU timeline scopes cover local envelope/projection boundaries through managed samples, classification, renderer families, simulation staging/commit, activation/disposal, visibility registration and commit payload construction. `StationEditTrace.Sample` is opt-in and does no timing/allocation sampling without a subscriber.
The view can now stage independent prefab-only bin/TVM/vending/bench/shelf/extinguisher edits in the existing world when the ground window is unchanged. It swaps only their records/views after simulation staging succeeds; cells, unrelated prefabs and artwork remain owned by that world. Other families, cell edits and ground-window changes keep the conservative full view path. The local inverse history path reaches the same furniture retention path.
Limits: this is not an input-to-present measurement or a <100 ms budget pass. Full envelope cloning/materialization, structural graph/service staging and the full commit transport remain. Dirty cell chunks, versioned background graph handover and the all-demo Windows/WebGL pointer-and-presentation matrix are still outstanding. The live Editor status capture `.preview/unity/editor/20261117-102638-status-81bdd9/run.json` reports `STATUS_PIPELINE_LOAD_PENDING`. Isolated rendered tests can run with `metro-unity.ps1 test -Graphics`; their pixel assertions prove highlight coverage/occlusion, not native input latency.

### Current block commit stages (November 17, 2026)

At `812118377bc023d0650a021b17d84fd51e82995f`, the typed local classifier is cheap for a one-block addition, but the document and graph stages still exceed the strict <100 ms interaction target. `StationWorldView.StageLocalModules` explicitly refuses cell deltas, so cells also retain full world rendering/install work outside the managed probe. The earlier full-classifier reparsing diagnosis does not describe the current local block classifier.

Engine-free .NET 10.0.14 probe on the shared Windows 11/i7-14700KF workstation: read each shipped demo, add one untagged solid at empty `(42,37,-12)` with `StationLocalEdit.TryApplyCells`, call the production `ClassifyLocal`, project the simulation document, build its complete walking graph and build service facts. Four iterations per fixture against the same immutable before-state; first separate, remaining three summarized. `CheckCore` and `CheckUnity` were rebuilt from this source with **Release / Optimize=true**, and the harness runs Release. Unity's generated projects hardcode the output directory `Temp/bin/Debug` even for this Release build. `metadata.json` records the settings and assembly hashes. Opt-in nested trace scopes collect stage allocations; their overlapping times are not added to the top-level subtotal. No forced GC or private full-envelope diagnostic runs occur between these stages.

| Demo | Local patch/projection median, ms | Local classifier median, ms | Simulation projection median, ms | Graph median, ms | Service facts median, ms | Disjoint stage subtotal median (range), ms | First subtotal, ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Zoo | 157.28 | 0.03 | 2.35 | 150.44 | 15.87 | 325.80 (287.68–343.13) | 669.96 |
| Tanwei | 171.01 | 0.04 | 2.53 | 281.45 | 2.28 | 457.14 (347.79–525.67) | 378.33 |
| Tianhe | 1239.71 | 0.03 | 17.17 | 1011.43 | 50.59 | 2916.46 (2195.31–3590.37) | 2849.11 |

Subtotal medians are medians of per-iteration sums, not sums of column medians. Nested `TryPatchEnvelope` (full clone plus writer) medians were 96.68 / 151.99 / 1020.38 ms, allocating 51.36 / 68.52 / 542.77 MiB for Zoo/Tanwei/Tianhe. Complete local patch/projection allocated 60.21 / 80.41 / 634.84 MiB; graph construction allocated 79.65 / 207.88 / 923.33 MiB. These identify remaining document-wide work and allocation pressure. Three repetitions are insufficient for stable percentiles, and shared desktop/Editor activity and GC account for substantial variability. An earlier Debug-assembly capture is retained as `stage-results.json`; it is not a matched engine comparison or a claimed optimization result.

This bypasses pointer validation and measures a low-level one-cell addition. It excludes planner/automatic-wall synchronization, Unity renderer construction, native mesh/GPU work, simulation commit actor reconciliation, visibility, old-world teardown, history publication, commit JSON transport and React adoption. It is neither a Windows/WebGL player latency measurement nor a numerical lower bound for a differently compiled Unity runtime. No native <100 ms pass is established. The live-editor status attempt `.preview/unity/editor/20261117-110016-status-e2fe00/run.json` still reports `STATUS_PIPELINE_LOAD_PENDING`; that prevented a fresh native pointer-to-present capture through the supported live harness.

Reproduce from the repository root:

```powershell
& tools/unity-parity/check-unity-compile.ps1 -OutSuffix Plan32
dotnet build unity/Temp/acheckPlan32/CheckUnity.csproj -c Release -v q --nologo
dotnet run -c Release --project .preview/unity/plan32-review/Review.csproj
```

Raw evidence: `.preview/unity/plan32-review/{Program.cs,Review.csproj,release-stage-results.json,release-stage-results.err.txt,metadata.json,release-compile.log}`. Core SHA-256: `ad12d7feac52b9bbb698482cd8b7c18a14a516babb945121ee479d737fd71d81`; App/View SHA-256: `b14c1548cea7535f6c9bcda7136c26b792b8065bebf5a9579b47907a0a3fedce`. Fixture hashes remain Zoo `1be9b3a20804b0d0944ba361bc80f8c7ede8eef7b233767eecd92e2f2ca5194e`, Tanwei `620e8b459850f0d080127191eac41463dd913ffbd28b722ffd80489b11f368a4`, Tianhe `efc73693ef4606fe7df7ba7db93bbab2fa871ae7457fd83776b324ca2a63654e`.

The ordinary-block completion gate is release→authoritative commit **and** release→first rendered committed revision strictly <100 ms, including first use, repeated edits and undo/redo. A ghost, acknowledgement, postponed main-thread rebuild or stale simulation topology does not pass. Retained cell chunks, bounded record/index updates, structural graph/service deltas and a local commit transport remain necessary work; the native all-demo pointer matrix must verify their result.

#### Automatic-wall deletion planning (November 17, 2026)

After the ownership fix, a matched managed probe compared copying the full solid coverage set with looking up coverage through the pending adds/removals and retained solid/track facts. Same workstation and shipped fixtures as above. Each case built its world first, then planned the same single-cell deletion 12 times without applying it. Both versions emitted five writes for Zoo `(48,5,-15)` and three for Tanwei `(-51,1,12)`. Tianhe had no tracked floor for this probe. The Unity-generated assemblies used Debug configuration in both variants.

| Demo | Copied coverage first / repeat median, ms | Effective coverage first / repeat median, ms | Repeat median allocated bytes, copied / effective |
| --- | ---: | ---: | ---: |
| Zoo | 60.71 / 1.13 | 48.25 / 1.08 | 621,048 / 200,608 |
| Tanwei | 0.46 / 0.58 | 0.42 / 0.26 | 1,295,000 / 1,904 |

The first Zoo iteration also includes managed first-call and lazy opening/equipment work. The measurements exclude pointer input, world preparation, preview drawing, commit, transport and rendering. Raw samples and the probe are in `.preview/unity/plan32-implementation/planner-measure/`. The commands were `check-unity-compile.ps1 -OutSuffix plan32` for copied coverage and `-OutSuffix plan32Final` for effective coverage, then `dotnet run --project .preview/unity/plan32-implementation/planner-measure/Planner.csproj` with the corresponding assembly references. The intended comparison is allocation within the planner, and the isolated timings do not establish an interaction budget pass.

The opt-in `StationEditProfiling.CommitSample` reports native command receipt through authoritative commit, reply serialization, publication and the first completed station-camera render for a matching revision. It also reports when a revision is superseded before rendering. The clock starts after native command decoding and the render callback measures Unity camera completion. Browser input transit, pixel presentation, React adoption and the Windows/WebGL acceptance matrix still need measurements.
