"""Build a private armor catalog directly from an installed SM2 game's raw SSO.

Usage: python tools/prepare_catalog.py --game GAME_ROOT --data-root PRIVATE_ROOT
       [--inventory-root VALIDATED_SOURCE_V5_DIRECTORY]

No cached armor-options/armor-partsets files are read. This source contains no
game catalogs/assets. Generated sourceData/provenance belong in private storage.
"""
import argparse
import copy
import hashlib
import json
import re
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

VERSION = '1.0-raw-sso-v5'
MAIN = 'ssl/body/customization/character_customization_library.sso'
GEOM = 'ssl/body/customization/geom_region_character_body_section.sso'
SHARED = 'ssl/body/customization/shared_geom_region_character_body_section.sso'
SOURCE_FILES = (
    'ssl/body/character_customization_fake_champion_library.sso',
    'ssl/body/customization/character_body_section_library.sso',
    MAIN, 'ssl/body/customization/character_outfit_library.sso',
    'ssl/body/customization/customization_coloring_defaults_library.sso',
    GEOM, 'ssl/body/customization/helmet_visibility/helmet_visibility_settings_library.sso', SHARED,
)
CLASSES = ('SOLDIER','SNIPER','SUPPORT','RAIDER','TANK','BERSERK','ENGINEER','MEDIC')
CLASS_LABELS = dict(zip(CLASSES, ('Тактик','Снайпер','Тяжёлая поддержка','Разведчик','Щитоносец','Штурмовик','Инженер','Медик')))
SLOT_LABELS = {'HELMET':'Шлем','BACKPACK':'Ранец','CHEST':'Нагрудник','LEFT_PAULDRON':'Левый наплечник','RIGHT_PAULDRON':'Правый наплечник','LEFT_GAUNTLET':'Левая перчатка','RIGHT_GAUNTLET':'Правая перчатка','LEFT_GREAVE':'Левая поножа','RIGHT_GREAVE':'Правая поножа','VANITY':'Оборудование','VANITY_2':'Дополнительное оборудование','VANITY_3':'Манипулятор','CLOTH':'Ткань','COAT':'Плащ','HALO':'Ореол','ANTENNA':'Антенна','LEFT_BRACER':'Левый наруч','RIGHT_BRACER':'Правый наруч','HELMET_LENSES':'Линзы шлема'}


class ParseError(ValueError):
    pass


