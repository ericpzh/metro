# B — Soft minimal passenger

An independent 3D prototype based on the approved grey, faceless concept B.
It is authored from scratch and has not been integrated into the crowd renderer.

`passenger-b.glb` is the model: glTF 2.0, metres, Y up, +Z forward, about 1.72 m
tall. It includes grey unlit materials, named clothing/head/backpack meshes,
an articulated node hierarchy and a `Walk` animation. The blank head has no
facial geometry or textures. Hair, clothing and hands are deliberately simple.
This prototype prioritises reviewing the silhouette; crowd batching and
production mesh optimisation come after art approval.

From the repository root:

```powershell
node tools/build-soft-passenger.mjs
node tools/preview-soft-passenger.mjs --serve
```

Open http://127.0.0.1:4267/prototypes/soft-passenger/index.html to rotate and zoom,
switch front/three-quarter/side/back views, or try the walking pose. The viewer
uses the repository's installed Three.js and loads the exported GLB itself.
The preview tool also verifies finite geometry, unlit materials and movement
in the exported walk clip, and saves review screenshots in `views/`.
