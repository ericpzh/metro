# Model library

## Selected soft-human base

The user-selected base for `/soft-human.html` is now
`public/human-candidates/human-fall-flat/HumanBody_Alt.fbx`.
`src/soft-human/imported-base.js` normalizes the source to 1.7 m, preserves its
26,544 vertices, authored weights and smooth normals, and rebinds its 15 bones
plus a Hips root into an A-pose. The original procedural sculpt remains in
`character.js` as a historical study and regression fixture; it is not the page's
active base. The older procedural-study descriptions below describe that fixture.

The selected base supports twenty outfits per male/female wardrobe category, eleven bag choices,
adult/child sizing, three walks and the full station activity catalogue.
The categories share the same body and most outfits. Pink trail jacket is in the
female category; casual shirt/trousers fills the male category. Both include
cotton T-shirt/shorts and polo/chino shorts. Sport shorts and Summer stripes are
male-only; T-shirt/skirt and blouse/midi skirt are female-only. Category changes
keep a shared outfit and preserve bag, age and timeline; an unavailable outfit
falls back to the commuter jacket. The unpainted `plain` base remains exportable
through the API/CLI, outside the twenty wearable choices. The added color combinations mix the reviewed cuts: white/denim, navy/sand,
sage/stone and coral/navy tees/shorts; blue/cream and burgundy/sand polos/shorts;
and cream/navy or olive/charcoal shirts/trousers. Male additions include
black/khaki shorts and a slate suit; female additions include blue/navy and
rose/slate skirts. Skirts retain the original waist, hips and outer legs, with a
local inner-thigh connection. Clothing colors share this one skin like trousers;
there is no separate waist shell, enlarged envelope or projecting lip.
Wardrobe boundaries map to its proportions; the neck opening ends at the measured
narrow neck, and cuffs are clipped perpendicular to the forearm. Straps use
authored mathematical curves in `torso-fit.js` and `mathematical-strap.js`:
Bezier shoulder arcs and chest runs, a smooth torso profile, and a level
superellipse for backpack lower returns. Constant-width ribbons use parallel
transport and stay owned by Chest alongside the bag. There is no triangle
projection or per-frame strap fitting. `strap-fit.js` remains a historical
procedural-study implementation. Carried bags use the actual wrist anchors.
Station poses use the production equipment's contact heights. Free arms keep
the default outward A-pose in every action, including seating and narrow lanes;
only active equipment reaches override it. Adult width is not compressed to fit
a lane. Collision audits can therefore report an outward free arm crossing narrow
equipment. Switching back to walking restores the bind joint positions. The selected model now replaces the game crowd. `src/soft-human/catalog.js`
derives all 440 clothing/bag recipes for both ages; `npm run bake:passengers`
generates the shared walking and activity assets offline. Game runtime remains
independent of the model app. See `game/src/assets/PASSENGERS.md`.

Run `node --test model/test/soft-human*.test.mjs`, build with
`node model/node_modules/vite/bin/vite.js build model`, then run the
`tools/check-soft-human.mjs`, `check-soft-human-activities.mjs`,
`check-soft-human-clearance.mjs --all` and `check-soft-arm-poses.mjs` browser checks.
`soft-human-imported.test.mjs` covers the actual selected FBX, both ages, all
wardrobes, deterministic activities and posed GLB round trips.
`soft-human-casual.test.mjs` and `tools/check-soft-human-casual.mjs` cover category
counts, eligibility, perpendicular short sleeves, clean shorts hems, state
preservation, adult/child renders and export metadata. To export a categorized
casual example, run `node model/scripts/export-soft-human.mjs --sex=female
--outfit=polo-shorts`; the explicit category is included in its filename.

`model/scripts/export-soft-human.mjs` now exports the selected base and records
its source hash. Preserve the supplied `human-fall-flat/readme.txt`: it describes
the model as a cleaned game extract, and the supplied files contain no
redistribution license. Export manifests record that provenance rather than
labelling this base an original procedural sculpt.

## Clothed human candidates

Open `/candidates.html` from the model viewer's **Human candidates** link.
The focused East Asian candidate set has ten adult bases (six VALID casual
characters and four Rocketbox visual selections) plus four generated MPFB children
(two girls and two boys). The six VALID characters are different bases, not six
outfits of one person. Rocketbox picks are visual selections; that source does not
provide ethnicity labels. Previous nonmatching candidates are excluded.

`src/candidate-catalog.js` owns the bilingual character catalogue. The page now
opens in Animated grayscale, with standing, waiting and slow/medium/fast walks. The
accepted static faceless minimalist grayscale image view is also available. Each of the 14
characters has its own original 16-angle sheet and image-stylized 16-angle sheet
under `public/human-candidates/studies/`: 224 directional illustrations total.
The angle slider, fixed-view buttons and Rotate inspect the sheet. Comparison
mode shows that character's original captures alongside the chosen style; Source
mode retains the unmodified 3D asset and any bundled animation for reference.
The earlier replacement heads, hair caps, procedural bags, material/shader style
experiments and frozen WebGL sprite experiment have been removed.

