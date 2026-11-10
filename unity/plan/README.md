# Station Designer Unity Web migration

The planning baseline is commit `4c0fb66e071e2aee25cd3fc055a010871942004b` from November 8, 2026. This directory is the implementation runbook. Commands labeled **planned** become runnable in the phase that creates them.

## Target

Ship the current station-building game as a Unity Web player at `https://stationdesigner.com/game/`, with English at `/game/en/`. The concept-art site keeps its existing Chinese `/` and English `/en/` URLs. Preserve all three demo deep links in both languages, station files, and the ability to recover a local autosave. Port gameplay to managed C# with Unity as the input, graphics, audio and UI host. Keep the TypeScript game executable as the behavior reference, the source of procedural assets during the migration, and the release rollback path.

## Starting point

- The local `unity/` is an existing URP project with a generated Bootstrap scene, editor `6000.6.8f1` (revision `237b6593792b`), URP `17.6.0`, Input System `1.20.1` and uGUI `2.6.0`. Its matching Editor and Web Build Support are installed on this workstation. Resolve the editor from `ProjectVersion.txt`. The working tree now allows Unity source, package pins, tests and scripts into Git. See the [Phase 0 handoff](phase-0-handoff.md) for verified snapshots and open gates. [Unity download archive](https://unity.com/releases/editor/archive)
- `game/src/sim` is pure TypeScript, `game/src/build` owns edits, `game/src/render` uses Three.js, and `game/src/app` binds React/Zustand, input and browser services. `game/src/sim/worker.ts` keeps simulation work off the browser UI thread today. Unity Web's lack of managed threads makes matching the current workload a release gate. [Unity Web technical limitations](https://docs.unity3d.com/6000.6/Documentation/Manual/webgl-technical-overview.html)
- The root `metro` Worker handles the site, `metro-game` owns the exact `/game` and `/game/*` routes, and `metro-stats` has separate routes and D1. The repo documents a Workers Builds production trigger for `metro-game`. Confirm the actual trigger before release. Public HTTP probes matched the current redirects for `/en`, `/game` and `/game/en`, returned HTML for `/game/en/tanwei` and `/game/benchmark/en`, and returned 404 for `/en/game/` and a missing `.wasm`. [Cloudflare route matching](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- `game/src/assets/PASSENGERS.md` and the bake scripts trace the active crowd to `HumanBody_Alt.fbx` and record that the supplied readme provides no redistribution license. Use an original placeholder for the spike. The production model and any derived crowd bake need an approved redistributable source. See the asset subplan for the provenance gate.

## Decisions for the owner

| When | Decision | Recommended default and consequence |
| --- | --- | --- |
| Before Phase 0 promotion | Use the existing Unity 6.6 project or create an LTS project? | Use `6000.6.8f1` for the spike and initial port. If long-term support policy requires an LTS, pin a verified LTS patch and make a fresh URP project before the source layout and imports are committed. Opening a newer project in an older editor adds migration risk. |
| Before production crowd art | Which character source can ship? | Select an original or documented redistributable rig. If retaining the current look is mandatory, obtain redistribution permission covering the source and derived meshes or commission a new rig with the same art direction. This is the one decision that can block visual parity regardless of engineering progress. |
| Before setting Phase 4 release scope | Is desktop-first acceptable, and what is the minimum device? | Preserve the existing desktop-first experience and localized mobile notice. Name a representative minimum-spec machine and browsers for the performance gate. First-class mobile adds touch editing, IME, memory, and real-device QA. |
| Before Phase 4 | Is launch a full replacement or a limited public beta? | Use a private/staging beta, then promote only after builder, all demos, save round trips, localization, and performance pass. Keep the Three.js benchmark/lab and legacy game available during the rollback window. A smaller public beta needs an explicit feature list and URL decision. |
| Before release automation | Who owns the licensed runner and deploy credentials? | Start with the licensed workstation and a scripted artifact handoff. Move the same scripts to a trusted licensed runner once the loop works. Enable R2 only if a measured release artifact needs it and the account owner approves the storage. |
| Before production switch | Should Unity submit anonymous global stats on day one? | Enable after testing the current opt-out, session identity, queue and API contracts. If deferred, keep the report-board links and disclose the stats gap in the launch scope. |

The spike can proceed with the defaults for editor, desktop and placeholder art. The plan uses an explicit language route as the source of truth and switches languages by changing the URL. The current game can remember a different display language on each route. This is an intentional proposed behavior change. Choose compatibility with route-specific preferences if that behavior matters to you.

## Execution order

| Phase | Work | Exit evidence |
| --- | --- | --- |
| 0. Baseline and toolchain | [Bootstrap and CLI](01-bootstrap.md). Capture the TS baseline, inventory Unity source, pin toolchain, run a clean Web smoke build. | Clean checkout reproduces a marker in a real browser at both locale paths through local Wrangler. Evidence includes version, build and test logs. |
| 1. Feasibility | [Assets](02-assets.md) A1–A4, [C# and parity](03-runtime.md) R1–R2, [Web](04-web-release.md) W1–W3. Import asymmetric geometry, one gate or bench, one train segment and a cleared rig. Load fixture data and benchmark an original synthetic crowd and Tianhe-equivalent geometry and graph load. | One browser slice proves save parsing, scale and side orientation, stable fixture results, and representative main-thread cost. Resolve red feasibility gates before catalogue-wide porting. |
| 2. Playable slice | Assets A5–A6 and runtime R3–R5. Wire empty station edits and the Zoo demo, walk → fare gate → platform → train, save/export, then reload. Add preview and section tools. | A player completes the slice on Web using the real input controls. Both engines pass the same slice fixtures. |
| 3. Parity | Finish asset inventory and runtime R6–R7. Add Tanwei, Tianhe, transit/roads/crowds, editor features, UI panels and bilingual text. | All selected parity rows have deterministic evidence and browser smoke coverage. Unsupported/deferred rows are explicit and owner-reviewed. |
| 4. Release | Web W4–W7. Preview deploy, compare to baseline, rehearse rollback, then switch the existing `metro-game` Worker. | Stable URLs and save migration verified, production smoke passes, rollback ID and artifact retained. |

## Work protocol for implementation agents

1. Work one numbered task at a time, except that Phase 0 project setup may proceed independently while baseline work is outstanding. Do not run builds, tests or other competing workloads during timing captures. All B1–B5 evidence remains required for the Phase 0 exit. Read the linked repo skills and the source/tests named in the task. Record `phase / task / source SHA / command / evidence / result / next task` in the implementation PR or handoff. Use the TS oracle at the recorded SHA. When `game/` changes during the port, bring forward fixture updates as explicit compatibility work.
2. Start each task with its prerequisite gate. A compile, imported asset, rendered frame, or HTTP 200 proves only its own stage. Each subplan defines a separate runtime check. Keep repro inputs, raw reports and screenshots under `.preview/unity/`. Put reproducible performance findings in `.agents/skills/metro-repo/references/performance.md` when performance work starts.
3. Prefer Node and PowerShell wrappers, Editor C# APIs in batch mode, Unity Test Framework, and browser automation. Use a running Editor through Unity CLI only for interactive investigation. Surface one-time licensing or account setup to the owner if machine credentials require it.
4. Ship each subsystem with its oracle fixtures. Keep one scene pick per pointer event, preview state outside document history, and deterministic simulation as cutover requirements.

### Phase 0 handoff

> Close Phase 0 using `unity/plan/01-bootstrap.md` and the evidence in `unity/plan/phase-0-handoff.md`. Start with source review and verification hardening, then rerun B1–B5 from the selected committed checkout. Report exact commands, version pins, artifact and input hashes, baseline dispositions and any unmet gates. Targeted Phase 1 experiments can proceed alongside closeout.
