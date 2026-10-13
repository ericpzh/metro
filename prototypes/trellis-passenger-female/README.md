# Female commuter — grey faceless model

Built using the personal `stylized-3d-character` skill at
`C:/Users/ericp/.codex/skills/stylized-3d-character/SKILL.md`.

The built-in imagegen tool created `reference.png` using the accepted male drawing
as an art-style reference. [The exact prompt](reference-prompt.txt) records the
brief: a faceless young adult woman, short bob, grey jacket, pale shirt, dark
trousers, flat shoes and backpack. This is a new reconstruction, not a reskin of
the male body. TRELLIS/trellis.cpp v0.8.1 generated real geometry locally on the
RTX 4080 SUPER. `generation.json` records settings and the reference SHA-256.

## Outputs

- `passenger-female.glb`: preserved raw textured reconstruction.
- `passenger-female-flat.glb`: cleaned grey unlit static model.
- `passenger-female-walk.glb`: cleaned 16-bone model with Walk_Slow, Walk_Medium
  and Walk_Fast clips. Each full left/right cycle takes 1.12 seconds.
- `validation.json`: actual exported-model checks.
- `views/`: front, side, back, oblique and sampled walking screenshots.

The model is 1.65 m high in its standing pose. Cleanup uses continuous semantic
colour boundaries, a U-shaped neckline, bob coverage around the head, complete
straps and a single coherent backpack panel. Clothes and skin use the same seven
flat grey tones as the accepted male. The reconstruction remains high detail for
review; the live game still uses its approved male crowd atlas.

## Reproduce and review

The working TRELLIS runtime/verified weights are in ignored `.cache/trellis`.
Generation does not require a service account or API credits. The raster reference
was produced by the built-in imagegen tool. Tool/runtime licensing is separate
from generated-character provenance; this asset is not labelled CC0.

```powershell
node tools/generate-trellis-passenger.mjs --variant female
node tools/preview-female-passenger.mjs
node tools/test-female-passenger.mjs
```

The latter two commands require the existing root static server on port 4268.
The preview/export uses the approved shared skeleton with female hair weighting,
then authors foot-targeted IK clips. Full stride increases from slow through fast
without increasing playback cadence. The model root scales both body and stride
from the skeleton's 1.72 m coordinate system to the finished 1.65 m height.

Open http://127.0.0.1:4268/prototypes/trellis-passenger-female/index.html to orbit,
switch views, pause walking, choose its speed profile or download the animated GLB.
Round-trip checks cover finite attributes, normalized weights, clean triangle
colours, grounded stance soles, less than 1 cm planted-foot sliding and loop closure.

## Reviewed cleanup

Trouser vertices follow leg bones even where the wide thigh overlaps the arm
region. Cross sections straighten the reconstructed thigh contours; the upper
leg stays rigid down to the knee blend. Small closed ankle bridges blend between
shin and foot to cover the cuff opening without enlarging the shoes.

Raised collar geometry is lowered onto the shoulder slope while preserving the
curved neckline. Original hands, thumbs, fingers and wrist fragments are removed
and replaced with two closed fingerless palms. Each backpack strap is a continuous
constant-width ribbon over the shoulder, with a matching dark surface band under
it to avoid pale patches from sleeve curvature. Hair and the original body are kept.

Export checks verify no arm weights on trousers, no original hand fragments,
constant strap width, correct hand/strap bones and all three grounded walk loops.
`views/neck-front.png`, `views/neck-side.png`, `views/neck-back.png` and
`views/hands-side.png` show the close-up review.
