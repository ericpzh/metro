---
name: metro-repo
description: Entry point for the ericpzh/metro repo — a React 19 + three.js metro-station building sandbox in game/ plus the concept-art site in web/. Use for repo-wide work (what lives where, root commands, conventions, Cloudflare deploy, the tools/ scripts) and to reach the subskills — metro-game (game/src), metro-game-test (game/test), metro-web (web/ and art/).
---

# Station Designer — repo entry point

A 3D sandbox about moving crowds through a metro station you build yourself.
Block-based construction (1 block = 1 m), procedural voxel art, real rolling
stock, real passenger flow. No money or staff: you build, the crowds arrive, and
the station either copes or it does not.

**This skill is the router — load the subskill that owns the work.**

For performance investigations or changes, read
[the performance guide](references/performance.md): reproduce the first real
interaction, bound event work, compare equivalent runs and guard the measured cause.

| Work | Skill |
|---|---|
| Anything under `game/src` — the sim, the renderer, the builder, the app shell, the save format | `metro-game` |
| Adding, running or fixing tests under `game/test` | `metro-game-test` |
| `web/` (the concept-art site), `art/` (the sheets), and the art/card renderers in `tools/` | `metro-web` |
| `model/` characters, bag variants, walking exports and the approved game passenger atlas | `metro-model` |

The game's first-run tutorial belongs to `metro-game` (`app/windows/tutorial/`).
Its interactive browser regression is `npm run check:tutorial`; use `metro-game-test`
for persistence/startup unit tests and the browser coverage split. Normal page loads
restore the local autosave or start empty; browser tools requiring a demo must load
their fixture explicitly. Autosave ownership and replacement rules live in
`metro-game` under “Startup and interactive tutorial”.

For every behaviour change, add or update deterministic regressions for each affected
contract and run the complete owning test suite before calling the work covered. A
focused test or a coverage percentage is not a substitute for the full suite; report
any unrelated failure separately and leave unrelated work untouched. For game changes,
follow `metro-game-test` and keep `game/test/README.md`'s coverage map current. For
renderer or performance work, also run `npm --prefix game run test:perf`, inspect the
changed modules' line, branch and function coverage, and use their real production
browser check. Preserve deterministic work-count/lifecycle assertions; browser timing
is evidence, not a pass threshold.

## What lives where

`model/` is the third app: a Vite + three.js character viewer at port 5175.
`model/src/characters/female.js` owns variants, `model/src/animation/` owns the
accepted gait, and `model/src/i18n.js` owns viewer labels. Its preparation script
regenerates ignored model assets; use `metro-model` (`../metro-model/SKILL.md`) for
model editing, exports and the approved game atlas. See `model/README.md`. No model Worker is configured.

