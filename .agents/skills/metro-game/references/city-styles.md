# City Styles: Contracts and Verification

`game/src/sim/cityStyles.ts` defines eight station-wide visual identities:
`CITY_STYLE_IDS = ['guangzhou', 'shenzhen', 'shanghai', 'beijing', 'chengdu',
'chongqing', 'wuhan', 'nanjing']`, with `DEFAULT_CITY_STYLE = 'guangzhou'`.

## Save Schema, Defaults, and Preserved Data

- **Wire vs internal fields:** `persistence/save.ts` writes top-level `city` on
  `serialize()` and normalizes `d.city ?? d.cityStyle` on `parse()`. Missing or
  unknown values default to `guangzhou`. Internal state uses `StationState.cityStyle`
  and `StationData.cityStyle` (the three shipped `StationData` demo JSON files under
  `game/src/data/` set `"cityStyle": "guangzhou"`).
- **Non-destructive city switches:** Switching city via `CityStyleSelect` commits one
  undoable presentation edit (`StationSlice.setCityStyle`). Existing line colours and
  existing exit identifiers are never rewritten; city defaults apply only to newly
  created lines and newly placed exits.
- **New-line palettes (`lineColourFor`):** Every new-line factory — including the
  first rail and platform preview — must pass the station's `cityStyle`. Tables cover
  in-service, planned, branch, suburban, airport, and tram identifiers with both
  English keys and full Chinese aliases where defined in `sim/cityStyles.ts`.
- **New-exit naming (`build/model/Equipment.ts` `nextExitName`):**
  - `shanghai`: numeric `1号口`, `2号口`, ...
  - `chongqing`, `nanjing`: numeric `1口`, `2口`, ...
  - `guangzhou`, `shenzhen`, `beijing`, `chengdu`, `wuhan`: alphabetic `A`–`Z` via
    `nextExitLetter` wrapped in `exit_value` (`A口`, `B口`, ...).

## Shared Rendering, Artwork, and Presentation Invalidation

- **Presentation-only fast path:** City switches travel through `sim/populationEdit.ts`
  and `SceneRenderer.updatePopulationData`, preserving chunks, walking topology, and
  transient preview state without chunk remeshes or raycasts.
- **Shell rebuild vs artwork repaint (`ModuleSystem.repaintPresentation`):**
  - Covered entrance roots tag `userData.exitCityStyle`; guidepost and virtual-exit
    roots tag `userData.guideCityStyle`; exit headers tag `userData.exitHeaderScale`
    (`render/exitHeaderResolution.ts`: `4×` native resolution capped at `4096 px`
    width for `chengdu`, `chongqing`, `wuhan`, `nanjing`, and `1×` for others).
  - `ModuleSystem.repaintPresentation` rebuilds roots whenever any of those three
    tags disagrees with the active city, while retaining all unaffected equipment.
  - Virtual exits participate in presentation invalidation alongside decor guideposts.
- **Train branding & retained consists:**
  - `render/cityBranding.ts` owns `drawMetroMark`, `refreshCityTrainMark`, and
    `refreshNanjingTrainMark` (suppressing no-op texture uploads).
  - `render/trainMarkAtlas.ts` maps a shared 3-slot `384 × 150` nose decal texture
    (slot 0: Guangzhou/Shenzhen/Shanghai/Wuhan; slot 1: Beijing calligraphy; slot 2:
    Chengdu). All slots remain in prepared cab geometry so switching city repaints
    the retained atlas in place without rebuilding live or parked trains. Empty
    pixels discard via `alphaTest` before depth writes.
  - Chongqing uses a per-consist retained `512 × 128` badge texture
    (`render/chongqingTrainMark.ts`) driven by the 1-based document line index packed
    into bits 3+ of the 10-float train pose flags (`sim/trainFlags.ts`), because line
    colour alone does not uniquely identify a line.
  - Nanjing clears all three nose-atlas slots and paints a separate scene-owned
    `256 px` cab-side texture (`render/models/pieces/NanjingTrainMark.ts` +
    `StreamlinedCab.ts`).
- **Lazy city network maps:** `render/lineMapCity.ts` (`cityLineMapSlug`,
  `cityLineMapSuffix`), `render/lineMapArt.ts`, and `render/cityLineMapCache.ts`
  decode only the requested city's poster, coalesce concurrent requests, suppress
  callbacks after disposal, and store separate textures/materials per city. Include
  city in `PlateSystem` map-cache keys and fit every poster whole at its native aspect
  ratio without cropping or stretching.
