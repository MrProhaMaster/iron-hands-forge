"""Dependency-free portable IHF1 recipe codec (Python3.10+).

normalize_recipe(value) returns a fresh validated recipe, uppercasing colors.
encode_recipe(value) / decode_recipe(code) interoperate with shared/recipe-codec.mjs.
IHF1.<unpadded canonical base64url(zlib(canonical UTF8 JSON))>.<raw CRC32 lowerhex8>
CRC32 is accidental-corruption detection, not authentication.
Canonical raw bytes/CRC agree across runtimes; native compressor versions may
produce different valid DEFLATE blocks for the same canonical payload.
"""
import base64
import binascii
import json
import re
import zlib

MAX_CODE_LENGTH = 64 * 1024
MAX_RAW_BYTES = 128 * 1024
_FORBIDDEN = {"__proto__", "prototype", "constructor"}


class RecipeCodecError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def _fail(code, message):
    raise RecipeCodecError(code, message)


def _object(value, required, optional, path):
    if type(value) is not dict:
        _fail("INVALID_SCHEMA", f"{path} must be an object")
    allowed = set(required) | set(optional)
    if any(type(k) is not str or k in _FORBIDDEN or k not in allowed for k in value):
        _fail("INVALID_SCHEMA", f"{path}: forbidden or unknown property")
    if not set(required).issubset(value):
        _fail("INVALID_SCHEMA", f"{path}: missing required property")
    return value


def _id(value, path):
    if type(value) is not str or not 1 <= len(value) <= 160 or any(0xD800 <= ord(c) <= 0xDFFF for c in value):
        _fail("INVALID_SCHEMA", f"{path} must contain1..160 Unicode code points")
    return value


def _color(value, path):
    if type(value) is not str or not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        _fail("INVALID_SCHEMA", f"{path} must be #RRGGBB")
    return value.upper()


def _soldier(value, index):
    path = f"soldiers[{index}]"
    v = _object(value, ("id", "role", "classId", "selection", "paint"), ("motion",), path)
    if type(v["selection"]) is not dict:
        _fail("INVALID_SCHEMA", f"{path}.selection must be an object")
    selection = {}
    for key, option in v["selection"].items():
        if type(key) is not str or key in _FORBIDDEN:
            _fail("INVALID_SCHEMA", f"{path}.selection: forbidden slot")
        selection[_id(key, f"{path}.selection slot")] = _id(option, f"{path}.selection.{key}")
    p = _object(v["paint"], ("armor", "metal", "lenses"), (), f"{path}.paint")
    result = {
        "id": _id(v["id"], f"{path}.id"),
        "role": _id(v["role"], f"{path}.role"),
        "classId": _id(v["classId"], f"{path}.classId"),
        "selection": selection,
        "paint": {k: _color(p[k], f"{path}.paint.{k}") for k in ("armor", "metal", "lenses")},
    }
    if "motion" in v:
        m = _object(v["motion"], ("gait", "stance", "speedPct", "inPlace"), (), f"{path}.motion")
        if (m["gait"] not in ("walk", "run") or m["stance"] not in ("unarmed", "armed")
                or type(m["speedPct"]) is not int or not 50 <= m["speedPct"] <= 200 or m["inPlace"] is not True):
            _fail("INVALID_SCHEMA", f"{path}.motion is invalid")
        result["motion"] = {"gait": m["gait"], "stance": m["stance"], "speedPct": m["speedPct"], "inPlace": True}
    return result


