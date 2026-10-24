# Station Designer

**A 3D sandbox about moving crowds through a metro station you build yourself.**

Block-based construction (1 block = 1 m) with smooth-corner voxel art, real rolling stock, real
passenger flow. No money, no staff hiring, no upkeep: you build, the crowds arrive, and the station
either copes or it does not.

| Path | What it is |
|---|---|
| [`GAME-SPEC.md`](GAME-SPEC.md) | The full design specification (draft 1). |
| [`game/`](game/) | **The game** — React + three.js + a Web Worker sim. Own app, own deploy. |
| [`art/`](art/) | Eleven concept sheets: drawings of the game, as SVG. Nine of them carry the game's own renders. |
| [`tools/`](tools/) | The generators for both: `node tools/gen-art.mjs` redraws `art/`. |
| [`web/`](web/) | The concept-art website — React + Vite. |
| [`model/`](model/) | Character model library — three.js + Vite, male/female previews and GLB downloads. |
| [`stats/`](stats/) | Global stats service — one Worker + D1, page and API at `stationdesigner.com/stats/`. |
| [`wrangler.jsonc`](wrangler.jsonc) | Cloudflare Workers deploy config for the site — route `stationdesigner.com/*`. |
| [`stats/wrangler.jsonc`](stats/wrangler.jsonc) | Stats Worker config: production database/routes plus a local-only `dev` environment. |
| [`worker/`](worker/) | The site's Worker: pins `/en` to `/en/` and serves the English document. |

## The game

The game is a separate application from the art site: its own `package.json`,
Vite config, tests and Cloudflare Worker (`metro-game`). It reads nothing from
`web/`.

It is served from **https://stationdesigner.com/game/** — English at
**https://stationdesigner.com/game/en/** — by its own Worker, on the routes
declared in `game/wrangler.jsonc`. The art site owns the rest of the domain, and
its 游戏 link and 开始游戏 button point at those two URLs. That URL is the only
coupling between the two apps: it is built in [`web/src/site.js`](web/src/site.js)
(`gameHref`) and can be overridden with `VITE_GAME_URL`. The Worker's own
`workers.dev` root keeps serving the same build.

**A demo station can be opened straight from the URL** — that is the fourth and
fifth way in:

| URL | Opens |
|---|---|
| `/game/zoo`, `/game/en/zoo` | 动物园, 广州地铁 5号线 — the five-level station with a surface plaza |
| `/game/tanwei`, `/game/en/tanwei` | 坦尾, 广州地铁 5/6号线 — the elevated interchange |

The path opens that example station instead of the local autosave, then rewrites
the URL to the plain game path (`/game/`, `/game/en/`), so a reload restores what
the player was building rather than throwing their edits away. `boot.tsx` does
that through `app/demoRoute.ts`.

The site's **示例车站** picker is the shop window for those routes: the nav button
left of 看图 and the hero button between 开始游戏 and 浏览概念图 open the same
two-card dialog, and each card is a plain link to one of the demo URLs. The cards'
pictures are the game's own previews (`game/src/assets/stations/*.webp`), copied
into the site at build time by `web/scripts/sync-stations.mjs` — the site never
imports game code, only the two pictures and the URL.

`game/wrangler.jsonc` declares the game's route pair, so `npm run deploy:game`
creates them along with the Worker — there is no dashboard step and nothing to
keep in sync by hand.

```bash
npm start             # web 5173 + game 5174 + model 5175 + stats 5176
npm run setup:game    # install game/ deps
npm run dev:game      # http://localhost:5174 (the site owns 5173)
npm run dev:stats     # http://localhost:5176/ (local D1 filled by the game at :5174)
npm run test:game     # node --test: determinism, tick budgets, capacity ladder
npm run check:demos   # builds both apps, then walks the picker and all four demo URLs in Chrome
npm run deploy:game   # build, deploy metro-game, and attach its route pair
npm run deploy:stats  # migrate the remote stats D1, deploy metro-stats, verify the live API
```

To follow a game link locally, run the site and the game side by side:

