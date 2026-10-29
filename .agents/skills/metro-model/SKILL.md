---
name: metro-model
description: Work on the metro repository model/ character library, reviewed hair and bag variants, silhouette and strap cleanup, walking clips, GLB exports, the soft-human motion-study preview, and shared game crowd atlas. Use for model/ or tools/bake-soft-passengers.mjs changes. Route game renderer/simulation work through metro-game and test work through metro-game-test.
---

# Metro model library

## Human candidate preview studies

`model/candidates.html` is a separate review surface for external clothed human
sources and does not feed the game crowd atlas. Keep candidate experiments there
until the user approves a source and its style; game integration still goes through
the reviewed character library and passenger bake. The current study has 14
candidates, deterministic 16-view source sheets in
`model/public/human-candidates/studies/`, and faceless grayscale studies alongside
them. `library.json` records source/model hashes and generation provenance. Do not
replace source assets or generated study sheets without updating that record.

For pre-rendered walking sprites, read
[the candidate sprite workflow](references/candidate-sprites.md). It records the
32-frame requirement, temporal and anatomical consistency checks, camera-angle
handling, and why the current image-space corrections remain experimental.

External motion for the candidate preview is isolated in
`model/src/animation/candidate-library-motion.js`; its CC0 Quaternius source,
license and collection record live in
`model/public/human-candidates/motions/`. The preview retargets authored upper-body
clips and keeps the existing foot-targeted gait for legs. Do not import the model
preview into game runtime. Preserve source material/texture state when switching
between the flat study and original textured views, and wait for external textures
to decode before capturing FBX models.

For live grayscale studies, retain the original skinned geometry and derive palette
boundaries from continuous bind-space fields: fit garment/skin intervals from
source texture samples, then shade seams per fragment. Per-vertex sampled material
labels create jagged boundaries at hairlines, sleeves, collars and hems. Keep
face-detail meshes filled with the skin tone; hiding them can expose holes in the
head. Verify front, oblique, side and back views at multiple gait phases. The focused
boundary regression is `model/test/candidate-boundaries.test.mjs`; run
`node tools/check-candidate-motion.mjs` for all-candidate motion/geometry checks,
`node tools/check-human-candidates.mjs` for the preview UI and study sheets, then
`node model/node_modules/vite/bin/vite.js build model`.

## Selected soft-human model and game promotion

