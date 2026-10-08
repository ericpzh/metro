---
name: metro-repo
description: Entry point for the ericpzh/metro repo — a React 19 + three.js metro-station building sandbox in game/ plus the concept-art site in web/. Use for repo-wide work (what lives where, root commands, conventions, Cloudflare deploy, the tools/ scripts) and to reach the subskills — metro-game (game/src), metro-game-test (game/test), metro-web (web/ and art/).
---

# Metro Station Designer — repo entry point

A 3D sandbox about moving crowds through a metro station you build yourself.
Block-based construction (1 block = 1 m), procedural voxel art, real rolling
stock, real passenger flow. No money or staff: you build, the crowds arrive, and
the station either copes or it does not.

**This skill is the router — load the subskill that owns the work.**

| Work | Skill |
|---|---|
| Anything under `game/src` — the sim, the renderer, the builder, the app shell, the save format | `metro-game` |
| Adding, running or fixing tests under `game/test` | `metro-game-test` |
| `web/` (the concept-art site), `art/` (the sheets), and the art/card renderers in `tools/` | `metro-web` |

## What lives where

| Path | What it is |
|---|---|
| `GAME-SPEC.md` | The design specification — the source of truth for *what* the game does. Cite its sections in code comments. |
| `game/` | **The game** — React 19 + three.js + a Web Worker sim. Own `package.json`, Vite config, tests, and Cloudflare Worker (`metro-game`). |
| `game/src/` | The game's source: `sim/` `build/` `render/` `persistence/` `data/` `app/`. `metro-game` maps it file by file. |
| `game/test/` | The `node --test` suite. `game/test/README.md` is the authority on how it works; `metro-game-test` is the short version. |
| `game/README.md` | The game's own long-form guide: milestones, the time base, measured numbers, deliberate divergences from the spec. **Read it before changing sim behaviour.** |
| `web/` | The concept-art site (React + Vite), deployed as Worker `metro`. |
| `art/` | The generated concept sheets — the source of truth, copied into `web/public/art` at build time by `web/scripts/sync-art.mjs`. Never hand-edited. `metro-web` covers the pipeline. |
| `tools/` | Root-level Node/Python scripts: the art generator and viewer, the headless-Chrome passes that photograph the game, the demo-save bake, the pictogram asset prep. See the index below. |
| `worker/index.js` | The site's path-prefix rewrite entry (root Worker). `game/worker/index.js` is the game's. |
| `wrangler.jsonc` | Root site Worker config, prefix `/metro`. `game/wrangler.jsonc` is the game's, prefix `/metro-game`. |

The site and the game are **two apps and two Workers** in one repo. They build
and deploy independently; the only coupling is a URL (`gameUrl` in
`web/src/site.js`, overridable with `VITE_GAME_URL`).

`game/plan.md` and the root `PLAN.md` are **gone**. Source comments that cite
them — the R1–R6 / lane language included — are historical; do not follow them.

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
npm run test:game     # node --test over game/test/**/*.test.mjs
npm run build:game    # install game/ deps, then tsc --noEmit && vite build
npm run deploy:game   # build:game, deploy metro-game, attach its routes

