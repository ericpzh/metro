# Metro Station Designer

**A 3D sandbox about moving crowds through a metro station you build yourself.**

Block-based construction (1 block = 1 m) with smooth-corner voxel art, real rolling stock, real
passenger flow. No money, no staff hiring, no upkeep: you build, the crowds arrive, and the station
either copes or it does not.

This repository holds three things:

| Path | What it is |
|---|---|
| [`GAME-SPEC.md`](GAME-SPEC.md) | The full design specification (draft 1). |
| [`art/`](art/) | Thirteen generated concept sheets, as SVG. |
| [`tools/`](tools/) | The generators for both: `node tools/gen-art.mjs` redraws `art/`. |
| [`web/`](web/) | The concept-art website — React + Vite — published to GitHub Pages. |

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
npm run build   # -> web/dist
```

`web/public/art/` is generated. At the start of `dev` and `build`, `scripts/sync-art.mjs` copies the
sheets out of `art/`, so `art/` stays the single source of truth and the SVGs are never duplicated in
git.

### Deployment

`.github/workflows/deploy.yml` builds `web/` and publishes it to GitHub Pages on every push to
`main`. Enable it once in the repository settings:

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

The built site uses a relative base path, so it works from `https://<user>.github.io/<repo>/`
without any per-repository configuration.

## Regenerating the art

```bash
node tools/gen-art.mjs           # rewrites art/*.svg
node tools/serve.mjs             # a small local viewer for the sheets
```

Every sheet is drawn in the same 2:1 dimetric projection the game uses, so they double as an
art-direction target rather than loose mood boards. The palette is a stylised read of real Guangzhou
Metro stations, reinterpreted in [`tools/iso.mjs`](tools/iso.mjs); no photograph is shipped here.
