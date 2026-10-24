"""Refresh the CC0 audition collection. Run from any directory; no credentials needed."""
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1] / 'public' / 'sounds'
ROOT.mkdir(parents=True, exist_ok=True)
SOURCES = {
    'interface': ('Kenney', 'https://kenney.nl/assets/interface-sounds', 'https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip'),
    'impact': ('Kenney', 'https://kenney.nl/assets/impact-sounds', 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip'),
}
CHOICES = {
    'interface': ['click_001', 'select_001', 'select_002', 'pluck_001', 'drop_001', 'scroll_001', 'back_001', 'error_003', 'switch_001'],
    'impact': ['impactGeneric_light_000', 'impactWood_light_000', 'impactMetal_light_000', 'footstep_concrete_000'],
}
manifest = []
def save(name, data, **metadata):
    (ROOT / name).write_bytes(data)
    manifest.append(dict(file=name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest(), license='CC0-1.0', licenseUrl='https://creativecommons.org/publicdomain/zero/1.0/', **metadata))

for pack, (author, page, url) in SOURCES.items():
    archive = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(url).read()))
    (ROOT / f'{pack}-License.txt').write_text('\n'.join(line.rstrip() for line in archive.read('License.txt').decode('utf-8').splitlines()).strip() + '\n', encoding='utf-8')
    for stem in CHOICES[pack]:
        save(stem + '.ogg', archive.read('Audio/' + stem + '.ogg'), author=author, source=page, download=url, original='Audio/' + stem + '.ogg', kind='effect')

for name, author, sound_id, user_id in [
    ('crowd', 'mrrap4food', 619010, 781461),
    ('train', 'Syphon64', 135209, 2461495),
    ('traffic', 'ViaTorci', 66794, 935297),
]:
    page = f'https://freesound.org/people/{author}/sounds/{sound_id}/'
    html = urllib.request.urlopen(page).read().decode()
    # Refuse to silently refresh a recording if its source license changes.
    if 'creativecommons.org/publicdomain/zero/1.0' not in html:
        raise RuntimeError(f'CC0 license could not be verified: {page}')
    url = f'https://cdn.freesound.org/previews/{sound_id // 1000}/{sound_id}_{user_id}-hq.mp3'
    save(name + '.mp3', urllib.request.urlopen(url).read(), author=author, source=page, download=url, original='Freesound high-quality MP3 preview (not original WAV)', kind='ambience')

(ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(f'Collected {len(manifest)} CC0 files, {sum(s["bytes"] for s in manifest):,} bytes')
