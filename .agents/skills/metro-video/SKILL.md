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

The current film is 72 seconds, 2560 × 1440, 30 fps, H.264/AAC. All editorial copy
is Chinese with designed Studio cards and navigation. Actual editor controls use
the default Blueprint theme. Music is **monoliths by SpringySpringo**, from the
game's approved music manifest, with credit in the ending and exported credits.
Keep these choices unless the user changes the brief.

The main tour follows the website's four sections and uses Zoo and Tanwei.
Immediately before the ending: one continuous 23.5-second build at 8×, eight
cities at 0.4 seconds each, then five train types at 0.8 seconds each. City cuts
share a continuous 180° orbit; train cuts share 150° (30° per type). Trains really
run on a 1200 m bridge in an empty map, in Guangzhou line 1–5 colours. City
entrances say 动物园 / Zoo. Exploded views hide walls; framing fills the screen.

The build uses the user's save: frame first, then equipment/decor east to west,
with a continuous low camera from P1 (east/south exterior looking west) to P2
(west/south interior looking east). No roof; AC outdoors; retain indoor/outdoor
separation. Drag continuous paving, railings and tactile paths; extend the same
lift upward rather than placing separate shafts. The approved save currently
has 1302 cells and 304 modules; these counts describe this revision, not a limit
on future user edits.

## Source of truth

- `video/demo-station.metro.json` is the editable native working save. Preserve
  the user's IDs, coordinates, rotations, variants, materials, signs and posters.
  Replace it only when the user supplies or authorizes a revised working save;
  keep a backup under `.preview/`. Rendering exports its own snapshot and must
  not overwrite an existing working save.
- `video/demo-camera.json` holds P1/P2 poses, lens, westward pan and frame/hold
  durations. Those durations are raw recording seconds (188 seconds at present),
  not the delivered 23.5 seconds. Do not depend on clipboard screenshots remaining
  available: the numeric camera endpoints are committed here.
- `authored-layout.mjs` reads the native save, groups consecutive runs, bundles
  booth children/signs, separates the frame and sorts equipment east to west.
  Tactile paths precede obstructing fences at the same east coordinate. It also
  splits the two-stage lift demonstration and validates the exact replay.
- `authored-shot.mjs` performs the build, real gestures and continuous camera.
  Do not copy new object positions into legacy `interior.mjs` or the old
  `demo-station-layout.json`; they are not the current authoring source.
- `plan.mjs` owns durations/order; `capture.mjs`, `montage.mjs` and `views.mjs`
  own framing and native interactions. `fixtures.mjs` owns independent stages.
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
credits. The renderer checks 72 seconds, 2K/30 fps, 8-bit yuv420p, H.264/AAC,
approximately −18 LUFS and true peak ≤ −1 dBTP. Playback must decode and seek
all scenes. Verify `after-stage.json` matches the working save and inspect
`take.json` for real gestures, lift extension, east-to-west actions and no errors.

Deliver the MP4 with an absolute local media path, plus the editable save or
review page when useful. Commit source, skill and authored inputs when requested;
keep unrelated work out. This workflow does not publish or deploy the website.
