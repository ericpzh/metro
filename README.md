# Metro Station Designer

**A 3D sandbox about moving crowds through a metro station you build yourself.**

Block-based construction (1 block = 1 m) with smooth-corner voxel art, real rolling stock, real
passenger flow. No money, no staff hiring, no upkeep: you build, the crowds arrive, and the station
either copes or it does not.

| Path | What it is |
|---|---|
| [`GAME-SPEC.md`](GAME-SPEC.md) | The full design specification (draft 1). |
| [`PLAN.md`](PLAN.md) | The build order for the playable vertical slice. |
| [`game/`](game/) | **The game** — React + three.js + a Web Worker sim. Own app, own deploy. |
| [`art/`](art/) | Thirteen generated concept sheets, as SVG. |
| [`tools/`](tools/) | The generators for both: `node tools/gen-art.mjs` redraws `art/`. |
| [`web/`](web/) | The concept-art website — React + Vite. |
| [`wrangler.jsonc`](wrangler.jsonc) | Cloudflare Workers deploy config for the site. |
| [`worker/`](worker/) | Optional entry point, only needed for path-prefix routing. |

## The game

The game is a separate application from the art site: its own `package.json`,
Vite config, tests and Cloudflare Worker (`metro-game`). It reads nothing from
`web/` and nothing from `art/` — the concept sheets are diagrams, not the
art-direction target (see PLAN.md §2.3).

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

The sheets are dark (a `sheetBg` gradient from `#151d29` to `#0a0d13`), so the page is built to match
them rather than fight them.

**Panel placement is measured, not eyeballed.** Each sheet is rasterised at a 1440px reference width
and scanned with an edge-energy map for the quietest band that still keeps the whole card on screen;
the result is stored per sheet as `panel` in [`web/src/artworks.js`](web/src/artworks.js). Panels
either hug the 5% margin (`mode: 'edge'`) or sit in a genuine pocket in the middle of the drawing
(`mode: 'free'`). Below 1100px the overlay would cover too much of the art, so the panel docks to the
bottom edge of the sheet instead.

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
node tools/gen-art.mjs           # rewrites art/*.svg
node tools/serve.mjs             # a small local viewer for the sheets
```

Every sheet is drawn in the same 2:1 dimetric projection the game uses, so they double as an
art-direction target rather than loose mood boards. The palette is a stylised read of real Guangzhou
Metro stations, reinterpreted in [`tools/iso.mjs`](tools/iso.mjs); no photograph is shipped here.
