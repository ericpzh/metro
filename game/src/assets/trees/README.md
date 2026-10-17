# Street ash

Generated with `node tools/bake-street-tree.mjs` from the pinned dev dependency
`@dgreenheck/ez-tree` 1.1.0 (Daniel Greenheck, MIT). Ash Medium preset, fixed seed
36330, raised first branches for a street tree, normalized to 4.5 m. Generation
runs offline; the game only loads baked geometry and one shared leaf texture.
`ash-leaves.png` is copied from the package's `src/lib/assets/leaves/ash_color.png`.
The package license is preserved in `EZ-TREE-LICENSE.txt`.

The tree's two immutable geometries are shared. Its materials and texture belong
to the scene's material kit and are disposed with it. The solid trunk reserves
its existing placement envelope; the crown may overhang nearby equipment.

`street-ash-lod.json` is derived offline from that same bake by
`tools/bake-street-tree-lod.mjs` (also run by the main bake): 7 cm branch vertex
clusters and alternate intact crossed leaf cards, retaining canopy extrema and
leaf UVs. It has 1,035 branch and 4,812 leaf triangles versus 8,832 / 9,600 in the
original. The renderer uses it only when a tree is small on screen, with hysteresis;
the detailed source remains the picking model and supplies the chunk's bounds.

`street-ash-far.json` is a third representation from the same script: 24 cm
branch clusters (129 triangles), every eighth crossed leaf card plus all canopy
extrema (1,224 triangles). Retained cards expand uniformly up to 2×, constrained
to the original canopy bounds, to compensate for reduced coverage. UVs/normals
and the shared leaf texture remain intact. It enters below 18 CSS pixels, with
hysteresis; the 45-pixel middle LoD and full close model remain available.
