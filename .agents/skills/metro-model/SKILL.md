---
name: metro-model
description: Work on the model/ soft-human character library, wardrobe/bag/skirt/activity pipeline, GLB exports, offline crowd atlas bake (tools/bake-soft-passengers.mjs), sound audition studio (model/sounds.html), and passenger concept-art refresh. Use for model/ or passenger/audio baking changes; route game runtime to metro-game or metro-game-render.
---

# Metro Model Library & Sound Studio

`model/` is a standalone Vite + Three.js lab hosting two entry points
(`model/vite.config.js`, dev port `5175`, preview port `4175`, started separately
from `npm start` via `npm run dev:model`):

- `model/soft-human.html` — review, scrub, and export the soft-human passenger
  character library (base mesh, outfits, bags, age scaling, walks, and station
  activities).
- `model/sounds.html` — audition the six selected interaction cues, camera-aware
  spatial ambience + simulation-speed lab, and eight background music excerpts.

Read [`references/soft-human-pipeline.md`](references/soft-human-pipeline.md),
[`model/README.md`](../../../model/README.md), and
[`game/src/assets/PASSENGERS.md`](../../../game/src/assets/PASSENGERS.md) before
changing character geometry, posture, or crowd atlas schemas.

## Hard Isolation & Provenance Rules

- **Strict runtime boundary:** Offline tooling (`tools/bake-soft-passengers.mjs`,
  `tools/prepare-game-audio.mjs`, `tools/unity-assets/export-crowd.mjs`) may
  import `model/src/` directly. Game runtime (`game/src/`) NEVER imports `model/`
  or FBX loaders — it consumes only baked assets in `game/src/assets/` and
  `game/public/audio/`.
- **FBX provenance:** The active base is
  `model/public/human-candidates/human-fall-flat/HumanBody_Alt.fbx` (`1.7` m
  normalized, `26,544` vertices, `16`-bone rig with `Hips` at index `15` and arms
  at `9..14`). Preserve `human-fall-flat/readme.txt` and record its SHA-256 in
  manifests; do not label it as original procedural or CC0 geometry.
- **No hand-edited outputs:** Never hand-edit generated GLBs/JSONs under
  `model/public/soft-human/` or baked atlases under `game/src/assets/`
  (`passenger-approved.json`, `passenger-activities.json`,
  `passenger-source-lf.json`).

## Soft-Human Architecture (`model/src/soft-human/`)

| Module | Ownership |
| --- | --- |
| `imported-base.js` | Loads/normalizes `HumanBody_Alt.fbx`, rebinds `16` bones in A-pose, exposes `anatomy`, `metrics`, `cap`, `setAge`, `resetPose`. |
| `wardrobe.js` | `SEXES`, `outfitsForSex` (`20` wearable outfits/category + `baseOnly` `plain`), `BACKPACKS` (`11` options), `8`-region triangle-split `clothingGeometry`. |
| `skirt.js` | One-skin `skirtBodyGeometry` (`source-body-bridge`): replaces only the central inner-thigh patch below `0.50` m with smooth front/back bridges and hem cap; zero extra waist shells. |
| `torso-fit.js`, `mathematical-strap.js`, `bag-connectors.js` | Measured narrow neckline + authored Bezier/superellipse constant-width straps (`100%` `Chest`-owned, parallel-transport frames, exact bind-space bag anchors; no surface fitting). |
| `bag-shell.js`, `carried-bags.js` | Tapered fabric shells (`softBagGeometry`) and `8` carried bags (`shoulder`/`crossbody` on `Chest`; `handbag`/`purse` on wrist anchor with vertical counter-rotation). |
| `character.js`, `relaxed-arms.js` | `120` Hz damped-spring `createMotion` for walks/studies; shared rig-frame relaxed-arm stance (`poseRelaxedArm`) for `idle` and all unused station-activity arms. |
| `activities.js`, `../interaction-equipment.js` | `20` `SOFT_ACTIONS` (`3` walks, `14` non-walk game activities, `idle`/`reach`/`float`), two-bone IK (`../animation/interactions.js`), production equipment preview props. |
| `catalog.js`, `main.js` | `SOFT_MODEL_LIBRARY` (`440` recipes, adult + child eligible) and interactive preview UI with current-pose GLB download. |

### Key Character & Bake Contracts

- **Posture first:** Walking retains its outward A-pose spread. `idle`, `wait`,
  `queue`, standing atlas frame `0`, and every unused station arm share
  `relaxed-arms.js` (elbow angled back, forearm forward in side view). Escalator
  holding arms lift forward `30°` at the shoulder on their own side with zero
  chest turn, independent of belt position; equipment overlap is allowed.
- **Handedness:** `activities.js` accepts `anchors.hand` (`default`, `right`,
  `left`). Hand-held `purse`/`handbag` bags reserve their carrying hand when no
  explicit override is passed. Screen/reader/handle targets stay fixed.