**Selected-base update:** the user explicitly selected the new
`public/human-candidates/human-fall-flat/HumanBody_Alt.fbx` as the base for the preview and game crowd. This supersedes the historical
procedural-only and preview-isolation restrictions below. `src/soft-human/imported-base.js` preserves its skin, source weights and
smooth normals, rebases its 15 source bones plus a Hips root, and exposes measured
limb/wardrobe coordinates to the existing clothing, bag and activity layers.
`main.js` and `scripts/export-soft-human.mjs` use this selected base. Keep the
procedural constructor as a historical fixture; the old tests still cover it.
Add regressions against the actual FBX in `soft-human-imported.test.mjs`.
`wardrobe.js` owns `SEXES` and `outfitsForSex`: twenty wearable outfits in each
male/female category on the same body. Pink `trail`, `tee-skirt` and
`blouse-skirt` are female-only; `beach` (Summer stripes), `sport-shorts` and
`casual-shirt` are male-only. `plain` is an exportable fixture outside the twenty
wearables. Cotton tees and polos have perpendicular upper-arm sleeve cuts and
clean shorts hems. Category changes preserve shared outfits, bag, age and
animation, falling back to `commuter` when needed. Run `soft-human-casual.test.mjs`
and `tools/check-soft-human-casual.mjs` for categories, boundaries and both ages.
`skirt.js` now edits the selected source body: preserve the waist, hips and outer
legs, replace the central inner-thigh/crotch patch below 0.50 m with smooth front
and back connections, and close the remaining gap at the hem. Paint this single
skin like trousers. This user-approved construction supersedes separate skirt
shells, superellipse flares, waist rims and extra cap thickness. Connector edges
must conform to the source cuts and share weights/normals, avoiding posed
T-junctions. Sum duplicate padded skin IDs rather than overwriting a real
bone-zero hip influence. `soft-human-skirt.test.mjs` pins protected source vertices, one-skin
waist colors, filled front/back gaps, leg weights, activities and GLB round trips.
Eight shared color/cut combinations plus two male and two female additions bring
both categories to twenty. New skirts are `blue-navy-skirt` and
`rose-slate-skirt`; keep Pink trail and Summer stripes eligibility unchanged.
The game bake must retain source smooth normals across color boundaries; never
recompute each material region's normals independently. The front strap envelope
retains its mathematical clearance; no per-frame geometry fitting is introduced.
`export-soft-human.mjs --sex=...` validates category and adds it to filenames;
legacy example filenames remain stable without the option.
Restore bind joint positions and age width when leaving narrow activity poses.
The selected base's outward A-pose is already baked into its bind geometry:
walking and idle use `restArmAngle: 0` and retain that spread while swinging
forward/back. Do not apply the historical procedural rig's inward arm offset.
This also applies to **every station action**: free arms retain the outward bind
pose through approach, waiting, seating and release, including gates, doors and
escalators. Do not tuck free arms, rest them on the lap, or compress adult width
to fit a lane. Only active equipment reaches blend to IK; a zero-contact arm
returns to the outward default. This user direction supersedes the legacy
narrow-lane tucking rule below. Keep tests against the imported base and live
activity checker aligned; full collision audits may report the deliberately
outstretched free arm in adult-sized narrow equipment.
`activities.js` accepts `anchors.hand` (`default`, `right`, `left`). A hand-owned
purse/handbag reserves its carrying hand when no explicit bake mode is supplied.
Keep left/right reaches on the same equipment target; do not mirror a screen or
belt away. Opposite-side rail reaches turn the chest into the reach, and a held
bag allows only the free hand to wash. The game bake stores all three hand modes
per height fit. Pin target identity/free-arm pose in `soft-human-handedness` and
both-mode GPU palettes in `passenger-activity-assets`.
Reach clearance uses joint lengths in the IK rig frame, including independent
height scaling; a small chest turn must bring the target within reach before
solving the elbow. World-space lengths would miss short/tall opposite-hand reaches.
The selected base uses `mathematical-strap.js`: authored Bezier shoulder arcs,
an analytic torso profile, and a level superellipse for the backpack lower return
in `torso-fit.js`. User feedback explicitly rejected geometry-fitted straps.
Do not project either edge or the centreline to triangles, borrow arm weights, or
add per-frame surface corrections. Keep constant width, parallel-transport frames
and Chest ownership shared with the bag; pin continuity and pose stability in
`soft-human-fit.test.mjs`. `strap-fit.js` is only for the historical procedural
fixture. Necklines use the measured narrow neck; long sleeves split at a plane
perpendicular to each forearm (`anatomy.cuffs`), including a separate formal cuff.
Both left/right shoulder and crossbody straps share that mathematical builder;
their front/back endpoints come from the actual bag anchors in bind space.
Backpack upper endpoints likewise use the actual bag attachment. Keep the pack's
body-facing surface behind the torso so that an attached end is not occluded by
the back. Do not restore arm-influenced strap weights or adaptive surface fitting.
Preserve the source readme and hash in export provenance: it describes a game
extract and supplies no redistribution license. Do not describe the selected FBX
as original procedural geometry. The user has explicitly promoted this model into the game.
`catalog.js` derives 440 recipes (twenty outfits/category × eleven bags), all
eligible at both ages. `npm run bake:passengers` runs
`tools/bake-soft-passengers.mjs`, consuming the exact preview constructors to
produce walking and activity atlases. Record source and recipe input hashes.
The selected 16-bone rig has Hips index 15 and arms 9–14; preserve explicit rig
metadata and update GPU/camera assumptions with it. Keep one draw per visible
LOD and no live passenger skeleton. Offline tooling may import model code;
game runtime consumes only generated assets. Game people use fully opaque, depth-writing materials at both LODs. This
supersedes the legacy 70%/45% policy below; source atlases do not need rebaking
for this render-only setting. The integrated skirt is already the body exterior, including its leg bridge. Do
not strip the lower body or apply the old shell drape in the game shader. Ordinary
source skinning owns walking and seating. GLB downloads include this same geometry. See `game/src/assets/PASSENGERS.md`.

`model/soft-human.html` is the editing/review surface for the active game base.
Historical procedural constructors and the older 232-export viewer remain
available as fixtures; they no longer own the game's crowd catalogue.

