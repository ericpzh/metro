# Subplan 01 · Project, CLI and baseline

Before starting, read [the migration index](README.md), the metro repo/game/test skills, and Unity's `unity-cli` and `unity-package-management` skills. This subplan uses PowerShell from the repository root.

## B1. Freeze the TypeScript reference

1. Record the commit, clean/dirty state, Node version, exact lockfile versions, OS, CPU/GPU, browser version, viewport, DPR and graphics settings. Use the same machine for comparisons. This workstation reports Node `24.15.0`. Verify all locks install with the chosen version.
2. Run `npm ci`, `npm run setup:all`, `npm run test:game`, `npm run build:game` and `npm run check:demos`. Save exit status, logs and any pre-existing failures. Read `tools/bench-demos.mjs` and the repo's performance reference before using `npm run bench:sim`, `npm run bench:browser`, `npm run bench:demo-load` and the editor/placement benchmark scripts. Capture Zoo, Tanwei and Tianhe, using identical seed, tick count, camera, viewport and actions for future comparison. Include the user-authored `video/demo-station.metro.json` in save and visual QA.
3. Make a simple CSV or JSON results table with fixture, action, build revision, agent/train counts, render frame median/p95/p99, maximum main-thread stall, time to first interaction, compressed request bytes, memory and run count. Record cold/warm separately, use at least three runs per comparison and store raw data under `.preview/unity/baseline/`. Keep CI software WebGL results separate from hardware comparisons.
4. Open a gap ledger with one row per feature and fields `source`, `existing tests`, `fixture`, `C# target`, `browser check`, `scope decision`, `status`. Seed the rows from `GAME-SPEC.md`, then check actual source and tests before treating a prose feature as shipped. Baseline failures need an owner or an explicit disposition before cutover.

The initial [gap ledger](gap-ledger.csv) is a draft of specification headings;
split or remove non-feature rows and verify each feature against code and tests
before using it for parity or scope decisions.

For the Phase 0 exit, verify the ledger rows needed for the first feasibility
slice and label the remaining rows as unverified. Classify the nine baseline
editor-action errors by harness failure or product behavior, with a repro and
disposition for any case used in the first comparison. Preserve measured
budget misses as reference results. Use those results to choose and assess
Phase 1 comparisons, then require full ledger disposition at the parity gate.

Clean-checkout discrepancy found at the baseline SHA: the passenger bake's raw
recipe hashes reflected the workstation's mixed line endings, so its original
test failed on an LF-normalized archive. The verification fix adds a generated
LF-normalized record tied to the original raw recipe hash; it does not change
the baked geometry or raw FBX provenance. The generator first requires the raw
inputs to match the bake, and `npm run bake:passengers` refreshes the record.
The normalized archive with this fix and the placement-harness regression passed
all 3,091 game tests; a deliberate recipe edit was rejected. Preserve the original failure and fixed-run logs under
`.preview/unity/baseline/`. A new committed checkout must still rerun the suite.

The original real-pointer placement benchmark failed its pinned-target check at
this SHA: the station now opens on a lower level and the home camera is closer.
Setting Z 0 and restoring the earlier camera recovered the pinned cells; the
current equipment tool also commits on release instead of press. The repaired
harness selects the same authored cells explicitly and checks the release commit.
Three reference captures passed; one Zoo release exceeded the 100 ms target.
The shared performance reference records both timing boundaries and the raw
reports. Repeat with the same camera and workload for future comparisons.

The following targeted suite passed 30 tests at the baseline SHA. Use it as a fast check while iterating. B1 still requires the full baseline and measurements.

```powershell
node --test game/test/demo-route.test.mjs game/test/benchmark-route.test.mjs `
  game/test/save.test.mjs game/test/autosave.test.mjs game/test/determinism.test.mjs `
  game/test/layering.test.mjs
```

## B2. Identify and promote the Unity project

```powershell
git status --short --branch
Get-Content unity/ProjectSettings/ProjectVersion.txt
Get-Content unity/Packages/manifest.json
Get-Command unity -ErrorAction SilentlyContinue
$editor = 'C:/Program Files/Unity/Hub/Editor/6000.6.8f1/Editor/Unity.exe'
Test-Path -LiteralPath $editor
Test-Path -LiteralPath (Join-Path (Split-Path $editor) 'Data/PlaybackEngines/WebGLSupport')
Get-Process Unity -ErrorAction SilentlyContinue | Select-Object Id, Path
```

