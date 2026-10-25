"""Fetch the reviewed Rocketbox preview selection at its pinned MIT revision.

Requires Pillow. Keeps FBX originals, converts source TGA textures to <=1024px
PNG, and records each shipped file's SHA-256. Does not alter game passengers.
"""
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path
import urllib.parse
import urllib.request
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / 'model/public/human-candidates'
REVISION = '0943055db6ec570bcef9f2c8b41c9e5467c808f9'
NAMES = ['Female_Adult_03', 'Female_Adult_11', 'Male_Adult_09', 'Business_Male_02']

RAW = f'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/{REVISION}/'


def fetch(path):
    with urllib.request.urlopen(RAW + urllib.parse.quote(path), timeout=90) as response:
        return response.read()


def collect(name, tree):
    group = 'Children' if '_Child_' in name else 'Professions' if name.startswith('Business_') else 'Adults'
    prefix = f'Assets/Avatars/{group}/{name}/'
    folder = ROOT / 'rocketbox' / name
    folder.mkdir(parents=True, exist_ok=True)
    for item in tree:
        path = item['path']
        if not path.startswith(prefix) or not (path.endswith('/' + name + '.fbx') or path.endswith('.tga')):
            continue
        target = folder / Path(path).name
        if target.suffix == '.tga':
            target = target.with_suffix('.png')
        if target.exists():
            continue
        data = fetch(path)
        if path.endswith('.tga'):
            with Image.open(io.BytesIO(data)) as image:
                image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
                image.save(target)
        else:
            target.write_bytes(data)
    print(name, flush=True)


def main():
    with urllib.request.urlopen(f'https://api.github.com/repos/microsoft/Microsoft-Rocketbox/git/trees/{REVISION}?recursive=1') as response:
        tree = json.load(response)['tree']
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda name: collect(name, tree), NAMES))
    (ROOT / 'rocketbox/LICENSE.md').write_bytes(fetch('LICENSE.md'))
    other_sources = []
    for folder in ['valid', 'generated']:
        source_file = ROOT / folder / 'source.json'
        if source_file.exists():
            source = json.loads(source_file.read_text(encoding='utf-8'))
            other_sources.append({key: value for key, value in source.items() if key not in ['files', 'characters']})
    manifest = {
        'license': 'MIT and CC0-1.0; see source records',
        'sources': [{
            'author': 'Microsoft / Rocketbox',
            'url': 'https://github.com/microsoft/Microsoft-Rocketbox',
            'revision': REVISION, 'license': 'MIT', 'avatars': NAMES,
            'note': 'Four Rocketbox adult visual selections for East Asian appearance. Original FBX unchanged. '
                    'TGA textures converted to PNG at at most 1024 px per side. '
                    'Original paths: Assets/Avatars/<Adults|Children|Professions>/<avatar>/Textures/. '
                    'See rocketbox/LICENSE.md.',
        }] + other_sources,
        'files': [{'path': file.relative_to(ROOT).as_posix(), 'bytes': file.stat().st_size,
                   'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}
                  for file in sorted(ROOT.rglob('*')) if file.is_file() and file.name != 'manifest.json'],
    }
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
