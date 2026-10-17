# Performance work in metro

## Reproduce the reported interaction

Measure the actual event sequence before choosing an optimization. For a drag,
separate hover, pointer-down, first movement, continued movement, release and
cancel. Compare the first invocation with warmed repetitions. A smooth steady
drag can hide a long initialization stall; placement-helper timings alone do not
measure the pointer handler or the first rendered frame.

Use the supplied station through `BENCH_STATION` without replacing the shipped
demo. `node tools/bench-stair-drag.mjs` drives real browser input and counts
raycasts on initial stair-block pickup. `bench:sim` measures CPU helpers and
simulation; `bench:browser` measures the app, worker and rendered frames.

Record work counts alongside time: raycasts per event, graph/model rebuilds,
allocations, uploads and cache hits. The stair-block regression came from
`modules.find(m => m.id === pickModule(...))`: a miss repeated a full scene
raycast for every document entry. Pick once, then find the document entry by ID.
Test both a miss and a hit near the end of a realistically large module list.

## Keep interactive work bounded

- Hoist event-invariant queries out of loops and predicates. Reuse the hit,
  camera aim and document indexes throughout the event.
- Keep previews out of undo/commit and worker routing paths. Stair-block previews
  are explicitly visual-only; validate on release and commit the accepted run
  once. Other tools retain their existing preview/refusal agreement unless a
  behavior change is authorized.
- Coalesce replaceable pointer previews per frame; flush before release and
  cancel stale callbacks on cancellation, tool changes or unmount. Preserve all
  samples for deletion sweeps and touch gestures that depend on the path.
- Retain unaffected geometry and GPU allocations. Move pickup/cancel masks the
  lifted piece and restores neighbours without rebuilding the station.
- Key prepared data by immutable document inputs and test invalidation. Bound
  caches that retain GPU resources and verify disposal on eviction and teardown.
- Preserve picking IDs, storey visibility, material ownership, animation and
  geometry. Hidden drawing must not change simulation ticks, RNG, train dispatch,
  routes or passenger identity.

## Collect comparable evidence

Run benchmarks sequentially, without builds, tests or other profilers competing
for the host. Use distinct `BENCH_OUTPUT` paths for baseline, final and profiled
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

### Per-model geometry detail inventory

Triangle counts below are for one model built from each palette option's default configuration. High is the full model geometry; Low uses the renderer's reduced geometry wherever that model part has a supported approximation, and keeps unsupported parts at full detail. These are model triangles, not totals across all placed copies. Width, length, style and material controls can create additional variants; the table lists the 117 shipped palette options.

Regenerate with `node tools/model-triangle-inventory.mjs`; the JSON and Markdown
table go to ignored `.preview/perf/model-triangles.{json,md}`. The authored Low
variants remove shelf stock, cubicle interiors and fine hardware; keep simplified
sink/CCTV/AC silhouettes, track sleepers/rails, ramp bands, lift doors and stair
surfaces. Source picks and rigs stay exact. `model-detail` guards per-model triangle
budgets, batching, restoration, finish colours and disposal. Update this table and
`game/PERFORMANCE.md` together after changing models or the detail policy.

Tree far/Low uses sparse, enlarged intact crossed leaf cards and a continuous six-sided trunk;
retain canopy extrema and valid leaf UVs when rebaking with
`node tools/bake-street-tree-lod.mjs`. Clock Low retains two readable hour-marked
faces and moving hands, using flat marks/hands and a twelve-sided case.

Furniture/cabinets omit stock and fine fittings; vending drinks become thin colour
panels. Fences use four-sided tubes without clamps/feet fittings. Fare gates retain
reader/entry artwork and animated leaves. Exit Low retains openings, printed
headers and the wave profile, with thin roof/glass surfaces and fewer frame posts.
`panelModelDetail` retains two broad faces; approximation bounds include both full
and reduced shapes so combined fittings do not disappear at the screen edge.

Rail-signal Low keeps three eight-sided aspects/rims and coarse hood shells.
Noise barriers retain full posts and all bay/gantry cutouts, using two broad faces
per thin panel/middle rail. Top beams retain thickness with hidden end caps omitted;
the shared bridge builders also prepare these Low variants.

