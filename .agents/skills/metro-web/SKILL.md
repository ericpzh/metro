---
name: metro-web
description: Work in web/ or art/ of the ericpzh/metro repo — the React + Vite concept-art site and the generated SVG concept sheets. Use for the site's components, copy and routing, the art generator and drawing kit (tools/gen-art.mjs, tools/iso.mjs, the sheet modules), the headless-Chrome passes that photograph the game into the sheets, or the `metro` Worker deploy.
---

# The concept-art site (`web/`) and the sheets (`art/`)

Two things on one pipeline:

* `art/*.svg` — the generated concept sheets. The source of truth, **never
  hand-edited**.
* `web/` — the React + Vite gallery that shows them, deployed as Worker `metro`
  at `https://stationdesigner.com/` (English `/en/`).

`web/` is its own app (its own `package.json`) and imports nothing from `game/`.
The only coupling is a URL. The game's own skill is `metro-game`.

## Commands

From the repo root:

```powershell
npm run setup          # install web/ deps
npm run dev            # site dev server at http://localhost:5173
npm run build          # build the site into web/dist
npm run deploy         # build + wrangler deploy (Worker `metro`)
npm run preview:local  # tools/preview.mjs — the built site and game on one origin
```

`web/package.json`'s own `sync-art` script runs automatically as `prestart` /
`predev` / `prebuild`, so a build can never serve a stale sheet.

## The site

