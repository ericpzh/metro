# Game Audio: SFX, Spatial Ambience, and Music

Game audio runs purely in the browser app layer outside `StationState`, undo history,
and the simulation worker. Changing volume, pausing music, or playing tool cues never
commits a document edit or triggers extra scene raycasts.

## Module Ownership

| File | Ownership |
| --- | --- |
| `game/src/app/gameAudio.ts` | `GameAudio` singleton (`gameAudio`): `AudioContext` unlock, dynamics compressor limiter (`-12 dB`, `8:1`), decoded buffer cache, bounded one-shot SFX pool, and spatial ambient beds. |
| `game/src/app/audioSettings.ts` | Four local volume channels (`master`, `effects`, `ambient`, `music`) persisted in `metro-game.audio`, plus `audioAssetBase()` route resolution. |
| `game/src/app/audioActions.ts` | Pure `actionSound()` classifier observing pre/post tool outcomes inside existing pointer dispatches. |
| `game/src/app/ambientPlayback.ts` | Shared speed-scaling policy (`ambientTactic`, `gameAmbientPolicy`) and granular sample-skipping player (`AmbientVoice`); imported directly by `model/sounds.html` so studio defaults match runtime. |
| `game/src/app/gameMusic.ts` | `GameMusic` singleton (`gameMusic`): single `HTMLAudioElement` (`preload = 'none'`) streaming full tracks independently of simulation pause. |
| `game/src/app/musicTracks.ts` | Ordered 8-track playlist (`MUSIC_TRACKS`) with author, source, credit, and Creative Commons license URLs. |
| `game/src/app/windows/topbar/MusicSetting.tsx` | Bilingual music slider, play/pause button, and hover/focus track credits panel inside `SettingsMenu.tsx`. |
| `game/src/render/audioScene.ts` | Pure Z-up spatial projection (`sourceMix`) and bounded crowd clustering (`crowdSound`) emitted by `SceneRenderer`. |

## Volume Preferences and Asset Paths

- **Storage keys:**
  - `metro-game.audio`: `{ master: 1, effects: 0.65, ambient: 0.45, music: 0.1 }`
    (clamped to `[0, 1]`, falls back cleanly on corrupt or blocked `localStorage`).
  - `metro-game.music-paused`: `'true'` / `'false'` (independent of simulation pause).
- **Scaling:** `master` scales `effects`, `ambient`, and `music` while preserving
  individual slider values; `master === 0` mutes and releases active voices/beds and
  pauses music. Music output applies `MUSIC_OUTPUT_SCALE = 0.5` (`-6 dB` ceiling at
  100% slider).
- **Path resolution (`audioAssetBase`):** Strips trailing `/lab`, `/zoo`, `/tanwei`,
  `/tianhe`, and `/en` segments while preserving the deployed `/game/` prefix
  (yielding `/audio/` at dev root or `/game/audio/` in production). Honors
  `globalThis.metroUnityAudioBase` when hosted inside the Unity shell.

## Interaction Cues (SFX)

- **Six baked WAVs in `game/public/audio/`:** `place.wav` (soft impact), `pick.wav`
  (digital pick), `move.wav` (set down), `select.wav` (felt tap), `delete.wav` (soft
  brush), and `refused.wav` (switch click), plus `manifest.json` and CC0 licenses.
- **Triggering (`actionSound`):** Classifies existing gesture state transitions without
  scanning documents or adding raycasts. Hover, cancelled moves, and no-op clicks stay
  silent; multi-cell commits emit one cue; repeated refusals stay audible even when
  hover already displayed the same notice.
- **Bounds & unlock:** `GameAudio.mount()` creates/resumes `AudioContext` only on real
  `pointerdown` / `keydown` gestures (never on mount) and decodes the 6 small WAVs
  once. One-shot playback enforces a `65 ms` cooldown and an 8-voice pool cap.

## Spatial Ambience and Simulation Speed Scaling

- **Three CC0 ambient loops (`game/public/audio/`):** `crowd.mp3`, `train.mp3`, and
  `traffic.mp3`, loaded lazily only when their projected gain exceeds `0.005`.
- **Renderer framing (`render/audioScene.ts`, `SceneRenderer`):**
  - Emits frames at most `10 Hz` (`100 ms`) at `1×` and `~30 Hz` (`33 ms`) above `1×`
    from the active camera (position, height, and right vector).
  - Distance attenuation uses `reference = 18 m` / `radius = 160 m` for `crowd`, and
    `reference = 28 m` / `radius = 240 m` for `train`/`traffic` (silent beyond
    `radius`).
  - Samples at most `256` passenger positions (clustered into `16 × 16 × 5 m` cells for
    one crowd bed), at most `64` rendered vehicles, and active live trains only
    (parked consists stay silent).
  - Muted ambience detaches `onAudioFrame`; suspended editor views stay silent while
    the standalone exploded viewer emits from its own camera and tray positions.
- **Speed tactics (`app/ambientPlayback.ts`):**
  - `crowd`: always `natural` (`1×` uninterrupted loop).
  - `train`: `natural` at `1×`; `skip` above `1×`.
  - `traffic`: `rate` (playback rate = sim speed) at `1×` and `4×`; `skip` at `>= 16×`.
  - Sample-skipping (`AmbientVoice`) schedules natural-pitch `120 ms` grains with
    `15 ms` linear crossfades (`105 ms` hop), advancing source offset by simulation
    speed with at most `3` live grains and discarding missed slices after slow frames.
- **Tab visibility & cancellation:** Hidden tabs stop active voices/beds, increment an
  epoch counter so late async decodes are ignored, and suspend `AudioContext` until
  the next real user gesture.

## Background Music

- **Streaming player (`app/gameMusic.ts`):** Uses one retained `HTMLAudioElement`
  (`preload = 'none'`) cycling sequentially through 8 full recordings in
  `game/public/audio/music/` (encoded at 80 kbps stereo MP3, each `< 25 MiB`, verified
  by SHA-256 in `game/public/audio/music/manifest.json`).
- **Lifecycle:** Starts only after a real user gesture when unpaused and non-zero
  volume; retains playback position across pause/resume; pauses on zero volume,
  hidden tab, or unmount; ignores late `play()` resolutions via a generation counter;
  surfaces a retryable unavailable notice on decode/network error.
- **Credits (`MusicSetting.tsx`):** Hovering or focusing the music control reveals the
  current track's title, author, source link, and license link; pointer leave or
  clicking play/pause dismisses the credits panel.

## Asset Preparation, Verification, and Limits

Runtime `game/src/` never imports `model/`. Bake audio assets offline from the
repository root:

```powershell
# Re-bake 6 shaped SFX WAVs + copy 3 CC0 ambient MP3s from model/ -> game/public/audio/
node tools/prepare-game-audio.mjs

# Fetch/transcode 8 full music tracks (80 kbps MP3) + SHA-256 manifest -> game/public/audio/music/
python tools/collect-game-music.py

# Deterministic Node suites
node --test game/test/audio.test.mjs game/test/music.test.mjs

# Headless browser audits (requires built game/dist for check-game-audio)
npm --prefix game run build
node tools/check-game-audio.mjs
node tools/check-game-music.mjs
```

- **Current limits:** Ambient loops wrap the full recording (possible loop seam) and
  use distance/pan projection without room occlusion or reverb.
- For sound-studio auditioning and procedural WAV / CC0 source collection under
  `model/sounds.html`, see [`metro-model`](../../metro-model/SKILL.md).