- `src/soft-human/character.js` owns the original implicit sculpt. One marching-
  cubes field produces the continuous skin (skull, torso, mitten hands, legs),
  weighted from point-to-segment distances across an eleven-bone rig. The cap and
  clothing/accessories are separate meshes. This constructor is a historical
  fixture; the active page uses the selected FBX adapter described above. The motion layer is fixed-step damped angular springs following
  procedural targets; it is pose-following lag/overshoot, not an active ragdoll
  with contacts, balance, grabbing or soft-body volume. Feet are not contact-solved.
  `state.softness` changes stiffness/damping; keep the timestep and frame clamp so
  tab resumption stays bounded.
- `src/soft-human/wardrobe.js` splits the actual skinned triangles into eight
  opaque material regions at garment/lapel/tie/shoe boundaries, so clothes survive
  GLB export without a shader. Preserve skin area, winding and per-vertex weights
  when adding outfits. `OUTFITS`/`outfitsForSex` and `BACKPACKS` drive the selectors; twenty wearable
  outfits per category include the formal suits, and the pack list adds eight carried-bag variants.
  The plain/base rig must remain exportable.
- `carried-bags.js` adapts hip, shoulder/crossbody and hand-held shapes to this
  rig. `bag-shell.js` owns the fabric envelope; selected-base straps use the
  mathematical builder and fixed bag anchors. `strap-fit.js` retains the old
  procedural fixture's surface-fitting implementation only. Keep selected-base
  ribbons torso-owned, with exact endpoint attachment and no surface fitting.
- `src/soft-human/activities.js` derives `SOFT_ACTIONS` from
  `game/src/sim/activities.ts` (20 actions: three walks, every non-walk activity
  including left-hand escalator, plus idle/reach/float) and adapts the production
  interaction poses/IK to the soft rig. Reuse `interaction-equipment.js`; keep
  preview construction isolated from station documents. The selected FBX keeps
  free arms in its outward default in every action; the legacy procedural
  fixture alone retains its older narrow-lane tucking behavior. Seat, basin, rail, door-threshold
  and lift-floor heights come from the actual equipment anchors. Children use a
  sized step, shorter rail reach and a visible wash step; adult equipment stays
  adult-sized.
- `scripts/export-soft-human.mjs` round-trips GLBs and writes
  `public/soft-human/` plus per-export provenance/hash JSON. Regenerate every
  named example after changing a source it lists, and never hand-edit those files.
  `npm run build:model` must include `soft-human.html` in the Vite inputs.

The page exports the current pose, clothing, pack and cap visibility, but no
procedural clips or equipment. Keep the model-app isolation: never import
`src/soft-human/` from game runtime. The offline bake owns game promotion.

### Soft-human validation

Run `node --test model/test/soft-human*.test.mjs`, then
`node model/node_modules/vite/bin/vite.js build model`, then the browser checks:
`node tools/check-soft-human.mjs` (motion modes, nudge recovery, shader compile,
four views, all outfits/packs and carried bags at both ages, compact layout),
`node tools/check-soft-human-activities.mjs` (all 20 actions × 2 ages × 4 timeline
samples, equipment visibility, timeline scrubbing), `node tools/check-soft-human-clearance.mjs`
(`--all` for every station timeline, `--seated` for sit/stand at 0.125 s,
`--escalators`), and `node tools/check-soft-arm-poses.mjs` (neutral/ticket/wash
elbows from front, oblique and back). Captures go under ignored
`.preview/soft-human/`. Tests pin catalogue completeness, deterministic scrubbing,
seat/foot support, basin/rail contact, lane containment, elbow posture, skin
weights, all wardrobe combinations, carried-bag anchoring and a posed GLB
round-trip. A failing activity assertion can be a real pose regression: the
free-arm lane check caught a hardcoded `narrow=0` that left the arm outside the
escalator.

## Sound studio

This skill also owns the isolated `/sounds.html` audition page at model port
5175: `src/sound-preview/`, `scripts/collect-sounds.py` and
`scripts/make-soft-sounds.py`. Source/author/license/download records and hashes
live in `public/sounds/manifest.json`; original procedural cues have a separate
`soft-manifest.json`. Preserve provenance when collecting or deriving sounds.

`src/sound-preview/effects.js` contains the selected six cues and their tuning;
the user removed candidate menus after selection. Keep the page focused on that
set unless new alternatives are requested. Place and felt selection have deliberate
level boosts, and delete uses a wooden/brush texture instead of the old mechanical
step-back click. Listening feedback supersedes uniform RMS targets. The studio's
full mixer is for audition; the game exposes only Sound effects and Ambient sound.

