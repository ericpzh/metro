# Editing and retakes

Read from the repo root. Existing scene IDs come from
`tools/demo-video/plan.mjs`; use `npm run video:plan` to inspect the current plan.
Use an explicit output directory below; examples target the accepted local cache.

## Choose the smallest complete workflow

| Change | Work needed |
|---|---|
| New game geometry, models or simulation | Build and record affected footage; full generation is the safe default |
| User-edited working save or build camera | Validate replay, review reference poses/gestures, retake `montage-placement`, then edit |
| Studio copy, colours, card layout, music or mix levels | Recompose existing compatible takes using `--edit-only` |
| Scene duration, playback rate, stage, orbit arc, resolution or language | Retake affected scenes; the editor rejects incompatible cached takes |
| Reorder unchanged shots | Review compatibility, preserve each take's provenance, recompose |

```powershell
# An individual take; this stops after recording, without rebuilding the movie.
npm run video:demo -- --scene montage-placement --output .preview/demo-video/zh-studio-2k-v6

# Then compose ALL required takes, graphics, audio and checks in that directory.
npm run video:demo -- --edit-only --output .preview/demo-video/zh-studio-2k-v6
node tools/demo-video/check-playback.mjs .preview/demo-video/zh-studio-2k-v6

# Preview graphics against existing before.png stills, without a full encode.
npm run video:demo -- --design-only --output .preview/demo-video/zh-studio-2k-v6

# Resume an interrupted full generation if fingerprints still match.
npm run video:demo -- --resume --output .preview/demo-video/my-revision
```

`--scene` accepts comma-separated IDs. `--stills` captures preparation frames;
the placement preparation is intentionally empty, so use `check-authored.mjs`
for a separate full-layout camera preview. `--capture-only` records without editing.
`--skip-build` is appropriate only when `game/dist` already matches the intended
game build. `--design-only` is a review mode; inspect audit failures because it
does not reject them as a final render does.

`--resume` compares a broad fingerprint including game distribution, video tools,
working save, camera and copy. Changing any of these can invalidate all cache
keys. `--edit-only` explicitly reuses takes despite changed source fingerprints,
but still checks duration/rate/stage/orbit/panels/language/theme/resolution.
It does not prove footage matches new geometry or a new placement camera: decide
which scenes require retakes first. Never rewrite cache keys to bypass a failure.
Keep `take.json`, `sources/*.json` and `manifest.json` so mixed retakes remain
attributable. A new output directory has no footage; generate it fully, or copy
only reviewed, compatible complete take directories and their source records.

## Save, camera and timing edits

Copy an explicitly supplied edited native save to `video/demo-station.metro.json`
after backing up the previous revision. Run the replay tests and review any
assertions about the old approved layout (materials, roof, AC zone, lift height).
Update intentional design assertions when the brief changes; never disable exact
save fidelity, native placement validation or east-to-west ordering to pass a test.
New model families may need frame classification or grouping support in
`authored-layout.mjs`; do not silently drop them.

Timing uses `seconds` for the movie and `captureSeconds = seconds * playbackRate`
for recording. Changing total duration also requires `VIDEO_SECONDS`, the plan
validation/tests, locale-owned storyboard copy and build frame/hold scheduling
to agree. Keep shots aligned to the 30 fps grid. City/train sweep endpoints must
carry forward between cuts rather than restart at one angle.

The native lens stops at 30°. Frame by moving the camera/target, not by pretending
the lens changed below its native limit. The build uses Z-up world coordinates;
a floor cell at z is picked at physical top z+1. A low moving camera can hide a
drag endpoint behind a fence or wall. Keep native picking, a visible starting
anchor and the tool's dominant-axis snapping; verify the committed run matches
every expected cell before restoring authored IDs/configuration. A lift's visible
top is above its `to.z` anchor. Recompute pointer targets as the camera moves.
Do not fix a missed gesture by inserting models and claiming a native drag.

## Sound and provenance

Changing `audio.mjs` music selection must also preserve the ending credit driven
from that selection and exported `CREDITS.md` / `audio-credits.json`. Keep the
approved game audio files/manifests as sources. Action cues use actual event
timestamps divided by playback rate, so an 8× build retains normal sound pitch.
Rerun the final mix/validation after audio changes.

Preview commits must remain separate from document commits: never inject train
poses, substitute a staged completed image for a placement take, or overwrite
the user's working save with a generated snapshot. Record failures should stop
the take; diagnose, retake and inspect the actual movie before delivery.