```bash
npm run dev           # site dev server at http://localhost:5173
npm run dev:game      # game at http://localhost:5174, linked from http://localhost:5173
npm run dev:model     # model library at http://127.0.0.1:5175/
```

In development the site links straight at the game's own Vite server — `/` for
Chinese, `/en/` for English — because `/game/` is a deployed-Worker route, not a
dev-server path.

`game/README.md` covers the milestones, the simulation's time base, and the
places where the vertical slice deliberately diverges from the spec.


## The model library

`model/` is the third independently built app. It includes the approved male
commuter and five female hair/backpack variants, standing views, three walk
profiles, English/Chinese controls and GLB downloads. Long hair uses the no-backpack
version. Its character and gait source also powers the earlier prototype pages.

```bash
npm run setup:model   # install model/ dependencies
npm run build:model   # generate the library and build model/dist
npm run dev:model     # http://127.0.0.1:5175/
npm run dev:all       # start web/, game/, model/ and stats/ together
```

`npm start` is an alias for `dev:all`. The launcher reuses existing listening
services and stops only its own children on Ctrl+C. `npm run setup:all` installs
dependencies for the three Vite apps (the stats Worker uses only the root wrangler install). See
`model/README.md` for assets and provenance.

## The stats service

`stats/` is a third, independent Worker: **`metro-stats`** serves the public
totals page at <https://stationdesigner.com/stats/> (English at
<https://stationdesigner.com/stats/en/>) and the JSON API at `/stats/api/v1/*`,
backed by the remote D1 database `metro-stats`. The page and the API have no
build step; the Worker's source and the database schema ship together. The
site's footer 文档 list links here (English to `/stats/en/`), and the stats page
links back to the site. See [`stats/README.md`](stats/README.md) for the
endpoints, the schema, idempotency and data policy.

Production and development are separate environments in
[`stats/wrangler.jsonc`](stats/wrangler.jsonc):

```bash
npm run dev:stats      # http://localhost:5176/ — dev env, local D1, fed by the game at :5174
npm run test:stats     # Worker routing/validation suite against a fake D1
npm run deploy:stats   # apply the schema remotely, deploy production, verify live
```

The local preview starts with an empty database, so its numbers are the real
submissions from the game at `localhost:5174` (the dev collector posts the
current built station once and then every five seconds);
`npm run dev:stats -- --seed` adds sample rows only for a UI pass.
The preview never touches the production database: it runs the `dev`
environment (no routes, a different database id) and the page shows a
`开发预览 · 本地数据库` badge. The production deploy applies
`schema.sql` to the remote database before uploading the Worker; both the bare
`/stats` and the `/stats/*` route are declared so the page and API resolve.
The game reports a built station's counts and passenger deltas every five
minutes (five seconds on localhost) and on `pagehide`; the gear menu's
分享匿名统计 toggle opts out.

## The site

A dark, single scrolling page: every concept sheet runs edge to edge, and its design note is a
translucent glass panel floating over the drawing. Click any sheet to open it at full resolution.

Two buttons — 示例车站 in the nav, left of 看图, and the one between 开始游戏 and 浏览概念图 in the
hero — open a picker of the game's two example stations. Each card is that game's own preview
render and a link to the station's demo route, so choosing one starts the game on it. The dialog is
[`web/src/components/DemoPicker.jsx`](web/src/components/DemoPicker.jsx); its copy is in
[`web/src/i18n.js`](web/src/i18n.js) and the previews are published from the game at build time.

Seven sheets are **photographs of the game** rather than drawings of it: 03's blocks come from the game's own
chunk mesher, 04's modules from the pass the build rail uses, 06 is the 客流 window in the four day
types its calendar derives, 07 is the interface itself region by region, and 05, 11 and 12's rolling stock is
`buildTrain` — the consist the platform actually runs — all rendered in a headless browser. Sheet 12 is the
one that composites: its plan is rendered with a **cleared alpha** so it slides over the platform the sheet
draws underneath. The other four — 01, 02, 09 and 13 — are drawn by hand in the same **true
isometric** the game's own piece renders are photographed on, and 02's section furniture and 13's
runs are set in from those renders.
All of them are dark, so the page is built to match them rather than fight them.

