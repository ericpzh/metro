---
name: metro-repo
description: Entry point and router for the Station Designer repo — top-level layout, root npm commands, bilingual i18n, shared branding, Cloudflare Workers deploys, performance workflow, and tools/ index. Use for repo-wide work or to route into the 12 domain skills covering game/, unity/, model/, web/, stats/, video/, and wasm/.
---

# Station Designer — Repo Entry Point

Station Designer is a 3D metro-station building sandbox (1 block = 1 m, 5 m
storey profile, procedural models, rolling stock, real passenger flow) with a
React 19 + Three.js + Web Worker web app (`game/`), a Unity 6 URP WebGL/Windows
port (`unity/`), a bilingual concept-art site (`web/`), a soft-human passenger
library and sound studio (`model/`), an anonymous stats/feedback Worker
(`stats/`), and a demo-video pipeline (`video/`).

**Load the domain skill that owns the area you are changing.**

## Skill Routing

| Skill | Scope |
| --- | --- |
| [metro-game](../metro-game/SKILL.md) | `game/` architecture & dependency rule, `build/`, `persistence/` saves, shipped demos, `data/`, `assets/`, `app/` shell/tools/city styles/audio, `game/worker/` |
| [metro-game-sim](../metro-game-sim/SKILL.md) | Pure simulation (`game/src/sim/`): 5 m grid, walking graph, sparse hierarchical routing, trains/headway/rails, vertical circulation, gates/exits, demand, road traffic |
| [metro-game-render](../metro-game-render/SKILL.md) | Three.js renderer (`game/src/render/`): `SceneRenderer`, scene systems, procedural models, snapping/picking, LODs, batching, `PanelAtlas`, signage, materials, exploded view |
| [metro-game-test](../metro-game-test/SKILL.md) | `game/test/` Node test suite (`npm run test:game`, `test:perf`) and headless Chrome verification scripts (`tools/check-*.mjs`) |
| [metro-unity](../metro-unity/SKILL.md) | Unity 6 URP C# runtime (`unity/Assets/StationDesigner/`), assemblies, live Editor (`metro-editor.ps1`), isolated batches (`metro-unity.ps1`), EditMode/PlayMode tests, `tools/unity-parity/` |
| [metro-unity-web](../metro-unity-web/SKILL.md) | Shared React/Unity UI shell (`game/src/unity-web/`), Bridge v2, WebGL & WebView2 (`tools/unity-editor-ui/`), WebGL/Windows packaging (`tools/unity-web/`, `tools/unity-windows-bundle/`), `unity/wrangler.jsonc`, `unity/tests/` |
| [metro-unity-assets](../metro-unity-assets/SKILL.md) | Three.js/model → Unity URP asset pipeline (`tools/unity-assets/`, `unity/asset-recipes/`), glTFast proofs, native 3-tier Mesh LOD baking, public vs local passenger profiles |
| [metro-model](../metro-model/SKILL.md) | `model/` soft-human passenger library, GLB exports, `tools/bake-soft-passengers.mjs` (`npm run bake:passengers`), `model/sounds.html` sound studio, `npm run art:models` |
| [metro-web](../metro-web/SKILL.md) | `web/` concept-art site, `worker/` + root `wrangler.jsonc`, bilingual sheets (`art/`, `png/`), `tools/gen-art.mjs` / `tools/iso.mjs` / `tools/sheet-*.mjs` |
| [metro-stats](../metro-stats/SKILL.md) | `stats/` Cloudflare Worker + D1 anonymous global telemetry & public bug/feature/save-share board, `stats/test/`, `tools/check-stats-reports.mjs` |
| [metro-video](../metro-video/SKILL.md) | `video/` deliverables and `tools/demo-video*` automated browser recording, Studio graphics, audio mix, and retake pipeline |
| [metro-wasm-experiment](../metro-wasm-experiment/SKILL.md) | `game/wasm/` opt-in Rust/WASM A* routing prototype and release-isolation checks |

## What Lives Where

