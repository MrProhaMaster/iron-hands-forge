"""Prepare the complete source-backed Astartes option library, without installing the game/mod."""
from pathlib import Path,PureWindowsPath
import argparse,collections,copy,hashlib,json,os,re,struct,sys
import numpy as np
sys.dont_write_bytecode=True
DIRECTORY='assets/customization/astartes-v1'
SLOTS={'MODDED_SLOT_1':'Accessories','MODDED_SLOT_2':'Capes','MODDED_SLOT_3':'Heads','MODDED_SLOT_4':'Tabards & cloth','ASTARTES_EQUIPMENT':'Class equipment'}
BASE={'cc_sm_constructor_soldier':'PVE_PVP_SOLDIER','cc_sm_constructor_raider':'PVE_PVP_RAIDER','cc_sm_constructor_tank':'PVE_PVP_TANK','cc_sm_constructor_berserk':'PVE_PVP_BERSERK','cc_sm_constructor_sniper':'PVE_PVP_SNIPER','cc_sm_constructor_support':'PVE_PVP_SUPPORT','cc_sm_constructor_engineer':'PVE_PVP_ENGINEER','cc_captain':'PVE_PVP_SOLDIER','cc_titus_menu':'PVE_PVP_SOLDIER','apothecary_arms':'PVE_PVP_SOLDIER','combat_shield':'PVE_PVP_TANK'}
BASE.update({'cc_titus':'PVE_PVP_SOLDIER','cc_story_companion2':'PVE_PVP_SOLDIER','cc_sm_champion_tank_01':'PVE_PVP_TANK','cc_sm_champion_tank_02':'PVE_PVP_TANK','cc_story_companion1':'PVE_PVP_SOLDIER','cc_ch_constructor_tank':'PVE_PVP_TANK'})
NATIVE_BINDINGS={'right_gauntlet_non_set_dark_angel':'retail_cc_sm_champion_tank_01','right_gauntlet_non_set_black_templars':'retail_cc_sm_champion_tank_02'}
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def digest(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
 return h.hexdigest()
def write(p,v):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes((json.dumps(v,ensure_ascii=False,indent=2)+'\n').encode('utf8'))
def portable(v):
 if isinstance(v,dict):return{k:portable(x) for k,x in v.items()}
 if isinstance(v,list):return[portable(x)for x in v]
 if isinstance(v,str)and re.match(r'^(?:[A-Za-z]:[\\/]|\\\\|/)',v):return 'source-private/'+v.replace('\\','/').split('/')[-1]
 return v
def glb(p):
 with Path(p).open('rb') as f:
  magic,version,total,size,kind=struct.unpack('<5I',f.read(20));assert magic==0x46546c67 and version==2 and total==Path(p).stat().st_size
  d=json.loads(f.read(size));length,kind=struct.unpack('<II',f.read(8));assert kind==0x004e4942
 return d,28+size,length
class Model:
 def __init__(self,name,file,metadata,retail=False):
  self.name=name;self.id=('retail_'if retail else'astartes_')+name;self.file=Path(file);self.meta=read(metadata);self.retail=retail
  self.records=self.meta['meshes'];self.objects={o['id']:o for o in self.meta['objectMetadata']};self.index=collections.defaultdict(set);self.names=set();self.pending=set();self.aliases={};self.normalized=collections.defaultdict(list);self.exact_selector_inventory=set()
  for o in self.objects.values():
   for key in ['name','readName','readOnlyName','fullPath']:
    value=o.get(key)
    if isinstance(value,str)and value:self.names.add(value.lower())
  for m in self.records:
   if m['name'].lower().startswith('rb_'):continue
   seen=set();o=self.objects.get(m['objectId'])
   while o and o['id']not in seen:
    seen.add(o['id'])
    for key in ['name','readName','readOnlyName','fullPath']:
     value=o.get(key)
     if isinstance(value,str)and value:self.index[value.lower()].add(m['objectId'])
    o=self.objects.get(o.get('parentId'))
  # Conservative source-name spelling aliases only; retain exact selectors and every decision.
  if self.name=='combat_shield':
   ruby=[m for m in self.records if m['name'].startswith('combat_shield_spacewolf_shield_') and m.get('material','').startswith('ruby_')]
   if ruby:
    self.index['combat_shield_spacewolf_ruby']={m['objectId']for m in ruby};self.names.add('combat_shield_spacewolf_ruby')
    self.aliases['combat_shield_spacewolf_ruby']={'kind':'native-material-split','actualNames':[m['name']for m in ruby],'objectIds':sorted(self.index['combat_shield_spacewolf_ruby'])}
  for name in self.index:self.normalized[self.normalize(name)].append(name)
 @staticmethod
 def normalize(name):
  name=name.lower().rstrip('_')
  while re.search(r'_(?:grp|group|sim)$',name):name=re.sub(r'_(?:grp|group|sim)$','',name).rstrip('_')
  return name
 def resolve(self,name):
  key=name.lower()
  if key in self.index:return set(self.index[key])
  # A source-exact donor mesh takes precedence over a guessed group spelling.
  if key in self.exact_selector_inventory:return set()
  normalized=self.normalize(key)
  if normalized=='mark8_knee_scul':normalized='mark8_knee_scull'
  names=self.normalized.get(normalized,[])
  choices={tuple(sorted(self.index[n]))for n in names}
  if len(choices)==1:
   ids=set(next(iter(choices)));self.aliases[key]={'kind':'source-name-spelling','actualNames':names,'objectIds':sorted(ids)}
   return ids
  return set()
 def exists(self,name):return name.lower()in self.names or bool(self.resolve(name))
 def descriptor(self):return{'id':self.id,'sourceTemplate':self.name,'sourceClassId':BASE[self.name],'sourceClassPolicy':'Forge donor rig family; exact source template and source actor binding remain authoritative','glb':DIRECTORY+'/models/'+self.id+'.glb','metadata':DIRECTORY+'/models/'+self.id+'.json','validation':{'transform':'passed','restSkin':'passed','weightPacking':'passed','skinProfileWeld':'passed'}}
def prefer_exact_source_selectors(models):
 """Keep explicit primary groups; never let suffix guessing pre-empt an exact donor."""
 inventory=set().union(*(set(model.index)for model in models))
 for model in models:model.exact_selector_inventory=inventory
 return inventory
def compact(model,target,selected):
 """Copy every selected accessor bit-for-bit; preserve palettes, nodes and rest matrices."""
 source=model.file;doc,base,_=glb(source);blob=np.memmap(source,dtype='u1',mode='r')
 ids=[i for i,m in enumerate(model.records)if m['objectId']in selected]
 meshmap={old:new for new,old in enumerate(ids)}
 keep=[i for i,n in enumerate(doc['nodes'])if'mesh'not in n or n['mesh']in meshmap];nodemap={old:new for new,old in enumerate(keep)}
 out={'asset':{'version':'2.0','generator':'Iron Hands Forge source-exact native subset'},'scene':0,'scenes':[{'nodes':[nodemap[n]for n in doc['scenes'][doc.get('scene',0)]['nodes']if n in nodemap]}],'nodes':[],'meshes':[],'skins':[],'materials':[],'buffers':[{}],'bufferViews':[],'accessors':[]}
 blocks=[];length=0;accessor_map={};skinmap={};matmap={}
 types={5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'};dims={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16,'MAT3':9,'MAT2':4}
 def accessor(ai):
  nonlocal length
  if ai in accessor_map:return accessor_map[ai]
  old=doc['accessors'][ai];assert'sparse'not in old
  view=doc['bufferViews'][old['bufferView']];dtype=np.dtype(types[old['componentType']]);width=dims[old['type']]
  raw=np.ndarray((old['count'],width),dtype=dtype,buffer=blob,offset=base+view.get('byteOffset',0)+old.get('byteOffset',0),strides=(view.get('byteStride',dtype.itemsize*width),dtype.itemsize)).tobytes()
  pad=(-length)%4
  if pad:blocks.append(b'\0'*pad);length+=pad
  vi=len(out['bufferViews']);out['bufferViews'].append({'buffer':0,'byteOffset':length,'byteLength':len(raw)})
  value={k:copy.deepcopy(v)for k,v in old.items()if k not in ['bufferView','byteOffset']};value['bufferView']=vi
  index=len(out['accessors']);out['accessors'].append(value);accessor_map[ai]=index;blocks.append(raw);length+=len(raw);return index
 for old in ids:
  mesh=copy.deepcopy(doc['meshes'][old])
  for p in mesh['primitives']:
   p['attributes']={k:accessor(v)for k,v in p['attributes'].items()}
   if'indices'in p:p['indices']=accessor(p['indices'])
   for morph in p.get('targets',[]):
    for k,v in list(morph.items()):morph[k]=accessor(v)
   if'material'in p:
    mi=p['material']
    if mi not in matmap:
     matmap[mi]=len(out['materials']);out['materials'].append({'name':doc['materials'][mi].get('name','native'),'pbrMetallicRoughness':{'baseColorFactor':[1,1,1,1],'metallicFactor':0,'roughnessFactor':1},'doubleSided':True})
    p['material']=matmap[mi]
  out['meshes'].append(mesh)
 for old in keep:
  node=copy.deepcopy(doc['nodes'][old])
  if'children'in node:node['children']=[nodemap[x]for x in node['children']if x in nodemap]
  if'mesh'in node:node['mesh']=meshmap[node['mesh']]
  if'skin'in node:
   si=node['skin']
   if si not in skinmap:
    sk=copy.deepcopy(doc['skins'][si]);sk['joints']=[nodemap[x]for x in sk['joints']]
    if'skeleton'in sk:sk['skeleton']=nodemap[sk['skeleton']]
    if'inverseBindMatrices'in sk:sk['inverseBindMatrices']=accessor(sk['inverseBindMatrices'])
    skinmap[si]=len(out['skins']);out['skins'].append(sk)
   node['skin']=skinmap[si]
  out['nodes'].append(node)
 out['buffers'][0]['byteLength']=length;data=json.dumps(out,separators=(',',':')).encode('utf8');data+=b' '*((-len(data))%4)
 target.parent.mkdir(parents=True,exist_ok=True)
 with target.open('wb')as f:
  binary_length=length+(-length)%4
  f.write(struct.pack('<5I',0x46546c67,2,28+len(data)+binary_length,len(data),0x4e4f534a));f.write(data);f.write(struct.pack('<II',binary_length,0x004e4942))
  for block in blocks:f.write(block)
  f.write(b'\0'*((-length)%4))
 # Keep explicit source identities and proof; source audit bytes remain private.
 metadata=portable(copy.deepcopy(model.meta));metadata['meshes']=[metadata['meshes'][i]for i in ids];metadata.update({'meshCount':len(ids),'vertices':sum(m['vertices']for m in metadata['meshes']),'faces':sum(m['faces']for m in metadata['meshes']),'subsetValidation':'source-exact accessor and palette copy','sourceSelectedMeshIndices':ids,'file':model.descriptor()['glb'],'raw':model.descriptor()['glb'],'publishedSha256':digest(target)})
 write(target.with_suffix('.json'),metadata)
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source-root',type=Path,required=True);p.add_argument('--data-root',type=Path,required=True);p.add_argument('--native-data-root',type=Path);p.add_argument('--previous-catalog',type=Path);p.add_argument('--coverage-report',type=Path);args=p.parse_args()
 src=args.source_root;root=args.data_root;out=root/DIRECTORY
 options=read(src/'options-map.json')['options'];profiles=read(src/'body-frame-profiles.json')['profiles']
 policy_file=src/'source-resolution-policy.json'
 policy=read(policy_file)if policy_file.exists()else{'bindings':[]}
 bindings={r['sourcePath']:r for r in policy.get('bindings',[])}
 if len(bindings)!=len(policy.get('bindings',[])):raise ValueError('Duplicate source binding policy path')
 previous_file=args.previous_catalog or src/'previous-catalog.json';previous=read(previous_file)if previous_file.exists()else{}
 previous_options=[*previous.get('options',[]),*previous.get('unavailableOptions',[])];claimed_ids=set();previous_by_definition=collections.defaultdict(list)
 for record in previous_options:previous_by_definition[canonical(record.get('sourceDefinition'))].append(record)
 def stable_id(proposed,definition,rows,primary):
  paths={r['sourcePath']for r in rows}
  candidates=[o for o in previous_by_definition.get(canonical(definition),[])if o.get('slotId')==slot and (slot+'|'+o['id'])not in claimed_ids and paths.intersection(r['sourcePath']for r in o.get('sourceDefinitions',[]))]
  candidate=next((o for o in candidates if o.get('sourceAsset')==primary),next(iter(candidates),None))
  value=candidate['id']if candidate else proposed
  if slot+'|'+value in claimed_ids:raise ValueError('Duplicate stable option identity: '+value)
  claimed_ids.add(slot+'|'+value);return value

 models=[]
 for name in BASE:
  if(src/'canonical-source'/f'{name}.json').exists():models.append(Model(name,src/'canonical-source'/f'{name}.glb',src/'canonical-source'/f'{name}.json'))
 for name in BASE:
  folder=(args.native_data_root or root)/'assets/characters/SM2-retail-constructors/source-v5'
  if(folder/f'{name}.json').exists():models.append(Model(name,folder/f'{name}.glb',folder/f'{name}.json',True))
 for file in sorted((src/'native-extra/canonical-source').glob('*.json')):
  if file.name.endswith('validation.json')or file.stem not in BASE:continue
  models.append(Model(file.stem,file.with_suffix('.glb'),file,True))
 for model in models:
  bindings_file=src/('native-source-geometry-bindings.json'if model.retail else'mod-source-geometry-bindings.json')
  if bindings_file.exists():
   names={m['name'].lower()for m in model.records}
   model.meta['sourceGeometryBindings']=[r for r in read(bindings_file)if r['simMeshName'].lower()in names]
 prefer_exact_source_selectors(models)
 mod={m.name:m for m in models if not m.retail};byid={m.id:m for m in models}
 groups=collections.defaultdict(list)
 for option in options:
  binding=bindings.get(option['sourcePath'],{})
  preferred=binding.get('preferredPrimaryModelId')
  if preferred and preferred not in byid:raise ValueError('Source-bound primary model is not prepared: '+preferred)
  groups[(option['slot'],option['id'],canonical(option['effectiveDefinition']),preferred)].append(option)
 bounded_path=src/'unavailable-selector-reasons.json';bounded={r['selector']:r for r in read(bounded_path)['selectors']}if bounded_path.exists()else{}
 result=[];unavailable=[];coverage=[];definition_ids={};used_models=set();pending=[]
 def component(model,selectors,attachment=None):
  ids=set().union(*(model.resolve(n)for n in selectors))if selectors else set();model.pending|=ids
  value={'sourceAsset':model.id,'meshes':selectors,'resolvedMeshes':sorted({m['name']for m in model.records if m['objectId']in ids}),'resolvedObjectIds':sorted(ids)}
  if attachment:value['attachment']=attachment
  aliases={n:model.aliases[n.lower()]for n in selectors if n.lower()in model.aliases}
  if aliases:value['selectorAliases']=aliases
  if model.id in NATIVE_BINDINGS.values():value['sourceBindingEvidence']='champion-dummy-direct-binding-audit.json'
  return value
 for(slot,native_id,definition_json,preferred_primary),rows in groups.items():
  definition=rows[0]['effectiveDefinition'];selectors=[n for n in definition.get('meshes',[])if n];actors=[n for n in definition.get('equipmentActorMeshes',[])if n]
  candidates=list(dict.fromkeys(n for r in rows for n in r.get('templateCandidates',[])))
  if not candidates:candidates=['cc_sm_constructor_soldier']
  full=[byid[preferred_primary]]if preferred_primary else[m for m in models if not m.retail and m.name in candidates and all(m.exists(n)for n in selectors)]
  if not full:full=[mod.get(candidates[0])or mod['cc_sm_constructor_soldier']]
  variants=[]
  for primary in full:
   components=[];unresolved=[];renderless=[]
   primary_names=[n for n in selectors if primary.exists(n)]
   if primary_names:
    c=component(primary,primary_names)
    if c['resolvedObjectIds']:components.append(c)
    renderless.extend(n for n in primary_names if not primary.resolve(n))
   missing=[n for n in selectors if not primary.exists(n)]
   alternatives=collections.defaultdict(list)
   for selector in missing:
    found=[m for m in models if m.exists(selector)and m.resolve(selector)]
    if found:
     # Exact source names first. Native constructor matching the original class wins.
     binding=NATIVE_BINDINGS.get(native_id)if selector in ['arm_R_grp','hand_R_grp']else None
     if binding:
      preferred=next((m for m in found if m.id==binding),None)
      if preferred is None:unresolved.append(selector);continue
     else:preferred=next((m for m in found if BASE[m.name]in[r.get('appearanceUid')for r in rows]),found[0])
     alternatives[preferred.id].append(selector)
    elif any(m.exists(selector)for m in models):renderless.append(selector)
    else:unresolved.append(selector)
   for mid,names in alternatives.items():components.append(component(byid[mid],names))
   if actors:
    shield=mod.get('combat_shield')
    if shield and all(shield.exists(n)and shield.resolve(n)for n in actors):components.append(component(shield,actors,{'followNodeName':'shield_pos','position':[0,0,0],'rotation':[0,0,0,1],'sourceNode':'EquipmentPresetMarine.shield.locatorName'}))
    else:unresolved.extend('actor:'+n for n in actors if not shield or not shield.resolve(n))
   if unresolved:
    item={'slot':slot,'sourceOptionId':native_id,'primaryTemplate':primary.name,'missingSelectors':unresolved,'sourceDefinitions':[r['sourcePath']for r in rows]};pending.append(item)
    h=hashlib.sha256(canonical({'definition':definition,'primary':primary.id,'missing':unresolved}).encode('utf8')).hexdigest()[:8]
    unavailable.append({'id':stable_id('astartes:'+native_id+':'+h,definition,rows,primary.id),'sourceOptionId':native_id,'slotId':slot,'slotLabel':SLOTS.get(slot,slot),'label':native_id.replace('_',' ').capitalize(),'sourceLabel':'Astartes','sourceTemplate':primary.name,'sourceAsset':primary.id,'geometryAvailable':False,'geometryComplete':False,'resolutionStatus':'unavailable','reason':'Source geometry could not be resolved completely.','evidenceScope':'30 mod object graphs; 14,149 native template headers across 9 archives; 118 native CC markup records; prepared metadata fields including all source LOD and affixes; SDK name-resolution audit','missingSelectors':unresolved,'meshes':selectors,'resolvedMeshes':[],'resolvedObjectIds':[],'sourceDefinition':definition,'sourceDefinitions':[{k:r[k]for k in ['team','scope','appearanceUid','sourcePath']if k in r}for r in rows]})
    unavailable[-1]['missingSelectorReasons']=[{'selector':n,'reasonCode':bounded[n]['reasonCode']}for n in unresolved if n in bounded]
    coverage.append({**item,'status':'unavailable','id':unavailable[-1]['id']});continue
   if not components:
    components=[{'sourceAsset':primary.id,'meshes':[],'resolvedMeshes':[],'resolvedObjectIds':[]}]
   signature=canonical({'definition':definition,'primary':primary.id,'components':components})
   h=hashlib.sha256(signature.encode('utf8')).hexdigest()[:8]
   final_id=stable_id('astartes:'+native_id+':'+h,definition,rows,primary.id)
   if len(final_id)>160:raise ValueError('Scoped source option ID exceeds portable limit: '+final_id)
   entry={'id':final_id,'sourceOptionId':native_id,'slotId':slot,'slotLabel':SLOTS.get(slot,slot),'label':native_id.replace('_',' ').capitalize(),'sourceLabel':'Astartes','sourceAsset':components[0]['sourceAsset'],'meshes':components[0]['meshes'],'resolvedMeshes':components[0]['resolvedMeshes'],'resolvedObjectIds':components[0]['resolvedObjectIds'],'geometryAvailable':True,'geometryComplete':True,'sourceMeshes':selectors,'equipmentActorMeshes':actors,'sourceDefinition':definition,'sourceDefinitions':[{k:r[k]for k in ['team','scope','appearanceUid','sourcePath']if k in r}for r in rows],'nonRenderingSourceSelectors':renderless}
   if preferred_primary:entry['sourceResolution']={'kind':'source-bound-native-definition','primaryModelId':preferred_primary,'policy':'source-resolution-policy.json','bindings':[bindings[r['sourcePath']]for r in rows]}
   if components[0].get('selectorAliases'):entry['selectorAliases']=components[0]['selectorAliases']
   if len(components)>1:entry['components']=components
   if components[0].get('attachment'):entry['attachment']=components[0]['attachment']
   result.append(entry);used_models.update(c['sourceAsset']for c in components if c['meshes'])
   for row in rows:definition_ids.setdefault(row['sourcePath'],[]).append(entry)
   coverage.append({'slot':slot,'sourceOptionId':native_id,'id':final_id,'primaryTemplate':primary.name,'sourceDefinitions':[r['sourcePath']for r in rows],'status':'resolved','components':len(components),'meshes':sum(len(c['resolvedObjectIds'])for c in components)})
 # Actual source equipment actor, distinct from ordinary appearance presets.
 arms=mod.get('apothecary_arms')
 if arms:
  c=component(arms,['knife_geom'],{'followNodeName':'powerplant_backpack','position':[0,0,0],'rotation':[0,0,0,1],'sourceNode':'SetFollow_apothecary_arms'})
  assert c['resolvedObjectIds'],'Source medical-arm render mesh missing'
  entry={'id':'astartes:apothecary_arms','sourceOptionId':'apothecary_arms','slotId':'ASTARTES_EQUIPMENT','slotLabel':SLOTS['ASTARTES_EQUIPMENT'],'label':'Apothecary medical arm','sourceLabel':'Astartes','geometryAvailable':True,'geometryComplete':True,**c}
  result.append(entry);used_models.add(arms.id)
 for profile in profiles:
  used_models.add(profile['modelId']);new={}
  for slot,native_id in profile['initialSelection'].items():
   source=profile['initialSelectionSources'].get(slot,{})
   candidates=definition_ids.get(source.get('sourcePath'),[])
   chosen=next((o for o in candidates if o['sourceAsset']==profile['modelId']),next(iter(candidates),None))
   if not chosen:raise ValueError('Profile default unresolved: '+profile['id']+' '+slot+' '+native_id)
   new[slot]=chosen['id']
  if profile['id']=='PVE_PVP_CHARACTER_MOD_3':new['ASTARTES_EQUIPMENT']='astartes:apothecary_arms'
  profile['initialSelection']=new
 catalog={'schema':'iron-hands-forge-astartes-catalog-v1','version':1,'selectorResolutionPolicy':{'version':2,'precedence':'exact primary, exact donor, source-spelling fallback','sourceSHA256':digest(Path(__file__))},'sourceMod':{'name':'Astartes Overhaul','version':'15.2','archive':'wa_astartes_15_2.pak'},'sourceAudit':[{'file':name,'sha256':digest(src/name)}for name in ['source-resolution-policy.json','native-source-geometry-bindings.json','mod-source-geometry-bindings.json','remaining-selector-metadata-audit.json','native-all-character-missing-selector-hits.json','native-name-resolution-source-audit.json','champion-dummy-direct-binding-audit.json','all-native-missing-selector-hits.json','unavailable-selector-reasons.json','champion-gauntlet-source-bindings.json']if(src/name).exists()],'models':[],'options':result,'unavailableOptions':unavailable,'profiles':profiles}
 files=[]
 for mid in sorted(used_models):
  model=byid[mid];descriptor=model.descriptor();target=root/descriptor['glb']
  # Only the source exact native fallback subsets are compacted. Mod target rigs retain all original nodes.
  if model.retail:compact(model,target,model.pending)
  else:
   target.parent.mkdir(parents=True,exist_ok=True)
   if not target.exists():os.link(model.file,target)
   elif digest(target)!=digest(model.file):raise ValueError('Existing mod model changed')
   metadata=portable(copy.deepcopy(model.meta));metadata.update({'file':descriptor['glb'],'raw':descriptor['glb']});write(root/descriptor['metadata'],metadata)
  catalog['models'].append(descriptor)
  for relative in [descriptor['glb'],descriptor['metadata']]:files.append({'path':relative,'bytes':(root/relative).stat().st_size,'sha256':digest(root/relative)})
 catalog=portable(catalog)
 catalog_path=DIRECTORY+'/catalog.json';write(root/catalog_path,catalog);files.append({'path':catalog_path,'bytes':(root/catalog_path).stat().st_size,'sha256':digest(root/catalog_path)})
 manifest={'schema':'iron-hands-forge-astartes-library-v1','version':1,'catalog':catalog_path,'files':files}
 write(out/'manifest.json',manifest)
 report={'schema':'iron-hands-forge-astartes-coverage-v1','complete':True,'geometryComplete':not pending,'definitions':len(options),'uniqueDefinitionGroups':len(groups),'importedOptions':len(result),'profiles':len(profiles),'models':len(catalog['models']),'resolvedDefinitions':len(definition_ids),'unavailableOptions':len(unavailable),'unresolvedVariants':len(pending),'sourceDefinitionsCovered':len(set(definition_ids)|{p for row in pending for p in row['sourceDefinitions']}),'aliasResolutions':{m.id:m.aliases for m in models if m.aliases},'slotCounts':dict(collections.Counter(o['slotId']for o in result)),'pending':pending,'rows':coverage}
 write(args.coverage_report or src/'import-coverage.json',report)
 print(json.dumps({k:v for k,v in report.items()if k not in['pending','rows','aliasResolutions']}))
 return 0
if __name__=='__main__':raise SystemExit(main())
