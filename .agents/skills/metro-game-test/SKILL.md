---
name: metro-game-test
description: Run, extend or fix the game's test suite in game/test/ of the ericpzh/metro repo. Use when adding tests for game/src behaviour, when `npm test` / a suite fails, when a new sim rule needs a pin, or when deciding what the suite does and does not cover.
---

# The game's test suite (`game/test/`)

**`game/test/README.md` is the authority** — the seven rules a test here follows,
the `test/support/` harnesses, what is deliberately untested and the coverage
table. Read it before adding a suite. This skill is the short version.

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

Nothing runs in a browser. Tests import the TypeScript sources **directly** (Node
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

For the fitted 门 / 玻璃幕墙 joint, keep the snap arithmetic in the pure placement
module and pin a rotated curtain, a door clamped inside its run, allowed fitted overlap,
rejected crosswise overlap, and the clipped lower-pane geometry in `glass-panel.test.mjs`.
Pin front and back handle geometry and stand-off in `door-panel.test.mjs`; room and
standalone doors share `DoorModel.buildDoor`, so both use the same assertion.
