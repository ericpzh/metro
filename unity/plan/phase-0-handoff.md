# Phase 0 evidence and open gates

## Current priority

The migration plan now puts the first playable Unity Web slice in Phase 1.
Build a small station with the existing fixtures and original placeholder art.
Let the player place a floor and fare gate, watch passengers reach the platform
and board a train, then save and reopen the station. Run the full loop in a
browser through the normal controls. The Tianhe heap failure and startup
measurements below remain evidence for later scale and performance work.
Use the [current milestone table](README.md#execution-order) for phase exits.
Follow the [Phase 1 implementation checklist](05-first-playable.md) for the
scene, commands and browser acceptance sequence.

Reference: `4c0fb66e071e2aee25cd3fc055a010871942004b` (TypeScript oracle).
The Unity source used for these checks was an uncommitted working-tree copy;
the local manifests explicitly record a dirty tree and source/input hashes.
The repository HEAD subsequently advanced to `06b4b665` (train pantograph
layout changes) in another workspace task. The captures below remain attributed
to the earlier reference; bring those game changes and affected fixtures forward
as explicit compatibility work before comparing or porting them. An isolated
archive of `06b4b665` with the provenance and benchmark-test fixes passed 3,091
game tests after installing both game and model dependencies; see
`.preview/unity/baseline/head-game-test-retry.log`. This does not replace the
earlier measurements or establish Unity parity for the train changes.
Machine: Windows 11 Enterprise, i7-14700KF, RTX 4080 SUPER, Chrome 156,
Node 24.15.0. Existing development services were active during measurements.

## Completed local checks

- Root and web/game/model dependency installs passed in an isolated reference
  copy. `tools/unity-assets` lockfile also installed in isolation. The root
  `npm ci` first failed on a running Wrangler file lock; missing root dependencies
  were restored from the same lockfile install and root Wrangler was exercised.
- `npm run test:game` passed 3,090 tests on the original workstation checkout
  after a retry; `npm run build:game` and `npm run check:demos` passed in the
  reference copy. After the LF provenance and placement-harness fixes, the
  normalized reference copy passed 3,091 tests. See
  `.preview/unity/baseline/commands*.tsv` and logs.
- Three serial `bench:sim`, `bench:browser` and `bench:demo-load` runs completed
  for Zoo, Tanwei and Tianhe. The complete editor-action matrix ran three samples
  per action: 18,167 pass, 4,180 over budget, nine errors, 2,106 unsupported;
  the command returned nonzero. The baseline table is
  `.preview/unity/baseline/baseline-results.json`; raw reports and limitations
  are alongside it. The shared performance reference records the boundaries.
- Three cold/warm startup and click observations and three local gzip transfer
  observations per station were captured separately. The reproducible driver is
  `node tools/unity-baseline/startup.mjs` (`--gzip` selects local gzip); these
  do not represent Cloudflare production transfer or physical display latency.
- The user-authored v1 save parsed and round-tripped unchanged (1,303 cells,
  309 modules, one line), loaded in the TS game and was visually inspected.
  Evidence: `user-save-roundtrip.json`, `authored-save-smoke-retry.log` and
  `authored-save.png` under `.preview/unity/baseline/`.
- Editor 6000.6.8f1 (237b6593792b), WebGL support and license access passed.
  glTFast 6.19.0 imported the existing GLBs in the clean project copy;
  Unity Test Framework 1.8.0 and Newtonsoft 3.2.1 resolved as direct packages.
  `doctor` reports the Node and Editor revision pins; an override pointing at
  a different executable was rejected before launch.
- A project copy with no `Library` passed `doctor`, `bootstrap`, EditMode and
  PlayMode (one test each), Release Web build, pack and smoke. A deliberate test
  failure produced exit code 2. The generator preserved a custom marker and
  GUID, and its second run did not change the scene. Evidence lives in
  `.preview/unity/verified-run/` and `.preview/unity/baseline/`.
- The local Wrangler smoke passed cold load and reload at `/game/` and `/game/en/`,
  checked document language, first-frame marker, canvas click, editable bilingual
  field, fixture transport, font license, WASM MIME and SHA-256. See
  `.preview/unity/pack-v4-run/smoke-report.json` and
  `.preview/unity/baseline/pack-v4-smoke.log`. A subsequent build and smoke
  after HEAD advanced are in `.preview/unity/head-proof/` and
  `.preview/unity/baseline/final-dynamic-port-smoke.log`; its project inputs are
  identified by hashes, not assumed to equal the new HEAD. The scene screenshot
  was visually checked for both Latin and Chinese glyphs.
- During review, the existing pack passed both routes again in
  `.preview/unity/phase0-review-20261109-230220-479/`. A second copy passed
  after replacing `packed/licenses/OFL.txt` with the single line
  `SIL OPEN FONT LICENSE`. Reproduce by copying the same pack to a fresh
  output directory and running `smoke-web` on each copy. The tamper result in
  `.preview/unity/phase0-tamper-20261109-230254-792/` confirms that the current
  smoke trusts non-WASM files beyond its specific content checks. B5 now
  requires digest verification of the entire pack before launch.

## Explicit outstanding work

The local bootstrap is working. Phase 0 closure still needs a replay from one
committed source snapshot. A review of the saved `head-proof` provenance found
six captured Unity inputs whose bytes differ from the current project and six
additional bench asset and metadata files. Use the existing capture as evidence
for its recorded snapshot. Rebuild and smoke the selected checkout to validate
the current source set.

- The original raw-byte passenger recipe check failed on the LF-normalized
  archive. The LF verification fix now passes all 3,090 tests on that archive
  and rejects a deliberate recipe edit. Repeat from a committed clean checkout.
- The real-pointer placement benchmark initially failed its pinned target
  precondition. Its camera, target ordering and release-commit assumptions were
  repaired, and three reference captures completed. One Zoo release exceeded
  the strict 100 ms target; retain that miss in future comparisons.
- The [feature ledger](gap-ledger.csv) is a headings-based draft. Candidate
  source and test paths are identified for 44 unverified entries. Verify the
  rows used by the first feasibility slice at Phase 0 exit and carry the
  remaining rows forward to the parity gate.
- Triage the nine matrix errors and retain measured budget misses as reference
  data. Compare the Unity feasibility workload in an isolated run on the agreed
  machine. Use the existing shared-machine captures as diagnostic evidence.
- The raw Release WASM is about 34.8 MB, above Wrangler's 25 MiB asset limit.
  Local smoke splits and reassembles its bytes; this is not a production hosting
  design. Production compression/size, real-device performance, C# save parsing,
  Chinese IME and production route behavior remain later feasibility gates.
- `import-assets` is intentionally reserved for Phase 1 A3, which defines the
  manifest and importer. It fails explicitly until that contract exists.
- Review the populated Unity Cloud bindings and source allowlist before
  committing the project. Close out [B4 and B5](01-bootstrap.md#b4-implement-the-command-surface)
  with a pre-build input snapshot and a smoke report tied to its verified pack.
  Include one negative smoke run and the normalized-checkout TypeScript suite.

Targeted Phase 1 experiments may proceed in parallel with Phase 0 closeout.
Use a documented baseline slice for the first comparison. Keep public release
and full catalogue work gated by their own parity and Web feasibility checks.

## Closeout review in progress (2026-11-10)

- Source allowlist review: `.gitignore` exposes `Assets`, `Packages`, `ProjectSettings`, plans, scripts, tests and README while excluding `unity/Library`. The candidate includes the original URP sample scene, tutorial assets and settings, bootstrap assets, generated bench/bin reviews, and Type A proof. Keep their paired metadata together. A text scan of the candidates found no populated secret or local user path; `ps4NPTitleSecret` is empty. This is a source scan, not a review of binary content or external account access. `ProjectSettings.asset` contains Cloud project `817613ff-be35-4e46-bbec-4c321f148966`, organization `eerikaze`, with `cloudEnabled: 0`; owner confirmed on 2026-11-10 that the existing binding should be kept.
- Matrix error triage: `.preview/unity/baseline/editor-actions/report.json` records all nine errors as `psd-end-cover` drops, three each for Zoo, Tanwei and Tianhe. The recorded candidate was refused with the no-solid-floor message; zero commits and no first-render times were recorded. Repro from the report is the `psd-end-cover` case with three samples on each demo. `game/src/app/benchmark/editorActions.ts` moves the candidate eight cells in Y, while `prepare` supplies platform-edge supports at both locations but does not construct a floor there. This points to a fixture/placement-validation mismatch; whether the product should accept that supported cover without floor remains unverified. Exclude these drop rows from comparisons until a focused repro determines the correct behavior. The case is outside the first bench/train/save/scale feasibility slice. Retain the 4,180 budget misses and the separate Zoo release miss recorded above; do not reclassify them as passes.
- Phase 1 remains gated on the committed checkout, complete smoke and ledger dispositions. Runtime review identified TypeScript save defaults/repair and unsigned Mulberry32 with UTF-16 hashing as contracts to preserve. Web review found that the Phase 0 local split-WASM pack is not the W1 release contract.

### Verification hardening results

- `node --check tools/unity-web/smoke.mjs` and `node --check tools/unity-web/pack.mjs`: pass.
- `node --test unity/tests/smoke-negative.test.mjs`: pass, 1/1. The test replaces `OFL.txt` with `SIL OPEN FONT LICENSE` and asserts a digest failure plus replacement of a stale success report.
- `node tools/unity-web/smoke.mjs .preview/unity/verification-negative`: exit 1, expected `Packed digest mismatch: licenses/OFL.txt`; fresh report at that path. This used a copy of the prior pack with the one-line replacement.
- `node tools/unity-web/smoke.mjs .preview/unity/pack-v4-run`: pass against the prior pack; 24 files verified and both routes passed cold/reload. Report: `.preview/unity/pack-v4-run/smoke-report.json`. Manifest SHA-256 `3548d48ff19ae0f1501d712e23f13e18e08e368f94ebe47ab0216c91e60cc4fd`; reconstructed WASM SHA-256 `89658270b2f2af6648227d963dc1ee5e1f7df657037ed8a4d4536c075214c4cb`. This is a checker regression, not a committed checkout proof.
- `./unity/scripts/metro-unity.ps1 doctor -OutputDirectory .preview/unity/closeout-review`: exit 0; editor 6000.6.8f1 revision matches, WebGL module present, Node 24.15.0 matches. Report `.preview/unity/closeout-doctor.json` also reports the current project locked; use a separate checkout. The new build-input snapshot and comparison have not yet been exercised by a Unity build.

Next unresolved gate: a reviewed commit and the requested isolated checkout run. Ledger verification remains incomplete. Do not mark Phase 0 closed or start Phase 1 until those exit checks pass.


## Committed checkout replay (2026-11-10)

Owner confirmed keeping the existing Cloud binding. Source commit `7ad810fe1867fc85c1fdae21571949fddd943ce8`; detached checkout `C:/Users/ericp/Desktop/metro-phase0-7ad810fe`. The checkout had no `unity/Library` before the Unity sequence. Evidence paths below are relative to that checkout. Node 24.15.0; Unity 6000.6.8f1 (237b6593792b), WebGL module present. The final build reports `Dirty: false` and `InputsVerifiedAfterBuild: true`.

- `npm ci`, `npm run setup:all`, `npm run test:game`: pass; 3,092 tests. Logs: `.preview/unity/phase0-close/{npm-ci,setup-all,test-game}.log`.
- `./unity/scripts/metro-unity.ps1 doctor -OutputDirectory .preview/unity/phase0-close`, then `bootstrap`, `test -Mode EditMode`, `test -Mode PlayMode` with the same output directory: pass; one test in each mode. XML and editor logs are in that directory.
- First `build-web -Configuration Release -OutputDirectory .preview/unity/phase0-close`: **rejected** by input comparison, although Unity completed the build. Bootstrap/tests had stripped the committed URP runtime settings list, which the build restored. Retain `web-Release.inputs-before.json` and the build log as evidence. A prior checkout at `9d905b2c` similarly exposed four generated settings changes; those were reviewed and committed in `7ad810fe`.
- After that explicit Unity settings preparation, `./unity/scripts/metro-unity.ps1 build-web -Configuration Release -OutputDirectory .preview/unity/phase0-final`: pass with unchanged pre/post inputs; build report total 57,609,184 bytes. Input snapshot SHA-256 `d0821cf70dc8a39980bd47c86121f507d44923c3a9c949e601998c1a7c72c5cd`; provenance SHA-256 `0dc08605caf2475016d4e06bcfb930978aa14b530accf87b5380d7d0c4519f9f`. Per-input and output hashes are in the provenance. This second build used the Library created by the first attempt; it is not a first-build-with-empty-Library pass.
- `./unity/scripts/metro-unity.ps1 pack-web -Configuration Release -OutputDirectory .preview/unity/phase0-final` and `smoke-web` with the same flags: pass. Report `.preview/unity/phase0-final/smoke-report.json`; 24 files verified, `/game/` and `/game/en/` cold and reload pass. Manifest SHA-256 `6e18d9b8eabbc9817aa84d390fba7b3f11ffd4e2f18bc0a3443f5a9a76eb839e`; reconstructed WASM SHA-256 `89658270b2f2af6648227d963dc1ee5e1f7df657037ed8a4d4536c075214c4cb`.
- Copied that pack to `.preview/unity/phase0-negative/packed`, replaced `licenses/OFL.txt` with `SIL OPEN FONT LICENSE`, and ran `node tools/unity-web/smoke.mjs .preview/unity/phase0-negative`: expected exit 1, digest mismatch; fresh failed report in that directory.

Next unresolved gate: decide and implement a deterministic preparation step for the URP runtime-settings mutation so the first build after the required bootstrap/test sequence passes the input check from an empty Library. Verify the first feasibility-slice ledger rows before Phase 0 exit. Phase 1 remains gated until both are resolved.

## Phase 0 exit replay with explicit settings normalization

A second fresh detached checkout at `C:/Users/ericp/Desktop/metro-phase0-final` of `7ad810fe1867fc85c1fdae21571949fddd943ce8` began with no Unity Library. Commands were run serially from that checkout:

```powershell
npm ci
npm run setup:all
npm run test:game
$o = '.preview/unity/proof'
./unity/scripts/metro-unity.ps1 doctor -OutputDirectory $o
./unity/scripts/metro-unity.ps1 bootstrap -OutputDirectory $o
./unity/scripts/metro-unity.ps1 test -Mode EditMode -OutputDirectory $o
./unity/scripts/metro-unity.ps1 test -Mode PlayMode -OutputDirectory $o
git diff -- unity/Assets/Settings/UniversalRenderPipelineGlobalSettings.asset > "$o/urp-before-restore.diff"
git restore --source=HEAD -- unity/Assets/Settings/UniversalRenderPipelineGlobalSettings.asset
git status --porcelain
./unity/scripts/metro-unity.ps1 build-web -Configuration Release -OutputDirectory $o
./unity/scripts/metro-unity.ps1 pack-web -Configuration Release -OutputDirectory $o
./unity/scripts/metro-unity.ps1 smoke-web -Configuration Release -OutputDirectory $o
```

All passed; TypeScript: 3,092 tests; EditMode and PlayMode: one each. The restore explicitly reverses the known generated URP runtime list removal after tests, restoring committed bytes; status was clean before building. The first build from this Library then passed with inputs unchanged and `Dirty: false`. The pre-build snapshot SHA-256 is `d0821cf70dc8a39980bd47c86121f507d44923c3a9c949e601998c1a7c72c5cd`; provenance SHA-256 `91fdb37fda1af5deeb0aa4ad7b79b82056387eb7fa2fcee6f2db0fe074978636`, with all input and output digests in `.preview/unity/proof/web-Release.provenance.json`. Smoke verified 24 packed files, both locale paths cold and reload, with report `.preview/unity/proof/smoke-report.json`. Pack manifest SHA-256 `86579be3a2c14404b820d7ada4a88ccfab66883cf2e4f88283ea589539ff9ec1`; reassembled WASM SHA-256 `89658270b2f2af6648227d963dc1ee5e1f7df657037ed8a4d4536c075214c4cb`. Replacing the copied pack's OFL with `SIL OPEN FONT LICENSE` and running `node tools/unity-web/smoke.mjs .preview/unity/negative` failed as expected; report `.preview/unity/negative/smoke-report.json`.

The feasibility-slice ledger entries now identify verified TS source/tests and explicitly leave Unity parity and performance open. Nine baseline errors and the budget misses remain as described above. Phase 0 exit evidence is complete with the explicit normalization step; Phase 1 starts with A3, R1/R2 and W1. The next gates are imported fixture validation, a real C# v1 round trip, and Web artifact/routing contracts; Tianhe-scale measurements require original placeholder art and a controlled comparison.

### Phase 1 started

- Original crowd placeholder: `Assets/StationDesigner/Scripts/Feasibility/PlaceholderCrowdMesh.cs` constructs a shared geometric mesh from authored box dimensions, with an asymmetric shoulder marker and no borrowed crowd assets. `./unity/scripts/metro-unity.ps1 test -Mode EditMode -ProjectPath .preview/unity/placeholder-project -OutputDirectory .preview/unity/placeholder-test-retry` passed 2/2 including the mesh scale/asymmetry test. The first test copy included an unfinished runtime test and failed compilation; it was removed only from that disposable copy before the retry. This is a static stand-in, not an animated rig or a Tianhe workload measurement.
- W1 foundation: `node --test unity/tests/web-release-contract.test.mjs` passed 3/3. It covers pure route classification and release manifest constraints. Production serving, browser/HTTP checks and Web template remain open.
- A3 initial importer: `./unity/scripts/metro-unity.ps1 import-assets -Manifest unity/asset-recipes/fixture-manifest.json -ProjectPath .preview/unity/import-fixture-clean -OutputDirectory .preview/unity/import-fixture-final` passed for bench and Type A. Initial and repeat imports had identical generated file, metadata, wrapper and catalogue hash inventories; falsified bench digest was rejected before output changed. Evidence: `.preview/unity/import-fixture-{clean-run,repeat,negative,final}/` and `.preview/unity/import-fixture-hashes-{before,after,negative}.json`. Prefabs and catalogue are in the isolated project, not the locked live project. The general manifest/export contract, train clip/bounds and door comparison, Web review and clean-reference proof remain open.
- R1/R2 initial runtime: `node --test unity/tests/runtime-layering.test.mjs` passed 1/1; `./unity/scripts/metro-unity.ps1 test -ProjectPath .preview/unity/runtime-fixtures/project -OutputDirectory .preview/unity/runtime-fixtures -Mode EditMode` passed 5/5 on retry, XML and console in that directory. The first test compilation failed on a direct Newtonsoft reference in the test assembly and was corrected. Runtime boundaries and TS-derived RNG vectors are in place; the save reader/writer intentionally accepts only the empty v1 slice and fails closed for non-empty records. Real v1 repair, authored and demo save round trips, cross-engine exchange and IL2CPP remain open.
- Combined integration check: `node --test unity/tests/runtime-layering.test.mjs unity/tests/web-release-contract.test.mjs unity/tests/smoke-negative.test.mjs` passed 5/5. A fresh project copy of the combined Phase 1 source passed `./unity/scripts/metro-unity.ps1 test -Mode EditMode -ProjectPath .preview/unity/phase1-combined-project -OutputDirectory .preview/unity/phase1-combined` (5/5), then `./unity/scripts/metro-unity.ps1 import-assets -Manifest unity/asset-recipes/fixture-manifest.json -ProjectPath .preview/unity/phase1-combined-project -OutputDirectory .preview/unity/phase1-combined-import` passed. The earliest URP gate note above is superseded by the successful explicit-normalization replay. The next unresolved gate is Phase 1 feasibility: non-empty and cross-engine v1 save round trips, oriented/animated fixture visual validation, manifest-governed real Web routing, and an original-placeholder Tianhe-scale traversal/queue/render measurement.

## Phase 1 continuation — R2 grid repair, in progress (2026-11-10)

Source HEAD `7ad810fe1867fc85c1fdae21571949fddd943ce8` with pre-existing and new uncommitted Phase 1 changes. The authored fixture `video/demo-station.metro.json` SHA-256 is `fcf65e5e9bfccb085ae688e45d52da93382d4d894ea859b30f40e1935ec88712`. `node --input-type=module -e "import {readFileSync,writeFileSync} from 'node:fs'; import {parse,serialize} from './game/src/persistence/save.ts'; let src=readFileSync('video/demo-station.metro.json','utf8'),x=parse(src); console.log(x.ok, x.droppedCells,x.droppedModules,x.state.cells.length,x.state.modules.length,x.state.lines.length); writeFileSync('.preview/unity/oracle-demo.json',serialize(x.state,new Date('2020-01-02T03:04:05Z')));"` passed: zero dropped, 1,303 cells, 309 modules, one line; TypeScript serialized static records match the source exactly. The output is `.preview/unity/oracle-demo.json`.

`StationGridRepair` ports the grid filter separately from the save reader, including wall-offset panels, glass wall/curtain distinction and half-height stair flight points. A TypeScript `repairGrid` probe on the same small fixture used by `StationGridRepairTests` returned one dropped cell, one dropped module, and retained IDs `wall` and `stair`. `./unity/scripts/metro-unity.ps1 test -Mode EditMode -ProjectPath .preview/unity/phase1-combined-project -OutputDirectory .preview/unity/phase1-grid-repair-final` passed; `.preview/unity/phase1-grid-repair-final/EditMode.xml` includes the authored grid-count check and malformed-grid cases. This only checks grid repair counts and selection; it is not a full station read or cross-engine save round trip. The existing `StationSave` continues to refuse non-empty records.

Next unresolved gate: port the remainder of `toStateFrom` and the v1 reader/writer (including cell and module normalization, line and authored-day defaults), verify both requested cross-engine directions and fixed timestamp on the authored save, then exercise that parser under IL2CPP Web. Asset transaction, Worker and Tianhe workload remain open; Phase 1 remains open.

Line normalization is also isolated in `StationLineRepair`: the oracle command `node --input-type=module -e "import {repairLineRunning} from './game/src/sim/headway.ts'; console.log(JSON.stringify(repairLineRunning({cars:5,headwayProfile:{peak:59,offpeak:200.5,late:5000}})))"` returned formation 4 and headways 60/201/1200; the matching C# EditMode test passed. `./unity/scripts/metro-unity.ps1 test -Mode EditMode -ProjectPath .preview/unity/phase1-combined-project -OutputDirectory .preview/unity/phase1-line-repair` passed; evidence `.preview/unity/phase1-line-repair/EditMode.xml`. This helper is not yet connected to the fail-closed save reader; the R2 and later milestones above remain open.

## Phase 1 continuation — authored save oracle and day normalization

At source HEAD `7ad810fe1867fc85c1fdae21571949fddd943ce8` with uncommitted Phase 1 changes, `node tools/unity-parity/save-roundtrip.mjs prepare` passed and wrote `.preview/unity/save-parity/ts-write.json` and `oracle.json`, using fixed timestamp `2020-01-02T03:04:05.000Z`. `node tools/unity-parity/save-roundtrip.mjs verify` failed as expected because `.preview/unity/save-parity/cs-from-ts.json` does not yet exist; no cross-engine pass is claimed. The harness checks full normalized semantic content, including cells, modules, lines and authored text. Its final reverse-path step remains pending.

`StationDayRepair` ports service, peak, demand and calendar normalization as a separate helper. The TypeScript oracle for an inverted service/peak fixture, out-of-range demand and invalid epoch returned service 25020–25920; peak windows 84540–85440 and 85440–86340; demand 2.5/0.78/0.4; epoch 2025-02-28. `./unity/scripts/metro-unity.ps1 test -Mode EditMode -ProjectPath .preview/unity/phase1-combined-project -OutputDirectory .preview/unity/phase1-day-repair` passed 10/10, including the corresponding C# test; report `.preview/unity/phase1-day-repair/EditMode.xml`. The helper is not connected to `StationSave` and does not establish a real save round trip. Next gate: complete the state and module normalization and integrate all helpers into the non-empty candidate reader/writer; then run both directions and the Web build.

`StationSaveCandidate.InspectV1` now combines the partial grid, line, authored-day, city and level-base normalization into an explicitly non-committable candidate; it exposes no writer while geometry/module repairs remain incomplete. `./unity/scripts/metro-unity.ps1 test -Mode EditMode -ProjectPath .preview/unity/phase1-combined-project -OutputDirectory .preview/unity/phase1-save-candidate-output` passed; test output `.preview/unity/save-parity/cs-candidate.json`. A Node deep equality comparison of that candidate against `parse(video/demo-station.metro.json).state` passed for name, nameEn, cityStyle, seed, levelBase, storeyHeight, cells, modules, lines, service, peaks, demand and calendar. This verifies only the authored fixture's candidate, not general repair or either save-write direction. The requested C# writer, reverse round trip and IL2CPP Web parser remain open.

### Local release Worker result

At source baseline `7ad810fe1867fc85c1fdae21571949fddd943ce8` with Phase 1 working-tree changes: `node tools/unity-web/pack-release.mjs C:/Users/ericp/Desktop/metro-phase0-final/.preview/unity/proof/web-Release .preview/unity/phase1-local-release/artifact` and `node tools/unity-web/smoke-release.mjs .preview/unity/phase1-local-release` passed. `.preview/unity/phase1-local-release/release-smoke-report.json` records `/game/` and root mounts, Chinese and English, an English Tianhe demo URL, Brotli WASM MIME/bytes/decoded digest, HEAD 200, missing asset 404 and slash redirect 308. Manifest SHA-256 `1f3e7a98ac521fc1b1e95e0b17eab15c331fcf67b084bf93067c23cce43ffdc9`, release ID `7ad810fe1867fc85c1fdae21571949fddd943ce8-7ccbe6cc0e0b6c0d`. `node --test unity/tests/web-release-contract.test.mjs unity/tests/web-release-worker.test.mjs` passed 5/5. The demo ID reaches shell config but is not acknowledged or loaded by C#; production switch, actual template, legacy fallback, retained releases and HTTPS staging remain open. Early smoke failures exposed a Windows temp-directory issue and raw-client encoding negotiation; final evidence is the passing fresh report.

The reproducible candidate-only comparison is now `node tools/unity-parity/save-roundtrip.mjs inspect` after generating `.preview/unity/save-parity/cs-candidate.json` with the candidate EditMode test; it passed all listed document-field comparisons. `prepare`, `verify`, and `verify-final` are separate modes; `verify` requires both C# output documents and repair-count reports, and `verify-final` additionally requires the reverse-path C# output. Those full-round-trip artifacts do not yet exist.

### Import transaction and fixture review

At HEAD `7ad810fe1867fc85c1fdae21571949fddd943ce8`, with Phase 1 changes in the working tree, `./unity/scripts/metro-unity.ps1 import-assets -Manifest unity/asset-recipes/fixture-manifest.json -ProjectPath .preview/unity/import-fixture-clean -OutputDirectory .preview/unity/import-motion-first` passed. Importer SHA-256 `93d223d228ef97037d0f237959d7baa3d5d9ade27737b1ace5c42bfa38845d61`, manifest SHA-256 `50e2eee93f8d490e170cff7f1b609f4535a1948e9f097653367e10a1ee91859d`, motion oracle SHA-256 `3cede0468c7feda469b690f75eb7d35bf2f3b203e53164615b5a374bae573597`. Staged and delivered checks cover bench Front at four facings and both Type A door clips at 0, 0.18 and 1 seconds, all 40 leaves within 1 mm of the Three.js oracle.

`node tools/unity-assets/test-import-transaction.mjs .preview/unity/import-fixture-clean .preview/unity/import-transaction-negative-motion` passed: it supplied a changed valid first bench and a digest-matching second bench GLB declared as a train; Unity rejected the latter during staging. SHA-256 inventories show all 25 prior generated files, including models, prefab and model metadata/GUIDs and catalogue, unchanged. Evidence and full Editor log are in `.preview/unity/import-transaction-negative-motion/`. Delivery rollback handles caught write failures; crash or power-loss atomicity is not proven.

Imported-catalogue review Web builds were made with the pinned Unity Editor and `-batchmode -nographics -quit -buildTarget WebGL -projectPath <absolute .preview/unity/import-fixture-clean> -executeMethod Metro.AssetExample.ReviewImportedFixtures.BuildWeb -metroReview train|bench -metroReviewOut <absolute .preview/unity/import-review-train|bench/web> -logFile <output build.log>`. Both passed. `node tools/unity-assets/check-web.mjs .preview/unity/import-review-train train` and the same command with `import-review-bench bench` passed; screenshots and pixel reports are in those directories and were visually inspected. The Web train shows a sampled open pose; continuously animated Web doors remain to be exercised. Phase 1 remains open.

### Tianhe synthetic Web measurement

`node tools/unity-feasibility/measure-web.mjs .preview/unity/feasibility .preview/unity/feasibility/visible-run-N` passed three serial captures, N=1,2,3, from the newer `web-release-visible` build at dirty HEAD `7ad810fe1867fc85c1fdae21571949fddd943ce8`. Raw reports and screenshots are in those three directories; graph and WASM hashes and measured rates/stalls are in the [performance reference](../../.agents/skills/metro-repo/references/performance.md). An attempted capture against the older `web-release-final` build failed its screenshot check and remains at `.preview/unity/feasibility/run-1/`. This actual-graph synthetic walk/queue/placeholder render is **not** a matched TS World comparison and omits full station geometry. The comparison gate and explanation of the first-phase 759–825 ms frame stalls remain open.

### R2 supported-subset reader (still not the authored-save gate)

At dirty HEAD `7ad810fe1867fc85c1fdae21571949fddd943ce8`, `StationSaveV1.Read` and `Write` now support a non-empty safe subset, using the separately tested grid, cell, line and day normalizers. Unsupported sign layout, missing ad poster, unstocked room and bridge support migrations throw before returning a document. The authored save contains signs and therefore still correctly fails closed. This is not the requested authored-save or Web round trip.

`./unity/scripts/metro-unity.ps1 test -Mode EditMode -ProjectPath .preview/unity/phase1-combined-project -OutputDirectory .preview/unity/phase1-save-subset` passed; XML is in that directory. The test writes `.preview/unity/save-parity/cs-simple.json` from a non-empty fixture with a bench, Unicode name and one off-grid cell, with fixed timestamp. A TypeScript `parse` comparison of that output against `parse` of the original test fixture passed full state equality: source dropped one cell, the output dropped zero on reread, and one cell and one module remained. This is one C# → TS path on a small supported fixture, not the two requested paths on the authored save. `node tools/unity-parity/save-roundtrip.mjs inspect` separately confirms the non-committable authored candidate against TS. The next gate remains sign/module repair, the authored-save writer and both cross-engine directions, then IL2CPP Web.

Latest combined R2 check: `./unity/scripts/metro-unity.ps1 test -Mode EditMode -ProjectPath .preview/unity/phase1-combined-project -OutputDirectory .preview/unity/phase1-save-final` passed 15/15; XML is in that directory. `node tools/unity-parity/save-subset-check.mjs` passed and wrote `.preview/unity/save-parity/subset-report.json`, comparing a supported C#-written non-empty station with TS parsing and serialization, fixed timestamp and repair counts. `node tools/unity-parity/save-roundtrip.mjs inspect` passed the authored *candidate* comparison. Cell normalization additionally passed 4,374 TS-derived shape-pair/face cases plus four edge cases in `.preview/unity/cell-normalization-run/EditMode.xml`. These checks do not implement sign backfill or the authored-save writer.

Combined Node regression command `node --test unity/tests/runtime-layering.test.mjs unity/tests/web-release-contract.test.mjs unity/tests/web-release-worker.test.mjs unity/tests/smoke-negative.test.mjs` passed 7/7. The requested authored save, continuous Web door animation, acknowledged Web demo loading and matched Tianhe comparison remain unresolved; no Phase 1 exit is claimed.

### R2 authored-save milestone — Editor and Web proof

At HEAD `7ad810fe1867fc85c1fdae21571949fddd943ce8` with uncommitted source, `node tools/unity-parity/save-roundtrip.mjs prepare` generated the fixed-time TS input. `./unity/scripts/metro-unity.ps1 test -Mode EditMode -ProjectPath .preview/unity/phase1-combined-project -OutputDirectory .preview/unity/phase1-authored-sign-oracle` passed 20/20; it read the authored and TS-written saves and wrote C# results and repair-count reports under `.preview/unity/save-parity/`. `node tools/unity-parity/save-roundtrip.mjs verify` passed TS → C# → TS and wrote the TS output for the reverse path; after the second C# read, `node tools/unity-parity/save-roundtrip.mjs verify-final` passed C# → TS → C#. Full normalized state comparison includes all 1,303 cells, 309 modules, one line, authored text, station metadata and day settings; source repair counts were zero/zero, and `savedAt` was fixed at `2020-01-02T03:04:05.000Z`. The initial Editor attempt exposed a mutation-during-enumeration error; it was fixed, and the intermediate retry had one intentionally skipped reverse test before its TS input existed. The final run had no skips or failures.

The same `StationSaveV1` reader/writer was built under IL2CPP using the pinned Unity Editor in the isolated project: `-batchmode -nographics -quit -buildTarget WebGL -projectPath <absolute .preview/unity/phase1-combined-project> -executeMethod Metro.Editor.BuildSaveParityWeb.Run -saveParityOut <absolute .preview/unity/save-web-final/web> -logFile <absolute .preview/unity/save-web-final/build.log>`. `node tools/unity-parity/check-save-web.mjs .preview/unity/save-web-final` passed; fresh report and C# output are `.preview/unity/save-web-final/web-save-report.json` and `cs-web-output.json`. Fixture SHA-256 `fcf65e5e9bfccb085ae688e45d52da93382d4d894ea859b30f40e1935ec88712`, output SHA-256 `00e6b9136aa720d8e2bdea80657395ebca6317781bb84b21c668d703613e455f`, Web WASM SHA-256 `fe3c6cf3185c3faba26e67e2171947f3cbd536cc51969bdf35109b6ee028c794`. Reader SHA-256 `a72cf4ff819000eb6c9046b73910cb2d205ea052bb7a405b0178f1aa4fea3908`, sign-repair SHA-256 `f1ffc257526acacc48220af74037b40542394c06a61c6030480c694943825402`. Explicit-board sign normalization passed the four authored layouts and a TS-generated duplicate-ID/overlap/scale case. Unsupported legacy sign layouts, ad poster backfill, unstocked rooms and bridge support repair still fail closed; this fixture pass does not claim general v1 compatibility.

Next unresolved Phase 1 gates: continuous Type A door animation in the imported Web review, C# acknowledgement/load of the demo route, and an equivalent TS/Unity Tianhe graph, queues and rendering comparison with startup-stall investigation. Production release remains out of scope.

### Imported train animation in Web

At dirty HEAD `7ad810fe1867fc85c1fdae21571949fddd943ce8`, the isolated imported-catalogue project was rebuilt with the pinned Unity Editor using `-batchmode -nographics -quit -buildTarget WebGL -projectPath <absolute .preview/unity/import-fixture-clean> -executeMethod Metro.AssetExample.ReviewImportedFixtures.BuildWeb -metroReview train -metroReviewOut <absolute .preview/unity/import-review-train-animation/web> -logFile <absolute .preview/unity/import-review-train-animation/build.log>`. `node tools/unity-assets/check-train-animation-web.mjs .preview/unity/import-review-train-animation` passed. Browser diagnostics were attached before navigation; the QA scene continuously samples the imported `OpenPlus` and `OpenMinus` clips, reports real leaf transforms and captures closed/open screenshots. On each side the selected leaf moved 0.7026 m while the other side stayed at zero; image differences were 15,584 and 3,689 pixels, respectively. Report and four screenshots are in `.preview/unity/import-review-train-animation/`; the plus-open screenshot was visually inspected. Playback source SHA-256 `4b1fb3fa25d1897c6cabf266cf2b227915b361d7d8bfd3dbfb15ec6814a9c411`, review builder SHA-256 `a7912ab085ac466dbac1eecfbbb3caa590102c32d236e41385050f2863453e56`, WASM SHA-256 `29a94c720dcd0a41a91b5e069f2df7e861dee2a7a45854bf8f9e567a0e2136c6`. This closes the continuous motion gap for the two representative sides; the full 40-leaf sampled oracle and transaction regression are recorded above.

A Three.js synthetic counterpart was also run three times with `node tools/unity-feasibility/measure-ts-web.mjs .preview/unity/feasibility/ts-matched-N` (N=1,2,3). Fresh reports/screenshots and source hashes are in those directories. It uses the same graph bytes, population, adjacency/queue algorithm and six instancing batches; see the performance reference for rates and limits. It is not the recorded TS World workload and the first-phase measured ticks and resulting queue counts differ from Unity, so this is not a matched gameplay or causal performance comparison. A fixed-tick state check and matched station rendering are the next feasibility gate.

The authored round-trip test was subsequently made self-contained: `./unity/scripts/metro-unity.ps1 test -Mode EditMode -ProjectPath .preview/unity/phase1-combined-project -OutputDirectory .preview/unity/phase1-authored-integrated` passed 19/19 without skipped tests. Its one test invokes the pinned Node oracle to prepare, compare the first two paths, generate the reverse-path input, and verify the final C# result in sequence; it no longer relies on a previous run's ignored-test output. XML is `.preview/unity/phase1-authored-integrated/EditMode.xml`.

Fixed-step synthetic parity: with the pinned Editor, `-batchmode -nographics -quit -projectPath <absolute .preview/unity/tianhe-feasibility-project> -executeMethod Metro.Feasibility.Editor.CheckFixedTicks.Run -fixedTickOut <absolute .preview/unity/feasibility/fixed-cs.json> -logFile <absolute .preview/unity/feasibility/fixed-cs-retry.log>` passed after an initial harness attempt failed to invoke `Awake` in EditMode. `node tools/unity-feasibility/check-fixed-ticks.mjs` then passed 512-tick exact state comparison and wrote `fixed-ts.json`; it also verifies that its step implementation is identical to the measured TS browser workload. The counts and array hashes are in those JSON files. The observed timing windows still differ in tick counts, and the synthetic workload remains distinct from TS World and full station rendering.

### Local Worker with C# Zoo acknowledgement and authored-save parser

At dirty HEAD `7ad810fe1867fc85c1fdae21571949fddd943ce8`, `node tools/unity-parity/record-zoo-save.mjs` generated the real normalized Zoo v1 fixture. An isolated Editor invocation of `Metro.Editor.InspectDemoSave.Run -demoSave <absolute .preview/unity/zoo-v1.metro.json>` passed; a TS deep comparison of its C# output with the source state passed for 14,066 cells, 4,299 modules and one line, with zero grid drops.

`Metro.Editor.PrepareZooRoute.Run` in `.preview/unity/phase1-combined-project` attached the Zoo document probe and authored-save QA component to the disposable Bootstrap scene. `./unity/scripts/metro-unity.ps1 build-web -Configuration Release -ProjectPath .preview/unity/phase1-combined-project -OutputDirectory .preview/unity/zoo-route-final-build` passed with pre/post input hashes verified; snapshot SHA-256 `aa81504b5f57c719ce9d491ec95e5daf1ee68ba4ce0641c167ac484e2542695c`. `node tools/unity-parity/check-save-web.mjs .preview/unity/zoo-route-final-build web-Release` passed the full authored-save semantic comparison under IL2CPP; report `.preview/unity/zoo-route-final-build/web-save-report.json`. The current reader SHA-256 is `49f86900e5fa6a15c7445a22cd2adbb02b07c1473e71ed2a0fb9720cf924c654`.

`node tools/unity-web/pack-release.mjs .preview/unity/zoo-route-final-build/web-Release .preview/unity/zoo-route-final-release/artifact`, followed by `$env:METRO_SMOKE_REQUIRE_ZOO_ACK='1'; $env:METRO_SMOKE_REQUIRE_SAVE_PARITY='1'; node tools/unity-web/smoke-release.mjs .preview/unity/zoo-route-final-release`, passed. The fresh report `.preview/unity/zoo-route-final-release/release-smoke-report.json` records Chinese and English paths, `/game/en/zoo` and `/en/zoo` with C# acknowledgements after the real Zoo v1 document was read, the authored-save parser result, Brotli WASM MIME/bytes, HEAD, missing-asset 404 and redirect checks. Release ID `7ad810fe1867fc85c1fdae21571949fddd943ce8-dc7025d05cd4dd35`; manifest SHA-256 `c1d33e442dfe66010f800a8ae18d247606031c6932d73620c6c09a2bec6d8571`; encoded WASM SHA-256 `c89981e158c6989a01e129399312f7f9303dbbb65beeaf1bfec1f9fd0b241729`; decoded SHA-256 `5b0d3afd46e909f5f1f5208602447642bc20ed744c8ca6377de5be2be792fc24`. An earlier pack attempt at `.preview/unity/zoo-route-release/` failed on a transient Windows rename EPERM; a fresh retry passed. The Zoo document is retained by the QA component but the Bootstrap scene does not render or simulate the Zoo station. Real gameplay load and all-demo compatibility, legacy routing, staging/HTTPS and production release remain later gates.

Startup stall investigation: `node tools/unity-feasibility/profile-startup.mjs` passed as a separate diagnostic and wrote `.preview/unity/feasibility/startup-profile/startup.cpuprofile`. A self-time aggregation attributed ~723 ms to `_emscripten_glGetProgramiv` and ~40 ms to `_emscripten_glGetShaderiv` during startup, consistent with synchronous WebGL program/shader initialization. It does not identify the exact GPU-side cause and does not resolve the 759–825 ms measured first-phase misses. Those misses remain an open feasibility gate.

### Fresh integrated verification and remaining Phase 1 gate

With the current uncommitted source at HEAD `7ad810fe1867fc85c1fdae21571949fddd943ce8`, a new `.preview/unity/phase1-final-test-project` was copied from `unity/Assets`, `Packages` and `ProjectSettings` with no Library. `./unity/scripts/metro-unity.ps1 test -Mode EditMode -ProjectPath .preview/unity/phase1-final-test-project -OutputDirectory .preview/unity/phase1-final-test` passed 19/19 with no skips; its authored-save test runs the two-engine oracle in sequence. `node --test unity/tests/runtime-layering.test.mjs unity/tests/web-release-contract.test.mjs unity/tests/web-release-worker.test.mjs unity/tests/smoke-negative.test.mjs` passed 7/7. `node tools/unity-parity/save-subset-check.mjs` and `node tools/unity-feasibility/check-fixed-ticks.mjs` passed. Exact source and artifact hashes for individual browser/build evidence are recorded in the sections above; these working-tree changes remain uncommitted.

All four requested workstreams have concrete evidence, including the authored fixture and both imported door sides in Web. Phase 1 is **not closed**: the synthetic comparison does not reproduce the TS World or full station geometry and its timing windows differ; Unity still shows the measured startup shader-program stall. Full v1 compatibility still fails closed for legacy sign layouts, missing ad posters, unstocked room backfill and bridge supports. The local Worker proves Zoo document acknowledgement but not a rendered/playable Zoo or all demo routes. The next unresolved gate is a controlled representative gameplay/render workload and a startup-stall remedy with remeasurement; do not describe the synthetic result as a TS World speedup or promote production routing from this proof.

The controlled unlit-placeholder ablation used the same Unity graph/queue workload and hardware; three serial `node tools/unity-feasibility/measure-web.mjs .preview/unity/feasibility .preview/unity/feasibility/unlit-run-N web-release-unlit` runs (N=1,2,3) recorded 390/399/402 ms first-phase maximum frames and 394/403/406 ms initialization long tasks. Evidence and hashes are in `.preview/unity/feasibility/unlit-run-{1,2,3}/`; the [performance reference](../../.agents/skills/metro-repo/references/performance.md) retains the comparison and its visual/workload limits. The result improves on the lit synthetic spike but still exceeds the proposed 200 ms stall target. The Phase 1 startup feasibility gate remains open.


## Zoo gate comparison continuation

At dirty HEAD `7ad810fe1867fc85c1fdae21571949fddd943ce8`, `node tools/unity-parity/zoo-gate-oracle.mjs` generated a seven-tick trace from the actual Zoo TS World and its graph/A* path through `gate-243`, with seed 7654321, one injected passenger and ambient spawning disabled. `./unity/scripts/metro-unity.ps1 test -Mode EditMode -ProjectPath .preview/unity/phase1-final-test-project -OutputDirectory .preview/unity/zoo-gate-slice` passed 20/20 including a C# comparison of each tick, queue/lane/cooldown, wait count and position. The C# implementation only covers an unobstructed one-passenger path and does not port crowd collision, replanning or general World behavior.

`node tools/unity-parity/build-zoo-ts.mjs` built the TS comparison, and the pinned Editor invoked `Metro.Editor.BuildZooGateSlice.Run` in `.preview/unity/phase1-final-test-project` with `-zooShader unlit` or `lit` and `-zooGateOut <absolute .preview/unity/zoo-gate-unlit|lit/web>`. The two builds use the real C# Zoo save reader and actual Zoo solid-cell/gate positions, but render them as simple instanced proxies. `node tools/unity-parity/check-zoo-gate.mjs .preview/unity/zoo-correctness-unlit .preview/unity/zoo-gate-unlit/web` and the corresponding lit command passed the seven real pointer clicks and TS oracle outcomes before timing; JSON, source hashes and screenshots are in those evidence directories. The browser viewport, canvas position and size, camera framing, seed and click count match. These are not the production TS renderer or full Unity station; no complete playable Zoo is claimed.

`node tools/unity-parity/measure-zoo-proxy.mjs .preview/unity/zoo-gate-<unlit|lit>/web .preview/unity/zoo-perf-final-<unlit|lit>-N` passed three serial runs per shader, N=1,2,3. Source/artifact hashes, queue outcomes, cold long tasks and seven warmed pointer-to-ack/two-rAF samples are in each report. `node tools/unity-parity/profile-zoo-startup.mjs .preview/unity/zoo-gate-unlit/web .preview/unity/zoo-profile-unlit` produced a separate CPU profile. The [performance reference](../../.agents/skills/metro-repo/references/performance.md) records results and explicitly separates the 1.27–1.98 s cold Unity tasks from the warmed interaction samples. These measurements are bounded proxy evidence; the proposed 200 ms interaction threshold is not a cold-start threshold and is not a full-game pass.

Next unresolved gate: replace proxies with the production TS and ported Unity station rendering and full passenger/queue behavior, repeat the same Zoo interaction, then run a genuinely matched Tianhe-scale workload. The earlier 512-tick Tianhe synthetic parity and synthetic timing remain useful but do not establish this gate. Phase 1 remains open.

### Compatibility and exit assessment

| Gap | Current behavior and evidence | Next required check |
| --- | --- | --- |
| Legacy sign layouts | `StationSignRepair` handles explicit front/back boards but throws for legacy component-only layouts; see `StationSignRepairTests` and `.preview/unity/phase1-authored-sign-oracle/`. | Port legacy split/default and compare repaired layouts with TS, including authored Unicode. |
| Missing ad posters | `StationSaveV1.Read` throws before returning a document when a billboard, TV or bus stop lacks a poster. | Port the TS deterministic ID/shape-based poster backfill and compare slugs and saved output. |
| Unstocked rooms | The reader refuses unstocked shop, retail and booth records. | Port `ensureRoomFurniture`, including booth furniture placement and repair order. |
| Bridge supports | The reader refuses bridge tracks and bridge-owned pillars. | Port `syncBridgePillars`, including removed IDs, occupancy and stale-support deletion. |
| Other demo routes | The local Worker classifies Zoo, Tanwei and Tianhe routes, but the current C# probe acknowledges only a normalized Zoo document; Tanwei and Tianhe gameplay are not loaded or rendered. | Load, acknowledge and visually verify each real demo at both locale paths, preserving the production route policy. |
| Other v1 saves | The authored save and normalized Zoo pass the checked fixtures; unsupported cases deliberately fail closed. | Run both cross-engine directions and Web/IL2CPP on all demos plus legacy and malformed saves, with repair counts and failed-import atomicity. |

The migration index's Phase 1 exit calls for imported asymmetric geometry, bench/gate and articulated train, a cleared animated rig, real save parsing, representative graph/geometry load and main-thread cost, with red gates resolved. The current evidence covers the reviewed asset fixtures, a static original crowd placeholder, the authored save, and bounded synthetic/Zoo proxy runs. It does **not** yet prove an animated cleared rig, the full Zoo renderer and passenger World, a matched Tianhe gameplay workload, or an accepted representative startup result. Phase 1 stays open; no production switch is authorized or performed by these checks.

### Tianhe gate and full-document Web attempt

At dirty HEAD `7ad810fe1867fc85c1fdae21571949fddd943ce8`, `node tools/unity-parity/record-tianhe-save.mjs` generated the normalized Tianhe v1 document (151,852 cells, 76,438 modules, three lines), SHA-256 `efc73693ef4606fe7df7ba7db93bbab2fa871ae7457fd83776b324ca2a63654e`. The pinned Editor, using `.preview/unity/phase1-combined-project` and `-batchmode -nographics -quit -executeMethod Metro.Editor.InspectDemoSave.Run -demoSave <absolute .preview/unity/tianhe-v1.metro.json> -logFile <absolute .preview/unity/tianhe-read.log>`, passed; `.preview/unity/tianhe-v1.metro.json.cs.json` parsed back to the same TS state with zero grid drops. This is Editor evidence, not a Web load or gameplay pass.

`node tools/unity-parity/tianhe-gate-oracle.mjs` generated the real TS World A* route and seven-tick trace through `gate-new-574`, seed 7654321, ambient spawning disabled. `./unity/scripts/metro-unity.ps1 test -Mode EditMode -ProjectPath .preview/unity/phase1-final-test-project -OutputDirectory .preview/unity/tianhe-gate-slice` passed 21/21; XML is `.preview/unity/tianhe-gate-slice/EditMode.xml`. The C# gate slice matches that one path, not general passenger behavior.

`node tools/unity-parity/build-tianhe-ts.mjs` passed. The pinned Editor built the attempted Tianhe proxy with `-batchmode -nographics -quit -buildTarget WebGL -projectPath <absolute .preview/unity/phase1-final-test-project> -executeMethod Metro.Editor.BuildZooGateSlice.Run -station tianhe -zooShader unlit -zooGateOut <absolute .preview/unity/tianhe-gate-unlit/web> -logFile <absolute .preview/unity/tianhe-gate-unlit/build.log>`. Build succeeded; WASM SHA-256 `09eaca99976f392d42207c7273f895de8c360b6fbadad1da753a4c5e8fcae4f1`, data SHA-256 `af8bccfabfe03edd9a999e034aaaae2c5349650dc51237365ca97952eed11606`, graph SHA-256 `52003505ee5da485bc74a375eac3b58bd7741f2fe81f2d52a7a01e40b30593e2`. `node tools/unity-parity/check-tianhe-gate.mjs .preview/unity/tianhe-gate-correctness` failed on a 60-second CDP timeout; after increasing the probe timeout, `node tools/unity-parity/check-tianhe-gate.mjs .preview/unity/tianhe-gate-correctness-retry` also failed. The retry's `chrome-unity-29652.log` records `abort("OOM")` and failure to grow the WebAssembly heap. The report retains the seven TS outcomes: actual gate queues at tick 3, serves at tick 4, and the passenger exits at tick 7; the separate synthetic crowd ends at tick 7 with 323 queued, 371 admitted and 48 completed. There are no Unity outcomes to compare. Source hashes and viewport are in `correctness-report.json` in each directory.

This attempt couples the full Tianhe document, 41,738 layer-cell proxies and gate proxies with 5,171 separately simulated synthetic placeholder agents; it is not production geometry or a full World port. Since Unity aborts before the interaction, no matched frame time, achieved tick rate, warmed latency or queue parity is claimed. The reader currently creates and serializes multiple complete JSON trees (`StationSaveCandidate.cs` SHA-256 `18e1fb0c56b8e18803dcb3b9780000041815faa4795faa1a56530876dcd6aa0b`); those copies are a plausible allocation source, not yet a measured attribution. Next gate: profile and reduce peak allocations while preserving every repair/default and transactional failure rule, rerun the Web load and compare queue outcomes before collecting three serial matched timings. The normalized Tianhe Editor read narrows the demo-route gap above, but Tianhe Web loading and the other demo routes remain unverified.

After these edits `node --test unity/tests/runtime-layering.test.mjs unity/tests/web-release-contract.test.mjs unity/tests/web-release-worker.test.mjs unity/tests/smoke-negative.test.mjs` passed 7/7 and `git diff --check` passed with only CRLF normalization warnings. Phase 1 remains open.

### Phase 1 playable-station exit

The current Phase 1 exit is the small station browser playthrough in the
[execution order](README.md#execution-order): place a floor tile and fare gate,
run a passenger from entrance through the queue and gate to the platform and
Type A train, save, reopen, and run again through player controls in one browser
session. The Zoo and Tianhe proxy checks above are supporting experiments, not
that playthrough. The subsequent browser pass and its limits are recorded below.

The Tianhe Web heap failure, its allocation investigation, and the proposed
performance targets carry into Phase 2 expansion. Investigate startup, memory,
or interaction failures in Phase 1 when they prevent the small station loop from
being played; a matched Tianhe workload and its performance results are not
prerequisites for the Phase 1 playthrough.

#### First playable browser pass

At dirty HEAD `c2f6fd400562852929c1414dab4685040a293f6c`, Unity
`6000.6.8f1 (237b6593792b)` built the FirstPlayable scene in the scratch project
`.preview/unity/first-playable-scene-20261110-210818/project`. The successful
build, pack, browser report, downloaded save and capture are under
`.preview/unity/first-playable-scene-20261110-210818/door-target/`. From the
repository root the commands were:

```powershell
./unity/scripts/metro-unity.ps1 build-web -Scene FirstPlayable -Configuration Release -ProjectPath .preview/unity/first-playable-scene-20261110-210818/project -OutputDirectory .preview/unity/first-playable-scene-20261110-210818/door-target
./unity/scripts/metro-unity.ps1 pack-web -Configuration Release -ProjectPath .preview/unity/first-playable-scene-20261110-210818/project -OutputDirectory .preview/unity/first-playable-scene-20261110-210818/door-target
node tools/unity-web/smoke-first-playable.mjs .preview/unity/first-playable-scene-20261110-210818/door-target
```

`first-playable-report.json` records an incomplete-route refusal, the ordered
walk, queue, gate, platform and board stages on both runs, restored placements,
invalid-import preservation, no browser errors, and 0.70 m measured door-leaf
movement. `first-playable-boarding.png` captures the first boarding and
`first-station.metro.json` is the downloaded save. The second run uses a fresh
page in the same browser session. The earlier `rebuild` run exposed a stripped
shader, and `shader-retry` exposed a missing Animator; `door-check-retry`
exposed the wrong animation root. The passing build fixes all three.

The final scratch-project tests passed 24/24 EditMode and 1/1 PlayMode with no
skips (`first-playable-scene-20261110-210818/final-tests/`). A separate fresh
copy regenerated the checked-in scene without changing its bytes; both scene
SHA-256 values were `42814abd329e5f854d18da7d26497f0ac6da12b3e25e918264ae0bf8e069f183`.
That copy's first build failed in Unity's Input System IL post-processor; the
retry succeeded and its packed build passed the same browser check. The retry
build, report, save and capture are in
`.preview/unity/first-playable-repeat-20261110-213009/retry/`. Its build command
was `./unity/scripts/metro-unity.ps1 build-web -Scene FirstPlayable -Configuration Release -ProjectPath .preview/unity/first-playable-repeat-20261110-213009/project -OutputDirectory .preview/unity/first-playable-repeat-20261110-213009/retry`;
pack and browser-check commands use that same project and output directory.

The slice has a fixed short route, one legal tile/gate slot, a single passenger,
and a static original placeholder. It does not yet offer general construction,
pathfinding, crowd interaction, multiple services, full save compatibility, or
the larger demo stations. Those and the Tianhe heap/performance work remain in
expansion; this browser pass is not a performance or parity result.

### Fresh-source baseline before two-layout expansion

A fresh copy of `Assets`, `Packages` and `ProjectSettings` at dirty HEAD
`c2f6fd400562852929c1414dab4685040a293f6c` was exercised at
`.preview/unity/phase2-baseline-20261110-214348-991/`. Unity was
`6000.6.8f1 (237b6593792b)` with WebGL and Node was `24.15.0`. The step 5
commands in [05-first-playable.md](05-first-playable.md#5-generate-test-and-build)
were used. Bootstrap, 24 EditMode tests and one PlayMode test passed. The first
release player build succeeded inside Unity but the wrapper rejected it because
`Assets/Settings/UniversalRenderPipelineGlobalSettings.asset` changed during
the build. The pre-build SHA-256 was `f074f70005181226c7614cbfb06b064e692c1032763bef94ccf334d91d0056d0`;
its exact bytes were recovered from the earlier `first-playable-core-20261110-210551`
scratch project. The build restored the known 14-entry URP runtime settings
list; the before/after diff is `urp-build-drift.diff`. The after bytes match the
source asset. This is the documented URP normalization, not an approval to
ignore arbitrary drift.

Separately, Unity import changed `ProjectSettings.asset` from an empty
`preloadedAssets` list to the existing `InputSystem_Actions.inputactions` asset
(GUID `052faaac586de48259a63d0c4782560b`); `settings-difference.diff` records
that difference. It existed in the input snapshot and did not drift during the
successful retry. No main-project setting was changed. From the repository root:

```powershell
$run = '.preview/unity/phase2-baseline-20261110-214348-991'
$project = (Resolve-Path "$run/project").Path
$out = "$run/retry"
./unity/scripts/metro-unity.ps1 build-web -Scene FirstPlayable -Configuration Release -ProjectPath $project -OutputDirectory $out
./unity/scripts/metro-unity.ps1 pack-web -Configuration Release -ProjectPath $project -OutputDirectory $out
node tools/unity-web/smoke-first-playable.mjs $out
```

The retry's `web-Release.provenance.json` records dirty HEAD, pinned Editor,
Release, `Assets/StationDesigner/Scenes/FirstPlayable.unity`, and
`InputsVerifiedAfterBuild: true`; its SHA-256 is
`ae4812a299750ccc9062ea2aea28f0672e4763ad739b7982f4e03bf870d4eb13`.
The packed manifest SHA-256 is
`1e13f7ce83f4ae335b852fd062252b348133730855e2def7180690d4e8d5da48`.
`retry/first-playable-report.json`, `first-playable-boarding.png`, and the
browser download record the original placement, ordered gate/boarding stages,
reopen and repeat, and invalid import. The browser checker had been extended
concurrently; its original case ran unchanged against this baseline, and the
new layout case was skipped because the baseline has no second-layout state.

### Phase 2: two committed approaches

The bounded station now accepts the original floor/gate `(2,0,0)` and a
second approach floor `(2,1,0)` with a gate `(3,1,0)` on an existing slab.
Only one gate can be placed. A second gate without its approach gives the
player `Gate is disconnected: place the floor tile on its approach.` The
service selects its waypoints from the committed gate and matching approach;
this is a two-route slice, not a general graph or obstacle solver. The original
stop, Type A doors and single-passenger boarding remain in use. Both layouts
round-trip through the v1 adapter, including the disconnected intermediate
state; invalid imports remain transactional.

A fresh source copy is `.preview/unity/phase2-layout-20261110-214631-839/project`.
The first bootstrap's IL post-processor failed without a compiler diagnostic;
`bootstrap-EditMode-Development.log` preserves it. After verifying no Editor
held that scratch project, the stale lock was removed and bootstrap retried.
The retry passed 25/25 EditMode and 1/1 PlayMode; XML is in `retry/`. A stale
lock after the EditMode run was likewise removed after verifying no Editor was
using that project. The first Web build was rejected by the wrapper for the
same exact URP before/after hashes and list diff as the baseline above. The
normalized rebuild and browser pass used:

```powershell
$run = '.preview/unity/phase2-layout-20261110-214631-839'
$project = (Resolve-Path "$run/project").Path
$out = "$run/final"
./unity/scripts/metro-unity.ps1 build-web -Scene FirstPlayable -Configuration Release -ProjectPath $project -OutputDirectory $out
./unity/scripts/metro-unity.ps1 pack-web -Configuration Release -ProjectPath $project -OutputDirectory $out
node tools/unity-web/smoke-first-playable.mjs $out
```

`final/first-playable-report.json` records the original browser loop and the
second layout. The second case places the gate and verifies the disconnected
message, adds its approach through the UI, observes the passenger queue at
`(3,1.5)` beside the selected gate, board, download, reopen in a fresh page,
queue at the same gate and board again. Both captures and both downloaded
saves are in `final/`. The release provenance reports verified inputs and
FirstPlayable at dirty HEAD `c2f6fd400562852929c1414dab4685040a293f6c`;
its SHA-256 is `71a20477d32fabe4a8eeccf5edde16220b3a4aad53c230443640a66dd8b3097b`.
The packed manifest SHA-256 is
`7af0a0708134d60c3af60c1014dd5687d4b5b6b4673806fb2a0cd21b80bc53ca`.
The seven Node release/layering tests also passed. Tianhe heap investigation,
performance targets, general pathfinding, multiple gates and full save parity
remain expansion work; this small browser check is not a performance result.
