"""Collect the approved full music recordings for game streaming."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request

OUT = Path(__file__).resolve().parents[1] / 'game' / 'public' / 'audio' / 'music'
PACK = 'https://lonepeakmusic.itch.io/free-ambient-music-pack-1'
OGA = 'https://opengameart.org/content/'
TRACKS = [
    ('dream-culture', 'Dream Culture', 'Kevin MacLeod', 'CC BY 4.0', 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1300046', 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Dream%20Culture.mp3', 'Dreamy piano and light percussion.'),
    ('skyline', 'Skyline', 'LonePeakMusic', 'CC BY 4.0', PACK, 12781376, 'Dreamy, cinematic city atmosphere.'),
    ('sunset-plains', 'Sunset Plains', 'Yoiyami', 'CC0', OGA+'sunset-plains', 'https://opengameart.org/sites/default/files/sunset_plains.wav', 'Gentle guitar, warm pads and drifting melodies.'),
    ('vanilla-sky', 'Vanilla Sky', 'LonePeakMusic', 'CC BY 4.0', PACK, 12781377, 'Soft ambient sleep music.'),
    ('blue-lagoon', 'Blue Lagoon', 'LonePeakMusic', 'CC BY 4.0', PACK, 12781378, 'Relaxing ambient sleep music.'),
    ('caller', 'caller', 'SpringySpringo', 'CC0', OGA+'ambientloading-screen-game-music-pack', 'https://opengameart.org/sites/default/files/caller_0.mp3', 'Ambient / loading-screen candidate.'),
    ('monoliths', 'monoliths', 'SpringySpringo', 'CC0', OGA+'ambientloading-screen-game-music-pack', 'https://opengameart.org/sites/default/files/monoliths.mp3', 'Ambient / loading-screen candidate.'),
    ('booya-b', 'booya-b', 'SpringySpringo', 'CC0', OGA+'ambientloading-screen-game-music-pack', 'https://opengameart.org/sites/default/files/booya-b.mp3', 'Ambient / loading-screen candidate.'),
]

def collect(track):
    ident, title, author, license, source, download, description = track
    url = download
    if isinstance(download, int):
        request = urllib.request.Request(PACK+'/file/'+str(download), data=b'', headers={'Referer': PACK, 'X-Requested-With': 'XMLHttpRequest'})
        url = json.load(urllib.request.urlopen(request))['url']
    target = OUT / (ident+'.mp3')
    if not target.exists():
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', url, '-vn', '-ar', '44100', '-ac', '2', '-b:a', '80k', str(target)], check=True, timeout=180)
    if target.stat().st_size >= 25 * 1024 * 1024:
        raise ValueError(f'{target.name} exceeds the game asset limit')
    credit = f'{title} — {author}. {license}. {source}'
    if author == 'LonePeakMusic':
        credit = f'Song: {title}. Music provided and produced by LonePeakMusic. CC BY 4.0. {source}'
    print(ident, target.stat().st_size, flush=True)
    return dict(id=ident, title=title, author=author, license=license, licenseUrl='https://creativecommons.org/licenses/by/4.0/' if license=='CC BY 4.0' else 'https://creativecommons.org/publicdomain/zero/1.0/', source=source, download=download, file=ident+'.mp3', description=description, credit=credit, changes='Full recording converted to 80 kbps stereo MP3.', sha256=hashlib.sha256(target.read_bytes()).hexdigest())

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        records = list(pool.map(collect, TRACKS))
    (OUT/'manifest.json').write_text(json.dumps(records, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
