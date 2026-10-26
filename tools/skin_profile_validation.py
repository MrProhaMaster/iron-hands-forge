"""Own raw source-profile proof and reversible UV guard restoration."""
import json, struct, hashlib, shutil
from pathlib import Path
import numpy as np

def glb(path):
    with path.open('rb') as f:
        head = f.read(20)
        magic, version, total, length, kind = struct.unpack('<5I', head)
        if not (magic == 1179937895 and version == 2):
            raise ValueError('Canonical skin/source profile validation failed')
        data = json.loads(f.read(length))
        size, binary_kind = struct.unpack('<II', f.read(8))
    return (data, 28 + length, size, binary_kind)


def _records(profile, audit, source_ids):
    stride = audit.get('recordStride', 24)
    if stride not in (24, 64):
        raise ValueError('Unsupported source skin audit stride')
    columns = stride // 4
    start = audit['byteOffset'] // 4
    if audit['byteOffset'] % 4 or start + audit['vertexCount'] * columns > len(profile):
        raise ValueError('Invalid source skin audit range')
    records = profile[start:start + audit['vertexCount'] * columns].reshape(audit['vertexCount'], columns)[source_ids]
    weights = records[:, 1::2].astype(np.float64)
    ids = records[:, 0::2].astype(np.int64)
    if not np.array_equal(ids, records[:, 0::2]) or not (np.isfinite(weights).all() and (weights >= 0).all()):
        raise ValueError('Invalid source skin influence')
    return ids, weights


