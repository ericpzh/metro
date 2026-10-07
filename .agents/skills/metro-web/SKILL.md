---
name: metro-web
description: Work in web/ or art/ of the ericpzh/metro repo — the React + Vite concept-art site and the generated SVG concept sheets. Use for the site's components, copy and routing, the art generator and drawing kit (tools/gen-art.mjs, tools/iso.mjs, the sheet modules), the headless-Chrome passes that photograph the game into the sheets, or the `metro` Worker deploy.
---

# The concept-art site (`web/`) and the sheets (`art/`)

Two things on one pipeline:

* `art/*.svg` — the generated concept sheets. The source of truth, **never
  hand-edited**.
* `web/` — the React + Vite gallery that shows them, deployed as Worker `metro`
  at `ericpzh.rest/metro/`.

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

* `web/src/App.jsx` + `web/src/components/` — `Nav`, `Hero`, `Sheet`, `Rail`,
  `Section`, `Lightbox`, `Footer`, `GamePage`. One component per region; the
  gallery is data-driven.
* `web/src/artworks.js` — the sheets as data: spec id, title, body copy,
  the three reading sections. Its measured `panel` placement data is **currently
  unused** — `Sheet.jsx` pins the text card to the lower-right corner — and is
  kept as the reference for when per-sheet placement comes back.
* `web/src/site.js` — repo / spec / art links, `sheet(file)` (Vite
  `BASE_URL`-aware), `gamePath`, and `gameUrl` = `VITE_GAME_URL`, else the dev
  server `http://localhost:5174/`, else `/metro-game/`. The **游戏 tab**
  (`components/GamePage.jsx`) is a full-viewport iframe at `<site>/game/` around
  the game's own Worker, with a way back and an "open in a new tab" link.
* `web/public/art/` is **generated** at build time by `web/scripts/sync-art.mjs`,
  which copies every `art/*.svg` except `_*` drafts and `*-zoom.svg`. Never edit
  files there, and never add a sheet to the site by hand.
* `web/vite.config.js` — `base: './'` so the build is portable under the path
  prefix, `assetsInlineLimit: 0`.
* The Worker is a prefix rewrite, not a server: root `wrangler.jsonc`
  (`ASSET_PREFIX=/metro`, assets from `web/dist`) plus `worker/index.js`. Route
  gotchas and the two-Worker table are in `metro-repo` and the root `README.md`.

## The sheets (`art/`, and the `tools/` that draw them)

`node tools/gen-art.mjs [nn …]` rewrites every sheet from its own `SHEETS` table,
or only the ones named by leading number / file name
(`node tools/gen-art.mjs 01 13`), one module per sheet, drawn with `tools/iso.mjs`,
the **true isometric** projection kit — equal foreshortening on all three axes
(`TW` / `TH` / `ZU`), which is what lets a rendered piece stand in a drawing
undistorted — with its box / quad / face / ramp primitives, the depth-sorting
`Scene()`, `bboxOf` / `fitToRect` for framing a composed drawing, and the sheet
furniture: `title`, `legend`, `callout`, `chart`, and the motion CSS.
`tools/sheet-plan.mjs` is the **panel plan for the older photograph pass**
(`tools/shots.mjs`): one entry per sheet that pass still composes, naming the spec
id, the file and the camera each panel is shot from. Sheets 08 and 10 are retired
(`DROPPED`), and 02, 03, 04, 05, 06, 07, 11, 12 and 13 do not go through it at all
— they are the ones that carry the game's own renders.

| Sheet | Module |
|---|---|
| 01 isometric cutaway | `sheet-01-hero.mjs` |
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

**Nine sheets embed PNGs the game rendered**: 02, 03, 04, 05, 06, 07, 11, 12 and
13. A sheet builds *synchronously* and only reads files, so the capture has to
exist first, and every capture needs Chrome plus a built `game/dist`:

| Sheet | Capture | Reads from |
|---|---|---|
| 02 | `tools/render-train-cards.mjs` + `tools/render-piece-elevations.mjs` | `.preview/train-cards/`, `.preview/piece-elevations/` |
| 03 | `tools/render-block-cards.mjs` | `.preview/block-cards/` |
| 04 | `tools/render-module-cards.mjs` | `.preview/module-cards/` |
| 05, 11, 12, 13 | `tools/render-train-cards.mjs` | `.preview/train-cards/` |
| 13 | `tools/render-piece-views.mjs` | `.preview/piece-views/` |
| 06, 07 | `tools/render-ui-shots.mjs` | `.preview/ui-shots/` |

A **car** goes into a drawing at its own scale (`train-cards.mjs` `carImage` /
`trainCard`); a **run** is scaled to reach the floors it joins, which is the
`piece-views.mjs` `runImage` job, so 02's section takes the pieces square-on
(`piece-elevations`) and 13's volume takes the same pieces on the drawing kit's
own isometric axes (`piece-views`).

(`TRAIN_CARDS_DIR` / `PIECE_ELEVATIONS_DIR` / `PIECE_VIEWS_DIR` / `UI_SHOTS_DIR`
override those directories.) The pictures are the game's — a sheet adds the
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