For sound-only changes, build both model entries without re-exporting characters:
`node model/node_modules/vite/bin/vite.js build model`. Run focused
`node --test model/test/sound-*.test.mjs` and `node tools/check-sound-preview.mjs`.
The browser check measures actual shaped-buffer levels, pitch, playback/mute,
cancellation, persistence and responsive layout. After approval, use
`node tools/prepare-game-audio.mjs` to bake the selected set for the game; route
game runtime edits through `metro-game`. This workflow does not require character
exports, passenger atlas regeneration or a model-art refresh.

Work from the metro root. Read `model/README.md` and
`game/src/assets/PASSENGERS.md`. For a new character reconstruction also use
`stylized-3d-character`. This skill owns the existing reviewed character pipeline.

## Historical 232-export library ownership and contracts

The following describes the retained legacy viewer/export tools. Use the
selected-base catalogue and bake above for the active game crowd. Do not run a
legacy baker against the active assets during ordinary model work.

- `model/src/characters/library.js` is the catalogue: original/short/bald male
  and bob/shoulder/long female templates, bagless/full/small backpacks, 75% and
  87.5% standard backpacks, and left/right shoulder, crossbody and purse variants.
  `hairstyles.js` defines ten styles per sex and their backpack compatibility.
  Viewer and bake share the complete catalogue (currently 232 entries).
  Explicit `adultEligible` / `childEligible` flags own the pools (currently 212 / 114):
  female crossbody templates are child-only, and bald models are never children.
  Approved small/crossbody bags can be child templates. Choose each eligible entry
  equally; do not select sex, hair and bag hierarchically or freeze catalogue counts.
  Stable identity chooses appearance without consuming simulation RNG.
- `female.js` builds both sexes; short/bald use the same smooth scalp with hair
  or skin colours. `shoulders.js` cleans neck, face, chest, coat and backpack.
  The seven added male hairs use `male-hair.js` to deform the original locks,
  retaining their head/neck weights and forehead join with lower crowns.
  Keep original/short/bald approved shapes intact. Added male styles vary lock
  relief, fringe, sweep and nape length; do not replace them with taller smooth
  caps. Source tests pin topology, attachments, individual crown limits and at
  least 1 cm maximum displacement between each pair of new styles. The baked
  game test independently requires all seven additions, with every bag, below
  1.70 m and at least 2 cm lower than the original standing crown.
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
- `outfit-presets.js` owns ten jacket-free clothing presets per sex. Forty
  appended bagless catalogue entries cover both grey arrangements using bob and
  original male hair; all enter both age pools. Preserve the original 192 IDs
  and ordering. Children apply their size transform after fitting. Random
  previews must retain the selected outfit/tones. `outfits.js` retains continuous
  source sleeves/lining and closes the hem; never cut away the moving underarm
  closure to clean a standing screenshot. `skirt-motion.js` exports 24 clearance
  morphs per gait with matching tracks. `export-clothing-variants.mjs` validates
  all three clips on GLB round trip. The baker samples actual clips with
  `getVertexPosition`, shares animated morph weights on detached simplifier
  parts and includes morph trajectories in vertex identity. Skeleton-only baking
  loses skirt clearance. Keep exact authored grey stops and original head/feet.
  `passenger-clothing` compares actual baked skirt points to current hashed GLBs
  with a static-shell negative control. Check both ages, intermediate angles,
  all walks and child size extremes. These clothing entries currently have no bags.
  The game-only exterior pass removes garment inner walls/caps, trims trouser
  waists under the top and omits covered thighs, so hidden GLB supports do not
  show through the shared 70% material. Never apply this trim to the closed
  downloadable GLB or remove the source sleeve/underarm closure. Pin actual
  baked outward skirt faces and absent hidden thighs, not only the trim helper.
  Pose buffers use lossless `frame-delta` packing before zlib; restore signed
  16-bit positions and 8-bit normals before GPU upload, retaining absolute legacy
  atlas compatibility. Keep the 100 MiB tracked-asset and 25 MiB shipped-file guards.
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
- `model/src/animation/interactions.js` owns deterministic, preview-only passenger
  activity poses. `interaction-equipment.js` adapts the existing game equipment
  builders into the model viewer; keep the preview isolated from station
  documents. `tools/bake-passenger-activities.mjs` consumes these poses offline
  for the game's shared bind geometry/bone palettes; runtime integration belongs
  to `metro-game` and must not import the model app. Activities use simplified empty
  hands and must not imply a held phone, ticket, drink or product. Fit contact to
  real seats, basins, gates, doors and escalator rails; check the whole arm and
  hand from side and overhead views for gaps, reversed direction, awkward wrist
  turns and geometry penetration. `interaction-arms.js` is a viewer-only overlay:
  restore the reviewed source geometry for walking and GLB downloads. Pin IK
  lengths, seat/foot support, deterministic scrubbing and escalator rail contact
  in `model/test/interactions.test.mjs`; run
  `node tools/check-model-interactions.mjs` for production scenes, timeline
  samples, rail clearance and visual captures. Keep pose and contact behavior in
  this skill and its tests. Put raw captures under ignored
  `.preview/model-interactions/`; add a result to the shared
  [performance reference](../metro-repo/references/performance.md) only when it
  establishes a reproducible performance finding.
  Solve limb contact in the rig frame before applying independent appearance
  dimensions: world quaternion decomposition under nonuniform scale introduces
  shear and misses the wrist. Retain seated front clearance during settle/release.
  `npm run bake:passengers` regenerates walking and activity assets together.
  For rig-only iterations `node tools/bake-passenger-activities.mjs --poses-only`
  verifies every current export hash, preserves activity geometry and updates
  the small height-fitted palettes. Full geometry/catalogue changes need the full
  bake. Keep original GLB walks intact; game skirts use the authored seated drape
  and all detail modes share the same activity rig data.