| Path | Role |
| --- | --- |
| `GAME-SPEC.md` | Behavioral design specification — source of truth for *what* the game does. |
| `AGENTS.md` | Top-level repository rules for routing, live Unity Editor checks, performance logging, and interaction invariants. |
| `README.md`, `package.json`, `wrangler.jsonc` | Root documentation, cross-app npm scripts, and site Worker (`metro`) config. |
| `game/` | Standalone React 19 + Three.js + Web Worker game (own `package.json`, Vite config, `test/`, `worker/`, `wrangler.jsonc`, and `src/unity-web/`). |
| `unity/` | Unity 6 URP WebGL/Windows port (`Assets/StationDesigner/`, `scripts/metro-{editor,unity,local-player}.ps1`, `asset-recipes/`, `tests/`, `wrangler.jsonc`). |
| `web/` | Bilingual React 19 + Vite showcase site deployed at `stationdesigner.com/` (Chinese `/`, English `/en/`). |
| `art/`, `png/` | Generated bilingual concept sheets (11 sheets × 2 locales: `01`–`07`, `09`, `11`–`13`) and 300 DPI PNG renders. Never hand-edit. |
| `model/` | Standalone Vite app (port `5175`) for soft-human passenger previews and the sound studio; feeds offline bakes only (never imported by `game/` runtime). |
| `stats/` | Cloudflare Worker (`metro-stats`) + D1 schema/scripts/tests for `/stats/` totals and `/stats/report` feedback/save-share board. |
| `video/` | Shipped bilingual gameplay demo MP4s, thumbnails, and authored demo-station inputs. |
| `worker/` | Root site Worker entry (`worker/index.js`) handling `/en/` language-pin rewrites. |
| `tools/` | Root Node/Python/PowerShell/.NET scripts for dev orchestration, art/asset bakes, browser checks, benchmarks, demo video, and Unity pipelines. See [references/tools-index.md](references/tools-index.md). |
| `design/` | Design references (`crowd-routing-plan.md`) and approved brand icon source (`design/icon/station-designer-blue-bold.png`). |

## Repo-Wide Engineering Rules

### Bilingual URL-Pinned i18n

- Chinese is the default at `/`, `/game/`, `/game/unity/`, and `/stats/`.
  English is pinned under `/en/`, `/game/en/`, `/game/unity/en/`, and
  `/stats/en/` (benchmark routes: `/game/benchmark[/en]` and
  `/game/unity/benchmark[/en]`).
- Every built-in player-facing string (UI labels, tooltips, notices, decals,
  canvas text, art sheets) must live in its owning catalogue — never add inline
  language ternaries, local maps, or manual call-site replacements:
  - **Game**: `game/src/sim/i18n/messages.ts` via `game/src/sim/i18n.ts`
    (`t`, `msg`, `translate`, `tForLanguage`).
  - **Site**: `web/src/i18n.js` (chrome) and `web/src/artworks.js` (sheet copy).
  - **Concept art**: `tools/sheet-i18n.mjs` (reuses exact game catalogue labels;
    `sheetText` where width affects layout).
- Keep authored station names, sign text, and line termini untouched; fixed
  English glosses on bilingual physical signs belong in `printed_*` catalogue
  keys so UI language toggles preserve them.
- After copy or text-rendering changes, run `npm run audit:i18n` from the repo
  root (AST-checks direct JSX, attribute, canvas `fillText`/`strokeText`, and
  `drawModelText` sinks; review indirect data paths by hand).

### Shared Branding

- Approved single source: `design/icon/station-designer-blue-bold.png`.
- Run `node tools/prepare-brand-icon.mjs` from the repo root to regenerate all
  browser and stats icons in sync:
  - `web/src/assets/brand/station-designer-mark.png` (512 px transparent
    silhouette for CSS-tinted `BrandMark`)
  - `web/src/assets/brand/` & `game/src/assets/brand/`: `favicon.png` (64 px)
    and `apple-touch-icon.png` (180 px)
  - `stats/favicon.js` (64 px data URI) and `stats/brand-mark.js` (96 px
    transparent silhouette data URI)
- The standalone Windows launcher
  (`tools/unity-windows-bundle/StationDesignerLauncher.csproj`) embeds
  `tools/unity-windows-bundle/StationDesigner.ico`.

### Interaction, Verification & Unity Discipline

- **Single pick & preview isolation** (`AGENTS.md`): Resolve at most one scene
  pick per pointer event and keep interactive preview work separate from
  document commits, undo history, and worker rebuilds.
- **Deterministic regressions & diff audit**: Pair every behavior change with
  deterministic regressions in its owning suite, run the full owning suite
  (plus targeted browser checks for UI/render changes), and review
  `git diff --check` before committing.
- **Unity workflows**: Use `unity/scripts/metro-editor.ps1` for live Editor C#,
  scene, and EditMode/PlayMode checks (see
  [12-live-editor-workflow.md](../../../unity/plan/12-live-editor-workflow.md));
  keep isolated batches and WebGL builds in `unity/scripts/metro-unity.ps1`.
- **PowerShell 5.1**: `&&` is invalid on Windows PowerShell 5.1 — separate
  commands with `;` or run individually.

### Performance Reference Workflow

The `references/performance.md` family is the **single measured-state record**
for performance work — do not create parallel performance docs (such as
`game/PERFORMANCE.md`). Update it only when a task addresses performance or
changes a budget or procedure; measure the reported interaction and keep raw
captures under `.preview/perf/` or `.preview/unity/`.

