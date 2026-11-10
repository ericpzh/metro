---
name: metro-video
description: Generate, regenerate, edit and verify the Station Designer gameplay demo video using tools/demo-video and the user-authored station save. Use for scene planning, real game recordings, camera moves, Chinese Studio graphics, audio mixes and video retakes in the metro repository.
---

# Station Designer video

Run from the repository root. Read [the video runbook](../../../tools/demo-video/README.md)
for commands, outputs and capture requirements. For editing or partial regeneration,
read [editing and retakes](references/editing.md) before choosing what to reuse.
Use `metro-game` for changes to game runtime and `metro-web` for changes to the
site's translation infrastructure; this skill owns the video pipeline.

## Accepted baseline

The current film is 70.2 seconds, 2560 × 1440, 30 fps, H.264/AAC. All editorial copy
is Chinese with designed Studio cards and navigation. Actual editor controls use
the default Blueprint theme. Music is **Sunset Plains by Yoiyami**, from the
game's approved music manifest, with credit in the ending and exported credits.
Keep these choices unless the user changes the brief.

The main tour follows the website's four sections and uses Zoo, Tanwei and
Tianhe Park. Tianhe Park has the sole moving section, a 4-second Line 11
platform fly-through and a 4.1-second concourse fly-through. Record both at 1×
simulation with a quarter-speed camera path, then retime by 4× and interpolate
for delivery. The population-flow shot keeps the −5 m concourse walls and
waits until 06:34:00 or later. Record it at 1× for 12 seconds and retime by 4×:
the crowd reads at 4× in the film, while the chart knob is preview-only so the
population is not rebuilt mid-drag. The perspective cube shot keeps the
station walls and hides ghosted levels.
Immediately before the ending: one continuous 22.5-second build at 8×, eight
cities at 0.4 seconds each, then five train types at 0.8 seconds each. The build
opens at its 1-second mark, when the first 1 m wall course is rising, and ends
as the camera completes; there is no hold on the finished frame.
City cuts share a continuous 180° orbit; train cuts share a continuous 50°
front-3/4 orbit (10° per type), with the train running at 0.18× simulation so it
does not whip past the chase point. Trains really
run on a 1200 m bridge in an empty map, in Guangzhou line 1–5 colours. A/B/C
use third rail and D/L use overhead wires. The city head-house fixture holds two
down escalators in its wellways. City
entrances say 动物园 / Zoo. Exploded views retain the walls and tighten the
framing. Hide the −5 m and 0 m levels at Zoo and the −5 m level at Tanwei.

The build starts with the user's station frame. The native Wall tool (G) draws
full-storey runs and carves openings. All equipment rows drag at the same
speed per block. Then the build places the roadside fences,
tactile paths and gates. Drag in the ticket-machine row before closing the
concourse with glass fences. The low camera moves continuously from P1
(east/south exterior looking west) to P2
(west/south interior looking east). No roof; AC outdoors; retain indoor/outdoor
separation. Drag continuous paving, railings and tactile paths; extend the same
lift upward rather than placing separate shafts. The approved save currently
has 1303 cells and 309 modules; these counts describe this revision, not a limit
on future user edits.

## Source of truth

- `video/demo-station.metro.json` is the editable native working save. Preserve
  the user's IDs, coordinates, rotations, variants, materials, signs and posters.
  Replace it only when the user supplies or authorizes a revised working save;
  keep a backup under `.preview/`. Rendering exports its own snapshot and must
  not overwrite an existing working save.
- `video/demo-camera.json` holds P1/P2 poses, lens, westward pan and frame/hold
  durations. Those durations are raw recording seconds (188 seconds at present),
  not the delivered 22.5 seconds. Do not depend on clipboard screenshots remaining
  available: the numeric camera endpoints are committed here.
- `authored-layout.mjs` reads the native save, groups consecutive runs, bundles
  booth children/signs, separates the frame and sorts the remaining equipment east to west.
  It paves the full outside footprint in one drag and then restores the authored
  lawn finishes. The roadside fences go first. Place the ticket-machine row
  before the interior glass fencing to keep the native drag targets exposed.
  The frame is silent and equipment cues follow actual placement.
- `authored-shot.mjs` performs the build, real gestures and continuous camera.
  Do not copy new object positions into legacy `interior.mjs` or the old
  `demo-station-layout.json`; they are not the current authoring source.
- `plan.mjs` owns durations/order; `capture.mjs`, `montage.mjs` and `views.mjs`
  own framing and native interactions. `fixtures.mjs` owns independent stages.
  In `capture.mjs`, the exploded-view offsets are viewport-relative native
  floor drags. Tianhe Park's demand shot waits for visible concourse passengers,
  records at 1× for 12 seconds and retimes 4×; its chart edit is preview-only.
  Re-record the five bridge takes together when changing their staging or pace.
  The camera tracks the rendered nose and the next take starts at the prior cut.
  Pantograph placement comes from the shared game builder. A roof geometry
  refresh requires retakes wherever affected trains are visible, including the
  D and L bridge takes. Keep all five bridge takes together for continuity.
- `design.mjs` owns Studio layouts; copy stays in `web/src/i18n.js` under `video`.
  `audio.mjs` selects music; `media.mjs` composes picture and mixes audio.

## Generate and verify

Need Node with native TypeScript loading (tested on Node 24), Chrome/Edge,
FFmpeg/FFprobe on PATH, and installed game/web dependencies. Keep hardware GPU
capture for the delivered footage; software mode is for diagnostics.

```powershell
npm run video:plan
node --test tools/demo-video/plan.test.mjs
npm run video:demo -- --output .preview/demo-video/my-revision
node tools/demo-video/check-playback.mjs .preview/demo-video/my-revision
```

Normal generation builds the current game, records isolated browser scenes,
renders transparent graphics, mixes audio and validates the final file. Start a
new output directory for a new revision so the accepted film remains reviewable.
The historical default is `.preview/demo-video/zh-studio-2k-v6`; pass `--output`
explicitly when revising it. MP4s, browser profiles, frame caches and reports live
under ignored `.preview/`, not in Git. A fresh checkout needs a full recording;
edit-only mode cannot recreate missing footage.

After a save/camera change, build the game and run
`node tools/demo-video/check-authored.mjs --gestures`. This opens the native file
input and writes P1/middle/P2 stills and gesture checks in the default v6 folder.
Inspect them; fixed-angle checks do not replace a full moving-camera take.
`check-save.mjs` is a legacy v5 diagnostic, not the current check.

Inspect the actual final film, build start/middle/end, all city/train cuts,
contact sheet and `graphics/layout-audit.json`. Check no caption overlap or
overflow, visible objects, smooth camera continuity, rapid cuts and readable
credits. The renderer checks 70.2 seconds, 2K/30 fps, 8-bit yuv420p, H.264/AAC,
approximately −18 LUFS and true peak ≤ −1 dBTP. Playback must decode and seek
all scenes. Verify `after-stage.json` matches the working save and inspect
`take.json` for real gestures, lift extension, east-to-west actions and no errors.

Deliver the MP4 with an absolute local media path, plus the editable save or
review page when useful. Commit source, skill and authored inputs when requested;
keep unrelated work out. This workflow does not publish or deploy the website.