- **Shared simulation footprints:** Decorative city elements (projecting entrance
  signs, roof signs, pylons, fitted canopy glazing) never alter simulation footprints,
  walking openings, or collision rules. Ground guideposts and virtual exits remain
  separate modules, never attached to head-houses.

## Top-Bar Selector and Cached Menu Thumbnails

- **Top-bar popover (`app/windows/topbar/CityStyleSelect.tsx`):** Sits beside Example
  Stations and opens a native `popover="auto"` grid of `84 px` square tiles, at most
  four columns wide (`gridTemplateColumns: repeat(min(4, count), 84px)`), wrapping to
  multiple rows. Measure the rendered popover width when clamping left position so
  inherited demo-menu width does not override content sizing. Scope theme styling to
  `blueprint`, `site`, and `studio` selectors.
- **Pre-rendered LHS PNGs (`game/public/module-thumbnails/`):** Menu thumbnails are
  checked-in `132 × 132` PNGs, never startup WebGL renders. `moduleThumbnailAssets.ts`
  routes `exit`, `exit-*`, `guidepost`, and `linemap-*` (14 assets per non-Guangzhou
  city) to `module-thumbnails/<city>/<id>.png`. `TileGrid` and `VariantMenu`
  subscribe to `station.cityStyle`.
- **Regeneration workflow (`tools/render-menu-thumbnails.mjs`):**
  1. `npm --prefix game run build`
  2. `node tools/render-menu-thumbnails.mjs` (or set `MENU_CITY=<id>` to regenerate
     only that city's 14 PNGs without touching `index.json` or other cities)
  3. `npm --prefix game run build`
  `app/moduleThumbnails.ts` builds city fixtures on a synthetic station completely
  isolated from committed documents.

## Per-City Model, Branding, and Map Contracts

| City | Branding / Contours | Canopy, Header & Guidepost | Train Mark | Line Map (`src/assets/linemaps/`) | Browser Checker |
| --- | --- | --- | --- | --- | --- |
| **Guangzhou** (`guangzhou`) | `cityBranding.ts` (red stylised ram mark) | Default `ExitModel.ts`, `StreetDecorModel.ts` | Nose atlas slot 0 | `network-map.jpg` (`1080×1080`) | `tools/check-city-styles.mjs` |
| **Shenzhen** (`shenzhen`) | `cityBranding.ts` (green symmetric emblem) | `ShenzhenExitCanopy.ts` (curved charcoal shell, right Metro sign), `ShenzhenGuidepost.ts` (grey pylon, green crown) | Nose atlas slot 0 | `shenzhen-map.jpg` (`1200×1200`) | `tools/check-city-styles.mjs` |
| **Shanghai** (`shanghai`) | `cityBranding.ts` (red circular S/M mark) | `ShanghaiExitCanopy.ts`, `ShanghaiExitHeader.ts`, `ShanghaiGuidepost.ts` (lantern pylon) | Nose atlas slot 0 | `shanghai-map.png` (`2279×3189`, portrait frame) | `tools/check-shanghai-style.mjs` |
| **Beijing** (`beijing`) | `cityBranding.ts` (blue DC roundel) + `beijingTrainMark.ts` (white calligraphic 北京) | `BeijingExitCanopy.ts` (flat stainless canopy, diamond holes in High/Low), `BeijingExitHeader.ts` (1 shared texture for doorway + front/side roof signs), `BeijingGuidepost.ts` (blue drum pylon) | Nose atlas slot 1 (1.5× over headlamps) | `beijing-map.png` (`6564×6537`, lazy decode) | `tools/check-beijing-style.mjs` |
| **Chengdu** (`chengdu`) | `chengduBranding.ts` + `chengdu-contours.json` (`tools/trace-chengdu-branding.py`) | `ChengduExitCanopy.ts` (silver curved roof, green trim, inclined legs clipped with 4 mm joint gap), `ChengduExitHeader.ts` (4× fascia forward of columns), `ChengduGuidepost.ts` (equilateral `0.30 m` prism, 30°-rotated blue collar) | Nose atlas slot 2 (lower colour band; D draped on ring) | `chengdu-map.png` (`3000×3202`, lazy decode) | `tools/check-chengdu-style.mjs` |
| **Chongqing** (`chongqing`) | `chongqingBranding.ts` + `chongqing-contours.json` (`tools/trace-chongqing-branding.py`) | `ChongqingExitCanopy.ts` (silver curved roof, 3 sealed glass sides), `ChongqingExitHeader.ts` (cream 4× plate), `ChongqingGuidepost.ts` (dark shaft, silver ring, bowed green CRT box) | Per-consist `chongqingTrainMark.ts` (`512×128` CRT + line number in line colour) | `chongqing-map.png` (`2000×1833`, lazy decode) | `tools/check-chongqing-style.mjs` |
| **Wuhan** (`wuhan`) | `wuhanBranding.ts` + `wuhan-contours.json` (`tools/trace-wuhan-branding.py`) | `WuhanExitCanopy.ts` (folded silver roof, 3 sealed glass sides, retracted shutter), `WuhanExitHeader.ts` (navy 4× plate with letter+subscript exit), `WuhanGuidepost.ts` (closed square shaft & logo cube) | Nose atlas slot 0 (square gradient M inside 128 px slot) | `wuhan-map.png` (`2732×2731`, lazy decode) | `tools/check-wuhan-style.mjs` |
| **Nanjing** (`nanjing`) | `nanjingBranding.ts` + `nanjing-contours.json` (`tools/trace-nanjing-branding.py`) | `NanjingExitCanopy.ts` (descending curved rear roof, 3 sealed glass sides, 1.2 m side-labeled white columns), `NanjingRoofSign.ts` (raised blossom), `NanjingExitHeader.ts` (navy 4× plate), `NanjingGuidepost.ts` (white blade, blue crown) | Side-only `NanjingTrainMark.ts` + `StreamlinedCab.ts` (`256 px` texture; nose cleared) | `nanjing-map.png` (`1497×1618`, lazy decode) | `tools/check-nanjing-style.mjs` |

### City-Specific Geometry Guardrails

- **Shenzhen:** Entrance badges invalidate on line colour edits. Canopy glazing clears
  plinth/gasket/post volumes; intermediate mullions start at the plinth; side plinth
  ends at the front jamb.
- **Beijing:** Keep `trainMark.alphaTest` discarding empty atlas pixels so unused
  overlapping slots never clip the white calligraphic lettering. Both High and Low
  canopy geometry must preserve the real diamond openings in the metal side panels.
- **Chengdu:** Silver roof and soffit stop inside the green trim without overlapping
  end-cap volumes. Side stone bases, green sills, and end glass clip against actual
  inclined column rear faces with a `4 mm` gap; High and Low share the coarse roof
  profile with glazing/posts. The equilateral guidepost's black shaft stops at the
  30°-rotated blue collar, keeping both exposed collar caps in High and Low.
- **Chongqing:** Side and rear glass seal tightly to the sloped roof underside, column
  rear faces, and stone bases in both High and Low (only the street entrance opens).
  Guidepost housing ends, top, and bottom face outward; Low retains a closed box and
  open silver ring.
- **Wuhan:** Keep two horizontal white separators and three separate lower bars on the
  M mark. All three glass sides seal to roof and base in High/Low; guidepost cube and
  shaft retain all exterior faces in Low.
- **Nanjing:** Place column logo, station name, and outlined exit number on the wide
  outward side faces (`1.2 m` deep), not the narrow entrance front. Keep all four
  cab-side decals on A/B/C/L (between crew door/cab window and first passenger door)
  and on D's tapered black cab panel.

## Deterministic Verification Ownership

| Contract | Owning `game/test/` Suite(s) |
| --- | --- |
| Wire `city` / fallback, demo city, undo/redo, preserved custom colours, palettes & aliases, cab textures | `city-style` |
| City presentation fast path, entrance badge recolouring, covered/pylon shell invalidation | `city-style`, `nonstructural-updates` |
| City High/Low triangle budgets, geometry restoration & batching | `model-detail` |
| Canopy bay counts × 4 rotations, glazing/plinth/column fit, guidepost & virtual-exit geometry | `module-build` |
| City poster routing, lazy decode/coalescing/disposal/retry, retained map cache, mounts | `line-map` |
| Chongqing per-consist badges, pose line-index flags, Nanjing side marks, Beijing/Chengdu nose slots | `train-preparation`, `train-cab`, `train-lod` |
| Checked-in `132 px` PNG catalogue, city-specific diffs, reactive rail tiles | `menu-thumbnails` |

Run the relevant focused suites plus `npm --prefix game run typecheck`,
`npm --prefix game run build`, `npm --prefix game test`, and the matching
`node tools/check-*-style.mjs` production browser script when changing city assets or
rendering. Record any hardware performance timings only in
[performance.md](../../metro-repo/references/performance.md).
