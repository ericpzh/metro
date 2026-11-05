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

`sim/cityStyles.ts` owns the Guangzhou (default), Shenzhen, Shanghai, Beijing, Chengdu, Chongqing, Wuhan and Nanjing visual identities and
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
For one added/changed city, set `MENU_CITY` to its id to regenerate only that city's
14 assets; the existing base index supplies the option list and remains untouched.

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
| Chongqing's complete supplied palette, numbered train badges, same-colour line identity, retained artwork and livery placement | `city-style`, `train-preparation`, `train-cab`, `train-lod` |
| Chongqing glass sealed to roof/base/front columns on three sides; outward-facing guide housing ends/top/bottom in High/Low | `module-build`, `model-detail` |
| Wuhan exact supplied palette, named aliases, gradient atlas bounds and navy bilingual plate with subscript exit | `city-style` |
| Wuhan three sealed glass sides, open entrance/clear fascia, closed square column/cube and live bound labels across bays/rotations in High/Low | `module-build`, `model-detail` |
| Nanjing exact palette, retained side-only marks, numeric plates and side-facing thick-column labels/raised roof sign | `city-style`, `train-cab`, `module-build`, `model-detail` |
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

## Chongqing

Chongqing is the sixth city. `chongqingBranding.ts` draws the green CRT station/UI
emblem from the supplied P4 contours; `tools/trace-chongqing-branding.py` reproduces
them and retains the source hash. Train badges follow P1–3: a white oval carrying
CRT and the actual line number in that line's current colour. Each consist owns a
retained 512 × 128 badge texture (`chongqingTrainMark.ts`), separate from the shared
three-slot city atlas. Both cab ends retain their badge geometry in every city;
switches clear/repaint textures rather than rebuild live or prepared trains.
A/B/C/L seat the badge inside the lower colour band; D drapes it onto the coloured
livery ring. Empty badge/atlas pixels discard before writing depth.

Line colour cannot identify a line: regional lines share a default blue and users
may assign identical colours. `sim/trainFlags.ts` preserves the ten-float pose
stride: bits 0–1 select doors, bit 2 selects catenary, bits 3+ encode the one-based
document line index (zero means legacy/unknown). The worker and preparation path
use the same helper; `TrainSystem` retains the resolved line id for presentation
edits, spare reuse and recolouring. Keep door/power masking unchanged.

`ChongqingExitHeader.ts` prints the cream P6–9 plate with rail pictogram, live line
colour separators, bilingual station name and numeric/alphanumeric exit. New exits
use `1口`, `2口`, etc.; city switches preserve existing identifiers. Headers use the
same bounded 4× text resolution policy as Chengdu, including doorway variants.
`ChongqingExitCanopy.ts` owns the silver curved roof, inclined front columns and
stone bases. Guide columns are placed separately, never attached to exits.
Both side panes meet the exact sloped roof
underside and column rear face, and the rear panel closes the third side. Glass
meets the stone bases without a visible slit. High and Low share the same fitted
boundary policy; only the entrance stays open. Keep the shared simulation
footprint and walking opening unchanged.

`ChongqingGuidepost.ts` serves both decor and virtual exits: dark round shaft,
open silver ring and bowed green CRT housing, with readable marks on both sides.
Its two ends, top and bottom face outward; Low keeps a closed box and open ring.
Preserve these caps when changing virtual-exit detail handling.

The complete supplied 2000 × 1833 `chongqing-map.png` decodes only on demand and
fits whole on both mounts with framing matched to its aspect. New-line defaults
use the user's exact table for lines 0–29 and jt/bt/yc/nc/dz/qw, with Chinese named
aliases. Existing saved colours survive city switches and reloads. All 14 city
previews are checked-in PNGs. `tools/check-chongqing-style.mjs` verifies production
selection, retained textures/roots, live recolouring, undo/reload and deferred map
loading, and captures all themes and all five train stocks in High/Low. Keep its
measured selection timings and model inventories only in the performance reference.

## Wuhan

Wuhan is the seventh city. `wuhanBranding.ts` draws the supplied P1 M with a blue
gradient for UI/train cabs and white on navy/charcoal signage. The tiny reference
has compression ringing: `tools/trace-wuhan-branding.py` reconstructs measured
straight edges and preserves its source hash in `wuhan-contours.json`. Keep the
two horizontal white separators and three separate lower bars. The shared retained
train atlas uses its first 128 px slot; the square mark must stay inside that slot.

