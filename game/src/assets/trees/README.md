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
