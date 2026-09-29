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

A single scrolling page: every concept sheet in order, each one paired with the design note behind
it. Click any sheet to open it at full resolution.

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
