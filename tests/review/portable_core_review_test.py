"""Independent synthetic review. Does not extract or change game/model assets."""
import sys
sys.dont_write_bytecode=True
from pathlib import Path
APP=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(APP/'tools'))
import unittest,json,struct,hashlib,tempfile,shutil,subprocess,os,ast,re
import numpy as np
from skin_profile_validation import validate_profiles,restore_uvs,glb
import canonical_math

PYTHON=Path(sys.executable)
WORK=Path(os.environ.get('IHF_TEST_ROOT',str(APP/'.build/review-tests'))).resolve()
CORE=Path(os.environ['IHF_REVIEW_EXTRACTOR_ROOT']).resolve() if os.environ.get('IHF_REVIEW_EXTRACTOR_ROOT') else None
_dotnet=os.environ.get('IHF_DOTNET') or shutil.which('dotnet')
DOTNET=Path(_dotnet).resolve() if _dotnet else None

def fixture(folder,kind='valid',original_uv=False):
    arrays=[];views=[];accessors=[];offset=0
    def add(values,dtype,shape_type):
        nonlocal offset
        values=np.asarray(values,dtype=dtype);raw=values.tobytes();pad=(-offset)%4
        if pad:arrays.append(b'\0'*pad);offset+=pad
        views.append({'buffer':0,'byteOffset':offset,'byteLength':len(raw)});arrays.append(raw);offset+=len(raw)
        accessors.append({'bufferView':len(views)-1,'componentType':{'<f4':5126,'<u2':5123}[dtype],'count':len(values),'type':shape_type});return len(accessors)-1
    pos=add([[0,0,0],[1,0,0],[0,1,0]],'<f4','VEC3')
    uv=add([[0,0],[0 if kind=='duplicate_guard'else 1,0],[2,0]],'<f4','VEC2')
    weights=add([[1,0,0,0]]*3,'<f4','VEC4');joints=add([[1 if kind=='wrong_bone'else 0,0,0,0]]*3,'<u2','VEC4')
    indices=add([0,2,1]if kind=='wrong_faces'else[0,1,2],'<u2','SCALAR')
    attrs={'POSITION':pos,'TEXCOORD_0':uv,'WEIGHTS_0':weights,'JOINTS_0':joints}
    if original_uv:attrs['TEXCOORD_1']=add([[.1,.2],[.3,.4],[.5,.6]],'<f4','VEC2')
    binary=b''.join(arrays);binary+=b'\0'*((-len(binary))%4)
    data={'asset':{'version':'2.0'},'buffers':[{'byteLength':len(binary)}],'bufferViews':views,'accessors':accessors,
        'meshes':[{'name':'own_fixture','primitives':[{'attributes':attrs,'indices':indices}]}],
        'nodes':[{'name':'bone_A'},{'name':'bone_B'},{'name':'mesh','mesh':0,'skin':0}], 'skins':[{'joints':[0,1]}]}
    encoded=json.dumps(data,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);path=folder/(kind+'.glb')
    path.write_bytes(struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary)
    profile=folder/(kind+'.skin_profiles.bin');np.asarray([[0,1,0,0,0,0]]*3,dtype='<f4').tofile(profile)
    audit={'vertexCount':3,'byteOffset':0,'sourceUsedVertexCount':3,'sourceUnusedVertexCount':0,'originalUVChannels':int(original_uv),'faceSourceIndexSha256':hashlib.sha256(np.asarray([0,1,2],dtype='<i4').tobytes()).hexdigest()}
    meta={'skinProfileAuditFile':str(profile),'skinProfileBoneNames':['bone_A','bone_B'],'meshes':[{'name':'own_fixture','objectId':11,'skinProfileAudit':audit}]}
    metadata=folder/(kind+'.json');metadata.write_text(json.dumps(meta));return path,meta,metadata