| Equipment / decor model name | Low triangles | High triangles |
|---|---:|---:|
| tree | 396 | 18432 |
| shelf-cooler | 420 | 9852 |
| shelf-cooler-dark | 420 | 9852 |
| bridge | 732 | 9588 |
| shelf-white-tall | 240 | 7556 |
| shelf-dark-tall | 240 | 7244 |
| shelf-wire | 412 | 6524 |
| cubicle | 84 | 5688 |
| cctv-dome | 360 | 5208 |
| walkway | 496 | 5162 |
| sink | 224 | 4972 |
| cctv-ptz | 332 | 4924 |
| shelf-white-short | 192 | 4420 |
| escalator | 394 | 3122 |
| ac-unit | 140 | 2924 |
| stair-leftForward | 1016 | 2192 |
| stair-rightForward | 1016 | 2192 |
| stair-left180 | 968 | 2144 |
| stair-right180 | 968 | 2144 |
| stair-centerForward | 920 | 2096 |
| stair-left90 | 920 | 2096 |
| stair-right90 | 920 | 2096 |
| clock | 212 | 1940 |
| cctv | 124 | 1888 |
| stair-straight | 620 | 1796 |
| lift | 468 | 1488 |
| electrical-cabinet | 36 | 1224 |
| extinguisher-glass | 134 | 918 |
| exit-covered-1 | 346 | 902 |
| exit | 346 | 902 |
| exit-covered-3 | 346 | 902 |
| tactile-warning | 12 | 812 |
| fence-iron | 256 | 768 |
| checkout | 104 | 750 |
| gate-new | 130 | 720 |
| rail-signal | 144 | 708 |
| vending | 200 | 676 |
| gate | 162 | 668 |
| desk | 212 | 652 |
| pillar-thick | 576 | 576 |
| exit-uncovered-2 | 150 | 554 |
| exit-uncovered-3 | 150 | 554 |
| exit-uncovered-1 | 150 | 530 |
| fence-gate | 100 | 432 |
| roof-tapered | 396 | 396 |
| tvm | 372 | 372 |
| busstop-long | 372 | 372 |
| fence | 68 | 360 |
| door-steel-1 | 324 | 324 |
| door-glass-1 | 324 | 324 |
| roof-truss | 264 | 264 |
| busstop-short | 260 | 260 |
| light-circular | 256 | 256 |
| monitor-wall | 213 | 213 |
| lawn | 12 | 204 |
| bin | 196 | 196 |
| vent | 168 | 168 |
| bench-seat-1 | 156 | 156 |
| extinguisher | 50 | 146 |
| extinguisher-compact | 50 | 146 |
| door-wood-1 | 144 | 144 |
| sidewalk | 12 | 132 |
| tv | 114 | 114 |
| noise-barrier | 52 | 108 |
| noise-barrier-half | 52 | 108 |
| traffic-light | 108 | 108 |
| bench-steel-1 | 84 | 84 |
| sign-ceiling | 74 | 74 |
| monitor-ceiling | 72 | 72 |
| tactile-guide | 60 | 60 |
| guidepost | 60 | 60 |
| curtain-wall | 60 | 60 |
| glass-1x1 | 60 | 60 |
| glass-2x1 | 60 | 60 |
| glass-3x1 | 60 | 60 |
| glass-1x2 | 60 | 60 |
| glass-2x2 | 60 | 60 |
| glass-3x2 | 60 | 60 |
| exit-virtual | 46 | 60 |
| psd-end | 58 | 58 |
| road | 50 | 50 |
| stair-block | 34 | 48 |
| billboard-wide | 40 | 40 |
| billboard-standard | 40 | 40 |
| billboard-large | 40 | 40 |
| billboard-panorama | 40 | 40 |
| billboard-portrait | 40 | 40 |
| billboard-square | 40 | 40 |
| linemap-stand | 40 | 40 |
| hanger-roof | 36 | 36 |
| hanger-post | 36 | 36 |
| pillar-slim | 36 | 36 |
| linemap-wall | 26 | 26 |
| exit-doorway-1 | 10 | 26 |
| exit-doorway-2 | 10 | 26 |
| exit-doorway-3 | 10 | 26 |
| exit-doorway-4 | 10 | 26 |
| roof-shell | 24 | 24 |
| noise-barrier-railing | 16 | 24 |
| light-rectangular | 24 | 24 |
| roof | 12 | 12 |
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

