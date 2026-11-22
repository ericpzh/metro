---
name: metro-video
description: Generate, edit, retake, and verify the Station Designer gameplay demo video using tools/demo-video and video/. Use for scene planning, real browser recordings, camera choreography, Studio graphics, audio mixes, or video retakes.
---

# Station Designer Demo Video

Own the repeatable gameplay demo pipeline in `tools/demo-video.mjs`, `tools/demo-video/`,
and `video/`. Run all commands from the repository root. Read
[editing and retakes](references/editing.md) for partial regeneration and cache rules, and
[the demo-video runbook](../../../tools/demo-video/README.md) for the Chinese runbook.
Route game runtime/renderer changes to [metro-game](../metro-game/SKILL.md), website copy
or brand asset changes to [metro-web](../metro-web/SKILL.md), and repo-wide conventions to
[metro-repo](../metro-repo/SKILL.md).

## Film Contract

The default deliverable is **70.2 s**, **2560 × 1440**, **30 fps**, H.264 (`yuv420p`,
BT.709) / AAC (`--lang zh` default; `--lang en` supported). Editorial overlays use the
light Studio theme while recorded editor UI keeps the default Blueprint theme at High /
native quality.

- **Main tour (`plan.mjs`):** Follows the website's four sections across Tanwei, Zoo, and
  Tianhe Park — exterior reveal, Zoo & Tanwei exploded views (walls kept; hides −5/0 m at
  Zoo and −5 m at Tanwei), Zoo/Tanwei platform boarding, Tianhe Line 11 platform (`4 s`,
  `-10`) and concourse (`4.1 s`, `-5`) fly-throughs (`1×` sim retimed `4×` with FFmpeg MCI
  interpolation), sole moving cutaway (`08-section-tianhe`, `6 s` at `4×`), perspective
  ViewCube drag (`08-cube`, walls kept, no ghosted levels), and demand preview
  (`09-demand`, waits for `06:34:00` and ≥ 45 concourse passengers, records `8.8 s` at
  `1×`, retimes `4×`, slider drag is preview-only).
- **Closing montages & outro:** One continuous build (`montage-placement`, `22.5 s` at
  `8×`, `180 s` raw capture, `trimStart: 1`), 8 city styles (`city-*`, `0.4 s` each,
  continuous 180° sweep on a Zoo entrance head-house with two down escalators), 5 rolling
  stock classes (`stock-A/B/C/D/L`, `0.8 s` each, continuous 50° front-3/4 nose-tracking
  sweep on a 1200 m bridge at `0.18×` sim speed, Guangzhou line 1–5 colours, third rail
  for A/B/C and catenary for D/L), and a `3.6 s` CTA outro (`10-play`) crediting music.

## Architecture & Source of Truth

- **`tools/demo-video.mjs`:** CLI orchestrator — builds `game/dist`, serves locally,
  records isolated Chrome CDP screencast takes (`record.mjs`), composites graphics and
  audio, validates delivery, and writes `manifest.json`, `review.html`, `poster.jpg`, and
  `contact-sheet.jpg`.
- **`tools/demo-video/plan.mjs` & `plan.test.mjs`:** Bilingual timeline (`VIDEO_SECONDS =
  70.2`, 30 fps aligned), sweep angles, and contract tests for schedule, replay, fixtures,
  copy, and closing credits.
- **`video/demo-station.metro.json` & `video/demo-camera.json`:** User-owned working save
  and low-angle P1→P2 camera/timing config (`fov: 30`, `frameSeconds: 48`,
  `endingHoldSeconds: 16`). Recording writes its own snapshot and never overwrites an
  existing working save.
- **`tools/demo-video/authored-layout.mjs` & `authored-shot.mjs`:** Drives
  `montage-placement` directly from the working save — validates with
  `checkModulePlacements`, builds the frame (Wall tool `G` runs + right-click openings,
  single-drag exterior paving + lawn overrides), places grouped equipment
  (`roadside-fence`, `tactile`, `gate`, east equipment, `tvm`, interior glass `fence`,
  west equipment), and performs native two-stage lift extension. Do not edit
  `interior.mjs`, `check-save.mjs`, or `video/demo-station-layout.json` for active
  placement work.
