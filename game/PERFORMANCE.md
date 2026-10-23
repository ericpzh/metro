# Placement latency audit

The target is approximately **100 ms from pointer-down to the first renderer
submission containing the placement**, including first use. Two animation frames
are a separate presentation proxy; neither measurement is a GPU fence.

## Reproduce

From the repository root:

```powershell
npm run bench:placement
$env:METRO_BROWSER_GPU='hardware'
npm run bench:usage-tour
```

`bench:placement` uses both shipped demos, paused at zero population, High
graphics, seed 7654321, a 1440 × 1000 browser and five pinned visible-ground
targets per demo. The workload includes interior placements and extensions of
the generated street window. It records first/repeated pointer-handler times,
render submission, two RAFs, subsystem work, model retention, worker frame delay,
scene raycasts, console errors and GL status. Every click must add exactly one
bench and use at most one raycast; authored cells must remain unchanged.

Use `BENCH_OUTPUT` for a distinct capture, `BENCH_DEMO` for one fixture,
`BENCH_EDITS` for 1–20 placements, `BENCH_DIST` for another production build, and
`--profile` for V8 CPU sampling. Keep profiled and clean timing runs separate.
`--software-gpu` explicitly selects SwiftShader.

The usage tour covers every palette option's cold/warm preview, eleven tool
hover paths, a bench place/move/pick/place-copy/delete/undo lifecycle, camera pan/orbit/zoom,
storey changes, ten view toggles in both directions, and line/exit/time changes.
Palette previews are **not** committed lifecycle coverage for every catalogue
variant. The tour's automation-to-two-RAF durations include protocol overhead;
use the focused placement harness for the 100 ms target.

## Changes

- Preserve unchanged module parents and animation/plate/fence registries on
  append-only equipment edits. Keep immutable equipment history without cloning
  all authored cells.
- Retain per-root batch source discovery across eligible edits and prepared
  views. Append-only edits aggregate and bake only affected spatial buckets.
  Unknown edits and mutable/transform/view changes retain conservative invalidation.
- Retire dormant GPU buffers in bounded idle callbacks, with teardown cancellation
  and exact disposal. Keep the existing four-view cache limit.
- When only the virtual ground rectangle changes, update pavement membership and
  remesh its changed boundary chunks. Preserve structural indexes, authored chunk
  geometry and slice materials. Full structural edits still take the full path.
- Skip reapplying unchanged level styling to retained equipment. Compare immutable
  module records before serializing; update clipping shader versions only when
  clipping actually changes.

These changes preserve placement/refusal checks, one scene pick per event,
simulation routing updates and all authored document content.

## Measured results — 2026-10-22

Hardware Chrome 155, RTX 4080 SUPER through ANGLE/D3D11, High quality,
892 × 815 canvas. Five placements per fixture; milliseconds, rounded.

| Demo | First before → after | Median before → after | Worst before → after |
|---|---:|---:|---:|
| Zoo | 683 → 134 | 505 → 134 | 683 → 176 |
| Tanwei | 366 → 118 | 276 → 110 | 1,075 → 241 |

Worst observed submission latency fell 74% on Zoo and 78% on Tanwei. After
optimization, the five submission samples were Zoo **134, 62, 132, 176, 156 ms**
and Tanwei **118, 110, 107, 241, 100 ms**. Two-RAF samples were respectively
159/81/163/201/178 ms and 157/149/142/283/133 ms.

**The “always approximately 100 ms” goal is not achieved.** Repeated interior
placements on Tanwei are close at 100–110 ms; street-window boundary changes
remain the largest outliers. The worst Tanwei click still spends 72 ms meshing
ground, 132 ms in `setStation` overall, and 191 ms in the pointer handler before
rendering. Zoo's boundary meshing costs 32–61 ms. These nested timings overlap;
do not add them together.

The next opportunities are generated-ground boundary meshing and the remaining
whole-scene render/matrix work. The diagnostic CPU profile shows matrix updates
and rendering still prominent. Moving this work would need lifecycle and visual
correctness regressions; merely delaying it would not prove that all tool
interactions meet the budget.

The completed usage tour (`usage-tour-complete.json`) also identifies follow-up
profiling targets: enabling cutaway **1,164 ms on Zoo / 1,378 ms on Tanwei**,
first line-colour change on Tanwei **718 ms**, first exit-open
change on Zoo **649 ms**, and Tanwei's time-panel/date action **396 ms**. These
are browser-clock two-RAF measurements taken after the viewing tour, not matched
before/after comparisons. Play/pause includes an intentional wait and simulation
startup, so its total is not an individual input-latency measurement.

Captures: `baseline-equivalent.json`, `optimized-final.json`, `comparison.json`, and
`profile-remaining-tanwei.cpuprofile` under `.preview/perf/placement-100ms/`.
Earlier `after-local-v6.json` overlapped other workspace validation and is
diagnostic only. Target discovery performs untimed raycasts before the first
sample: “first” means first placement after load, not the very first scene pick.
The original `baseline-matched.json` overlapped another chat's CPU coverage work
and is not used for the final comparison. Both final runs had no competing
tests/builds. Each capture preserves the fixture counts, every old
model root, authored cells, one raycast per event and zero browser/GL errors.

## Validation

Raw browser captures, CPU profiles and validation logs are under ignored
`.preview/perf/placement-100ms/`. The matched baseline is built separately from
Git HEAD `b0ab3b3`, including the same independent hidden-ceiling face correction
as the optimized build. Fixture counts and pinned targets are checked by
the same harness. Timing remains machine-dependent diagnostic evidence.

The full game suite, focused source coverage, production build, native and
fallback render-batching checks, and profiling export checks are run for this
audit. The broad single-process `test:perf` attempt was stopped after several
minutes without test progress; its log is retained. Focused coverage runs with
process isolation so that this known broad-coverage stall does not suppress the
changed-module results.

- Full game suite: **2,326 pass, zero failures/skips**, 151.6 seconds.
- Focused coverage: **151 pass**; individual line/branch/function coverage is
  recorded in `coverage-verified.log` (overall 90.59% / 91.77% / 81.67%).
- `stationGeometry.ts`: 100% / 100% / 100%; `equipmentBatches.ts`:
  93.97% / 95.19% / 86.84%; `ChunkSystem.ts`: 93.13% / 89.69% / 86.67%.
- Production build and profiler CPU/trace export checks pass. Native batching
  preserves geometry, reducing station draws 3,789 → 1,104 and closed/open train
  draws 779 → 29, with zero runtime/shader/GL errors.
- The fallback without native multi-draw preserves geometry and passes with
  station draws 3,789 → 1,767 and closed/open train draws 779 → 594.
- Both demo tours complete 120 cold/warm previews, 22 hover samples, the bench
  move/pick/copy/delete/undo lifecycle, 11 camera actions, 20 view-toggle samples,
  five settings/time actions, and fixture restoration with no browser errors.

The shared historical inventory and performance workflow remain in
[the performance reference](../.agents/skills/metro-repo/references/performance.md).
