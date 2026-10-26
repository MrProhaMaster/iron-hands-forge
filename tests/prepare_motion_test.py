"""Synthetic own ETNA fixtures only; no animation data from the game is stored."""
import sys
sys.dont_write_bytecode=True
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import unittest,tempfile,shutil,struct,json,zipfile,hashlib,copy
import numpy as np
from sani_decoder import decode,chunks,quaternions
from prepare_motion import CLIPS,prepare_motion,validate_clip,load_motion_bindings,validate_motion_bindings

BASE=ROOT/'.build'/'tests'/'motion-unit'

def own_sani(bones=282,streamed=False):
    names=[f'DEMO_BONE_{i}'.encode()for i in range(bones)]
    meta=struct.pack('<ffIII',1/30,30,2,bones,0)+b''.join(struct.pack('<I',len(n))+n for n in names)
    data=bytearray(b'ETNA'+struct.pack('<H',2))
    def chunk(kind,payload):
        data.extend(struct.pack('<HI',kind,len(data)+6+len(payload)));data.extend(payload)
    chunk(241,meta)
    if streamed:chunk(246,b'')
    else:
        regular=struct.pack('<H6I',2,0,0,0,bones,bones,0)
        regular+=struct.pack('<'+'H'*(bones*2),*list(range(bones)),*list(range(bones)))
        regular+=struct.pack('<14f',1,2,3,0,0,0,0,0,0,0,0,0,0,0)
        regular+=b'\0'*(bones*3*2*2)
        chunk(242,regular)
    return bytes(data)

class MotionTests(unittest.TestCase):
    def setUp(self):
        BASE.mkdir(parents=True,exist_ok=True);self.folder=Path(tempfile.mkdtemp(prefix='own-motion-',dir=BASE));assert self.folder.resolve().is_relative_to(BASE.resolve())
    def tearDown(self):
        target=self.folder.resolve();assert target.is_relative_to(BASE.resolve());shutil.rmtree(target)
    def test_synthetic_inline_decoder_fixed_tracks(self):
        path=self.folder/'demo.sani';raw=own_sani();path.write_bytes(raw);result=decode(path)
        self.assertEqual(result['boneNames'][0],'DEMO_BONE_0');self.assertEqual(len(result['channels']),282);self.assertEqual(result['channels'][0]['positions'],[[1.,2.,3.],[1.,2.,3.]]);self.assertEqual(result['channels'][0]['rotations'],[[0.,0.,0.,1.],[0.,0.,0.,1.]])
        self.assertEqual(result['sourceSha256'],hashlib.sha256(raw).hexdigest());self.assertTrue(validate_clip(result)['finite']);self.assertEqual(result['validation']['loopMaxPositionDistance'],0.)
    def test_stereographic_quaternion_math(self):
        q,_=quaternions(np.array([[0.,0.,0.],[0.,0.,.5],[0.,0.,1.]]))
        np.testing.assert_allclose(q,[[0,0,0,1],[0,0,.8,.6],[0,0,1,0]],atol=1e-14)
    def test_streamed_and_truncated_fail_closed(self):
        path=self.folder/'streamed.sani';path.write_bytes(own_sani(streamed=True))
        with self.assertRaises(NotImplementedError):decode(path)
        for raw in (b'bad',own_sani()[:-1],b'ETNA'+struct.pack('<H',2)+struct.pack('<HI',241,7)):
            with self.subTest(length=len(raw)),self.assertRaises((ValueError,struct.error)):chunks(raw)
    def game_zip(self,missing=None):
        game=self.folder/'game';archive=game/'client_pc/root/paks/client/default/default_animation.pak';archive.parent.mkdir(parents=True,exist_ok=True)
        with zipfile.ZipFile(archive,'w')as z:
            for i,(_,_,entry,_)in enumerate(CLIPS):
                if i!=missing:z.writestr(entry,own_sani())
        return game
    def test_fresh_private_outputs_and_provenance(self):
        data=self.folder/'private';summary=prepare_motion(self.game_zip(),data);self.assertTrue(summary['completed']);self.assertEqual(summary['prepared'],4)
        for clip,(_,_,entry,folder)in zip(summary['clips'],CLIPS):
            expected=data/'assets/animations'/folder/(Path(entry).stem+'.animation.json');self.assertEqual(Path(clip['output']),expected);self.assertEqual(clip['boneCount'],282);self.assertFalse(clip['trajectoryApplied']);self.assertEqual(hashlib.sha256(Path(clip['sourceFile']).read_bytes()).hexdigest(),clip['sourceSha256']);self.assertTrue(expected.is_file())
        self.assertTrue((data/'assets/animations/motion-manifest.json').is_file())
    def test_missing_required_clip_is_not_complete(self):
        summary=prepare_motion(self.game_zip(missing=2),self.folder/'private');self.assertFalse(summary['completed']);self.assertEqual(summary['prepared'],3);self.assertEqual(len(summary['failures']),1)
    def test_own_motion_bindings_cover_seven_classes_and_four_private_sources(self):
        bindings=load_motion_bindings();self.assertEqual(len(bindings['clips']),4)
        self.assertEqual(set(bindings['classes']),{'PVE_PVP_'+name for name in ['SOLDIER','SNIPER','SUPPORT','RAIDER','TANK','BERSERK','ENGINEER']})
        self.assertEqual(bindings['bindingPolicy'],'shared-preview-validated');self.assertEqual(len(bindings['inheritedOnlyChannels']),83)
        for binding in bindings['classes'].values():self.assertEqual(set(binding['clipIds']),{'walk','run'})
    def test_motion_binding_traversal_and_wrong_gait_are_rejected(self):
        for mode in ('source','output','clip','stance'):
            bindings=copy.deepcopy(load_motion_bindings());first=next(iter(bindings['clips']))
            if mode=='source':bindings['clips'][first]['sourceEntry']='../private.sani'
            elif mode=='output':bindings['clips'][first]['output']='C:/private.animation.json'
            elif mode=='clip':next(iter(bindings['classes'].values()))['clipIds']['walk']['unarmed']='unknown'
            else:next(iter(bindings['classes'].values()))['clipIds']['walk']['unarmed']='run_unarmed'
            with self.subTest(mode=mode),self.assertRaises(ValueError):validate_motion_bindings(bindings)
    def test_portable_decoder_has_no_machine_path_or_drive_guard(self):
        text=(ROOT/'tools/sani_decoder.py').read_text(encoding='utf-8');self.assertNotIn('E:/MedusaSiege',text);self.assertNotIn('drive.lower()',text)

if __name__=='__main__':unittest.main()