- **`tools/demo-video/capture.mjs`, `tianhe.mjs`, `views.mjs`, `fixtures.mjs`,
  `montage.mjs`:** Scene setup, native gestures, exploded framing, bridge nose tracking,
  and `verifyBridgeCuts` continuity enforcement.
- **`tools/demo-video/design.mjs`:** Renders transparent Studio overlays, route rail, and
  placement phase cards using `web/src/i18n.js` (`video`),
  `web/src/assets/brand/station-designer-mark.png`, and game i18n labels; outputs
  `graphics/layout-audit.json`.
- **`tools/demo-video/audio.mjs` & `media.mjs`:** Selects `sunset-plains` (**Sunset
  Plains** by Yoiyami, CC0) from `game/public/audio/music/manifest.json`, mixes ambient
  beds (`crowd.mp3`, `train.mp3`) and pitch-preserved cues (`place.wav`, `select.wav`),
  encodes MP4, exports `CREDITS.md` and `audio-credits.json`, and validates output specs.
- **`tools/demo-video/catalogue.mjs`:** Parses the `| Equipment / decor model name |`
  table in [performance.md](../metro-repo/references/performance.md) (`inventorySource`)
  and `game/src/app/store/catalog.ts` to sort showcase items by High-LOD triangle count.
  `tools/demo-video.mjs` also hashes `performance.md` into `sourceHash`, so preserve that
  table header and column format when updating performance docs.
- **Outputs in `video/`:** Git tracks `demo-station.metro.json`, `demo-camera.json`,
  `station-designer-thumbnail-zh.jpg`, and `station-designer-thumbnail-en.jpg`. Rendered
  `*.mp4` deliverables and `.preview/` directories are gitignored.

## Commands

Requires Node with native TypeScript loading, Chrome/Edge, `ffmpeg` and `ffprobe` on
`PATH`, and installed `game/` and `web/` dependencies. Keep `--gpu hardware` (default) for
delivered footage; `--gpu software` is diagnostic only.

```powershell
# Inspect current schedule (writes storyboard.md and timeline.json, then exits)
npm run video:plan

# Run schedule, authored-save replay, fixture, copy, and credit contract tests
node --test tools/demo-video/plan.test.mjs

# Full build, capture, graphics, audio mix, and delivery checks in a clean folder
npm run video:demo -- --output .preview/demo-video/<run>

# After save/camera edits (with current game/dist): native load, P1/mid/P2 stills, gestures
node tools/demo-video/check-authored.mjs --gestures

# Decode the delivered MP4 in Chrome and seek every scene midpoint
node tools/demo-video/check-playback.mjs .preview/demo-video/<run>

# Standalone native save serialize/parse round-trip check
node tools/demo-video/export-save.mjs .preview/demo-video/<run>
```

**CLI flags (`tools/demo-video.mjs`):** `--plan`, `--lang zh|en`, `--output <dir>`,
`--width <even, ≥ 640>` (default `2560`), `--height <even, ≥ 360>` (default `1440`),
`--gpu hardware|software`, `--scene <id[,id...]>`, `--stills`, `--capture-only`,
`--skip-build`, `--resume`, `--edit-only`, `--design-only`. Always pass `--output`
explicitly for new revisions rather than relying on the built-in default path.

## Verification & Delivery

- **Automated checks:** `validateVideo` (`media.mjs`) checks `70.2 s` (±0.08 s),
  configured dimensions and `30 fps`, H.264 `yuv420p` + AAC, integrated loudness
  `−18 ± 2 LUFS`, and true peak `≤ −1 dBTP`. `verifyBridgeCuts` (`montage.mjs`) enforces
  locked nose tracking and cut continuity across `stock-A`–`stock-L`. `renderGraphics`
  rejects any overflow or broken image in `graphics/layout-audit.json` during full/edit
  runs, and `captureOne` aborts on any `window.__videoErrors`.
- **Manual review:** Inspect the final MP4, `review.html`, and `contact-sheet.jpg` for
  build start/middle/end, all city/train cuts, camera continuity, zero caption overlap,
  and readable credits. Verify `takes/montage-placement/after-stage.json` matches
  `video/demo-station.metro.json` and `take.json` records clean native gestures and lift
  extension.
- **Boundaries:** Deliver the local MP4 path (plus save/review page when helpful). Never
  overwrite an existing `video/demo-station.metro.json` and never publish or deploy the
  website from this workflow.
