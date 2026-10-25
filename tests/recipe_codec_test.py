"""Run: python tests/recipe_codec_test.py.
Also acts as a JSON stdin/stdout worker for Node interoperability tests.
"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import copy,json,unittest,subprocess,os,zlib,base64,binascii
from recipe_codec import normalize_recipe,encode_recipe,decode_recipe,RecipeCodecError,MAX_RAW_BYTES,MAX_CODE_LENGTH

def sample():
    return {'schema':'iron-hands-forge','version':1,'kind':'soldier','catalog':{'game':'SM2','build':'fixture-1','signature':'fixture-signature'},'soldiers':[{'id':'demo-soldier-01','role':'demo-role','classId':'demo-class','selection':{'helmet':'demo.helmet','torso':'demo.torso','leftGauntlet':'demo.gauntlet','weapon':'demo.weapon'},'paint':{'armor':'#20242A','metal':'#C0C0C0','lenses':'#F02020'},'motion':{'gait':'walk','stance':'armed','speedPct':100,'inPlace':True}}]}

def wrap(raw, compressed=None):
    payload=zlib.compress(raw) if compressed is None else compressed
    return 'IHF1.'+base64.urlsafe_b64encode(payload).rstrip(b'=').decode()+f'.{binascii.crc32(raw):08x}'

def node(op,value):
    env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'}
    result=subprocess.run([os.environ.get('FORGE_NODE','node'),str(ROOT/'tests/recipe-codec-bridge.mjs')],input=json.dumps({'op':op,'value':value},ensure_ascii=True),text=True,encoding='utf-8',capture_output=True,check=True,env=env,cwd=str(ROOT))
    return json.loads(result.stdout)

class CodecTests(unittest.TestCase):
    def test_golden_fixture(self):
        fixture=json.loads((ROOT/'tests/recipe-codec-golden.json').read_text(encoding='utf-8'))
        self.assertEqual(decode_recipe(fixture['code']),fixture['recipe'])
        self.assertEqual(encode_recipe(fixture['recipe']),fixture['code'])
        self.assertEqual(node('decode',fixture['code'])['result'],fixture['recipe'])

    def test_python_to_js_and_js_to_python(self):
        r=sample();r['soldiers'][0]['paint']['armor']='#aabbcc'
        self.assertEqual(node('decode',encode_recipe(r))['result'],normalize_recipe(r))
        encoded=node('encode',r);self.assertTrue(encoded['ok']);self.assertEqual(decode_recipe(encoded['result']),normalize_recipe(r))

    def test_unicode_numeric_keys_and_canonical_order(self):
        r=sample();r['catalog']['build']='Медуза😀';r['soldiers'][0]['selection']={'2':'два','10':'десять','😀':'astral','\ue000':'BMP'}
        py=encode_recipe(r);js=node('encode',r);self.assertTrue(js['ok']);self.assertEqual(decode_recipe(js['result']),normalize_recipe(r));self.assertEqual(node('decode',py)['result'],normalize_recipe(r))
        def raw(code):
            text=code.split('.')[1];return zlib.decompress(base64.urlsafe_b64decode(text+'='*(-len(text)%4)))
        # Native zlib versions may choose different valid DEFLATE blocks. The
        # canonical UTF8 bytes and CRC, not a compressor implementation, agree.
        self.assertEqual(raw(js['result']),raw(py));self.assertEqual(js['result'].split('.')[-1],py.split('.')[-1]);self.assertEqual(node('encode',r)['result'],js['result'])

    def test_roster_and_boundaries(self):
        r=sample();r['kind']='roster';r['soldiers']=[{**copy.deepcopy(r['soldiers'][0]),'id':f'IH-{i}'}for i in range(20)]
        self.assertEqual(len(decode_recipe(encode_recipe(r))['soldiers']),20)
        for n in (50,150,200):
            r['soldiers'][0]['motion']['speedPct']=n;self.assertEqual(decode_recipe(encode_recipe(r))['soldiers'][0]['motion']['speedPct'],n);self.assertEqual(node('normalize',r)['result']['soldiers'][0]['motion']['speedPct'],n)

    def test_invalid_schemas_rejected_by_both(self):
        variants=[]
        def change(fn):
            r=sample();fn(r);variants.append(r)
        change(lambda r:r.update(extra=1));change(lambda r:r['catalog'].update(extra=1));change(lambda r:r['soldiers'][0].update(objectId=42));change(lambda r:r['soldiers'][0]['paint'].update(extra='x'));change(lambda r:r['soldiers'][0]['motion'].update(extra=True))
        for key in ('__proto__','constructor','prototype'):change(lambda r,key=key:r['soldiers'][0]['selection'].update({key:'x'}))
        change(lambda r:r.update(version=True));change(lambda r:r.update(soldiers=[]));change(lambda r:r['soldiers'].append(copy.deepcopy(r['soldiers'][0])))
        for value in (49,201,100.5,True):change(lambda r,value=value:r['soldiers'][0]['motion'].update(speedPct=value))
        change(lambda r:r['soldiers'][0]['motion'].update(inPlace=False));change(lambda r:r['soldiers'][0]['paint'].update(armor='#fff'));change(lambda r:r['catalog'].update(signature=None));change(lambda r:r['soldiers'][0].update(id='😀'*161))
        for r in variants:
            with self.subTest(recipe=r):
                with self.assertRaises(RecipeCodecError):normalize_recipe(r)
                self.assertFalse(node('normalize',r)['ok'])

    def test_wire_corruption_schema_and_bombs(self):
        raw=json.dumps(normalize_recipe(sample()),ensure_ascii=False,sort_keys=True,separators=(',',':')).encode();compressed=zlib.compress(raw);good=wrap(raw)
        bad=[good[:-1]+('0'if good[-1]!='0'else'1'),'IHF1.Zh.00000000','IHF1.Zg==.00000000','X'+good,'x'*(MAX_CODE_LENGTH+1),wrap(raw,compressed+b'trailing'),wrap(raw,compressed+compressed),wrap(raw,compressed[:-1]),wrap(raw,compressed[:-1]+bytes([compressed[-1]^1])),wrap(b'A'*(MAX_RAW_BYTES+1)),wrap(b'\xff'),wrap(b'\xef\xbb\xbf'+raw),wrap(b' '+raw),wrap(raw.replace(b'"version":1',b'"version":1,"version":1'))]
        wrong=sample();wrong['schema']='other';bad.append(wrap(json.dumps(wrong,separators=(',',':')).encode()))
        proto=raw.replace(b'"selection":{',b'"selection":{"__proto__":"x",');bad.append(wrap(proto))
        for code in bad:
            with self.subTest(code=code[:60]):
                with self.assertRaises(RecipeCodecError):decode_recipe(code)
                self.assertFalse(node('decode',code)['ok'])

    def test_large_input_limit(self):
        r=sample();r['soldiers'][0]['selection']={f'slot{i}':'a'*160 for i in range(900)}
        with self.assertRaises(RecipeCodecError)as e:encode_recipe(r)
        self.assertEqual(e.exception.code,'LIMIT_EXCEEDED');self.assertFalse(node('encode',r)['ok'])

    def test_new_objects_and_id_length(self):
        r=sample();r['soldiers'][0]['id']='😀'*160;n=normalize_recipe(r);self.assertEqual(len(n['soldiers'][0]['id']),160)
        n['soldiers'][0]['selection']['helmet']='changed';self.assertNotEqual(r['soldiers'][0]['selection']['helmet'],'changed')

if __name__=='__main__':
    if '--worker'in sys.argv:
        sys.stdin.reconfigure(encoding='utf-8');sys.stdout.reconfigure(encoding='utf-8')
        try:
            request=json.load(sys.stdin);op=request['op'];value=request['value'];fn={'encode':encode_recipe,'decode':decode_recipe,'normalize':normalize_recipe}[op];result=fn(value)
            print(json.dumps({'ok':True,'result':result},ensure_ascii=True))
        except Exception as error:print(json.dumps({'ok':False,'code':getattr(error,'code','ERROR'),'error':str(error)},ensure_ascii=True))
    else:unittest.main()
