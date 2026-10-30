"""Prepare the portable Iron Hands decal subset from an existing local SM2 export.
Never reads a game installation. Never rewrites the source export or constructor GLBs.
Usage: python prepare_iron_hands_library.py --source /prepared/decal-package --data-root /new/ForgeData
"""
from __future__ import annotations
import argparse, hashlib, json, re, struct
from pathlib import Path

DIRECTORY = "assets/customization/iron-hands-v1"
SCHEMA = "iron-hands-forge-customization-library"
LABELS = {
 "helmet_custom_champion_iron_hands":"Iron Hands champion helmet",
 "backpack_engineer_champion_iron_hands":"Iron Hands champion backpack",
 "chest_custom_champion_iron_hands":"Iron Hands champion chest",
 "chest_custom_champion_iron_hands_engineer":"Iron Hands champion chest — Techmarine",
 "chest_custom_champion_iron_hands_raider":"Iron Hands champion chest — Assault",
 "chest_custom_champion_iron_hands_support":"Iron Hands champion chest — Heavy",
 "chest_custom_champion_iron_hands_tank":"Iron Hands champion chest — Bulwark",
 "left_pauldron_custom_iron_hands":"Iron Hands left pauldron",
 "right_pauldron_custom_iron_hands":"Iron Hands right pauldron",
 "left_gauntlet_custom_iron_hands":"Iron Hands left gauntlet",
 "right_gauntlet_custom_iron_hands":"Iron Hands right gauntlet",
 "left_greave_custom_iron_hands":"Iron Hands left greave",
 "right_greave_custom_iron_hands":"Iron Hands right greave",
 "left_pauldron_custom_champion_iron_hands":"Iron Hands champion left pauldron",
 "right_pauldorn_custom_champion_iron_hands":"Iron Hands champion right pauldron",
 "left_gauntlet_custom_champion_iron_hands":"Iron Hands champion left gauntlet",
 "right_gauntlet_custom_champion_iron_hands":"Iron Hands champion right gauntlet",
 "left_greave_custom_champion_iron_hands":"Iron Hands champion left greave",
 "right_greave_custom_champion_iron_hands":"Iron Hands champion right greave",
 "vanity_engineer_champion_iron_hands":"Iron Hands champion servo-arm",
 "vanity_tabard_champion_iron_hands":"Iron Hands champion tabard",
 "forge_left_bionic_v1":"Bionic left arm",
}
SECTIONS = ("LEFT_PAULDRON", "RIGHT_PAULDRON", "LEFT_GREAVE", "RIGHT_GREAVE")
def read(path): return json.loads(path.read_text(encoding="utf-8-sig"))
def sha(data): return hashlib.sha256(data).hexdigest()
def source_file(source,relative):
 p=source/relative
 if Path(relative).is_absolute() or not p.resolve().is_relative_to(source.resolve()) or not p.is_file():raise ValueError('Source resource escapes its prepared package')
 return p
def portable(value):
 if isinstance(value,dict): return {k:portable(v) for k,v in value.items() if k not in ("sourcePak","sourceJSON","sourceGLB","sourceEntry","raw","declared","sourceMeshRecords","sourceMips","resourcePak")}
 if isinstance(value,list): return [portable(v) for v in value]
 if isinstance(value,str) and (re.search(r"[A-Za-z]:[\\/]",value) or value.startswith(("\\\\","/home/","/Users/"))):
  raise ValueError("Local path in portable catalog")
 return value
def glb_parts(path):
 raw=path.read_bytes()
 if len(raw)<28: raise ValueError("Truncated native carrier GLB")
 magic,ver,size,ln,kind=struct.unpack_from("<5I",raw)
 if (magic,ver,size,kind)!=(0x46546c67,2,len(raw),0x4e4f534a):raise ValueError("Invalid native carrier GLB")
 at=20+ln
 if at+8>len(raw):raise ValueError("Missing carrier binary")
 bn,bk=struct.unpack_from("<2I",raw,at)
 if bk!=0x004e4942 or at+8+bn!=len(raw):raise ValueError("Invalid carrier binary")
 return json.loads(raw[20:at]),raw[at+8:]