- [references/performance.md](references/performance.md) — measurement rules & web per-model geometry inventories
- [references/perf-web.md](references/perf-web.md) — Three.js / Web Worker performance contracts
- [references/perf-unity.md](references/perf-unity.md) — Unity 6 URP performance contracts
- [references/perf-benchmarks.md](references/perf-benchmarks.md) — verified web & Unity benchmark/profiling commands
- [references/unity-model-lod-inventory.md](references/unity-model-lod-inventory.md) — Unity 3-tier `LOD0`/`LOD1`/`LOD2` triangle inventory
- [references/tools-index.md](references/tools-index.md) — categorized index of `tools/` directories and scripts

## Root Commands

Run from the repository root (`package.json`):

| Task | Command |
| --- | --- |
| Install deps (root / all sub-apps) | `npm install` · `npm run setup:all` (`setup`, `setup:game`, `setup:model`) |
| Dev stack (`web` :5173 + `game` :5174 + `stats` :5176) | `npm start` or `npm run dev:all` (reuses listening ports; excludes `model`) |
| Individual dev servers | `npm run dev` (`:5173`) · `npm run dev:game` (`:5174`) · `npm run dev:model` (`:5175`) · `npm run dev:stats` (`:5176`) |
| Unity local WebGL & Windows `.exe` | `npm start unity` (`127.0.0.1:8787/game/`) · `npm run build:unity` · `npm run build:unity:windows` |
| Production builds & local preview | `npm run build` (`web`) · `npm run build:game` · `npm run build:model` · `npm run build:stats` · `npm run preview:local` (`:4173`) |
| Tests & audits | `npm run test:game` · `npm run test:perf` · `npm run test:unity` · `npm run test:stats` · `npm run audit:i18n` |
| Browser checks (site, UI & stats) | `npm run check:demos` · `npm run check:tutorial` · `npm run check:roads` · `npm run check:info-panel` · `npm run check:stats:reports` |
| Browser checks (render, LOD & perf) | `npm run check:render-batching` · `npm run check:equipment-lod` · `npm run check:geometry-detail` · `npm run check:passenger-lod` · `npm run check:perf-tools` |
| Bakes, art & demo video | `npm run bake:passengers` · `npm run art:models` · `npm run video:plan` · `npm run video:demo` |
| Benchmarks & profiles | `npm run bench:sim` · `npm run profile:sim` · `npm run bench:browser` · `npm run profile:browser` · `npm run bench:sim-stalls` · `npm run bench:demo-load` (full list in [references/perf-benchmarks.md](references/perf-benchmarks.md)) |

## Cloudflare Workers Deploy Map

Four independent Workers share `stationdesigner.com` by route specificity:

| Worker | Config | Entry / Assets | Routes | Deploy Command |
| --- | --- | --- | --- | --- |
| `metro` | `wrangler.jsonc` | `worker/index.js` + `web/dist` | `stationdesigner.com/*` | `npm run deploy` |
| `metro-game` | `game/wrangler.jsonc` | `game/worker/index.js` + `game/dist` (`ASSET_PREFIX=/game`) | `stationdesigner.com/game`, `/game/*` | `npm run deploy:game` |
| `metro-unity` | `unity/wrangler.jsonc` | `tools/unity-web/local-worker.mjs` + `unity/dist-web` (`ASSET_PREFIX=/game/unity`) | `stationdesigner.com/game/unity`, `/game/unity/*` | `npm run deploy:unity` |
| `metro-stats` | `stats/wrangler.jsonc` | `stats/worker.js` + D1 `metro-stats` (no static assets; `env.dev` local-only) | `stationdesigner.com/stats`, `/stats/*` | `npm run deploy:stats` |

### Route & Asset-Limit Rules

- **Route pairs**: Every sub-path Worker requires both the bare route and `/*`
  (`/game` + `/game/*`, `/game/unity` + `/game/unity/*`, `/stats` + `/stats/*`).
  Never collapse a pair to `/game*` or `/stats*`, because `*` crosses `/` and
  steals sibling routes.
- **Routes, not Custom Domains**: Attach Workers via `routes` on the proxied
  zone so multiple Workers coexist on `stationdesigner.com`.
- **25 MiB per-asset limit**: `metro-game` enforces `< 25 MiB` per emitted file
  via `game/scripts/passenger-assets.ts` (`game/test/passenger-assets.test.mjs`).
  `metro-unity` stages only public `StationGameLocal.unity` packs via
  `npm run stage:unity` (`tools/unity-web/stage-deploy.mjs`), rejecting
  local-only `StationGameLocalWeb*` scenes and Brotli-chunking `.wasm`/`.data`
  into `≤ 20 MiB` `.brpartN` parts streamed via `FixedLengthStream`.
