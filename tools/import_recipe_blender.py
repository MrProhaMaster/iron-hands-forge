"""Import a portable IHF1 armour recipe into Blender without removing scene objects.
Run Blender --background --python tools/import_recipe_blender.py --
  --recipe recipe.ihf.json (or --code IHF1...) --data-root DATA --out scene.blend
"""
import argparse
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
sys.dont_write_bytecode = True
TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
from recipe_codec import decode_recipe, normalize_recipe

def run():
    import bpy
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--recipe', type=Path)
    source.add_argument('--code')
    parser.add_argument('--data-root', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--node', type=Path)
    ns = parser.parse_args(args)
    target = ns.out.resolve()
    if target.suffix.lower() != '.blend':
        raise ValueError('--out must be a .blend file')
    if target.exists():
        raise ValueError('Output already exists; choose a new .blend filename')
    recipe = decode_recipe(ns.code) if ns.code else normalize_recipe(json.loads(ns.recipe.read_text(encoding='utf-8')))
    product = TOOLS.parent
    node = ns.node or (product / 'runtime' / 'node.exe')
    if not node.is_file():
        found = shutil.which('node')
        if not found:
            raise RuntimeError('Node runtime was not found. Pass --node or use the complete EXE distribution.')
        node = Path(found)
    work = target.parent / (target.stem + '.forge-build')
    work.mkdir(parents=True, exist_ok=True)
    cache = work / 'cache'
    cache.mkdir(exist_ok=True)
    local_recipe = work / 'recipe.ihf.json'
    local_recipe.write_text(json.dumps(recipe, ensure_ascii=False, indent=2), encoding='utf-8')
    env = dict(os.environ, TEMP=str(cache), TMP=str(cache), NODE_DISABLE_COMPILE_CACHE='1', PYTHONDONTWRITEBYTECODE='1')
    subprocess.run([str(node), str(TOOLS / 'build_from_recipe.mjs'), '--recipe', str(local_recipe), '--data-root', str(ns.data_root.resolve()), '--out', str(work)], check=True, cwd=product, env=env)
    manifest = json.loads((work / 'build-manifest.json').read_text(encoding='utf-8'))
    before = {o.as_pointer() for o in bpy.data.objects}
    collection = bpy.data.collections.new('Iron Hands Forge')
    bpy.context.scene.collection.children.link(collection)
    collection['ihf_recipe'] = json.dumps(recipe, ensure_ascii=False, sort_keys=True)
    reports = []
    for index, item in enumerate(manifest['files']):
        existing = {o.as_pointer() for o in bpy.data.objects}
        bpy.ops.import_scene.gltf(filepath=str(work / item['file']), disable_bone_shape=True)
        imported = [o for o in bpy.data.objects if o.as_pointer() not in existing]
        imported_set = set(imported)
        holder = bpy.data.objects.new('IHF ' + item['id'] + ' ' + item['role'], None)
        collection.objects.link(holder)
        for obj in imported:
            for old_collection in list(obj.users_collection):
                old_collection.objects.unlink(obj)
            collection.objects.link(obj)
        for obj in imported:
            if obj.parent not in imported_set:
                world = obj.matrix_world.copy()
                obj.parent = holder
                obj.matrix_world = world
        holder.location.x = index * 3.5
        holder['ihf_recipe_version'] = 1
        holder['ihf_recipe'] = json.dumps(recipe['soldiers'][index], ensure_ascii=False, sort_keys=True)
        holder['ihf_source_version'] = item['sourceVersion']
        holder['ihf_source_asset'] = item['source']
        holder['ihf_model_sha256'] = item['sha256']
        armatures = [o for o in imported if o.type == 'ARMATURE']
        meshes = [o for o in imported if o.type == 'MESH']
        reports.append({'id': item['id'], 'objects': len(imported), 'armatures': len(armatures), 'meshes': len(meshes), 'vertices': sum(len(o.data.vertices) for o in meshes), 'motion': item['motion'], 'sourceVersion': item['sourceVersion']})
    remaining = {o.as_pointer() for o in bpy.data.objects}
    if not before.issubset(remaining):
        raise RuntimeError('Existing scene objects were unexpectedly removed')
    target.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(target))
    result = {'schema': 'iron-hands-forge-blender-import-v1', 'output': str(target), 'existingObjectsPreserved': len(before), 'sceneFPS': bpy.context.scene.render.fps / bpy.context.scene.render.fps_base, 'soldiers': reports, 'sourceRecipe': recipe, 'gameMaterials': 'Preview colours; packed game masks remain in GLB custom attributes'}
    target.with_suffix('.import-report.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'ok': True, 'output': str(target), 'soldiers': len(reports), 'existingObjectsPreserved': len(before)}, ensure_ascii=False))

if __name__ == '__main__':
    run()