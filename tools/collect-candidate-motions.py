import urllib.request,json,hashlib
from pathlib import Path
repo='J-Ponzo/gltf-universal-animation-library';sha=json.load(urllib.request.urlopen('https://api.github.com/repos/'+repo+'/commits/main'))['sha'];out=Path('model/public/human-candidates/motions');out.mkdir(exist_ok=True)
files=[]
for name in ['glTF/AnimationLibrary_Godot_Standard.gltf','glTF/AnimationLibrary_Godot_Standard.bin','LICENSE']:
 data=urllib.request.urlopen('https://raw.githubusercontent.com/'+repo+'/'+sha+'/'+name).read();target=out/Path(name).name;target.write_bytes(data);files.append(dict(file=target.name,sha256=hashlib.sha256(data).hexdigest()))
(out/'source.json').write_text(json.dumps(dict(author='Quaternius',license='CC0-1.0',official='https://quaternius.com/packs/universalanimationlibrary.html',mirror='https://github.com/'+repo,revision=sha,files=files),indent=2))
d=json.loads((out/'AnimationLibrary_Godot_Standard.gltf').read_text());print('Clips:',[a.get('name') for a in d['animations']]);print('Bones:',[a.get('name') for a in d['nodes']][:100]);print('Images:',d.get('images'))