1. Inventory `Assets/`, `Packages/` and `ProjectSettings/` before changing anything. Preserve the local project and use a separate project copy for the first destructive or version-changing experiment. A second Editor process cannot batch-open the same project. Use the copy, close the live project in a coordinated handoff, or use the live Unity CLI for investigation. Each job uses its own output directory.
2. Replace the plan-only ignore rules with allowlist entries for `/unity/Assets/`, `/unity/Packages/`, `/unity/ProjectSettings/`, `/unity/plan/` and the new hand-authored scripts and tests directories. Add their specific build-output ignores. Include imported source and paired `.meta` files, `Packages/manifest.json`, `Packages/packages-lock.json`, and the project version. Audit for local absolute paths and secrets. Leave `Library`, `Temp`, `Logs`, `UserSettings`, `Obj`, `dist`, IDE projects, and build/test reports ignored. Use `git status --untracked-files=all` and `git check-ignore` for a source file, its meta file and a cache file. Review the candidate file list before adding the project to Git.
3. Generate a dedicated `Assets/StationDesigner/Scenes/Bootstrap.unity` via a repeatable Editor method. Use public Editor APIs for scene creation and saving, serialized references and settings. The command updates only named paths it owns. Build with the explicit scene path. Run the generator twice and check GUID stability, clean second diff and preserved custom content. Keep imported-model wrappers separate from generated imported assets.
4. Pin the editor, module, Node and package locks. When provisioning another machine, discover the installed editor with the official CLI and confirm install commands via `--help`. Use `unity install 6000.6.8f1 -m webgl` for a missing editor or `unity install-modules -e 6000.6.8f1 -m webgl` for missing Web support on a matching editor. Check license activation with the runner's actual account. Record editor discovery rules in the wrapper and allow `METRO_UNITY_EDITOR` to override the path. [Unity CLI editor commands](https://docs.unity.com/en-us/unity-cli/reference/editor-project-commands)

Before committing the newly exposed project source, review the populated Unity
Cloud project and organization bindings in `ProjectSettings.asset`. Keep the
binding if it is the intended shared project. Otherwise unlink the project
through Unity before capturing its settings for Git. Review template scenes,
tutorial assets and generated examples alongside their `.meta` files when
choosing the source set.

## B3. Approve and resolve dependencies

