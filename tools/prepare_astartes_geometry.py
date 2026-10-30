"""Prepare source-backed Astartes geometry without touching an installed game.

Requires the already prepared local eight-weight extractor dependencies and
Python/NumPy. Native PAKs are inputs only. Every generated file stays under the
private data root; this utility does not ship or download game assets.
"""
from pathlib import Path
import argparse, hashlib, json, os, shutil, subprocess, sys, time
sys.dont_write_bytecode = True

def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(8*1024*1024),b''):h.update(block)
    return h.hexdigest()

def atomic_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    tmp.replace(path)

def prepare_extractor(repo,tool,root):
    """Build our console adapter against existing pinned dependency DLLs."""
    src=root/'extractor-src';src.mkdir(parents=True,exist_ok=True)
    for name in ['MeshBuilder.cs','SceneContext.cs','AssimpHelper.cs']:
        shutil.copy2(tool/'app'/name,src/name)
    builder=(src/'MeshBuilder.cs').read_text(encoding='utf-8-sig')
    if 'HasWeight8' not in builder:raise ValueError('Eight-weight generated helper is required')
    program=(repo/'tools/extractor/Program.cs').read_text(encoding='utf-8-sig')
    if '5.1-skin-safe-eight-weight' not in program:raise ValueError('Eight-weight adapter is required')
    old='static bool PreserveRaw=false;'
    if program.count(old)!=1:raise ValueError('Console adapter entry point changed')
    program=program.replace(old,old+'\n  static string? ExplicitPak=null;')
    program=program.replace('case "--game": game=args[++i]; break;','case "--game": game=args[++i]; break;\n        case "--pak-path": ExplicitPak=Path.GetFullPath(args[++i]); break;')
    old='var paks=Directory.EnumerateFiles(Path.Combine(root,"default"),"default_tpl*.pak").OrderBy(x=>x).ToList();\n    paks.Add(Path.Combine(root,"resources.pak"));'
    if program.count(old)!=1:raise ValueError('Archive indexing shape changed')
    program=program.replace(old,'var paks=ExplicitPak is null?Directory.EnumerateFiles(Path.Combine(root,"default"),"default_tpl*.pak").OrderBy(x=>x).ToList():new List<string>{ExplicitPak};\n    if(ExplicitPak is null)paks.Add(Path.Combine(root,"resources.pak"));')
    raw_export='if(!PreserveRaw || !File.Exists(file)) if(!exporter.ExportFile(context.Scene,file,format)) throw new IOException("Assimp export failed: "+file);'
    if program.count(raw_export)!=1:raise ValueError('Raw export shape changed')
    program=program.replace(raw_export,'if(!PreserveRaw || !File.Exists(file)) { if(format=="glb2") DirectGlbWriter.Write(context.Scene,file); else if(!exporter.ExportFile(context.Scene,file,format)) throw new IOException("Assimp export failed: "+file); }')
    old_lod='for(var p=obj;p!=null;p=p.Parent) if(lodMap.TryGetValue(p.id,out var lod)) return lod;'
    if program.count(old_lod)!=1:raise ValueError('LOD parent traversal shape changed')
    program=program.replace(old_lod,'var seen=new HashSet<short>(); for(var p=obj;p!=null;p=p.Parent) { if(!seen.Add(p.id))throw new InvalidDataException("Cyclic source parent chain "+obj.id); if(lodMap.TryGetValue(p.id,out var lod))return lod; }')
    shutil.copy2(repo/'tools/extractor/DirectGlbWriter.cs',src/'DirectGlbWriter.cs')
    (src/'Program.cs').write_text(program,encoding='utf-8')
    import xml.etree.ElementTree as ET
    project=ET.Element('Project',Sdk='Microsoft.NET.Sdk');props=ET.SubElement(project,'PropertyGroup')
    for key,value in {'OutputType':'Exe','TargetFramework':'net8.0','ImplicitUsings':'enable','Nullable':'enable','PlatformTarget':'x64','AllowUnsafeBlocks':'true','AssemblyName':'AstartesExtractor'}.items():ET.SubElement(props,key).text=value
    items=ET.SubElement(project,'ItemGroup')
    for ref in ['LibSaber','LibSaber.SpaceMarine2','StirlingLabs.Assimp.Net','YamlDotNet']:
        dll=tool/'bin'/(ref+'.dll')
        if not dll.is_file():raise FileNotFoundError(dll)
        el=ET.SubElement(items,'Reference',Include=ref);ET.SubElement(el,'HintPath').text=str(dll);ET.SubElement(el,'Private').text='true'
    ET.ElementTree(project).write(src/'AstartesExtractor.csproj',encoding='utf-8',xml_declaration=True)
    (src/'NuGet.Config').write_text('<configuration><packageSources><clear /></packageSources></configuration>',encoding='utf-8')
    (src/'global.json').write_text(json.dumps({'sdk':{'version':'8.0.426','rollForward':'disable'}}),encoding='utf-8')
    env=isolated_environment(root)
    binary=root/'extractor-bin'
    subprocess.run([str(tool/'dotnet/dotnet.exe'),'build',str(src/'AstartesExtractor.csproj'),'-c','Release','-o',str(binary),'--nologo','-v','quiet','/clp:ErrorsOnly'],check=True,env=env)
    shutil.copytree(tool/'bin/runtimes',binary/'runtimes',dirs_exist_ok=True)
    return binary/'AstartesExtractor.dll'