def normalize_recipe(value):
    v = _object(value, ("schema", "version", "kind", "catalog", "soldiers"), (), "recipe")
    if v["schema"] != "iron-hands-forge" or type(v["version"]) is not int or v["version"] != 1 or v["kind"] not in ("soldier", "roster"):
        _fail("INVALID_SCHEMA", "Unsupported schema, version or kind")
    c = _object(v["catalog"], ("game", "build"), ("signature",), "catalog")
    if c["game"] != "SM2":
        _fail("INVALID_SCHEMA", "catalog.game must be SM2")
    catalog = {"game": "SM2", "build": _id(c["build"], "catalog.build")}
    if "signature" in c:
        catalog["signature"] = _id(c["signature"], "catalog.signature")
    if type(v["soldiers"]) is not list or not 1 <= len(v["soldiers"]) <= (1 if v["kind"] == "soldier" else 20):
        _fail("INVALID_SCHEMA", "Invalid soldiers array/count")
    soldiers = [_soldier(s, i) for i, s in enumerate(v["soldiers"])]
    if len({s["id"] for s in soldiers}) != len(soldiers):
        _fail("INVALID_SCHEMA", "Soldier ids must be unique")
    return {"schema": "iron-hands-forge", "version": 1, "kind": v["kind"], "catalog": catalog, "soldiers": soldiers}


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def _base64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _inflate_limited(data):
    decoder = zlib.decompressobj()
    pieces = []
    total = 0
    try:
        for offset in range(0, len(data), 1024):
            chunk = data[offset:offset + 1024]
            output = decoder.decompress(chunk, MAX_RAW_BYTES - total + 1)
            total += len(output)
            if total > MAX_RAW_BYTES:
                _fail("LIMIT_EXCEEDED", "Decompressed recipe exceeds128 KiB")
            pieces.append(output)
            # Reaching a max-length stop necessarily fills the remaining budget
            # plus1 above; otherwise no unconsumed input is expected here.
            if decoder.unconsumed_tail:
                _fail("LIMIT_EXCEEDED", "Decompression output budget exhausted")
            if decoder.unused_data or (decoder.eof and offset + len(chunk) != len(data)):
                _fail("INVALID_COMPRESSION", "Trailing compressed bytes")
        if not decoder.eof:
            _fail("INVALID_COMPRESSION", "Truncated zlib stream")
    except zlib.error as error:
        raise RecipeCodecError("INVALID_COMPRESSION", "Invalid zlib stream") from error
    return b"".join(pieces)


def encode_recipe(value):
    raw = _canonical(normalize_recipe(value))
    if len(raw) > MAX_RAW_BYTES:
        _fail("LIMIT_EXCEEDED", "Recipe exceeds128 KiB")
    code = f"IHF1.{_base64url(zlib.compress(raw))}.{binascii.crc32(raw):08x}"
    if len(code) > MAX_CODE_LENGTH:
        _fail("LIMIT_EXCEEDED", "Encoded recipe exceeds64 KiB")
    return code


def decode_recipe(code):
    if type(code) is not str or len(code) > MAX_CODE_LENGTH:
        _fail("LIMIT_EXCEEDED", "Invalid code type or size")
    match = re.fullmatch(r"IHF1\.([A-Za-z0-9_-]+)\.([0-9a-f]{8})", code)
    if not match or len(match[1]) % 4 == 1:
        _fail("MALFORMED_CODE", "Invalid IHF1 framing/base64url")
    try:
        compressed = base64.b64decode(match[1] + "=" * (-len(match[1]) % 4), altchars=b"-_", validate=True)
    except (ValueError, binascii.Error) as error:
        raise RecipeCodecError("MALFORMED_CODE", "Invalid base64url") from error
    if _base64url(compressed) != match[1]:
        _fail("MALFORMED_CODE", "Noncanonical base64url")
    raw = _inflate_limited(compressed)
    if f"{binascii.crc32(raw):08x}" != match[2]:
        _fail("CHECKSUM_MISMATCH", "Recipe CRC32 mismatch")
    try:
        value = json.loads(raw.decode("utf-8"), parse_constant=lambda _: _fail("INVALID_SCHEMA", "Nonfinite JSON number"))
    except (UnicodeError, ValueError, RecursionError) as error:
        raise RecipeCodecError("INVALID_SCHEMA", "Recipe is not valid UTF8 JSON") from error
    recipe = normalize_recipe(value)
    if _canonical(recipe) != raw:
        _fail("NON_CANONICAL_JSON", "Recipe JSON is not canonical")
    return recipe
