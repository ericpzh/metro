# City styles: contracts and verification

Saves write top-level `city`. Load accepts earlier `cityStyle` saves; missing or
invalid identity defaults to Guangzhou. `StationState.cityStyle` is the normalized
internal field. Both shipped demo JSON documents explicitly set `city: guangzhou`.
Never recolour existing lines when changing city; only new-line defaults change.
Beijing and Shanghai defaults use the user's supplied hex tables, including
planned numbered lines, named branches, airport lines and trams. Preserve both
existing English identifiers and the supplied full Chinese line names for named
defaults. `city-style` pins every table entry through the new-line factory and
checks saved custom colours across city switches and reloads.

## Model and rendering ownership

`sim/cityStyles.ts` owns the Guangzhou (default), Shenzhen, Shanghai, Beijing and Chengdu visual identities and
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
`lineMapArt.ts`. `cityLineMapCache.ts` decodes only requested cities, coalesces
pending requests and suppresses callbacks after disposal. Keep decoded textures/materials separate per city, include city
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
`moduleThumbnailAssets.ts` selects each city's assets for exits, guideposts and both
line-map variants. `TileGrid` and `VariantMenu` subscribe to the saved city.
`moduleThumbnails.ts` uses a synthetic station for city fixtures, separate from
committed documents; bind its pylon to a sample C exit without editing user data.
Generate with build → `node tools/render-menu-thumbnails.mjs` → build. Keep the
base index consistent and inspect diffs so unrelated capture noise is not included.

## Deterministic coverage ownership

| Contract | Owning suite |
| --- | --- |
| Wire city field, legacy/invalid fallback, demo city, undo/redo, unchanged existing colours and city-aware first/new lines | `city-style` |
| City palettes including Shenzhen 6B and supplied planned-line colours; separate Beijing station/cab marks, cab texture identity and no-op uploads | `city-style` |
| Navy entrance artwork, bilingual labels, badge recolouring and covered/pylon shell invalidation | `city-style`, `nonstructural-updates` |
| City-specific High/Low budgets, geometry restoration and batching | `model-detail` |
| Covered bay counts × four rotations, roof profile, single outward front-facing right sign, disjoint glass/post/plinth volumes | `module-build` |
| Virtual exit and guidepost grey pylon, green crown, bound labels and all rotations | `module-build` |
| All supplied poster routing, selected-city decode/coalescing/disposal/retry, retained map cache, city change/undo, wall and standing mounts | `line-map` |
| Beijing diamond cut-outs at High/Low, all bays/rotations, three synchronized signs, blue guidepost and virtual exit labels | `module-build` |
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

## Shanghai

Shanghai uses `ShanghaiExitHeader.ts`, `ShanghaiExitCanopy.ts` and
`ShanghaiGuidepost.ts`. New exits receive numeric identifiers; preserve existing
names on city switch. The shared logo drawer renders the supplied red mark for
train cabs, UI and signage. Lantern pylons replace both virtual exits and guideposts.
The supplied portrait `shanghai-map.png` is fitted whole and its frame follows the
portrait artwork width; do not crop the legend or stretch it to a square. Collision
and wall support remain conservative on the shared panel footprint. Generate all
city-specific PNGs for exits, guideposts and maps; palettes apply only to new lines.

## Beijing

