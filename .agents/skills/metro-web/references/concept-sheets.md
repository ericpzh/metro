# Concept-Sheet Generation & Capture Pipeline

`art/*.svg` and `png/*.png` are generated outputs — never hand-edit them.
`tools/gen-art.mjs` is the authoritative generator for all eleven live sheets
(`01`–`07`, `09`, `11`–`13`). Do not use `tools/shots.mjs` or
`tools/sheet-plan.mjs` (an unused screenshot-sheet script whose header comment
does not reflect the active pipeline).

## Generator CLI & Drawing Kit

```powershell
node tools/gen-art.mjs                      # all 11 Chinese sheets
node tools/gen-art.mjs 01 13                # selected sheets (by number or filename)
node tools/gen-art.mjs --en                 # all 11 Chinese + English (*-en.svg) sheets
node tools/gen-art.mjs 02 --en              # one sheet in both locales
node tools/gen-art.mjs 06 07 09 --en-only   # English sidecars only
```

* `tools/iso.mjs` provides a **true isometric** projection at 1 block = 1 m
  with equal foreshortening on all three axes (`TW`, `TH = TW / sqrt(3)`,
  `ZU = hypot(TW, TH)`) so game-rendered pieces drop into drawings undistorted.
  It exports primitives (`boxSvg`, `rboxSvg`, `quadSvg`, `faceSvg`, `rampSvg`),
  depth-sorting `Scene()`, framing (`bboxOf`, `fitToRect`), furniture (`sheet`,
  `title`, `callout`, `leader`, `legend`, `tag`, `chart`), and CSS motion
  helpers (`MOTION_CSS`, `mover`, `amT`, `passT`, etc.) that animate even when
  displayed inside `<img>`.
* Sheets import authoritative numeric constants directly from `game/src/sim/`
  (`stock.ts`, `constants.ts`, `finishes.ts`, `demand.ts`) so retuned simulation
  values stay synchronized with sheet text and geometry.
* `gen-art.mjs` runs `prunePassengerSprites` (`tools/passenger-cards.mjs`) on
  every generated SVG to drop unreferenced `human-*` definitions while keeping
  transitive `<use>` aliases intact, helping keep every sheet under the strict
  25 MiB Cloudflare Workers asset cap.

## Sheet Module Map

| ID | Output (`art/`) | Module & Export (`tools/`) | Notes |
|---|---|---|---|
| `01` | `01-isometric-cutaway.svg` | `sheet-01-hero-banded.mjs` (`artHeroBanded`) | Banded 2-level cutaway; imports `finishes.ts` |
| `02` | `02-vertical-section.svg` | `sheets-a.mjs` (`artSection`) | Vertical section; imports `finishes.ts`, `constants.ts` |
| `03` | `03-block-system.svg` | `sheet-03-blocks.mjs` (`artBlocks`) | Real chunk-meshed blocks + `finishes.ts` table |
| `04` | `04-module-catalogue.svg` | `sheet-04-modules.mjs` (`artModules`) | Real game module cards + metadata from capture index |
| `05` | `05-trains-and-track.svg` | `sheet-05-trains.mjs` (`artTrains`) | Parametric elevations + animated doors/headlights; imports `stock.ts` |
| `06` | `06-crowd-demand.svg` | `sheet-06-demand.mjs` (`artDemand`) | Demand screenshots + interactive SVG curve (`demand-animation.mjs`, `demand.ts`, `constants.ts`) |
| `07` | `07-interface.svg` | `sheet-07-interface.mjs` (`artInterface`) | Full-window and per-region UI screenshots |
| `09` | `09-camera-and-views.svg` | `sheets-c.mjs` (`artViews`) | Camera preset shots + ViewCube control; uses `sheetText` |
| `11` | `11-rolling-stock-3d.svg` | `sheet-11-trains3d.mjs` (`artTrains3D`) | 3D rolling-stock specimens + animated door poses |
| `12` | `12-platform-doors-flow.svg` | `sheets-e.mjs` (`artPlatformFlow`) | Animated plan/elevation boarding; imports `stock.ts` (`doorCentres`), `finishes.ts` |
| `13` | `13-two-line-interchange.svg` | `sheet-13-two-line.mjs` (`artTwoLine`) | Stacked elevated + B1 + B2 interchange; imports `finishes.ts` |

## Headless-Chrome Capture Passes

All eleven sheets embed game-rendered PNGs and read them **synchronously** from
`.preview/` directories. Build `game/dist` (`npm run build:game` or
`npm --prefix game run build`) before running any capture script.