- `model/scripts/prepare-assets.mjs` generates ignored `model/public/models/` GLBs.
  Root prototype tools delegate to model code. Keep the original TRELLIS source;
  these locally reconstructed/authored models are not Quaternius CC0.
- `tools/bake-approved-passenger.mjs` consumes reviewed exports to generate
  `game/src/assets/passenger-approved.json`. Keep one padded instanced crowd draw,
  no per-agent GLB/skeleton. Deduplicate only complete animated vertices; preserve
  flat material boundaries, winding and all walk profiles. Wrap textures at 1024
  pixels and handle 16/32-bit indices. Never hand-edit generated GLBs/JSON.
  The atlas stores zlib-compressed base64 buffers. `render/passengerAtlas.ts`
  decodes them losslessly and retains support for legacy raw-base64 data.
  The bake also emits the crowd's Low LoD: `lowIndices`/`lowCorners`/`lowTriangles`
  and `library[].lowTriangles` are a second index table over the *same* animated
  vertex pool, with a hard 10% triangle budget per appearance. Offline faceted
  envelopes separate anatomical parts and palette regions; original faces retain
  extrema from all 73 poses. Envelopes reference existing animated vertices and
  are reduced without component pruning. Skirts retain their original cloth
  surface with motion-weighted simplification instead of a standing hull. This
  is a surface approximation, not
  a bounded-error version of the source surface. Results are padded per
  row to the widest one. It is not a second atlas: never duplicate the pose buffers,
  never re-simplify at runtime, and keep the full topology the authoritative record
  (`triangles`) beside the reduced one. For a Low-policy-only edit,
  `node tools/bake-approved-passenger.mjs --low-only` verifies every export hash
  and regenerates only Low fields from the current full atlas; stale exports
  require the full bake. The game's `passenger-lod` pins the table,
  the 低画质 switch and shared-atlas disposal; `node tools/model-triangle-inventory.mjs`
  regenerates the published passenger table.
  Carry age/side/bag metadata through exports and bake. Game `passengerEligibility`
  accepts older atlases without flags using historical pools; explicit flags always
  take precedence. A model edit must regenerate the actual atlas before validating
  new geometry/pools, not only update consumers/tests against an older export.

## Workflow and validation

1. Inspect references and current viewer, then edit the owning builder. Verify
   standing and all walks, front/back/side/oblique, across moving arm phases.
2. Run `npm run build:model`, `npm --prefix model test`,
   `node tools/check-model-preview-options.mjs` and `node tools/check-model-service.mjs`.
   Hair changes also use `node tools/check-model-hairstyles.mjs` for all catalogue
   exports in four views, all gaits, bilingual choices and age rules.
   For a sex-specific iteration, `node model/scripts/prepare-assets.mjs
   --character=male` (or `female`) refreshes its GLBs while retaining the full
   catalogue; the hair checker accepts the same filter. Bake the complete atlas
   after the scoped export and verify the actual game geometry.
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
