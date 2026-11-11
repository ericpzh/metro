# Phase 1 implementation checklist

Deliver one small Station Designer station playable in Unity Web. The player places a floor tile and fare gate, starts a service, watches a passenger queue and board, downloads a save, and reopens it in a fresh browser session. The station runs again with the restored edits. This is the Phase 1 exit check. Use original placeholder art and a single route, gate and train stop. The plan assumes the station starts paused and that save/reopen uses the browser file picker and download.

## 0. Verify the starting point

Phase 0 established the Unity Web toolchain. Existing Phase 1 proofs cover imported Type A doors, a TypeScript-matched gate path, authored v1 save exchange and a local Worker shell. The current `build-web` command selects the Bootstrap scene. The Zoo comparison is a separate QA scene. Read [the evidence handoff](phase-0-handoff.md) before changing those entry points.

From the repository root in PowerShell:

```powershell
git status --short --branch
git log -5 --oneline
node --version
./unity/scripts/metro-unity.ps1 -Help
./unity/scripts/metro-unity.ps1 doctor
npm ci
npm --prefix game ci
node --test unity/tests/runtime-layering.test.mjs unity/tests/web-release-contract.test.mjs unity/tests/web-release-worker.test.mjs unity/tests/smoke-negative.test.mjs
```

Use the installed dependencies if they already match the lockfiles. Use the Unity Editor revision, Web module and Node version from `doctor`. Preserve all current working-tree changes. If the live project is locked, copy the implementation source to a fresh scratch project for batch tests and builds as shown in step 5.

## 1. Build the station and editing loop

