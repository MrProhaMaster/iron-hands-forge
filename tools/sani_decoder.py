"""Decode verified inline SM2 ETNA/SANI Q16 regular clips into source-space TRS.

Requires Python and NumPy. No game data is bundled with this decoder. Source PAKs
and extracted SANI files are never modified. Streamed clips remain explicit skips
until their sidecar layout is verified.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
from pathlib import Path

import numpy as np




class Reader:
    def __init__(self, data: bytes, start: int, end: int):
        self.data, self.pos, self.end = data, start, end

    def unpack(self, fmt):
        size = struct.calcsize("<" + fmt)
        if self.pos + size > self.end:
            raise ValueError(f"Read exceeds chunk at {self.pos}, wanted {size} bytes")
        result = struct.unpack_from("<" + fmt, self.data, self.pos)
        self.pos += size
        return result

    def array(self, dtype, count, shape=None):
        dtype = np.dtype(dtype)
        size = dtype.itemsize * count
        if self.pos + size > self.end:
            raise ValueError(f"Array exceeds chunk at {self.pos}, wanted {size} bytes")
        a = np.frombuffer(self.data, dtype=dtype, count=count, offset=self.pos).copy()
        self.pos += size
        return a.reshape(shape) if shape is not None else a

    def string(self):
        size, = self.unpack("I")
        if size > 65536 or self.pos + size > self.end:
            raise ValueError(f"Invalid channel string length {size}")
        s = self.data[self.pos:self.pos + size].decode("utf-8")
        self.pos += size
        return s.rstrip("\x00")

    def finish(self):
        if self.pos != self.end:
            raise ValueError(f"Unconsumed chunk bytes: consumed to {self.pos}, expected {self.end}")


def chunks(data):
    if data[:4] != b"ETNA":
        raise ValueError("Not an ETNA/SANI file")
    version, = struct.unpack_from("<H", data, 4)
    result, offset = [], 6
    while offset < len(data):
        if offset + 6 > len(data):
            raise ValueError("Truncated SANI chunk header")
        kind, end = struct.unpack_from("<HI", data, offset)
        if not offset + 6 <= end <= len(data):
            raise ValueError(f"Invalid absolute end offset {end} for chunk {kind} at {offset}")
        result.append({"kind": kind, "offset": offset, "payload": offset + 6, "end": end, "payloadBytes": end - offset - 6})
        offset = end
    return version, result


def quaternions(xyz):
    squared = np.sum(xyz * xyz, axis=-1)
    # Saber stores stereographic quaternion coordinates v = q.xyz/(1+q.w).
    # Confirmed against fixed facial bind orientations in the matching retail rig.
    denominator = 1.0 + squared
    vector = 2.0 * xyz / denominator[..., None]
    w = (1.0 - squared) / denominator
    q = np.concatenate((vector, w[..., None]), axis=-1)
    length = np.linalg.norm(q, axis=-1, keepdims=True)
    q /= np.maximum(length, 1e-30)
    return q, float(np.sqrt(np.max(squared))) if squared.size else 0.0


def decode_metadata(data, chunk):
    r = Reader(data, chunk["payload"], chunk["end"])
    duration, fps, frame_count, channel_count, float_count = r.unpack("ffIII")
    if not (0 < fps <= 1000 and 1 <= frame_count <= 100000 and channel_count <= 10000 and float_count <= 10000):
        raise ValueError("Unreasonable SANI metadata counts")
    names = [r.string() for _ in range(channel_count)]
    float_names = [r.string() for _ in range(float_count)]
    r.finish()
    return {"duration": duration, "fps": fps, "frameCount": frame_count, "channelNames": names, "floatNames": float_names}


def decode_q16(data, chunk, metadata):
    r = Reader(data, chunk["payload"], chunk["end"])
    compression, = r.unpack("H")
    if compression != 2:
        raise NotImplementedError(f"Compression {compression} is not the verified Q16 layout")
    counts = r.unpack("6I")
    ap, ar, af, fp, fr, ff = counts
    n, nf, frames = len(metadata["channelNames"]), len(metadata["floatNames"]), metadata["frameCount"]
    if (ap + fp, ar + fr, af + ff) != (n, n, nf):
        raise ValueError(f"Channel partitions do not cover metadata: {counts}")
    indices = [r.array("<u2", count).astype(np.int64) for count in counts]
    for a, b, expected in [(indices[0], indices[3], n), (indices[1], indices[4], n), (indices[2], indices[5], nf)]:
        if sorted(np.concatenate((a, b)).tolist()) != list(range(expected)):
            raise ValueError("Channel index partition is invalid or duplicated")
    offsets = {"afterIndexArrays": r.pos}
    fixed_pos_range = r.array("<f4", 6, (2, 3)).astype(np.float64)
    fixed_rot_range = r.array("<f4", 6, (2, 3)).astype(np.float64)
    fixed_float_range = r.array("<f4", 2, (2, 1)).astype(np.float64)
    pos_ranges = r.array("<f4", ap * 6, (ap, 2, 3)).astype(np.float64)
    rot_ranges = r.array("<f4", ar * 6, (ar, 2, 3)).astype(np.float64)
    float_ranges = r.array("<f4", af * 2, (af, 2)).astype(np.float64)
    offsets["fixedPositions"] = r.pos
    fixed_pos = r.array("<u2", fp * 3, (fp, 3)) * fixed_pos_range[1] + fixed_pos_range[0]
    offsets["fixedRotations"] = r.pos
    fixed_rot_xyz = r.array("<u2", fr * 3, (fr, 3)) * fixed_rot_range[1] + fixed_rot_range[0]
    offsets["fixedFloats"] = r.pos
    fixed_float = r.array("<u2", ff) * fixed_float_range[1, 0] + fixed_float_range[0, 0]
    offsets["animatedPositions"] = r.pos
    packed = r.array("<u4", frames * ap, (frames, ap))
    quantized_pos = np.stack((packed >> 21, (packed >> 10) & 2047, packed & 1023), axis=-1)
    animated_pos = quantized_pos * pos_ranges[None, :, 1, :] + pos_ranges[None, :, 0, :]
    offsets["animatedRotations"] = r.pos
    animated_rot_xyz = r.array("<u2", frames * ar * 3, (frames, ar, 3)) * rot_ranges[None, :, 1, :] + rot_ranges[None, :, 0, :]
    offsets["animatedFloats"] = r.pos
    animated_float = r.array("<u2", frames * af, (frames, af)) * float_ranges[None, :, 1] + float_ranges[None, :, 0]
    r.finish()
    positions = np.empty((frames, n, 3), dtype=np.float64)
    rotations = np.empty((frames, n, 4), dtype=np.float64)
    values = np.empty((frames, nf), dtype=np.float64)
    positions[:, indices[0]] = animated_pos
    positions[:, indices[3]] = fixed_pos
    animated_q, animated_excess = quaternions(animated_rot_xyz)
    fixed_q, fixed_excess = quaternions(fixed_rot_xyz)
    rotations[:, indices[1]] = animated_q
    rotations[:, indices[4]] = fixed_q
    values[:, indices[2]] = animated_float
    values[:, indices[5]] = fixed_float
    for frame in range(1, frames):
        flip = np.sum(rotations[frame] * rotations[frame - 1], axis=-1) < 0
        rotations[frame, flip] *= -1
    if not (np.isfinite(positions).all() and np.isfinite(rotations).all() and np.isfinite(values).all()):
        raise ValueError("Nonfinite decoded TRS values")
    if np.max(np.abs(positions)) > 100000:
        raise ValueError("Decoded translations are unreasonably large")
    steps = np.linalg.norm(np.diff(positions, axis=0), axis=-1) if frames > 1 else np.zeros((1, n))
    angular = np.degrees(2 * np.arccos(np.clip(np.abs(np.sum(rotations[1:] * rotations[:-1], axis=-1)), 0, 1))) if frames > 1 else np.zeros((1, n))
    end_angle = np.degrees(2 * np.arccos(np.clip(np.abs(np.sum(rotations[-1] * rotations[0], axis=-1)), 0, 1)))
    validation = {"chunkFullyConsumed": True, "finite": True, "quaternionMaxUnitNormError": float(np.max(np.abs(np.linalg.norm(rotations, axis=-1) - 1))),
                  "stereographicVectorMaxLength": max(animated_excess, fixed_excess), "maxPositionStep": float(np.max(steps)),
                  "maxRotationStepDegrees": float(np.max(angular)), "loopMaxPositionDistance": float(np.max(np.linalg.norm(positions[-1] - positions[0], axis=-1))),
                  "loopMaxRotationDegrees": float(np.max(end_angle)), "durationMatchesSamples": abs(metadata["duration"] - (frames - 1) / metadata["fps"]) < 1e-4,
                  "largestRotationStepChannel": metadata["channelNames"][int(np.unravel_index(np.argmax(angular), angular.shape)[1])]}
    channels = [{"name": name, "positionMode": "animated" if index in indices[0] else "fixed", "rotationMode": "animated" if index in indices[1] else "fixed",
                 "positions": positions[:, index].round(9).tolist(), "rotations": rotations[:, index].round(10).tolist()} for index, name in enumerate(metadata["channelNames"])]
    floats = [{"name": name, "mode": "animated" if index in indices[2] else "fixed", "values": values[:, index].round(9).tolist()} for index, name in enumerate(metadata["floatNames"])]
    return channels, floats, validation, {"counts": dict(zip(("animatedPositions", "animatedRotations", "animatedFloats", "fixedPositions", "fixedRotations", "fixedFloats"), counts)), "offsets": offsets}


def decode_trajectory(data, chunk, metadata):
    r = Reader(data, chunk["payload"], chunk["end"])
    compression, = r.unpack("H")
    if compression != 2:
        return {"supported": False, "compression": compression}
    pos_range = r.array("<f4", 6, (2, 3)).astype(np.float64)
    rot_range = r.array("<f4", 6, (2, 3)).astype(np.float64)
    frames = metadata["frameCount"]
    positions = r.array("<u2", frames * 3, (frames, 3)) * pos_range[1] + pos_range[0]
    xyz = r.array("<u2", frames * 3, (frames, 3)) * rot_range[1] + rot_range[0]
    rotations, excess = quaternions(xyz)
    r.finish()
    return {"supported": True, "positions": positions.round(9).tolist(), "rotations": rotations.round(10).tolist(), "stereographicVectorMaxLength": excess,
            "applyDefault": False, "displacement": (positions[-1] - positions[0]).round(9).tolist(), "note": "Separate cumulative root motion; disabled for in-place preview; do not add twice to CharacterWorldSpaceTM"}


def decode(path):
    data = path.read_bytes()
    version, table = chunks(data)
    meta_chunk = next(c for c in table if c["kind"] == 241)
    metadata = decode_metadata(data, meta_chunk)
    regular = next((c for c in table if c["kind"] == 242), None)
    if regular is None:
        raise NotImplementedError("No inline regular chunk 242; streamed 246/247 sidecar layout requires a separate verified decoder")
    channels, floats, validation, layout = decode_q16(data, regular, metadata)
    trajectory = next((c for c in table if c["kind"] == 244), None)
    result = {"schema": "SM2-SANI-TRS-1", "clip": path.stem, "source": str(path), "sourceSha256": hashlib.sha256(data).hexdigest(), "fileVersion": version,
              "fps": metadata["fps"], "frameCount": metadata["frameCount"], "duration": metadata["duration"],
              "boneNames": metadata["channelNames"],
              "times": (np.arange(metadata["frameCount"]) / metadata["fps"]).round(9).tolist(),
              "coordinateSystem": {"space": "Saber source local channels; no axis or bind-orientation conversion applied", "quaternionOrder": "xyzw", "scalePolicy": "No scale channels in this verified layout; retain target rig bind scale"},
              "decoderEvidence": {"regularChunk": 242, "positionPacking": "u32: X11 bits21..31, Y11 bits10..20, Z10 bits0..9", "quantization": "bias + per-integer-step * integer", "rotationPacking": "u16 XYZ stereographic vector v; q.xyz=2v/(1+dot(v,v)), q.w=(1-dot(v,v))/(1+dot(v,v)); hemisphere continuity", "referencePoseComparison": "Stereographic representation independently matched fixed facial bind quaternion in retail rig; final animated pose preview still required"},
              "chunks": table, "layout": layout, "validation": validation, "channels": channels, "floatChannels": floats,
              "trajectory": decode_trajectory(data, trajectory, metadata) if trajectory else None}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    paths = [args.source] if args.source.is_file() else sorted(args.source.glob("*.sani"))
    manifest = {"schema": "SM2-SANI-TRS-1", "decoded": [], "skipped": [], "failed": []}
    for path in paths:
        try:
            result = decode(path)
            output = args.output / (path.stem + ".animation.json")
            output.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
            entry = {"clip": path.stem, "output": str(output), "frames": result["frameCount"], "channels": len(result["channels"]), "validation": result["validation"]}
            manifest["decoded"].append(entry)
            print("SANI_DECODED", json.dumps(entry), flush=True)
        except NotImplementedError as error:
            manifest["skipped"].append({"source": str(path), "reason": str(error)})
            print("SANI_SKIPPED", path.name, str(error), flush=True)
        except Exception as error:
            manifest["failed"].append({"source": str(path), "error": str(error)})
            print("SANI_FAILED", path.name, str(error), flush=True)
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
