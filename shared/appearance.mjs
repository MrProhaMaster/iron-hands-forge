/** Strict optional visual settings. No model, network or game dependency. */
export class AppearanceError extends Error {
  constructor(message) {super(message);this.name='AppearanceError';this.code='INVALID_SCHEMA';}
}
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const forbidden=new Set(['__proto__','prototype','constructor']);
const fail=message=>{throw new AppearanceError(message);};
function object(value,allowed,path) {
  if(!value || typeof value!=='object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(path+' must be a plain object');
  for(const key of Reflect.ownKeys(value)){
    if(typeof key!=='string'||forbidden.has(key)||!allowed.includes(key))fail(path+': forbidden or unknown property');
    const d=Object.getOwnPropertyDescriptor(value,key);
    if(!d.enumerable||!own(d,'value'))fail(path+': accessors/nonenumerable properties are unsupported');
  }
  return value;
}
function id(value,path){
  if(typeof value!=='string'||!value.length)fail(path+' must be a nonempty string');
  let count=0;
  for(let i=0;i<value.length;i++,count++){
    const c=value.charCodeAt(i);
    if(c>=0xd800&&c<=0xdbff){const n=value.charCodeAt(++i);if(!(n>=0xdc00&&n<=0xdfff))fail(path+': unpaired surrogate');}
    else if(c>=0xdc00&&c<=0xdfff)fail(path+': unpaired surrogate');
  }
  if(count>160)fail(path+' exceeds160 Unicode code points');
  return value;
}
function color(value,path){if(typeof value!=='string'||!/^#[0-9a-fA-F]{6}$/.test(value))fail(path+' must be #RRGGBB');return value.toUpperCase();}
function number(value,path){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)fail(path+' must be a finite number in0..1');return value===0?0:value;}
function finish(value,path,withColors=false){
  object(value,withColors?['armor','trim','cloth','metallic','roughness']:['metallic','roughness'],path);
  const out={};
  for(const key of Object.keys(value)){
    if(key==='metallic'){if(typeof value[key]!=='boolean')fail(path+'.metallic must be boolean');out[key]=value[key];}
    else out[key]=key==='roughness'?number(value[key],path+'.'+key):color(value[key],path+'.'+key);
  }
  return out;
}
function map(value,path,limit,normalizer){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(path+' must be a plain object');
  const keys=Reflect.ownKeys(value);if(keys.length>limit)fail(path+' exceeds'+limit+' entries');
  const out={};
  for(const key of keys){
    if(typeof key!=='string'||forbidden.has(key))fail(path+': forbidden slot');
    const d=Object.getOwnPropertyDescriptor(value,key);
    if(!d.enumerable||!own(d,'value'))fail(path+': unsupported property');
    id(key,path+' slot');out[key]=normalizer(d.value,path+'.'+key);
  }
  return out;
}
function decal(value,path){
  object(value,['id','color','secondaryColor','tertiaryColor'],path);
  if(!own(value,'id')||!own(value,'color'))fail(path+' requires id and color');
  const out={id:id(value.id,path+'.id'),color:color(value.color,path+'.color')};
  for(const key of ['secondaryColor','tertiaryColor'])if(own(value,key))out[key]=color(value[key],path+'.'+key);
  return out;
}
export function normalizeAppearance(value){
  object(value,['colors','finish','parts','decals'],'appearance');
  const out={};
  if(own(value,'colors')){
    object(value.colors,['trim','cloth','beard','skin'],'appearance.colors');out.colors={};
    for(const key of Object.keys(value.colors))out.colors[key]=color(value.colors[key],'appearance.colors.'+key);
  }
  if(own(value,'finish'))out.finish=finish(value.finish,'appearance.finish');
  if(own(value,'parts'))out.parts=map(value.parts,'appearance.parts',48,(v,p)=>finish(v,p,true));
  if(own(value,'decals'))out.decals=map(value.decals,'appearance.decals',16,decal);
  return out;
}
export function validateAppearance(value){normalizeAppearance(value);return true;}

/** Appearance overrides affect paintable surfaces; rubber/skin/glass keep their physical response.
 * The caller supplies a normalized soldier. Returned values are renderer-independent.
 */
export function resolveAppearance(soldier,slot,role='armor'){
  const p=soldier?.paint||{};
  const defaults={
    armor:{color:p.armor||'#171B22',metallic:.12,roughness:.48,opacity:1},
    trim:{color:p.metal||'#B3BDC9',metallic:.85,roughness:.34,opacity:1},
    metal:{color:p.metal||'#B3BDC9',metallic:.85,roughness:.34,opacity:1},
    lenses:{color:p.lenses||'#EE291C',metallic:.1,roughness:.2,opacity:1,emissive:p.lenses||'#EE291C'},
    cloth:{color:'#51483C',metallic:0,roughness:.85,opacity:1},
    beard:{color:'#51483C',metallic:0,roughness:.85,opacity:1},
    skin:{color:'#A18A79',metallic:0,roughness:.7,opacity:1},
    leather:{color:'#372E28',metallic:0,roughness:.7,opacity:1},
    rubber:{color:'#101215',metallic:0,roughness:.78,opacity:1},
    glass:{color:'#18232C',metallic:.12,roughness:.12,opacity:.18}
  };
  const result={...(defaults[role]||defaults.armor)},a=soldier?.appearance||{},part=a.parts?.[slot]||{};
  const colorRole=role;
  if(a.colors?.[colorRole])result.color=a.colors[colorRole];
  if(part[colorRole])result.color=part[colorRole];
  if(['armor','trim','metal'].includes(role)){
    for(const key of ['metallic','roughness']){
      const value=own(part,key)?part[key]:(role==='armor'?a.finish?.[key]:undefined);
      if(value!==undefined)result[key]=key==='metallic'?(value?1:0):value;
    }
  }
  return result;
}


/** Explicit mesh.extras.forgeRole takes precedence at the integration boundary. */
export function classifyMaterialRole(materialName='',meshName=''){
  const lower=(String(materialName||'')+' '+String(meshName||'')).toLowerCase();
  if(/undersuit|rubber/.test(lower))return 'rubber';
  if(/beard|moustache|mustache/.test(lower))return 'beard';
  if(/tabard|cloth|seal|rope|hair/.test(lower))return 'cloth';
  if(/bag|belt|leather/.test(lower))return 'leather';
  if(/lenses|optic/.test(lower))return 'lenses';
  if(/glass/.test(lower))return 'glass';
  if(/preview_steel|forge_left_bionic|ch_cato_hand_lod|ch_tech_marine_mecharm|soldier_arm_r_02|soldier_hand_l_01/.test(lower))return 'metal';
  if(/head_|skin|eye_/.test(lower)&&!/helmet/.test(lower))return 'skin';
  const material=String(materialName||'').toLowerCase(),mesh=String(meshName||'').toLowerCase();
  const trim=/(?:^|[^a-z])(?:trim|ornament|decoration|decor|silver|gold|bronze)(?:[^a-z]|$)/;
  if(trim.test(material)||(!/armor|armour|body|base|paint/.test(material)&&trim.test(mesh)))return 'trim';
  return 'armor';
}
