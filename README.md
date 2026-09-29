# Metro Station Designer

**A 3D sandbox about moving crowds through a metro station you build yourself.**

Block-based construction (1 block = 1 m) with smooth-corner voxel art, real rolling stock, real
passenger flow. No money, no staff hiring, no upkeep: you build, the crowds arrive, and the station
either copes or it does not.

| Path | What it is |
|---|---|
| [`GAME-SPEC.md`](GAME-SPEC.md) | The full design specification (draft 1). |
| [`art/`](art/) | Thirteen generated concept sheets, as SVG. |
| [`tools/`](tools/) | The generators for both: `node tools/gen-art.mjs` redraws `art/`. |
| [`web/`](web/) | The concept-art website — React + Vite. |
| [`wrangler.jsonc`](wrangler.jsonc) | Cloudflare Workers deploy config for the site. |
| [`worker/`](worker/) | Optional entry point, only needed for path-prefix routing. |

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
npm start       # dev server at http://localhost:5173
```

`npm start` is a thin alias for `web`'s `dev` script, so it runs `sync-art` first and then Vite.

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

### Local preview and deploy

```bash
npm install
npm run preview    # build, then serve the real Worker locally via wrangler dev
npm run deploy     # build, then wrangler deploy
```

`npm run deploy` needs `npx wrangler login` once. CI does not — Cloudflare supplies its own
credentials to the build.

### Routing

The site is served from a path prefix — **`https://ericpzh.rest/metro/`** — rather than a domain
root. `ASSET_PREFIX` in `wrangler.jsonc` is `/metro`, and [`worker/index.js`](worker/index.js)
rewrites prefixed requests down to the asset root.

Attach **two** routes to the Worker — Workers & Pages → `metro` → **Settings** → **Domains & Routes**
→ **Add** → **Route**:

| Route pattern | Catches |
|---|---|
| `ericpzh.rest/metro` | the bare path |
| `ericpzh.rest/metro/*` | everything under it |

Two routes, not one, because `/metro/*` does *not* match the bare `/metro` — the literal `/` after
`metro` is required. Do not collapse them into `/metro*`: `*` matches across `/`, so `/metro*` would
also swallow `/metropolis` and `/metro-north` and hand them to this Worker, which can only 404 them.

> **`*.ericpzh.rest/metro/*` will not work for this.** A leading wildcard matches subdomains only and
> never the apex, so `ericpzh.rest/metro/` would never reach the Worker. Add
> `www.ericpzh.rest/metro` and `www.ericpzh.rest/metro/*` as well if the site should also answer on
> `www`.

Routes require the hostname to be **proxied** in DNS (orange cloud). A Custom Domain is not the right
tool here: it would claim the whole of `ericpzh.rest`, which serves other things.

Route patterns are ranked by specificity, so `ericpzh.rest/metro/*` wins over whatever already handles
`ericpzh.rest/*`. If the apex is currently a **Pages** project bound as a Custom Domain rather than a
Worker route, check afterwards that `/metro/` is not still landing on the other site.

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
| `/` | `200` — served straight from assets, the Worker is not invoked |
| `/metropolis`, `/nope` | `404` |

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
