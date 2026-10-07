# Metro Station Designer

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
| [`wrangler.jsonc`](wrangler.jsonc) | Cloudflare Workers deploy config for the site. |
| [`worker/`](worker/) | Optional entry point, only needed for path-prefix routing. |

## The game

The game is a separate application from the art site: its own `package.json`,
Vite config, tests and Cloudflare Worker (`metro-game`). It reads nothing from
`web/`.

It is reachable two ways, and both are the same build:

* **The site's 游戏 tab** — `https://ericpzh.rest/metro/game/` renders the site
  document as a full-viewport iframe around the game's Worker. The art page and
  the game never share a viewport.
* **The game's own URL** — `https://ericpzh.rest/metro-game/`, which also works
  on its `workers.dev` root.

The tab points at the game Worker rather than bundling it, so the two apps still
build and deploy independently. The only coupling is a URL: `gameUrl` in
[`web/src/site.js`](web/src/site.js), overridable with `VITE_GAME_URL`.

`game/wrangler.jsonc` declares the game's two routes, so `npm run deploy:game`
creates them along with the Worker — there is no dashboard step and nothing to
keep in sync by hand.

```bash
npm start             # build the game, then serve it at http://localhost:4174
npm run setup:game    # install game/ deps
npm run dev:game      # http://localhost:5174 (the site owns 5173)
npm run test:game     # node --test: determinism, tick budgets, capacity ladder
npm run deploy:game   # build, deploy metro-game, and attach its two routes
```

To see the tab locally, run the site and the game side by side:

```bash
npm run dev           # site dev server at http://localhost:5173
npm run dev:game      # game at http://localhost:5174, embedded by http://localhost:5173/game/
```

`game/README.md` covers the milestones, the simulation's time base, and the
places where the vertical slice deliberately diverges from the spec.


## The site

A dark, single scrolling page: every concept sheet runs edge to edge, and its design note is a
translucent glass panel floating over the drawing. Click any sheet to open it at full resolution.

Seven sheets are **photographs of the game** rather than drawings of it: 03's blocks come from the game's own
chunk mesher, 04's modules from the pass the build rail uses, 06 is the 时刻 · 客流 window in the four day
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
`npm start` is the *game*: it builds it and serves the build at http://localhost:4174 — it is not the
site.

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

### Local preview and deploy

```bash
npm install
npm run preview    # build, then serve the real Worker locally via wrangler dev
npm run deploy     # build, then wrangler deploy
```

`npm run deploy` needs `npx wrangler login` once. CI does not — Cloudflare supplies its own
credentials to the build. `npm run deploy:game` deploys the game and attaches its routes the same
way, and needs the same login.

When wrangler is not available — no Cloudflare account, no network, or a machine that will not let
it spawn — `npm run preview:local` serves the same two builds from `.dist` on one origin instead:
the site at `/`, and the game at `/game/` and `/metro-game/`. It is plain Node with no children, so
it starts anywhere:

```bash
npm run build && npm run build:game    # it only reads build output
npm run preview:local                  # http://127.0.0.1:4173/
```

### Routing

The site is served from a path prefix — **`https://ericpzh.rest/metro/`** — rather than a domain
root. `ASSET_PREFIX` in `wrangler.jsonc` is `/metro`, and [`worker/index.js`](worker/index.js)
rewrites prefixed requests down to the asset root.

The site and the game are **two Workers in the same zone**, each with two routes:

| Route pattern | Worker | Attached by |
|---|---|---|
| `ericpzh.rest/metro` | `metro` | hand, once |
| `ericpzh.rest/metro/*` | `metro` | hand, once |
| `ericpzh.rest/metro-game` | `metro-game` | `game/wrangler.jsonc` — `npm run deploy:game` |
| `ericpzh.rest/metro-game/*` | `metro-game` | `game/wrangler.jsonc` — `npm run deploy:game` |

