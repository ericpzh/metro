"""Original mellow interaction cues. No sampled audio or external dependencies."""
import hashlib
import json
import math
from pathlib import Path
import random
import struct
import wave

ROOT = Path(__file__).resolve().parents[1] / 'public' / 'sounds'
ROOT.mkdir(parents=True, exist_ok=True)
RATE = 44100
# Frequency glides distinguish actions without bright alerts or sharp impacts.
CUES = [
    ('place', 0.24, 196, 185, 0.23, 0.10),
    ('pick', 0.25, 392, 494, 0.19, 0.02),
    ('move', 0.28, 262, 330, 0.19, 0.06),
    ('select', 0.16, 330, 330, 0.16, 0.015),
    ('delete', 0.26, 294, 196, 0.18, 0.07),
    ('refused', 0.30, 196, 175, 0.16, 0.025),
]
manifest = []
for index, (name, duration, start, end, level, texture) in enumerate(CUES):
    rng = random.Random(2030 + index)
    count = round(duration * RATE)
    phase = 0
    filtered_noise = 0
    frames = []
    for i in range(count):
        t = i / RATE
        u = i / (count - 1)
        phase += 2 * math.pi * (start + (end - start) * u) / RATE
        # Smooth attack and release, including exact-zero endpoints. A mostly
        # sinusoidal fundamental with subdued harmonics feels rounded and muted.
        attack = math.sin(min(1, t / 0.018) * math.pi / 2) ** 2
        release = math.sin(min(1, (duration - t) / 0.065) * math.pi / 2) ** 2
        envelope = attack * release * math.exp(-u * 3.8)
        filtered_noise += 0.055 * (rng.uniform(-1, 1) - filtered_noise)
        tone = math.sin(phase) + 0.10 * math.sin(phase * 2) + 0.025 * math.sin(phase * 3)
        signal = level * envelope * (tone + texture * filtered_noise)
        if name == 'delete':
            # A damped, inharmonic wooden touch plus a cloth-like brush. No
            # pitch glide or bright switching transient from the former cue.
            touch = (math.sin(2 * math.pi * 410 * t)
                     + .32 * math.sin(2 * math.pi * 733 * t)
                     + .12 * math.sin(2 * math.pi * 1190 * t))
            onset = math.sin(min(1, t / .009) * math.pi / 2) ** 2
            signal = .26 * onset * release * (touch * math.exp(-t / .045)
                                              + 1.4 * filtered_noise * math.exp(-t / .08))
        if i in (0, count - 1):
            signal = 0
        frames.append(struct.pack('<h', round(signal * 32767)))
    filename = f'soft-{name}.wav'
    path = ROOT / filename
    with wave.open(str(path), 'wb') as output:
        output.setparams((1, 2, RATE, count, 'NONE', 'not compressed'))
        output.writeframes(b''.join(frames))
    data = path.read_bytes()
    manifest.append(dict(file=filename, bytes=len(data), sha256=hashlib.sha256(data).hexdigest(),
                         author='Station Designer', kind='effect',
                         source='model/scripts/make-soft-sounds.py',
                         license='Project-authored procedural audio; no third-party samples',
                         duration=duration, description=('Damped wooden touch and brushed noise, no pitch glide' if name == 'delete' else 'Rounded sine cue with 18 ms attack and soft release')))
(ROOT / 'soft-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(f'Generated {len(manifest)} soft mono cues')