Follow the [repo translation rule](../metro-repo/SKILL.md#repo-rule-translations-use-the-existing-i18n-infrastructure).
Keep translations in the existing site/art catalogues, including language-switch
labels and capture-tool output. Use the game's `tForLanguage` in capture tools
instead of hand-formatting translated templates; use `sheetText` from
`tools/sheet-i18n.mjs` before drawing when English width affects layout. An
English-copy change must preserve the Chinese catalogue and default captures.

* `web/src/App.jsx` + `web/src/components/` — `Nav`, `Hero`, `Sheet`, `Rail`,
  `Section`, `Footer`. One component per region; the gallery is
  data-driven. The left-side `Rail` tracks the current sheet and links to four
  reading sections. Sheets render at full width with their short introduction
  above the image; the gallery does not open a lightbox.
* `web/src/artworks.js` — the sheets as data: spec id, title, player-facing
  introduction, alt text, section and order. The four paths are the station
  (01, 02, 13), trains and boarding (11, 05, 12), building (03, 04, 09), and
  passenger flow and interface (06, 07). Section notes introduce each group.
* `web/src/site.js` — repo / spec / art links, `sheet(file)` (Vite
  `BASE_URL`-aware), and the game URL: `gameRoot` = `VITE_GAME_URL`, else the
  dev server `http://localhost:5174/`, else `/game/`, with `gameHref(lang)`
  appending `en/` for English. The game is its own Worker at
  `stationdesigner.com/game/` (`/game/en/` for English), so the site's 游戏 and
  Play links point straight at it — there is no iframe tab.
* `web/public/art/` is **generated** at build time by `web/scripts/sync-art.mjs`,
  which copies every `art/*.svg` except `_*` drafts and `*-zoom.svg`. Never edit
  files there, and never add a sheet to the site by hand.
* `web/vite.config.js` — `base: './'` so the build is portable, `assetsInlineLimit: 0`.
* The site Worker is not a server: root `wrangler.jsonc` (route
  `stationdesigner.com/*`, assets from `web/dist`) plus `worker/index.js`, which
  only pins `/en` → `/en/` and serves the document for the language route. Route
  gotchas and the two-Worker table are in `metro-repo` and the root `README.md`.

## The sheets (`art/`, and the `tools/` that draw them)

After character, size or crowd-material changes, use `metro-model` and run
`npm run art:models`. It captures every eligible adult and child template
(currently 212 adult / 114 child choices across 232 exports) with the live 70% game
opacity, including forty jacket-free clothing/grey-arrangement entries shared
by adults and children. Playback checks require newly clothed figures in both
age groups. The pipeline validates complete strides and source
hashes, refreshes bilingual sheets 01/02/07/12/13 and renders previews at 8 s.
The sheet figure helpers use stable 20/80 child/adult selection; child cards must
have hair and may carry only approved small backpacks or crossbody bags. Explicit
catalogue age flags determine both pools, including child-only female crossbody
templates. Gait duration uses the captured stride after depth scaling.
Keep `.preview/model-art/` captures separate from other running previews and
retain `capture-passengers` / `passenger-art-pipeline` coverage when changing formats.
On a local GPU, `$env:METRO_BROWSER_GPU='hardware'` opts browser tools into
hardware rendering; the default remains software rendering for reproducibility.
Use the same GPU mode across captures and playback validation.
Full-resolution interface shots default to software even in that mode: Windows
hardware rendering can time out on the supersampled station screenshot.
`METRO_UI_BROWSER_GPU=hardware` explicitly opts only those screenshots in.
Passenger batches reuse one GPU atlas across their bounded calls and explicitly
dispose it at completion; retain both the batch bound and final disposal.
Static sprite definitions reuse identical positioned bitmap nodes while keeping
all `human-*` IDs and transforms. Keep this deduplication as the catalogue grows;
`sync-art.mjs` rejects sheets at or above the strict 25 MiB Worker asset limit.
`passenger-art-pipeline` checks sprite identity/placement and actual sheet sizes.

`node tools/gen-art.mjs [nn …]` rewrites every sheet from its own `SHEETS` table,
or only the ones named by leading number / file name
(`node tools/gen-art.mjs 01 13`), one module per sheet, drawn with `tools/iso.mjs`,
the **true isometric** projection kit — equal foreshortening on all three axes
(`TW` / `TH` / `ZU`), which is what lets a rendered piece stand in a drawing
undistorted — with its box / quad / face / ramp primitives, the depth-sorting
`Scene()`, `bboxOf` / `fitToRect` for framing a composed drawing, and the sheet
furniture: `title`, `legend`, `callout`, `chart`, and the motion CSS.
`node tools/gen-art.mjs --en` (or `node tools/gen-art.mjs 02 --en`) writes a
`*-en.svg` English sidecar beside each sheet by swapping the Chinese strings in
the built SVG via `tools/sheet-i18n.mjs` — `<text>` contents, sheet 06's slider
`aria-label`s and its live-readout script literals; numbers from `sim/` are
untouched. Bake problems fail the run (missing strings, unescaped markup).
English is wider than Chinese, so keep translations terse and check the fit with
`node tools/sheet-png.mjs <name>-en.svg`; `{ t, size }` table values pull a long
label's font-size down. Exact UI labels use `game/src/sim/i18n/messages.ts`; keep
sheet-only explanatory copy in the art table. Use `sheetText(key, language)` for
any label measured before drawing (e.g. sheet 09's key chips). Sheets 06, 07 and 09 must embed
captures in the sheet's locale: run `node tools/render-ui-shots.mjs --lang en`
and `node tools/render-view-shots.mjs --lang en` for English, then
`node tools/gen-art.mjs 06 07 09 --en-only` to refresh only English sidecars.
Default captures stay Chinese. English captures live in `.preview/ui-shots-en/`
and `.preview/view-shots-en/` (`UI_SHOTS_EN_DIR` / `VIEW_SHOTS_EN_DIR` overrides).
Check the animated demand overlay as well as screenshots for clipped labels. The site's `/en/` route shows the sidecars
(`sync-art.mjs` copies them like any other sheet).

Sheets 01, 02, 12 and 13 place PNG captures of the game's actual passenger mesh.
After changing the approved model library or crowd material, run
`npm run art:models` from the root. This regenerates approved exports and atlas,
builds the game, captures every variant and bilingual interface screenshots, regenerates sheets 01/02/07/12/13 in both
languages, checks gait playback, renders PNG previews and builds/syncs the site.
For art-only updates use `npm run art:models -- --from-game` to reuse the game
atlas. Neither command deploys. `metro-model` owns model editing and the bake.
The capture manifest records source hashes; validation rejects stale builds,
missing variants and incomplete walks. Static sprite pools and bounded capture
batches grow automatically with the catalogue.
The capture pass freezes four samples per outfit in isometric, elevation and plan
views: three are mid-stride and one is idle. It applies `passengerAppearance` for
the same outfit, height, build, heading and grey-tone variation the crowd uses.
Check the resulting sheets with `node tools/sheet-png.mjs 01`, `02`, `12` and `13`;
the figures should remain foot-anchored and varied, with most shown walking.
The same capture pass also writes `walking-index.json`: complete 24-frame strides
for every catalogue entry in plan, elevation (two headings) and isometric (eight
headings) views. The driver captures each camera/heading in a bounded batch;
keep that batching for both stills and walks when extending the pass so the CDP
response stays within its message and timeout limits. Movers in sheets 01, 02,
12 and 13 must cycle these poses
rather than slide a frozen human. `mover` selects the camera, heading and gait speed for
human sprites; use `walkView: 'elevation'` for sections. Short loops fade out
before resetting, so figures never walk backward to their starting point.
Use `walkingHeading` for camera-relative facing: the isometric camera projects
+X left/down and +Y right/down, opposite the drawing's horizontal axes. Its
capture heading swaps the drawing's world X/Y. Keep the eight-direction
`art-passenger-heading` projection test passing; gait playback alone cannot
detect people walking sideways.
In sheet 12-A, queue figures must use idle poses
with varied headings. Boarding and alighting figures cycle these strides facing
toward and away from the train, respectively. `walkingDefinitions` embeds each
used bitmap once per sheet; `walkingSprite` and `walkingPlanSprite` phase the gait
at the path's speed. Keep
movers confined to the doors-open interval. Check live SVG playback as an image,
and frozen previews at multiple times; `sheet-png --at` must preserve frame delays.
Run `node tools/test-passenger-animation.mjs` after regeneration: it checks for
missing or overlapping frames and real gait changes in SVG images for all cameras.
In 12-B, draw the foreground platform after the train so it hides the wheels.
In 12-C, use the `gate-single` elevation capture, which hides the spare gate leaf
using the game's `hideSecondGateDoor` capture option.
Sheet 13's near platform screen door is the inside-facing model and sorts in front
of the crowd, so its printed face is hidden from the cutaway camera.
`tools/sheet-plan.mjs` is the **panel plan for the older photograph pass**
(`tools/shots.mjs`): one entry per sheet that pass still composes, naming the spec
id, the file and the camera each panel is shot from. Sheets 08 and 10 are retired
(`DROPPED`), and 02, 03, 04, 05, 06, 07, 11, 12 and 13 do not go through it at all
— they are the ones that carry the game's own renders.

| Sheet | Module |
|---|---|
| 01 isometric cutaway | `sheet-01-hero-banded.mjs` |
| 02 vertical section | `sheets-a.mjs` (`artSection`) |
| 03 block system | `sheet-03-blocks.mjs` |
| 04 module catalogue | `sheet-04-modules.mjs` |
| 05 trains and track | `sheet-05-trains.mjs` |
| 06 crowd demand | `sheet-06-demand.mjs` |
| 07 interface | `sheet-07-interface.mjs` |
| 09 camera and views | `sheets-c.mjs` (`artViews`) |
| 11 rolling stock 3D | `sheet-11-trains3d.mjs` |
| 12 platform doors and flow | `sheets-e.mjs` (`artPlatformFlow`) |
| 13 two-line interchange | `sheet-13-two-line.mjs` |

Eleven sheets embed game-rendered PNGs: 01, 02, 03, 04, 05, 06, 07, 09, 11, 12 and 13.
A sheet builds *synchronously* and only reads files, so captures must exist first;
the browser passes need Chrome plus a built `game/dist`:

| Sheet | Capture | Reads from |
|---|---|---|
| 02 | `tools/render-train-cards.mjs` + `tools/render-piece-elevations.mjs` | `.preview/train-cards/`, `.preview/piece-elevations/` |
| 03 | `tools/render-block-cards.mjs` | `.preview/block-cards/` |
| 04 | `tools/render-module-cards.mjs` | `.preview/module-cards/` |
| 05, 11, 12, 13 | `tools/render-train-cards.mjs` | `.preview/train-cards/` |
| 13 | `tools/render-piece-views.mjs` | `.preview/piece-views/` |
| 06, 07 | `tools/render-ui-shots.mjs` | `.preview/ui-shots/` |
| 09 | `tools/render-view-shots.mjs` | `.preview/view-shots/` |
| 01, 02, 12, 13 | `tools/render-passenger-cards.mjs` | `.preview/passenger-cards/` |

A **car** goes into a drawing at its own scale (`train-cards.mjs` `carImage` /
`trainCard`); a **run** is scaled to reach the floors it joins, which is the
`piece-views.mjs` `runImage` job, so 02's section takes the pieces square-on
(`piece-elevations`) and 13's volume takes the same pieces on the drawing kit's
own isometric axes (`piece-views`).

(`TRAIN_CARDS_DIR` / `PIECE_ELEVATIONS_DIR` / `PIECE_VIEWS_DIR` / `UI_SHOTS_DIR`
override those directories.) The captures are the game's — a sheet adds the
numbered key and the reading, and **nothing about a
piece's geometry, camera, label or throughput is stated on it**. Several sheets
also read their numbers out of `sim/` **by import** (`stock.ts`, `constants.ts`,
`finishes.ts`, `demand.ts`, `clock.ts`), so a retuned value moves the sheet's text
as well as its pictures.

Looking at a sheet rather than diffing it:

```powershell
node tools/sheet-png.mjs 03      # rasterise one sheet (--at <s> freezes animation)
node tools/serve.mjs             # the static sheet viewer
node tools/render-view-shots.mjs # the demo station through the game's own camera presets
```

`tools/render-sign-panel.mjs` and `tools/render-tv-plate.mjs` do the same for the
sign and TV draw functions alone. `tools/zoom.mjs` crops a detail out of a sheet
and writes a `*-zoom.svg` beside it (which `sync-art.mjs` then skips). The
pictogram asset prep (`prep-sign-icons.py`, `sign-icons-sheet.py`) is game-owned —
see `metro-game`. The rest of `tools/` is indexed in `metro-repo`.

Two traps:

* **Do not hand-edit `art/*.svg`** — `gen-art.mjs` rewrites them, and the site
  copies them.
* `tools/shots.mjs` is a **leftover from a reverted experiment** that photographed
  whole sheets as screenshots. Its header still claims it replaced
  `gen-art.mjs`; it did not — the sheets are drawings again, and `gen-art.mjs` is
  the generator.
