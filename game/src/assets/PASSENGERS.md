# Game passenger library

The active crowd uses the user-selected soft-human base, replacing the older
232-export catalogue. `npm run bake:passengers` runs
`tools/bake-soft-passengers.mjs` and generates both `passenger-approved.json`
and `passenger-activities.json`. Never edit the generated assets by hand.

`model/src/soft-human/catalog.js` derives 440 recipes from the preview wardrobe:
twenty outfits per male/female category × eleven bag choices. Both ages can use
every recipe. The added combinations mix the reviewed casual cuts and palettes,
with a slate suit and two more female skirt palettes. The female category includes the pink trail jacket, T-shirt
skirt and blouse/midi skirt. Summer stripes, sport shorts and casual shirt are
male-only. Shared outfits reuse the same body and geometry.

The base is `model/public/human-candidates/human-fall-flat/HumanBody_Alt.fbx`,
normalized to 1.7 m with its smooth skin, authored weights and outward A-pose.
Its supplied readme describes a game extract and supplies no redistribution
license. The generated assets retain that provenance, the FBX SHA-256 and hashes
of every recipe/geometry/motion input. Do not attribute it as an original
procedural or CC0 model. Legacy exports and their tools remain historical assets.

The offline bake uses the exact preview constructors. Color cuts retain source
smooth normals, and sole vertices are locked during simplification. Material regions preserve
90 authored RGB colors. Simplification preserves weights and color boundaries;
standing plus 24 frames for each of the three gaits are losslessly delta-packed.
218,396 shared animated vertices serve all 440 recipes. Full topology pads to
8,101 triangles, Low to 791; each recipe's Low topology stays below 10% of its full
triangles and retains pose extrema. MeshBasicMaterial uses the baked smooth
normals for a small fixed light term, retaining the rounded white head against
pale station surfaces. High and Low people are fully opaque (opacity 1, transparent false), with depth
testing and depth writes enabled. Road traffic retains its own alpha policy.

Activity geometry shares the same bind vertices. One 16-bone rig supplies 24
samples at eight size fits for every station action and the three walks. The
asset records bone names, Hips index 15 and arm indices 9–14; never reuse the old
rig's root/arm assumptions. GPU skinning and pose tables keep one instanced draw
per visible LOD, with no live skeleton or per-passenger mixer. Every unused
station-activity arm shares the accepted relaxed stance, with a modest spread
outside the torso. The elbow sits back and forearm angles forward in side view,
preserving the frontal spacing and wrist position. The standing atlas frame uses this same idle pose, so waits,
queues and transported passengers keep it without extra GPU skinning. All 72
walking frames retain their original outward arm swing. Escalator upper arms stay on their own side
and the bent holding arm pitches forward 30 degrees at the shoulder, preserving
its front-view sideways spacing and elbow bend without chest twisting. Natural
posture takes priority over belt contact and clearance; equipment overlap is allowed.

Skirts retain the original waist, hips and outer legs. Only the central
inner-thigh/crotch patch below 0.50 m is replaced with smooth front/back bridges,
with a connection across the remaining gap at the hem. Clothing colors live on
the same skin like trousers: no second waist surface, bulging rim or enlarged
shell. Boundary points are shared with the source cuts, including weights and
smooth normals. Walking and seating use ordinary leg skinning; the old analytic
shell drape is removed from the game shader. The game bake preserves these
normals across material regions and must not strip the integrated lower body.
Straps stay constant-width mathematical ribbons with exact bag anchors and
Chest ownership; do not introduce per-frame surface fitting.

Stable identity still chooses appearance independently of simulation RNG, size
and gait, with 20% children. Existing three-axis size variation and 98% visual
scale match trains. Distance drives gait; waiting/transported riders settle; pause freezes
motion; picking and first-person view follow identity and displayed size. The
selected short-legged pelvis can rise to meet an adult seat. The camera follows
its actual Hips offset and restores on standing.

Stair traversal uses 3D slope distance for walking at both LODs. The simulation
keeps its capacity-controlled Riding state and emits StairWalking in the render
stream. Escalator riders of both ages use the lane/direction handrail pose through
the actual ride countdown. A hand-carried bag reserves its hand; only the other
hand interacts. The chosen escalator arm keeps its natural reach on its own
side, even when the nearby belt is opposite. Belt position never twists the
chest, crosses an elbow over the torso or changes the default stance.
Escalators, moving walkways and lifts keep planted feet. Escalator free arms
hang naturally beside the body, as do unused moving-walkway and lift arms.

Action hands vary deterministically by passenger/action without using journey
RNG. Activity asset version 3 stores default/right/left palettes per height fit.
The fourth instance activity channel packs `profile + 3 * handMode`; walking
reads the profile modulo 3. The six-float worker transfer and one draw per LOD
remain unchanged. Screen and handle positions are shared between hand modes;
one-handed washing leaves the carrying arm in its default pose.

Validation: `node --test game/test/passenger-*.test.mjs`, model soft-human tests,
`npm --prefix game run build`, and `tools/check-game-passenger-library.mjs` for
all appearances/both ages plus a Zoo crowd. `tools/check-game-passenger-activities.mjs`
checks station-action shaders and full/Low captures. `tools/check-passenger-lod.mjs`
compares projected High/Low silhouettes. Browser captures are ignored under
`.preview/`; functional evidence is separate from performance measurements.
`tools/check-game-ramp-animation.mjs` checks real World transfers in the game
renderer for stair walking, escalator rail poses, both ages and both LODs.
`tools/check-game-passenger-handedness.mjs` compares actual GPU pixels for both
hand requests and verifies carrying-hand precedence at both ages/details.

The full and Low index tables widen before exceeding 8,192 texture rows, and the
shader program key includes the recipe hash. See the passenger section of
`.agents/skills/metro-repo/references/performance.md` for measured texture storage
and production playback; `tools/measure-passenger-assets.mjs` records exact buffer
sizes and build fingerprints. Low reduces submitted triangles, sharing pose data.
