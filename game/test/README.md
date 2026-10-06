# `game/test` — how the game is tested

The suite is `node --test` over `test/**/*.test.mjs`. Nothing here runs in a browser:
the tests import the TypeScript sources **directly** (Node strips the types) and drive
them the way the app does — the sim in-process, the renderer helpers headless, and the
React store through its own actions. That is a property of the sources, not of the
harness: `sim/` is pure and DOM-free (`layering.test.mjs` fails if it stops being),
the drawing helpers that have pixels take a 2D context, and `app/store.ts` is zustand
with no view attached.

## Running them

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

`test/support/` holds the shared harnesses — the only files here that are not
`*.test.mjs`:

| File | What it is |
|---|---|
| `support/scenario-station.ts` | The hand-built **Wusi Square** rig the sim suites use as a controlled station (the shipped 动物园 save is `src/data/demo-station.json`, loaded by `demo.test.mjs`). |
| `support/stub-canvas.mjs` | A recording 2D context: every fill, stroke, word (with its size and ink colour) and drawn image is kept, so a "does this print pixels" test asserts **what** a plate says, not that it did not throw. |
| `support/pictograms.mjs` | The 指示牌 pictogram PNGs off disk, for the sign render tests. |
| `support/camera-rig.mjs` | A live `CameraSystem` with no canvas and no GL: a plain three.js camera plus a DOM-shaped stub for `OrbitControls` to attach to, for the widget's camera tests (`camera-vertical-pan`, `camera-fov`, `camera-orbit`). |

The suites, by the thing they are about. Each one's full description is in
`../README.md`'s test list — that list is the detail, this is the map:

| Area | Files |
|---|---|
| Architecture | `layering`, `scene-wiring` |
| Numbers | `rng` |
| The crowd and the graph | `determinism`, `capacity`, `demo`, `gates`, `gate-door`, `zones`, `lift`, `placement`, `openings`, `stairs`, `escalators`, `slope-cut`, `ramp-fill`, `trains`, `stock`, `load` |
| The document and its edits | `save`, `grid`, `pick-cell`, `walls`, `halfwall`, `triangle`, `blocktool`, `facility`, `fence`, `storey`, `exits`, `bay`, `surfaces`, `rail`, `validation` |
| The furniture and the decor | `shelf`, `desk`, `restroom`, `bench`, `vending`, `decor`, `ceiling-decor`, `sign`, `sign-model`, `sign-editor`, `billboard`, `glass-panel`, `calligraphy`, `line-map`, `booth-model`, `room-model` |
| The models | `module-build`, `tv-screen`, `tv-pair` |
| The scene | `chunk-cache`, `level-slicing`, `grid-visibility`, `section`, `section-drag`, `cut-clipping`, `floor-surface`, `camera-vertical-pan`, `camera-fov`, `camera-orbit`, `view-home`, `refused-ghost` |
| The pixels | `sign-render`, `station-display` |
| The app | `move`, `sweep`, `paint-mode`, `rail-folders`, `rail-families`, `line-edit` |

## The rules a test here follows

1. **Import the source, not a copy.** `import { buildGraph } from '../src/sim/station.ts'`
   — no build step, no bundler, no `dist/`. If a module is hard to test, that is a
   statement about the module: `sim/` is kept pure for exactly this reason.
2. **Pin a number and say what it means.** `assert.equal(height, 1.25, 'the 闸机 is the
   reference’s 1250 mm machine, not a 1 m cube')` beats `assert.ok(height > 1)`: the
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
  itself). A component that renders nothing fails visibly; a store action that forgets a field
  does not.
* **Vite-only modules.** `render/adArt.ts`, `render/pictograms.ts` and
  `render/lineMapArt.ts` resolve their
  artwork through `import.meta.glob`, which plain Node does not implement. Tests that
  need an ad face stub it (`module-build`, `tv-screen`); the pixel code they feed
  (`render/stationDisplay.ts`, `render/signFace.ts`) is tested directly, and the map
  plate tests (`line-map`) stub the art cache rather than the glob.
* **`/lab`, `boot.tsx`, `mobile.ts`** — the manual harness, the lazy bootstrap and the
  phone gate, all of which are browser-shaped by construction.

