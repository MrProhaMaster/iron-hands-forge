"""Own synthetic fixtures only; no installed game data is distributed in tests."""
import sys
sys.dont_write_bytecode=True
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import unittest,copy,json,tempfile,shutil,zipfile
from prepare_catalog import parse_sso,ParseError,merge_defaults,build_registry,resolve_class,prepare_catalog,MAIN,GEOM,SHARED,SOURCE_FILES,CLASSES

TEST_BASE=ROOT/'.build'/'tests'/'catalog-unit'

def synthetic():
    local={'meshes':['demo_group'],'availableColoringSlots':{'TERTIARY':{'__value':False}},'victoriesToUnlock':3,'__type':'GeomRegionCharacterBodySection'}
    cls={'masteryTypes':['PVE_SOLDIER'],'defaultArmorPreset':'PREDEFINED_PRESET_1','armorPresets':{'PREDEFINED_PRESET_1':{'bodySectionRegionUids':{'HELMET':{'__value':'demo_local'}}}},'bodySections':{'HELMET':{'regions':{'demo_local':local}}}}
    medic={'masteryTypes':['PVE_MEDIC'],'armorPresets':{'PREDEFINED_PRESET_1':{}}}
    source={MAIN:{'appearancesByTeams':{'LOYALIST':{'customizationPresets':{'PVE_PVP_SOLDIER':cls,'PVE_PVP_MEDIC':medic,'STORY_DEMO':{}},'sharedOutfitParts':{'outfitParts':{'HELMET':{'regions':{
        'demo_all':{'meshes':['all_group'],'__type':'SharedGeomRegionCharacterBodySection'},
        'demo_restricted':{'meshes':['restricted_group'],'isForAllCharacters':False,'appearanceUids':['PVE_PVP_SOLDIER'],'__type':'SharedGeomRegionCharacterBodySection'},
        'demo_denied':{'meshes':['denied_group'],'isForAllCharacters':False,'appearanceUids':[]},
        'demo_allowed_alias':{'meshes':['alias_group'],'isForAllCharacters':False,'allowedAppearanceUids':['PVE_PVP_SOLDIER']}}},
        'VANITY':{'regions':{'demo_shield':{'meshes':[],'equipmentActorMeshes':['demo_equipment'],'isForAllCharacters':False,'appearanceUids':['PVE_PVP_SOLDIER']}}}}}}}},
        GEOM:{'availableColoringSlots':{'PRIMARY':{'__value':True},'SECONDARY':{'__value':True},'TERTIARY':{'__value':True}},'useRarityFromOutfitSet':True,'__type':'GeomRegion'},
        SHARED:{'isForAllCharacters':True,'__type':'GeomRegionCharacterBodySection'}}
    bindings=[{'path':'synthetic/soldier.cls','actorType':'demo_actor','team':'LOYALIST','masteryType':'PVE_SOLDIER','template':'demo_soldier'},
        {'path':'synthetic/medic.cls','actorType':'demo_stub','team':None,'masteryType':None,'template':None}]
    return source,bindings

def dump_sso(value):
    if isinstance(value,dict):return '{'+' '.join(json.dumps(k)+' = '+dump_sso(v)for k,v in value.items())+'}'
    if isinstance(value,list):return '['+','.join(map(dump_sso,value))+']'
    if value is True:return 'True'
    if value is False:return 'False'
    if value is None:return 'null'
    return json.dumps(value,ensure_ascii=False)

