"""Portable Iron Hands preparation needs only a prepared package, never a game install."""
import importlib.util,json,struct,tempfile,unittest,zlib,hashlib
from pathlib import Path
SPEC=importlib.util.spec_from_file_location("prepare_iron_hands_library",Path(__file__).parents[1]/"tools/prepare_iron_hands_library.py")
PREP=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(PREP)
def write_json(path,value):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value),encoding="utf8")
def png():
 def chunk(tag,payload):return struct.pack(">I",len(payload))+tag+payload+struct.pack(">I",zlib.crc32(tag+payload)&0xffffffff)
 return b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">2I5B",1,1,8,6,0,0,0))+chunk(b"IDAT",zlib.compress(b"\0\xff\xff\xff\xff"))+chunk(b"IEND",b"")
def glb(doc,binary):
 encoded=json.dumps(doc).encode();encoded+=b" "*((-len(encoded))%4)
 return struct.pack("<5I",0x46546c67,2,28+len(encoded)+len(binary),len(encoded),0x4e4f534a)+encoded+struct.pack("<2I",len(binary),0x004e4942)+binary
class PrepareIronHandsTests(unittest.TestCase):
 def setUp(self):
  workspace=Path(__file__).parents[1]/".build";workspace.mkdir(exist_ok=True)
  self.temp=tempfile.TemporaryDirectory(prefix="prepare-iron-hands-",dir=workspace)
  self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name);self.source=self.root/"source";self.out=self.root/"out"
  self.native=b"\x00\x01\x02\x03"
  write_json(self.source/"catalog/decal_catalog.json",{"schema":"native-test","decals":[{"id":"Left_Pau_Decal_Iron_Hands","section":"LEFT_PAULDRON","material":"iron_hands_01","colorsNumber":1,"classMergedDefaultColoring":{"primary":"White_Scar"}}],"colors":[{"id":"White_Scar","classMergedParameters":{"tint":{"value":{"r":255,"g":255,"b":255,"a":255}}}}],"armorRegions":[]})
  write_json(self.source/"catalog/materials.json",{"materials":[{"slot":"LEFT_PAULDRON","materialKey":"iron_hands_01","customizationSet":"LEFT_PAULDRON_DECAL","family":"ch_lpd","textures":{"base":"native","colorMask":"native_cc"}}]})
  self.binding={"gameBuild":"local-fixture","classes":[{"classIds":["PVE_PVP_SOLDIER"],"sourceConstructor":"cc_sm_constructor_soldier","carriers":[{"nativeObjectId":17,"nativeName":"native","slot":"LEFT_PAULDRON","customizationSet":"LEFT_PAULDRON_DECAL","lod":0}],"armorOptionBindings":[{"classId":"PVE_PVP_SOLDIER","slot":"LEFT_PAULDRON","optionId":"left_ok","carrierObjectIds":[17],"isAbleToApplyDecals":None}]}]}
  write_json(self.source/"catalog/carrier_bindings.json",self.binding)
  self.carrier_manifest={"classes":[{"sourceConstructor":"cc_sm_constructor_soldier","file":"carriers/cc_sm_constructor_soldier_decal_carriers.glb"}]}
  write_json(self.source/"carriers/manifest.json",self.carrier_manifest)
  doc={"asset":{"version":"2.0","extras":{"source":"E:/private/game-model.glb"}},"nodes":[{"name":"native","mesh":0,"skin":0,"extras":{"sourceObjectId":17}}],"meshes":[{"primitives":[{"attributes":{"POSITION":0,"TEXCOORD_0":1,"JOINTS_0":2,"WEIGHTS_0":3}}]}],"buffers":[{"byteLength":4}],"skins":[{}]}
  (self.source/self.carrier_manifest["classes"][0]["file"]).write_bytes(glb(doc,self.native))
  for name in ["native","native_cc"]:
   p=self.source/"textures/png"/(name+".png");p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(png())
 def test_native_payloads_and_relative_manifest_are_preserved_without_game(self):
  manifest=PREP.prepare(self.source,self.out);target=self.out/PREP.DIRECTORY
  self.assertEqual(manifest["counts"]["nativeCarriers"],1)
  catalog=json.loads((target/"catalog.json").read_text())
  cr=catalog["classes"][0];self.assertEqual(cr["carriers"][0]["glbNodeIndices"],[0])
  doc,binary=PREP.glb_parts(self.out/cr["carrierGLB"]);self.assertEqual(binary,self.native);self.assertNotIn("source",doc["asset"]["extras"])
  self.assertEqual((target/"textures/native.png").read_bytes(),png())
  self.assertNotIn("E:",(target/"catalog.json").read_text())
  for row in manifest["files"]:
   raw=(self.out/row["path"]).read_bytes();self.assertEqual(hashlib.sha256(raw).hexdigest(),row["sha256"])
 def test_existing_output_is_not_overwritten(self):
  PREP.prepare(self.source,self.out)
  with self.assertRaises(FileExistsError):PREP.prepare(self.source,self.out)
 def test_carrier_source_reference_cannot_escape_prepared_package(self):
  self.carrier_manifest["classes"][0]["file"]="../outside.glb";write_json(self.source/"carriers/manifest.json",self.carrier_manifest)
  with self.assertRaisesRegex(ValueError,"Unsafe"):PREP.prepare(self.source,self.out)
  self.assertFalse((self.out/PREP.DIRECTORY).exists())
 def test_native_uv_and_skinning_are_required(self):
  p=self.source/self.carrier_manifest["classes"][0]["file"];doc,binary=PREP.glb_parts(p);del doc["meshes"][0]["primitives"][0]["attributes"]["JOINTS_0"];p.write_bytes(glb(doc,binary))
  with self.assertRaisesRegex(ValueError,"UV0/skinning"):PREP.prepare(self.source,self.out)
 def test_source_path_rejects_outside_file(self):
  outside=self.root/"outside.png";outside.write_bytes(png())
  with self.assertRaisesRegex(ValueError,"escapes"):PREP.source_file(self.source,"../outside.png")
if __name__=="__main__":unittest.main()