### Train models (车辆)

One row per consist the game can build (`buildTrain`) at each formation its stock
class allows; model triangles for one train, not totals across services. Trains have
no Low/detail approximation, so Low is `none` for every row — each consist renders at
full detail. Counts include both cabs, gangways, the rideable cabin interior, bogies
and the closed door leaves (open/closed poses submit the same triangles).

| Train model | Low triangles | High triangles |
|---|---:|---:|
| D-8 | none | 1061168 |
| A-8 | none | 228512 |
| A-6 | none | 178592 |
| B-6 | none | 156320 |
| C-6 | none | 156320 |
| L-6 | none | 136496 |
| B-4 | none | 113824 |
| C-4 | none | 113824 |
| L-4 | none | 100608 |

D is the Guangzhou 18/22 reference and the outlier: its streamlined cab uses
64×128-segment surfaces and curved-shell patches, about 6–8× the other classes. The
shipped 动物园 Line 5 runs **L-6**. Regenerate with the one-off audit
`.preview/perf/train-triangle-audit.mjs` (ignored scratch), which builds each consist
through the real `buildTrain` and sums mesh triangles; door leaves are registered
door rigs, so animation never changes these counts.

### Passenger models (乘客)

One row per reviewed appearance in the baked crowd atlas
(`game/src/assets/passenger-approved.json`, drawn as a single instanced draw — no
per-agent GLB or skeleton). Passengers have no Low/detail approximation, so Low is
`none`. Counts are the `triangles` the atlas `library` records for each variant, not
PASSENGERS.md's "padded to 9,370 triangles per passenger" claim, which is stale:
9,370 is only the largest single variant (the shared topology array size).

