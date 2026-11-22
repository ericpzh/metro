# Soft-Human Character & Crowd Bake Pipeline

Detailed geometry, rigging, posture, atlas-bake, and concept-art capture contracts
for [`metro-model`](../SKILL.md). See also
[`game/src/assets/PASSENGERS.md`](../../../../game/src/assets/PASSENGERS.md) and
the passenger inventory in
[`metro-repo/references/performance.md`](../../metro-repo/references/performance.md).

## 1. Active Base Mesh, Rig, and Provenance

- **Source asset:** `model/public/human-candidates/human-fall-flat/HumanBody_Alt.fbx`
  (`SOFT_BASE_URL` in `model/src/soft-human/imported-base.js`).
- **Normalization & rebinding (`createImportedSoftHuman`):**
  - Scales to `1.7` m height, Y-up, preserving all `26,544` vertices, authored
    skin weights, and smooth normals.
  - Rebinds the `15` source bones plus a root `Hips` bone (`16` bones total) with
    identity bind rotations and an outward A-pose (`arm.rotation.z = -s * 0.80`)
    baked into bind geometry.
  - Joint layout: `0..5` legs (`LeftHip`, `LeftThigh`, `LeftLeg`, `RightHip`,
    `RightThigh`, `RightLeg`), `6` `Waist`, `7` `Chest`, `8` `Head`, `9..14` arms
    (`LeftShoulder`, `LeftArm`, `LeftForearm`, `RightShoulder`, `RightArm`,
    `RightForearm`), `15` `Hips` (`rootBone = 15`, `armBones = [9..14]`).
  - Exposes `anatomy` from `measureSoftTorso` (`torso-fit.js`): narrow `neck` /
    `necklineY` / `neckline` field, `shoulderX`, forearm-perpendicular `cuffs`,
    and upper-arm-perpendicular `sleeves`.
- **Age scaling (`setAge`):** `adult` uses unit scale; `child` scales body
  `(0.70, 0.65, 0.70)` with relative `Head` scale `1.08`.
- **Provenance:** Keep `model/public/human-candidates/human-fall-flat/readme.txt`
  intact and record the FBX SHA-256 plus source hashes in every GLB and bake
  manifest. The readme identifies the FBX as a cleaned Unity game extract with no
  redistribution license; never describe the base mesh as original procedural or
  CC0 geometry.

## 2. Wardrobe, Skirts, Bags, and Mathematical Straps

- **Categories (`wardrobe.js`):** `SEXES` defines `male` and `female` sharing the
  same body mesh. `outfitsForSex(sex)` returns `20` wearable outfits per category
  (`plain` is `baseOnly: true` for API/CLI exports outside the `20` wearables):
  - **Female-only (5):** `trail` (Pink trail jacket), `tee-skirt`, `blouse-skirt`,
    `blue-navy-skirt`, `rose-slate-skirt`.
  - **Male-only (5):** `beach` (Summer stripes), `sport-shorts`, `casual-shirt`,
    `black-khaki`, `slate-suit`.
  - **Shared (15):** `commuter`, `stripe`, `navy-suit`, `charcoal-suit`,
    `beige-blazer`, `tee-shorts`, `polo-shorts`, `white-denim`, `navy-sand`,
    `sage-stone`, `coral-navy`, `blue-cream`, `burgundy-sand`, `cream-navy`,
    `olive-charcoal`.
  - Switching categories (`setSex`) preserves shared outfit, bag, age, and
    timeline, falling back to `commuter` when the active outfit is category-only.
- **Triangle-split clothing (`clothingGeometry`):** Splits skinned triangles into
  `8` opaque material regions at garment, neckline, sleeve, cuff, hem, lapel, tie,
  and shoe boundaries so materials survive GLB export without shaders. Preserves
  skin area, winding, smooth normals, and normalized per-vertex weights. Short
  sleeves cut perpendicular to upper arms (`anatomy.sleeves`); long sleeves and
  formal cuffs cut perpendicular to forearms (`anatomy.cuffs`).