`WuhanExitHeader.ts` follows P2: navy background, white 武汉地铁 / WUHAN METRO,
bilingual station, actual line-colour badges, large exit letter with numeric
subscript and 出入口 / Entrance. Keep the identifier clear of the English label.
Use the same bounded 4× native text policy as Chengdu/Chongqing, including doorway
and uncovered variants. `WuhanExitCanopy.ts` follows P3–5/P7 with a flat folded
silver roof, charcoal portal/mullions, stone bases and retracted perforated shutter.
Both sides and the rear glass meet the roof and base in High/Low; the street
doorway stays open. Guide columns are placed separately, never attached to exits.

`WuhanGuidepost.ts` serves decor guideposts and virtual
exits. The closed square shaft supports a closed cube with white M marks on four
faces. Four retained label faces print upright Chinese, rotated English, the bound
exit and live line-colour bands. Station/exit/line edits repaint retained textures;
city changes replace city-specific shells. Low preserves all exterior cube/shaft
faces. Keep decorative guides within the existing simulation placement policy.

The supplied 2732 × 2731 `wuhan-map.png` loads only on request and fits whole on
both mounts, with no crop or stretch. Defaults use the user's complete 1–21 table
and Yangluo/阳逻/阳逻线 and Xingang/新港/新港线 aliases. Existing colours survive city
switches and reloads. All 14 menu previews are cached 132 px PNGs. Run
`node tools/check-wuhan-style.mjs` for production selection, retained train/sign
resources, recolouring, undo/reload, deferred poster decode and High/Low captures.

## Nanjing

Nanjing is the eighth city. `nanjingBranding.ts` draws the P4 red plum blossom
and white open roundel/upright from `nanjing-contours.json`.
`tools/trace-nanjing-branding.py` reproduces the source-hashed contours with a
2 px simplification tolerance, preserving smooth curves without pixel stair steps.

Train marks follow P1–3: four emblems, on both sides at both cab ends, between
the crew door and the first passenger door. D uses its curved black cab-side panel ahead of the first narrow door; C uses the corresponding panel after its cab
side window. `NanjingTrainMark.ts` seats A/B/C/L decals on the shared body profile
and D's on its black cab taper through `StreamlinedCab.ts`. Every city retains these quads; only Nanjing paints the
separate scene-owned 256 px side texture. It uses alpha cutout and opaque batching.
`refreshNanjingTrainMark` repaints in place and suppresses no-op uploads. Clear all
three nose-atlas slots in Nanjing; do not add a nose emblem or rebuild trains.

`NanjingExitCanopy.ts` follows P5–7: silver canopy with a curved descending rear
profile and a flat front overhang, three glass sides fitted to the roof, stone
bases and the actual inclined column back planes. The white entrance columns
have 1.2 m deep side faces; put the logo, station and outlined exit identifier on
those outward side faces, not on their narrow entrance-facing fronts. The
`NanjingRoofSign.ts` blossom sits above the roof on a short 地铁 / Metro stem.
Keep the raised sign separate from ground guideposts. All fitted glass boundaries
and thick column profiles remain in High/Low. Labels repaint retained textures.

`NanjingExitHeader.ts` follows P8: navy, actual line-colour number tiles, 号线 /
Line, rail pictogram, bilingual station and an outlined exit number. New exits
are numeric (`1口`, `2口`); city switches preserve existing labels. Headers use the
bounded 4× text resolution shared with Chengdu/Chongqing/Wuhan.
`NanjingGuidepost.ts` follows P9/P10 with a closed white blade, blue crown,
blossom, curved live line-colour divider and two bilingual retained label faces.
Guideposts and virtual exits are separate modules, never attached to head-houses.

The supplied 1497 × 1618 `nanjing-map.png` decodes on request and fits whole on
both mounts. Use the exact user-supplied HEX values for 1–11 and S1–S9, including
S3/S4/S7; do not infer colours from the nearby Pantone descriptions or old map.
Keep saved custom colours on city switches/reload. All 14 previews are cached
132 px PNGs. `tools/check-nanjing-style.mjs` checks production selection,
retained train/sign resources, lazy map decode, live recolouring, undo/reload,
all themes and High/Low views of the entrance, guide, map and every train stock.