**Panel placement is measured, not eyeballed** on the diagrams the sheets used to be. Each sheet
was rasterised at a 1440px reference width and scanned with an edge-energy map for the quietest
band that still keeps the whole card on screen; the result is stored per sheet as `panel` in
[`web/src/artworks.js`](web/src/artworks.js). Panels either hug the 5% margin (`mode: 'edge'`) or
sit in a genuine pocket in the middle of the drawing (`mode: 'free'`). Below 1100px the overlay
would cover too much of the art, so the panel docks to the bottom edge of the sheet instead.

```bash
cd web
npm install
npm run dev     # http://localhost:5173
```

Or from the repository root, without `cd`-ing:

```bash
npm install     # root deps (wrangler)
npm run setup   # installs web/ deps
npm run dev     # dev server at http://localhost:5173
```

`npm run dev` is a thin alias for `web`'s `dev` script, so it runs `sync-art` first and then Vite.
`npm start` launches all three dev services. Use `npm run dev:game` for the game
alone, or run `npm start` inside `game/` to build and preview its production app.

## Deploying to Cloudflare

Cloudflare builds the site in CI and publishes it as **Workers static assets** — no server, no
runtime code. Everything is driven by [`wrangler.jsonc`](wrangler.jsonc) at the repo root, which
points `assets.directory` at `./web/dist`.

### Connecting the repository

Workers & Pages → **Create** → **Connect to Git** → pick `ericpzh/metro`, then on *Set up your
application* fill in:

| Field | Value |
|---|---|
| Project name | `metro` — must match `name` in `wrangler.jsonc` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | leave as `/` — **not** `web`, because `wrangler.jsonc` is at the root |
| Preview builds | optional (adds a preview URL per branch) |
| Cloudflare Access | leave off — this is a public site |
| Environment variables | none needed |

The root `package.json` exists purely to drive the build:

```
npm ci            # Cloudflare does this at the root; installs wrangler
npm run build     # -> npm --prefix web ci && npm --prefix web run build
npx wrangler deploy
```

`web`'s `prebuild` script copies `art/` into `web/public/art` first, so `art/` stays the single
source of truth and the SVGs are never duplicated in git.

Every push to `main` then rebuilds and redeploys.

**This project deploys `metro` only.** The game is a second Worker (`metro-game`) with its own
`wrangler.jsonc`, so the site's build never touches it. It has a second Workers Builds project on the
same repository, so a push to `main` ships both:

| Field | Value |
|---|---|
| Project name | `metro-game` — matches `name` in `game/wrangler.jsonc` |
| Build command | `npm run build:game` |
| Deploy command | `npx wrangler deploy -c game/wrangler.jsonc` |
| Root directory | `/` — the game's config is referenced by path, not by `cd` |

`npm run deploy:game` still deploys the game by hand.

The stats service is a third Worker (`metro-stats`). It has no asset build: `npm run deploy:stats`
applies `stats/schema.sql` to the remote D1 database and then deploys the Worker from
[`stats/wrangler.jsonc`](stats/wrangler.jsonc). It is deployed by hand (and verified by the script),
because the schema step needs the Cloudflare credentials and D1 access. Its page and API are served
by the Worker itself; there is no `stats/dist`. For a Workers Builds project, set the deploy command
to `npm run deploy:stats:ci` and the version command to `npm run version:stats`: the auto-created
build token has no D1 permission, and `npm run dev:stats` is a long-running local server, not a
build step. `npm run deploy:stats` remains the schema-migration command.

### Local preview and deploy

```bash
npm install
npm run preview    # build, then serve the real Worker locally via wrangler dev
npm run deploy     # build, then wrangler deploy
npm run dev:stats  # stats page + API on the local D1: http://localhost:5176/
npm run deploy:stats # migrate the remote stats D1, deploy metro-stats, verify the live API
```

`npm run deploy` needs `npx wrangler login` once. CI does not — Cloudflare supplies its own
credentials to the build. `npm run deploy:game` deploys the game and attaches its routes the same
way, and needs the same login. `npm run deploy:stats` needs it too, because it applies the schema to
the production D1 database before deploying.

