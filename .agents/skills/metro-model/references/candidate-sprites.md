# Candidate walking sprites

The user wants the approved faceless grayscale illustration, clothed human
proportions, clean outlines and clearly separated body parts. Play pre-rendered
frames in the game; keep source assets and generation experiments in `model/`
until reviewed. The current candidate prototype covers VALID woman 3 only, four
horizontal views and two additional elevations at 45 degrees. It is not a full
16-direction or multi-character library.

## Build a coherent animation

1. Start with a reviewed character and its recorded source, license and static
   style reference. Capture the same motion phase and camera framing for every
   direction and elevation. `tools/capture-candidate-walk-guide.mjs` captures
   pose guides; Quaternius motion is an offline reference, not a game runtime.
2. Prefer a temporally aware image-to-video/motion-transfer workflow or an authored
   2D animation that maintains one character's proportions throughout the loop.
   Use pose guides as motion conditioning and the approved illustration as the
   identity/style reference. A grid of independently generated figures can drift
   in body shape, pose order and scale even when the prompt asks for consistency.
   Do not interleave separately generated grids and call them true in-betweens.
3. Sample at least 32 frames per cycle with a shared duration and phase across
   views; the current 32/30-second loop is 30 fps. Make the last-to-first
   transition part of the generation or interpolation. Keep every sprite cell
   transparent, consistently framed and grounded, and retain the source material,
   prompt, tool/model versions, licenses and hashes beside outputs.
4. Choose both azimuth and camera elevation from the camera-to-character direction;
   preserve the walk phase during a switch. Use enough pitch samples to represent
   foreshortening and hysteresis at selection boundaries. Do not crossfade unrelated
   figures: it can create double limbs. Keep world size and anchoring consistent
   across views; a foreshortened top view can have a shorter projected silhouette.

## Review and limitations

Inspect the actual playing loop and contact sheets, not just a few static poses.
Check front, back, side, oblique and relevant elevations, multiple walk phases,
the loop seam and angle switches. Compare head, torso, pelvis, thigh and shin
lengths, shoe size and ground contact; watch for changes in clothing, body size,
silhouette, limb identity and interpolation artifacts. Pixel hashes, matching
frame counts, a stable lowest foot, and average pixel differences cannot prove
anatomical consistency or natural movement. Record what was visually reviewed and
any remaining deficiencies rather than calling a prototype production-ready.

For walking, check each arm against the opposite leg over the whole cycle in
both front and back views. Arm and leg swings must repeat at the same cadence;
inspect both extremes and transitions, not just whether adjacent frames change.
In the current experiment, independently regenerating the front and back sheets
with an instruction to alternate arms did not reliably preserve that timing.
Do not ship those sheets as a correction without pose-by-pose verification.
A previous front-view experiment composited back-view arms into front poses.
It was rejected because the mismatched sleeves caused detached arms and ghost
outlines. The preview uses the intact original front artwork again, whose arm
swing remains too small; a coherent replacement animation is still needed.

The current `tools/capture-candidate-sprite-frames.mjs` registers source images,
uses estimated shirt boundaries and rescales the projected lower body. This is a
temporary image-space repair for the current generated sheets: it can stretch
legs, hide real perspective motion or be confused by an arm crossing the shirt.
It cannot guarantee individual leg lengths or correct anatomy. The RIFE step in
`tools/interpolate-candidate-sprites.mjs` adds transitional frames, but cannot
repair inconsistent source poses; inspect feet and hands for ghosts or warping.
The source sheets are processing inputs, not lower-frame playback options.

Build with `node model/node_modules/vite/bin/vite.js build model`; run
`node tools/check-candidate-sprite-study.mjs` for 32-frame playback, phase and
sampled continuity/scale checks. Captures go in ignored
`.preview/human-candidates/sprite-study/`. The checker is not a substitute for
watching the loop or checking both legs. RIFE reproduction and hashes are in
`public/human-candidates/animation-studies/valid-Asian_F_3_Casual-rife32.json`;
the local RIFE executable and weights are not bundled with game assets.
