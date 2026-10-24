# Station Designer sound study

Collected 2026-10-23. Preview at `/sounds.html` on the model app (port 5175).
This is an audition collection and an integration proposal; no game audio is wired yet.

## Selected interaction set

The preview now exposes exactly one sound per action, with no candidate menus:

| Action | Chosen cue | Tuning |
| --- | --- | --- |
| Place | Kenney Soft impact (`impactGeneric_light_000.ogg`) | 50% sample gain, 160 Hz high-pass to reduce boom, 1600 Hz low-pass, 12 ms smooth attack, 25 ms release |
| Select | Original Felt tap (`soft-select.wav`) | Level matched with the other cues |
| Pick | Kenney Digital pick (`select_002.ogg`) | 50% sample gain, 2400 Hz low-pass, 4 ms smooth attack, 8 ms release |
| Delete | Original Soft brush (`soft-delete.wav`) | Damped wooden touch with brushed texture; no switching transient or synthetic pitch glide |
| Move | Kenney Set down (`drop_001.ogg`) | Eight semitones lower (playback rate ≈ 0.630); slightly longer as a result |
| Refused | Kenney Switch click (`switch_001.ogg`) | Five semitones lower (playback rate ≈ 0.749); slightly longer as a result |

Listening feedback takes priority over identical RMS readings. The softer-frequency
place and felt selection cues still sounded quieter at the same measured level,
so Place is now boosted about 5 dB and Select about 6 dB. Delete is replaced by an
organic wooden/brush cue and raised substantially from its previous quiet setting.
Maximum 20 ms RMS targets are Place 0.205, Select 0.230, Delete 0.200; Pick, Move
and Refused remain 0.115. A shared 0.5 sample-peak ceiling remains in place.
These are audition settings, not a perceptual loudness guarantee.

`src/sound-preview/effects.js` owns this set and its tuning. Source recordings
are unchanged; filtered/enveloped buffers are prepared once after decode and
cached. Lower-pitched cues use source playback rate. Ambient recordings and
mix settings are unchanged. The building sequence includes all six chosen actions.

The earlier procedural set and CC0 source files remain in the provenance archive,
but other interaction choices are no longer offered in the preview. Original
procedural WAVs can be regenerated with `python model/scripts/make-soft-sounds.py`;
metadata is in `soft-manifest.json`. Its felt tap and revised organic delete are selected now.

## Local collection and provenance

16 files, approximately 5.8 MB. `manifest.json` records the exact download URL,
original filename, author, source page, license, bytes and SHA-256 for every file.
Run `python model/scripts/collect-sounds.py` from the repository root to refresh.
No login or API key is needed. The script verifies the Freesound CC0 marker before
downloading. Kenney's original license texts are included alongside the samples.

