# City styles: contracts and verification

Saves write top-level `city`. Load accepts earlier `cityStyle` saves; missing or
invalid identity defaults to Guangzhou. `StationState.cityStyle` is the normalized
internal field. Both shipped demo JSON documents explicitly set `city: guangzhou`.
Never recolour existing lines when changing city; only new-line defaults change.

## Model and rendering ownership

`sim/cityStyles.ts` owns the Guangzhou (default) and Shenzhen visual identities and
line palettes. `StationData.cityStyle` is optional on old v1 saves; `StationState`
normalizes it. The top-bar `CityStyleSelect` commits one undoable presentation edit.
Every existing line colour survives; city palettes apply only to newly created lines. Pass city style to every new-line factory, including the
first rail and platform preview. `render/cityBranding.ts` owns shared logo artwork
and repaints the scene-owned cab texture in place, retaining live/prepared trains.
Covered Shenzhen exits use `ShenzhenExitCanopy.ts` for their curved charcoal shell,
soffit, plinths, glazing and right-hand Metro sign. Covered roots carry `exitCityStyle`;
`ModuleSystem.repaintPresentation` must rebuild them on a city change rather
than retaining the old shell through an artwork-only repaint. Their footprint,
landing and walking opening remain shared with Guangzhou. The forward-facing right
Metro sign may project outside that footprint as decoration; never widen sim
collision for it. Glazing clears plinth/gasket/post volumes, intermediate mullions
start at the plinth, and the side plinth ends at the front jamb.
Shenzhen virtual exits and guideposts share `ShenzhenGuidepost.ts`: a grey pylon,
vertical labels and an open green crown. `guideCityStyle` marks roots that must
rebuild on a city switch; virtual exits must participate in presentation invalidation.
Line maps select the supplied poster by city through `lineMapCity.ts` and
`lineMapArt.ts`. Keep decoded textures/materials separate per city, include city
in PlateSystem map-cache keys, and replace map roots when city changes.
Exit and guidepost artwork binds the city; Shenzhen entrance badges also invalidate
on line colour edits. Keep city changes on `populationEdit`, preserving chunks,
walk topology and transient preview state. `city-style` owns deterministic coverage;
`node tools/check-city-styles.mjs` checks the production selector and saved reload.


## Menus and cached previews

The city button sits beside Demo Stations and opens a native popover. Keep square
84 px tiles, at most four columns, content-sized width and multiple rows. Scope
Blueprint / Night (`site`) / Studio styling to their existing theme selectors.
Measure the actual popover width when positioning it; inherited demo-menu width
must not override content sizing. Label and focus the native controls accessibly.

LHS thumbnails are checked-in 132 px PNGs, never startup WebGL captures.
`moduleThumbnailAssets.ts` selects Shenzhen assets for exits, guideposts and both
line-map variants. `TileGrid` and `VariantMenu` subscribe to the saved city.
`moduleThumbnails.ts` uses a synthetic station for city fixtures, separate from
committed documents; bind its pylon to a sample C exit without editing user data.
Generate with build → `node tools/render-menu-thumbnails.mjs` → build. Keep the
base index consistent and inspect diffs so unrelated capture noise is not included.

## Deterministic coverage ownership

| Contract | Owning suite |
| --- | --- |
| Wire city field, legacy/invalid fallback, demo city, undo/redo, unchanged existing colours and city-aware first/new lines | `city-style` |
| City palettes including Shenzhen 6B and supplied planned-line colours; cab texture identity and no-op uploads | `city-style` |
| Navy entrance artwork, bilingual labels, badge recolouring and covered/pylon shell invalidation | `city-style`, `nonstructural-updates` |
| City-specific High/Low budgets, geometry restoration and batching | `model-detail` |
| Covered bay counts × four rotations, roof profile, single outward front-facing right sign, disjoint glass/post/plinth volumes | `module-build` |
| Virtual exit and guidepost grey pylon, green crown, bound labels and all rotations | `module-build` |
| Guangzhou/Shenzhen poster routing, retained map cache, city change/undo, wall and standing mounts | `line-map` |
| Complete static PNG catalogue, city asset differences/dimensions and reactive parent/variant tiles | `menu-thumbnails` |

Run these focused suites when changing their contracts, plus typecheck/build and
the full game suite before completion. `model-detail` checks actual city-specific
High/Low counts, geometry restoration and batching against shared model budgets.
Update the model triangle inventory when geometry changes.

`tools/check-city-styles.mjs` exercises production city selection, retained train
and bench resources, zero chunk remeshes/raycasts, population patches, live badges,
undo/redo, autosave reload, bilingual labels and 1024 px menu fit. It does not
replace visual review of each theme, Low geometry, or a GPU-completion benchmark.
The supplied posters and model previews must be visually reviewed in the real
renderer. Hardware timings belong only in the repo skill's shared performance
reference, with source/build hash, workload, sample count and capture path.