- **One-skin skirts (`skirt.js`, `skirtBodyGeometry`):**
  - Edits the body skin directly (`construction: 'source-body-bridge'`); never
    adds separate skirt shells, waist rims, or flared envelopes.
  - Preserves waist, hips, and outer legs; replaces only the central inner-thigh
    patch below `SKIRT_BRIDGE_TOP` (`0.50` m) down to hem (`0.29` m short /
    `0.16` m midi) with smooth front/back Hermite bridges and a triangulated hem
    cap along the source inner-leg arcs.
  - Subdivides source cut edges at connector vertices so shared edges carry
    identical weights and smooth normals without posed T-junctions.
  - `skinWeightsOf` sums duplicate bone-0 slots rather than overwriting real
    `LeftHip` (index `0`) weights with zero-weight padding.
- **Bags & straps (`bag-shell.js`, `carried-bags.js`, `torso-fit.js`,
  `mathematical-strap.js`, `bag-connectors.js`):**
  - `BACKPACKS` exposes `11` options: `none`, `daypack`, `hiking`, and `8`
    `CARRIED_BAGS` (`shoulder`, `crossbody`, `handbag`, `purse` × `left`/`right`).
  - `softBagGeometry` builds tapered rounded fabric shells. `handbag` and `purse`
    parent to the carrying forearm wrist anchor and counter-rotate (`updateCarry`)
    to hang vertically; `shoulder`, `crossbody`, and backpacks parent to `Chest`
    (pack back face sits clear behind the torso at `z < -0.215` m).
  - Straps on the active FBX base (`c.anatomy`) use `mathematicalStrap` and
    `shoulderStrapCurve`: constant-width closed ribbons with parallel-transport
    frames along cubic Bezier shoulder crowns, an analytic torso envelope
    (`TorsoDiagonal`), and a level superellipse (`TorsoArc` at `returnY = 0.855` m)
    for backpack lower returns. Endpoints connect directly to bind-space bag
    anchors via `connectStrapToBag`, with `100%` `Chest` ownership — no arm bone
    weights, no triangle projection, and no per-frame surface fitting.

## 3. Motion, Relaxed Arms, Activities, and Handedness

- **Walk & study motion (`character.js`, `createMotion`):** Deterministic `120` Hz
  fixed-step damped angular springs (`acc` clamped to `0.1` s) driving
  `walk-slow`, `walk`, `walk-fast` (from `WALK_PROFILES` in
  `game/src/sim/constants.ts`), `idle`, `reach`, and `float`. Walking keeps the
  outward A-pose bind spread and forward/back arm swing.
- **Shared relaxed-arm stance (`relaxed-arms.js`):** `idle` and every unused
  station-activity arm (through approach, dwell, and release) use `poseRelaxedArm`
  in rig space: wrist offset `(s * 0.26, -0.90, 0.06) * armLength`, elbow angled
  backward in side view and forearm forward, modest lateral clearance outside the
  torso, hand above the knee. Equipment overlap on relaxed arms is diagnostic
  only; never reshape this stance for clearance.
- **Station activities (`activities.js`, `SOFT_ACTIONS`, `createSoftActivityPoser`):**
  - `20` actions total: `3` walks + `14` non-walk station activities from
    `game/src/sim/activities.ts` (including `escalator-left`) + `idle`, `reach`,
    `float`. Preview props come from `model/src/interaction-equipment.js`
    (`{softBody: true}`).
  - **Escalator posture:** Natural posture takes priority over handrail contact
    and balustrade clearance. The holding arm solves a comfortable reach on its
    own side (`(s * 0.20, -0.12, 0.74) * armLength`) and pitches forward `30°`
    (`-Math.PI / 6`) at the shoulder in side view before appearance scaling, with
    zero chest turn (`chest.rotation.y === 0`), independent of belt coordinates.
  - **Handedness (`anchors.hand`):** Accepts `'default'`, `'right'`, `'left'`.
    A hand-held `purse` or `handbag` reserves its carrying hand when no explicit
    override is supplied (including one-handed washing). Screen, reader, basin,
    and door targets stay fixed between hand modes.
  - **IK reach & seating:** For non-escalator single-hand reaches, joint lengths
    are measured in the IK rig frame (under independent height scaling) and add
    minimal chest yaw (with half head counter-turn) only when needed to bring the
    target within reach before `solveLimb` (`model/src/animation/interactions.js`).
    Seated actions (`sit`, `toilet`) establish seat support with planted feet
    before relaxing legs (reversing on stand); children use sized seat/wash steps
    on adult-sized equipment.
