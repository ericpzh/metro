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
Station poses use the production equipment's active-hand contact heights.
Idle standing and all unused station-activity arms share the accepted escalator
rest pose: a modest spread outside the torso with a relaxed downward reach.
In side view the elbow angles back and the forearm angles forward, while frontal
elbow spacing and wrist position stay fixed.
This applies through approach, interaction and release, including gates,
elevators, doors, queues, sitting and toilet rest. Active hands blend out of the
rest pose toward their existing equipment target, while hand-held bags reserve
the carrying hand. Walking retains its original outward arm swing.
The escalator holding arm keeps its comfortable bend and lifts forward 30 degrees
at the shoulder in side view, preserving its sideways spacing and elbow bend.
Natural posture takes priority over resting-arm and escalator clearance;
equipment penetration is allowed. The selected model now replaces the game crowd. `src/soft-human/catalog.js`
derives all 440 clothing/bag recipes for both ages; `npm run bake:passengers`
generates the shared walking and activity assets offline. Game runtime remains
independent of the model app. See `game/src/assets/PASSENGERS.md`.

Run `node --test model/test/soft-human*.test.mjs`, build with
`node model/node_modules/vite/bin/vite.js build model`, then run the
`tools/check-soft-human.mjs`, `check-soft-human-activities.mjs`,
`check-soft-human-clearance.mjs --all` and `check-soft-arm-poses.mjs` browser checks.
`node tools/check-soft-escalator-pose.mjs` pins natural arm placement and zero
chest turn across both ages, both hands and the complete ride timeline.
Escalator clearance reports are diagnostic and do not reject equipment overlap.
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

## Sound studio

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

Start the optional server with `npm run dev:model` and open
[soft-human.html](http://127.0.0.1:5175/soft-human.html). The preview uses the
selected base described above. The research notes below document the earlier
procedural study.

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