| Path | What it is |
|---|---|
| `GAME-SPEC.md` | The design specification — the source of truth for *what* the game does. Cite its sections in code comments. |
| `game/` | **The game** — React 19 + three.js + a Web Worker sim. Own `package.json`, Vite config, tests, and Cloudflare Worker (`metro-game`), served at `stationdesigner.com/game/`. Bilingual: Chinese by default, English at `/game/en/`; the top-right gear menu contains the quality controls and the opposite-language action. Game copy lives in `game/src/sim/i18n/messages.ts`. Rolling stock classes A/B/C/D/L share the ordering in `game/src/sim/stock.ts`; D is the eight-car, 3.3 m Guangzhou 18/22 type with a dedicated swept cab and rounded shell. See `metro-game` for model, door and test contracts. |
| `game/src/` | The game's source: `sim/` `build/` `render/` `persistence/` `data/` `app/`. `metro-game` maps it file by file. |
| `game/test/` | The `node --test` suite. `game/test/README.md` is the authority on how it works; `metro-game-test` is the short version. |
| `game/README.md` | The game's own long-form guide: milestones, the time base, measured numbers, deliberate divergences from the spec. **Read it before changing sim behaviour.** |
| `model/` | Reviewed character viewer and GLB library at 5175; `metro-model` owns builders, cleanup, walking clips, exports and game atlas regeneration. |
| `design/icon/` | Station Designer icon source, previews and iterations. `tools/prepare-brand-icon.mjs` builds the game/site favicons and the site's CSS-coloured header mark from `station-designer-blue-bold.png`. |
| `web/` | The concept-art site (React + Vite), deployed as Worker `metro` at `stationdesigner.com/`. Bilingual: Chinese by default, English pinned to the `/en/` path with a switcher in the top bar (`Nav.jsx`); UI copy lives in `web/src/i18n.js`, sheet copy in `web/src/artworks.js` (`zh`/`en`). |
| `art/` | The generated concept sheets — the source of truth, copied into `web/public/art` at build time by `web/scripts/sync-art.mjs`. Never hand-edited. Each sheet has a `*-en.svg` English sidecar (same rule) for the `/en/` route. `metro-web` covers the pipeline. |
| `tools/` | Root-level Node/Python scripts: the art generator and viewer, the headless-Chrome passes that photograph the game, the demo-save bake, the pictogram asset prep. See the index below. |
| `worker/index.js` | The site's Worker entry (root Worker): pins `/en` to `/en/` and serves the site document for that language route. `game/worker/index.js` is the game's, which strips `/game`. |
| `wrangler.jsonc` | Root site Worker config, route `stationdesigner.com/*`. `game/wrangler.jsonc` is the game's, routes `stationdesigner.com/game` and `/game/*`. |

The concept gallery in `web/` groups its eleven sheets into four player-facing
paths: the station (01, 02, 13), trains and boarding (11, 05, 12), building
(03, 04, 09), and passenger flow and interface (06, 07). `artworks.js` owns
the order and copy; `Rail.jsx` is the left-side reading progress, and each
section note introduces the sheets beneath it. The sheets remain full-width
images; their one-line introductions sit above them.

### Player-facing concept art

Write sheet copy for players: explain what a feature lets them build, change, or
understand about the station and its passengers. Keep labels concise and inside
their panels. Omit implementation terms, source-code references, exact model
coordinates, and repeated specifications unless a player needs them to understand
a gameplay choice. When trimming copy, preserve useful outcomes and interactions.

The site and the game are **two apps and two Workers** in one repo. They build
and deploy independently; the only coupling is a URL (`gameHref` in
`web/src/site.js`, overridable with `VITE_GAME_URL`).

### Shared game and website branding

The approved icon source is `design/icon/station-designer-blue-bold.png`.
Regenerate the browser assets with `node tools/prepare-brand-icon.mjs` from the
repo root. This writes the 64 px favicon and 180 px Apple touch icon into each
app's `src/assets/brand/`, plus the 512 px transparent silhouette used by the
website's `BrandMark`. The site applies its amber colour in CSS; the game and
site favicons retain the source's navy background and white linework. Both HTML
entries link from `/src/assets/brand/`; Vite rewrites these to fingerprinted,
relative asset URLs for production, including language and Worker path-prefix
routes. Keep the artwork and the asset-preparation script in sync when the
approved source changes. The site's navigation mark belongs in the header; the
icon is not part of the hero composition.

`game/plan.md` and the root `PLAN.md` are **gone**. Source comments that cite
them — the R1–R6 / lane language included — are historical; do not follow them.

The equipment palette includes roof/post hangers and their 4/6/8 m lengths,
checkout counters, and glass/gate/iron fence variants. Door material is selected
in the variant menu and door width is a separate narrow/wide setting. Their
simulation, placement, rendering, and picker behavior belongs to `game/src/`;
coverage belongs in `game/test/` and follows `metro-game-test`. The 吸取 picker
round-trips every palette tile: clicking a placed piece arms the tile that placed
it (`paletteIdForModule` in `game/src/app/tools/PickTool.ts`, pinned by the
`pick-tool` palette sweep) — including the setting-free 空调风机 and 设备柜, which
carry no variant and arm by their own type.

