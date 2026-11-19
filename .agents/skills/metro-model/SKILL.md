---
name: metro-model
description: Work on the metro repository model/ character library, reviewed hair and bag variants, silhouette and strap cleanup, walking clips, GLB exports, the soft-human motion-study preview, and shared game crowd atlas. Use for model/ or tools/bake-soft-passengers.mjs changes. Route game renderer/simulation work through metro-game and test work through metro-game-test.
---

# Metro model library

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
The selected base's outward A-pose is baked into its bind geometry. Walking
retains that spread and its existing swing. Idle standing and **every station
activity** use the accepted escalator relaxed-arm stance for each unused hand:
a modest spread outside the torso, natural downward reach, and no lap placement.
In side view, the elbow sits behind the shoulder and the forearm angles forward
toward the hand. Preserve the accepted frontal elbow spacing and wrist location
when correcting that bend; never reverse the elbow into a forward bulge.
`relaxed-arms.js` owns this shared rig-frame pose for `character.js` idle and
`activities.js`. Active equipment hands blend out of it; zero-contact hands,
approach and release return to the same relaxed stance. Keep active screen,
reader, basin and door targets unchanged, and preserve hand-owned bag precedence.
The standing frame of the walking atlas also uses this idle pose: waits and
queues intentionally render that cheaper atlas path instead of the activity rig.
Keep all 72 walking frames unchanged, and pin both actual standing vertices and
baked activity palettes in `passenger-activity-assets`. Identify skin regions by
bone ownership: lowered hands are not thighs, and sleeve occlusion is not torso
strap penetration. The relaxed arms may intersect equipment; retain those scans
as diagnostics without reshaping the accepted stance.
The escalator holding arm keeps its comfortable bend and lifts forward 30 degrees
at the shoulder in side view. Preserve its sideways spacing, elbow bend and torso;
apply this rigid shoulder pitch before independent appearance scaling.
**Natural posture comes before escalator geometry.** Never twist the chest or
pull an elbow across the body to reach a belt. Do not squeeze arms into the
torso, drop the free hand against the knee, compress body width, or change the
default stance to clear the equipment. Rail penetration and imperfect hand
contact are explicitly allowed. The escalator arm pose depends on the rig and
chosen hand, not belt position. Active hands in other actions keep their existing contact rules.
`check-soft-escalator-pose.mjs` pins natural arm placement and zero chest turn for
both ages/hands throughout the ride. Escalator collision scans retain diagnostic
reports but must not reject this pose or drive corrective contortions.
`activities.js` accepts `anchors.hand` (`default`, `right`, `left`). A hand-owned
purse/handbag reserves its carrying hand when no explicit bake mode is supplied.
Screen and handle targets stay fixed between hand modes. On escalators, either
chosen hand uses the comfortable reach on its own side, even when the belt is
opposite; never twist across the chest to touch it. A held bag allows only the
free hand to wash. The game bake stores all three hand modes per height fit.
Pin target identity and natural arms in `soft-human-handedness`, and the actual
GPU palettes in `passenger-activity-assets`.
For non-escalator equipment, reach clearance uses joint lengths in the IK rig frame, including independent
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
  free arms in the shared relaxed stance for all station actions. Walking alone
  retains its outward bind spread. Escalator contact and resting-arm clearance
  are subordinate to natural posture; do not turn the chest toward a rail. The legacy procedural fixture retains its older tucking
  behavior for other narrow equipment. Seat, basin, rail, door-threshold
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
legacy procedural free-arm lane check caught a hardcoded `narrow=0`. That
historical lane constraint does not apply to the selected escalator pose: use
the natural-posture rule above, even when collision scans report overlap.

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