Candidate, view mode and language live in the URL; shortlists stay in browser
local storage. Old style/study query parameters migrate to the grayscale view.
Adults use 1.75 m reference height. Children retain child body proportions and
are displayed at their authored heights (1.18–1.46 m), relative to that adult
reference. The illustration display enforces neutral grayscale with a CSS filter.

The **Generated 2D walk experiment** has 32-frame sprite loops for VALID woman 3:
front, 45-degree, side and back, plus low and high elevations at 45 degrees.
The 32 frames play at 30 fps. Source poses use a single fixed scale per view;
`tools/capture-candidate-sprite-frames.mjs` registers each pose's shirt centroid
with integer translations. All available views register the shirt length while preserving the head anchor.
Side-view hem detection uses a minimum row width to avoid confusing the swinging
hand with the shirt. Apparent hip-to-foot height is normalized by stretching or
compressing the lower body in image space; this can distort the original poses.
Normal and low views share a projected size reference; the high view retains
its foreshortened projection.
`tools/interpolate-candidate-sprites.mjs` then uses RIFE to produce in-between
frames, including the loop transition. The view
selector preserves the current walk phase. The independently generated source
poses still have shape and limb inconsistencies, and neither registration nor
interpolation can fully correct them. This remains an experiment for one character,
not a full 16-direction library. Source art and provenance remain in
`public/human-candidates/animation-studies/`; the source frames are processing
inputs and are not offered as lower-frame playback.
`node tools/check-candidate-sprite-study.mjs` checks frame playback, phase
preservation, candidate-specific availability and measured torso-centre drift.

The static sheets retain the approved image style with an opaque light background.
The moving preview now uses stable surface regions derived from original source UVs
and anatomy, with flat unlit grayscale colours. It does not project the static
sheets onto moving meshes. This removes side-view phantom hands and paper borders.
`src/candidate-illustration.js` samples source colours only to fit garment coverage and palette. Sleeve and
trouser/boot lengths are robust contiguous skin intervals in limb coordinates;
the shirt hem is one fitted plane, the collar is a fitted V or rounded opening,
and the hairline is a continuous scalp field. Runtime boundaries evaluate those
fields per fragment in bind space, independently of texture speckles or individual
triangle labels. Eye/gland/teeth surfaces use the same unlit skin colour in illustration mode,
filling face sockets without showing texture detail or opening background holes.
`node --test model/test/candidate-boundaries.test.mjs` pins noisy short sleeves,
shorts/boot intervals and covered limbs against isolated texture pixels. Original texture alpha is retained for genuine hair cutouts;
source texture lighting/detail is not rendered. Source materials and geometry
restore on source view/disposal. Character-specific clothing boundaries still
need art review; the static illustrations remain available for comparison.
`src/candidate-smooth.js` then cleans small contour irregularities in the rendered
2D image using a local vote over the flat palette. This is a preview-only image
filter: it cannot straighten large changes in the underlying mesh silhouette, and
fine details can be softened. The source view and original study captures bypass it.

`src/animation/candidate-library-motion.js` loads the CC0 Quaternius Universal
Animation Library and uses Three.js `SkeletonUtils.retarget` for walk/idle upper
body motion. It maps torso, neck, head, shoulders, arms and hands on VALID,
Rocketbox and MPFB rigs. A temporary target T-pose establishes axis offsets,
including the children's original A-poses, and is then fully restored. Source
bone lengths/scales are retained after retargeting; imported rig scales must
never be copied into mapped joints. Source motions/licenses/pinned mirror/hash
records live under `public/human-candidates/motions/`, collected by
`python tools/collect-candidate-motions.py`. Official source:
https://quaternius.com/packs/universalanimationlibrary.html .

`src/animation/candidate-motion.js` keeps the accepted foot-target trajectory and
shared slow/medium/fast speed/cadence for lower-body ground contact; the Quaternius
clip supplies authored upper-body timing instead of procedural hand paths.
Children scale stride/lift with height. Source lengths and bind transforms restore
before each sample. Station interaction transfers and game integration remain
pending. These are live rigged character previews, not baked animated sprite sheets.
Nothing here changes the game crowd atlas or the reviewed passenger library.

`studies/library.json` records the built-in image edit prompts, source/output
hashes and the source models. Original source/license notices remain in
`public/human-candidates/manifest.json` and each collection's `source.json`.
Rocketbox and VALID are MIT; generated MakeHuman core assets/output are CC0.
Rocketbox picks are visual selections, not source-verified ethnicity labels.

