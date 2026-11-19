# Station Designer Unity bootstrap

The project is pinned by `ProjectSettings/ProjectVersion.txt` to Unity
6000.6.8f1 (237b6593792b); install its WebGL module and use Node 24.15.0.
`Packages/manifest.json` and `packages-lock.json` record the package pins.
`METRO_UNITY_EDITOR` can point at the matching Editor executable. The wrapper
otherwise looks in the standard Windows Unity Hub installation directory.

## Live Editor test workflow

The Unity CLI and the project's `com.unity.pipeline@1.0.0` package drive the
already-open Editor for day-to-day C# and scene work. This avoids rebuilding and
starting the WebGL player for every edit. The CLI is `1.0.0-beta.17` on this
workstation; the Editor stays pinned to `6000.6.8f1`. Every command passes
`--project-path` so another open project cannot receive Station Designer's
actions.

```powershell
./unity/scripts/metro-editor.ps1 status
./unity/scripts/metro-editor.ps1 compile
./unity/scripts/metro-editor.ps1 test -Mode EditMode -TestFilter StationClockTests
./unity/scripts/metro-editor.ps1 test -Mode PlayMode -TestFilter StationExplodedViewPlayTests
./unity/scripts/metro-editor.ps1 smoke -Demo zoo
./unity/scripts/metro-editor.ps1 verify -TestFilter StationClockTests -Demo zoo
```

`smoke` loads the Zoo demo through `StationGameHost` and its command router,
proves Play Mode frames advance, steps fixed simulation ticks, applies the
evidence cutaway, captures the Game view and restores the camera and time scale.
It repeats in the same Play Mode session and requires both runs to produce the
same state fingerprint. `compile` and `test` stop Play Mode first; `smoke` leaves
it running. The first-milestone command is `verify`, which compiles, runs a
filtered test and produces a fresh Zoo screenshot in one serialized operation.
Evidence lands under `.preview/unity/editor/<run-id>/` with the fixture hash,
source revision and dirty state, stage timings, Console delta and screenshots.
The full design and measured turnaround are in
[the live-editor workflow plan](plan/12-live-editor-workflow.md).

For isolated batch tasks, use `metro-unity.ps1` against a separate project copy.
It cannot open a project that the live Editor already has open.

Run from the repository root in PowerShell. For day-to-day local WebGL previewing
(even while Unity Editor is open on `unity/`), run:

```powershell
npm start unity                  # syncs isolated workspace, builds/reuses verified WebGL, packs latest React UI, serves http://127.0.0.1:8787/game/
npm run build:unity              # build and pack without starting the preview server
npm start unity -- --rebuild     # force full isolated Unity bootstrap + WebGL rebuild
```

For direct `metro-unity.ps1` tasks, close the Editor for the selected
project or make a separate copy of `Assets`, `Packages` and `ProjectSettings`;
a second Unity process cannot open the same project. Output must be a fresh
folder under `.preview/unity`.

```powershell
./unity/scripts/metro-unity.ps1 doctor -ProjectPath <project-copy>
./unity/scripts/metro-unity.ps1 bootstrap -ProjectPath <project-copy> -OutputDirectory .preview/unity/my-run
./unity/scripts/metro-unity.ps1 test -Mode EditMode -ProjectPath <project-copy> -OutputDirectory .preview/unity/my-run
./unity/scripts/metro-unity.ps1 test -Mode PlayMode -ProjectPath <project-copy> -OutputDirectory .preview/unity/my-run
./unity/scripts/metro-unity.ps1 build-web -Configuration Release -ProjectPath <project-copy> -OutputDirectory .preview/unity/my-run
./unity/scripts/metro-unity.ps1 pack-web -Configuration Release -OutputDirectory .preview/unity/my-run
./unity/scripts/metro-unity.ps1 smoke-web -OutputDirectory .preview/unity/my-run
```

`StationGameLocal` is the project's single scene; it is the default for
`bootstrap` and `build-web`. The full scratch-project sequence is in
[the Phase 1 checklist](plan/05-first-playable.md).

`-Help` lists flags. `doctor` does not prove licensing; the Editor invocations do.
The test task requires a nonzero test count and passing XML. Builds use a new
output directory, an explicit scene and disabled compression; they write the Unity
build report and a provenance file. The local-only pack splits oversized raw
WASM into bounded files, and its local Worker reassembles the original bytes.
The smoke checks both locale paths, cold load and reload, frame-ready marker,
click, editable text, fixture transport, WASM MIME and SHA-256. It is not the
production router or a release artifact. `import-assets` is reserved for the
Phase 1 A3 manifest and currently fails explicitly.

Phase 0 remains open. Verify the ledger rows for the first feasibility slice
and triage the baseline benchmark errors. Retain the measured performance
misses for the Phase 1 comparison.
The passenger recipe hash check now passes an LF-normalized reference copy;
repeat it from a committed checkout. The source copy used for the local smoke came from a dirty working
tree, not a committed clean checkout. The Web smoke does not prove
Chinese IME, C# save parsing, real game behavior, or production asset size.
See [the bootstrap plan](plan/01-bootstrap.md), [the draft ledger](plan/gap-ledger.csv)
and `.preview/unity/baseline/` for evidence and outstanding gates.