| Passenger model | Low triangles | High triangles |
|---|---:|---:|
| male-original-bag | none | 9370 |
| male-short-bag | none | 9314 |
| male-bald-bag | none | 9296 |
| male-short-small-bag | none | 8872 |
| male-short-standard-87.5-bag | none | 8867 |
| male-bald-small-bag | none | 8854 |
| male-bald-standard-87.5-bag | none | 8849 |
| male-short-standard-75-bag | none | 8832 |
| male-bald-standard-75-bag | none | 8814 |
| male-side-part-bag | none | 8772 |
| male-quiff-bag | none | 8772 |
| male-swept-bag | none | 8752 |
| male-crop-bag | none | 8673 |
| female-rounded-bob-bag | none | 8636 |
| female-lob-bag | none | 8594 |
| female-bob-bag | none | 8584 |
| female-angled-bob-bag | none | 8582 |
| female-side-part-bob-bag | none | 8580 |
| female-shoulder-bag | none | 8579 |
| female-shoulder-swept-bag | none | 8579 |
| female-cropped-bob-bag | none | 8578 |
| male-crew-bag | none | 8569 |
| male-buzz-bag | none | 8526 |
| male-rounded-bag | none | 8524 |
| male-original-small-bag | none | 8425 |
| male-original-standard-87.5-bag | none | 8409 |
| male-original-standard-75-bag | none | 8389 |
| male-side-part-small-bag | none | 8363 |
| male-quiff-small-bag | none | 8363 |
| male-side-part-standard-87.5-bag | none | 8347 |
| male-quiff-standard-87.5-bag | none | 8347 |
| male-swept-small-bag | none | 8343 |
| male-swept-standard-87.5-bag | none | 8327 |
| male-side-part-standard-75-bag | none | 8327 |
| male-quiff-standard-75-bag | none | 8327 |
| male-swept-standard-75-bag | none | 8307 |
| female-rounded-bob-small-bag | none | 8269 |
| male-crop-small-bag | none | 8264 |
| male-crop-standard-87.5-bag | none | 8248 |
| female-rounded-bob-standard-87.5-bag | none | 8241 |
| female-rounded-bob-standard-75-bag | none | 8235 |
| male-crop-standard-75-bag | none | 8228 |
| female-lob-small-bag | none | 8227 |
| female-bob-small-bag | none | 8217 |
| female-angled-bob-small-bag | none | 8215 |
| female-side-part-bob-small-bag | none | 8213 |
| female-shoulder-small-bag | none | 8212 |
| female-shoulder-swept-small-bag | none | 8212 |
| female-cropped-bob-small-bag | none | 8211 |
| female-lob-standard-87.5-bag | none | 8199 |
| female-lob-standard-75-bag | none | 8193 |
| female-bob-standard-87.5-bag | none | 8189 |
| female-angled-bob-standard-87.5-bag | none | 8187 |
| female-side-part-bob-standard-87.5-bag | none | 8185 |
| female-shoulder-standard-87.5-bag | none | 8184 |
| female-shoulder-swept-standard-87.5-bag | none | 8184 |
| female-cropped-bob-standard-87.5-bag | none | 8183 |
| female-bob-standard-75-bag | none | 8183 |
| female-angled-bob-standard-75-bag | none | 8181 |
| female-side-part-bob-standard-75-bag | none | 8179 |
| female-shoulder-standard-75-bag | none | 8178 |
| female-shoulder-swept-standard-75-bag | none | 8178 |
| female-cropped-bob-standard-75-bag | none | 8177 |
| male-crew-small-bag | none | 8160 |
| male-crew-standard-87.5-bag | none | 8144 |
| male-crew-standard-75-bag | none | 8124 |
| male-buzz-small-bag | none | 8117 |
| male-rounded-small-bag | none | 8115 |
| male-buzz-standard-87.5-bag | none | 8101 |
| male-rounded-standard-87.5-bag | none | 8099 |
| male-buzz-standard-75-bag | none | 8081 |
| male-rounded-standard-75-bag | none | 8079 |
| female-midi-pleated-swapped-no-bag | none | 5832 |
| female-long-a-line-swapped-no-bag | none | 5806 |
| female-long-pleated-swapped-no-bag | none | 5805 |
| female-midi-pleated-no-bag | none | 5802 |
| female-midi-a-line-swapped-no-bag | none | 5785 |
| female-long-a-line-no-bag | none | 5775 |
| female-long-pleated-no-bag | none | 5775 |
| female-midi-a-line-no-bag | none | 5773 |
| female-full-pleated-swapped-no-bag | none | 5771 |
| female-full-pleated-no-bag | none | 5770 |
| female-slim-long-skirt-no-bag | none | 5749 |
| female-slim-long-skirt-swapped-no-bag | none | 5718 |
| male-short-crossbody-right-bag | none | 5071 |
| male-short-crossbody-left-bag | none | 5070 |
| male-bald-crossbody-right-bag | none | 5053 |
| male-bald-crossbody-left-bag | none | 5052 |
| male-short-shoulder-right-bag | none | 4764 |
| male-short-shoulder-left-bag | none | 4762 |
| male-bald-shoulder-right-bag | none | 4746 |
| male-bald-shoulder-left-bag | none | 4744 |
| male-short-no-bag | none | 4705 |
| male-bald-no-bag | none | 4687 |
| male-original-crossbody-right-bag | none | 4650 |
| male-original-crossbody-left-bag | none | 4649 |
| female-long-swept-crossbody-right-bag | none | 4612 |
| female-long-swept-crossbody-left-bag | none | 4611 |
| female-long-crossbody-right-bag | none | 4605 |
| female-long-crossbody-left-bag | none | 4604 |
| male-side-part-crossbody-right-bag | none | 4588 |
| male-quiff-crossbody-right-bag | none | 4588 |
| male-side-part-crossbody-left-bag | none | 4587 |
| male-quiff-crossbody-left-bag | none | 4587 |
| male-swept-crossbody-right-bag | none | 4568 |
| male-swept-crossbody-left-bag | none | 4567 |
| male-crop-crossbody-right-bag | none | 4489 |
| male-crop-crossbody-left-bag | none | 4488 |
| female-rounded-bob-crossbody-right-bag | none | 4482 |
| female-rounded-bob-crossbody-left-bag | none | 4481 |
| female-lob-crossbody-right-bag | none | 4440 |
| female-lob-crossbody-left-bag | none | 4439 |
| female-bob-crossbody-right-bag | none | 4430 |
| female-bob-crossbody-left-bag | none | 4429 |
| female-angled-bob-crossbody-right-bag | none | 4428 |
| female-angled-bob-crossbody-left-bag | none | 4427 |
| female-side-part-bob-crossbody-right-bag | none | 4426 |
| female-side-part-bob-crossbody-left-bag | none | 4425 |
| female-shoulder-crossbody-right-bag | none | 4425 |
| female-shoulder-swept-crossbody-right-bag | none | 4425 |
| female-shoulder-crossbody-left-bag | none | 4424 |
| female-shoulder-swept-crossbody-left-bag | none | 4424 |
| female-cropped-bob-crossbody-right-bag | none | 4424 |
| female-cropped-bob-crossbody-left-bag | none | 4423 |
| male-crew-crossbody-right-bag | none | 4385 |
| male-crew-crossbody-left-bag | none | 4384 |
| male-buzz-crossbody-right-bag | none | 4342 |
| male-original-shoulder-right-bag | none | 4341 |
| male-buzz-crossbody-left-bag | none | 4341 |
| male-rounded-crossbody-right-bag | none | 4340 |
| female-long-swept-purse-left-bag | none | 4340 |
| female-long-swept-purse-right-bag | none | 4340 |
| male-original-shoulder-left-bag | none | 4339 |
| male-rounded-crossbody-left-bag | none | 4339 |
| female-long-purse-left-bag | none | 4333 |
| female-long-purse-right-bag | none | 4333 |
| female-long-swept-shoulder-right-bag | none | 4318 |
| female-long-swept-shoulder-left-bag | none | 4316 |
| female-long-shoulder-right-bag | none | 4311 |
| female-long-shoulder-left-bag | none | 4309 |
| male-short-straight-no-bag | none | 4294 |
| male-short-straight-swapped-no-bag | none | 4292 |
| male-crew-straight-no-bag | none | 4285 |
| male-relaxed-straight-swapped-no-bag | none | 4281 |
| male-side-part-shoulder-right-bag | none | 4279 |
| male-quiff-shoulder-right-bag | none | 4279 |
| male-side-part-shoulder-left-bag | none | 4277 |
| male-quiff-shoulder-left-bag | none | 4277 |
| male-relaxed-straight-no-bag | none | 4277 |
| male-fitted-straight-no-bag | none | 4268 |
| male-original-no-bag | none | 4262 |
| male-crew-straight-swapped-no-bag | none | 4262 |
| male-swept-shoulder-right-bag | none | 4259 |
| male-swept-shoulder-left-bag | none | 4257 |
| female-long-swept-no-bag | none | 4231 |
| female-long-no-bag | none | 4224 |
| male-fitted-straight-swapped-no-bag | none | 4224 |
| male-short-wide-no-bag | none | 4217 |
| male-relaxed-wide-swapped-no-bag | none | 4215 |
| female-rounded-bob-purse-left-bag | none | 4210 |
| female-rounded-bob-purse-right-bag | none | 4210 |
| male-relaxed-wide-no-bag | none | 4209 |
| male-long-relaxed-no-bag | none | 4205 |
| male-side-part-no-bag | none | 4200 |
| male-quiff-no-bag | none | 4200 |
| female-rounded-bob-shoulder-right-bag | none | 4188 |
| female-rounded-bob-shoulder-left-bag | none | 4186 |
| male-swept-no-bag | none | 4180 |
| male-crop-shoulder-right-bag | none | 4180 |
| male-short-wide-swapped-no-bag | none | 4179 |
| male-crop-shoulder-left-bag | none | 4178 |
| female-lob-purse-left-bag | none | 4168 |
| female-lob-purse-right-bag | none | 4168 |
| female-bob-purse-left-bag | none | 4158 |
| female-bob-purse-right-bag | none | 4158 |
| female-angled-bob-purse-left-bag | none | 4156 |
| female-angled-bob-purse-right-bag | none | 4156 |
| female-side-part-bob-purse-left-bag | none | 4154 |
| female-side-part-bob-purse-right-bag | none | 4154 |
| female-shoulder-purse-left-bag | none | 4153 |
| female-shoulder-swept-purse-left-bag | none | 4153 |
| female-shoulder-purse-right-bag | none | 4153 |
| female-shoulder-swept-purse-right-bag | none | 4153 |
| female-cropped-bob-purse-left-bag | none | 4152 |
| female-cropped-bob-purse-right-bag | none | 4152 |
| male-crew-tapered-swapped-no-bag | none | 4152 |
| female-lob-shoulder-right-bag | none | 4146 |
| female-lob-shoulder-left-bag | none | 4144 |
| male-crew-tapered-no-bag | none | 4144 |
| male-long-relaxed-swapped-no-bag | none | 4144 |
| female-bob-shoulder-right-bag | none | 4136 |
| female-bob-shoulder-left-bag | none | 4134 |
| female-angled-bob-shoulder-right-bag | none | 4134 |
| female-angled-bob-shoulder-left-bag | none | 4132 |
| female-side-part-bob-shoulder-right-bag | none | 4132 |
| male-fitted-tapered-no-bag | none | 4132 |
| female-shoulder-shoulder-right-bag | none | 4131 |
| female-shoulder-swept-shoulder-right-bag | none | 4131 |
| female-side-part-bob-shoulder-left-bag | none | 4130 |
| female-cropped-bob-shoulder-right-bag | none | 4130 |
| female-shoulder-shoulder-left-bag | none | 4129 |
| female-shoulder-swept-shoulder-left-bag | none | 4129 |
| female-cropped-bob-shoulder-left-bag | none | 4128 |
| male-fitted-tapered-swapped-no-bag | none | 4128 |
| male-long-tapered-no-bag | none | 4105 |
| male-crop-no-bag | none | 4101 |
| female-rounded-bob-no-bag | none | 4101 |
| male-long-tapered-swapped-no-bag | none | 4089 |
| male-crew-shoulder-right-bag | none | 4076 |
| male-crew-shoulder-left-bag | none | 4074 |
| female-lob-no-bag | none | 4059 |
| female-bob-no-bag | none | 4049 |
| female-angled-bob-no-bag | none | 4047 |
| female-side-part-bob-no-bag | none | 4045 |
| female-shoulder-no-bag | none | 4044 |
| female-shoulder-swept-no-bag | none | 4044 |
| female-cropped-bob-no-bag | none | 4043 |
| female-straight-trousers-no-bag | none | 4040 |
| female-straight-trousers-swapped-no-bag | none | 4034 |
| male-buzz-shoulder-right-bag | none | 4033 |
| male-buzz-shoulder-left-bag | none | 4031 |
| male-rounded-shoulder-right-bag | none | 4031 |
| male-rounded-shoulder-left-bag | none | 4029 |
| male-crew-no-bag | none | 3997 |
| female-wide-trousers-swapped-no-bag | none | 3976 |
| female-wide-trousers-no-bag | none | 3960 |
| male-buzz-no-bag | none | 3954 |
| male-rounded-no-bag | none | 3952 |
| female-relaxed-trousers-no-bag | none | 3921 |
| female-relaxed-trousers-swapped-no-bag | none | 3900 |
| female-tapered-trousers-swapped-no-bag | none | 3830 |
| female-tapered-trousers-no-bag | none | 3821 |

