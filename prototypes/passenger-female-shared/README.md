# Female variant of the approved commuter

Uses the actual approved `../trellis-passenger/passenger-b-walk-forward.glb`.
Hands, legs, neck and rig are shared with the approved body. Thin reconstructed
waist overhangs are folded into an oval trouser surface to remove loose pieces
between the hands and thighs. Other body positions are retained. The no-backpack
version also folds rear strap and coat ridges
into one continuous back profile with a rounded shoulder and gently flared hem;
its surface normals are recomputed. Backpack and no-backpack
versions share this body and rig.
The inherited rig accidentally assigned some upper trouser vertices to arm/hand
bones, including Forearm bones (the original case-sensitive mask missed these).
Only those weights are corrected to the neighbouring leg blend, removing
the hanging flap and the broken thigh outline when arms swing. Other weights and
joint assignments are retained. The previous separate female reconstruction is preserved
in its own prototype folder and is not used here.

`variant.js` welds the semantic trouser surface across duplicate vertices and
deletes disconnected waist ribbons and loose chips that do not reach the lower
legs. Both genuine trouser shells remain intact. This removes the hanging loops
beside the hands in front and back views rather than only moving them inward.
It also removes the old hair triangles and adds a closed rounded hair
shell weighted to Head. Both versions offer short bob and shoulder-length hair;
only the version without a backpack offers long hair. Selecting long hair removes
the bag, and adding a bag switches long hair to shoulder length. Shoulder-length
hair has a closer-fitting crown and rear profile and ends above the bag. The front
crown fits the actual forward projection of the shared forehead, with an overlapping
fringe to close the visible seam. Long hair has a slimmer crown, widens gently
around the shoulder to cover the old strap bump, and stops its forward locks above
the sleeves. Only the rear curtain continues down the back, avoiding loose hair
triangles showing below swinging arms. `tools/preview-shared-passenger-detail.mjs`
captures front/side/back/oblique closeups and paused walk poses for this detail.
The temple and side flare follow physical height, keeping the crown-to-side
silhouette smooth despite different lengths around the face. The detail tool also
captures the hand/leg gap in all five hair/bag variants at three walk phases.
The no-bag version removes strap colours and
closes the coat's missing rear surface with a shallow rounded panel, reusing the
bag panel's topology and torso weights. Clothing retains the approved crisp panel boundaries,
with a light cardigan, darker top and dark trousers. The faceless grey style stays.
All three walk clips use the accepted game cadence and foot-targeted gait.

```powershell
node tools/preview-female-passenger.mjs --shared
node tools/test-shared-passenger-variant.mjs
node tools/test-shared-passenger-variant.mjs --style=shoulder
node tools/test-shared-passenger-variant.mjs --style=long
node tools/test-shared-passenger-variant.mjs --no-bag
node tools/test-shared-passenger-variant.mjs --style=shoulder --no-bag
```

The first command uses the existing port 4268 server, captures views and exports
`passenger-female-flat.glb`, `passenger-female-walk.glb` (short bob),
`passenger-female-shoulder-walk.glb` and three
`passenger-female-no-bag-{bob,shoulder,long}-walk.glb` files. The old long-hair
backpack export is superseded and is not offered by the preview.
The selected style's download link updates in the preview. Validation round-trips
the animated file and compares body geometry directly with the approved male,
checks that only the affected trouser weights change, then checks clean colours,
hair binding and grounded stance without foot sliding.
Forehead ray tests check that the fringe covers the source skin across its centre
and both sides. Every style retains the same body, corrected trouser weights and
three walk clips; changing hair or backpack does not reset the walking pose.
`validation.json` records the approved source hash and actual checks.
`tools/export-shared-passenger-variants.mjs` also regenerates all five GLBs directly
in Node from the same variant builder and walk profiles; the screenshot tool calls
it after its browser checks, avoiding slow binary transfers through browser debugging.

Preview: http://127.0.0.1:4268/prototypes/passenger-female-shared/index.html
The live game continues to use its approved male asset until this variant is reviewed.
