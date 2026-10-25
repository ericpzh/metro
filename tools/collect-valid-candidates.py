"""Download one casual outfit for each of VALID's six East Asian adult bases."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1] / 'model/public/human-candidates/valid'
ROOT.mkdir(exist_ok=True)
# Immutable GLB conversion revision, recorded alongside the upstream MIT source.
REVISION = 'c4719df7a2b60a96cc7f56d67e247674b68c4ea7'
BASE = f'https://raw.githubusercontent.com/c-frame/valid-avatars-glb/{REVISION}/'


def fetch(name):
    path = ROOT / (name + '.glb')
    if not path.exists():
        urllib.request.urlretrieve(BASE + 'avatars/Asian/' + path.name, path)
    return dict(path='valid/' + path.name, bytes=path.stat().st_size,
                sha256=hashlib.sha256(path.read_bytes()).hexdigest())


names = [f'Asian_{sex}_{number}_Casual' for sex in ['F', 'M'] for number in [1, 2, 3]]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    files = list(pool.map(fetch, names))
urllib.request.urlretrieve(BASE + 'LICENSE', ROOT / 'LICENSE')
source = dict(author='VALID / University of Central Florida and Google; GLB conversion c-frame',
              source='https://github.com/google/valid-avatar-library',
              conversion='https://github.com/c-frame/valid-avatars-glb', revision=REVISION,
              license='MIT', note='Six distinct East Asian adult bases, one casual outfit each. No children.', files=files)
(ROOT / 'source.json').write_text(json.dumps(source, indent=2) + '\n', encoding='utf-8')
