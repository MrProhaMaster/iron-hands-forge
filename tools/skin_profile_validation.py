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
        start = audit['byteOffset'] // 4
        count = audit['vertexCount']
        records = profile[start:start + count * 6].reshape(count, 6)[source_ids]
        expected_ids = np.full((len(source_ids), 4), 2 ** 30, dtype=np.int64)
        expected_weights = np.zeros((len(source_ids), 4), dtype=np.float64)
        expected_ids[:, :3] = records[:, 0::2].astype(np.int64)
        expected_weights[:, :3] = records[:, 1::2]
        expected_ids[expected_weights <= 0] = 2 ** 30
        skin = data['skins'][mesh_skins[index]]
        joint_names = [data['nodes'][j]['name'] for j in skin['joints']]
        joint_symbols = np.array([name_ids.get(n, -1) for n in joint_names], dtype=np.int64)
        actual_weights = view(attrs['WEIGHTS_0']).astype(np.float64)
        actual_ids = joint_symbols[view(attrs['JOINTS_0']).astype(np.int64)]
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
