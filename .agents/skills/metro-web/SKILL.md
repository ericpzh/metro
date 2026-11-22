---
name: metro-web
description: Work on the Station Designer concept-art site (`web/`), `metro` Worker (`worker/`, root `wrangler.jsonc`), and generated bilingual concept sheets (`art/`, `png/`). Use for site components, copy, bilingual routing, demo picker, brand icons, `tools/gen-art.mjs` / `tools/iso.mjs` sheets, Chrome captures, or deploys.
---

# Concept-Art Site (`web/`) and Sheets (`art/`, `png/`)

This area covers the public showcase site and the generated bilingual concept
sheets behind it:

* `web/` — React 19 + Vite 8 gallery deployed as Cloudflare Worker `metro` at
  `https://stationdesigner.com/` (Chinese default `/`, English `/en/`). It has
  its own `package.json`, imports nothing from `game/`, and couples to sibling
  apps strictly through URLs and build-time asset copies.
* `art/*.svg` — generated bilingual concept sheets (11 sheets × 2 locales:
  `01`–`07`, `09`, `11`–`13` plus `*-en.svg`).
* `png/*.png` — 300-DPI static PNG exports rasterised from `art/*.svg` via
  `tools/svg-to-png.mjs`.

**Core invariant:** never hand-edit `art/*.svg`, `png/*.png`, `web/public/art/`,
or `web/public/stations/`. Regenerate sheets through `tools/gen-art.mjs` (and
print PNGs through `tools/svg-to-png.mjs`), and let `web`'s sync scripts copy
published assets into `web/public/`.

## Commands

Run from the repo root (PowerShell):

```powershell
npm run setup          # npm --prefix web ci
npm run dev            # Vite dev server at http://localhost:5173
npm run build          # npm --prefix web ci && build into web/dist
npm run preview        # build + wrangler dev
npm run preview:local  # tools/preview.mjs — built web/ and game/ on one origin (port 4173)
npm run deploy         # build + wrangler deploy (Worker `metro`)
npm run check:demos    # build web + game, verify picker & demo routes in headless Chrome
npm run art:models     # refresh passenger/model captures, sheets 01/02/07/12/13, previews & web build
npm run audit:i18n     # AST check for inline player-facing copy in game/src and web/src
```

Build and sync rules:

* Root `npm run build` runs `npm --prefix web ci`, which deletes
  `web/node_modules`. Stop any running `web` dev server first or Windows fails
  with `EPERM` on native bindings; repair an interrupted install with
  `npm --prefix web install`.
* `web/package.json` runs `sync-art` and `sync-stations` automatically on
  `prestart`, `predev`, and `prebuild`.
  * `web/scripts/sync-art.mjs` copies every `art/*.svg` except `_*` drafts and
    `*-zoom.svg` into `web/public/art/` and rejects any file `>= 25 MiB`
    (Cloudflare Workers asset cap).
  * `web/scripts/sync-stations.mjs` copies `game/src/assets/stations/*.webp`
    into `web/public/stations/` with the same `< 25 MiB` guard.
* `web/vite.config.js` sets `base: './'`, `outDir: 'dist'`, and
  `assetsInlineLimit: 0` so builds stay portable across paths.

## Site Architecture (`web/src/`)

Follow the repository i18n rule in [metro-repo](../metro-repo/SKILL.md): keep
all site chrome in `web/src/i18n.js` and sheet metadata in `web/src/artworks.js`
(never inline copy in JSX), preserve Chinese wording when editing English copy,
and run `npm run audit:i18n` afterward.

* **Components (`web/src/App.jsx`, `web/src/components/`):**
  * `Nav`, `Hero`, `Rail`, `Section`, `Sheet`, `Footer`, `DemoPicker`, and
    `BrandMark` (`Lightbox.jsx` is kept unused; sheets render inline at full
    width).
  * `Rail` tracks the visible sheet via `IntersectionObserver` across four
    reading sections.
  * `Sheet` renders sheet `06` inside `<object type="image/svg+xml">` (with an
    `<img>` fallback) so its interactive demand-curve sliders run; all other
    sheets render via `<img>`.
  * `DemoPicker` is the shared modal opened by both the nav and hero demo
    buttons (closes via Escape, backdrop, or `×`). Each card links straight to
    the game's own demo route (`/game/zoo`, `/game/en/tanwei`, `/game/tianhe`).
  * `Hero` embeds the gameplay demo video (`demoVideoEmbed(lang)`: Bilibili for
    `zh`, YouTube for `en`) with muted autoplay, then swaps after
    `demoSeconds` (`71` s in `Hero.jsx`) to `demoVideoPausedEmbed(lang)` paused
    at `0:01` because the cross-origin players expose no ended/seek callback.
    Keep `demoSeconds` synchronized with the video duration.
