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
  long hair without a bag. Viewer and bake share entries. Each complete entry
  gets equal game selection weight; do not select sex, hair and bag hierarchically.
  Stable identity chooses appearance without consuming simulation RNG.
- `female.js` builds both sexes; short/bald use the same smooth scalp with hair
  or skin colours. `shoulders.js` cleans neck, face, chest, coat and backpack.
  Preserve faceless, opaque, unlit flat-grey illustration and source provenance.
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
2. Run `npm run build:model` and `node tools/check-model-service.mjs`.
   For coat/strap changes run `node tools/check-model-coat-closure.mjs` and
   `node tools/check-model-strap-fit.mjs`. Check both sexes with/without bags,
   ignore arm occlusion in torso fitting rays, keep Spine weights and buried
   pack anchors, and reject body intersections or floating visible ribbons.
3. After approving a model change run `npm run bake:passengers`; it regenerates
   exports before baking. Never bake the raw reconstruction lacking reviewed fixes.
4. Apply `metro-game` and `metro-game-test` for game integration. Run
   `npm --prefix game run typecheck`, `npm --prefix game test`, and
   `npm --prefix game run build`. Keep `passenger-library`/`passenger-view` pins
   for every variant, equal selection, all gait profiles, pack visibility,
   flat boundaries, stable identity, pause, picking and texture disposal.
5. Check actual GPU preview: every model standing/moving, no shader errors and
   one crowd draw. Run `node tools/check-game-passenger-library.mjs` after the
   game build. Node bounds do not compile GLSL. Save captures in ignored
   `.preview/`; update docs and measured atlas budgets after bake changes.

`npm start` starts web/game/model at 5173/5174/5175; reuse healthy services.
Model production preview is 4175. Preserve unrelated dirty changes and the source
reconstruction. The personal `metro-model` skill links to this repository skill.

## Refreshing concept art

Apply `metro-web`, then run `npm run art:models` at the root after model approval.
This regenerates exports/atlas, builds the game, captures every catalogue entry
with bounded model/camera/heading batches, refreshes bilingual sheet 07 UI
captures, updates sheets 01/02/07/12/13 in both
languages, checks gait, renders previews and builds/syncs the site. It never
deploys. `-- --from-game` skips only the export/bake for art-only refreshes.

`tools/passenger-capture-plan.mjs` validates standing and complete walk coverage
and source hashes before regeneration; `manifest.json` in ignored
`.preview/model-art/passenger-cards/` records provenance. Static sprite pools derive their
size from captures. Never restore fixed variant counts or skip catalogue entries.
Keep `passenger-art-pipeline` and `capture-passengers` tests passing when extending
the capture format or adding models. Inspect `.preview/sheets/` at frozen time 8 s.

The model-art command uses dedicated `.preview/model-art/` captures and free
browser ports, so it can coexist with other local previews.
