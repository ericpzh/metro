# Passenger B — local TRELLIS experiment

This experiment reconstructs the approved grey, faceless character from
`reference.png` using [trellis.cpp](https://github.com/pwilkin/trellis.cpp).
It does not use the rejected procedural mannequin as input. Generation is
local and does not require an account or API credits.

The pinned Windows CUDA runtime is v0.8.1. Runtime binaries and model weights
live under the ignored `.cache/trellis/`, separate from the shipped game.
The pretrained GGUF weights are from `ilintar/trellis2-gguf` on Hugging Face;
`tools/setup-trellis.mjs` verifies their sizes and SHA-256 hashes against the
published LFS metadata. Both the TRELLIS.2 model and trellis.cpp code are MIT
licensed; dependencies carry their own licenses.

After extracting the CUDA release into `.cache/trellis/runtime/`:

```powershell
node tools/setup-trellis.mjs
node tools/generate-trellis-passenger.mjs
node tools/preview-trellis-passenger.mjs --serve
```

The generation uses the real GPU, 1024 resolution, seed 42, 12 sampling steps
and a 2048 texture atlas. `generation.json` records the actual completed run.
Generation completed on the RTX 4080 SUPER in 75.9 seconds. Geometry validation
passed: one mesh, 274,040 triangles, finite vertex attributes. The raw texture
was excessively dark, so the review model uses uniform grey clothing panels.
`clean-materials.js` defines continuous hair, shoulder straps, backpack, skin,
and clothing regions in model space. Triangles crossing material boundaries
are split at those boundaries; each resulting triangle has a single color.
This restores the fringe and rear hair coverage, completes both straps, and
removes the speckled and blended clothing edges while preserving the overall character silhouette. A smooth U-shaped neckline replaces the flattened collar. Continuous smoothing around a rounded collar cross-section removes reconstructed tabs without creating hard deformation borders. Strap coverage continues across the shoulder ridge and rear connectors. The narrow rear extensions marked B are removed from the color layout. The reconstructed backpack panel is replaced by a continuous rounded panel, incorporating the corner attachments marked A in the same dark grey. Elevated front/back closeups are included in the preview capture.
The exported
`passenger-b-flat.glb` contains these vertex colors and unlit materials; it is
14,218,456 bytes with 324,720 triangles across two meshes. A GLTFLoader round-trip verifies finite
attributes, 1.72 m height, unlit material, and zero mixed-color triangles.
`passenger-b.glb` preserves the original reconstruction.
`passenger-b.glb` and `passenger-b-flat.glb` preserve the static reconstruction
and approved grey model. `passenger-b-walk-forward.glb` adds a 16-bone skeleton and a
looping 1.12-second `Walk` animation to the approved surface. The backpack stays
attached to the torso; blended shoulder, elbow, knee and ankle weights deform
the original body. The animated file is 19,890,000 bytes.

The preview starts walking in place. Pause/play controls stop and resume the
cycle while view selection and orbit controls remain available. The download
link now provides the animated GLB, including its skeleton and animation clip.
`walk-rig.js` creates the skin weights, bones, floor correction and clip.
`node tools/test-passenger-walk.mjs` verifies exported skin weights, finite
deformed geometry, unlit materials, loop closure and foot contact over nine
sampled poses, plus knee flexion direction and forward foot extension, advancing-knee lift, slight trailing-knee flexion, and the entire shoe staying ahead of the backpack midline and the trailing heel reaching that line at full rear stride. All checks pass; the lowest surface stays within 6 mm of the floor.
This remains a preview asset; game integration has not been changed.

Open http://127.0.0.1:4268/prototypes/trellis-passenger/index.html to compare
against the reference, rotate the model, switch cardinal views, or download
the animated grey unlit GLB. The preview uses continuous grey material regions
to match the approved flat appearance. The full screenshot set, including
five walking poses and elevated neckline closeups, is in `views/`.