* **Data and URL builders:**
  * `web/src/artworks.js` — bilingual (`zh` / `en`) sheet catalogue grouped into
    four sections: `overview` (`01`, `02`, `13`), `trains` (`11`, `05`, `12`),
    `building` (`03`, `04`, `09`), and `simulation` (`06`, `07`).
  * `web/src/stations.js` — the three shipped demo IDs (`zoo`, `tanwei`,
    `tianhe`), their `.webp` previews, and `demoPath(lang, id)`. Display names
    live in `web/src/i18n.js` under `demos` (`动物园 / 坦尾 / 天河公园` in `zh`;
    `Zoo / Tanwei / Tianhe Park` in `en`).
  * `web/src/i18n.js` — site chrome (`ui.zh`, `ui.en`), demo-video strings
    (`ui.<lang>.video` and `videoText`, shared with [metro-video](../metro-video/SKILL.md)),
    and URL language helpers (`detectLang`, `canonicalPath`, `isLangHash`).
  * `web/src/site.js` — `sheet(file)`, `stationPreview(file)`, `demoVideo*`,
    `gameHref(lang)`, `demoHref(lang, id)`, `benchmarkHref(lang)`, and
    `statsHref(lang)`. `gameRoot` uses `VITE_GAME_URL` (dev
    `http://localhost:5174/`, prod `/game/`); `statsRoot` uses `VITE_STATS_URL`
    (dev `http://127.0.0.1:5176/stats/`, prod `/stats/`). `Footer` links to the
    GitHub spec/art/repo, `/game/benchmark` (`/game/benchmark/en`), and
    `/stats/` (`/stats/en/`).
* **Brand assets (`web/src/assets/brand/`):** `station-designer-mark.png`,
  `favicon.png`, and `apple-touch-icon.png` are generated from
  `design/icon/station-designer-blue-bold.png` by
  `node tools/prepare-brand-icon.mjs` (which also updates `game/src/assets/brand/`
  and `stats/{brand-mark,favicon}.js`).

## Routing & Cloudflare Worker (`worker/index.js`, `wrangler.jsonc`)

* Root `wrangler.jsonc` deploys Worker `metro` on `stationdesigner.com/*` with
  `web/dist` bound as `ASSETS` (`not_found_handling: "none"`).
* `worker/index.js` only handles the English language pin: `/en` and
  `/en/index.html` 308-redirect to `/en/`, and `/en/*` strips `/en` before
  fetching from `ASSETS` so relative `./assets/...` paths resolve at the root.
  Missing files return a real 404.
* Language selection is strictly URL-driven (no `Accept-Language` or storage
  redirects): `/` stays Chinese; `?lang=en` and `#en` normalize to `/en/` on the
  client.
* More specific Cloudflare routes on the same zone hand sibling paths to their
  own Workers:
  * `metro-game`: `stationdesigner.com/game` and `/game/*`
  * `metro-unity`: `stationdesigner.com/game/unity` and `/game/unity/*`
  * `metro-stats`: `stationdesigner.com/stats` and `/stats/*`
* `tools/preview.mjs` (`npm run preview:local`) serves built `web/dist` at `/`
  and `game/dist` at `/game/` with the same 308 language/trailing-slash rules
  and powers `npm run check:demos`.

## Concept-Sheet Pipeline (Overview)

`node tools/gen-art.mjs [nn …] [--en|--en-only]` builds sheets synchronously
from `tools/sheet-*.mjs` / `tools/sheets-*.mjs` using the true-isometric drawing
kit `tools/iso.mjs`, swaps strings into `*-en.svg` sidecars via
`tools/sheet-i18n.mjs`, prunes unused passenger sprites, and embeds game-rendered
PNGs captured ahead of time into `.preview/*` plus live simulation constants
imported from `game/src/sim/*.ts`.

See [references/concept-sheets.md](references/concept-sheets.md) for:

* Complete sheet module map and capture-script dependency table
* Environment variable overrides and software/hardware GPU flags
* Bilingual sidecar generation and locale-matched UI/view captures
* End-to-end passenger (`npm run art:models`) and train artwork refresh runs
* Sheet-specific layout invariants, browser animation checks, and preview tools

## Related Skills

* [metro-repo](../metro-repo/SKILL.md) — repo layout, shared i18n rules, and full `tools/` index
* [metro-game](../metro-game/SKILL.md) — Three.js game app, `sim/` constants, and `metro-game` Worker
* [metro-game-test](../metro-game-test/SKILL.md) — `game/test/` regressions (including art-pipeline tests)
* [metro-model](../metro-model/SKILL.md) — soft-human passenger library and `bake:passengers`
* [metro-stats](../metro-stats/SKILL.md) — `metro-stats` Worker linked from the site footer
* [metro-unity-web](../metro-unity-web/SKILL.md) — `metro-unity` Worker on `/game/unity/`
* [metro-video](../metro-video/SKILL.md) — demo video pipeline consuming `web/src/i18n.js` (`video`)
