# Phase 0 evidence and open gates

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

