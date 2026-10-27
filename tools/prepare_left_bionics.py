"""Prepare the seven native-bound left bionic arms from a local V5 data library.

Inputs are source-v5 constructor GLB/JSON files and armor-options.json. No review
folders, prebuilt arm subsets, Blender files, game archives or network are used.
Python 3.11+ and the NumPy version in requirements-prepare.txt are required.
Original constructor files and catalogues are never modified.
"""
from pathlib import Path
import argparse,copy,hashlib,json,re,struct,sys

sys.dont_write_bytecode=True
np=None
S=None
DT={}
CLASSES=[('PVE_PVP_SOLDIER','soldier','Tactical'),('PVE_PVP_SNIPER','sniper','Sniper'),('PVE_PVP_SUPPORT','support','Heavy'),('PVE_PVP_RAIDER','raider','Assault'),('PVE_PVP_TANK','tank','Bulwark'),('PVE_PVP_BERSERK','berserk','Vanguard'),('PVE_PVP_ENGINEER','engineer','Techmarine')]
DIRECTORY='assets/characters/SM2-left-bionic/native-v1'
NC={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def sha(x):return hashlib.sha256(x).hexdigest()
def flat(m):return np.asarray(m).reshape(-1,order='F').tolist()
def local(n):
 if 'matrix'in n:return np.array(n['matrix'],float).reshape(4,4,order='F')
 x,y,z,w=n.get('rotation',[0.,0.,0.,1.]);r=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
 m=np.eye(4);m[:3,:3]=r@np.diag(n.get('scale',[1.,1.,1.]));m[:3,3]=n.get('translation',[0.,0.,0.]);return m
def world(doc):
 parent={c:i for i,n in enumerate(doc['nodes'])for c in n.get('children',[])};done={}
 def calc(i):
  if i not in done:done[i]=(calc(parent[i])if i in parent else np.eye(4))@local(doc['nodes'][i])
  return done[i]
 return np.array([calc(i)for i in range(len(doc['nodes']))])
def lname(n):
 if n in ['ARM1R','ARM2R','HANDR']:return n[:-1]+'L'
 if re.match(r'^R(?:_|\d)',n):return 'L'+n[1:]
 if re.search(r'_R(?=_|$)',n):return re.sub(r'_R(?=_|$)','_L',n,count=1)
 if n.endswith('R'):return n[:-1]+'L'
 return None

class GLB:
 def __init__(self,path=None,*,doc=None,binary=None,tag='memory'):
  if doc is not None:
   self.path=Path(tag);self.bytes=b'';self.doc=doc;self.bin=bytearray(binary);return
  self.path=Path(path);self.bytes=self.path.read_bytes();magic,ver,total=struct.unpack_from('<III',self.bytes,0);assert magic==0x46546c67 and ver==2 and total==len(self.bytes)
  n,t=struct.unpack_from('<II',self.bytes,12);assert t==0x4e4f534a;self.doc=json.loads(self.bytes[20:20+n]);bn,bt=struct.unpack_from('<II',self.bytes,20+n);assert bt==0x004e4942;self.bin=bytearray(self.bytes[28+n:28+n+bn])
 def arr(self,ai):
  a=self.doc['accessors'][ai];assert 'sparse'not in a;v=self.doc['bufferViews'][a['bufferView']];d=DT[a['componentType']];n=NC[a['type']]
  return np.ndarray((a['count'],n),dtype=d,buffer=self.bin,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',n*d.itemsize),d.itemsize))
 def values(self,ai):
  a=self.doc['accessors'][ai];x=self.arr(ai).astype(np.float64)
  if a.get('normalized')and DT[a['componentType']].kind in'iu':x/=np.iinfo(DT[a['componentType']]).max
  return x

class BufferBuilder:
 def __init__(self,doc):self.doc=doc;self.bin=bytearray();self.views={};self.accessors={}
 def add_view(self,data,template=None):
  self.bin.extend(bytes((-len(self.bin))&3));offset=len(self.bin);self.bin.extend(data);v=copy.deepcopy(template or{});v.update(buffer=0,byteOffset=offset,byteLength=len(data));i=len(self.doc['bufferViews']);self.doc['bufferViews'].append(v);return i
 def copy_acc(self,source,ai):
  key=(str(source.path),ai)
  if key in self.accessors:return self.accessors[key]
  a=copy.deepcopy(source.doc['accessors'][ai]);vk=(str(source.path),a['bufferView'])
  if vk not in self.views:
   v=source.doc['bufferViews'][a['bufferView']];start=v.get('byteOffset',0);self.views[vk]=self.add_view(bytes(source.bin[start:start+v['byteLength']]),v)
  a['bufferView']=self.views[vk];i=len(self.doc['accessors']);self.doc['accessors'].append(a);self.accessors[key]=i;return i
 def add_array(self,a,typ,component=5126):
  a=np.ascontiguousarray(a,dtype=DT[component]);vi=self.add_view(a.tobytes());i=len(self.doc['accessors']);self.doc['accessors'].append({'bufferView':vi,'componentType':component,'count':len(a),'type':typ});return i
 def arr(self,ai):
  a=self.doc['accessors'][ai];v=self.doc['bufferViews'][a['bufferView']];d=DT[a['componentType']];n=NC[a['type']]
  return np.ndarray((a['count'],n),dtype=d,buffer=self.bin,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',n*d.itemsize),d.itemsize))
 def write(self,path):
  self.doc['buffers']=[{'byteLength':len(self.bin)}];j=json.dumps(self.doc,separators=(',',':')).encode('utf-8');j+=b' '*((-len(j))&3);b=bytes(self.bin);b+=bytes((-len(b))&3)
  data=struct.pack('<III',0x46546c67,2,28+len(j)+len(b))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(b),0x004e4942)+b
  path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)

def native_inputs(data_root,cls,slug):
 """Return a compact native rig+arm in memory and original constructor node IDs."""
 asset='cc_sm_constructor_'+slug
 if cls.get('tpl')!=asset or not cls.get('available'):raise ValueError('The class is unavailable: '+cls['id'])
 source_root=data_root/'assets/characters/SM2-retail-constructors/source-v5'
 source_path=source_root/(asset+'.glb');meta_path=source_root/(asset+'.json')
 original=GLB(source_path);old=original.doc;meta=json.loads(meta_path.read_text(encoding='utf-8-sig'))
 if len(meta['meshes'])!=len(old['meshes'])or any(a['name']!=b['name']for a,b in zip(meta['meshes'],old['meshes'])):raise ValueError('V5 mesh identity check failed: '+asset)
 donor_name='engineer_arm_R_01'if slug=='engineer'else slug+'_arm_R_02'
 owners={m['objectId']for m in meta['meshes']if m['name']==donor_name and m.get('lod',0)==0}
 if len(owners)!=1:raise ValueError('Expected one native right bionic arm: '+asset)
 owner=owners.pop();right_slot=next(s for s in cls['slots']if s['id']=='RIGHT_GAUNTLET')
 if not any(owner in o.get('resolvedObjectIds',[])for o in right_slot['options']):raise ValueError('Right donor is not resolved by the catalogue: '+asset)
 mids=[i for i,m in enumerate(meta['meshes'])if m['objectId']==owner and m.get('lod',0)==0]
 selected=[i for i,n in enumerate(old['nodes'])if n.get('mesh')in mids];assert selected and all(old['nodes'][i].get('skin')==0 for i in selected)
 skin=old['skins'][0];parent={c:i for i,n in enumerate(old['nodes'])for c in n.get('children',[])};keep=set(selected+skin['joints'])
 if 'skeleton'in skin:keep.add(skin['skeleton'])
 for n in list(keep):
  while n in parent:n=parent[n];keep.add(n)
 nodeids=sorted(keep);node_map={n:i for i,n in enumerate(nodeids)};mesh_map={n:i for i,n in enumerate(mids)};nodes=[]
 for ni in nodeids:
  n=copy.deepcopy(old['nodes'][ni])
  if ni in selected:n['mesh']=mesh_map[n['mesh']];n['skin']=0
  else:n.pop('mesh',None);n.pop('skin',None)
  if 'children'in n:n['children']=[node_map[c]for c in n['children']if c in keep]
  n.pop('camera',None);nodes.append(n)
 doc={'asset':{'version':'2.0','generator':'Iron Hands Forge local left-bionic preparation'},'scene':0,'scenes':[{'name':'Native right donor','nodes':[node_map[i]for i in nodeids if parent.get(i)not in keep]}],'nodes':nodes,'meshes':[copy.deepcopy(old['meshes'][i])for i in mids],'skins':[copy.deepcopy(skin)],'materials':[],'accessors':[],'bufferViews':[],'buffers':[]}
 doc['skins'][0]['joints']=[node_map[n]for n in skin['joints']]
 if 'skeleton'in skin:doc['skins'][0]['skeleton']=node_map[skin['skeleton']]
 bb=BufferBuilder(doc)
 color=[]
 for v in [179/255,189/255,201/255]:color.append(v/12.92 if v<=.04045 else((v+.055)/1.055)**2.4)
 for mesh in doc['meshes']:
  for pr in mesh['primitives']:
   pr['indices']=bb.copy_acc(original,pr['indices']);pr['attributes']={k:bb.copy_acc(original,v)for k,v in pr['attributes'].items()}
   if 'targets'in pr:pr['targets']=[{k:bb.copy_acc(original,v)for k,v in t.items()}for t in pr['targets']]
   source_mat=old['materials'][pr['material']];pr['material']=len(doc['materials']);doc['materials'].append({'name':'Forge preview / '+source_mat.get('name','native bionic'),'pbrMetallicRoughness':{'baseColorFactor':color+[1.0],'metallicFactor':.85,'roughnessFactor':.34},'extras':{'sourceMaterial':source_mat.get('name'),'previewMaterial':True,'paintMetal':'#b3bdc9'}})
 doc['skins'][0]['inverseBindMatrices']=bb.copy_acc(original,skin['inverseBindMatrices']);doc['buffers']=[{'byteLength':len(bb.bin)}]
 ext={k for m in doc['meshes']for pr in m['primitives']for k in pr.get('extensions',{})}
 if ext:doc['extensionsUsed']=sorted(ext)
 native=GLB(doc=doc,binary=bb.bin,tag='native-memory-'+asset)
 mirrored=GLB(doc=copy.deepcopy(doc),binary=bb.bin,tag='mirrored-memory-'+asset);changed=set()
 for mesh in mirrored.doc['meshes']:
  for pr in mesh['primitives']:
   assert pr.get('mode',4)==4
   for semantic in ['POSITION','NORMAL','TANGENT']:
    if semantic not in pr['attributes']:continue
    ai=pr['attributes'][semantic]
    if ai in changed:continue
    a=mirrored.doc['accessors'][ai];assert a['componentType']==5126;ar=mirrored.arr(ai);ar[:,0]*=-1
    if semantic=='TANGENT':ar[:,3]*=-1
    for key in ['min','max']:
     if key in a:a[key]=(ar.min(axis=0)if key=='min'else ar.max(axis=0)).tolist()
    changed.add(ai)
   ai=pr['indices']
   if ai not in changed:ar=mirrored.arr(ai).reshape(-1,3);ar[:,[1,2]]=ar[:,[2,1]];changed.add(ai)
   for t in pr.get('targets',[]):
    for semantic,ai in t.items():
     if semantic in ['POSITION','NORMAL','TANGENT']and ai not in changed:mirrored.arr(ai)[:,0]*=-1;changed.add(ai)
 source_report={'source':str(source_path),'source_sha256':sha(original.bytes),'source_metadata':str(meta_path)}
 record={'classId':cls['id'],'asset':asset,'label':next(v[2]for v in CLASSES if v[0]==cls['id']),'source_object_id':owner}
 return record,native,mirrored,{i:n for i,n in enumerate(nodeids)},meta,source_report

def skin_world(glb,mesh_index):
 skin=glb.doc['skins'][0];gw=world(glb.doc);ibm=glb.arr(skin['inverseBindMatrices']).reshape(-1,4,4).transpose(0,2,1).astype(float);mats=gw[skin['joints']]@ibm;out=[]
 for pr in glb.doc['meshes'][mesh_index]['primitives']:
  a=pr['attributes'];p=glb.arr(a['POSITION']).astype(float);ph=np.column_stack([p,np.ones(len(p))]);v=np.zeros_like(ph)
  for c in range(8):
   if f'JOINTS_{c}'not in a:break
   ji=glb.arr(a[f'JOINTS_{c}']).astype(int);weights=glb.values(a[f'WEIGHTS_{c}'])
   for k in range(ji.shape[1]):v+=np.einsum('nij,nj->ni',mats[ji[:,k]],ph)*weights[:,k,None]
  out.append(v[:,:3])
 return out

def build(data_root,output_root,cls,slug,index):
 record,native,mirrored,source_id,fullmeta,source_report=native_inputs(data_root,cls,slug)
 cid=record['classId'];short=cid.removeprefix('PVE_PVP_');oid=9000000+index
 connector_name='berserk_torso_l_gauntlet'if short=='BERSERK'else'torso_l_gauntlet'
 connector_meshes=[m for m in fullmeta['meshes']if m['name']==connector_name and m.get('lod',0)==0]
 connector_ids=sorted({m['objectId']for m in connector_meshes});assert len(connector_ids)==1,(cid,connector_name,connector_ids)
 oldleft=next(s for s in cls['slots']if s['id']=='LEFT_GAUNTLET');oldleftids={i for o in oldleft['options']for i in o.get('resolvedObjectIds',[])}
 protected={i for s in cls['slots']if s['id']in['CHEST','LEFT_PAULDRON','RIGHT_PAULDRON']for o in s['options']for i in o.get('resolvedObjectIds',[])}
 exclude_ids=sorted(oldleftids-set(connector_ids)-{oid}-protected)
 old=native.doc;gw=world(old);parent={c:i for i,n in enumerate(old['nodes'])for c in n.get('children',[])};names={n['name']:i for i,n in enumerate(old['nodes'])if 'name'in n};skin=old['skins'][0];palette=list(skin['joints']);palette_index={n:i for i,n in enumerate(palette)}
 used=set()
 for mesh in native.doc['meshes']:
  for pr in mesh['primitives']:
   a=pr['attributes']
   for c in range(8):
    if f'JOINTS_{c}'not in a:break
    ji=native.arr(a[f'JOINTS_{c}']);weight=native.arr(a[f'WEIGHTS_{c}']);used.update(int(i)for i in np.unique(ji[weight>0]))
 core={};weighted_helpers=set()
 for pi in used:
  ni=palette[pi];name=old['nodes'][ni]['name'];left_name=lname(name)
  if left_name in names and names[left_name]in palette_index:core[ni]=names[left_name]
  else:weighted_helpers.add(ni)
 assert len(core)==20,(cid,len(core))
 assert len(weighted_helpers)==(0 if short=='TANK'else 17)
 helpers=set(weighted_helpers)
 def require_parent(ni):
  p=parent.get(ni);assert p is not None
  pn=old['nodes'][p]['name'];candidate=lname(pn)
  if p in helpers:return
  if candidate in names:return
  helpers.add(p);require_parent(p)
 for ni in list(helpers):require_parent(ni)
 assert len(helpers)==(0 if short=='TANK'else 18),(cid,[old['nodes'][n]['name']for n in helpers])
 def depth(i):
  d=0
  while i in parent:i=parent[i];d+=1
  return d
 helper_order=sorted(helpers,key=lambda i:(depth(i),i));g=copy.deepcopy(old);g['meshes']=copy.deepcopy(mirrored.doc['meshes']);g['materials']=copy.deepcopy(mirrored.doc['materials']);g['accessors']=[];g['bufferViews']=[];g['buffers']=[];g.pop('animations',None);g.pop('textures',None);g.pop('images',None);g.pop('samplers',None)
 native_refs=[]
 for ni,node in enumerate(g['nodes']):
  node.pop('mesh',None);node.pop('skin',None)
  node['extras']={**node.get('extras',{}),'forgeNativeNodeIndex':source_id[ni],'sourceNativeNodeIndex':source_id[ni],'forgeNativeClassId':cid}
  native_refs.append({'assetNodeIndex':ni,'sourceNativeNodeIndex':source_id[ni],'name':node.get('name'),'paletteIndex':palette_index.get(ni),'parentSourceNativeNodeIndex':source_id.get(parent.get(ni))})
 helper_map={};helper_records=[];taken=set(names)
 for donor in helper_order:
  donorname=old['nodes'][donor]['name'];semantic=lname(donorname);newname=f'IHF_L_BIONIC_{short}__{semantic or donorname}';base=newname;suffix=1
  while newname in taken:newname=base+'_'+str(suffix);suffix+=1
  taken.add(newname);dp=parent[donor]
  if dp in helper_map:target_parent=helper_map[dp];parent_world=S@gw[dp]@S;parent_kind='new-left-helper';native_parent=None;parent_helper=g['nodes'][target_parent]['name']
  else:
   candidate=lname(old['nodes'][dp]['name']);assert candidate in names,(cid,donorname,candidate)
   target_parent=names[candidate];parent_world=gw[target_parent];parent_kind='existing-native-left';native_parent=source_id[target_parent];parent_helper=None
  wb=S@gw[donor]@S;lb=np.linalg.inv(parent_world)@wb;newindex=len(g['nodes']);helper_map[donor]=newindex
  extras={'forgeLeftBionicHelper':True,'forgeBionicHelper':True,'forgeHelperWeighted':donor in weighted_helpers,'sourceRightNativeNodeIndex':source_id[donor],'sourceRightBoneName':donorname,'forgeDonorRightNativeNodeIndex':source_id[donor],'forgeClassId':cid,'forgeLeftSemanticName':semantic,'forgeParentKind':parent_kind}
  if native_parent is not None:extras['forgeParentNativeNodeIndex']=native_parent
  if parent_helper is not None:extras['forgeParentHelperName']=parent_helper
  g['nodes'].append({'name':newname,'matrix':flat(lb),'extras':extras})
  g['nodes'][target_parent].setdefault('children',[]).append(newindex)
  helper_records.append({'nodeIndex':newindex,'name':newname,'weighted':donor in weighted_helpers,'donorRightSubsetNodeIndex':donor,'donorRightNativeNodeIndex':source_id[donor],'donorRightName':donorname,'leftSemanticName':semantic,'parentNodeIndex':target_parent,'parentKind':parent_kind,'parentNativeNodeIndex':native_parent,'parentHelperName':parent_helper,'worldBindMatrix':flat(wb),'localBindMatrix':flat(lb),'paletteIndex':None})
 weighted_order=[n for n in helper_order if n in weighted_helpers];new_joint_index={donor:len(palette)+i for i,donor in enumerate(weighted_order)}
 remap=np.arange(len(palette),dtype=np.int64);joint_mapping=[]
 for pi in sorted(used):
  donor=palette[pi];target=core.get(donor,helper_map.get(donor));target_pi=palette_index[target]if donor in core else new_joint_index[donor];remap[pi]=target_pi
  joint_mapping.append({'donorPaletteIndex':pi,'donorRightSubsetNodeIndex':donor,'donorRightNativeNodeIndex':source_id[donor],'donorRightName':old['nodes'][donor]['name'],'targetPaletteIndex':target_pi,'targetNodeIndex':target,'targetName':g['nodes'][target]['name'],'targetNativeNodeIndex':source_id[target]if donor in core else None,'role':'existing-native-left'if donor in core else'new-left-helper'})
 for rec in helper_records:
  if rec['weighted']:rec['paletteIndex']=new_joint_index[rec['donorRightSubsetNodeIndex']]
 bb=BufferBuilder(g);accessor_mapping=[];joints_to_remap=[]
 for mi,mesh in enumerate(g['meshes']):
  mesh['name']=f'preview_steel_IH_left_bionic_{short.lower()}_{mi:02d}'
  mesh['extras']={**mesh.get('extras',{}),'forgeLeftBionicMesh':True,'forgeClassId':cid,'sourceRightObjectId':record['source_object_id']}
  for pr in mesh['primitives']:
   pr['indices']=bb.copy_acc(mirrored,pr['indices'])
   attributes={}
   for semantic,ai in pr['attributes'].items():
    oi=bb.copy_acc(mirrored,ai);attributes[semantic]=oi;accessor_mapping.append({'meshIndex':mi,'semantic':semantic,'mirrorSourceAccessor':ai,'outputAccessor':oi})
    if semantic.startswith('JOINTS_'):joints_to_remap.append(oi)
   pr['attributes']=attributes
   if 'targets'in pr:pr['targets']=[{s:bb.copy_acc(mirrored,ai)for s,ai in target.items()}for target in pr['targets']]
 # Append IBMs after copying the geometry, then remap writable JOINTS views.
 old_ibm=native.arr(skin['inverseBindMatrices']).copy();ibms=[row.copy()for row in old_ibm]
 for donor in weighted_order:ibms.append(np.linalg.inv(S@gw[donor]@S).reshape(-1,order='F').astype('<f4'))
 ibm_accessor=bb.add_array(np.asarray(ibms,dtype='<f4'),'MAT4')
 for oi in sorted(set(joints_to_remap)):
  ar=bb.arr(oi);mapped=remap[ar.astype(np.int64)];assert mapped.max()<=np.iinfo(ar.dtype).max,(cid,ar.dtype,mapped.max());ar[:]=mapped
  for key in ['min','max']:
   if key in g['accessors'][oi]:g['accessors'][oi][key]=(ar.min(axis=0)if key=='min'else ar.max(axis=0)).tolist()
 g['skins']=[copy.deepcopy(skin)];g['skins'][0]['name']='ForgeNativeBody_LeftBionic_'+short;g['skins'][0]['joints']=palette+[helper_map[n]for n in weighted_order];g['skins'][0]['inverseBindMatrices']=ibm_accessor
 geometry_nodes=[]
 donor_geom_nodes=[i for i,n in enumerate(old['nodes'])if 'mesh'in n]
 for mi,mesh in enumerate(g['meshes']):
  ni=len(g['nodes']);right_node=next(i for i in donor_geom_nodes if old['nodes'][i]['mesh']==mi)
  g['nodes'].append({'name':mesh['name'],'mesh':mi,'skin':0,'matrix':flat(np.eye(4)),'extras':{'forgeLeftBionicGeometry':True,'forgeBionicMesh':True,'forgeClassId':cid,'forgeSlotId':'LEFT_GAUNTLET','sourceObjectId':oid,'sourceRightObjectId':record['source_object_id'],'sourceRightNativeNodeIndex':source_id[right_node],'source_name':mesh['name'],'forgeMaterialRole':'metal'}})
  g['scenes'][g.get('scene',0)].setdefault('nodes',[]).append(ni)
  geometry_nodes.append({'nodeIndex':ni,'meshIndex':mi,'skinIndex':0,'meshName':mesh['name'],'objectId':oid,'sourceRightObjectId':record['source_object_id'],'sourceRightNativeNodeIndex':source_id[right_node]})
 g['asset']['generator']='Iron Hands Forge / native-left bound bionic asset v1'
 g['asset']['extras']={**g['asset'].get('extras',{}),'forgeIntegrationSchema':'iron-hands-forge-left-bionic-library','forgeIntegrationVersion':1,'forgeClassId':cid,'forgeSlotId':'LEFT_GAUNTLET','forgeObjectId':oid,'nativeBodyNodesUnchanged':True,'standaloneMirroredBodyRig':False,'nativeBodyReplacementAllowed':False,'newHelperNodes':len(helper_order),'newWeightedHelperJoints':len(weighted_order)}
 g['asset']['extras'].update(leftArmCreated=True,geometryUnchanged=False,topologyAndUVPreserved=True,bindingMode='native-left-body-with-new-bionic-helpers',sourceRightObjectId=record['source_object_id'],sourceObjectId=oid)
 output=output_root/(cid+'.glb');bb.write(output);out=GLB(output);ow=world(out.doc)
 native_matrix_error=float(np.abs(ow[:len(old['nodes'])]-gw).max());assert native_matrix_error==0
 helper_world_error=max([float(np.abs(ow[helper_map[n]]-S@gw[n]@S).max())for n in helper_order]or[0.]);assert helper_world_error<1e-10
 assert np.array_equal(out.arr(ibm_accessor)[:len(palette)],old_ibm)
 for item in accessor_mapping:
  if not item['semantic'].startswith('JOINTS_'):assert out.arr(item['outputAccessor']).tobytes()==mirrored.arr(item['mirrorSourceAccessor']).tobytes()
 rest_error=0.
 for mi in range(len(g['meshes'])):
  for points,pr in zip(skin_world(out,mi),out.doc['meshes'][mi]['primitives']):rest_error=max(rest_error,float(np.abs(points-out.arr(pr['attributes']['POSITION'])).max()))
 assert rest_error<1e-5,(cid,rest_error)
 palette_records=[{'index':i,'nodeIndex':n,'name':out.doc['nodes'][n]['name'],'role':'existing-native-body'if i<len(palette)else'new-weighted-left-helper','sourceNativeNodeIndex':source_id.get(n)}for i,n in enumerate(out.doc['skins'][0]['joints'])]
 result={'status':'PASS_NATIVE_BODY_LEFT_BINDING_BUILD','classId':cid,'label':record['label'],'asset':record['asset'],'objectId':oid,'optionId':'forge_left_bionic_v1','slotId':'LEFT_GAUNTLET','localPath':str(output),'relativePath':f'assets/characters/SM2-left-bionic/native-v1/{cid}.glb','bytes':output.stat().st_size,'sha256':sha(output.read_bytes()),'meshNames':[m['name']for m in g['meshes']],'nativeSourceSubsetGLB':str(native.path),'mirrorGeometryGLB':str(mirrored.path),'sourceBodyGLB':source_report['source'],'sourceBodySHA256':source_report['source_sha256'],'nativePalettePrefixLength':len(palette),'outputPaletteLength':len(palette)+len(weighted_order),'nativeNodeReferences':native_refs,'helpers':helper_records,'geometryNodes':geometry_nodes,'jointPalette':palette_records,'donorWeightedJointMapping':joint_mapping,'accessorMapping':accessor_mapping,'inverseBindMatricesAccessor':ibm_accessor,'proof':{'nativeBodyNodeLocalAndWorldMatricesUnchanged':True,'nativeBodyWorldMatrixMaxError':native_matrix_error,'nativeIBMPrefixBytesIdentical':True,'helperWorldBindMaxError':helper_world_error,'restSkinnedModelSpaceMaxError':rest_error,'mirroredPositionsNormalsUVWeightsBytesUnchanged':True,'sourceFilesUnchanged':True,'negativeMeshScaleAdded':False},'mergePolicy':'Reuse retained native nodes by forgeNativeNodeIndex/sourceNativeNodeIndex; append only tagged helper and geometry nodes. Do not replace native body bones with a mirrored donor rig.','helperAnimationPolicy':'New helpers inherit native LEFT parent motion; native right helper animation channels have not been duplicated or retargeted.','applicationModified':False}
 result.pop('nativeSourceSubsetGLB',None);result.pop('mirrorGeometryGLB',None)
 result['geometryMethod']='Applied model-space X reflection of the class-specific native right donor; normals and winding reflected, UV/numeric weights unchanged.'
 result['sourceFilesUnchanged']=True
 report_path=output_root/'provenance'/(cid+'.json');report_path.parent.mkdir(parents=True,exist_ok=True);report_path.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
 result['metadataPath']=str(report_path)
 result['connectorObjectIds']=connector_ids
 result['connectorMeshNames']=[connector_name]
 result['excludeObjectIds']=exclude_ids
 result['protectedChestPauldronIdsNotExcluded']=sorted(oldleftids&protected)
 result['resolvedObjectIds']=connector_ids+[oid]
 report_path.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
 return result

def main(argv=None):
 global np,S,DT
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--data-root',type=Path,required=True)
 parser.add_argument('--output-root',type=Path,help='Fresh staging directory; defaults to DATA_ROOT/'+DIRECTORY)
 parser.add_argument('--force',action='store_true',help='Explicitly replace existing generated left-bionic output files')
 args=parser.parse_args(argv);data_root=args.data_root.resolve();output_root=(args.output_root or data_root/DIRECTORY).resolve()
 private_packages=data_root/'tools/python-packages'
 if private_packages.is_dir():sys.path.insert(0,str(private_packages))
 try:import numpy as np
 except ImportError as exc:raise SystemExit('NumPy is required; install tools/requirements-prepare.txt for the selected Python.')from exc
 S=np.diag([-1.,1.,1.,1.]);DT={5120:np.dtype('i1'),5121:np.dtype('u1'),5122:np.dtype('<i2'),5123:np.dtype('<u2'),5125:np.dtype('<u4'),5126:np.dtype('<f4')}
 registry=json.loads((data_root/'production/roster/armor-options.json').read_text(encoding='utf-8-sig'))
 records=[next(c for c in registry['classes']if c['id']==cid)for cid,slug,label in CLASSES]
 targets=[output_root/(c['id']+'.glb')for c in records]+[output_root/'manifest.json']
 if not args.force and any(f.exists()for f in targets):raise SystemExit('Generated output already exists; choose a fresh --output-root or explicitly pass --force.')
 classes=[build(data_root,output_root,c,slug,i)for i,(c,(cid,slug,label))in enumerate(zip(records,CLASSES),start=1)];assert len(classes)==7
 detailed={'schema':'iron-hands-forge-left-bionic-library','version':1,'status':'SEVEN_NATIVE_LEFT_BOUND_ASSETS_READY_FOR_MERGE_TESTING','classes':classes}
 (output_root/'provenance').mkdir(exist_ok=True);(output_root/'provenance/preparation-report.json').write_text(json.dumps(detailed,ensure_ascii=False,indent=2),encoding='utf-8')
 keys=['classId','asset','relativePath','bytes','sha256','objectId','meshNames','optionId','slotId','nativePalettePrefixLength','outputPaletteLength','connectorObjectIds','connectorMeshNames','excludeObjectIds','resolvedObjectIds']
 runtime={'schema':'iron-hands-forge-left-bionic-library','version':1,'classes':[{**{k:r[k]for k in keys},'helperNodes':len(r['helpers']),'weightedHelperJoints':r['outputPaletteLength']-r['nativePalettePrefixLength'],'sourceBodySHA256':r['sourceBodySHA256']}for r in classes]}
 (output_root/'manifest.json').write_text(json.dumps(runtime,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'status':detailed['status'],'runtime_manifest':str(output_root/'manifest.json'),'classes':[{'classId':r['classId'],'objectId':r['objectId'],'helpers':len(r['helpers']),'newJoints':r['outputPaletteLength']-r['nativePalettePrefixLength'],'restError':r['proof']['restSkinnedModelSpaceMaxError']}for r in classes]},ensure_ascii=True,indent=2))

if __name__=='__main__':main()