class SSOParser:
    """Plain assignment grammar, not YAML. Root/object assignments; nested arrays.

    Supports quoted strings/escapes, numeric scalars, True/False/null, optional
    commas/semicolons and //, #, /* */ comments. Duplicate assignments fail closed.
    """
    atom = re.compile(r'[^\s{}\[\]=,;]+')
    number = re.compile(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\Z')

    def __init__(self, text, source='<text>'):
        self.text = text.lstrip('\ufeff')
        self.source = source
        self.pos = 0
        self.token = None
        self.advance()

    def error(self, message):
        raise ParseError(f'{self.source}:{self.text.count(chr(10), 0, self.pos)+1}: {message}')

    def string(self):
        quote = self.text[self.pos]
        self.pos += 1
        result = []
        simple = {'n':'\n','r':'\r','t':'\t','b':'\b','f':'\f','v':'\v','0':'\0','\\':'\\','"':'"',"'":"'",'/':'/'}
        while self.pos < len(self.text):
            ch = self.text[self.pos]
            self.pos += 1
            if ch == quote:
                return ''.join(result)
            if ch != '\\':
                result.append(ch)
                continue
            if self.pos >= len(self.text):
                self.error('unterminated string escape')
            esc = self.text[self.pos]
            self.pos += 1
            if esc in simple:
                result.append(simple[esc])
            elif esc in ('x','u'):
                count = 2 if esc == 'x' else 4
                digits = self.text[self.pos:self.pos+count]
                if len(digits) != count or not re.fullmatch('[0-9a-fA-F]+', digits):
                    self.error('invalid hexadecimal string escape')
                code = int(digits,16)
                self.pos += count
                if 0xD800 <= code <= 0xDBFF and self.text[self.pos:self.pos+2] == '\\u':
                    low = self.text[self.pos+2:self.pos+6]
                    if re.fullmatch('[0-9a-fA-F]{4}',low or '') and 0xDC00 <= int(low,16) <= 0xDFFF:
                        code = 0x10000 + ((code-0xD800)<<10) + int(low,16)-0xDC00
                        self.pos += 6
                if 0xD800 <= code <= 0xDFFF:
                    self.error('unpaired surrogate escape')
                result.append(chr(code))
            elif esc == '\n':
                pass
            elif esc == '\r':
                if self.text[self.pos:self.pos+1] == '\n':self.pos += 1
            else:
                # Preserve unknown escapes rather than corrupting path strings.
                result.append('\\'+esc)
        self.error('unterminated string')

    def advance(self):
        text = self.text
        while self.pos < len(text):
            ch = text[self.pos]
            if ch.isspace():self.pos += 1;continue
            if text.startswith('//',self.pos) or ch == '#':
                end = text.find('\n',self.pos);self.pos = len(text) if end < 0 else end+1;continue
            if text.startswith('/*',self.pos):
                end = text.find('*/',self.pos+2)
                if end < 0:self.error('unterminated block comment')
                self.pos = end+2;continue
            if ch in '{}[]=,;':self.pos += 1;self.token = (ch,ch);return
            if ch in ('"',"'"):self.token = ('string',self.string());return
            match = self.atom.match(text,self.pos)
            if not match:self.error('unexpected character')
            self.pos = match.end();self.token = ('atom',match[0]);return
        self.token = ('eof',None)

    def expect(self, kind):
        if self.token[0] != kind:self.error(f'expected {kind}, found {self.token[0]}')
        value = self.token[1];self.advance();return value

    def value(self):
        kind, value = self.token
        if kind == '{':
            self.advance();result = self.assignments('}');self.expect('}');return result
        if kind == '[':
            self.advance();result = []
            while self.token[0] != ']':
                if self.token[0] == 'eof':self.error('unterminated array')
                result.append(self.value())
                if self.token[0] == ',':self.advance()
            self.expect(']');return result
        if kind not in ('atom','string'):self.error('expected value')
        self.advance()
        if kind == 'string':return value
        if value in ('True','true'):return True
        if value in ('False','false'):return False
        if value in ('null','None'):return None
        if re.fullmatch(r'[+-]?0[xX][0-9a-fA-F]+',value):return int(value,16)
        if self.number.fullmatch(value):return float(value) if any(c in value for c in '.eE') else int(value)
        return value

    def assignments(self, closing='eof'):
        result = {}
        while self.token[0] != closing:
            if self.token[0] == 'eof':self.error('unterminated object')
            if self.token[0] in (',',';'):self.advance();continue
            if self.token[0] not in ('atom','string'):self.error('expected property name')
            key = self.token[1];self.advance();self.expect('=')
            if key in result:self.error(f'duplicate assignment {key}')
            result[key] = self.value()
        return result

    def parse(self):
        if self.token[0] == '{':result = self.value()
        else:result = self.assignments()
        self.expect('eof');return result


def parse_sso(text, source='<text>'):
    return SSOParser(text,source).parse()


def merge_defaults(*values):
    result = {}
    for value in values:
        for key, item in value.items():
            if isinstance(item,dict) and isinstance(result.get(key),dict):result[key] = merge_defaults(result[key],item)
            else:result[key] = copy.deepcopy(item)
    return result


def unwrap(value):
    return value.get('__value') if isinstance(value,dict) else value


def shared_compatibility(definition, all_appearances):
    is_all = definition.get('isForAllCharacters') is True
    allowed = list(all_appearances) if is_all else list(definition.get('allowedAppearanceUids',definition.get('appearanceUids',[])))
    return is_all, allowed


def preset_selection(preset):
    return {slot:unwrap(value) for slot,value in preset.get('bodySectionRegionUids',{}).items() if slot != '__type'}


def option_label(uid, shared, index):
    if uid.endswith('_no_helmet'):return 'Без шлема'
    if uid.endswith('_empty'):return 'Нет'
    return ('Общий вариант ' if shared else 'Вариант ') + f'{index:02d}'


def make_option(region, initial, default, index):
    definition = region['effectiveDefinition']
    uid = region['regionId']
    colors = definition.get('availableColoringSlots',{})
    option = {'id':uid,'label':option_label(uid,region['shared'],index),'meshes':copy.deepcopy(definition.get('meshes',[])),
        'isDefault':uid == default,'isInitial':uid == initial,'shared':region['shared'],
        'allowedAppearanceUids':region['applicableAppearanceUids'],'isForAllCharacters':definition.get('isForAllCharacters',False),
        'sourceType':region['definition'].get('__type'),'sourcePath':region['sourcePath'],
        'equipmentActorMeshes':copy.deepcopy(definition.get('equipmentActorMeshes',[])),
        'availableColoringSlots':{key:unwrap(value) for key,value in colors.items() if key != '__type'},
        'isAbleToApplyDecals':definition.get('isAbleToApplyDecals'),'isAbleToColorLenses':definition.get('isAbleToColorLenses'),
        'isCovered':definition.get('isCovered'),'materialSuffixOverrideLink':definition.get('materialSuffixOverrideLink'),
        'materialOverrideMeshes':copy.deepcopy(definition.get('materialOverrideMeshes',[])),
        'locks':{k:copy.deepcopy(v) for k,v in definition.items() if 'lock' in k.lower() or k == 'victoriesToUnlock'}}
    for key in ('customMaterialOverrides','meshesToHide','isAbleToColorCloth','isHidden','rarity','useRarityFromOutfitSet'):
        if key in definition:option[key] = copy.deepcopy(definition[key])
    return option


def build_registry(source_data, actor_bindings, build='unknown'):
    loyalist = source_data[MAIN]['appearancesByTeams']['LOYALIST']
    appearances = loyalist['customizationPresets']
    all_appearances = [k for k,v in appearances.items() if isinstance(v,dict)]
    shared_slots = loyalist.get('sharedOutfitParts',{}).get('outfitParts',{})
    defaults = source_data[GEOM]
    shared_defaults = merge_defaults(defaults,source_data[SHARED])
    ui_classes, raw_classes = [], []
    for short in CLASSES:
        cid = 'PVE_PVP_'+short
        if cid not in appearances:continue
        appearance = appearances[cid]
        binding = next((b for b in actor_bindings if b.get('team') == 'LOYALIST' and b.get('masteryType') in appearance.get('masteryTypes',[]) and b.get('template')),None)
        tpl = binding['template'] if binding else None
        initial_preset = 'PREDEFINED_PRESET_1'
        presets = appearance.get('armorPresets',{})
        initial = preset_selection(presets.get(initial_preset,{}))
        default_preset = unwrap(appearance.get('defaultArmorPreset'))
        default = preset_selection(presets.get(default_preset,{})) if default_preset else {}
        sections = appearance.get('bodySections',{})
        slots = {}
        for sid,section in sections.items():
            if not isinstance(section,dict):continue
            slots[sid] = {'id':sid,'sectionDefinition':{k:copy.deepcopy(v) for k,v in section.items() if k != 'regions'},'regions':[]}
            for uid,definition in section.get('regions',{}).items():
                if not isinstance(definition,dict):continue
                effective = merge_defaults(defaults,definition)
                slots[sid]['regions'].append({'regionId':uid,'shared':False,'applicableAppearanceUids':[cid],
                    'sourcePath':f'appearancesByTeams.LOYALIST.customizationPresets.{cid}.bodySections.{sid}.regions.{uid}',
                    'definition':copy.deepcopy(definition),'effectiveDefinition':effective})
        for sid,section in shared_slots.items():
            if not isinstance(section,dict):continue
            for uid,definition in section.get('regions',{}).items():
                if not isinstance(definition,dict):continue
                effective = merge_defaults(shared_defaults,definition)
                is_all, allowed = shared_compatibility(effective,all_appearances)
                if not is_all and cid not in allowed:continue
                if sid not in slots:slots[sid] = {'id':sid,'sectionDefinition':{},'regions':[]}
                if any(r['regionId'] == uid for r in slots[sid]['regions']):raise ValueError(f'Duplicate region id {cid}/{sid}/{uid}')
                slots[sid]['regions'].append({'regionId':uid,'shared':True,'applicableAppearanceUids':allowed,
                    'sourcePath':f'appearancesByTeams.LOYALIST.sharedOutfitParts.outfitParts.{sid}.regions.{uid}',
                    'definition':copy.deepcopy(definition),'effectiveDefinition':effective})
        raw = {'team':'LOYALIST','id':cid,'masteryTypes':copy.deepcopy(appearance.get('masteryTypes',[])),
            'tpl':tpl,'constructorBinding':copy.deepcopy(binding),'defaultArmorPreset':default_preset,
            'initialArmorPreset':initial_preset,'initialSelection':initial,'armorPresets':copy.deepcopy(presets),'slots':list(slots.values())}
        raw_classes.append(raw)
        has_body = any(isinstance(v,dict) and v.get('regions') for v in sections.values())
        available = bool(tpl and has_body)
        ui = {'id':cid,'label':CLASS_LABELS[short],'tpl':tpl,'compatibilityKey':tpl or cid,'sourceTeam':'LOYALIST',
            'masteryTypes':raw['masteryTypes'],'constructorSource':binding['path'] if binding else None,
            'available':available,'status':'registered_regions' if available else 'no_body_sections_in_retail_library' if not has_body else 'constructor_binding_missing',
            'baseMeshes':[],'baseMeshStatus':'core_body_in_chest_regions' if available else 'inventory_pending',
            'baseMeshNote':'Базовая геометрия берётся из выбранных регионов; обязательные детали не определяются по имени.',
            'defaultArmorPreset':default_preset,'initialArmorPreset':initial_preset,'initialSelection':initial,
            'slots':[{'id':sid,'label':SLOT_LABELS.get(sid,'Дополнительный слот'),'options':[make_option(r,initial.get(sid),default.get(sid),i+1) for i,r in enumerate(slot['regions'])]} for sid,slot in slots.items()]}
        ui_classes.append(ui)
    registry = {'schema':'sm2-armor-options-v1','gameBuild':build,'generatorVersion':VERSION,'classes':ui_classes,
        'notes':['Каталог заново разобран из SSO/CLS установленной игры; подписи созданы приложением.',
            'Совместимость общих вариантов учитывает наследуемый isForAllCharacters и явные списки appearance UIDs.',
            'Геометрия разрешается только внутри привязанного конструктора того же класса.',
            'Отдельные equipmentActorMeshes требуют самостоятельной сборки и не считаются пустой готовой геометрией.']}
    return registry, raw_classes


def technical(obj):
    return bool(re.search(r'visibility_hidden|visibility_occluder|lighting_sm_invisible_shadowcaster_affix',obj.get('affixes') or '',re.I)
        or re.search(r'^rb_|(?:^|_)cdt(?:$|_)|(?:^|_)SIM(?:$|_)|occluder',obj.get('name') or '',re.I))


def resolve_class(ui, inventory, inventory_path, asset=None):
    """Resolve selectors through same-class ancestors; preserve source object IDs."""
    proof = ('transformValidation','restSkinValidation','skinProfileWeldValidation')
    reason = None
    if not ui['available'] or not ui['tpl']:reason = 'class_unavailable_or_unbound'
    elif inventory is None:reason = 'inventory_missing'
    elif inventory.get('asset') != ui['tpl']:reason = 'inventory_class_mismatch'
    elif not all(inventory.get(k) == 'passed' for k in proof):reason = 'inventory_not_validated'
    elif asset is not None and (asset.get('asset') != ui['tpl'] or not all(asset.get(k) == 'passed' for k in proof)):reason = 'manifest_asset_not_validated'
    elif not Path(inventory.get('file','')).is_file():reason = 'geometry_file_missing'
    ui['geometryReady'] = reason is None
    ui['geometryStatus'] = reason or 'validated_same_class_v5'
    if reason:
        for slot in ui['slots']:
            for option in slot['options']:
                option.update(resolvedMeshes=[],resolvedObjectIds=[],resolvedMeshRecordCount=0,foundSelectors=[],missingSelectors=list(option['meshes']),nonRenderingSelectors=[],dependentDecalMeshes=[],dependentDecalObjectIds=[],geometryAvailable=False,geometryComplete=False,
                    resolutionStatus='equipment_pending' if option['equipmentActorMeshes'] else 'inventory_pending')
                if option['equipmentActorMeshes']:option['equipmentResolutionStatus']='pending_separate_actor'
        return
    objects = {o['id']:o for o in inventory['objectMetadata']}
    if len(objects) != len(inventory['objectMetadata']):raise ValueError('Duplicate inventory object IDs')
    byname = defaultdict(list)
    for obj in objects.values():byname[obj['name']].append(obj['id'])
    chains = {}
    def chain(object_id):
        if object_id in chains:return chains[object_id]
        origin = object_id;result = [];seen = set()
        while object_id in objects:
            if object_id in seen:raise ValueError('Cycle in inventory graph')
            seen.add(object_id);result.append(object_id);object_id=objects[object_id]['parentId']
        chains[origin]=result;return result
    render = []
    for mesh in inventory['meshes']:
        if mesh['objectId'] not in objects:raise ValueError('Mesh refers to unknown object ID')
        if mesh.get('lod') == 0 and mesh.get('material') != '_' and not any(technical(objects[i]) for i in chain(mesh['objectId'])):render.append(mesh)
    byancestor = defaultdict(set)
    for index,mesh in enumerate(render):
        for ancestor in chain(mesh['objectId']):byancestor[ancestor].add(index)
    counts = Counter(total=0)
    for slot in ui['slots']:
        for option in slot['options']:
            selectors = option['meshes'];indices=set()
            for name in selectors:
                for obj_id in byname.get(name,[]):indices.update(byancestor.get(obj_id,set()))
            matches=[mesh for i,mesh in enumerate(render) if i in indices]
            ids=list(dict.fromkeys(m['objectId']for m in matches));names=list(dict.fromkeys(m['name']for m in matches))
            found=[name for name in selectors if name in byname];missing=[name for name in selectors if name not in byname]
            nonrender=[name for name in found if not any(obj_id in byancestor for obj_id in byname[name])]
            selected_names=set(names);id_set=set(ids)
            decals=[m for m in render if m['name'].endswith('_decal') and m['name'][:-6] in selected_names and m['objectId']not in id_set]
            equipment=bool(option['equipmentActorMeshes'])
            status='equipment_pending' if equipment and not selectors else 'empty' if not selectors else 'unavailable' if not matches else 'partial' if missing or nonrender or equipment else 'complete'
            option.update(resolvedMeshes=names,resolvedObjectIds=ids,resolvedMeshRecordCount=len(matches),foundSelectors=found,missingSelectors=missing,nonRenderingSelectors=nonrender,
                dependentDecalMeshes=list(dict.fromkeys(m['name']for m in decals)),dependentDecalObjectIds=list(dict.fromkeys(m['objectId']for m in decals)),
                geometryAvailable=(not selectors or bool(matches)) and not(equipment and not selectors),geometryComplete=not(missing or nonrender or equipment),resolutionStatus=status)
            if equipment:option['equipmentResolutionStatus']='pending_separate_actor'
            counts['total']+=1;counts[status]+=1
    ui.update(inventorySource=str(inventory_path),geometrySource=inventory['file'],geometrySourceVersion=5,
        geometryTransformValidation=inventory['transformValidation'],geometryRestSkinValidation=inventory['restSkinValidation'],geometrySkinProfileWeldValidation=inventory['skinProfileWeldValidation'],geometryResolutionSummary=dict(counts))


def read_raw(archive, path, provenance):
    info=archive.getinfo(path);data=archive.read(info)
    provenance.append({'path':path,'bytes':len(data),'zipCRC32':f'{info.CRC:08x}','sha256':hashlib.sha256(data).hexdigest()})
    return parse_sso(data.decode('utf-8-sig'),path)


def game_build(game):
    manifest=game.parent.parent/'appmanifest_2183900.acf'
    if manifest.is_file():
        match=re.search(r'"buildid"\s+"([^"\r\n]+)"',manifest.read_text(encoding='utf-8-sig'),re.I)
        if match:return match[1]
    return 'unknown'


def atomic_json(path, value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+'.tmp')
    temporary.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    temporary.replace(path)


def prepare_catalog(game, data_root, inventory_root=None):
    game=Path(game).resolve();data_root=Path(data_root).resolve()
    archive_path=game/'client_pc/root/paks/client/default/default_other.pak'
    if not archive_path.is_file():raise FileNotFoundError(f'Installed game archive not found: {archive_path}')
    provenance=[]
    with zipfile.ZipFile(archive_path)as archive:
        source_data={path:read_raw(archive,path,provenance) for path in SOURCE_FILES}
        bindings=[]
        for short in CLASSES:
            name=short.lower();path=f'ssl/characters/player/marine/outfits/{name}/pc_marine_pve_{name}_client.cls'
            actor=read_raw(archive,path,provenance)
            properties=actor.get('properties',{})
            info=properties.get('prop_geom_customizer_character',{}).get('characterInfo',{})
            bindings.append({'path':path,'actorType':actor.get('__type'),'team':info.get('team'),'masteryType':info.get('masteryType'),'template':properties.get('geom',{}).get('nameTpl')})
    build=game_build(game);registry,raw_classes=build_registry(source_data,bindings,build)
    inventory_root=Path(inventory_root).resolve() if inventory_root else data_root/'assets/characters/SM2-retail-constructors/source-v5'
    manifest_path=inventory_root/'manifest.json';assets={}
    if manifest_path.is_file():
        manifest=json.loads(manifest_path.read_text(encoding='utf-8-sig'));assets={a['asset']:a for a in manifest.get('assets',[])}
    for ui in registry['classes']:
        path=inventory_root/((ui['tpl']or'UNBOUND')+'.json');inventory=json.loads(path.read_text(encoding='utf-8-sig')) if path.is_file()and ui['tpl'] else None
        resolve_class(ui,inventory,path,assets.get(ui['tpl']))
    partsets_path=data_root/'tools/sm2-extractor/metadata/armor-partsets.json'
    registry['metadataSource']=str(partsets_path);registry['geometryResolutionSchema']='same-constructor-graph-v1';registry['geometryInventoryVersion']=5
    semantic=[{'id':c['id'],'tpl':c['tpl'],'compatibilityKey':c['compatibilityKey'],'initialSelection':c['initialSelection'],'slots':[{'id':s['id'],'options':[{k:o[k]for k in ('id','meshes','equipmentActorMeshes','allowedAppearanceUids','isForAllCharacters','sourcePath')}for o in s['options']]}for s in c['slots']]}for c in registry['classes']]
    registry['catalogSignature']=hashlib.sha256(json.dumps(semantic,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    partsets={'schema':'sm2-armor-partsets-v1','generatorVersion':VERSION,'gameBuild':build,'sourceArchive':str(archive_path),'sourceFiles':list(SOURCE_FILES),
        'sourceData':source_data,'actorBindings':bindings,'classes':raw_classes,'provenance':provenance,
        'notes':['Fresh raw SSO/CLS parse; no existing armor registry used as input.','Source-derived data is private and is not distributed with the application source.']}
    registry_path=data_root/'production/roster/armor-options.json'
    atomic_json(partsets_path,partsets);atomic_json(registry_path,registry)
    summary={'generatorVersion':VERSION,'armorOptions':str(registry_path),'armorPartsets':str(partsets_path),'gameBuild':build,'classes':len(registry['classes']),
        'choices':sum(len(s['options'])for c in registry['classes']for s in c['slots']),'templateBindings':sum(bool(c['tpl'])for c in registry['classes']),
        'geometryReadyClasses':[c['id']for c in registry['classes']if c['geometryReady']],'sourceFilesRead':len(provenance),'catalogSignature':registry['catalogSignature']}
    return summary


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--game',required=True,type=Path);parser.add_argument('--data-root',required=True,type=Path);parser.add_argument('--inventory-root',type=Path)
    args=parser.parse_args(argv)
    try:print(json.dumps(prepare_catalog(args.game,args.data_root,args.inventory_root),ensure_ascii=False,indent=2))
    except (OSError,ValueError,KeyError,zipfile.BadZipFile)as error:parser.exit(1,f'prepare_catalog: {error}\n')


if __name__=='__main__':main()
