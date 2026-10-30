# Portable build codes (IHF1)

An IHF1 code describes an armour recipe, not a mesh. Each computer resolves the same semantic class, slot and option IDs against its own prepared Space Marine 2 data. No machine-specific drive paths or raw mesh-object IDs are required in the recipe.

## Share a build

1. Select a marine, class, armour parts and preview colours.
2. Choose Walk or Run, a grip and a tempo from 0.5x to 2x.
3. Select **Transfer build**, generate a **Soldier code**, then copy the text.
4. On the receiving computer, connect prepared local data, paste the code and select **Import**.
5. Use **Save JSON** for a recipe file or **Prepare GLB** for a rigged model with the selected preview animation.

The dialog regenerates the selected marine's code when opened. Editing the text lets you paste a received code. Unknown parts, unavailable geometry and unsupported classes are rejected before the live marine is replaced. The editor keeps custom names as entered.

Different game catalogues can contain different parts. A catalogue-signature warning is a prompt to inspect compatibility; the importer does not silently replace a missing requested part. Keep the module and prepared game data consistent when collaborating.

## Wire format

`IHF1.<base64url(zlib(canonical UTF-8 JSON))>.<crc32>`

- The prefix and JSON schema version are both versioned.
- Base64url has no padding. CRC32 is eight lowercase hexadecimal digits calculated over the uncompressed canonical UTF-8 bytes.
- Object keys use Unicode code-point order; arrays keep their order. Colours normalize to uppercase `#RRGGBB`.
- Maximum code length: 64 KiB. Maximum uncompressed recipe: 128 KiB. A squad can contain 1–20 uniquely identified marines.
- Invalid compression, trailing streams, damaged checksums, duplicate/noncanonical JSON and unknown fixed-schema properties are rejected.
- CRC32 detects copy errors; it is not an author signature or encryption.

Use `shared/recipe-codec.mjs` or `tools/recipe_codec.py` instead of implementing a second encoder. Different zlib versions may produce different valid compressed text while preserving identical canonical data and checksums.

## Recipe fields

| Field | Meaning |
| --- | --- |
| `schema`, `version` | `iron-hands-forge`, `1` |
| `kind` | `soldier` or `roster` |
| `catalog` | Game ID `SM2`, source build label and optional semantic catalogue signature |
| `soldiers[].id` | Instance identifier, unique within the recipe |
| `role` | User-visible name, preserved as Unicode |
| `classId` | Semantic appearance/class ID |
| `selection` | Slot ID → semantic armour option ID |
| `paint` | `armor`, `metal` and `lenses` colours |
| `motion` | Optional `gait`, `stance`, integer `speedPct` (50–200), and `inPlace: true` |

Omitting `motion` exports a static rigged model. `gait` is `walk` or `run`; `stance` is `unarmed` or `armed`. Armed preview means a two-handed grip; it does not attach a weapon automatically. The seven supported class rigs use verified shared game loops. Fixed facial bind controls preserve the selected head's geometry; this is not the game's full facial, physics or locomotion controller.

A complete Tactical example is in [examples/tactical-build.json](../examples/tactical-build.json). It contains identifiers and colours only.

In Forge v0.4.0, **Left gauntlet → Bionic left arm** uses `selection.LEFT_GAUNTLET = "forge_left_bionic_v1"`. It travels through the same IHF1, JSON and GLB/Blender workflow as the other armour choices. The receiving data library must include the [seven-class left-bionic resources](left-bionics.md); an older catalogue reports the option as unavailable.

## Import into Blender

The web app's GLB output can be imported using Blender's glTF importer. For a recipe-driven import:

```powershell
.\scripts\import-blender.ps1 `
  -Recipe "E:\ForgeExports\marine.ihf.json" `
  -DataRoot "E:\ForgeData" `
  -Out "E:\Animation\cast.blend" `
  -BlenderExe "E:\Blender\blender.exe"
```

Run the script from the complete Windows distribution so its bundled Node runtime is available. Source users can pass `-NodeExe` explicitly.

To append to an existing scene, run `tools/import_recipe_blender.py` from that Blender scene with `--recipe` or `--code`, `--data-root`, `--out`, and optionally `--node`. It adds an **Iron Hands Forge** collection, retains existing objects and scene FPS, stores the recipe in collection/object metadata, and refuses to overwrite an existing output `.blend` file. Multiple marines are placed side by side as a staging layout.

Generated game masks are retained as custom `_SM2_COLOR_*` attributes so they do not become unintended standard glTF vertex colours. Materials remain preview colours; final game PBR, secondary physics, foot IK and detailed weapon/hand controller behaviour are separate work.


## Appearance and cross-class armour (v0.4.1)

The studio now edits one marine. Its wire codec still accepts legacy squads for compatibility, and opening one in the studio imports the first marine. The original code is unchanged. Before migrating an on-disk squad, the server writes an immutable byte-identical backup.

The optional soldiers[].appearance field can contain:

- colors: optional trim, cloth, beard and skin hexadecimal colours.
- finish: optional metallic boolean and roughness number from 0 through 1 for global armour.
- parts: a slot-keyed map of optional armour/trim/cloth colours, metallic and roughness overrides.
- decals: a slot-keyed map with id, primary color, optional secondaryColor and tertiaryColor.

All colours are #RRGGBB. Missing secondary/tertiary decal colours inherit the primary. The exact schema is validated by the shared JavaScript/Python codecs. A legacy payload without appearance is kept without that field, preserving its canonical bytes and checksum.

Foreign armour options use forge:<sourceClassId>:<sourceOptionId>. These are semantic source references, not local paths or raw object IDs. Both computers need the corresponding prepared library and app version. Native IDs remain valid.

The servo startup pose is a verified library policy for the selected arm option, not user-specific angles in a code. The portable profile and its checksum ship with the resource bundle.

Actual heraldry PNGs are embedded in GLB. Armour materials remain editable preview materials. Native body motion, four/eight skin weights and source tube bind lengths are preserved by the shared builder.
