# Where this is going

Written down because the session ran long and this is the part worth keeping.

## What went wrong

The task was: **swap the models in the existing sheets for the game's real ones,
with everything else staying where it is** — same layout, same coordinates, same
labels and measurements, same animation.

What was delivered instead: the authored sheets were thrown away and replaced
with screenshots of the running game. That lost the composition, the legibility
(the station ended up tiny in frame), the labels, the callouts — everything that
made the sheets drawings — and it dropped the SVG animation the sheets already
had. It was worse than what it replaced.

Two of the user's questions had answers already sitting in the repo, and neither
was checked before rewriting:

* **"are we not doing animation?"** — `tools/iso.mjs` already ships a motion kit:
  `MOTION_CSS`, `sway`, `breathe`, `spin`, `dashFlow`, `amT`, `mover`, `growBar`,
  `pulseBar`, `passT`, `D_LOOP`. The authored sheets animate.
* **"why not update the old mjs with the new models?"** — that is exactly right,
  and the architecture supports it.

## The architecture that already exists

`tools/iso.mjs` is a 2:1 dimetric drawing kit at **the game's own scale**: one
block = 1 m, `z` is height, and `px`/`py`/`P` project `(x, y, z)` in metres.

```js
export const TW = 30, TH = 15, ZU = 26
export const px = (x, y) => (x - y) * TW
export const py = (x, y, z) => (x + y) * TH - z * ZU
export const P = (x, y, z) => [px(x, y), py(x, y, z)]
```

Primitives: `boxSvg`, `rboxSvg` (rounded), `quadSvg`, `faceSvg`, `rampSvg`.
`Scene()` accumulates them and depth-sorts by `x + y + z*0.9`, flat quads first.
Then `sheet()`, `title()`, `callout()`, `leader()`, `legend()`, `tag()`, `chart()`.

The sheet modules (`sheet-01-hero.mjs`, `sheets-a.mjs` … `sheets-e.mjs`,
`sheet-07-ui.mjs`, `sheet-11-trains3d.mjs`, `sheet-13-two-line.mjs`) draw the
station by calling those primitives **at real metre coordinates**, e.g.

```js
R(boxSvg(0.1, -0.5, FZ, 0.22, 0.4, GL - FZ, C.steel, { tone: 1.0 }))   // a column
S.box(gx + 0.06, gy + 1.62, FZ + 1.05, gw - 0.12, 0.5, 0.1, C.blue)   // a gate card reader
```

So the furniture is hand-drawn *boxes standing in for machines*. That is the
only thing that should change.

## The bridge (proven)

The game's piece models build in plain Node — no browser, no GPU — given a tiny
canvas stub, and what comes back is already in the sheets' coordinate space:

```
node --experimental-strip-types <script>
  buildModule(createModule('tvm', 0, 0, 0, 'm', 0), { mats, ads, lineMaps, station })
  -> Group, 14 meshes, 296 vertices, BoxGeometry + material colours
```

A proof of concept projected that group through `px`/`py` and emitted
depth-sorted polygons. It renders as a recognisable 售票机 — stainless body,
plinth, green housing, tilted LCD, 车票 marquee on two posts — in the sheets'
own isometric view. See `game/scratch-poc.mjs` (scratch; to be replaced by a
real tool).

### Known problem to fix

Painter's-algorithm artifacts: large faces of one box overlap each other in the
sort, which puts X-shaped seams across the cabinet. Fix by **splitting each quad
into its two triangles and sorting those by centroid depth** — which is what the
proof of concept already did per triangle, so the bug is more likely the tone
choice flipping between the two triangles of a face, or equal centroids. Diagnose
before changing the sort.

## The plan

1. A real tool (not a scratch file) that emits game-model geometry as
   depth-sorted isometric SVG, callable as a drop-in for the `rboxSvg`/`boxSvg`
   furniture calls. It must accept `(type, x, y, z, rot, cfg)` so a call keeps its
   position — the whole point is that **nothing moves**.
2. Replace the hand-drawn furniture in the sheet modules with it, module by
   module, starting with 01 (the hero) and 04 (the catalogue), checking each
   renders correctly.
3. Keep every label, callout, measurement, title, legend and `MOTION_CSS`
   animation exactly as it is.
4. Re-add `08-architecture.svg` and `13-two-line-interchange.svg` to the site
   (`web/src/artworks.js`) — the user never asked for them to be dropped; they
   were dropped on a misreading.
5. Restore the sheet list and pipeline: `tools/gen-art.mjs` regenerates `art/`,
   `web/scripts/sync-art.mjs` copies it. `tools/shots.mjs` and `tools/preview.mjs`
   stay only if they are still useful — they are not the sheets.

## State of the tree right now

* `art/` is back to the **authored** 13 sheets (`node tools/gen-art.mjs`).
* `tools/gen-art.mjs` is restored and working (it was deleted, recovered from
  commit `068dcf5`).
* `tools/iso.mjs` has a "Retired" header that is now wrong and must be removed.
* `tools/shots.mjs` + `tools/sheet-plan.mjs` + the screenshot pipeline are the
  abandoned approach; the `art/*.svg` they wrote have been overwritten by
  `gen-art.mjs`.
* `web/src/artworks.js` currently lists 11 sheets and has a rewritten header
  describing screenshots; both need reverting.
* `tools/preview.mjs` (`npm run preview:local`) is fine and useful, and is worth
  keeping regardless: it serves the built site and the built game on one origin
  when wrangler cannot run.