The zone serves other things too (`api/*`, `livery*`, `editor*`, `ac27approach*`); those routes are
left alone. The site's two are added once: Workers & Pages → `metro` → **Settings** → **Domains &
Routes** → **Add** → **Route**. The game's are not added by hand — they are declared under `routes`
in [`game/wrangler.jsonc`](game/wrangler.jsonc), so deploying the game creates them.

Two routes per Worker, not one, because `/metro/*` does *not* match the bare `/metro` — the literal
`/` after `metro` is required. Never collapse a pair into `/metro*` or `/metro-game*`: `*` matches
across `/`, so `/metro*` would also swallow `/metro-game…` and hand it to the site's Worker, which
can only 404 it.

There is **no `ericpzh.rest/*` route**: the apex is a Pages project bound as a Custom Domain, so any
path matching no Worker route falls through to it. That is what `/metro-game/` did before the game's
routes existed — the 游戏 tab rendered, and its iframe showed the Pages site instead of the game.
Route patterns are ranked by specificity, so `ericpzh.rest/metro/*` and `ericpzh.rest/metro-game/*`
win over the apex.

> **`*.ericpzh.rest/metro/*` will not work for this.** A leading wildcard matches subdomains only and
> never the apex, so `ericpzh.rest/metro/` would never reach the Worker. Add
> `www.ericpzh.rest/metro` and `www.ericpzh.rest/metro/*` as well if the site should also answer on
> `www`.

Routes require the hostname to be **proxied** in DNS (orange cloud). A Custom Domain is not the right
tool for either Worker: it would claim the whole of `ericpzh.rest`, which serves other things.

Assets live at the root of the Worker, so a request for `/metro/` matches no file and falls through to
[`worker/index.js`](worker/index.js), which strips the prefix and re-fetches from `env.ASSETS`. It also
308-redirects the bare `/metro` and `/metro/index.html` to `/metro/`, so relative asset URLs keep
resolving — without that the page would load and then fetch its CSS one directory too high.

This combination is tested with `wrangler dev`:

| Request | Result |
|---|---|
| `/metro` | `308` → `/metro/` |
| `/metro/` | `200` `index.html` |
| `/metro/index.html` | `308` → `/metro/` |
| `/metro/art/01-isometric-cutaway.svg` | `200` `image/svg+xml` |
| `/metro/assets/*.css` | `200` `text/css` |
| `/metro/game` | `308` → `/metro/game/` |
| `/metro/game/` | `200` `index.html` — the 游戏 tab |
| `/metro/game/assets/*.css` | `200` — the same assets, aliased back to the root |
| `/metro/game/deep/route` | `200` `index.html` — the SPA fallback |
| `/` | `200` — served straight from assets, the Worker is not invoked |
| `/metropolis`, `/nope` | `404` |

`/metro/game/` is the site document served one level down, so its relative `./assets/...` resolve
under `/game/`; the Worker aliases that subpath back to the root rather than shipping a second HTML
entry. The same table applies to the game's Worker with `/metro-game/` as the prefix.

When the game deploys, `wrangler` warns that the routes "will attempt to serve Assets on a configured
path" — it goes looking for `game/dist/metro-game/*`, because the routes are declared next to
`assets`. Nothing lives there, so those requests fall through to the Worker, which strips the prefix
and reads from the asset root. The table above is the behaviour you actually get; the warning is
cosmetic.

The `workers.dev` URL keeps working at the same time: `/` is served directly from assets, so one build
serves both the domain root and the prefix.

To move the site to a different path later, change `ASSET_PREFIX` and the routes together — nothing
else depends on `/metro`.

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
node tools/gen-art.mjs                   # rewrites art/*.svg
node tools/sheet-png.mjs 03              # rasterise one sheet, to look at it
node tools/serve.mjs                     # a small local viewer for the sheets
```

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

**Sheet 06 is the 时刻 · 客流 window, photographed in four days.** `tools/render-ui-shots.mjs` presses the
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