Street roads (`道路`) are placed as orthogonal node-to-node segments from the 站外
palette. The document derives shared nodes from segment endpoints: intersections
and branches split segments, extension snaps to existing nodes, and deleting a
segment leaves its nodes while incident segments remain. Legacy rectangle roads
adapt when edited; the node graph is derived rather than saved as independent
objects. `sim/roadDocument.ts` owns this adapter/index, `build/model/Roads.ts`
owns segment edits, and `sim/roadLaneMovements.ts` / `roadNetwork.ts` / `roadTraffic.ts`
own directed connectors, network topology and traffic. Rendering and generated
intersection markings/lights belong to `render/models/pieces/RoadModel.ts` and
`render/scene/systems/RoadTrafficSystem.ts`; the 交通灯 decor keeps its own model
and palette placement. Seeded ambient traffic uses cars, buses and scooters at
50% of the original slot density; vehicle opacity matches the passenger crowd.
Route implementation to `metro-game`; pin graph/gesture behavior in
`metro-game-test`'s `road-document` and network/traffic rules in `road-network`.
`npm run check:roads` exercises production input in both locales.

The 视图 folder's 隐藏地面 hides the generated street mesh, placed sidewalk,
lawn, tree, road and traffic-light modules, plus the ambient road-traffic draw.
Keep these visibility rules in `render/scene/systems/LevelSystem.ts` and
`RoadTrafficSystem.ts`; pin hide/restore behavior in `ground-visibility` and
ambient car visibility in `roads.test.mjs`.

Bridge placement can be aimed at any point on the connected platform: use the
visible track/screen-door module hit when present (the dug bed can expose a
lower floor to the block picker), then resolve ordinary platform floor cells
through `railModuleAtPlatform`. Keep the pointer's along-run half so the bridge
extends from the nearer free end. Preview and click must share this resolution;
`game/test/rail.test.mjs` pins the platform lookup and
`game/test/equipment-placement-input.test.mjs` covers track, screen doors, the
far platform cells, all rotations, one module pick per event, and preview/click
agreement.

Generated bridge railings and sound barriers, manually placed `隔音屏` variants,
and platform/bridge gantries share the platform screen-door line. Keep their
side offset derived from `PSD_WALL_OFFSET` through `trackSideFixtureOffset` and
rotate placed barriers with the track; drag previews and commits must preserve
the selected side. Bridge noise-barrier glass sits inside its frame with a small
clearance, and gantry posts interrupt bridge barrier spans and concrete shoulders
instead of being covered by them. The reusable models live in
`render/models/pieces/BridgeNoiseBarrier.ts`, `BridgeRailing.ts`,
`BridgeEdgeConcrete.ts` and `TrackGantry.ts`; pin alignment, frame clearance,
neighbor joins and line editing in `module-build.test.mjs` and `fence.test.mjs`.

The RHS selected-piece information card is `app/windows/inspector/InfoCard.tsx`.
Keep its details and boxed action column side by side; selected one-way roads
reverse from that column, and all icon actions expose matching translated
tooltips and accessible names. `tools/check-info-panel.mjs` checks the real
production layout and road reversal in both locales.

Monitor decor has a ceiling-hung 1 m cabinet and a 3 m wall-backed panel with
twelve room-facing views; the separate floor-standing 信号机 is 1 m tall. Route
implementation to `metro-game` and preserve the mounting, bounds and material
invariants in `game/test/monitor-signal.test.mjs`.

The eight fixed stairs include 左 / 中 / 右直跑楼梯: two flights climb forward
with an interior landing between them. Keep their flight plan, landing width,
railing openings, carve and passenger graph aligned; extend `stairs.test.mjs`
for geometry and routes, and `module-build.test.mjs` for visible model parts.