When wrangler is not available — no Cloudflare account, no network, or a machine that will not let
it spawn — `npm run preview:local` serves the same two builds from `.dist` on one origin instead:
the site at `/`, the game at `/game/`, each with its `/en/` pin and the game's demo routes
(`/game/zoo`, `/game/tanwei`). It is plain Node with no children, so it starts anywhere:

```bash
npm run build && npm run build:game    # it only reads build output
npm run preview:local                  # http://127.0.0.1:4173/
```

### Routing

The site, game and stats service live on one hostname, **`https://stationdesigner.com`**, as three
Workers in one zone:

| URL | Worker | Route pattern | Declared by |
|---|---|---|---|
| `/`, `/en/` | `metro` (the site) | `stationdesigner.com/*` | [`wrangler.jsonc`](wrangler.jsonc) — `npm run deploy` |
| `/game/`, `/game/en/` | `metro-game` | `stationdesigner.com/game`, `stationdesigner.com/game/*` | [`game/wrangler.jsonc`](game/wrangler.jsonc) — `npm run deploy:game` |
| `/stats/`, `/stats/en/`, `/stats/api/v1/*` | `metro-stats` | `stationdesigner.com/stats`, `stationdesigner.com/stats/*` | [`stats/wrangler.jsonc`](stats/wrangler.jsonc) — `npm run deploy:stats` |

Route patterns are ranked by specificity, so the game's pair and the stats pair win over the site's
broader `/*` and requests for `/gameplay` still reach the site. A bare route needs its own pattern
because `/game/*` and `/stats/*` do not match `/game` and `/stats`; never collapse a pair into
`/game*` or `/stats*` — `*` matches across `/`, so it would also swallow unrelated paths.

The game also answers three client routes under that pair, which have no file behind them and are
served by its SPA fallback:

| URL | Result |
|---|---|
| `/game/zoo`, `/game/tanwei` | the game document; the app opens that example station |
| `/game/en/zoo`, `/game/en/tanwei` | the same, in English |
| `/game/zoo/`, `/game/tanwei/` | `308` to the slash-less URL (a directory form would break the relative assets) |

All three Workers are attached with **routes**, not as a Custom Domain: a Custom Domain claims the
whole hostname for one Worker and would hide the others. The zone must hold `stationdesigner.com`,
and its DNS records must be **proxied** (orange cloud) for routes to apply. `npm run deploy` attaches
the site's route from `wrangler.jsonc`, `npm run deploy:game` attaches the game's and
`npm run deploy:stats` attaches the stats pair — no dashboard step for any of them.

#### What the Workers rewrite

The site and the game are asset-backed: assets sit at the root of their Worker, so a request that
matches a file never reaches the handler. The stats Worker is not asset-backed — it serves its page
and API directly from `stats/worker.js`. Neither language pin is a second document; both are
redirects and a strip:

* The site's [`worker/index.js`](worker/index.js) answers `/en` and `/en/index.html` with a `308` to
  `/en/`, strips the `/en` segment, and re-fetches from `env.ASSETS`. It is the same document — the
  client reads the segment (`web/src/i18n.js`).
* The game's [`game/worker/index.js`](game/worker/index.js) strips the `/game` prefix first, then
  applies the same `/en/` pin, so `/game/en/assets/*.js` finds the game's own bundle.
* The stats Worker normalizes `/stats` to `/stats/`, then splits `/stats/api/*` from the page. It
  serves the API at `/stats/api/v1/global`, `/stats/api/v1/submit` and `/stats/api/v1/health`, and
  returns a real `404` for unknown paths rather than a shell.

The pins exist because both documents spell their assets relatively (`./assets/...`): without them
`/en/` would load and then fetch its CSS one directory too high.

The behaviour below is pinned by `game/test/site-worker.test.mjs` and `game/test/i18n.test.mjs`, and
reproducible locally with `npm run preview:local`:

| Request | Result |
|---|---|
| `/` | `200` site `index.html` — served straight from assets, the Worker is not invoked |
| `/en` | `308` → `/en/` |
| `/en/index.html` | `308` → `/en/` |
| `/en/` | `200` site `index.html`, English |
| `/en/art/01-isometric-cutaway.svg` | `200` `image/svg+xml` |
| `/en/assets/*.css` | `200` `text/css` |
| `/game` | `308` → `/game/` |
| `/game/` | `200` game `index.html` |
| `/game/en` | `308` → `/game/en/` |
| `/game/en/` | `200` game `index.html`, English |
| `/game/en/assets/*.js` | `200` — game assets, aliased back to the Worker root |
| `/game/lab` | `200` game `index.html` — the SPA fallback |
| `/game/zoo` | `200` game `index.html` — the zoo demo opens |
| `/game/en/tanwei` | `200` game `index.html`, English — the Tanwei demo opens |
| `/game/zoo/` | `308` → `/game/zoo` |
| `/stats` | `308` → `/stats/` |
| `/stats/` | `200` stats page |
| `/stats/en` | `308` → `/stats/en/` |
| `/stats/en/` | `200` stats page, English |
| `/stats/api/v1/global` | `200` JSON totals |
| `/stats/api/v1/health` | `200` JSON when the D1 schema is applied, `503` otherwise |
| `/gameplay`, `/nope` | `404` |

When the game deploys, `wrangler` warns that the routes "will attempt to serve Assets on a configured
path" — it goes looking for `game/dist/game/*`, because the routes are declared next to `assets`.
Nothing lives there, so those requests fall through to the Worker, which strips the prefix and reads
from the asset root. The table above is the behaviour you actually get; the warning is cosmetic.

Each Worker's `workers.dev` URL keeps working at the same time: `/` is served directly from assets,
so one build serves both the domain and the workers.dev root.

**Other routing you may want**, all in **Settings**:

* *Preview URLs* — one per non-production branch, if you enabled preview builds.
* *Redirects and rewrites* — for vanity paths, use a Cloudflare **Rule** in front of the Worker rather
  than adding code.
* *Trailing slashes* — `assets.html_handling` in `wrangler.jsonc` controls how `/foo` and `/foo/` map
  to files; the default suits a single-page site.

## Regenerating the art

```bash
npm run build:game                       # sheets 03, 04 and 07 are the game's own output
node tools/render-block-cards.mjs        # -> .preview/block-cards/     (needs Chrome)
node tools/render-module-cards.mjs       # -> .preview/module-cards/    (needs Chrome)
node tools/render-ui-shots.mjs           # -> .preview/ui-shots/        (needs Chrome)
node tools/render-train-cards.mjs        # -> .preview/train-cards/     (needs Chrome; --trim-only needs neither)
node tools/render-piece-elevations.mjs   # -> .preview/piece-elevations/ (needs Chrome)
node tools/render-piece-views.mjs        # -> .preview/piece-views/     (needs Chrome)
node tools/render-passenger-cards.mjs    # -> .preview/passenger-cards/ (clothed humans for 01, 02, 12, 13)
node tools/gen-art.mjs                   # rewrites art/*.svg
node tools/sheet-png.mjs 03              # rasterise one sheet, to look at it
node tools/serve.mjs                     # a small local viewer for the sheets
```

After approving a model-library change, run **`npm run art:models`** at the root.
It regenerates exports and the game atlas, builds the game, captures all standing/
walking variants, refreshes interface screenshots in both languages,
regenerates sheets 01/02/07/12/13, validates animation, renders PNG previews,
and builds/syncs the gallery. It never deploys. For an art-only refresh of the
current game atlas use `npm run art:models -- --from-game`.

Capture batches and static sprite pools grow with the model catalogue. The capture
manifest records source hashes; stale builds, dropped models and incomplete
strides fail before art generation. See `model/README.md` and `metro-model`.

Sheets 01, 02, 12 and 13 use the game's approved faceless model library and pose atlas, captured
in isometric, elevation and plan views. Refresh passenger cards after changing
the human model; refresh UI and camera captures in both languages as well.
Moving people cycle full strides facing their paths; queues remain standing.
After regenerating these sheets, run `node tools/test-passenger-animation.mjs`
to check visible frames and SVG image playback in all three camera views.

