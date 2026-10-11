# Clothed passenger meshes and animation

Author: **Quaternius**. Source models are dedicated under **CC0-1.0**:

- [Ultimate Modular Men](https://quaternius.com/packs/ultimatemodularcharacters.html): `Casual_2.gltf`, `Casual_Hoodie.gltf`, `Suit.gltf`.
- [Ultimate Modular Women](https://quaternius.com/packs/ultimatemodularwomen.html): `Casual.gltf`.
- [CC0 legal text](https://creativecommons.org/publicdomain/zero/1.0/).

Retrieved 2026-10-11. The author's Google Drive downloads were quota-limited,
so the unmodified glTF files were retrieved from the public
[FreeModels mirror](https://github.com/agentkaerf/FreeModels), under the matching
`Individual Characters/glTF` directories. Mirror tree revision: `db3df04d1e4714298a09510b26fb6de6645138a2`.

Source files include their own rigged
`Idle_Neutral` and `Walk` clips. No separate animation library is required.

`passenger-human.json` contains four texture-free clothed silhouettes: shirt,
hoodie, suit, and a casual women's outfit. Each has one relaxed standing pose
and 24 walking poses. Models are reduced to about 1,200 triangles with smooth
matte grey shading and a 1.73 m base height. The suit's optional pistol node is omitted. No detailed facial textures remain.
Positions are quantized to 1/4096 m and normals to signed bytes. Supporting feet
are grounded in every pose.

The crowd uses one instanced draw with a per-instance outfit attribute. A small
index texture maps shared triangle corners to each outfit's own topology; this
keeps the pose atlas compact (732 vertices per row, 100 rows). Degenerate padding
fills shorter outfits. Walking advances by distance travelled and settles to idle
when waiting. Pausing freezes the displayed stride and position until play resumes,
including worker control snapshots that repeat the same simulation state. A stable hash of passenger id chooses outfit, height, build and grey
wash; reordering or compacting worker buffers never changes appearance. Eye-view
height follows that passenger's height scale.

To regenerate, download the four source glTF files into one folder and rename
them `shirt.gltf`, `hoodie.gltf`, `suit.gltf`, `casual-woman.gltf`, then run:

```powershell
node tools/bake-passengers.mjs '<source folder>'
```

The offline tool uses the game's installed Three.js GLTFLoader and
meshoptimizer 1.1.1 (MIT, installed by the locked Vite toolchain). Source archives,
an asset service and per-passenger skeletons are unnecessary at runtime. The
locally bundled derived asset is approximately 918 kB before gzip.

Source glTF SHA-256 hashes:

- `shirt.gltf`: `55c654d09a2a5ff6e3bd6158d4a1b462f181cd6f1e12a0f5e9d959f9c3abc438`
- `hoodie.gltf`: `dd74886c26998a0fa888b4ce557a0932d7d97b0265dd4c763154d081b7a6cb98`
- `suit.gltf`: `6c89fbb31b96c1a63ad94e3dee0942bd7b34bc789a5d39fd6a6a1738a9214fb3`
- `casual-woman.gltf`: `b0fe6e92219cd71808844a20a1a8b960fd1cf640a6546dc6362b5add6604e87c`