The **自动步道** (moving walkway, `game/src/sim/walkways.ts`) is the 扶梯's level
twin: one body of truss, band and glass laid flat at 短 30 m / 中 60 m / 长 90 m,
filed under 设备 beside the 扶梯 and sharing its 窄/宽 width and up/down direction.
It carries riders at the free walking speed plus 0.5 m/s and, unlike the 楼梯 or
扶梯, a step-free passenger may ride it. Two contracts hold it together: it
**carves nothing** (so it is a plain equipment append that needs floor under its
whole belt), and it is **ends only** (its belt cells are dropped from the crowd
graph, so the crowd boards and leaves at the two landings). Route implementation
to `metro-game`; `game/test/walkways.test.mjs` pins the lengths, the level
centring, the ends-only routing, the doubled-width rate and the shared flat model.

Ceiling-hung signs, TVs, clocks and cameras attach to the nearest slab shared by
their footprint; their suspension reaches that slab instead of assuming a 4 m
room. A 站台 or 轨道桥 deck counts as that slab (a tunnel keeps its own shell
ceiling): the platform bed is dug, so the module itself is the ceiling, and a
bridge hangs over void with its 1 m deck as the underside. Standing on the bed
itself stays refused as track. All three 监控 housings read that slab like 枪机 does, and each piece keeps
its own short drop below it (a 指示牌's 0.65 m of rod, a 灯具 none), so a board hugs
the slab it hangs from. The anchor is a cell, not a height (`hungCeilingAim`): a
hanging item takes the free cell directly under the **first underside above the
pointer** — `top block - 1` — wherever on that column the pointer is, floor,
wall course or the slab's own underside alike, and a piece whose own cell has that
block over it hangs from it (`hangCeilingLocal`, `topBlockOver`), while one left on
a floor reads the real slab overhead using the station's `levelBase`. Keep the
preview and placement verdict aligned, and pin the anchor, the shifted base and
nonstandard ceiling heights in `wall-ceiling-snap`, `lights`, `vent`, `module-build`,
`sign-model` and `ceiling-decor`.

**Wall-mounted** decor — 广告牌, 玻璃板, 站名, the wall 线网图 and 指示牌 — is the
mirror image, and `wallMountStandCell` asks the same base: a **side face is a wall
whatever the block is tagged** (§9.5 "side face = wall-mounted"), so a wall raised
with the 方块 brush mounts a panel in the cell in front of that face — never inside
the block — on that face's storey of the station's `levelBase` grid. When the tile
has a wall on two sides the **camera** decides which one the panel hangs on
(`autofaceWallMount` ranks by the aim `pickFacing` reports; the carried turn, the
pointer and the rotation order settle a view that cannot tell them apart), and the
search asks `wallMountMissing`'s own verdict per direction. The mounts bolted to a
**named piece of the document** keep the turn the pointer gave them — a board on a
booth header, a 地面出入口 on the block face it was clicked on. An orbit therefore
re-aims the ghost already under the pointer (`SceneRenderer.onCameraAim` →
`Viewport`'s `refreshHover`). The **course** a panel covers is the same aim's second
question, and the 玻璃板 answers it as a band of wall: it is the one wall piece that
starts at its cell's floor top and rises its own height, so `wallMountFollowsCourse`
hangs it over the course the pointer is on (`wallMountStandCell`'s `followCourse`) —
aim at a wall's second course and the pane covers the second course, aim at the first
and it is the storey floor it always was. A floor slab's own edge keeps the storey
reading, and the pieces drawn at their own `panelZ` (广告牌, 站名, 线网图, wall 指示牌) keep
the storey floor, which is what puts a poster at eye height wherever it is aimed. Pin
all of it in `wall-ceiling-snap`, `equipment-placement-input`, `glass-panel`, `move`
and `scene-wiring`.

Floor decor drawn offset against a wall — 垃圾桶, 灭火器, 货架, 售票机, 自动售货机 —
may back against a floor-standing 玻璃幕墙 in the same tile. The pair shares the tile
only when the backs coincide on one edge (opposite turns); the piece steps towards its
tile centre (`EDGE_DECOR_CURTAIN_SHIFT`) so its back clears the glazing
(`edgeDecorCurtainShare` / `edgeDecorCurtainOffset`, drawn via `placeLocalAtEdge`).
Pin the placement, the shift and the model in `glass-panel`, and the curtain-neighbour
rebuild in `performance-policy`.

## Repo rule: translations use the existing i18n infrastructure

All built-in player-facing copy must come from the owning catalogue, including
interface labels, tooltips, notices, model decals, canvas text and capture tools.
Do not introduce inline language ternaries, local translation tables or manual
template replacement at call sites.

* **Game:** `game/src/sim/i18n/messages.ts`; use the shared API in
  `game/src/sim/i18n.ts`: `t` for current-language copy, `msg` for canonical
  data/notices, `translate` at existing catalogue/notice presentation boundaries,
  and `tForLanguage` for tools requiring a specific locale without changing UI state.
* **Site:** `web/src/i18n.js` for chrome and `web/src/artworks.js` for sheet metadata.
* **Generated art:** `tools/sheet-i18n.mjs`; reuse game catalogue entries for exact
  game labels, and `sheetText` when translated text width affects layout.

An English-copy request changes English entries only unless the user also requests
a Chinese change. Keep CN wording and field semantics intact. Short English labels
are welcome when they fit better; abbreviations belong in catalogue keys too.
Keep authored station names, sign text and line termini untouched. Fixed English
glosses on bilingual physical signs still belong in the catalogue (`printed_*` keys
with identical values in both locales); switching UI language must not erase them.

After changing copy or its rendering, run `npm run audit:i18n` from the repo root.
It checks runtime JSX and canvas/model text sinks, not every indirect data path;
review those paths as well. Run relevant language/renderer tests and inspect affected
text in both locales for clipping and CN regressions. Art generation must report
no missing translations. Follow the owning subskill for layout and cache refresh.

Passenger sources: the live `game/src/assets/passenger-approved.json` comes from
the complete reviewed catalogue; use `metro-model` and `npm run bake:passengers`.
The current library has 232 variants with ten hairstyles per sex (212 adult-eligible / 114 child-eligible).
Forty appended bagless entries cover ten jacket-free outfits per sex in both
grey arrangements, shared by both ages. Use `metro-model` for their exported
skirt morphs and bake, and keep `passenger-clothing`'s actual-asset regression.
Stable identity chooses equally within explicit `adultEligible` / `childEligible`
pools; the 20% child population can use approved small/crossbody bags, never bald
heads. `render/passengerEligibility.ts` preserves the previous pools for legacy
atlases without flags; explicit false takes precedence. Derive counts from metadata
rather than hard-coding them into captures or validators. The shared game material uses 70% opacity.
The historical `game/src/assets/passenger-human.json` is baked, not authored —
`game/src/assets/PASSENGERS.md` names the CC0 Quaternius outfits and
`tools/bake-passengers.mjs` regenerates the atlas. Never hand-edit the JSON.

The shipped demo's stairs must remain complete current-catalogue pieces with
explicit block-fitted tread widths (0.79 m for its three straight stairs,
1.79 m per run for its two medium switchbacks). When refreshing
`game/src/data/demo-station.json`, rebuild affected stairs with `createModule`,
preserve their IDs and landing plans, and store `stairTreadWidth` as their width.
A **90° turn** is rebuilt the same way and takes its `lanes × lanes` quarter-landing and
the departing leg laid on that square's far edge from the current builder
(`stairQuarterTurnOffset`), so a turn added to or refreshed in the demo is a 2 × 2 / 3 × 3
square of walkable floor, not the single corner cell an older save carries.
Run `demo`, `stairs` and `placement` tests. Platform `doors` are **server IDs**:
connectivity checks must resolve `graph.servers[id].node`, never index node
reachability with the server ID. See `metro-game` for the demo/save workflow.

## Commands

Run from the repo root (PowerShell):

```powershell
npm install           # root deps (wrangler)
npm run setup         # install web/ deps
npm run dev           # site dev server at http://localhost:5173
npm run build         # build the site into web/dist
npm run deploy        # build + wrangler deploy (site Worker `metro`)

npm run setup:game    # install game/ deps
npm run dev:game      # game dev server at http://localhost:5174
npm run setup:model   # install model/ deps
npm run dev:model     # model viewer at http://127.0.0.1:5175
npm run build:model   # generate assets and build model/dist
npm run art:models    # approved model exports → game atlas → bilingual art + verified previews
npm run dev:all       # web 5173 + game 5174 + model 5175
npm run test:game     # node --test over game/test/**/*.test.mjs
npm run check:tutorial # production browser tutorial/input/i18n regressions
npm run build:game    # install game/ deps, then tsc --noEmit && vite build
npm run bench:sim     # demo-station simulation + build CPU timings
npm run bench:browser # production app/worker/browser FPS + edit-to-frame timings
npm run bench:stair   # real initial stair-block pointer press + raycast counts
npm run test:perf     # focused performance regressions + V8 source coverage
npm run check:render-batching # production GLSL/WebGL + geometry/draw integrity
npm run check:perf-tools # real CPU profile + trace-stream export smoke check
npm run profile:sim   # readable Node/V8 simulation/build CPU profile
npm run profile:browser # app CPU/Chrome trace + GPU timer/upload diagnostics
npm run deploy:game   # build:game, deploy metro-game, attach its routes

npm run preview:local # tools/preview.mjs — both built apps on one origin
```

The `metro-game` production build enforces a strict Cloudflare Workers asset
limit: every emitted file must be **smaller than 25 MiB**. Keep the guard in
`game/scripts/passenger-assets.ts` and its boundary test in
`game/test/passenger-assets.test.mjs` aligned with this rule.

Inside `game/`: `npm run dev` (5174), `npm run typecheck`, `npm run build`,
`npm test`, `npm run preview` (4174); `npm start` there builds then previews.
Note: `npm start` at the **repo root** starts all three dev services, reusing
existing listening services. Ctrl+C stops only services started by that launcher.

On Windows PowerShell 5.1 the `&&` separator is not valid — use `;` or separate
commands.

## `tools/` index

| Script | What it does |
|---|---|
| `gen-art.mjs [nn …]` | Regenerates every `art/*.svg` (or only the sheets named by leading number / file name), one `sheet-*.mjs` / `sheets-*.mjs` module per sheet, drawn through `iso.mjs`. Sheet 01 is `sheet-01-hero-banded.mjs`. Sheets 08 and 10 are retired; the eleven live ones are 01–07, 09, 11–13. `--en` additionally writes each sheet's `*-en.svg` English sidecar via `sheet-i18n.mjs` (missing strings / bad markup fail the run). |
| `sheet-i18n.mjs` | The English copy table for the sheets: every Chinese `<text>` string (plus sheet 06's slider `aria-label`s and live-readout script literals) mapped to terse English; `{ t, size }` pulls a long label's font-size down. Embedded game captures stay Chinese. |
| `sheet-png.mjs <nn>` | Rasterises one sheet in a headless browser so the composition can be **looked at** (`--at <s>` freezes an animated sheet). |
| `serve.mjs [port]` | The static sheet viewer (default 4173). |
| `preview.mjs` | `npm run preview:local`: serves the built site at `/` (English `/en/`) and the built game at `/game/` (English `/game/en/`), over one origin. Stands in for `wrangler dev`. Strips the `/en` language pin like the Workers do. |
| `audit-i18n.mjs` | TS-AST check for inline player-facing copy: walks `game/src` + `web/src`, flags JSX text, `title`/`aria-label`/`placeholder`/`alt`, and `fillText`/`strokeText`/`drawModelText` sinks. Run as `npm run audit:i18n` after copy/render changes. Direct sinks only — review indirect data paths by hand. |
| `bake-approved-passenger.mjs` | Bakes the complete reviewed catalogue, age flags and all walks into the active shared crowd atlas; run `npm run bake:passengers` to regenerate exports first. See `metro-model`. |
| `check-game-passenger-library.mjs` | Checks every adult variant, live child model/size restrictions, 70% opacity and the instanced crowd in the built game GPU renderer. |
| `check-model-preview-options.mjs`, `check-game-passenger-size.mjs` | Verify production model age/size controls and render a game lineup. The model's pure preview rules also have `npm --prefix model test`. |
| `bake-passengers.mjs` | Regenerates `game/src/assets/passenger-human.json` from the CC0 sources listed in `game/src/assets/PASSENGERS.md` (see `metro-game`). |
| `render-module-cards.mjs` | Sheet 04's cards: drives headless Chrome to run the game's own thumbnail pass. Needs Chrome + `game/dist`. |
| `render-block-cards.mjs` | Sheet 03's blocks, meshed and lit by the game (same shape). |
| `render-ui-shots.mjs` | Sheets 06 and 07: boots the game, drives it into real states, crops each window / chrome region to its own DOM box at 2×. |
| `render-train-cards.mjs` | Sheets 02, 05, 11, 12 and 13: builds each stock class with `buildTrain`, frames one car or a consist (`--trim-only` re-crops without booting the game). |
| `render-train-animation.mjs`, `train-animation.mjs` | Capture and place real rendered door/headlight poses for animated train details. The capture writes `.preview/train-animation/`; `gen-art.mjs` reads it when generating sheets that use these poses. |
| `render-passenger-cards.mjs`, `passenger-cards.mjs` | Capture the game's clothed human mesh in varied identities, frozen poses and full strides for sheets 01, 02, 12 and 13. The moving figures cycle real gait frames facing their path in plan, elevation or isometric view. Run after a passenger model/material update and before `gen-art.mjs`. |
| `test-passenger-animation.mjs` | Headless-browser art checks after capture and generation: exactly one visible gait frame at multiple times, and changing arm/leg poses in SVG images even without translation. Separate from the DOM-free game suite. |
| `render-piece-elevations.mjs` | Sheet 02's pieces: the rail's own piece builder asked for square-on elevations, one scale, base on the picture's bottom edge. |
| `render-piece-views.mjs` | Sheets 01 and 13's pieces: the same pieces on the drawing kit's isometric axes, with the layout (frame, pixels, origin) that lets a sheet scale a run to the floors it joins. `--hero --scale 4` captures sheet 01's station layers separately in `.preview/hero-piece-views/`; the default capture feeds sheet 13 in `.preview/piece-views/`. |
| `station-elevations.mjs`, `station-piece-images.mjs` | Read the square-on and isometric station-piece captures into authored sheet drawings, retaining each model's metre dimensions and placement anchor. |
| `demand-animation.mjs` | Builds sheet 06's demand-curve preview from the game's demand and calendar rules. In an embedded SVG document, its time-boundary handles can be dragged or adjusted with arrow keys. |
| `render-view-shots.mjs` | Photographs the demo station from each of the game's own camera presets (sheet 09's subject) into `.preview/view-shots/`, for looking at rather than asserting. |
| `game-tiles.mjs` | Starts the built game in headless Chrome and saves the build rail's real preview tiles, for checking an art change against it. |
| `bench-demos.mjs`, `bench-sim.mjs`, `bench-browser.mjs`, `perf-stats.mjs` | Run simulation/build CPU and production browser FPS, draw-call and edit-latency benchmarks on both shipped examples, Zoo and Tanwei, sequentially. Set `BENCH_STATION` to run one external save. Reports go under `.preview/perf/`; see `game/PERFORMANCE.md` for controls and interpretation. These are local diagnostics, not CI thresholds. |
| `bench-level-switch.mjs` | Real paused Q/E input on both demos: first/repeated latency, slice/batch/model/save work, exact cached GPU allocation reuse and initial prewarming cost. `--uncached` compares the same code without retained level views; `--no-multi-draw` checks fallback rendering. |
| `check-geometry-detail.mjs` | Both demos: real first/repeated zoom, retained GPU batches, full geometry restoration, settings/language controls and Hide UI. `--no-multi-draw` covers fallback. `bench-browser --compare-detail --lod-only --gpu-timer` pairs full/high detail twice and low quality in one scene. |
| `profile-sim.mjs`, `check-perf-tools.mjs` | Readable simulation V8 profiles and an actual Chrome CPU/trace-stream smoke check. Sampling and tracing run separately; requests/timeouts and cleanup are bounded. |
| `check-render-batching.mjs` | Real production GLSL/WebGL check: enabled/disabled station draws, open/closed train GPU triangle preservation, and no shader/runtime errors. Supports `--software-gpu` and `--no-multi-draw` (extension disabled before renderer construction); no FPS gate. |

Performance work belongs to `metro-game` plus `metro-game-test`. Run CPU/browser
benchmarks sequentially without builds/tests/profilers competing for the host.
Use `bench:browser -- --compare-batching --investigate` when demo/assets changed:
it compares one population/camera/station and test consist on both sides, records
draw inventory and native multi-draw support, and fails on browser errors. GPU
timers are asynchronous and separate from CPU render submission; buffer counters
exclude textures/uniforms. Profile exports and screenshots are ignored artifacts
under `.preview/perf/`, not timing assertions in the deterministic suite.
For renderer/geometry-detail regressions, `npm --prefix game run test:perf` adds the
floor policy, geometry lifecycle, graphics preference, retained-view and static-render
cases to focused coverage. Then run `npm --prefix game test` for the full suite;
inspect per-module coverage in both test output and keep the coverage map in sync.
| `browser-harness.mjs` | The shared headless-Chrome + static-server driver the `render-*` passes sit on. |
| `train-cards.mjs`, `piece-views.mjs` | The two placement helpers the sheets share: a captured car / run and the metres it covers, so a sheet stands the game's picture on its own line at its own scale. |
| `zoom.mjs` | Crops a detail out of a sheet and writes a `*-zoom.svg` beside it (`sync-art.mjs` skips those). |
| `render-sign-panel.mjs`, `render-tv-plate.mjs` | Render the real sign / TV draw functions to PNG for looking at, rather than asserting. |
| `bake-demo-station.mjs` | Re-bakes the shipped demo save from an author's `metro-save` envelope (see `metro-game`). |
| `prep-sign-icons.py`, `sign-icons-sheet.py` | Turn the supplied 指示牌 photographs into `game/src/assets/pictograms/` and print a contact sheet (see `metro-game`). |
| `_crop.mjs`, `_fill.mjs`, `_poly.mjs`, `_strings.mjs` | Underscore-prefixed dev helpers (an arbitrary crop, a fill, a polygon probe, every `<text>` string in the sheets). Scratch, but tracked. |

## Deploy (Cloudflare Workers)

Everything is static assets; the only server runtime is the language-pin
rewriter. Two Workers, two Workers Builds projects on the same repo, so a push
to `main` ships both:

* `metro` — the site, root `wrangler.jsonc`, assets from `web/dist`, served at
  `stationdesigner.com/` (English `/en/`) on the route
  `stationdesigner.com/*`.
* `metro-game` — the game, `game/wrangler.jsonc`, assets from `game/dist`, served
  at `stationdesigner.com/game/` (English `/game/en/`) on the routes
  `stationdesigner.com/game` and `/game/*`, with `ASSET_PREFIX=/game` and its
  routes declared in its own config (so `wrangler deploy` creates them; no
  dashboard step). `game/worker/index.js` strips `ASSET_PREFIX` before reading
  an asset.

Route gotchas: the game needs **two** routes (bare + `/*`) because `/game/*`
does not match `/game`. Never collapse them to `/game*` — `*` spans `/` and
would swallow paths belonging to the site. `/game/*` beats site `/*` on
specificity. Both Workers must be attached with routes rather than a Custom
Domain, which would claim the whole hostname for one of them; routes need the
hostname proxied in DNS. The root `README.md` holds the full routing table.