| Source | Use | License / recording notes |
| --- | --- | --- |
| [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) | 9 short selection, pick, move, delete and refusal candidates | CC0; selected original OGG files from the pack |
| [Kenney Impact Sounds](https://kenney.nl/assets/impact-sounds) | 3 contact materials plus a concrete footstep reserve | CC0; selected original OGG files from the pack |
| [Train Station Crowd — mrrap4food](https://freesound.org/people/mrrap4food/sounds/619010/) | Passenger-area bed | CC0; local HQ MP3 preview, not the original upload; station transport noise can be baked into the bed |
| [Subway Underground The Tube The Metro — Syphon64](https://freesound.org/people/Syphon64/sounds/135209/) | Moving train audition | CC0; local HQ MP3 preview; Glasgow subway rather than a particular game rolling-stock class |
| [StreetSideLowTraffic.wav — ViaTorci](https://freesound.org/people/ViaTorci/sounds/66794/) | Street / road bed | CC0; local HQ MP3 preview, not the original WAV; traffic timing is already in the recording |

All source pages identify [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
Credit is retained for provenance even though CC0 does not require attribution.
The collection is an audition shortlist, not a claim that a field recording is
an isolated passenger, train motor or individual vehicle. Before production,
listen through the recordings, remove recognizable announcements where necessary,
trim useful regions, normalize perceived loudness, and author seamless loop points.
Current ambient playback loops whole recordings, so seams can remain audible.

## Preview behavior

- One selected cue for each of place, pick, move, select, delete and refused placement.
  A short building sequence auditions the selected candidates in order.
- Quiet concourse, rush hour, platform arrival and street entrance scenarios.
  Presets change source intensity and the listener position; mixer choices persist.
- Master, interaction effects, ambience, passengers, trains and traffic each have
  an independent switch and volume slider, stored locally under `metro-sound-study`.
- All playback passes through the mixer. Recording auditions are centered and
  non-spatial; scene playback uses the camera position and orientation.
- A source is `(x,y,z)` in metres (Y up in this preview). Distance is Euclidean,
  including camera height. Falloff is `ref / (ref + max(distance-ref, 0))`, with
  an additional fade to silence over the last 20% of the source radius. References
  are 10–14 m and radii 95–150 m; these are design starting points, not measurements.
- Stereo pan is the source vector projected onto the camera's right vector,
  divided by its full 3D distance. This intentionally simple model uses
  `StereoPannerNode` plus an explicit distance gain, avoiding duplicate attenuation.
  No occlusion, reverb, Doppler or physical acoustic simulation is claimed.
- Three retained ambient voices, a cap of eight overlapping interaction/audition
  voices, decoded-buffer reuse, smoothed gains, and one master compressor. Stop all
  cancels pending scene startup and stops active sounds. Hidden tabs stop playback.
  A user gesture starts the AudioContext; the page never starts audio on load.
- Field recordings remain stereo in this prototype; production positional point
  sources should normally use mono assets, with diffuse stereo beds used sparingly.

## Proposed game integration

Use one main-thread audio service. Browser audio does not belong in the simulation
worker or saved station document. Preferences belong next to existing local app
preferences and should appear in the gear menu, with master, interaction and ambient
switches/volumes plus optional passenger/train/traffic controls.

Emit interaction sounds only from accepted actions: selection changes, successful
pick, placement commit, move release and deletion. Play refusal at most once per
gesture or with a short cooldown. Never fire on every hover, frame or dragged cell.
Use the already-resolved scene pick; audio must not introduce another raycast,
station copy, undo entry, routing update or document commit. A bulk placement should
be one sound or a rate-limited sequence, not one voice for every block.

For ambience, read the actual render camera's world position and quaternion,
including its height; do not silently use the orbit target as the listener. If
high isometric cameras make everything too quiet, tune the reference distance or
expose an explicit listening offset after auditioning. The game uses Z-up, unlike
this Y-up preview: map game `(x,y,z)` to audio `(x,z,-y)` and map camera forward/up
the same way if using the browser's AudioListener/PannerNode.

Aggregate passengers into a small bounded set of occupied crowd zones. Use a
density-derived level with clamping, and a small nearby footstep pool if desired;
do not give every passenger a sound node. Attach a mono train loop to each audible
train's retained render position, with movement/door/braking one-shots triggered
by state transitions. Represent roads with nearby road segments or a bounded
set of vehicle emitters. Rank candidate sources at a coarse cadence (e.g. 10 Hz)
and smooth their positions/gains; keep the audible set bounded (e.g. 12 total).
Use the latest simulation snapshot rather than requesting new worker messages
per audio frame. Freeze moving emitters with the simulation; decide separately
whether a static ambience bed continues during pause.

For a larger moving 3D scene, [PannerNode](https://developer.mozilla.org/en-US/docs/Web/API/PannerNode)
provides a native alternative with distance models and HRTF panning. Use either
its attenuation or the explicit gain curve, not both. Reuse decoded AudioBuffers
and create a fresh AudioBufferSourceNode for each one-shot; resume the context on
a user gesture as described in [Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices).

Before game integration, choose the preferred interaction candidates and approve
the relative loudness of the four scenarios by ear. Add regressions for mute,
source budgets, no sound on rejected commits, gesture rate limits, and camera-axis
mapping when the owning game audio service is introduced.