| Capture Script (`tools/`) | Default Output Dir | Env Override | Consumed By |
|---|---|---|---|
| `render-piece-views.mjs --hero --scale 4` | `.preview/hero-piece-views/` | — | `01`, `13` (`station-piece-images.mjs`) |
| `render-piece-elevations.mjs` | `.preview/piece-elevations/` | `PIECE_ELEVATIONS_DIR` | `02`, `12` (`station-elevations.mjs`) |
| `render-block-cards.mjs` | `.preview/block-cards/` | `BLOCK_CARDS_DIR` | `03` |
| `render-module-cards.mjs` | `.preview/module-cards/` | `MODULE_CARDS_DIR` | `04` |
| `render-train-cards.mjs` (`--trim-only` re-crops) | `.preview/train-cards/` | `TRAIN_CARDS_DIR` | `01`, `02`, `05`, `11`, `12`, `13` (`train-cards.mjs`) |
| `render-train-animation.mjs` | `.preview/train-animation/` | — | `05`, `11` (`train-animation.mjs`) |
| `render-ui-shots.mjs` (`--lang zh-CN\|en`, `--sheet 07`) | `.preview/ui-shots[-en]/` | `UI_SHOTS_DIR`, `UI_SHOTS_EN_DIR` | `06`, `07` |
| `render-view-shots.mjs` (`--lang zh-CN\|en`) | `.preview/view-shots[-en]/` | `VIEW_SHOTS_DIR`, `VIEW_SHOTS_EN_DIR` | `09` |
| `render-passenger-cards.mjs` | `.preview/passenger-cards/` | `PASSENGER_CARDS_DIR` | `01`, `02`, `12`, `13` (`passenger-cards.mjs`) |

Placement helpers and GPU flags:

* `train-cards.mjs` (`carImage`, `trainCard`) places cars at exact metre scale
  on `TRAIN_RAIL_DATUM_Z` (front/side elevations) or track centreline `y = 0`
  (plan). `station-elevations.mjs` (`stationElevation`) and
  `station-piece-images.mjs` (`stationPieceImage`) place square-on and isometric
  equipment at uniform metre scale using captured anchors.
* `tools/browser-harness.mjs` defaults to SwiftShader software rendering for
  reproducibility. Set `$env:METRO_BROWSER_GPU='hardware'` to opt browser tools
  into a local GPU, and keep the same GPU mode across captures and playback
  validation.
* `tools/render-ui-shots.mjs` still defaults to software rendering even when
  `METRO_BROWSER_GPU=hardware` to avoid Windows GPU timeouts on large station
  screenshots; set `$env:METRO_UI_BROWSER_GPU='hardware'` to opt UI shots in.

## Bilingual Sidecars (`tools/sheet-i18n.mjs`)

* `toEnglish` rewrites Chinese `<text>` nodes, sheet `06` slider `aria-label`s,
  and sheet `06` live-readout script literals while leaving simulation numbers
  untouched. Missing translations or unescaped `&`/`<` outside `<script>` fail
  the run loudly.
* Exact game UI labels automatically resolve from
  `game/src/sim/i18n/messages.ts` / `tForLanguage`; sheet-only explanatory copy
  belongs in `tools/sheet-i18n.mjs`. Use `{ t, size }` entries to step down font
  size where English runs wider than Chinese, and call `sheetText(key, lang)`
  before drawing whenever translated width affects layout (such as sheet `09`
  key chips).
* Sheets `06`, `07`, and `09` must embed locale-matched game screenshots. Keep
  default captures Chinese; for English sidecars run:

```powershell
node tools/render-ui-shots.mjs --lang en
node tools/render-view-shots.mjs --lang en
node tools/gen-art.mjs 06 07 09 --en-only
```

Check animated demand overlays (sheet `06`) and screenshots with
`tools/sheet-png.mjs <name>-en.svg` for clipped text.

## Refreshing Passenger & Model Artwork (`npm run art:models`)

After changing the soft-human passenger library or crowd materials (owned by
[metro-model](../../metro-model/SKILL.md)), run from the repo root:

```powershell
npm run art:models                  # full bake:passengers → game build → captures → art → verify → web build
npm run art:models -- --from-game   # art-only refresh reusing the existing game passenger atlas
```

`tools/refresh-model-art.mjs` isolates captures under `.preview/model-art/`
(separate from ad-hoc `.preview/` runs), runs `render-piece-elevations.mjs`,
`render-piece-views.mjs --hero --scale 4`, `render-passenger-cards.mjs`,
bilingual sheet-07 `render-ui-shots.mjs`, `gen-art.mjs 01 02 07 12 13 --en`,
`test-passenger-animation.mjs`, `sheet-png.mjs --at 8` previews, and
`npm --prefix web run build` without deploying.

Active passenger capture and sprite contracts:

* `render-passenger-cards.mjs` captures every adult-eligible and child-eligible
  template from `game/src/assets/passenger-approved.json` in bounded batches
  (`passengerCaptureBatches`, max 4 variants per CDP call), reusing one GPU
  context (`reuseContext: true`) and calling `disposePassengerCapture()` on
  teardown. Each entry records 4 stills per view (3 mid-stride, 1 idle) plus a
  complete 24-frame walk cycle (`walking-index.json`) across iso (8 headings),
  elevation (2 headings), and plan (1 heading).