Reproduction tools:
- `python tools/collect-valid-candidates.py`: six pinned compressed GLBs.
- `python tools/generate-child-candidates.py`: four fitted MPFB child GLBs.
- `python tools/collect-human-candidates.py`: Rocketbox assets and source manifest.
- `node tools/capture-original-human-study.mjs`: all original contact sheets
  from the built page, using its shared capture helper. Source texture decoding
  completes before captures, including FBX clothing maps. Output is deterministic
  source rendering; stylization is a separate built-in image edit step using the
  saved prompts and approved reference, not part of this script.

Build without regenerating game passenger exports using
`node model/node_modules/vite/bin/vite.js build model`, then run
`node tools/check-human-candidates.mjs`. The browser check covers all 14 sheets,
occupied figures in all 224 tiles, grayscale display, angle switching, comparison
and original 3D modes, shaders, shortlist persistence, Chinese and compact layout.
`node tools/check-candidate-motion.mjs` verifies all 14 rigs and three walk
profiles: finite joints, body scale, loop closure, stance speed/height, IK endpoint error,
authored animation mappings, moving rendered pixels and absence of snapshot maps. It saves front/oblique/side/back captures at two walk phases and a quantitative
report under `.preview/human-candidates/motion/`.
Captures/reports are ignored under `.preview/human-candidates/`.

## Passenger activity previews

Open `http://127.0.0.1:5175/?action=ticket&bag=0` and use **Passenger activity**
at the top of the sidebar. Thirteen looping previews cover sitting, shelf
browsing, ticket and drink purchases, QR/card gates, escalators, elevator floor
selection, toilets, hand washing, doors, waiting and PSD queues. Play/pause and
the timeline inspect transitions; the activity persists in the URL. Labels
support English and Chinese. Appearance controls and the existing walk viewer
remain available.

`src/animation/interactions.js` owns deterministic poses and limb contact;
`src/interaction-equipment.js` adapts the existing game equipment builders into
the viewer's Y-up coordinates. Toilet and elevator scenes use cutaways; the
floor-selection panel is a preview accessory. Activities use empty hands, with
no phones, cards, tickets, drinks or picked-up shop products. Waiting uses
relaxed arms and looking around.
The queue reuses the selected passenger as three additional skeleton instances.
Activity changes rebuild only the preview fixture, while scrubbing reuses it.

`src/animation/interaction-arms.js` supplies closed sleeves and simple empty
hands for the activity studies, matching the selected source garment/skin
colours. It replaces the reconstructed torso-to-forearm web during reaches;
standing, walking and GLB downloads restore the original reviewed geometry.
Seated poses keep the trouser support surface above the actual seat top and
preserve planted soles. Escalator foot and palm targets follow the real builder's
incline and handrail rather than an estimated slope. The sink faces the
passenger with the faucet on the far side of the bowl.

These isolated studies are also the source for the game's shared activity rig
bake. Game service queues, route stops and optional gestures determine when each
activity runs; the viewer keeps its own looping timeline. Downloadable GLBs still
contain the three reviewed walks. The viewer itself owns no purchase, fare or
elevator simulation.

Build without regenerating unchanged character exports:
`node model/node_modules/vite/bin/vite.js build model`.
Run `node --test model/test/interactions.test.mjs` and
`node tools/check-model-interactions.mjs`; screenshots and activity-selection
timings go to `.preview/model-interactions/`. The checker includes side and
close-up captures and a `rail-contact.json` report across the ride and loop.

