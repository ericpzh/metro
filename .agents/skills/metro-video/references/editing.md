# Editing, Retakes & Cache Rules

Run all commands from the repo root. Active scene IDs live in `tools/demo-video/plan.mjs`
(`npm run video:plan` prints the current schedule): `01-reveal`, `02-underground`,
`03-interchange`, `04-boarding`, `05-rolling`, `05-tianhe-flythrough`,
`05-tianhe-concourse`, `08-section-tianhe`, `08-cube`, `09-demand`, `montage-placement`,
`city-*`, `stock-A/B/C/D/L`, `10-play`.

## Choosing the Smallest Complete Workflow

| Change | Required Work |
|---|---|
| Game geometry, models, or sim | Rebuild and retake affected scenes (or run full capture); roof/train changes need all visible train takes including all 5 bridge cuts. |
| `video/demo-station.metro.json` or `demo-camera.json` | Run `plan.test.mjs`, verify with `check-authored.mjs --gestures`, retake `montage-placement`, then run `--edit-only`. |
| Copy, Studio graphics, music, or mix | Recompose compatible cached takes with `--edit-only`. |
| Duration, rate, stage, level, spin, size, or lang | Retake affected scenes; `--edit-only` rejects mismatched takes. |
| Scene reorder with unchanged takes | Verify compatibility, preserve `take.json` / `sources/*.json`, run `--edit-only`. |

## Partial Regeneration Recipes

```powershell
# Retake specific scenes (exits after recording; does not compose the MP4)
npm run video:demo -- --scene montage-placement --output .preview/demo-video/<run>

# Always retake all 5 bridge cuts together in order so nose cut points carry forward
npm run video:demo -- --scene stock-A,stock-B,stock-C,stock-D,stock-L --output .preview/demo-video/<run>

# Recompose all takes, Studio graphics, audio mix, and delivery checks
npm run video:demo -- --edit-only --output .preview/demo-video/<run>
node tools/demo-video/check-playback.mjs .preview/demo-video/<run>

# Preview Studio overlays on existing takes/*/before.png without full encode
npm run video:demo -- --design-only --output .preview/demo-video/<run>

# Resume an interrupted capture while fingerprints match
npm run video:demo -- --resume --output .preview/demo-video/<run>
```

- `--stills` captures `before.png` prep frames and exits. Because `montage-placement`
  starts empty, use `check-authored.mjs` for P1/middle/P2 full-layout stills.
- `--capture-only` records takes without running `editVideo` or `validateVideo`.
- `--skip-build` skips `npm --prefix game run build`; use only when `game/dist` is
  already current.
- `--design-only` runs `renderGraphics` in review mode (`review: true`), so it does not
  throw on audit errors — inspect `graphics/layout-audit.json` manually.

## Cache Fingerprints (`--resume` vs `--edit-only`)

`tools/demo-video.mjs` builds `sourceHash` from `game/dist/`, `tools/demo-video/`,
`tools/demo-video.mjs`, `video/demo-station.metro.json`, `video/demo-camera.json`,
`web/src/artworks.js`, `web/src/i18n.js`, the three demo station JSONs
(`demo-station.json`, `tanwei-station.json`, `tianhe-station.json`), and
`.agents/skills/metro-repo/references/performance.md`.

- `--resume` reuses a take only when `takes/<id>/take.json` has an identical `key`
  (`sourceHash` + `settings` + `shot`) and passes compatibility checks. Any edit to the
  hashed files invalidates `--resume`.
- `--edit-only` skips the game build, browser launch, and `sourceHash` check while still
  enforcing `seconds`, `playbackRate`, `stage`, `simSpeed`, `level`, `spin`, `panels`,
  `language`, `theme`, `width`, and `height`. It cannot detect stale game visuals —
  retake affected scenes first.
- Never forge cache keys. Keep `take.json`, `sources/*.json`, and `manifest.json` so
  mixed retakes stay attributable. A fresh `--output` directory has no footage; record it
  fully or copy complete, reviewed `takes/<id>/` folders and their `sources/*.json`.

## Save, Camera, Timing & Audio Rules

- **Working save edits:** Back up `video/demo-station.metro.json` under `.preview/`
  before replacing it with a user-supplied native save. Run `plan.test.mjs`,
  `export-save.mjs`, and `check-authored.mjs --gestures`. Update intentional design
  assertions in `plan.test.mjs` if the brief changes, but never weaken save fidelity,
  `checkModulePlacements`, or east-to-west ordering. New module families may need
  `isFrameModule` or grouping support in `authored-layout.mjs`.
- **Timing & sweeps:** Delivery length is `seconds`; raw capture length is
  `captureSeconds = seconds * playbackRate`. Keep every scene on the `30 fps` grid
  (`seconds * 30` integer). Total-length edits must keep `VIDEO_SECONDS`, `plan.test.mjs`,
  `web/src/i18n.js`, and `video/demo-camera.json` (`frameSeconds`/`endingHoldSeconds`) in
  sync. City and train `montageSweep` angles must carry forward continuously.
- **Native picking & camera limits:** Native FOV floors at `30°`; frame tighter by moving
  camera/target. Coordinates are Z-up (floor cell `z` picks at top `z + 1`; lift top sits
  above `to.z`). Recompute pointer targets as the camera moves and never fake a missed
  gesture by injecting modules.
- **Audio & provenance:** `audio.mjs` selects one manifest track driving the mix, closing
  card, `CREDITS.md`, and `audio-credits.json`. Event cues (`place.wav`, `select.wav`)
  use `sourceAt / playbackRate` minus `trimStart` so retimed scenes keep normal pitch;
  ambient beds (`crowd.mp3`, `train.mp3`) also stay at normal pitch. Keep preview commits
  separate from document commits — never inject train poses, swap stills for placement
  takes, or overwrite the user's working save.
