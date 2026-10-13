# Model library

The third app beside `web/` and `game/`: a standalone Vite + three.js character
viewer. Choose the approved male commuter or female variants, inspect front/side/
back/oblique views, stand or walk at three profiles, and download the selected GLB.
The viewer has English and Chinese labels. Long hair is available only without a
backpack; adding a backpack selects shoulder-length hair. Male characters have
original, short and bald styles, each with or without a backpack. Short and bald
share the same close-fitting scalp geometry with hair and skin colors respectively.

The age selector previews adults, boys and girls. Children use bagless models
with hair at a base of 65% height and 70% width/depth. Separate sliders vary
height from 80–120%, adult width/depth from 90–110%, and child width/depth from
80–90%, relative to that age base. Reset size uses 100% height and the midpoint
of each horizontal range (100% adult / 85% child). Random passenger uses the game's 20%
child / 80% adult distribution and equal selection within the appropriate model
pool. Age and percentages persist in the preview URL (`age`, `height`, `width`,
`depth`). The downloadable GLB remains the reviewed base template.

Backpack choices are standard, small, or none. The small daypack has a narrower
rounded crown and fuller base, measuring about 30 × 43 × 14 cm. It is available
for all three male hairstyles and female bob/shoulder hair. Its straps follow
the exposed coat backing and stay attached to the torso during every walk.
Both bag sizes use smooth rear strap bridges, with coat support recessed only
under the torso sections. The small pack's closed front overlaps the coat to
remove side slits. `tools/check-model-backpack-outline.mjs` samples the rendered
rear ribbons across their width to reject pale shards and holes while walking.

`waist-skinning.js` corrects the shared source arm mask on the trousers, including
the original male export. The waist follows Hips and the lower coat panels follow
Spine, while sleeves retain arm movement. The front lining sits behind the shirt
hem. `tools/check-model-hem.mjs` checks these boundaries and their attachment
through all three walks, with standard/small/no backpacks; `--source` checks the
builders directly before exporting.

From the repository root:

```powershell
npm run setup:model
npm run dev:model     # http://127.0.0.1:5175/
npm run build:model   # standalone model/dist
npm run preview:model # http://127.0.0.1:4175/
npm start             # web 5173 + game 5174 + model 5175
```

`npm start` reuses listening services and starts the others. Ctrl+C stops only the
services that launcher started. Each app can still be started independently.
When regenerating GLBs with the viewer open, refresh after the command finishes.
Generated assets do not trigger reloads halfway through a batch. Exports prepare
complete temporary files and retry Windows reader locks before publishing them.

After building, `node tools/check-model-preview-options.mjs` serves the production
preview and checks age restrictions, separate dimensions, URL reloads, scaling
during animation, reset/random controls and both languages. Captures go to
`.preview/model-options/`. `node tools/check-model-service.mjs` checks the
existing character, hair, bag, playback and download controls on the dev service.

`npm --prefix model test` runs deterministic preview rules: age-dependent limits,
old URL clamping, reset midpoints, child hair/bag restrictions, GLB scale axes,
20/80 random distribution and equal model choice within each age pool. The browser
check also exercises all five child templates through all three walk profiles.

`src/characters/female.js` owns the character variant builder. The older prototype
re-exports it for compatibility. `src/animation/` owns the accepted foot-targeted
gait; existing root tooling re-exports it. `src/characters/shoulders.js` folds the shared collar tabs into a smooth
neck-to-shoulder profile for every library model. It also rounds the shared jaw
and rear neck and folds chest protrusions into a fitted front surface.
`src/characters/front-boundaries.js` splits that surface at the neckline, shirt
and strap boundaries so overlapping source layers keep the same flat color.
Crown widths now match the slim long
hair while retaining the cleaned hip silhouette and backpack rules.

`scripts/prepare-assets.mjs` runs before dev/build. It regenerates the female
exports and copies them into ignored `public/models/`. It adds the approved male
geometry with the same slow/medium/fast clips, generated from the game's walk
profiles, plus five male variants. Bagless variants remove straps and close the
jacket back; cropped variants replace the hair with a smooth head-skinned scalp.
`provenance.json` records the original male source hash and generation
inputs. The source assets remain in `prototypes/`; generated GLBs do not need to
be committed twice. Node 24+ is needed by the preparation scripts.

Production is self-contained: `model/dist` includes all sixteen GLBs, reference art,
profiles, and bundled viewer code. It does not request game dependencies or
prototype paths at runtime. Set `VITE_WEB_URL` and `VITE_GAME_URL` when building
to change the two navigation links. No cloud deployment is configured by this change.

The game uses these sixteen exports, with equal adult selection chances. Children
reuse the five bagless, non-bald templates at a smaller base scale. The crowd is
20% children / 80% adults, with stable independent variation in all three axes. Run
`npm run bake:passengers` at the root after approving a model change; it regenerates
the GLBs and shared game atlas. `src/characters/library.js` is the canonical
catalogue for the viewer and game bake. Use `.agents/skills/metro-model/SKILL.md`
for the dedicated model workflow.

To refresh the art after approving models, run **`npm run art:models`** at the root.
It regenerates the reviewed exports and game atlas, builds the game, captures
all sixteen adult entries and five eligible child templates in standing and
complete walks, refreshes the interface
captures for sheet 07 in both languages, updates sheets
01/02/07/12/13 in Chinese and English, checks animation, renders previews into
`.preview/sheets/`, and builds/syncs the site. No deployment is performed.

For an art-only refresh of the current game atlas use
`npm run art:models -- --from-game`; it still builds the game before capturing.
New models are added to `src/characters/library.js` and the export
builder/preparation script; update the explicit game library test to pin the new
catalogue. Capture pools and bounded batches grow automatically;
the capture manifest records the atlas and model hashes, and stale game exports
or incomplete walk cycles fail before sheet generation. Sheet figures retain
the game's 20/80 age distribution, and gait timing uses each resized model's
physical stride length.

The model-art command uses dedicated `.preview/model-art/` captures and free
browser ports, so it can coexist with other local previews.
