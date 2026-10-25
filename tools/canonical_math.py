"""Own canonical skin math; no game files or upstream source are bundled."""
import json, struct, shutil
from pathlib import Path
import numpy as np
BASE = None
I = np.eye(4, dtype=np.float64)

def configure_root(value):
    global BASE
    BASE = Path(value).resolve()

def checked(p):
    p = p.resolve()
    if not p.is_relative_to(BASE):
        raise ValueError(p)
    return p

def local(n):
    if 'matrix' in n:
        return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
    x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    q = np.array([x, y, z, w])
    q = q / np.linalg.norm(q)
    x, y, z, w = q
    r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    m = I.copy()
    m[:3, :3] = r @ np.diag(n.get('scale', [1, 1, 1]))
    m[:3, 3] = n.get('translation', [0, 0, 0])
    return m

def patch(src, dst):
    with src.open('rb') as f:
        magic, version, total, js, jt = struct.unpack('<5I', f.read(20))
        d = json.loads(f.read(js))
        bs, bt = struct.unpack('<II', f.read(8))
        binbase = 28 + js
    if not (magic == 1179937895 and version == 2 and (total == src.stat().st_size)):
        raise ValueError('Canonical skin/source profile validation failed')
    parents = {}
    for pi, n in enumerate(d['nodes']):
        for ch in n.get('children', []):
            if not ch not in parents:
                raise ValueError('Canonical skin/source profile validation failed')
            parents[ch] = pi
    cache = {}

    def world(i):
        if i not in cache:
            cache[i] = (world(parents[i]) if i in parents else I) @ local(d['nodes'][i])
        return cache[i]
    for i in range(len(d['nodes'])):
        world(i)
    joints = {j for skin in d.get('skins', []) for j in skin['joints']}
    mesh_nodes = [(i, n) for i, n in enumerate(d['nodes']) if 'mesh' in n]
    if not not joints & {i for i, n in mesh_nodes}:
        raise ValueError('Canonical skin/source profile validation failed')
    if not all((not n.get('children') for i, n in mesh_nodes)):
        raise ValueError('Canonical skin/source profile validation failed')
    if not len({n['mesh'] for i, n in mesh_nodes}) == len(mesh_nodes):
        raise ValueError('Canonical skin/source profile validation failed')
    tmp = checked(dst.with_suffix('.canonicalize-tmp'))
    shutil.copyfile(src, tmp)
    mm = np.memmap(tmp, mode='r+', dtype=np.uint8)
    types = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
    dims = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

    def view(ai):
        a = d['accessors'][ai]
        v = d['bufferViews'][a['bufferView']]
        dt = types[a['componentType']]
        sz = np.dtype(dt).itemsize
        c = dims[a['type']]
        return np.ndarray((a['count'], c), dtype=dt, buffer=mm, offset=binbase + v.get('byteOffset', 0) + a.get('byteOffset', 0), strides=(v.get('byteStride', c * sz), sz))
    position_world = {}
    other_done = set()
    weight_done = set()
    changed_weights = 0
    checked_vertices = 0
    max_bake_error = 0.0
    max_inverse_error = 0.0
    max_weight_error = 0.0
    for ni, n in mesh_nodes:
        w = world(ni)
        parentw = world(parents[ni]) if ni in parents else I
        if not np.max(np.abs(parentw - I)) < 1e-08:
            raise ValueError('nonidentity mesh parent')
        for p in d['meshes'][n['mesh']]['primitives']:
            attrs = p['attributes']
            ai = attrs['POSITION']
            if ai in position_world:
                if not np.allclose(position_world[ai], w, atol=1e-09):
                    raise ValueError('Canonical skin/source profile validation failed')
            else:
                position_world[ai] = w.copy()
                v = view(ai)
                old = v.astype(np.float64)
                expected = old @ w[:3, :3].T + w[:3, 3]
                v[:] = expected.astype(v.dtype)
                err = float(np.max(np.abs(v.astype(np.float64) - expected), initial=0))
                max_bake_error = max(max_bake_error, err)
                checked_vertices += len(v)
                if not np.isfinite(v).all():
                    raise ValueError('Canonical skin/source profile validation failed')
                d['accessors'][ai]['min'] = v.min(axis=0).tolist()
                d['accessors'][ai]['max'] = v.max(axis=0).tolist()
            for attr in ['NORMAL', 'TANGENT']:
                ai = attrs.get(attr)
                if ai is None or ai in other_done:
                    continue
                other_done.add(ai)
                v = view(ai)
                xyz = v[:, :3].astype(np.float64)
                xyz = xyz @ (np.linalg.inv(w[:3, :3]) if attr == 'NORMAL' else w[:3, :3].T)
                lengths = np.linalg.norm(xyz, axis=1)
                nz = lengths > 1e-12
                xyz[nz] /= lengths[nz, None]
                v[:, :3] = xyz.astype(v.dtype)
                if attr == 'TANGENT':
                    v[:, 3] *= 1 if np.linalg.det(w[:3, :3]) >= 0 else -1
            ai = attrs.get('WEIGHTS_0')
            if ai is not None and ai not in weight_done:
                weight_done.add(ai)
                a = d['accessors'][ai]
                v = view(ai)
                if not a['componentType'] == 5126:
                    raise ValueError('Canonical skin/source profile validation failed')
                sums = v.astype(np.float64).sum(axis=1)
                if not (np.isfinite(sums).all() and (sums > 0).all()):
                    raise ValueError('Canonical skin/source profile validation failed')
                bad = np.abs(sums - 1) > 1e-06
                changed_weights += int(bad.sum())
                v[bad] = (v[bad].astype(np.float64) / sums[bad, None]).astype(v.dtype)
                max_weight_error = max(max_weight_error, float(np.max(np.abs(v.astype(np.float64).sum(axis=1) - 1), initial=0)))
        n.pop('translation', None)
        n.pop('rotation', None)
        n.pop('scale', None)
        n['matrix'] = I.T.reshape(-1).tolist()
    for skin in d.get('skins', []):
        ib = view(skin['inverseBindMatrices'])
        if not len(ib) == len(skin['joints']):
            raise ValueError('Canonical skin/source profile validation failed')
        for k, ji in enumerate(skin['joints']):
            inv = np.linalg.inv(world(ji))
            ib[k] = inv.T.reshape(-1).astype(np.float32)
            actual = ib[k].astype(np.float64).reshape(4, 4).T
            max_inverse_error = max(max_inverse_error, float(np.max(np.abs(world(ji) @ actual - I))))
    if not (max_bake_error < 1e-05 and max_inverse_error < 0.0001 and (max_weight_error < 1e-05)):
        raise ValueError('Canonical skin/source profile validation failed')
    d.setdefault('asset', {}).setdefault('extras', {})['MedusaCanonicalSkin'] = 'model-space positions; identity mesh nodes; inverse joint-world bind matrices'
    jb = json.dumps(d, separators=(',', ':')).encode()
    jb += b' ' * (-len(jb) % 4)
    mm.flush()
    with dst.open('wb') as f:
        f.write(struct.pack('<III', magic, 2, 12 + 8 + len(jb) + 8 + bs))
        f.write(struct.pack('<II', len(jb), jt))
        f.write(jb)
        f.write(struct.pack('<II', bs, bt))
        f.write(memoryview(mm)[binbase:binbase + bs])
    del ib, v, mm
    checked(tmp).unlink()
    return {'transformValidation': 'passed', 'restSkinValidation': 'passed', 'validationBasis': 'all positions preserve original mesh-node placement; all jointWorld * inverseBind matrices identity; normalized GLB weights', 'verticesChecked': checked_vertices, 'maxRestVertexBakeError': max_bake_error, 'maxJointWorldInverseError': max_inverse_error, 'maxWeightSumError': max_weight_error, 'weightsRepaired': changed_weights, 'raw': str(dst), 'sourceNativeV2': str(src), 'bytes': dst.stat().st_size}