- **Procedural unit-test fixture:** `character.js` also exports the `11`-bone
  marching-cubes `createSoftHuman` constructor (paired with `strap-fit.js`),
  exercised by `soft-human.test.mjs`, `soft-human-wardrobe.test.mjs`,
  `soft-human-activities.test.mjs`, and `soft-human-bag-clearance.test.mjs`. Add
  active FBX regressions to `soft-human-imported.test.mjs`,
  `soft-human-casual.test.mjs`, `soft-human-skirt.test.mjs`,
  `soft-human-fit.test.mjs`, and `soft-human-handedness.test.mjs`.

## 4. GLB Export, Crowd Atlas Bake, and Concept-Art Captures

- **Bind-pose GLB CLI (`model/scripts/export-soft-human.mjs`):**
  - Flags: `--outfit=<id>`, `--backpack=<id>` (requires `--outfit`),
    `--sex=<male|female>` (validated against `outfitsForSex`; appended to filename
    only when explicitly passed), `--age=<adult|child>`.
  - Round-trips `GLTFExporter` → `GLTFLoader`, verifies `16` bones, and writes
    `model/public/soft-human/<name>.glb` plus provenance JSON (`manifest.json` for
    plain adult base, `<name>.json` for named examples). Regenerate affected
    examples after changing any listed source file; never hand-edit them.
- **Shared crowd atlas (`npm run bake:passengers`):**
  - Executes `node tools/bake-soft-passengers.mjs && node tools/passenger-source-lf.mjs`.
  - Consumes `SOFT_MODEL_LIBRARY` (`440` recipes = `2` sexes × `20` outfits ×
    `11` bags, all adult- and child-eligible) directly from `model/src/soft-human/`.
  - Preserves source smooth normals across color boundaries (never recompute per
    material region) and locks sole vertices (`y < 0.015` m) during Meshopt
    simplification.
  - Emits three generated files under `game/src/assets/` (never hand-edit):
    - `passenger-approved.json`: `440` variants, `90` authored RGB palette colors,
      `218,396` shared vertices, `73` frames (`frame 0` = relaxed-arm standing
      pose + `3 × 24` walk frames, lossless frame-delta via
      `tools/passenger-bake-geometry.mjs`, zlib-base64), full topology padded to
      `8,101` triangles, Low LOD topology padded to `791` triangles (`≤ 10%` per
      recipe via `tools/passenger-low-topology.mjs` preserving palette boundaries
      and pose extrema).
    - `passenger-activities.json` (`version: 3`): same `218,396` bind vertices and
      `16`-bone rig (`rootBone: 15`, `armBones: [9..14]`), `24` samples × `8`
      height fits (`0.5`–`1.2`) × `3` hand modes (`default`, `right`, `left`) ×
      `18` poses (`15` `ACTIVITY_NAMES` + `3` walks).
    - `passenger-source-lf.json`: LF-normalized SHA-256 verification record
      matching `passenger-approved.json` raw input hashes. Run
      `node tools/passenger-source-lf.mjs` whenever running the baker directly.
  - Game rendering uses one instanced draw per visible LOD, no live skeleton,
    fully opaque depth-writing materials (`opacity: 1`, `transparent: false`), and
    ordinary skinning for integrated skirts. Inspect exact buffer/texture sizes
    with `node tools/measure-passenger-assets.mjs`.
- **Concept-art capture contract (`npm run art:models`):**
  - `tools/refresh-model-art.mjs` runs `bake:passengers` (skipped with
    `-- --from-game`), builds `game/`, captures piece elevations/hero views, runs
    `tools/render-passenger-cards.mjs` in `4`-variant batches for both ages
    (standing + full `24`-frame walk cycles for iso/elevation/plan), refreshes
    bilingual sheet 07 UI shots, regenerates sheets `01`/`02`/`07`/`12`/`13` in
    Chinese and English (`tools/gen-art.mjs`), verifies gait playback
    (`tools/test-passenger-animation.mjs`), renders `8` s PNG previews under
    `.preview/sheets/`, and builds `web/`. Never deploys.
  - `tools/passenger-capture-plan.mjs` validates complete adult/child coverage,
    eligibility, and `sourceSha256`/`recipeSha256` freshness before updating
    sheets (`manifest.json` in `.preview/model-art/passenger-cards/`). Static
    sprite pools in `tools/passenger-cards.mjs` size themselves from captures and
    prune unreferenced definitions; keep `game/test/passenger-art-pipeline.test.mjs`
    and `game/test/passenger-sprite-pruning.test.mjs` green.