npm run preview:local # tools/preview.mjs — both built apps on one origin
```

Inside `game/`: `npm run dev` (5174), `npm run typecheck`, `npm run build`,
`npm test`, `npm run preview` (4174); `npm start` there builds then previews.
Note: `npm start` at the **repo root** is the game, not the site.

On Windows PowerShell 5.1 the `&&` separator is not valid — use `;` or separate
commands.

## `tools/` index

| Script | What it does |
|---|---|
| `gen-art.mjs [nn …]` | Regenerates every `art/*.svg` (or only the sheets named by leading number / file name), one `sheet-*.mjs` / `sheets-*.mjs` module per sheet, drawn through `iso.mjs`. Sheet 01 is `sheet-01-hero-banded.mjs`. Sheets 08 and 10 are retired; the eleven live ones are 01–07, 09, 11–13. |
| `sheet-png.mjs <nn>` | Rasterises one sheet in a headless browser so the composition can be **looked at** (`--at <s>` freezes an animated sheet). |
| `serve.mjs [port]` | The static sheet viewer (default 4173). |
| `preview.mjs` | `npm run preview:local`: serves the built site at `/`, the built game at `/game/` and `/metro-game/`, over one origin. Stands in for `wrangler dev`. |
| `render-module-cards.mjs` | Sheet 04's cards: drives headless Chrome to run the game's own thumbnail pass. Needs Chrome + `game/dist`. |
| `render-block-cards.mjs` | Sheet 03's blocks, meshed and lit by the game (same shape). |
| `render-ui-shots.mjs` | Sheets 06 and 07: boots the game, drives it into real states, crops each window / chrome region to its own DOM box at 2×. |
| `render-train-cards.mjs` | Sheets 02, 05, 11, 12 and 13: builds each stock class with `buildTrain`, frames one car or a consist (`--trim-only` re-crops without booting the game). |
| `render-train-animation.mjs`, `train-animation.mjs` | Capture and place real rendered door/headlight poses for animated train details. The capture writes `.preview/train-animation/`; `gen-art.mjs` reads it when generating sheets that use these poses. |
| `render-piece-elevations.mjs` | Sheet 02's pieces: the rail's own piece builder asked for square-on elevations, one scale, base on the picture's bottom edge. |
| `render-piece-views.mjs` | Sheets 01 and 13's pieces: the same pieces on the drawing kit's isometric axes, with the layout (frame, pixels, origin) that lets a sheet scale a run to the floors it joins. `--hero --scale 4` captures sheet 01's station layers separately in `.preview/hero-piece-views/`; the default capture feeds sheet 13 in `.preview/piece-views/`. |
| `station-elevations.mjs`, `station-piece-images.mjs` | Read the square-on and isometric station-piece captures into authored sheet drawings, retaining each model's metre dimensions and placement anchor. |
| `demand-animation.mjs` | Builds sheet 06's demand-curve preview from the game's demand and calendar rules. In an embedded SVG document, its time-boundary handles can be dragged or adjusted with arrow keys. |
| `render-view-shots.mjs` | Photographs the demo station from each of the game's own camera presets (sheet 09's subject) into `.preview/view-shots/`, for looking at rather than asserting. |
| `game-tiles.mjs` | Starts the built game in headless Chrome and saves the build rail's real preview tiles, for checking an art change against it. |
| `browser-harness.mjs` | The shared headless-Chrome + static-server driver the `render-*` passes sit on. |
| `train-cards.mjs`, `piece-views.mjs` | The two placement helpers the sheets share: a captured car / run and the metres it covers, so a sheet stands the game's picture on its own line at its own scale. |
| `zoom.mjs` | Crops a detail out of a sheet and writes a `*-zoom.svg` beside it (`sync-art.mjs` skips those). |
| `render-sign-panel.mjs`, `render-tv-plate.mjs` | Render the real sign / TV draw functions to PNG for looking at, rather than asserting. |
| `bake-demo-station.mjs` | Re-bakes the shipped demo save from an author's `metro-save` envelope (see `metro-game`). |
| `prep-sign-icons.py`, `sign-icons-sheet.py` | Turn the supplied 指示牌 photographs into `game/src/assets/pictograms/` and print a contact sheet (see `metro-game`). |
| `_crop.mjs`, `_fill.mjs`, `_poly.mjs`, `_strings.mjs` | Underscore-prefixed dev helpers (an arbitrary crop, a fill, a polygon probe, every `<text>` string in the sheets). Scratch, but tracked. |

## Deploy (Cloudflare Workers)

Everything is static assets; the only server runtime is the path-prefix
rewriter. Two Workers, two Workers Builds projects on the same repo, so a push
to `main` ships both:

* `metro` — the site, root `wrangler.jsonc`, assets from `web/dist`, served at
  `ericpzh.rest/metro/` with `ASSET_PREFIX=/metro`.
* `metro-game` — the game, `game/wrangler.jsonc`, assets from `game/dist`, served
  at `ericpzh.rest/metro-game/` with `ASSET_PREFIX=/metro-game` and its routes
  declared in its own config (so `wrangler deploy` creates them; no dashboard
  step).

Route gotchas: each Worker needs **two** routes (bare + `/*`) because `/metro/*`
does not match `/metro`; never collapse them to `/metro-game*` — `*` spans `/`
and would swallow paths belonging to the other Worker. Routes need the hostname
proxied in DNS. The root `README.md` holds the full routing table.
