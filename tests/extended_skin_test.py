"""Synthetic lossless extended-skin regression tests; no game files required."""
import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

import numpy as np

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP / 'tools'))
from skin_profile_validation import glb, restore_extended_profiles, validate_profiles
import canonical_math


class ExtendedSkinTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=APP / 'state')
        self.root = Path(self.temp.name)
        canonical_math.configure_root(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def fixture(self, extended=True):
        data = {'asset': {'version': '2.0'}, 'scene': 0,
                'scenes': [{'nodes': list(range(9))}],
                'nodes': [{'name': 'bone' + str(i)} for i in range(8)] + [{'name': 'Tube', 'mesh': 0, 'skin': 0}],
                'skins': [{'joints': list(range(8))}], 'meshes': [],
                'accessors': [], 'bufferViews': [], 'buffers': [{'byteLength': 0}]}
        binary = bytearray()

        def add(array, kind, component):
            array = np.ascontiguousarray(array)
            binary.extend(b'\0' * (-len(binary) % 4))
            v = len(data['bufferViews'])
            raw = array.tobytes()
            data['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(raw)})
            binary.extend(raw)
            a = len(data['accessors'])
            data['accessors'].append({'bufferView': v, 'componentType': component, 'count': len(array), 'type': kind})
            return a

        positions = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], dtype='<f4')
        attrs = {'POSITION': add(positions, 'VEC3', 5126),
                 'NORMAL': add(np.tile([0, 0, 1], (3, 1)).astype('<f4'), 'VEC3', 5126),
                 'TEXCOORD_0': add(np.array([[0, 0], [1, 0], [2, 0]], dtype='<f4'), 'VEC2', 5126),
                 'TEXCOORD_1': add(positions[:, :2], 'VEC2', 5126),
                 'JOINTS_0': add(np.tile([0, 1, 2, 3], (3, 1)).astype('<u2'), 'VEC4', 5123)}
        weights = np.array([.3, .25, .2, .15, .1, 0, 0, 0] if extended else [.4, .35, .25], dtype='<f4')
        primary = weights[:4].copy() if extended else np.array([.4, .35, .25, 0], dtype='<f4')
        if extended:
            primary /= primary.sum()  # Simulate Assimp truncation/renormalization.
        attrs['WEIGHTS_0'] = add(np.tile(primary, (3, 1)), 'VEC4', 5126)
        indices = np.array([0, 1, 2], dtype='<u4')
        data['meshes'].append({'name': 'Tube', 'primitives': [{'attributes': attrs, 'indices': add(indices, 'SCALAR', 5125)}]})
        data['skins'][0]['inverseBindMatrices'] = add(np.tile(np.eye(4, dtype='<f4').reshape(1, 16), (8, 1)), 'MAT4', 5126)
        data['buffers'][0]['byteLength'] = len(binary)
        js = json.dumps(data).encode()
        js += b' ' * (-len(js) % 4)
        binary.extend(b'\0' * (-len(binary) % 4))
        source = self.root / 'native.glb'
        source.write_bytes(struct.pack('<5I', 1179937895, 2, 28 + len(js) + len(binary), len(js), 1313821514) + js + struct.pack('<II', len(binary), 5130562) + binary)
        records = np.zeros((3, len(weights) * 2), dtype='<f4')
        records[:, 0::2] = np.arange(len(weights))
        records[:, 1::2] = weights
        profiles = self.root / 'profiles.bin'
        profiles.write_bytes(records.tobytes())
        audit = {'byteOffset': 0, 'vertexCount': 3, 'recordStride': records.shape[1] * 4,
                 'sourceUsedVertexCount': 3, 'sourceUnusedVertexCount': 0,
                 'faceSourceIndexSha256': hashlib.sha256(indices.astype('<i4').tobytes()).hexdigest(), 'originalUVChannels': 1}
        meta = {'skinProfileAuditFile': str(profiles), 'skinProfileBoneNames': ['bone' + str(i) for i in range(8)],
                'meshes': [{'name': 'Tube', 'objectId': 42, 'skinProfileAudit': audit}]}
        return source, meta

    def test_truncated_native_is_rejected(self):
        source, meta = self.fixture()
        with self.assertRaisesRegex(ValueError, 'Extended source influences were omitted'):
            validate_profiles(source, meta)

    def test_all_five_influences_restored_and_native_immutable(self):
        source, meta = self.fixture()
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        restored = self.root / 'restored.glb'
        self.assertTrue(restore_extended_profiles(source, restored, meta))
        result, meshes = validate_profiles(restored, meta)
        self.assertEqual(result['skinProfileWeldValidation'], 'passed')
        self.assertEqual(result['maxSourceSkinWeightError'], 0)
        self.assertEqual(result['skinProfileVerticesChecked'], 3)
        self.assertEqual(len(meshes), 1)
        self.assertEqual(before, hashlib.sha256(source.read_bytes()).hexdigest())

    def test_canonicalization_normalizes_both_sets_together(self):
        source, meta = self.fixture()
        restored, target = self.root / 'restored.glb', self.root / 'canonical.glb'
        restore_extended_profiles(source, restored, meta)
        result = canonical_math.patch(restored, target)
        self.assertEqual(result['weightsRepaired'], 0)
        proof, _ = validate_profiles(target, meta)
        self.assertEqual(proof['maxSourceSkinWeightError'], 0)
        data, _, _, _ = glb(target)
        self.assertIn('WEIGHTS_1', data['meshes'][0]['primitives'][0]['attributes'])

    def test_legacy_three_influence_proof_still_passes(self):
        source, meta = self.fixture(False)
        self.assertFalse(restore_extended_profiles(source, self.root / 'unused.glb', meta))
        result, _ = validate_profiles(source, meta)
        self.assertEqual(result['maxSourceSkinWeightError'], 0)

    def test_unsupported_audit_stride_rejected(self):
        source, meta = self.fixture()
        meta['meshes'][0]['skinProfileAudit']['recordStride'] = 32
        with self.assertRaisesRegex(ValueError, 'Unsupported source skin audit stride'):
            validate_profiles(source, meta)


if __name__ == '__main__':
    (APP / 'state').mkdir(exist_ok=True)
    unittest.main()
