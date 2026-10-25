"""Publish locally extracted SM2 constructors without any prebuilt game assets.

Requires Python 3.11+ and NumPy. Inputs come from the matching own V5 console
extractor; previous models, official .blend files and private audits are not
required. Original input files are never modified.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time

sys.dont_write_bytecode = True
import canonical_math
from skin_profile_validation import validate_profiles, restore_uvs, glb

VERSION = '5.0-canonical-skin-profile-safe'
SUPPORTED = ['cc_sm_constructor_'+name for name in ['soldier','sniper','support','raider','tank','berserk']]

def inside(root, value):
    value=Path(value).resolve()
    if not value.is_relative_to(root):
        raise ValueError('Generated files and native inputs must remain inside the configured private data root')
    return value

def sha256(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(8*1024*1024),b''):digest.update(chunk)
    return digest.hexdigest()

def atomic_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(path.suffix+'.tmp')
    temp.write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    temp.replace(path)

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root',type=Path,required=True)
    parser.add_argument('--native-root',type=Path)
    parser.add_argument('--output-root',type=Path)
    parser.add_argument('--asset',action='append',help='Repeat for selected constructor IDs; defaults to the six supported playable classes')
    parser.add_argument('--game-build')
    args=parser.parse_args(argv)
    root=args.data_root.resolve();root.mkdir(parents=True,exist_ok=True)
    native_root=inside(root,args.native_root or root/'assets/characters/SM2-retail-constructors/source-native-v5')
    output=inside(root,args.output_root or root/'assets/characters/SM2-retail-constructors/source-v5')
    if native_root==output:raise ValueError('Native inputs and published output require separate folders')
    names=list(dict.fromkeys(args.asset or SUPPORTED))
    if any(not re.fullmatch(r'cc_sm_constructor_[a-z0-9_]{1,64}',name) for name in names):raise ValueError('Invalid constructor ID')
    canonical_math.configure_root(root)
    output.mkdir(parents=True,exist_ok=True)
    manifest_path=output/'manifest.json'
    manifest=json.loads(manifest_path.read_text(encoding='utf-8-sig')) if manifest_path.exists() else {
        'schemaVersion':5,'sourceVersion':5,'extractorVersion':VERSION,'kind':'armor_constructors',
        'output':str(output),'expectedAssets':SUPPORTED.copy(),'assets':[],'failures':[],'completed':False,
        'notes':['Locally generated from the installed game; no previous version or official model file is required.',
                 'Engineer WEIGHT8 and Medic class customization are not included in the supported six-class preparation.']}
    if manifest.get('extractorVersion')!=VERSION:raise ValueError('Output belongs to a different extractor version; choose a new output folder')
    if args.game_build:manifest['gameBuild']=str(args.game_build)
    for name in names:
        native=inside(root,native_root/name/(name+'.glb'))
        metadata=inside(root,native_root/name/(name+'.json'))
        meta=json.loads(metadata.read_text(encoding='utf-8-sig'))
        if meta.get('extractorVersion')!='5.0-skin-safe-three-weight':raise ValueError('The matching skin-safe V5 native extractor is required')
        profiles=inside(root,meta['skinProfileAuditFile'])
        if not native.is_file() or not profiles.is_file():raise ValueError('Incomplete native extraction')
        if Path(meta['file']).resolve()!=native:raise ValueError('Native metadata/file association mismatch')
        source_hash=sha256(native)
        profile_hash=sha256(profiles)
        existing=next((asset for asset in manifest['assets']if asset['asset']==name),None)
        if existing:
            existing_output=inside(root,existing['raw'])
            if (existing.get('nativeSha256')==source_hash and existing.get('nativeProfileSha256')==profile_hash
                and existing_output.is_file() and existing.get('publishedSha256')==sha256(existing_output)
                and existing.get('skinProfileWeldValidation')=='passed'):
                print('ALREADY_VALIDATED',name,flush=True);continue
            raise ValueError('Existing generated asset differs; choose a new output folder instead of replacing a published model')
        objects={obj['id']:obj for obj in meta['objectMetadata']}
        if len(objects)!=len(meta['objectMetadata']) or len(objects)!=meta['objects']:raise ValueError('Invalid native object graph')
        for mesh in meta['meshes']:
            if mesh['objectId'] not in objects or objects[mesh['objectId']]['name']!=mesh['name'] or mesh['lod']!=0:
                raise ValueError('Invalid LOD0 source-object association')
        semantic,details=validate_profiles(native,meta)
        target=inside(root,output/(name+'.glb'))
        if target.exists():raise ValueError('An uncommitted output already exists; choose a new output folder or inspect it before retrying')
        validation=canonical_math.patch(native,target)
        restore_uvs(target,meta)
        data,_,_,_=glb(target)
        if len(data['meshes'])!=len(meta['meshes']) or any(a['name']!=b['name'] for a,b in zip(data['meshes'],meta['meshes'])):
            raise ValueError('GLTF mesh indices no longer match the native source report')
        validation.pop('sourceNativeV2',None)
        validation.update(semantic)
        validation.update({'sourceVersion':5,'extractorVersion':VERSION,'weightPackingValidation':'passed',
                           'weightPackingBasis':'V5 native extractor accepts verified three-influence WEIGHT4 and rejects WEIGHT8; every native skin profile is independently matched through the source-vertex guard.',
                           'meshIndexValidation':'passed','sourceObjectIdentityValidation':'passed','uvRestorationValidation':'passed',
                           'sourceNativeV5':str(native),'nativeSha256':source_hash,'nativeProfileSha256':profile_hash,'publishedSha256':sha256(target),
                           'tangentRecalculation':False,'bytes':target.stat().st_size})
        report_path=output/(name+'.skin-profile-validation.json')
        atomic_json(report_path,{'asset':name,**semantic,'meshes':details})
        validation['skinProfileAuditReport']=str(report_path)
        meta.update(validation);meta['file']=str(target);meta['raw']=str(target)
        meta_path=output/(name+'.json');atomic_json(meta_path,meta)
        manifest['assets'].append({'asset':name,'raw':str(target),'metadata':str(meta_path),'meshCount':meta['meshCount'],
                                   'vertices':meta['vertices'],'faces':meta['faces'],'cleanFiles':[],
                                   'selectionStatus':'constructor_raw_all_LOD0_parts_separate_class',**validation})
        manifest['failures']=[item for item in manifest['failures']if item.get('asset')!=name]
        manifest['exported']=len(manifest['assets']);manifest['failed']=len(manifest['failures']);manifest['selected']=len(manifest['expectedAssets'])
        manifest['completed']=set(manifest['expectedAssets']).issubset({item['asset']for item in manifest['assets']})
        status='passed' if manifest['completed'] else 'partial'
        for key in ['transformValidation','restSkinValidation','weightPackingValidation','skinProfileWeldValidation']:manifest[key]=status
        manifest['updatedAtUnix']=time.time();atomic_json(manifest_path,manifest)
        print('VALIDATED',name,json.dumps(semantic),flush=True)
    return 0

if __name__=='__main__':
    try:raise SystemExit(main())
    except (ValueError,AssertionError,OSError,KeyError) as error:
        print('PREPARE_ERROR',str(error),file=sys.stderr);raise SystemExit(1)
