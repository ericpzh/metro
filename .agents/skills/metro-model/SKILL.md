---
name: metro-model
description: Work on the metro repository model/ character library, reviewed hair and bag variants, silhouette and strap cleanup, walking clips, GLB exports, and shared game crowd atlas. Use for model/ or tools/bake-approved-passenger.mjs changes. Route game renderer/simulation work through metro-game and test work through metro-game-test.
---

# Metro model library

Work from the metro root. Read `model/README.md` and
`game/src/assets/PASSENGERS.md`. For a new character reconstruction also use
`stylized-3d-character`. This skill owns the existing reviewed character pipeline.

## Ownership and contracts

- `model/src/characters/library.js` is the catalogue: original/short/bald male
  and bob/shoulder/long female templates, bagless/full/small backpacks, 75% and
  87.5% standard backpacks, and left/right shoulder, crossbody and purse variants.
  Viewer and bake share the complete catalogue (currently 56 entries).
  Explicit `adultEligible` / `childEligible` flags own the pools (currently 50 / 19):
  female crossbody templates are child-only, and bald models are never children.
  Approved small/crossbody bags can be child templates. Choose each eligible entry
  equally; do not select sex, hair and bag hierarchically or freeze catalogue counts.
  Stable identity chooses appearance without consuming simulation RNG.
- `female.js` builds both sexes; short/bald use the same smooth scalp with hair
  or skin colours. `shoulders.js` cleans neck, face, chest, coat and backpack.
  Preserve faceless, unlit flat-grey illustration and source provenance. GLB/viewer
  surfaces are opaque; the game crowd's shared material uses 70% opacity.
- `small-backpack.js` owns the tapered crown, fuller base and shallow side profile.
  Scaled standard packs keep both their body and connectors aligned throughout all
  walks. `carried-bags.js` owns side bags and torso-following hip placement; test
  each side standing and through slow/medium/fast gaits, not only whole-body bounds.
  Side bag faces lie in Y/Z with thin X depth. Shoulder/crossbody bodies stay on
  Spine between torso and arm; purses and handles follow Hand. `carry-pose.js`
  applies the same carrying-arm clearance in the viewer, GLBs and atlas, including
  standing frame zero. Fit continuous straps over the shoulder and smooth the
  neckline bridge. A missed surface ray must preserve its anchor on a separate
  vector: aliasing the input can collapse points to the origin and create debris.
  `waist-skinning.js` keeps trouser waists on Hips and lower coat panels on Spine;
  sleeve vertices retain arm movement. The lining stays recessed behind the hem.
- `preview-appearance.js` owns age rules, percentage clamping, reset and random
  selection. It imports game tuning: 20% children / 80% adults, height 80–120%,
  adult width/depth 90–110%, child width/depth 80–90%. Child base: height 65%,
  width/depth 70%. Viewer axes are X width / Y height / Z depth; game axes are
  X depth / Y width / Z height. Keep preview URLs and ranges valid when age changes.
- `garment-lining.js` closes coats through moving arm poses on all models,
  including models with bags. Do not remove it based on a standing screenshot.
- `front-boundaries.js` and `shoulders.js` own neckline/front-opening/shoulder
  boundaries. Verify narrow residual slivers from front and oblique views, both
  sexes, with/without every bag; preserve the source surface and moving-arm closure.
  Keep connector ribbons torso-weighted and buried at the pack, avoiding added
  floating tabs or exposed shoulder holes. Use `check-model-shoulder-line.mjs`
  for the close-up boundary pass, `check-model-standard-backpacks.mjs` for scaled
  pack depth/connector alignment, and existing coat/strap/hem checks for motion.
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
  Carry age/side/bag metadata through exports and bake. Game `passengerEligibility`
  accepts older atlases without flags using historical pools; explicit flags always
  take precedence. A model edit must regenerate the actual atlas before validating
  new geometry/pools, not only update consumers/tests against an older export.

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
   Side bag changes also run `check-model-carried-bags.mjs` for ownership,
   arm clearance and short strap triangles across all gaits/seven views, and
   `check-model-crossbody-straps.mjs` for visible shoulder coverage across every
   eligible age. Bounds alone miss straps buried in the shoulder. Keep the
   deterministic missed-ray regression in `model/test/carried-bags.test.mjs`.
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
use age-ineligible or bald child cards. Approved small/crossbody child bags remain
valid. Inspect `.preview/sheets/` at frozen time 8 s.

The model-art command uses dedicated `.preview/model-art/` captures and free
browser ports, so it can coexist with other local previews.