Every sheet is drawn in the same **true isometric** projection — equal foreshortening on all three
axes, which is what lets a rendered piece stand in a drawing undistorted — so they double as an
art-direction target rather than loose mood boards. The palette is a stylised read of real Guangzhou
Metro stations, reinterpreted in [`tools/iso.mjs`](tools/iso.mjs); no photograph is shipped here.

**Sheet 05 is the rolling stock's parameters, and its two drawings per class are the game's own car.** A
frontal and a side elevation, rendered square-on by the same pass — the camera is orthographic and every
class is framed in **one fixed box**, so pixel distances are metres, the four cars compare at one scale, and
the dimension lines on the sheet land where the dimensions are. The numbers are `game/src/sim/stock.ts` and
`sim/constants.ts` imported directly; the one table that is not in code is the per-class power and typical
use, which is GAME-SPEC §6.1 and says so.

**Sheet 11 is the game's own consist.** Its pictures are `buildTrain` renders — the rounded body, the glazing
band, the livery broken at every doorway, the sliding leaves and the lining behind the seats — captured by
[`tools/render-train-cards.mjs`](tools/render-train-cards.mjs) into `.preview/train-cards/`. The table beside
them is `stockTable()` and `cabinFacts()` out of `game/src/sim/stock.ts`, carried out with the pixels, so a
retuned car arrives on the sheet by itself. Each class wears a different **real Guangzhou sign colour**
(`game/src/data/line-colours.ts`) so the four shapes read apart — a livery sample, not a claim about which
line runs which car. A wide frame is **cropped to what it contains** in the browser that drew it (a 6-car
consist fills 47 % of the frame it is rendered into), and `--trim-only` re-crops pictures already on disk
without booting the game.

**Sheet 06 is the 客流 window, photographed in four days.** `tools/render-ui-shots.mjs` presses the
window's own day buttons — 元旦, a Monday, a Saturday, a Sunday — and captures the chart each time, so the
sheet shows the calendar coefficient as the game draws it rather than as a description of it. The numbers
around it are **imported, not copied**: `tools/sheet-06-demand.mjs` reads `game/src/sim/demand.ts` and
`game/src/sim/clock.ts` directly (they are pure, so Node can), which is why a re-ranged knob or a retuned
coefficient changes the sheet's text as well as its pictures.

**Sheet 07 is the interface, photographed.** Its pictures are PNGs of the running game taken in headless
Chrome by [`tools/render-ui-shots.mjs`](tools/render-ui-shots.mjs) — the whole window, each chrome region
cropped to **its own bounding box as the DOM reports it**, and the states a player reaches by folding a
folder open or pressing the clock card. So the rail's tiles, the inspector's read-outs and the crowd at the
turnstiles are the ones the game draws. The numbered outlines sit on the boxes the capture measured, and the
accents are the custom properties at the top of `game/src/styles.css`. Nothing is restated on the art side
except the vocabulary — which keys the tiles carry and what the twelve read-outs are.

**Sheet 03 is the game's own geometry, not a drawing of it.** Its pictures are PNGs the game produced in a
browser through its own chunk mesher — `game/src/render/chunkMesher.ts` building real cells, wearing the
finish materials in `game/src/render/materials.ts` — captured by
[`tools/render-block-cards.mjs`](tools/render-block-cards.mjs) into `.preview/block-cards/`. So the square
rim, the seam where two blocks merge into one plane, and the speckled granite are the ones a
player sees. The **material table** is the game's too: the capture carries `finishPaletteGroups()` out of
`game/src/sim/finishes.ts` — the very function the rail's 材质 folder builds its palette from — so every
label, tint and value printed on the sheet is read from the simulation. Nothing is restated on the art side;
[`tools/sheet-03-blocks.mjs`](tools/sheet-03-blocks.mjs) is only the reading layer.