class CatalogTests(unittest.TestCase):
    def setUp(self):
        TEST_BASE.mkdir(parents=True,exist_ok=True);self.folder=Path(tempfile.mkdtemp(prefix='own-fixture-',dir=TEST_BASE));assert self.folder.resolve().is_relative_to(TEST_BASE.resolve())
    def tearDown(self):
        target=self.folder.resolve();assert target.is_relative_to(TEST_BASE.resolve());shutil.rmtree(target)
    def registry(self):
        s,b=synthetic();return build_registry(s,b,'synthetic-build')[0]

    def test_parser_assignment_scalars_arrays_and_comments(self):
        actual=parse_sso('/* own */ root={a=-12 b=2.5 c=1e-2 hex=0x10 yes=True no=False n=null quoted="True" list=[1,"x",{k=False},] } //tail')
        self.assertEqual(actual,{'root':{'a':-12,'b':2.5,'c':.01,'hex':16,'yes':True,'no':False,'n':None,'quoted':'True','list':[1,'x',{'k':False}]}})
    def test_parser_escapes_and_unicode(self):
        actual=parse_sso(r'path="a\\b" quote="x\"y" unicode="\u041C\uD83D\uDE00" unknown="a\q"')
        self.assertEqual(actual,{'path':'a\\b','quote':'x"y','unicode':'М😀','unknown':'a\\q'})
    def test_parser_malformed_fails_closed(self):
        for text in ['a={','a=[1,','a="unfinished','a=1 a=2',r'a="\uZZZZ"','a=[1,,2]']:
            with self.subTest(text=text),self.assertRaises(ParseError):parse_sso(text)
    def test_deep_inheritance_false_override_without_mutation(self):
        base={'colors':{'a':True,'b':True},'all':True};child={'colors':{'b':False},'all':False}
        merged=merge_defaults(base,child);self.assertEqual(merged,{'colors':{'a':True,'b':False},'all':False});self.assertTrue(base['colors']['b'])
    def test_shared_filter_defaults_alias_and_medic_stub(self):
        ui=self.registry();soldier,medic=ui['classes'];options=soldier['slots'][0]['options'];self.assertEqual([o['id']for o in options],['demo_local','demo_all','demo_restricted','demo_allowed_alias'])
        self.assertEqual([o['id']for o in medic['slots'][0]['options']],['demo_all']);self.assertFalse(medic['available']);self.assertIsNone(medic['tpl']);self.assertEqual(medic['initialSelection'],{})
        all_option=options[1];self.assertTrue(all_option['isForAllCharacters']);self.assertIn('PVE_PVP_MEDIC',all_option['allowedAppearanceUids']);self.assertIn('STORY_DEMO',all_option['allowedAppearanceUids'])
        local=options[0];self.assertTrue(local['isDefault']);self.assertTrue(local['isInitial']);self.assertEqual(local['availableColoringSlots'],{'PRIMARY':True,'SECONDARY':True,'TERTIARY':False});self.assertEqual(local['locks'],{'victoriesToUnlock':3})
    def inventory(self):
        marker=self.folder/'geometry-presence.fixture';marker.write_text('own synthetic fixture')
        return {'asset':'demo_soldier','file':str(marker),'transformValidation':'passed','restSkinValidation':'passed','skinProfileWeldValidation':'passed',
          'objectMetadata':[{'id':1,'parentId':-1,'name':'root'},{'id':10,'parentId':1,'name':'demo_group'},{'id':11,'parentId':10,'name':'demo_body'},{'id':12,'parentId':1,'name':'demo_body_decal'},{'id':13,'parentId':10,'name':'hidden','affixes':'visibility_hidden'},{'id':14,'parentId':13,'name':'hidden_body'},{'id':15,'parentId':10,'name':'demo_CDT'},{'id':16,'parentId':10,'name':'lower_lod'}],
          'meshes':[{'objectId':11,'name':'demo_body','material':'paint','lod':0},{'objectId':11,'name':'demo_body','material':'metal','lod':0},{'objectId':12,'name':'demo_body_decal','material':'decal','lod':0},{'objectId':14,'name':'hidden_body','material':'paint','lod':0},{'objectId':15,'name':'demo_CDT','material':'paint','lod':0},{'objectId':16,'name':'lower_lod','material':'paint','lod':1}]}
    def test_ancestor_multimaterial_ids_and_technical_filter(self):
        cls=self.registry()['classes'][0];inv=self.inventory();resolve_class(cls,inv,self.folder/'inventory.json');option=cls['slots'][0]['options'][0]
        self.assertTrue(cls['geometryReady']);self.assertEqual(option['resolvedObjectIds'],[11]);self.assertEqual(option['resolvedMeshes'],['demo_body']);self.assertEqual(option['resolvedMeshRecordCount'],2);self.assertEqual(option['dependentDecalObjectIds'],[12]);self.assertEqual(option['resolutionStatus'],'complete')
    def test_equipment_pending_not_true_empty(self):
        cls=self.registry()['classes'][0];resolve_class(cls,self.inventory(),self.folder/'inventory.json');option=cls['slots'][1]['options'][0]
        self.assertEqual(option['resolutionStatus'],'equipment_pending');self.assertFalse(option['geometryAvailable']);self.assertFalse(option['geometryComplete']);self.assertEqual(option['equipmentResolutionStatus'],'pending_separate_actor')
    def test_no_inventory_wrong_class_or_bad_proof_never_ready(self):
        for mode in ('missing','wrong_class','unvalidated'):
            cls=self.registry()['classes'][0];inv=self.inventory()
            if mode=='missing':inv=None
            elif mode=='wrong_class':inv['asset']='different_class'
            else:inv['skinProfileWeldValidation']='pending'
            resolve_class(cls,inv,self.folder/'inventory.json');self.assertFalse(cls['geometryReady']);self.assertEqual(cls['slots'][0]['options'][0]['resolutionStatus'],'inventory_pending')
    def test_fresh_zip_pipeline_ignores_cached_catalog_bait(self):
        game=self.folder/'game';data=self.folder/'private';archive=game/'client_pc/root/paks/client/default/default_other.pak';archive.parent.mkdir(parents=True)
        source,_=synthetic()
        with zipfile.ZipFile(archive,'w')as z:
            for path in SOURCE_FILES:z.writestr(path,dump_sso(source.get(path,{})))
            for short in CLASSES:
                name=short.lower();actor={'__type':'demo_stub'}
                if short=='SOLDIER':actor={'__type':'demo_actor','properties':{'geom':{'nameTpl':'demo_soldier'},'prop_geom_customizer_character':{'characterInfo':{'team':'LOYALIST','masteryType':'PVE_SOLDIER'}}}}
                z.writestr(f'ssl/characters/player/marine/outfits/{name}/pc_marine_pve_{name}_client.cls',dump_sso(actor))
        for relative in ('production/roster/armor-options.json','tools/sm2-extractor/metadata/armor-partsets.json'):
            path=data/relative;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('invalid cache bait must not be read')
        summary=prepare_catalog(game,data);self.assertEqual(summary['classes'],2);self.assertEqual(summary['templateBindings'],1);self.assertEqual(summary['geometryReadyClasses'],[])
        fresh=json.loads((data/'production/roster/armor-options.json').read_text(encoding='utf-8'));self.assertEqual(fresh['classes'][0]['id'],'PVE_PVP_SOLDIER');self.assertFalse(fresh['classes'][1]['available'])
        self.assertEqual(len(json.loads((data/'tools/sm2-extractor/metadata/armor-partsets.json').read_text(encoding='utf-8'))['provenance']),16)

if __name__=='__main__':unittest.main()