The standalone [sound studio](http://127.0.0.1:5175/sounds.html) auditions local
CC0 interaction sounds and camera-distance ambient scenarios, with persistent
volume switches. Start the normal model dev service and open `/sounds.html`.
Source/license records and the game integration proposal live in
`public/sounds/RESEARCH.md`; refresh samples with
`python model/scripts/collect-sounds.py`. This preview does not change game audio.
Build both pages without regenerating character assets with
`node model/node_modules/vite/bin/vite.js build model`, then run
`node tools/check-sound-preview.mjs` for browser audio/mute/lifecycle checks.
Focused logic checks: `node --test model/test/sound-*.test.mjs`.
The ambience speed lab has 1×/4×/16×/64× simulation controls and a persisted
per-sound, per-speed tactic table. Compare natural playback, a 2× cap, full-rate
playback, original-pitch sample skipping, and mute; solo a layer or replay the
train pass. Presets apply to the selected speed. The train crosses the scene
over 48 simulated seconds with a 16-second gap. Skipping uses 120 ms slices
with 15 ms crossfades and bounded scheduling, so it can sound choppy at high
speeds; it is an audition candidate, not a full time-stretch algorithm.
`sound-ambient.test.mjs` pins tactic defaults, rates, train presence, bounded
grain scheduling and stop cleanup. The browser checker also exercises all four
speeds, live sample rates, solo, the approved game mix and saved choices.
Defaults match the selected policy: passengers always 1×; traffic uses full
rate at 1×/4× and sample skipping at 16×/64×; trains skip above 1×. The studio
imports the game-owned `app/ambientPlayback.ts` player, so audition and runtime
use the same slice/crossfade scheduling. Older audition settings are reset once
for this selected mix; later experiments remain local to the studio.
The preview offers one chosen cue per interaction. `src/sound-preview/effects.js`
owns the mappings, pitch changes and cached softening. The original procedural
WAV archive can be regenerated with `python model/scripts/make-soft-sounds.py`;
only its felt tap is currently selected.

The third app beside `web/` and `game/`: a standalone Vite + three.js character
viewer. Choose the approved male commuter or female variants, inspect front/side/
back/oblique views, stand or walk at three profiles, and download the selected GLB.
The viewer has English and Chinese labels and ten hairstyles per sex. Male options
are original, short, bald, buzz, crew, fringed crop, side part, swept crop, quiff
and rounded crop. Female options are bob, shoulder length, long, tapered bob,
rounded bob, angled bob, side-part bob, long bob, swept shoulder length and swept
long hair. Variations change the crown, fringe, sweep or hem while preserving the
reviewed faceless grey style. Both long styles support side bags; adding a backpack
selects shoulder-length hair. Short and bald retain their shared scalp geometry.
`src/characters/hairstyles.js` owns the choices, shape parameters and backpack rules.
The seven added male styles deform the original tousled locks, varying protrusion
relief, fringe length and sweep. Their crowns are capped at 1.665–1.695 m, below the
original's 1.72 m crown. `src/characters/male-hair.js` preserves the source lock
topology, forehead join and head/neck skin weights. Short/bald keep their approved
scalp; the other male choices use the source head surface beneath the hair.

The age selector previews adults, boys and girls. Children use models with hair
and either no bag, a small backpack or a crossbody bag, at a base of 65% height
and 70% width/depth. Separate sliders vary
height from 80–120%, adult width/depth from 90–110%, and child width/depth from
80–90%, relative to that age base. Reset size uses 100% height and the midpoint
of each horizontal range (100% adult / 85% child). Random passenger uses the game's 20%
child / 80% adult distribution and equal selection within the appropriate model
pool. Age and percentages persist in the preview URL (`age`, `height`, `width`,
`depth`). The downloadable GLB remains the reviewed base template.

Backpack choices are standard (100%, 87.5% or 75%), small, or none.
Left/right shoulder bags are available to adults of both sexes, crossbody bags
to adult males and children of both sexes, and hand-held purses to adult females.
Side names follow the skeleton's left/right arms. `carried-bags.js` authors closed
rounded bodies and continuous straps. Shoulder/crossbody bags have their broad
faces along body depth and rest on Spine between torso and carrying arm. A small
outward arm pose provides clearance in standing and all walks; the shoulder
strap follows the sleeve over its crown and blends into Spine below. Crossbody
straps fit five points across their width with continuous front/rear/crown
fitting directions. Their shoulder clearance is preserved through smoothing so
the neckline cannot cut the strap into separate patches. Missed fitting rays
preserve free bag anchors, and unsupported crown samples blend with adjacent
shoulder contact to remove raised corners. Sideways purse
handles/body follow Hand. Long hair
supports these side bags; backpacks use shoulder-length
hair. There are 232 downloadable templates: 212 adult choices and 114 child choices,
with overlap between the age pools. Girls' twenty crossbody templates are child-only.
`tools/check-model-carried-bags.mjs` checks every hairstyle/side, joint weights,
palm attachment, standing and every gait, seven views including underside,
downloads and age/sex rules. Whole-strap bounds and triangle spans reject loose
pieces toward the feet; the model unit suite covers missed fitting rays directly.
`tools/check-model-crossbody-straps.mjs` samples actual rendered pixels across
the front/rear shoulder and crown on both sides through every walk profile.
The two resized standard packs cover all eighteen backpack-compatible hairstyles, with fitted
straps and buried anchors. Random passenger includes each size equally alongside
the other complete variants. Lower webbing sweeps diagonally into the back with
a broad continuous curve. `tools/check-model-standard-backpacks.mjs` checks
pack dimensions, all four anchors, downloads and all walks in four views. The small daypack has a narrower
rounded crown and fuller base, measuring about 30 × 43 × 14 cm. It is available
for all ten male hairstyles and eight shorter female hairstyles. Its straps follow
the exposed coat backing and stay attached to the torso during every walk.
Both bag sizes use smooth rear strap bridges, with coat support recessed only
under the torso sections. The small pack's closed front overlaps the coat to
remove side slits. `tools/check-model-backpack-outline.mjs` samples the rendered
rear ribbons across their width to reject pale shards and holes while walking.
The shoulder crown fits downward onto the garment with 1.5 millimetres
of base clearance. `tools/check-model-shoulder-line.mjs` checks both front/back
outlines for raised corners in standing and all three walks, at every bag size.
The check includes the outer sleeve crown. The coat lining stays below that
outline; shoulder support recesses downward and splits along the neckline so
its triangles cannot form pale slivers or jagged material edges beside the straps.

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
Restart the dev server after adding new GLB filenames so Vite refreshes its public asset list.
Generated assets do not trigger reloads halfway through a batch. Exports prepare
complete temporary files and retry Windows reader locks before publishing them.
For a male-only edit, `node model/scripts/prepare-assets.mjs --character=male`
refreshes those exports and retains the complete shared manifest. The default
command still prepares both sexes.

After building, `node tools/check-model-preview-options.mjs` serves the production
preview and checks age restrictions, separate dimensions, URL reloads, scaling
during animation, reset/random controls and both languages. Captures go to
`.preview/model-options/`. `node tools/check-model-service.mjs` checks the
existing character, hair, bag, playback and download controls on the dev service.

`npm --prefix model test` runs deterministic preview rules: age-dependent limits,
old URL clamping, reset midpoints, child hair/bag restrictions, GLB scale axes,
20/80 random distribution and equal model choice within each age pool. Side-bag
tests also pin mirrored carrying-arm clearance, normal purse arm motion, hidden
alternative metadata and intact free strap anchors when garment fitting rays miss.
The browser
check also exercises every eligible child template through all three walk profiles.

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
exports directly into ignored `public/models/`. It adds the approved male
geometry with the same slow/medium/fast clips, generated from the game's walk
profiles, plus the remaining male variants. Bagless variants remove straps and close the
jacket back; cropped variants replace the hair with a smooth head-skinned scalp.
`provenance.json` records the original male source hash and generation
inputs. The source assets remain in `prototypes/`; generated GLBs do not need to
be committed twice. Node 24+ is needed by the preparation scripts.

Production is self-contained: `model/dist` includes all 232 GLBs, reference art,
profiles, and bundled viewer code. It does not request game dependencies or
prototype paths at runtime. Set `VITE_WEB_URL` and `VITE_GAME_URL` when building
to change the two navigation links. No cloud deployment is configured by this change.

These 232 exports now belong to the historical viewer. The active game uses
the selected soft-human catalogue described above. `npm run bake:passengers`
generates its offline atlases; legacy export preparation remains available for
historical review.

To refresh the art after approving models, run **`npm run art:models`** at the root.
It regenerates the reviewed exports and game atlas, builds the game, captures
all active adult and child recipes in standing and
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

`npm --prefix model test` pins ten actual hair appearances per sex, head skinning
and every compatible bag permutation. `node tools/check-model-hairstyles.mjs`
checks all exported templates standing and through each walk in four views,
English/Chinese options, downloads and age rules. Head contact sheets are saved
in `.preview/model-hairstyles/`.

The model-art command uses dedicated `.preview/model-art/` captures and free
browser ports, so it can coexist with other local previews.

## Approved clothing

The **Outfit** selector adds ten approved bagless outfits per sex for adults
and children beside the approved jacket. Women and girls have six long/midi skirts
(A-line, slim and pleated) and four trouser fits. Men and boys have ten combinations of fitted/relaxed/short/long
tops and straight/tapered/wide trousers. All tops are jacket-free and retain the
reviewed neckline, sleeves, head and hands. The palette stays strictly greyscale;
**Swap top / bottom greys** exchanges garment tones without repainting skin,
hair or shoes. Outfit and swapped tones persist in the URL (`outfit`, `tones`).

`src/characters/outfits.js` retains the continuous source sleeves, underarm
lining and back closure, fits every garment layer together and closes the old
front opening with one top colour and a continuous hem. Do not cut the sleeves
at a fixed X coordinate or remove the moving lining. Skirts retain the complete
legs underneath. `skirt-motion.js` fits a closed pelvis-skinned surface around
the actual leg positions and exports 24 clearance morphs per walk (72 total),
with matching weight tracks in all three clips. Standing uses the fitted base;
walking smoothly interpolates the reviewed clearance poses. These are authored
stylized garments, with no cloth-physics simulation. The shared catalogue appends
forty bagless game entries: all twenty outfits in
both top/bottom grey arrangements. Each uses the reviewed bob (female) or
original male hair, and enters both adult and child pools. The original 192
hair/bag templates retain their order. Clothing does not yet support bags.
Children use the same fitted garments and walk morphs with the
existing child height/width/depth transform applied afterward; changing age
preserves the outfit and grey arrangement. Every age-eligible hairstyle remains
available, and boys cannot select bald hair.

The viewer downloads the selected outfit, hairstyle and grey arrangement as a
real base-size GLB with all three walk clips. `npm --prefix model run export:outfits`
also writes forty reproducible GLBs and a source/output hash manifest into
`.preview/model-outfits/glb/`, using the current reviewed bagless exports.
`node tools/check-model-outfits.mjs --orbit` checks all twenty in four standing
views and 72 walk poses, plus 16 intermediate orbit angles in standing and four
fast-walk phases. Skirt-only/leg-only GPU passes reject visible leg skin through
the fabric while allowing hands in front and exposed ankles below the hem.
The unit test independently checks geometric containment at 48 phases per gait,
including between morph keys, and rejects the same walk with skirt motion
disabled. It also pins intact source torso/lining triangles and closed hems.
Swap/reload/GLB download, age/bag rules and bilingual labels remain covered.
The game baker samples the exported skeleton and skirt morph clips together,
including morph trajectories in vertex identity and retaining shared animated
weights on simplifier parts. `passenger-clothing` compares actual baked skirt
points with the reviewed GLBs across all three gaits and rejects skeleton-only
sampling. Authored greys are retained as exact palette stops.
The game-only exterior pass omits inward garment walls/caps and covered thighs,
and trims trouser waists beneath the top. This avoids hidden support surfaces
showing through the game's 70% material; downloadable GLBs remain closed.
Lossless frame-delta packing keeps the expanded pose atlas below the tracked
asset budget without reducing any geometry or animation frames.
Lineups, gait captures and orbit sheets go into `.preview/model-outfits/`.
Add `--child` to audit all twenty at child proportions (captures go into
`.preview/model-outfits/children/`), including age switching and child hair rules.
`--size=short-wide` and `--size=tall-narrow` exercise the child size limits.

### Background music auditions

The sound studio includes eight local 90-second music excerpts with a three-second
fade out: Dream Culture, Skyline, Sunset Plains, Vanilla Sky, Blue Lagoon, caller,
monoliths and booya-b. Play individual tracks or cycle the collection with Next
and automatic advance. The native player controls music volume/pause/seek; Master
volume applies to music too. Stop all and hiding the page stop music playback.
Music can play over ambient scenes. Nothing is added to the game's soundtrack.

`python model/scripts/collect-music.py` regenerates excerpts using FFmpeg. Source
pages, artist credit, license links, download identifiers, modifications and
SHA-256 hashes are in `public/sounds/music/manifest.json`. CC BY 4.0 excerpts
require attribution; the other excerpts use their CC0 option. Full recordings
remain linked on each card. The browser sound checker plays all eight files and
checks Next, end-of-track advance, Stop all, duration and responsive layout.

## Soft human motion study

Open [soft-human.html](http://127.0.0.1:5175/soft-human.html) from **Soft human**
in the model library. This separate preview follows the supplied Human: Fall Flat
references: a blank rounded head, continuous white body, mitten hands, short broad
legs and a removable soft cap. The geometry is an original procedural implicit
sculpt, not extracted game geometry. It does not change the reviewed crowd library.

Controls include walk, idle, raised arms and airborne pose, limb softness,
playback speed, pause/reset, nudge, skeleton overlay and four camera views.
The live animation uses deterministic 120 Hz damped angular springs following
procedural targets. It demonstrates pose lag and overshoot, not full active
ragdoll physics: there are no rigid-body contacts, balance controller, grabbing,
self-collision or volumetric soft-body simulation. Feet are not contact-solved.

### Research (27 October 2026)

- [Developer introduction on PlayStation Blog](https://blog.playstation.com/?p=190612)
  describes Human: Fall Flat's physics-based character; the developer identifies
  Bob as a fully active procedural physics ragdoll in the discussion.
- [Unity configurable joints](https://docs.unity3d.com/Manual/class-ConfigurableJoint.html)
  document target rotation, spring/damper drives, joint limits and force limits.
  A soft-looking surface does not require volumetric soft-body simulation.
- [Sergio Abreu's active-ragdoll implementation](https://github.com/sergioabreu-g/active-ragdolls)
  demonstrates separate animated target and physical bodies with joint rotation
  drives. A complete implementation should add contacts, mass distribution,
  bounded joint drives, balance/stepping and explicit grip constraints.

The study intentionally implements only the pose-following layer. Its spring
acceleration is `stiffness * (target - angle) - damping * angularVelocity`;
softness lowers stiffness and damping. The fixed timestep and frame-delta clamp
keep tab resumption bounded. Skin weights blend the continuous sculpt across
an eleven-bone rig; surface normals come from the implicit field gradient.

Source: `src/soft-human/`. Rebuild the standalone rig using
`node model/scripts/export-soft-human.mjs`; this round-trips the GLB and writes
`public/soft-human/soft-human.glb` with a provenance/hash manifest. That file is a
bind-pose rig; the page's Download button exports the current pose. Procedural
motion and physics are not embedded as animation clips.

Validate with `node --test model/test/soft-human.test.mjs`,
`node model/node_modules/vite/bin/vite.js build model` and
`node tools/check-soft-human.mjs`. The browser check covers all motion modes,
finite skin attributes, normalized weights, nudge recovery, shader compilation,
four rendered views and compact layout. Captures live in `.preview/soft-human/`.

### Soft human wardrobe

The soft-human page also offers five independent clothing choices: plain white,
commuter jacket, striped explorer, pink trail jacket and summer stripes. Pair any
outfit with no backpack, a small daypack or a hiking pack (15 combinations).
The hiking pack adds a top flap and bedroll. Palette-matched continuous closed
shoulder ribbons follow the actual posed skin, while the pack follows Chest; clothing uses the body's existing
skinning. The slimmer reviewed body and head proportions remain the source.

Garments are fitted colour regions on the continuous skin, with triangle splits
at hems, sleeve ends, stripe bands and the jacket's centre opening. They are not
cloth simulation or separate loose fabric shells. Material boundaries and skin
weights survive GLB export without custom shaders. The Download button includes
the current clothing, pack and cap visibility. The original plain rig remains
available alongside reproducible clothed examples:

- `node model/scripts/export-soft-human.mjs --outfit=commuter --backpack=daypack`
- `node model/scripts/export-soft-human.mjs --outfit=trail --backpack=hiking`

These write separate named GLBs and source/hash manifests under
`public/soft-human/`, retaining the base `soft-human.glb`. The wardrobe builder is
`src/soft-human/wardrobe.js`. `model/test/soft-human-wardrobe.test.mjs` checks all
15 combinations for unchanged skin surface area, normalized weights and pack
ownership, then round-trips the selected colours and pack through GLB.
`tools/check-soft-human.mjs` exercises both selectors, all combinations and
shader compilation, with front/side/back captures per outfit in `.preview/soft-human/`.


The soft human's smaller head now sits on a visible, narrower neck. The neckline
is a curved cut split into the garment triangles, rather than a full-width
horizontal skin band. Backpack straps are fitted across both edges to the actual
clothed surface. They share the body rig; `strap-fit.js` corrects barycentric
skinning error from the posed source triangles, with no per-frame raycasting.
This matters at raised shoulders, where an interpolated-weight ribbon alone can
still penetrate the jacket. Both packs are checked over 24 timeline samples in
each of idle, walk, reach and float, with 9 mm inner and 16 mm outer clearance
at the sampled strap vertices. A posed GLB round-trip checks the fitted placement.
This is a preview-only surface attachment, not a cloth/contact solver.

### Formal outfits, carried bags and children

Soft-human clothing now also includes navy and charcoal suits and a beige blazer,
with separately split shirt fronts, ties, lapels, cuffs and shoes. The bag selector
adds left/right shoulder, crossbody, handbag and small-purse variants, adapting the
shapes and attachment rules in `src/characters/carried-bags.js` to the soft rig.
Torso bags use thin X-depth panels in Y/Z; handheld bags and their closed handles
follow the forearm's mitten anchor. Carrying reduces the arm swing and adds side
clearance. Shoulder and diagonal crossbody straps use the same fitted-skin path
as the backpacks. These new preview choices do not change the reviewed game atlas.

The adult/child selector scales the child to 65% height and 70% width/depth,
matching the existing game's child base proportions, with a modest 8% relative
head adjustment. Clothes and bags are fitted before applying the age transform;
root motion scales with height. All clothing and bag selections remain available
when changing age. This is a single faceless child base, not separate boy/girl
hair or body variants. Live downloads include the selected age, outfit and bag.

Reproducible export examples:

- `node model/scripts/export-soft-human.mjs --outfit=navy-suit --backpack=crossbody-right`
- `node model/scripts/export-soft-human.mjs --outfit=beige-blazer --backpack=purse-right --age=child`

`src/soft-human/carried-bags.js` owns the adapted bags. Focused tests check adult
and child attachment, all four actions, shirt/tie/lapel material regions, posed
GLB placement and strap clearance. Browser checks exercise all carried-bag choices
at both ages and capture oblique/side views plus each formal outfit.

### Station activity previews and bag attachment

The action list is derived from `game/src/sim/activities.ts` and the shared model
interaction labels: 20 actions include slow/medium/fast walking, all 14 non-walk
game activity IDs (including left-hand escalator), plus idle, arms-up and airborne
studies. The soft rig adapts each activity through deterministic contact-targeted
poses and the existing two-bone IK solver. It reuses production station equipment
through `interaction-equipment.js`; these are soft-rig adaptations, not the baked
animations of the reviewed in-game character. Use the timeline to pause/scrub
approach, reach, dwell and release, and the equipment toggle to inspect the pose.
The camera follows root travel on gates, doors and escalators. Child contact
poses retain adult-sized equipment, with lower reachable controls; seated children
may dangle their feet. Slow/medium/fast use the game's shared 1.12 s cycle and
speed ratios for stride, rather than speeding up a fixed tiny step.

`soft-human/activities.js` owns the adapted poses. `bag-connectors.js` adds closed
end sections between each fitted shoulder/crossbody ribbon and the bag's actual
front/rear attachment points. Surface fitting no longer leaves those anchors
projected inward onto the torso. The end sections follow both the posed skin and
the chest-owned bag; they are included in current-pose downloads.

Run `node --test model/test/soft-human*.test.mjs` and
`node tools/check-soft-human-activities.mjs` after the model build. Tests cover
catalogue completeness, deterministic scrubbing, connector continuity at both
ages and motion samples, finite poses and equipment/GLSL behavior. Browser
captures and the 20 × 2 ages × 4 timeline sample report live under
`.preview/soft-human/activities/`. GLB downloads still contain the current pose,
not procedural animation clips or the surrounding equipment.

### Body / equipment clearance

Soft-human station poses now use the production seat mesh's top and front edge.
The feet stay planted while the hips lower onto the front of the seat. Only after
seat support is established do the legs relax and the body settle back; standing
reverses this order, planting the feet before the hips rise. The body root has no
airborne lift. Children use a visible step sized to the seat height. The short
shins can dangle during seated rest, with about 4–6 mm of seat clearance.

Both free arms stay inside the escalator/gate lane. Soft escalator anchors account
for palm radius at the rail's inner edge, use a shorter rail reach for children,
and place the complete foot footprint on the actual horizontal treads/comb plates.
Gate traversal follows the clear lane and releases the reader before walking.
The soft-preview door swings away from the approaching passenger; the character
releases before passage, follows the clear side and lifts over its threshold.
Lift poses use the actual cabin floor. Wash arms approach above the basin rim,
keep knuckles away from the faucet, and children use a small preview-only step.
The reviewed character viewer keeps its original equipment behavior; the extra
support and door policy require the soft-body equipment option.

`node tools/check-soft-human-clearance.mjs --all` scans the full 14 station
activity timelines for adults and children every 0.25 s (1,104 poses). It samples
all distinct posed body vertices, including clothing-cut vertices and skin-weight
seams, against production boxes/instances, hollow lathe profiles, seat/rail tori,
faucet tubes and escalator glass/deck solids, with a nominal 2 mm contact tolerance.
Water streams are deliberately excluded from solid collision checks. `--seated`
uses 0.125 s samples for both sit/stand timelines; `--escalators` checks both hands
on the stairs. Side/front/back captures and zero-penetration reports are saved
under `.preview/soft-human/clearance/`. These are deterministic preview-pose
constraints and regressions, not a general runtime physics collision solver.


Resting arms use a nearly full-length downward reach, with a slight forward elbow
bend; the old high wrist target forced the elbow inward. Washing uses a downward
elbow plane and a closer hand target rather than raising elbows beside the head.
`tools/check-soft-arm-poses.mjs` records adult/child neutral, ticket and wash views
and checks elbow height and lateral position. Sit/stand regressions sample every
0.05 s and require either foot support or seat contact, with fixed ankle targets
before sitting and before rising. `--seated` clearance captures include multiple
side-view transition frames, so reviewing the resting pose alone is insufficient.

Soft-human bags now use their own tapered fabric shell (`soft-human/bag-shell.js`),
with shoulder-to-underarm backpack loops and explicit pack-end connections.
They do not reuse the reviewed passenger bag meshes. Free station-activity arms
use nearly the full chain length (under 0.20 radians of elbow flexion); mitten
material classification includes the entire hand below the original wrist line.
`soft-human-activities.test.mjs` and `soft-human-wardrobe.test.mjs` guard the
resting elbow, skin-coloured hand tips, and short connected backpack loops.
The arm capture tool includes both sides, front, oblique and back views.

Carried bags use a front-of-hip placement and a lower diagonal strap return,
clear of the relaxed arm. Resting station arms open slightly away from the ribs;
they tuck in only while passing narrow gates/doors or riding escalators.
Hand-held bags retain their mitten grip but hang in the body frame, with outward
rotation when posed skin would enter the shell. Shoulder/crossbody bags have
bounded positional clearance fitting, and both strap connectors follow the
result. `soft-human-bag-clearance.test.mjs` checks all body vertices against
inset shell bounds for both ages, eight carried bags and station pose samples.
This is preview accessory fitting, not a cloth or rigid-body physics simulation.

Current soft-human art direction prioritizes smooth authored motion over strict
accessory clearance. Carried bags no longer scan the skin or jump away from it.
Shoulder/crossbody shells remain at the hip; a continuous 38 mm rounded,
skin-fitted strap follows the chest and a short tapered connector closes the gap
to the bag. Hand-held bags hang from their grip without collision-driven rotation.
Some overlap is accepted. The hand sculpt uses smaller palms and tapered
forearms. The bag regression now checks stable placement and continuous
attachment, rather than collision refusal. At gates, doors and escalators the
free arm tucks inside the equipment lane; elsewhere resting arms stay slightly
away from the ribs.