**Sheet 04 is the game's own render, not a drawing of it.** Its cards are PNGs the game produced in a
browser through the pass the build rail itself uses — `game/src/app/moduleThumbnails.ts` — captured by
[`tools/render-module-cards.mjs`](tools/render-module-cards.mjs) into `.preview/module-cards/`. So a card
is the tile a player clicks: one `buildModule`, one camera, one light rig, one tone mapping, and the real
canvas textures (a 闸机's green arrow, a 车票 marquee, an ad poster, a 站名 inscription, a 线网图 board).
Nothing about a piece is restated on the art side:

| | where it comes from |
|---|---|
| the picture | `game/src/render/models.ts` → `app/moduleThumbnails.ts`, rendered by WebGL |
| which pieces, and one card per family | the pick list in `game/src/app/captureCards.ts` |
| the **category** name — `门`, `楼梯`, `站名` | `moduleLabel()` in `game/src/app/store/catalog.ts`, so a card does not read as the folder's variant (`门 单开 不锈钢`) |
| the footprint | the palette entry's own `w` × `h` |
| the throughput line | `game/src/sim/constants.ts` (25 人/分 for a 闸机, 75 for a 扶梯, …) |
| the frames and captions | [`tools/iso.mjs`](tools/iso.mjs) — this sheet is only the reading layer |

The palette holds twenty-four families and the sheet carries eighteen: six are left out because a reader
cannot take in more than that across one sheet — the second sanitary fitting, the second 线网图, the ceiling
camera, the glass panel, and one of the twelve 站名 hands, whose folder is a dozen renderings of the same
board. The pick list names families, not rows, so a piece the palette gains inside a named family still
arrives without an art-side edit.

That division is deliberate: an earlier version re-drew the geometry in Node with its own camera and its
own lights, and every disagreement between the sheet and the game came out of that second renderer — a
missing frustum aspect that stretched pieces 26% wide, a light applied in sRGB instead of linear, and a
fill that magnified a piece 1.47× past the rail's framing and hid a 闸机's barrier wing behind its
cabinet. Drawing the piece twice is what keeps going wrong, so it is now drawn once, by the game.

`game/src/app/captureCards.ts` is the entry point that makes this callable from a page (the game boots it
at `?capture-cards`); it is guarded, so a normal page is unaffected. Sheet 03 has the same shape:
`game/src/app/captureBlocks.ts` at `?capture-blocks`. Sheet 07 needs no flag at all — it is the game
itself, driven through the store. `node tools/game-tiles.mjs` does the neighbouring job — it saves the
rail's own preview tiles to `.preview/game-tiles/`, which is the reference used to check a card against.
All of them drive Chrome through [`tools/browser-harness.mjs`](tools/browser-harness.mjs).

`art/` stays the single source of truth. `web`'s `prebuild` copies the sheets the gallery lists
(`web/src/artworks.js`) into `web/public/art` and nothing else, so a sheet the gallery stops listing is
dropped from the build rather than shipped stale.

**Sheet 12 is the platform, and its trains are the game's too.** The plan in panel A is `buildTrain` seen
from above, rendered with a **cleared alpha** so it composites over the platform the sheet draws and slides in
and out on the timetable's own loop; panels B and D carry real side elevations, four classes now. Every door
on it — on the car, on the screen, and the lane that feeds it — is placed from `doorCentres()` in
`game/src/sim/stock.ts`. The sheet used to compute its own cadence from a formula local to `tools/iso.mjs`,
which put B's doors 4.16 m apart where the game puts them 4.60 m apart, so every door, screen and lane was in
the wrong place; it also had no L.

Sheets 01 and 09 still draw their furniture by hand; 02, 03, 04, 05, 06, 07, 11, 12 and 13 carry the
game's own output, and the same swap is open to the rest — every layout, label, callout and animation
stays where it is.


The model-art command uses dedicated `.preview/model-art/` captures and free
browser ports, so it can coexist with other local previews.

Stats writes now require six-minute single-use leases; D1 stores SHA-256 digests.
Apply the updated schema before shipping the Worker and game together. Minting
is address-rate-limited with Retry-After. Do not use Cloudflare Access or browser
service tokens for anonymous writes; configure WAF rules for both lease and submit.
Workers.dev and preview URLs are disabled. Turnstile, relational validation and
historical retention remain follow-up work; see [the runbook](stats/README.md).