- [ ] Add an idempotent Editor generator under `unity/Assets/StationDesigner/Editor/` with entry point `Metro.Editor.FirstPlayable.Generate`. It owns `Assets/StationDesigner/Scenes/FirstPlayable.unity`. Generate a fixed camera, clear grid, entrance, platform, train stop and UI with **Floor**, **Gate**, **Run**, **Save** and **Open**. Use the checked-in Type A prefab and the existing original placeholder mesh. Give the scene its own initial station document. Reuse the save schema and type values from the authored fixtures and `game/src/persistence/save.ts`.
- [ ] Make two visible gaps in the starter layout so the floor and gate placements affect the run. Use deterministic coordinates documented in the generator and fixture. Put the floor on the approach path and reserve one legal gate position on the fare boundary. Define the route through those positions, on to the platform and then to the train door. Keep the route short enough to watch in one browser test.
- [ ] Keep one authoritative station document. Put placement validation and committed edits in a Unity-independent assembly following [R1](03-runtime.md#r1-create-the-dependency-and-fixture-boundaries). A successful click updates that document and the view. A click on UI, outside the grid, or on an occupied or invalid cell leaves the document unchanged. Resolve one scene pick per pointer event. Keep any hover preview ephemeral.
- [ ] Add EditMode cases for the two successful edits and for duplicate or invalid placement. Verify the gate cannot occupy a slot until its required floor or support exists. Verify both committed positions in the document. Add a browser test that clicks the actual tools and grid in step 6.

## 2. Run the service and board a passenger

- [ ] Inspect `Runtime/Sim/GatePathSlice.cs`, `Runtime/App/ZooGateSliceView.cs` and `Tests/EditMode/ZooGatePathTests.cs`. Reuse the existing deterministic gate rules with this station's waypoints. Keep the existing Zoo comparison passing. Add a small platform/train-stop state driven by the same logical clock. Keep the walk and gate rules in Sim and let the view consume state.
- [ ] **Run** validates the committed floor and gate, gives the player a visible reason when the route is incomplete, and starts the clock when the layout is valid. Spawn at the entrance, walk to the fare gate, queue, pass the gate, reach the platform, open the train doors on the platform side and board. Move or hide the passenger at the train door only when the simulation records boarding. Display a boarded count so the outcome is visible.
- [ ] Define repeat behavior. Disable overlapping runs while one is active. A new run after completion or after reopening starts with fresh transient passenger and train state and uses the current committed layout.
- [ ] Add a deterministic EditMode test that drives the clock without wall-clock waits. Assert the ordered events and one boarding. Check that an incomplete layout never starts a service. Record the source command or fixture used to compare the existing gate behavior.

## 3. Save and reopen through the browser

- [ ] Inspect `Runtime/Persistence/StationSaveV1.cs` and the authored round-trip tests. Extend the existing persistence boundary where required to serialize the edited station. Save the v1 document with the placed floor and gate. Keep the active run state out of the save. Match the existing wire schema, and use a fixed timestamp in deterministic tests.
- [ ] Wire **Save** to download UTF-8 `.metro.json` and **Open** to a browser file picker. Keep the JavaScript bridge small. Validate the candidate document in C# before swapping it into the scene. On successful reopen rebuild the view and reset transient service state. On invalid input show a visible error and preserve the current station.
- [ ] Test edited save → reopen → edited state equality in EditMode. Include an invalid input case. The browser checker must open the actual downloaded bytes in a fresh page, verify the placed floor and gate, and run the reopened station again.

## 4. Expose the scene through the existing CLI

- [ ] Extend `unity/scripts/metro-unity.ps1` with an explicit `-Scene FirstPlayable` option for `bootstrap` and `build-web`. Keep the existing default Bootstrap behavior for current callers. Pass the selected scene through an allowlist to `Metro.Editor.BuildWeb.Run`. Record the actual scene path in the provenance and keep the existing build input and pack integrity checks.
- [ ] Add `tools/unity-web/smoke-first-playable.mjs`. Accept the run directory as the first argument. Use the existing browser harness and local Wrangler pattern from `tools/unity-web/smoke.mjs`. Serve the packed FirstPlayable build at `/game/`. Use a fresh browser profile and attach diagnostics before navigation. Provide a readiness signal and read-only state observations through a small QA bridge. Drive gameplay with pointer and file input events.
- [ ] Document the new commands in `unity/README.md` when they work. The commands in steps 5–6 use the interface this step adds.

## 5. Generate, test and build

After implementing steps 1–4, run from the repo root in PowerShell 7. The sequence creates a fresh output directory and scratch project, so it also works while the main Unity project is open.

```powershell
$run = '.preview/unity/first-playable-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
$project = (New-Item -ItemType Directory -Path "$run/project" -Force).FullName
Copy-Item -LiteralPath unity/Assets,unity/Packages,unity/ProjectSettings -Destination $project -Recurse
./unity/scripts/metro-unity.ps1 doctor -ProjectPath $project -OutputDirectory $run
./unity/scripts/metro-unity.ps1 bootstrap -Scene FirstPlayable -ProjectPath $project -OutputDirectory $run
./unity/scripts/metro-unity.ps1 test -Mode EditMode -ProjectPath $project -OutputDirectory $run
./unity/scripts/metro-unity.ps1 test -Mode PlayMode -ProjectPath $project -OutputDirectory $run
./unity/scripts/metro-unity.ps1 build-web -Scene FirstPlayable -Configuration Release -ProjectPath $project -OutputDirectory $run
./unity/scripts/metro-unity.ps1 pack-web -Configuration Release -ProjectPath $project -OutputDirectory $run
node tools/unity-web/smoke-first-playable.mjs $run
```

Check the exit status after each command and stop the sequence at the first failure. If generating in a scratch project creates the first scene, bring the verified scene and its `.meta` into `unity/Assets/StationDesigner/Scenes/`, then repeat generation and verification from a fresh copy of the delivered source. Compare the scene bytes and GUID across the repeat. If Unity reports build input drift, inspect the input snapshot and project diff. Apply the known URP normalization only when the diff matches the generated settings change documented in the handoff.

## 6. Prove the player loop

- [ ] The Web checker boots the packed scene and waits for the first rendered frame. It clicks **Run** on the starter layout and observes the missing-placement message.
- [ ] It clicks **Floor**, places the required tile, clicks **Gate**, and places the gate. It verifies the expected committed coordinates and visible objects.
- [ ] It clicks **Run** and observes entrance → queue → through gate → platform → board, with exactly one boarded passenger. Capture the scene at the gate or at boarding.
- [ ] It clicks **Save**, collects the browser download, and opens those bytes through **Open** in a fresh page. It checks both placed items, then clicks **Run** and confirms boarding again. Also attempt an invalid import and confirm the current layout survives.
- [ ] Store a machine-readable report, downloaded save and screenshots under the run directory. Record the Git SHA, dirty state, exact commands, Editor version, build and pack evidence, and verified outcomes in [the handoff](phase-0-handoff.md). The whole loop through the user controls is the Phase 1 exit check.

Move to the expansion milestone after this browser pass. The Tianhe heap failure, larger workloads, full catalogue, broader legacy-save repair and performance budgets remain tracked in the [migration milestones](README.md#execution-order).