Across all 232 variants the atlas references 1,308,230 triangles over a shared pool
of 226,731 animated vertices (73 pose frames, 21 palette stops); per-variant topology
(2,450–7,279 vertices) deduplicates by matching colour, position and normal in every
pose. `passenger-library` pins the eligibility pools and topology budgets, and the
atlas `library` array is the authoritative per-variant record.

## Guard the cause and verify the result

Prefer deterministic assertions about work and correctness: one scene pick per
press, no preview commit, one release commit, retained allocation identity,
cache invalidation, bounded dormant entries and exact disposal. Do not use FPS or
wall-clock thresholds in Node tests. Retain placement, route and geometry checks
so an apparent speedup cannot come from missing work or invisible content.

Run focused regressions and `npm run test:perf` for source coverage. Inspect the
changed files' line/function/branch results; imported files inflate totals, and
Node coverage does not prove GPU behavior. Run the full game suite and production
build before committing implementation changes. For renderer changes, use
`check:render-batching`, its `--no-multi-draw` fallback and `check:perf-tools` as
appropriate; browser checks assert correctness rather than FPS.

Record results and limitations in `game/PERFORMANCE.md`, including remaining cold
stalls, unchanged throughput and unrelated validation failures. Keep raw JSON,
screenshots, CPU profiles and traces under ignored `.preview/perf/`. Never weaken
an asset-integrity assertion or change generated provenance merely to make a
performance change's test run green.