Beijing uses `BeijingExitHeader.ts`, `BeijingExitCanopy.ts` and
`BeijingGuidepost.ts`. The station/UI logo is the blue DC roundel; the train nose
instead prints the white calligraphic 北京 contours in `beijingTrainMark.ts`, traced
from the supplied P7 reference. Never replace that lettering with the station mark
or an installed font. Repaint the shared train texture in place as for other cities.
The train texture is a three-slot atlas: standard city emblems use the first slot,
Beijing uses the second and Chengdu uses the third. `trainMarkAtlas.ts` assigns each decal's UVs once.
Beijing's decal is 1.5× the original size, centred on the headlight lenses (including
C's lower lamps and D's curved light strips). All three slots remain in prepared cab
geometry; switching city only repaints the retained atlas.
Empty atlas pixels must discard before depth writes (`trainMark.alphaTest` keeps
the lettering's antialiased edge). Otherwise the unused overlapping decal clips
the active lettering. The production Beijing checker compares actual glyph pixels
at front/oblique views in High and Low against a zero-cutoff negative control.

The covered entrance has a stainless flat canopy and actual diamond holes in the
metal side panels with inset glass. High and Low must both keep those openings.
The doorway and front/side roof-top signs share one retained material/texture,
so station names, English names and actual line colours update together in one
upload. Roof signs are decorative and do not alter simulation placement/collision.
Guideposts and virtual exits share the blue pylon, drum-shaped roundel, upright
Chinese, rotated English, exit letter and live line badges. The supplied
`beijing-map.png` is fitted whole without cropping or stretching. Keep its large
decode deferred until Beijing is selected, and refresh only current-city map roots
when it completes. `tools/check-beijing-style.mjs` exercises selection, lazy map
loading, shared retained sign repainting, distinct cab artwork, undo/redo and reload;
it also captures both High and Low for visual review.

## Chengdu

Chengdu is the fifth city. `chengduBranding.ts` draws separate vector contours
from the supplied P1 (train/UI, METRO) and P6 (exit, METRO 成都地铁) references.
`tools/trace-chengdu-branding.py` reproduces the contours from those two images;
the contour asset retains each source hash. Exit plates and the blue pillar logo
box print the P6 lockup in white. `ChengduExitHeader.ts` lays out bilingual live
station names, actual line-colour badges and an alphabetic exit identifier on
charcoal. The fascia stands forward of both inclined front columns; keep the
complete printed face clear at every bay count/rotation in High and Low.
`ChengduGuidepost.ts` uses equilateral sections with 60-degree corners, through
the shared prism builder in `GuidepostGeometry.ts`. The shaft has 0.30 m sides;
the foot is 1.14× that profile. The blue middle has the shaft's exact same profile
rotated 30 degrees about its centroid, with
labels on all three faces. Black sections stop at the blue middle; its exposed
caps remain in High and Low, including virtual exits.
Both decor guideposts and virtual exits use it. `ChengduExitCanopy.ts` owns
the silver curved shell, green side edges/sills, glazing and inclined portal legs.
Silver roof and soffit stop inside the green trim, with no overlapping end-cap
volumes. The dark edge detail also clears the green skin.
Side stone bases, green sills and the final glass panels are clipped against the
actual inclined rear faces of the front columns, with a 4 mm joint gap. Columns
have horizontal feet at the entrance floor. The sill starts above the stone base;
it must not overlap it. Keep the fitted column/band volumes at Low, and share the
same coarse roof profile with Low glazing and posts so they remain connected.
`module-build` derives planes from the actual column normals and checks every
fitted vertex at all bay counts/rotations and both detail levels. The production
checker also captures close low-angle joints from both sides.
Keep these decorative changes within shared exit placement and walking rules.

Pillar names share a top edge, with vertical English on the right of Chinese.
Line badges share the bilingual station-name group's vertical centre. Chengdu
entrance artwork draws vector paths and text at 4× native pixel resolution
(covered fascia: 2048 × 384), capped at 4096 px width for wide doorway panels.
Repaints retain this resolution; `exitHeaderScale` replaces an allocation only
when the city's resolution policy changes, including doorway/uncovered models.

Chengdu train cabs retain their own lower decal in the third 128 px slot of the
384 × 150 atlas. A/B/C/L place the visible logo inside the lower line-colour strip;
D drapes it onto the centre of its coloured livery ring with outward-facing
triangles. Other city decal positions remain unchanged. All slots coexist in
prepared geometry, so switching city still repaints one retained texture.
`train-cab` pins paint behind the lettering at both ends and detail levels, and
`train-lod` pins the updated inventory. The production checker captures all stocks.

The supplied 3000 × 3202 `chengdu-map.png` is lazily decoded and fitted whole on
both map mounts. New-line colours are sampled from that supplied poster; this is
the reference's palette, not a claim about the present-day operating network.
Existing saved lines retain their colours. The city tile wraps to a second row
in the existing four-column popover. All city-specific previews remain cached PNGs.
`tools/check-chengdu-style.mjs` checks selection, deferred poster decode, retained
train texture/sign repainting, no chunk remeshes/raycasts, undo/redo and saved reload,
and captures the selector, plate, train/UI mark and High/Low scene for review.