def restore_extended_profiles(source, destination, meta):
    """Restore every audited influence after Assimp's four-influence exporter.

    The native GLB and source profile proof remain immutable. Only meshes with
    eight-slot audit records are rewritten in this private intermediate copy.
    Source vertex IDs in UV0 map exported vertices to the original profiles.
    """
    if not any(m['skinProfileAudit'].get('recordStride', 24) == 64 for m in meta['meshes']):
        return False
    data, base, size, kind = glb(source)
    if len(data['meshes']) != len(meta['meshes']):
        raise ValueError('Native mesh/source report count changed')
    mm = np.memmap(source, mode='r', dtype=np.uint8)
    profiles = np.memmap(meta['skinProfileAuditFile'], mode='r', dtype='<f4')
    mesh_skins = {n['mesh']: n['skin'] for n in data['nodes'] if 'mesh' in n and 'skin' in n}
    blocks = []
    length = size

    def values(index):
        a = data['accessors'][index]
        v = data['bufferViews'][a['bufferView']]
        if a['type'] != 'VEC2' or a['componentType'] != 5126:
            raise ValueError('Invalid source vertex guard')
        return np.ndarray((a['count'], 2), dtype='<f4', buffer=mm,
                          offset=base + v.get('byteOffset', 0) + a.get('byteOffset', 0),
                          strides=(v.get('byteStride', 8), 4))

    def append(array, component):
        nonlocal length
        array = np.ascontiguousarray(array)
        padding = -length % 4
        if padding:
            blocks.append(b'\0' * padding)
            length += padding
        view = len(data['bufferViews'])
        raw = array.tobytes()
        data['bufferViews'].append({'buffer': 0, 'byteOffset': length, 'byteLength': len(raw), 'target': 34962})
        length += len(raw)
        blocks.append(raw)
        accessor = len(data['accessors'])
        data['accessors'].append({'bufferView': view, 'componentType': component, 'count': len(array), 'type': 'VEC4'})
        return accessor

    for index, (mesh, record) in enumerate(zip(data['meshes'], meta['meshes'])):
        audit = record['skinProfileAudit']
        if audit.get('recordStride', 24) != 64:
            continue
        if mesh['name'] != record['name'] or len(mesh['primitives']) != 1:
            raise ValueError('Native mesh/source association changed')
        attrs = mesh['primitives'][0]['attributes']
        uv = values(attrs['TEXCOORD_0'])
        ids = uv[:, 0].astype(np.int64)
        if not np.array_equal(ids, uv[:, 0]) or not ((ids >= 0).all() and (ids < audit['vertexCount']).all()):
            raise ValueError('Invalid source vertex guard')
        source_bones, source_weights = _records(profiles, audit, ids)
        skin = data['skins'][mesh_skins[index]]
        joint_names = [data['nodes'][n]['name'] for n in skin['joints']]
        if len(joint_names) != len(set(joint_names)) or len(joint_names) > 65536:
            raise ValueError('Ambiguous or oversized native joint palette')
        palette = {name: i for i, name in enumerate(joint_names)}
        name_lookup = np.full(len(meta['skinProfileBoneNames']), -1, dtype=np.int64)
        for name_id, name in enumerate(meta['skinProfileBoneNames']):
            name_lookup[name_id] = palette.get(name, -1)
        active = source_weights > 0
        if not ((source_bones[active] >= 0).all() and (source_bones[active] < len(name_lookup)).all()):
            raise ValueError('Invalid source bone symbol')
        joints = np.zeros(source_bones.shape, dtype='<u2')
        mapped = name_lookup[source_bones[active]]
        if (mapped < 0).any():
            raise ValueError('Assimp omitted a required source bone from the skin palette')
        joints[active] = mapped
        weights = source_weights.astype('<f4')
        for part in range(2):
            columns = slice(part * 4, part * 4 + 4)
            attrs['JOINTS_' + str(part)] = append(joints[:, columns], 5123)
            attrs['WEIGHTS_' + str(part)] = append(weights[:, columns], 5126)
    data['buffers'][0]['byteLength'] = length
    data['asset'].setdefault('extras', {})['ForgeExtendedSkinRestoration'] = 'All source weights preserved in JOINTS_0/1 and WEIGHTS_0/1 using exact UV0 source vertex IDs; no influence truncation'
    encoded = json.dumps(data, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    tail = b'\0' * (-length % 4)
    with destination.open('xb') as target, source.open('rb') as original:
        target.write(struct.pack('<III', 1179937895, 2, 28 + len(encoded) + length + len(tail)))
        target.write(struct.pack('<II', len(encoded), 1313821514))
        target.write(encoded)
        target.write(struct.pack('<II', length + len(tail), kind))
        original.seek(base)
        remaining = size
        while remaining:
            chunk = original.read(min(8 * 1024 * 1024, remaining))
            if not chunk:
                raise ValueError('Truncated native binary chunk')
            target.write(chunk)
            remaining -= len(chunk)
        for block in blocks:
            target.write(block)
        target.write(tail)
    del uv, profiles, mm
    return True

def validate_profiles(path, meta):
    data, base, size, _ = glb(path)
    mm = np.memmap(path, mode='r', dtype=np.uint8)
    profile = np.memmap(meta['skinProfileAuditFile'], mode='r', dtype='<f4')
    names = meta['skinProfileBoneNames']
    name_ids = {n: i for i, n in enumerate(names)}
    types = {5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: 'u1'}
    dims = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

    def view(index):
        a = data['accessors'][index]
        v = data['bufferViews'][a['bufferView']]
        dtype = np.dtype(types[a['componentType']])
        components = dims[a['type']]
        return np.ndarray((a['count'], components), dtype=dtype, buffer=mm, offset=base + v.get('byteOffset', 0) + a.get('byteOffset', 0), strides=(v.get('byteStride', components * dtype.itemsize), dtype.itemsize))
    if not len(data['meshes']) == len(meta['meshes']):
        raise ValueError('Canonical skin/source profile validation failed')
    mesh_skins = {n['mesh']: n['skin'] for n in data['nodes'] if 'mesh' in n and 'skin' in n}
    summaries = []
    max_error = 0.0
    max_sum_error = 0.0
    checked = 0
    source_used = 0
    source_unused = 0
    for index, (mesh, record) in enumerate(zip(data['meshes'], meta['meshes'])):
        if not mesh['name'] == record['name']:
            raise ValueError('Canonical skin/source profile validation failed')
        audit = record['skinProfileAudit']
        if not len(mesh['primitives']) == 1:
            raise ValueError('Canonical skin/source profile validation failed')
        primitive = mesh['primitives'][0]
        attrs = primitive['attributes']
        uv = view(attrs['TEXCOORD_0'])
        source_ids = uv[:, 0].astype(np.int64)
        if not np.array_equal(uv[:, 0], source_ids):
            raise ValueError('Source vertex ID lost float precision')
        if not ((source_ids >= 0).all() and (source_ids < audit['vertexCount']).all()):
            raise ValueError('Canonical skin/source profile validation failed')
        if not len(np.unique(source_ids)) == len(source_ids):
            raise ValueError('Different source vertices were welded')
        if not len(source_ids) == audit['sourceUsedVertexCount']:
            raise ValueError('Used source vertices were dropped or invented')
        source_bones, source_weights = _records(profile, audit, source_ids)
        capacity = 8 if audit.get('recordStride', 24) == 64 else 4
        expected_ids = np.full((len(source_ids), capacity), 2 ** 30, dtype=np.int64)
        expected_weights = np.zeros((len(source_ids), capacity), dtype=np.float64)
        expected_ids[:, :source_bones.shape[1]] = source_bones
        expected_weights[:, :source_weights.shape[1]] = source_weights
        expected_ids[expected_weights <= 0] = 2 ** 30
        skin = data['skins'][mesh_skins[index]]
        joint_names = [data['nodes'][j]['name'] for j in skin['joints']]
        joint_symbols = np.array([name_ids.get(n, -1) for n in joint_names], dtype=np.int64)
        if ('JOINTS_1' in attrs) != ('WEIGHTS_1' in attrs) or (capacity == 8 and 'WEIGHTS_1' not in attrs):
            raise ValueError('Extended source influences were omitted')
        if capacity == 4 and 'WEIGHTS_1' in attrs:
            raise ValueError('Unexpected extra influence set on legacy source profile')
        actual_weights = np.concatenate([view(attrs['WEIGHTS_' + str(i)]).astype(np.float64) for i in range(capacity // 4)], axis=1)
        palette_ids = np.concatenate([view(attrs['JOINTS_' + str(i)]).astype(np.int64) for i in range(capacity // 4)], axis=1)
        if not ((palette_ids >= 0).all() and (palette_ids < len(joint_symbols)).all()):
            raise ValueError('Invalid exported joint palette index')
        actual_ids = joint_symbols[palette_ids]
        actual_ids[actual_weights <= 0] = 2 ** 30
        for ids, weights in [(actual_ids, actual_weights), (expected_ids, expected_weights)]:
            order = np.argsort(ids, axis=1, kind='stable')
            ids[:] = np.take_along_axis(ids, order, axis=1)
            weights[:] = np.take_along_axis(weights, order, axis=1)
        if not np.array_equal(actual_ids, expected_ids):
            raise ValueError('Export changed source bone identities')
        error = float(np.max(np.abs(actual_weights - expected_weights), initial=0))
        if not error < 2e-06:
            raise ValueError('Export changed source skin weights')
        if not (np.isfinite(actual_weights).all() and (actual_weights >= 0).all()):
            raise ValueError('Canonical skin/source profile validation failed')
        sum_error = float(np.max(np.abs(actual_weights.sum(axis=1) - 1), initial=0))
        if not sum_error < 2e-06:
            raise ValueError('Canonical skin/source profile validation failed')
        indices = view(primitive['indices']).reshape(-1).astype(np.int64)
        restored_faces = source_ids[indices].astype('<i4')
        digest = hashlib.sha256(restored_faces.tobytes()).hexdigest()
        if not digest == audit['faceSourceIndexSha256']:
            raise ValueError('Export changed source triangle vertex/profile assignments')
        uv_channels = {int(k[9:]) for k in attrs if k.startswith('TEXCOORD_')}
        if not uv_channels == set(range(audit['originalUVChannels'] + 1)):
            raise ValueError('Original UV channels were omitted')
        checked += len(source_ids)
        source_used += audit['sourceUsedVertexCount']
        source_unused += audit['sourceUnusedVertexCount']
        max_error = max(max_error, error)
        max_sum_error = max(max_sum_error, sum_error)
        summaries.append({'mesh': index, 'name': mesh['name'], 'objectId': record['objectId'], 'checkedSourceVertices': len(source_ids), 'droppedUsedSourceVertices': 0, 'maxWeightError': error, 'faceSourceAssignments': 'passed'})
    del profile, mm
    return ({'skinProfileWeldValidation': 'passed', 'skinProfileWeldBasis': 'Every exported vertex retains its unique exact source vertex ID; all source bone identities/weights and ordered triangle/source-index assignments verified before guard removal', 'skinProfileVerticesChecked': checked, 'sourceUsedVertexCount': source_used, 'sourceUnusedVertexCount': source_unused, 'droppedUsedSourceVertices': 0, 'maxSourceSkinWeightError': max_error, 'maxNativeWeightSumError': max_sum_error}, summaries)

def restore_uvs(path, meta):
    data, base, size, binary_kind = glb(path)
    for mesh, record in zip(data['meshes'], meta['meshes']):
        for primitive in mesh['primitives']:
            attrs = primitive['attributes']
            channels = record['skinProfileAudit']['originalUVChannels']
            originals = [attrs['TEXCOORD_' + str(i + 1)] for i in range(channels)]
            for key in list(attrs):
                if key.startswith('TEXCOORD_'):
                    del attrs[key]
            for i, accessor in enumerate(originals):
                attrs['TEXCOORD_' + str(i)] = accessor
    data['asset'].setdefault('extras', {})['MedusaSkinProfileProtection'] = 'Temporary exact source vertex ID in UV0 prevented skin-unsafe welding; original UV channel bindings restored; no tangent recalculation'
    encoded = json.dumps(data, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    temp = path.with_suffix('.restore-uv-tmp')
    with path.open('rb') as source, temp.open('wb') as target:
        target.write(struct.pack('<III', 1179937895, 2, 12 + 8 + len(encoded) + 8 + size))
        target.write(struct.pack('<II', len(encoded), 1313821514))
        target.write(encoded)
        target.write(struct.pack('<II', size, binary_kind))
        source.seek(base)
        shutil.copyfileobj(source, target, 8 * 1024 * 1024)
    temp.replace(path)