## Coverage, and the gaps that were closed

Measured over the whole suite (`--experimental-test-coverage`, one process): **716 tests,
94.66 % lines / 87.96 % branches / 87.98 % functions** across the `game/src` files the suite
loads. Before the pass this file documents it was 557 tests at 90.01 / 87.72 / 81.53, and the
gap-filling tests alone took it to 95.36 on a tree without the camera and floor-surface work.
**These numbers are a snapshot of a moment, not a target** — regenerate them with the command
above whenever the suite grows; the point of the table is the column that shows what an
untested file was hiding.

| File | Before | Now | The test that closed it |
|---|---|---|---|
| `render/models.ts` (the dispatcher) | 87.4 % | 100 % | `module-build` |
| `render/models/pieces/PsdModel.ts` (站台门) | 11.1 % | 100 % | `module-build` |
| `render/models/pieces/ExitModel.ts` | 17.2 % | 95.7 % | `module-build` |
| `render/models/pieces/TrackModel.ts` | 26.2 % | 100 % | `module-build` |
| `render/models/pieces/TvmModel.ts` | 28.6 % | 100 % | `module-build` |
| `render/models/pieces/TrainModel.ts` | 29.7 % | 99.0 % | `module-build` |
| `render/models/pieces/CabModel.ts` | 37.5 % | 97.2 % | `module-build` |
| `render/models/pieces/LiftModel.ts` | 37.6 % | 94.6 % | `module-build` |
| `render/models/pieces/BenchModel.ts` | 38.5 % | 100 % | `module-build` |
| `render/models/pieces/ShelfModel.ts` | 42.9 % | 100 % | `module-build` |
| `render/models/pieces/BillboardModel.ts` | 50.9 % | 100 % | `module-build` |
| `RoomModel` / `Desk` / `Cubicle` / `Sink` | 62-70 % | 96-100 % | `module-build` |
| `render/stationDisplay.ts` (the plate's pixels) | 56.7 % | 100 % | `station-display` |
| `sim/rng.ts` | 83.5 % | 100 % | `rng` |
| `data/reference-station.ts` | 75.0 % | 100 % | `demo` |
| `app/store/slices/LineSlice.ts` | 34.0 % | 100 % | `line-edit` |
| `app/store/slices/StationSlice.ts` | 68.3 % | 100 % | `line-edit` |

The files still lowest after this pass, and why they are:

| File | Lines | What is left |
|---|---|---|
| `build/model/Reference.ts` | 31 % | A barrel whose one consumer is the demo path; nothing imports it directly. |
| `render/scene/systems/GhostSystem.ts` | 44 % | The hover-ghost limbs: they build meshes for a live scene and are driven by pointer moves (`gate-door`, `triangle` and `tv-pair` cover the keys and the wedge slope they read). |
| `app/store/slices/RailSlice.ts` | 46 % | The rail actions the UI calls; the pure edits underneath are covered by `rail` (`build/rail.ts`) and `line-edit`. |
| `app/tools/BlockTool.ts`, `geometry/cells.ts`, `ToolController.ts` | 50-59 % | The pointer path: press/move/release against a canvas, of which `blocktool` and `triangle` drive the parts that need no DOM. |
| `render/scene/systems/CameraSystem.ts` | 70 % | The `OrbitControls` rig: its own limbs are driven by real pointer events on a canvas. The pieces of it that are pure arithmetic are pinned (`camera-vertical-pan`, `camera-fov`, `camera-orbit`, `section-drag`), and 回到默认视角 through it is pinned by `view-home`. |
| `sim/world/World.ts` | ~96 % | The branches a crowd reaches only in a long, rare run: a stuck agent, a lift car arriving at the wrong moment, an invalid trip. Covered by the tightest tests that exist (`determinism`, `capacity`, `demo`) rather than by a targeted one. |
| `render/scene/systems/*` | 80-100 % | The GPU half of each system; their arithmetic is covered (`chunk-cache`, `cut-clipping`, `level-slicing`, `section-drag`, `grid-visibility`). |
| `sim/sign.ts`, `sim/station.ts`, `sim/openings.ts` | 97-99 % | Branch tails: an unreachable save spelling, a degenerate run, a fallback for a document that cannot exist. |