- **Normals & LODs:** `tools/bake-soft-passengers.mjs` preserves smooth source
  normals across color cuts, locks soles during simplification, packs `73`
  walking frames + `24`-sample activity palettes across `8` height fits × `3`
  hand modes, and generates `≤ 10%` Low-LOD topologies via
  `tools/passenger-low-topology.mjs` (per-region connected-component
  `MeshoptSimplifier.simplifyWithAttributes` in A-pose reference frame using
  16-bone skin weights + multi-frame pose deltas, area-weighted budgets, and
  locked extrema — never spatial `ConvexHull` envelopes, so arms never web to
  the torso or legs). Always follow a direct baker run with
  `node tools/passenger-source-lf.mjs` (bundled in `npm run bake:passengers`).

See [`references/soft-human-pipeline.md`](references/soft-human-pipeline.md) for
exact outfit lists, bone indices, skirt/strap geometry rules, and bake formats.

## Sound Studio (`model/sounds.html` & `model/src/sound-preview/`)

- **Interaction cues (`effects.js`):** Six selected cues (`Place`, `Pick`, `Move`,
  `Select`, `Delete`, `Refused`) with cached filter/envelope/pitch/RMS tuning
  (`TUNING`, `shapeEffect`). Keep the UI focused on this six-cue set without
  alternative-candidate dropdowns.
- **Spatial ambience & speed lab (`ambient.js`, `spatial.js`, `audio.js`):**
  Three CC0 loops (`crowd.mp3`, `train.mp3`, `traffic.mp3`), `4` camera
  scenarios, moving train pass (`48` s pass + `16` s gap), and `1×`/`4×`/`16×`/`64×`
  tactics (`natural`, `cap2`, `rate`, `skip`, `mute`) with soloing. Imports
  `ambientTactic` and `AmbientVoice` directly from
  `game/src/app/ambientPlayback.ts` so defaults match the game policy.
- **Music auditions (`music.js`):** Eight local `90`-second excerpts with `3` s
  fade-outs (`public/sounds/music/manifest.json`), audition-only (not shipped in
  game soundtrack).
- **Source provenance & game audio bake:**
  - Refresh CC0 samples/licenses (`public/sounds/manifest.json`):
    `python model/scripts/collect-sounds.py`
  - Regenerate procedural soft WAVs (`public/sounds/soft-manifest.json`):
    `python model/scripts/make-soft-sounds.py`
  - Regenerate music excerpts: `python model/scripts/collect-music.py`
  - Bake approved cues + ambient MP3s into `game/public/audio/`:
    `node tools/prepare-game-audio.mjs`
- Sound-only changes do not require GLB exports, passenger atlas bakes, or
  `npm run art:models`.

## Commands & Validation

Run from the repository root:

| Task | Command |
| --- | --- |
| Install / run / build `model/` | `npm run setup:model` · `npm run dev:model` · `npm run build:model` · `npm run preview:model` |
| Run all `model/` unit tests | `npm --prefix model test` (focused: `node --test model/test/soft-human*.test.mjs` or `sound-*.test.mjs`) |
| Export bind-pose GLB example | `node model/scripts/export-soft-human.mjs [--sex=male\|female] [--outfit=<id>] [--backpack=<id>] [--age=adult\|child]` |
| Soft-human browser checks (need `build:model`) | `node tools/check-soft-human.mjs` · `check-soft-human-activities.mjs` · `check-soft-human-casual.mjs` · `check-soft-human-clearance.mjs --all` (`--seated` / `--escalators` / `--wash`) · `check-soft-arm-poses.mjs` · `check-soft-escalator-pose.mjs` |
| Sound studio browser check (needs `build:model`) | `node tools/check-sound-preview.mjs` |
| Bake game crowd atlases + LF record | `npm run bake:passengers` (inspect sizes: `node tools/measure-passenger-assets.mjs`) |
| Verify baked game crowd (need `game` build) | `node --test game/test/passenger-*.test.mjs` · `npm run check:passenger-lod` · `node tools/check-game-passenger-library.mjs` · `check-game-passenger-activities.mjs` · `check-game-passenger-handedness.mjs` · `check-game-ramp-animation.mjs` |
| Refresh concept-art sheets (no deploy) | `npm run art:models` (add `-- --from-game` to skip `bake:passengers`) |

All browser captures write to ignored `.preview/` paths. `npm run art:models`
uses dedicated `.preview/model-art/` folders and ephemeral free ports, so it
coexists with local dev servers; inspect rendered previews under
`.preview/sheets/` at `8` s.

## Sibling Skill Routing

- [`metro-game`](../metro-game/SKILL.md) — game audio runtime (`game/src/app/`),
  app shell, and asset/save contracts outside `model/`.
- [`metro-game-render`](../metro-game-render/SKILL.md) — Three.js crowd shaders,
  instanced LOD rendering, and `CrowdSystem` / `passengerModel.ts`.
- [`metro-game-test`](../metro-game-test/SKILL.md) — `game/test/` suite and
  game browser verification harness.
- [`metro-unity-assets`](../metro-unity-assets/SKILL.md) — Unity soft-human
  crowd GLB export (`tools/unity-assets/export-crowd.mjs`) and prefab imports.
- [`metro-web`](../metro-web/SKILL.md) — concept-art sheet generation (`art/`,
  `tools/gen-art.mjs`) and site deployment after `npm run art:models`.
- [`metro-repo`](../metro-repo/SKILL.md) — top-level layout, root scripts, and
  shared performance inventory.
