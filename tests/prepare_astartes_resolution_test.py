import importlib.util,json,tempfile,unittest
from pathlib import Path
SCRIPT=Path(__file__).resolve().parents[1]/'tools/prepare_astartes_library.py'
spec=importlib.util.spec_from_file_location('astartes_preparation',SCRIPT);lib=importlib.util.module_from_spec(spec);spec.loader.exec_module(lib)
class ExactSourceSelectorTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
 def tearDown(self):self.tmp.cleanup()
 def model(self,filename,objects,meshes,retail=False,name='cc_sm_constructor_soldier'):
  p=self.root/filename;p.write_text(json.dumps({'objectMetadata':objects,'meshes':meshes}));return lib.Model(name,self.root/'unused.glb',p,retail)
 def fixture(self):
  mod=self.model('mod.json',[{'id':1,'name':'soldier_cuirasse_01_grp'},{'id':2,'parentId':1,'name':'soldier_cuirasse_01_rope_01'},{'id':3,'parentId':1,'name':'soldier_cuirasse_01_aquila'},{'id':10,'name':'legacy_grp'},{'id':11,'parentId':10,'name':'legacy_surface'}],[{'objectId':2,'name':'soldier_cuirasse_01_rope_01'},{'objectId':3,'name':'soldier_cuirasse_01_aquila'},{'objectId':11,'name':'legacy_surface'}])
  native=self.model('native.json',[{'id':6617,'name':'soldier_cuirasse_01'}],[{'objectId':6617,'name':'soldier_cuirasse_01'}],True);return mod,native
 def test_exact_native_cuirass_preempts_unrelated_mod_group_children(self):
  mod,native=self.fixture();self.assertEqual(mod.resolve('soldier_cuirasse_01'),{2,3});lib.prefer_exact_source_selectors([mod,native]);self.assertFalse(mod.exists('soldier_cuirasse_01'));self.assertEqual(mod.resolve('soldier_cuirasse_01'),set());self.assertEqual(native.resolve('soldier_cuirasse_01'),{6617})
 def test_fallback_only_spelling_alias_remains_available(self):
  mod,native=self.fixture();lib.prefer_exact_source_selectors([mod,native]);self.assertEqual(mod.resolve('legacy'),{11});self.assertEqual(mod.aliases['legacy']['actualNames'],['legacy_grp'])
 def test_explicit_primary_group_still_selects_its_actual_children(self):
  mod,native=self.fixture();lib.prefer_exact_source_selectors([mod,native]);self.assertEqual(mod.resolve('soldier_cuirasse_01_grp'),{2,3});self.assertEqual(mod.resolve('soldier_cuirasse_01_aquila'),{3})
 def test_case_insensitive_exact_donor_priority(self):
  mod,native=self.fixture();lib.prefer_exact_source_selectors([mod,native]);self.assertEqual(mod.resolve('SOLDIER_CUIRASSE_01'),set());self.assertEqual(native.resolve('SOLDIER_CUIRASSE_01'),{6617})
if __name__=='__main__':unittest.main()