def carrier_bytes(path):
 doc,binary=glb_parts(path)
 source=doc.get("asset",{}).get("extras",{}).get("source","")
 constructor=Path(source.replace("\\","/")).stem
 doc["asset"]["extras"]={"sourceConstructor":constructor,"nativeGeometryUnchanged":True}
 doc=portable(doc)
 encoded=json.dumps(doc,separators=(",",":"),ensure_ascii=False).encode()
 encoded+=b" "*((-len(encoded))%4)
 result=struct.pack("<5I",0x46546c67,2,28+len(encoded)+len(binary),len(encoded),0x4e4f534a)+encoded+struct.pack("<2I",len(binary),0x004e4942)+binary
 return result,doc,sha(binary)
def png_info(path):
 with path.open("rb") as f: b=f.read(29)
 if b[:8]!=b"\x89PNG\r\n\x1a\n":raise ValueError("Invalid decal PNG")
 return {"width":struct.unpack(">I",b[16:20])[0],"height":struct.unpack(">I",b[20:24])[0],"bitDepth":b[24]}
def prepare(source:Path,data_root:Path):
 source=source.resolve();data_root=data_root.resolve()
 target=data_root/DIRECTORY
 if target.exists():raise FileExistsError("Iron Hands subset already exists; choose a fresh output data folder: "+str(target))
 dcat=read(source/"catalog/decal_catalog.json");mcat=read(source/"catalog/materials.json")
 bindings=read(source/"catalog/carrier_bindings.json");carrier_manifest=read(source/"carriers/manifest.json")
 decals=[d for d in dcat["decals"] if re.search(r"iron.?hands|_IH_",d["id"],re.I) or d.get("material")=="default"]
 if not any(d.get("id")=="Left_Pau_Decal_Iron_Hands" for d in decals):raise ValueError("Missing native Iron Hands decal")
 mats=[];texture_names=set()
 for d in decals:
  hits=[m for m in mcat["materials"] if m["slot"]==d["section"] and m["materialKey"]==d["material"]]
  if len(hits)!=1:raise ValueError("Ambiguous native material binding: "+d["id"])
  if not any(x["slot"]==hits[0]["slot"] and x["materialKey"]==hits[0]["materialKey"] for x in mats):mats.append(hits[0])
  texture_names.update(v for v in hits[0].get("textures",{}).values() if v)
 plan={}
 textures={}
 for name in sorted(texture_names):
  if not re.fullmatch(r"[A-Za-z0-9_]+",name):raise ValueError("Unsafe texture identifier")
  p=source_file(source,"textures/png/"+name+".png")
  raw=p.read_bytes();rel=DIRECTORY+"/textures/"+name+".png"
  plan[rel]=raw;textures[name]={"path":rel,**png_info(p)}
 classes=[]
 for c in bindings["classes"]:
  ids=c.get("classIds",[])
  entry=next((r for r in carrier_manifest["classes"] if r.get("sourceConstructor")==c["sourceConstructor"]),None)
  if not ids or not entry or not entry.get("file"):continue
  if not re.fullmatch(r'cc_sm_constructor_[a-z0-9_]+',c['sourceConstructor']) or entry['file']!='carriers/'+c['sourceConstructor']+'_decal_carriers.glb':raise ValueError('Unsafe native carrier source reference')
  raw,doc,payload_hash=carrier_bytes(source_file(source,entry['file']))
  rel=DIRECTORY+"/carriers/"+c["sourceConstructor"]+"_decal_carriers.glb";plan[rel]=raw
  nodes={}
  for i,n in enumerate(doc.get("nodes",[])):
   if "mesh" in n:
    oid=n.get("extras",{}).get("sourceObjectId")
    if not isinstance(oid,int):raise ValueError("Carrier is missing native ObjectID")
    nodes.setdefault(oid,[]).append((i,n))
  carriers=[]
  for cr in c["carriers"]:
   oid=cr["nativeObjectId"];hits=nodes.get(oid,[])
   if not hits:raise ValueError("Missing carrier geometry")
   attrs=[list(p.get("attributes",{})) for _,n in hits for p in doc["meshes"][n["mesh"]]["primitives"]]
   if any("TEXCOORD_0"not in a or "JOINTS_0"not in a or "WEIGHTS_0"not in a for a in attrs):raise ValueError("Carrier UV0/skinning missing")
   row={k:cr[k]for k in ("nativeObjectId","nativeName","parentId","parentName","slot","customizationSet","lod")if k in cr}
   row.update(glbNodeIndices=[i for i,_ in hits],glbMeshIndices=sorted({n["mesh"]for _,n in hits}),
      attributes=attrs,uvSet=0,skinned=all("skin"in n for _,n in hits))
   carriers.append(row)
  opts=[]
  for o in c["armorOptionBindings"]:
   row={k:o[k]for k in ("classId","slot","optionId","carrierObjectIds","carrierNames","resolvedObjectIds","dependentDecalObjectIds","isAbleToApplyDecals","geometryComplete","support")if k in o}
   regions=[r for r in dcat.get("armorRegions",[]) if r["id"]==o["optionId"]and r["section"]==o["slot"]and(r.get("appearanceId")==o["classId"]or r.get("shared"))]
   row["explicitlyDisallowed"]=o.get("isAbleToApplyDecals")is False or any(r.get("isAbleToApplyDecalsDeclared")is False for r in regions)
   opts.append(row)
  classes.append({"sourceConstructor":c["sourceConstructor"],"classIds":ids,"carrierGLB":rel,
    "binaryPayloadSha256":payload_hash,"carriers":carriers,"armorOptionBindings":opts})
 colors=[]
 for c in dcat["colors"]:
  params=c.get("classMergedParameters",{});rgba=params.get("tint",{}).get("value")
  colors.append({"id":c["id"],"label":c["id"].replace("_"," "),"rgba":{k:rgba[k]for k in "rgba"}if isinstance(rgba,dict)and all(k in rgba for k in "rgba")else None,
   "declaredParameters":c.get("declaredParameters"),"parameters":params})
 metadata={"schema":"iron-hands-forge-iron-hands-catalog","version":1,"gameBuild":bindings.get("gameBuild"),
  "sections":list(SECTIONS),"armorTags":{key:{"id":key,"label":label,"tags":["iron-hands"],"chapter":"iron-hands"}for key,label in LABELS.items()},
  "decals":[{k:d[k]for k in ("id","section","material","colorsNumber","declaredDefaultColoring","classMergedDefaultColoring")if k in d}for d in decals],
  "materials":[{k:m[k]for k in ("slot","family","customizationSet","materialKey","textures","detail","shader","parameters")if k in m}for m in mats],
  "colors":colors,"textures":textures,"classes":classes,
  "placement":"Native curved skinned carrier meshes; original UV0, weights and inverse binds retained.",
  "shaderPolicy":"Authored portable RGB-mask color/normalized-alpha adapter, not recovered Saber GLT shader parity. Base images sRGB; masks/spec/normal Non-Color."}
 metadata=portable(metadata)
 cat_rel=DIRECTORY+"/catalog.json"
 plan[cat_rel]=(json.dumps(metadata,ensure_ascii=False,indent=2)+"\n").encode()
 files=[{"path":p,"bytes":len(raw),"sha256":sha(raw)}for p,raw in sorted(plan.items())]
 manifest={"schema":SCHEMA,"version":1,"catalog":cat_rel,"gameBuild":bindings.get("gameBuild"),"files":files,
  "counts":{"decals":len(decals),"ironHandsAndSuccessorDecals":sum(d.get("material")!="default"for d in decals),
   "pngs":len(textures),"classLibraries":len(classes),"nativeCarriers":sum(len(c["carriers"])for c in classes)},
  "source":{"kind":"existing-local-SM2-customization-export","catalogSchema":dcat["schema"],
   "catalogSha256":sha((source/"catalog/decal_catalog.json").read_bytes()),"gameFilesRequiredAtRuntime":False}}
 target.mkdir(parents=True,exist_ok=False)
 for rel,raw in plan.items():
  p=data_root/rel
  assert p.resolve().is_relative_to(target.resolve())
  p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
 (target/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 return manifest
if __name__=="__main__":
 p=argparse.ArgumentParser(description=__doc__);p.add_argument("--source",required=True,type=Path);p.add_argument("--data-root",required=True,type=Path)
 a=p.parse_args();result=prepare(a.source,a.data_root);print(json.dumps({"ready":True,"directory":DIRECTORY,"counts":result["counts"],"bytes":sum(f["bytes"]for f in result["files"])}))
