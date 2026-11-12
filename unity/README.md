# Station Designer Unity bootstrap

The project is pinned by `ProjectSettings/ProjectVersion.txt` to Unity
6000.6.8f1 (237b6593792b); install its WebGL module and use Node 24.15.0.
`Packages/manifest.json` and `packages-lock.json` record the package pins.
`METRO_UNITY_EDITOR` can point at the matching Editor executable. The wrapper
otherwise looks in the standard Windows Unity Hub installation directory.

Run from the repository root in PowerShell. For day-to-day local WebGL previewing
(even while Unity Editor is open on `unity/`), run:

```powershell
npm start unity                  # syncs isolated workspace, builds/reuses verified WebGL, packs latest React UI, serves http://127.0.0.1:8787/game/
npm run build:unity              # build + pack + update .preview/unity/station-game-local.jsonc without starting Wrangler
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

For the first playable scene, pass `-Scene FirstPlayable` to `bootstrap` and
`build-web`; the default remains `Bootstrap`. After packing, run
`node tools/unity-web/smoke-first-playable.mjs <run-directory>` to exercise the
controls, downloaded save, reopen, and boarding in a local browser. Pass
`--require-second --require-detour` to require both additional layout cases;
omitting these flags keeps older builds reviewable. The full
scratch-project sequence is in [the Phase 1 checklist](plan/05-first-playable.md).

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

