"""Prepare four native Primaris preview clips and own six-class binding policy.

python tools/prepare_motion.py --game GAME_ROOT --data-root PRIVATE_ROOT
Reads only the4 exact ZIP entries. Requires Python + NumPy for the decoder.
No game animation files or decoded tracks are bundled with this tool.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import zipfile

BINDINGS_PATH = Path(__file__).resolve().parents[1] / 'shared' / 'motion-bindings.json'


def validate_motion_bindings(value):
    """Validate own configuration; animation tracks remain private game data."""
    if not isinstance(value,dict) or value.get('schema')!='iron-hands-forge-motion-bindings-v1' or value.get('version')!=1:
        raise ValueError('Unsupported motion binding configuration')
    clips=value.get('clips');classes=value.get('classes');inherited=value.get('inheritedOnlyChannels')
    if not isinstance(clips,dict) or len(clips)!=4 or not isinstance(classes,dict) or not classes:
        raise ValueError('Expected four shared preview clips and class bindings')
    if not isinstance(inherited,list) or len(inherited)>512 or any(not isinstance(n,str) or not n or len(n)>160 for n in inherited) or len(set(inherited))!=len(inherited):
        raise ValueError('Invalid inherited-only control names')
    def relative(text,label):
        if not isinstance(text,str) or not text or '\\' in text or ':' in text or text.startswith('/') or any(p in ('','.','..') for p in text.split('/')):
            raise ValueError('Unsafe '+label)
        return text
    pairs=set()
    for clip_id,clip in clips.items():
        if not isinstance(clip_id,str) or not isinstance(clip,dict) or set(clip)!={'gait','stance','sourceEntry','output'}:
            raise ValueError('Invalid clip binding')
        gait,stance=clip['gait'],clip['stance']
        if gait not in ('walk','run') or stance not in ('unarmed','armed') or (gait,stance)in pairs:
            raise ValueError('Duplicate or invalid gait/stance')
        pairs.add((gait,stance));entry=relative(clip['sourceEntry'],'source entry');output=relative(clip['output'],'output')
        if not entry.startswith('animation/primaris/') or not entry.endswith('.sani') or not output.endswith('/'+Path(entry).stem+'.animation.json'):
            raise ValueError('Unexpected source/output clip identity')
    for class_id,binding in classes.items():
        if not isinstance(class_id,str) or not isinstance(binding,dict) or binding.get('status')not in ('pending','validated','unavailable'):
            raise ValueError('Invalid class motion binding')
        asset=binding.get('asset')
        if not isinstance(asset,str) or not asset or any(not(c.isascii() and (c.isalnum() or c=='_')) for c in asset):
            raise ValueError('Unsafe class asset')
        ids=binding.get('clipIds')
        if not isinstance(ids,dict) or set(ids)!={'walk','run'}:
            raise ValueError('Missing class gait bindings')
        for gait,stances in ids.items():
            if not isinstance(stances,dict) or set(stances)!={'unarmed','armed'}:
                raise ValueError('Missing class stance bindings')
            for stance,clip_id in stances.items():
                clip=clips.get(clip_id)
                if not clip or (clip['gait'],clip['stance'])!=(gait,stance):
                    raise ValueError('Unknown or mismatched class clip binding')
    return value


def load_motion_bindings(path=BINDINGS_PATH):
    return validate_motion_bindings(json.loads(Path(path).read_text(encoding='utf-8')))


MOTION_BINDINGS = load_motion_bindings()
CLIPS = tuple((c['gait'],c['stance'],c['sourceEntry'],str(Path(c['output']).parent).replace('\\','/')) for c in MOTION_BINDINGS['clips'].values())


def atomic_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+'.tmp')
    temporary.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False),encoding='utf-8')
    temporary.replace(path)


def validate_clip(result):
    validation=result.get('validation',{})
    if len(result.get('boneNames',[])) != 282 or len(result.get('channels',[])) != 282 or len(set(result['boneNames'])) != 282:
        raise ValueError('Expected282 unique channels for the verified Primaris locomotion rig')
    if not validation.get('finite') or not validation.get('chunkFullyConsumed') or not validation.get('durationMatchesSamples'):
        raise ValueError('Decoder validation failed')
    if validation.get('quaternionMaxUnitNormError',1) > 1e-6:
        raise ValueError('Quaternion normalization validation failed')
    for key in ('loopMaxPositionDistance','loopMaxRotationDegrees','maxPositionStep','maxRotationStepDegrees'):
        if not isinstance(validation.get(key),(int,float)) or not math.isfinite(validation[key]):
            raise ValueError(f'Invalid motion statistic {key}')
    inherited=set(MOTION_BINDINGS['inheritedOnlyChannels'])
    for channel in result['channels']:
        if channel['name'] in inherited and (channel.get('positionMode')!='fixed' or channel.get('rotationMode')!='fixed'):
            raise ValueError('Inherited-only preview control must have both components fixed: '+channel['name'])
    return validation


def prepare_motion(game,data_root):
    from sani_decoder import decode
    game=Path(game).resolve();data_root=Path(data_root).resolve()
    archive=game/'client_pc/root/paks/client/default/default_animation.pak'
    target=data_root/'assets/animations'
    manifest={'schema':'iron-hands-forge-private-motion-v1','sourceArchive':str(archive),'completed':False,'clips':[],'failures':[],
        'trajectoryPolicy':'Retain decoded source-space tracks. Separate cumulative trajectory applyDefault is false; consumer controls in-place playback.',
        'loopPolicy':'Report raw loop statistics without replacing frames or hiding source-channel displacement.',
        'bindings':MOTION_BINDINGS,'bindingConfigurationSha256':hashlib.sha256(BINDINGS_PATH.read_bytes()).hexdigest(),
        'validatedPreviewClassBindings':[key for key,value in MOTION_BINDINGS['classes'].items()if value['status']=='validated']}
    with zipfile.ZipFile(archive)as z:
        for gait,stance,entry,output_folder in CLIPS:
            try:
                info=z.getinfo(entry)
                if info.file_size > 16*1024*1024:raise ValueError('Unexpectedly large fixed clip entry')
                raw=z.read(info);sha=hashlib.sha256(raw).hexdigest()
                group=output_folder.split('/')[0];source=target/group/'source'/Path(entry).name
                source.parent.mkdir(parents=True,exist_ok=True)
                temporary=source.with_name(source.name+'.tmp');temporary.write_bytes(raw);temporary.replace(source)
                result=decode(source);validation=validate_clip(result)
                if result['sourceSha256'] != sha:raise ValueError('Decoded source hash mismatch')
                # Preserve the existing run-file provenance wrapper; these are
                # annotations only and never alter decoded transforms or timing.
                if gait=='run':result.update(gait=gait,actualGamePath=entry,trajectoryApplyDefault=False)
                output=target/output_folder/(source.stem+'.animation.json');atomic_json(output,result)
                manifest['clips'].append({'id':source.stem,'gait':gait,'stance':stance,'sourceEntry':entry,'sourceBytes':len(raw),
                    'sourceZipCRC32':f'{info.CRC:08x}','sourceSha256':sha,'sourceFile':str(source),'output':str(output),
                    'fps':result['fps'],'frameCount':result['frameCount'],'duration':result['duration'],'boneCount':len(result['boneNames']),'validation':validation,
                    'sourceSpaceRetained':True,'trajectoryApplied':False})
            except (OSError,ValueError,KeyError,NotImplementedError)as error:
                manifest['failures'].append({'entry':entry,'gait':gait,'stance':stance,'reason':str(error)})
    manifest['completed']=len(manifest['clips'])==len(CLIPS) and not manifest['failures']
    manifest_path=target/'motion-manifest.json';atomic_json(manifest_path,manifest)
    for group in ('SM2-walk','SM2-run'):
        group_clips=[c for c in manifest['clips']if str(Path(c['output']).relative_to(target)).replace('\\','/').startswith(group+'/')]
        atomic_json(target/group/'manifest.json',{'schema':manifest['schema'],'completed':len(group_clips)==2,'clips':group_clips,'failures':[f for f in manifest['failures']if f['gait']==('walk'if group=='SM2-walk'else'run')]})
    return {'completed':manifest['completed'],'manifest':str(manifest_path),'prepared':len(manifest['clips']),'failures':manifest['failures'],'clips':manifest['clips']}


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--game',required=True,type=Path);parser.add_argument('--data-root',required=True,type=Path)
    args=parser.parse_args(argv)
    try:
        summary=prepare_motion(args.game,args.data_root)
        print(json.dumps(summary,ensure_ascii=False,indent=2))
        if not summary['completed']:return 1
    except (OSError,ValueError,KeyError,zipfile.BadZipFile,ModuleNotFoundError)as error:
        parser.exit(1,f'prepare_motion: {error}\n')
    return 0


if __name__=='__main__':raise SystemExit(main())