class ReviewTests(unittest.TestCase):
    def setUp(self):
        WORK.mkdir(parents=True,exist_ok=True);self.folder=Path(tempfile.mkdtemp(prefix='own-review-',dir=WORK))
        if not self.folder.resolve().is_relative_to(WORK.resolve()):raise ValueError('Review fixture escaped the configured test root')
        self.env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','PYTHONUTF8':'1','TEMP':str(WORK),'TMP':str(WORK),'DOTNET_CLI_HOME':str(WORK/'dotnet-home'),'DOTNET_SKIP_FIRST_TIME_EXPERIENCE':'1','DOTNET_CLI_TELEMETRY_OPTOUT':'1'}
    def tearDown(self):
        path=self.folder.resolve()
        if not path.is_relative_to(WORK.resolve()):raise ValueError('Refusing cleanup outside the configured test root')
        shutil.rmtree(path)
    def test_valid_source_profile_passes(self):
        path,meta,_=fixture(self.folder);summary,_=validate_profiles(path,meta);self.assertEqual(summary['skinProfileWeldValidation'],'passed');self.assertEqual(summary['maxSourceSkinWeightError'],0.)
    def test_corrupt_bone_guard_and_faces_reject_normally(self):
        for kind in ('wrong_bone','duplicate_guard','wrong_faces'):
            path,meta,_=fixture(self.folder,kind)
            with self.subTest(kind=kind),self.assertRaises(ValueError):validate_profiles(path,meta)
    def test_optimized_python_keeps_all_fail_closed_checks(self):
        code="import sys,json;sys.dont_write_bytecode=True;sys.path.insert(0,sys.argv[1]);from pathlib import Path;from skin_profile_validation import validate_profiles\ntry: validate_profiles(Path(sys.argv[2]),json.load(open(sys.argv[3])))\nexcept ValueError: print('REJECTED')\nelse: raise SystemExit('VALIDATION_BYPASSED')"
        for kind in ('wrong_bone','duplicate_guard','wrong_faces'):
            path,_,meta=fixture(self.folder,kind)
            run=subprocess.run([str(PYTHON),'-O','-c',code,str(APP/'tools'),str(path),str(meta)],capture_output=True,text=True,encoding='utf-8',env=self.env)
            with self.subTest(kind=kind):self.assertEqual(run.returncode,0,run.stderr);self.assertIn('REJECTED',run.stdout)
    def test_reversible_uv_guard_does_not_change_binary(self):
        path,meta,_=fixture(self.folder,original_uv=True);_,base,size,_=glb(path);original=path.read_bytes()[base:base+size];restore_uvs(path,meta);data,newbase,newsize,_=glb(path)
        self.assertEqual(path.read_bytes()[newbase:newbase+newsize],original);self.assertIn('TEXCOORD_0',data['meshes'][0]['primitives'][0]['attributes']);self.assertNotIn('TEXCOORD_1',data['meshes'][0]['primitives'][0]['attributes'])
    def test_canonical_cli_rejects_outside_native_before_io(self):
        private=self.folder/'private';outside=self.folder/'outside'
        run=subprocess.run([str(PYTHON),str(APP/'tools/canonicalize_local.py'),'--data-root',str(private),'--native-root',str(outside),'--asset','cc_sm_constructor_demo'],capture_output=True,text=True,encoding='utf-8',env=self.env)
        self.assertNotEqual(run.returncode,0);self.assertIn('inside',run.stderr);self.assertFalse(outside.exists())
    def test_canonical_checked_path_rejects_outside(self):
        private=self.folder/'private';private.mkdir();canonical_math.configure_root(private)
        with self.assertRaises(ValueError):canonical_math.checked(self.folder/'outside')
    def test_local_transform_column_major_and_nonuniform_scale(self):
        half=np.sqrt(.5);node={'translation':[1,2,3],'rotation':[0,0,half,half],'scale':[2,3,4]}
        expected=np.array([[0,-3,0,1],[2,0,0,2],[0,0,4,3],[0,0,0,1]],dtype=float)
        np.testing.assert_allclose(canonical_math.local(node),expected,atol=1e-14)
        np.testing.assert_allclose(canonical_math.local({'matrix':expected.T.reshape(-1).tolist()}),expected,atol=0)
    def test_resume_manifest_cannot_reuse_published_file_outside_private_root(self):
        private=self.folder/'private';name='cc_sm_constructor_demo';native=private/'native'/name;output=private/'published';native.mkdir(parents=True);output.mkdir()
        source=native/(name+'.glb');source.write_bytes(b'own source presence fixture');profile=native/'profiles.bin';profile.write_bytes(b'own profile presence fixture')
        (native/(name+'.json')).write_text(json.dumps({'extractorVersion':'5.0-skin-safe-three-weight','file':str(source),'skinProfileAuditFile':str(profile)}))
        outside=self.folder/'outside-published.fixture';outside.write_text('own previous publication marker')
        (output/'manifest.json').write_text(json.dumps({'extractorVersion':'5.0-canonical-skin-profile-safe','assets':[{'asset':name,'nativeSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'raw':str(outside),'skinProfileWeldValidation':'passed'}]}))
        run=subprocess.run([str(PYTHON),str(APP/'tools/canonicalize_local.py'),'--data-root',str(private),'--native-root',str(private/'native'),'--output-root',str(output),'--asset',name],capture_output=True,text=True,encoding='utf-8',env=self.env)
        self.assertNotEqual(run.returncode,0,'Resume trusted an existing manifest raw path outside the configured private root: '+run.stdout);self.assertIn('private data root',run.stderr)
    def test_resume_detects_published_output_hash_change(self):
        private=self.folder/'private';name='cc_sm_constructor_demo';native=private/'native'/name;output=private/'published';native.mkdir(parents=True);output.mkdir()
        source=native/(name+'.glb');source.write_bytes(b'own source presence fixture');profile=native/'profiles.bin';profile.write_bytes(b'own profile presence fixture')
        (native/(name+'.json')).write_text(json.dumps({'extractorVersion':'5.0-skin-safe-three-weight','file':str(source),'skinProfileAuditFile':str(profile)}))
        published=output/(name+'.glb');published.write_text('own changed output marker')
        asset={'asset':name,'nativeSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'nativeProfileSha256':hashlib.sha256(profile.read_bytes()).hexdigest(),'raw':str(published),'publishedSha256':'0'*64,'skinProfileWeldValidation':'passed'}
        (output/'manifest.json').write_text(json.dumps({'extractorVersion':'5.0-canonical-skin-profile-safe','assets':[asset]}))
        run=subprocess.run([str(PYTHON),str(APP/'tools/canonicalize_local.py'),'--data-root',str(private),'--native-root',str(private/'native'),'--output-root',str(output),'--asset',name],capture_output=True,text=True,encoding='utf-8',env=self.env)
        self.assertNotEqual(run.returncode,0);self.assertIn('Existing generated asset differs',run.stderr)
    def test_extractor_cli_rejects_outside_output_before_archive_io(self):
        if CORE is None or DOTNET is None:self.skipTest('Optional extractor root/.NET executable not configured')
        binary=CORE/'bin/Sm2Extractor.dll'
        if not DOTNET.is_file()or not binary.is_file():self.skipTest('Existing BuildOnly smoke binary not ready')
        outside=self.folder/'outside';run=subprocess.run([str(DOTNET),str(binary),'--game',str(self.folder/'nonexistent-game'),'--data-root',str(self.folder/'private'),'--out',str(outside),'--inventory'],capture_output=True,text=True,encoding='utf-8',env=self.env)
        self.assertNotEqual(run.returncode,0);self.assertIn('inside the configured private data root',run.stderr);self.assertFalse(outside.exists())
    def test_no_assert_or_machine_path_in_public_math_modules(self):
        for name in ('canonical_math.py','skin_profile_validation.py'):
            text=(APP/'tools'/name).read_text(encoding='utf-8');tree=ast.parse(text)
            self.assertFalse(any(isinstance(node,ast.Assert)for node in ast.walk(tree)))
            self.assertFalse(any(isinstance(node,ast.Constant)and isinstance(node.value,str)and re.match(r'^[A-Za-z]:[/\\]',node.value)for node in ast.walk(tree)))
    def test_pinned_functional_transform_build_artifacts(self):
        if CORE is None:self.skipTest('Optional extractor root not configured')
        generated=CORE/'app/MeshBuilder.cs'
        if not generated.is_file():self.skipTest('BuildOnly smoke helpers not ready')
        text=generated.read_text(encoding='utf-8-sig');active=re.sub(r'//[^\n]*|/\*.*?\*/','',text,flags=re.S)
        start=active.index('private void AddVertexSkinningData( Vertex vertex )');end=active.index('private void AddVertexWeight',start);body=active[start:end]
        self.assertIn('Unsupported WEIGHT8 packing',body);self.assertIn('vertex.Weight8!=0',body)
        self.assertIn('AddChecked(vertex.Index4,vertex.Weight4)',body);self.assertIn('AddChecked(vertex.Index5,vertex.Weight5)',body)
        for n in (1,2,3):self.assertIn(f'AddVertexWeight( vertex.Index{n}',body)
        self.assertIn('(Object.MatrixLT * invMatrix).ToAssimp()',active);self.assertIn('boneObjectId < 0 || weight <= 0 || boneObjectId >= Graph.objects.Count',active)
        project=(CORE/'src/LibSaber/src/LibSaber.SpaceMarine2/LibSaber.SpaceMarine2.csproj').read_text();self.assertNotIn('ILRepack',project);self.assertIn('[16.1.2]',project)
        sdk=json.loads((CORE/'global.json').read_text());self.assertEqual(sdk['sdk']['version'],'8.0.426');self.assertEqual(sdk['sdk']['rollForward'],'disable')

if __name__=='__main__':unittest.main()
