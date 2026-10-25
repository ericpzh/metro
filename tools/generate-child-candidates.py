"""Generate four clothed MPFB child candidates, not scaled adult bodies.

Uses the isolated bpy/MPFB runtime and CC0 system pack under .preview/human-tools.
Run from the repo root after installing bpy there and unpacking MPFB/system assets.
Outputs GLBs and provenance; does not bake or replace game passengers.
"""
from pathlib import Path
import sys
import json
import hashlib

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / '.preview/human-tools'
sys.path.insert(0, str(TOOLS / 'python'))
sys.path.insert(0, str(next(TOOLS.glob('mpfb2-*/src'))))
import bpy
import mpfb

# Keep headless addon state isolated from the user's Blender preferences.
user_data = TOOLS / 'user-data'
user_data.mkdir(exist_ok=True)
bpy.utils.extension_path_user = lambda *args, **kwargs: str(user_data)
mpfb.get_preference = lambda name: None
mpfb.register()
from mpfb.services.humanservice import HumanService
from mpfb.services.targetservice import TargetService

ASSETS = TOOLS / 'assets'
OUTPUT = ROOT / 'model/public/human-candidates/generated'
OUTPUT.mkdir(exist_ok=True)
PRESETS = [
    dict(id='girl-01', gender=0., age=.13, weight=.42, proportions=.45, hair='bob02', clothes='female_casualsuit01'),
    dict(id='girl-02', gender=0., age=.24, weight=.51, proportions=.52, hair='ponytail01', clothes='female_casualsuit02'),
    dict(id='boy-01', gender=1., age=.15, weight=.48, proportions=.44, hair='short02', clothes='male_casualsuit06'),
    dict(id='boy-02', gender=1., age=.25, weight=.55, proportions=.55, hair='short04', clothes='male_casualsuit05'),
]


def asset(category, name):
    return str(next((ASSETS / category / name).glob('*.mhclo')))


records = []
for preset in PRESETS:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    macro = TargetService.get_default_macro_info_dict()
    macro.update({key: preset[key] for key in ['gender', 'age', 'weight', 'proportions']})
    macro['race'] = {'asian': 1., 'african': 0., 'caucasian': 0.}
    macro['cupsize'] = 0.
    body = HumanService.create_human(macro_detail_dict=macro)
    body.name = preset['id']
    skin = 'young_asian_female' if preset['gender'] == 0 else 'young_asian_male'
    HumanService.set_character_skin(str(ASSETS / 'skins' / skin / (skin + '.mhmat')), body,
                                    skin_type='GAMEENGINE', material_instances=False)
    # Use a direct glTF-compatible skin surface rather than MPFB's layered node
    # wrapper: exporters can otherwise select its internal auxiliary textures.
    skin_file = ASSETS / 'skins' / skin / (skin + '.mhmat')
    texture_name = next(line.split(maxsplit=1)[1] for line in skin_file.read_text().splitlines()
                        if line.startswith('diffuseTexture '))
    skin_material = bpy.data.materials.new(preset['id'] + '-skin')
    skin_material.use_nodes = True
    nodes = skin_material.node_tree.nodes
    shader = nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value = .85
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = bpy.data.images.load(str(skin_file.parent / texture_name))
    skin_material.node_tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
    body.data.materials.clear()
    body.data.materials.append(skin_material)
    for face in body.data.polygons:
        face.material_index = 0
    rig = HumanService.add_builtin_rig(body, 'game_engine')
    for category, name, role in [
        ('clothes', preset['clothes'], 'Clothes'),
        ('clothes', 'shoes03', 'Clothes'),
        ('hair', preset['hair'], 'Hair'),
        ('eyes', 'high-poly', 'Eyes'),
        ('eyebrows', 'eyebrow001', 'Eyebrows'),
    ]:
        fitted = HumanService.add_mhclo_asset(asset(category, name), body, asset_type=role,
                                            subdiv_levels=0, material_type='GAMEENGINE')
        if role == 'Hair':
            material = bpy.data.materials.new(preset['id'] + '-dark-hair')
            material.use_nodes = True
            shader = material.node_tree.nodes.get('Principled BSDF')
            shader.inputs['Base Color'].default_value = (.018, .014, .012, 1.)
            shader.inputs['Roughness'].default_value = .8
            hair_mat = ASSETS / category / name / (name + '.mhmat')
            diffuse = next(line.split(maxsplit=1)[1] for line in hair_mat.read_text().splitlines()
                           if line.startswith('diffuseTexture '))
            image_node = material.node_tree.nodes.new('ShaderNodeTexImage')
            image_node.image = bpy.data.images.load(str(hair_mat.parent / diffuse))
            material.node_tree.links.new(image_node.outputs['Alpha'], shader.inputs['Alpha'])
            material.surface_render_method = 'DITHERED'
            material.use_backface_culling = False
            fitted.data.materials.clear()
            fitted.data.materials.append(material)
            for face in fitted.data.polygons:
                face.material_index = 0
    # Bake shape mix and topology masks before glTF export. Retain armature weights.
    for obj in list(bpy.context.scene.objects):
        if obj.type != 'MESH':
            continue
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        if obj.data.shape_keys:
            bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
        for modifier in list(obj.modifiers):
            if modifier.type != 'ARMATURE':
                bpy.ops.object.modifier_apply(modifier=modifier.name)
        for face in obj.data.polygons:
            face.use_smooth = True
    for image in bpy.data.images:
        if image.size[0] and max(image.size) > 1024:
            scale = 1024 / max(image.size)
            image.scale(round(image.size[0] * scale), round(image.size[1] * scale))
    path = OUTPUT / (preset['id'] + '.glb')
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', export_animations=False,
                              export_skins=True, export_apply=False, export_yup=True)
    records.append(dict(preset, macro=macro, file=path.name, bytes=path.stat().st_size,
                        sha256=hashlib.sha256(path.read_bytes()).hexdigest(), bones=len(rig.data.bones)))
    print('EXPORTED', preset['id'], path.stat().st_size, flush=True)

source = dict(generator='MPFB / MakeHuman', blender=bpy.app.version_string,
              revision=(TOOLS / 'mpfb-revision.txt').read_text().strip(), license='CC0-1.0',
              source='https://github.com/makehumancommunity/mpfb2',
              assets='https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip',
              assetsSha256=hashlib.sha256((TOOLS / 'system.zip').read_bytes()).hexdigest(),
              note='Generated child age and Asian phenotype targets; fitted CC0 hair, clothes, shoes and game-engine rig. '
                   'Two girls and two boys at different age/body settings. Direct PBR skin and dark hair materials preserve glTF compatibility. '
                   'Shape keys/masks baked, textures bounded to 1024px. '
                   'Visual candidates, not reviewed game assets.', characters=records)
(OUTPUT / 'source.json').write_text(json.dumps(source, indent=2) + '\n', encoding='utf-8')
(OUTPUT / 'LICENSE.txt').write_text((next(TOOLS.glob('mpfb2-*')) / 'LICENSE.ASSETS.md').read_text(encoding='utf-8'), encoding='utf-8')
