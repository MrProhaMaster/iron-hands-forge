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
    v = _object(value, ("id", "role", "classId", "selection", "paint"), ("motion", "appearance"), path)
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
    if "appearance" in v:
        result["appearance"] = normalize_appearance(v["appearance"])
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
    return _canonical_json(value).encode("utf-8")


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

def _appearance_number(value, path):
    if type(value) not in (int, float) or not __import__("math").isfinite(value) or not 0 <= value <= 1:
        _fail("INVALID_SCHEMA", f"{path} must be a finite number in0..1")
    return 0 if value == 0 else value


def _appearance_finish(value, path, with_colors=False):
    _object(value, (), ("armor", "trim", "cloth", "metallic", "roughness") if with_colors else ("metallic", "roughness"), path)
    result = {}
    for key, item in value.items():
        if key == "metallic":
            if type(item) is not bool:
                _fail("INVALID_SCHEMA", f"{path}.metallic must be boolean")
            result[key] = item
        elif key == "roughness":
            result[key] = _appearance_number(item, f"{path}.{key}")
        else:
            result[key] = _color(item, f"{path}.{key}")
    return result


def _appearance_map(value, path, limit, normalizer):
    if type(value) is not dict or len(value) > limit:
        _fail("INVALID_SCHEMA", f"{path} must be an object with at most{limit} entries")
    result = {}
    for key, item in value.items():
        if type(key) is not str or key in _FORBIDDEN:
            _fail("INVALID_SCHEMA", f"{path}: forbidden slot")
        result[_id(key, path + " slot")] = normalizer(item, f"{path}.{key}")
    return result


def _appearance_decal(value, path):
    _object(value, ("id", "color"), ("secondaryColor", "tertiaryColor"), path)
    result = {"id": _id(value["id"], path + ".id"), "color": _color(value["color"], path + ".color")}
    for key in ("secondaryColor", "tertiaryColor"):
        if key in value:
            result[key] = _color(value[key], f"{path}.{key}")
    return result


def normalize_appearance(value):
    _object(value, (), ("colors", "finish", "parts", "decals"), "appearance")
    result = {}
    if "colors" in value:
        colors = _object(value["colors"], (), ("trim", "cloth", "beard", "skin"), "appearance.colors")
        result["colors"] = {key: _color(item, "appearance.colors." + key) for key, item in colors.items()}
    if "finish" in value:
        result["finish"] = _appearance_finish(value["finish"], "appearance.finish")
    if "parts" in value:
        result["parts"] = _appearance_map(value["parts"], "appearance.parts", 48, lambda item, path: _appearance_finish(item, path, True))
    if "decals" in value:
        result["decals"] = _appearance_map(value["decals"], "appearance.decals", 16, _appearance_decal)
    return result


def validate_appearance(value):
    normalize_appearance(value)
    return True


def classify_material_role(material_name="", mesh_name=""):
    lower = f"{material_name or ''} {mesh_name or ''}".lower()
    rules = (
        ("rubber", r"undersuit|rubber"),
        ("beard", r"beard|moustache|mustache"),
        ("cloth", r"tabard|cloth|seal|rope|hair"),
        ("leather", r"bag|belt|leather"),
        ("lenses", r"lenses|optic"),
        ("glass", r"glass"),
        ("metal", r"preview_steel|forge_left_bionic|ch_cato_hand_lod|ch_tech_marine_mecharm|soldier_arm_r_02|soldier_hand_l_01"),
        ("skin", r"head_|skin|eye_"),
    )
    for role, pattern in rules:
        if re.search(pattern, lower) and not (role == "skin" and "helmet" in lower):
            return role
    trim = r"(?:^|[^a-z])(?:trim|ornament|decoration|decor|silver|gold|bronze)(?:[^a-z]|$)"
    material, mesh = str(material_name or "").lower(), str(mesh_name or "").lower()
    if re.search(trim, material) or (not re.search(r"armor|armour|body|base|paint", material) and re.search(trim, mesh)):
        return "trim"
    return "armor"


def resolve_appearance(soldier, slot, role="armor"):
    paint = soldier.get("paint", {})
    defaults = {
        "armor": {"color": paint.get("armor", "#171B22"), "metallic": .12, "roughness": .48, "opacity": 1},
        "trim": {"color": paint.get("metal", "#B3BDC9"), "metallic": .85, "roughness": .34, "opacity": 1},
        "metal": {"color": paint.get("metal", "#B3BDC9"), "metallic": .85, "roughness": .34, "opacity": 1},
        "lenses": {"color": paint.get("lenses", "#EE291C"), "metallic": .1, "roughness": .2, "opacity": 1, "emissive": paint.get("lenses", "#EE291C")},
        "cloth": {"color": "#51483C", "metallic": 0, "roughness": .85, "opacity": 1},
        "beard": {"color": "#51483C", "metallic": 0, "roughness": .85, "opacity": 1},
        "skin": {"color": "#A18A79", "metallic": 0, "roughness": .7, "opacity": 1},
        "leather": {"color": "#372E28", "metallic": 0, "roughness": .7, "opacity": 1},
        "rubber": {"color": "#101215", "metallic": 0, "roughness": .78, "opacity": 1},
        "glass": {"color": "#18232C", "metallic": .12, "roughness": .12, "opacity": .18},
    }
    result = dict(defaults.get(role, defaults["armor"]))
    appearance = soldier.get("appearance", {})
    part = appearance.get("parts", {}).get(slot, {})
    color_role = role
    if color_role in appearance.get("colors", {}):
        result["color"] = appearance["colors"][color_role]
    if color_role in part:
        result["color"] = part[color_role]
    if role in ("armor", "trim", "metal"):
        for key in ("metallic", "roughness"):
            value = part[key] if key in part else appearance.get("finish", {}).get(key) if role == "armor" else None
            if value is not None:
                result[key] = (1 if value else 0) if key == "metallic" else value
    return result


def _js_number(value):
    """ECMAScript JSON decimal spelling for supported finite visual numbers."""
    if value == 0:
        return "0"
    text = repr(value).lower()
    if "e" not in text:
        return text[:-2] if text.endswith(".0") else text
    mantissa, exponent = text.split("e")
    exp = int(exponent)
    if -6 <= exp < 21:
        negative = mantissa.startswith("-")
        digits = mantissa.lstrip("-").replace(".", "")
        point = 1 + exp
        if point <= 0:
            text = "0." + "0" * (-point) + digits
        elif point >= len(digits):
            text = digits + "0" * (point - len(digits))
        else:
            text = digits[:point] + "." + digits[point:]
        return ("-" if negative else "") + text
    return mantissa + "e" + ("+" if exp >= 0 else "-") + str(abs(exp))


def _canonical_json(value):
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if type(value) is int:
        return str(value)
    if type(value) is float:
        return _js_number(value)
    if type(value) is list:
        return "[" + ",".join(_canonical_json(item) for item in value) + "]"
    if type(value) is dict:
        return "{" + ",".join(json.dumps(key, ensure_ascii=False) + ":" + _canonical_json(value[key]) for key in sorted(value)) + "}"
    return json.dumps(value, ensure_ascii=False)