def isolated_environment(root):
    env=os.environ.copy()
    for key,rel in {'TEMP':'cache/temp','TMP':'cache/temp','DOTNET_CLI_HOME':'dotnet-home','NUGET_PACKAGES':'nuget','NUGET_HTTP_CACHE_PATH':'nuget-http','NUGET_PLUGINS_CACHE_PATH':'nuget-plugins'}.items():
        path=root/rel;path.mkdir(parents=True,exist_ok=True);env[key]=str(path)
    env.update({'DOTNET_CLI_TELEMETRY_OPTOUT':'1','DOTNET_SKIP_FIRST_TIME_EXPERIENCE':'1','PYTHONDONTWRITEBYTECODE':'1'})
    return env

def canonicalize(repo,root,name):
    sys.path.insert(0,str(repo/'tools'))
    import canonical_math
    from skin_profile_validation import restore_extended_profiles,validate_profiles,restore_uvs,glb
    canonical_math.configure_root(root)
    native=root/'source-native'/name/(name+'.glb')
    meta_path=native.with_suffix('.json');meta=json.loads(meta_path.read_text(encoding='utf-8-sig'))
    if meta.get('extractorVersion')!='5.1-skin-safe-eight-weight':raise ValueError('Wrong extractor version')
    if Path(meta['file']).resolve()!=native.resolve():raise ValueError('Native metadata/file association mismatch')
    output=root/'canonical-source';output.mkdir(parents=True,exist_ok=True)
    target=output/(name+'.glb');result_path=output/(name+'.json')
    if result_path.exists():
        existing=json.loads(result_path.read_text(encoding='utf-8-sig'))
        if target.is_file() and existing.get('nativeSha256')==digest(native) and existing.get('publishedSha256')==digest(target):
            print('ALREADY_VALIDATED',name,flush=True);return existing
        raise ValueError('Existing canonical model differs; choose another private output root')
    if target.exists():raise ValueError('Uncommitted canonical model already exists')
    extended_tmp=output/(name+'.eightweight-tmp.glb')
    extended=restore_extended_profiles(native,extended_tmp,meta)
    verified=extended_tmp if extended else native
    try:
        semantic,details=validate_profiles(verified,meta)
        validation=canonical_math.patch(verified,target)
    finally:
        if extended and extended_tmp.exists():extended_tmp.unlink()
    restore_uvs(target,meta)
    data,_,_,_=glb(target)
    if len(data['meshes'])!=len(meta['meshes']) or any(a['name']!=b['name'] for a,b in zip(data['meshes'],meta['meshes'])):raise ValueError('Source mesh indices changed')
    validation.pop('sourceNativeV2',None)
    meta.update(validation);meta.update(semantic)
    meta.update({'weightPackingValidation':'passed','extendedSkinRestoration':'passed' if extended else 'not_needed','meshIndexValidation':'passed','sourceObjectIdentityValidation':'passed','uvRestorationValidation':'passed','skinInfluenceSets':2 if extended else 1,'sourceNative':str(native),'nativeSha256':digest(native),'nativeProfileSha256':digest(meta['skinProfileAuditFile']),'publishedSha256':digest(target),'file':str(target),'raw':str(target),'tangentRecalculation':False})
    atomic_json(output/(name+'.skin-profile-validation.json'),{'asset':name,**semantic,'meshes':details})
    atomic_json(result_path,meta)
    print('VALIDATED',name,json.dumps({'meshes':len(meta['meshes']),'vertices':meta['vertices'],'skinInfluenceSets':meta['skinInfluenceSets'],'sourceSkin':semantic['skinProfileWeldValidation'],'bytes':target.stat().st_size}),flush=True)
    return meta

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root',type=Path,required=True)
    parser.add_argument('--extractor-root',type=Path,required=True)
    parser.add_argument('--pak',type=Path,required=True)
    parser.add_argument('--template',action='append',required=True)
    parser.add_argument('--canonicalize-only',action='store_true')
    parser.add_argument('--reuse-extractor',action='store_true')
    args=parser.parse_args(argv)
    repo=Path(__file__).resolve().parents[1];root=args.data_root.resolve();root.mkdir(parents=True,exist_ok=True)
    tool=args.extractor_root.resolve();pak=args.pak.resolve()
    import re,zipfile
    if any(not re.fullmatch(r'[a-z0-9_]{1,96}',name) for name in args.template):raise ValueError('Unsafe template name')
    with zipfile.ZipFile(pak) as archive:
        known={Path(entry.filename).name[:-4] for entry in archive.infolist() if entry.filename.endswith('.tpl')}
    if set(args.template)-known:raise ValueError('Requested template is not present in source archive')
    extractor=root/'extractor-bin/AstartesExtractor.dll'
    if not args.canonicalize_only and (not args.reuse_extractor or not extractor.is_file()):extractor=prepare_extractor(repo,tool,root)
    results=[];failures=[]
    for name in dict.fromkeys(args.template):
        try:
            native=root/'source-native'/name/(name+'.glb')
            if not args.canonicalize_only and not native.with_suffix('.json').exists():
                out=native.parent
                subprocess.run([str(tool/'dotnet/dotnet.exe'),str(extractor),'--game',str(root/'virtual-game'),'--data-root',str(root),'--out',str(out),'--pak-path',str(pak),'--asset',name,'--preserve-raw'],check=True,env=isolated_environment(root))
            results.append(canonicalize(repo,root,name))
        except Exception as error:
            failures.append({'asset':name,'error':str(error)})
            print('FAIL',name,str(error),flush=True)
    report={'schemaVersion':1,'kind':'astartes_geometry_preparation','sourceArchive':{'file':pak.name,'sha256':digest(pak)},'extractorVersion':'5.1-skin-safe-eight-weight','requested':args.template,'assets':[{'asset':m['asset'],'file':str(Path(m['file']).relative_to(root)).replace('\\','/'),'sha256':m['publishedSha256'],'meshCount':m['meshCount'],'vertices':m['vertices'],'skinProfileWeldValidation':m['skinProfileWeldValidation']}for m in results],'failures':failures,'complete':not failures}
    atomic_json(root/'geometry-preparation-report.json',report)
    return 2 if failures else 0
if __name__=='__main__':raise SystemExit(main())