* `validatePassengerCaptures` (`tools/passenger-capture-plan.mjs`) rejects stale
  builds (`sourceSha256` / `recipeSha256`), ineligible age entries, missing
  variants, duplicate files, and incomplete strides; `manifest.json` records
  atlas and model source hashes.
* `passenger-cards.mjs` maintains stable 20/80 child/adult selection via
  `passengerIsChild`, spreads adjacent clothing/bag recipes via
  `passengerArtIndex`, deduplicates identical positioned `<image>` nodes in
  `passengerSpriteDefinitions` while preserving every `human-*` ID, and sizes
  gait duration from captured stride divided by path speed.
* Animated movers cycle real stride frames (`walkingDefinitions`,
  `walkingSprite`, `walkingPlanSprite`, `walkView: 'elevation'` for sections)
  and fade out before resetting on short loops. Use `walkingHeading` for
  camera-relative facing: the iso capture camera at `(+1, +1, +1)` projects
  horizontal axes opposite the drawing's `P()`, so `walkingHeading` swaps world
  X/Y (pinned by `game/test/art-passenger-heading.test.mjs`).
* For layout-only sheet edits, set `PASSENGER_CARDS_DIR` to
  `.preview/model-art/passenger-cards` instead of re-capturing the full library.

## Refreshing Train Artwork

Train-model changes affect sheets **01, 02, 05, 11, 12, and 13**:

```powershell
npm --prefix game run build
node tools/render-train-cards.mjs
node tools/render-train-animation.mjs
$env:PASSENGER_CARDS_DIR = '.preview/model-art/passenger-cards'
node tools/gen-art.mjs 01 02 05 11 12 13 --en
node tools/svg-to-png.mjs 01 02 05 11 12 13
```

* Run `render-train-cards.mjs` and `render-train-animation.mjs` sequentially —
  the latter captures the real sliding-door and headlight poses embedded by
  sheets `05` and `11`.
* `game/src/app/captureTrains.ts` seeds power from `STOCK[cls].power` (`A`/`D`
  catenary, `B`/`C`/`L` third rail), preserves all five stock classes in
  `STOCK_CLASSES` order, and retains base frame power across animation poses.
* Preview both locales at `--at 8` with `tools/sheet-png.mjs`, verify with
  `train-art-pipeline` + `npm run test:game`, and finish with `npm run build`
  to sync `web/public/art/`. Never commit ignored `.preview/` directories.

## Sheet-Specific Layout Invariants

Pinned by `game/test/art-sheet-fixes.test.mjs`, `passenger-art-pipeline.test.mjs`,
`passenger-sprite-pruning.test.mjs`, `art-passenger-heading.test.mjs`, and
`train-art-pipeline.test.mjs`:

* **01 & 13 ramps:** `render-piece-views.mjs --hero` and
  `render-piece-elevations.mjs` use `ramp: { rise: 4, run: 7 }`
  (`game/src/app/captureRamp.ts`) without mutating palette defaults. Lower
  landings must align with authored upper edges (`01`: `y=17` to `y=10`; `13`:
  `x=31` to `x=38`); recapture hero piece views after changing dimensions.
* **02 vertical section:** elevation runs use the same `4 m / 7 m` ramp capture
  and stay inside the vertical core (`CORE1`).
* **07 interface:** `render-ui-shots.mjs` disables ghosting
  (`st.setGhostOther(false)`) for the `played` capture in both locales.
* **12 platform flow:** panel 12-A queue figures use idle poses (`walking = false`)
  with varied headings independent of the boarding clock, while boarding and
  alighting walkers stay inside the doors-open window; 12-B paints the
  foreground platform after the train to hide wheels; 12-C uses `gate-single`
  (`hideSecondGateDoor: true`).
* **13 interchange:** paints the landing apron (`landing: 3300`) over runs
  (`runs: 3200`) to hide undersides and masks runs with
  `#interchange-psd-occlusion` (`#interchange-near-psd` sorts ahead of the
  crowd without moving the full PSD band over the train).

## Preview, Rasterization & Inspection Tools

```powershell
node tools/sheet-png.mjs 03 --at 8          # browser PNG preview into .preview/sheets/ (preserves delays)
node tools/test-passenger-animation.mjs     # browser gait & clothing check on sheets 01/02/12/13 (zh + en)
node tools/svg-to-png.mjs [nn …]            # 300-DPI static PNG exports into png/ (numeric args match both locales)
node tools/serve.mjs [port]                 # static repo/sheet viewer (default 4173)
node tools/zoom.mjs art/01-isometric-cutaway.svg 380 470 760 470  # detail crop (*-zoom.svg, skipped by sync-art)
```

* `tools/render-sign-panel.mjs` and `tools/render-tv-plate.mjs` (invoked from
  `game/`) render the game's Canvas 2D sign and TV painters to PNG via Sharp for
  visual inspection. Pictogram prep (`prep-sign-icons.py`, `sign-icons-sheet.py`)
  is game-owned — see [metro-game](../../metro-game/SKILL.md).
