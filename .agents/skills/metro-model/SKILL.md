---
name: metro-model
description: Work on the metro repository model/ character library, reviewed male/female hair and backpack variants, silhouette and strap cleanup, walking clips, GLB exports, and shared game crowd atlas. Use for model/ or tools/bake-approved-passenger.mjs changes. Route game renderer/simulation work through metro-game and test work through metro-game-test.
---

# Metro model library

Work from the metro root. Read `model/README.md` and
`game/src/assets/PASSENGERS.md`. For a new character reconstruction also use
`stylized-3d-character`. This skill owns the existing reviewed character pipeline.

## Ownership and contracts

- `model/src/characters/library.js` is the catalogue: six male original/short/bald
  variants with/without a bag, female bob/shoulder with/without a bag, and female
  long hair without a bag, plus five small-backpack variants for male
  original/short/bald and female bob/shoulder. Viewer and bake share all sixteen
  entries. Adults choose each entry equally; children choose equally among the
  five bagless, non-bald templates. Do not select sex, hair and bag hierarchically.
  Stable identity chooses appearance without consuming simulation RNG.
- `female.js` builds both sexes; short/bald use the same smooth scalp with hair
  or skin colours. `shoulders.js` cleans neck, face, chest, coat and backpack.
  Preserve faceless, unlit flat-grey illustration and source provenance. GLB/viewer
  surfaces are opaque; the game crowd's shared material uses 70% opacity.
- `small-backpack.js` owns the tapered crown, fuller base and shallow side profile.
  `waist-skinning.js` keeps trouser waists on Hips and lower coat panels on Spine;
  sleeve vertices retain arm movement. The lining stays recessed behind the hem.
- `preview-appearance.js` owns age rules, percentage clamping, reset and random
  selection. It imports game tuning: 20% children / 80% adults, height 80–120%,
  adult width/depth 90–110%, child width/depth 80–90%. Child base: height 65%,
  width/depth 70%. Viewer axes are X width / Y height / Z depth; game axes are
  X depth / Y width / Z height. Keep preview URLs and ranges valid when age changes.
- `garment-lining.js` closes coats through moving arm poses on all models,
  including models with bags. Do not remove it based on a standing screenshot.
- `backpack-connectors.js` creates continuous closed ribbons fitted to torso,
  not arms, with Spine weights. Preserve narrow widths, smooth curves, inward
  pack anchors and continuous lower returns; avoid separate tabs.
- `strap-surface.js` temporarily trims overlapping coat surfaces and adds closed
  support during export. Wrap bag exports in `withTrimmedStrapSurface` and restore
  geometry afterward. Do not reintroduce untrimmed source triangles beneath straps.
- `model/src/animation/` owns accepted foot-targeted slow/medium/fast walks;
  `game/src/sim/constants.ts` owns speeds/cadence. Keep planted stance soles,
  knee/arm motion and ground contact for every variant.
- `model/scripts/prepare-assets.mjs` generates ignored `model/public/models/` GLBs.
  Root prototype tools delegate to model code. Keep the original TRELLIS source;
  these locally reconstructed/authored models are not Quaternius CC0.
- `tools/bake-approved-passenger.mjs` consumes reviewed exports to generate
  `game/src/assets/passenger-approved.json`. Keep one padded instanced crowd draw,
  no per-agent GLB/skeleton. Deduplicate only complete animated vertices; preserve
  flat material boundaries, winding and all walk profiles. Wrap textures at 1024
  pixels and handle 16/32-bit indices. Never hand-edit generated GLBs/JSON.

## Workflow and validation

1. Inspect references and current viewer, then edit the owning builder. Verify
   standing and all walks, front/back/side/oblique, across moving arm phases.
2. Run `npm run build:model`, `npm --prefix model test`,
   `node tools/check-model-preview-options.mjs` and `node tools/check-model-service.mjs`.
   For coat/strap changes run `node tools/check-model-coat-closure.mjs` and
   `node tools/check-model-strap-fit.mjs`. Check both sexes with/without bags,
   ignore arm occlusion in torso fitting rays, keep Spine weights and buried
   pack anchors, and reject body intersections or floating visible ribbons.
   Backpack shape/outline changes also use `check-model-small-backpack.mjs` and
   `check-model-backpack-outline.mjs`; hem or skinning changes use
   `check-model-hem.mjs` (add `--source` to check builders before export).
3. After approving a model change run `npm run bake:passengers`; it regenerates
   exports before baking. Never bake the raw reconstruction lacking reviewed fixes.
4. Apply `metro-game` and `metro-game-test` for game integration. Run
   `npm --prefix game run typecheck`, `npm --prefix game test`, and
   `npm --prefix game run build`. Keep `passenger-library`/`passenger-view` pins
   for every variant, equal age-pool selection, all gait profiles, pack visibility,
   flat boundaries, stable identity, pause, picking and texture disposal.
   `passenger-size` pins the separate axes and child restrictions. Speed and
   physical stride use fore/aft depth together; eye height and picking use height.
5. Check actual GPU preview: every model standing/moving, no shader errors and
   one crowd draw. Run `node tools/check-game-passenger-library.mjs` after the
   game build. Node bounds do not compile GLSL. Save captures in ignored
   `.preview/`; update docs and measured atlas budgets after bake changes.

`npm start` starts web/game/model at 5173/5174/5175; reuse healthy services.
Model production preview is 4175. Preserve unrelated dirty changes and the source
reconstruction. The personal `metro-model` skill links to this repository skill.

## Refreshing concept art

Apply `metro-web`, then run `npm run art:models` at the root after model approval.
This regenerates exports/atlas, builds the game, captures every adult catalogue entry
and every eligible child template at its smaller size and the shared game opacity
with bounded model/camera/heading batches, refreshes bilingual sheet 07 UI
captures, updates sheets 01/02/07/12/13 in both
languages, checks gait, renders previews and builds/syncs the site. It never
deploys. `-- --from-game` skips only the export/bake for art-only refreshes.

`tools/passenger-capture-plan.mjs` validates adult/child standing and complete walk coverage
and source hashes before regeneration; `manifest.json` in ignored
`.preview/model-art/passenger-cards/` records provenance. Static sprite pools derive their
size from captures. Never restore fixed variant counts or skip catalogue entries.
Keep `passenger-art-pipeline` and `capture-passengers` tests passing when extending
the capture format or adding models. Captured stride includes the identity's depth
scale. Static and moving sheet figures use stable 20/80 age selection and cannot
use bagged or bald child cards. Inspect `.preview/sheets/` at frozen time 8 s.

The model-art command uses dedicated `.preview/model-art/` captures and free
browser ports, so it can coexist with other local previews.