| Dependency | Plan and proof |
| --- | --- |
| URP, Input System, uGUI | The bootstrap uses uGUI `Text` and `InputField` with Noto Sans SC. The local Web smoke verified bilingual glyphs, pointer input and an ASCII edit. TextMeshPro, CJK composition and production font footprint belong to the runtime UI work. |
| Unity Test Framework | `1.8.0` is pinned directly. Rerun EditMode and PlayMode from the committed checkout and preserve the nonzero test counts and deliberate-failure evidence. [Command-line test reference](https://docs.unity3d.com/Packages/com.unity.test-framework@1.4/manual/reference-command-line.html) |
| `com.unity.cloud.gltfast` | `6.19.0` is pinned and imported the example assets. [A1–A4](02-assets.md) owns the repeatable catalogue import. [Editor importer](https://docs.unity3d.com/Packages/com.unity.cloud.gltfast@6.19/manual/ImportEditor.html) |
| `com.unity.nuget.newtonsoft-json` | `3.2.1` is pinned directly. R2 owns explicit converters and DTOs for versioned sparse JSON and testing the real parser under IL2CPP. [Unity Newtonsoft package](https://docs.unity3d.com/Packages/com.unity.nuget.newtonsoft-json@3.2/manual/index.html) |
| Three.js, Khronos validator, browser harness | Keep the repo's locked Three.js version per package. Use the Node validator package in the exporter and the existing Chrome harness first. Add pinned Playwright as a separate tool only if the route/browser matrix warrants it. [Khronos validator](https://github.com/KhronosGroup/glTF-Validator) · [Playwright browser support](https://playwright.dev/docs/browsers) |
| Unity Pipeline package | Optional for querying/driving a running Editor with `unity status` and `unity command`. Batch build/test stays runnable with the Editor executable. [Unity CLI integration](https://docs.unity.com/en-us/unity-cli/unity-cli) |

For additions use the Package Management skill's asynchronous `Client.Add` or `Client.AddAndRemove` editor entry. Call it in batch mode without `-quit`. Poll the request from `EditorApplication.update`, record exact resolution/errors and exit from that callback. A clean build is a separate invocation after any domain reload. Review manifest/lock changes. Keep dependencies at the minimum above. Add addressables, GLB optimization, Burst, WebGPU or Unity Localization only when the corresponding subplan gate identifies a need and a compatible package has been verified.

## B4. Implement the command surface

Use the implemented `unity/scripts/metro-unity.ps1`. See
[the Unity project README](../README.md) for the runnable sequence and `-Help`
for the flags. The table defines the command contract.

| Task | Owned behavior |
| --- | --- |
| `doctor` | Report repo/project paths, Editor pin and Web module, installed package resolutions when available, Node version, output directory, and project lock. A separate smoke launch proves license access. |
| `bootstrap` | Call the public static Editor generator for Bootstrap and render settings. Save and validate source. |
| `import-assets` | Reserved for the A3 manifest importer, catalogue and validation report. A3 defines that manifest in Phase 1, so Phase 0 must fail clearly for this task rather than inventing a manifest or claiming import support. |
| `test -Mode EditMode\|PlayMode` | Run one suite at a time, keep XML and full Editor log. Fail on timeout, missing/empty XML, test failures or abnormal process exit. |
| `build-web -Configuration Development\|Release` | Call `Metro.Editor.BuildWeb.Run` and produce Web build, BuildReport JSON and provenance with commit, Editor, settings, fixture/asset hashes and file digests. Return nonzero on failed or cancelled build or absent outputs. |
| `pack-web`, `smoke-web` | Hand off to Node pack and browser tools in [the web plan](04-web-release.md). Build and verify an artifact without network mutations. |

Use full paths and a process wait/exit-code check on Windows. Start with the invocation shapes below. Use `-nographics` for pure jobs. Give capture jobs an actual graphics backend. The test runner owns exit for `-runTests` and package installation owns exit for asynchronous UPM.

```powershell
$project = (Resolve-Path unity).Path
$evidence = (New-Item -ItemType Directory -Force .preview/unity/phase-0).FullName
# After the entry methods exist. Capture $LASTEXITCODE immediately after each invocation.
& $editor -batchmode -nographics -quit -projectPath $project -buildTarget WebGL `
  -executeMethod Metro.Editor.BuildWeb.Run -metroOut "$evidence/web" -logFile "$evidence/build.log"
& $editor -batchmode -nographics -projectPath $project -runTests -testPlatform EditMode `
  -testResults "$evidence/editmode.xml" -logFile "$evidence/editmode.log"
```

In `BuildWeb.Run`, validate arguments and output confinement, apply Web settings via Editor APIs, assert the active target, call `BuildPipeline.BuildPlayer` with `BuildTarget.WebGL` and the explicit scene array, and inspect `BuildReport.summary.result`. Apply machine-local Web optimization settings explicitly on each CI build and read them back. Fail on any stale or partial output by building in a fresh directory. Use development builds for diagnostics and release-equivalent builds for performance gates. [Editor command-line arguments](https://docs.unity3d.com/6000.6/Documentation/Manual/EditorCommandLineArguments.html)

Before accepting the clean-checkout proof, record the checkout SHA and hash
authored project inputs before launching the build. Compare them afterward and
handle Unity-generated settings or lockfile changes explicitly. Capture the
font attribution files and fixture bytes from the same source snapshot, or
verify their digests against it before packing. An unchanged HEAD and hashes
collected after the build cannot establish what the build read.

## B5. Prove the loop from a clean checkout

1. Build a first scene with a one-metre cube, camera, bilingual text and a click counter. In Web, record a DOM-visible ready marker via a narrow bridge after the first real frame, then click the canvas and verify the counter changes. Add a tiny valid v1 save and one deliberately invalid save for B5 transport checks. Save validation moves into the C# runtime in R2.
2. Use raw Web files first. Package and serve through local Wrangler at both `/game/` and `/game/en/`. Verify the packed manifest, including non-WASM files, before launch. Enable browser network and error reporting before the first navigation and check failed requests and unexpected HTTP error responses. Use a fresh report per attempt and record the pack digest. Exercise cold load and reload, then prove that a broken dependency or tampered packed file fails without leaving a previous success report at the current attempt's path.
3. Reproduce with an empty Unity `Library` in an isolated checkout of the same committed source used to identify the artifact. A second person or agent should be able to run `doctor → bootstrap → test` in both modes, then `build-web → pack-web → smoke-web` after licensed editor provisioning and dependency installation. Repeat the normalized TypeScript test suite from that checkout. Report hashes and settings. Compare functional outputs across machines rather than requiring byte-identical Unity builds.
4. Handoff evidence includes logs, test counts, build summary, HTTP and browser results, tool pins, source allowlist, and an explicit list of unresolved feasibility gates. Targeted Phase 1 spikes can run in parallel. Keep the Phase 0 status open until its repeatable checkout proof and baseline dispositions are recorded.
