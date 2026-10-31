# Accessories and Astartes body-frame templates

The optional prepared library at assets/customization/astartes-v1 adds the Astartes Full Edition 15.2 customisation catalogue to the existing native catalogue. It preserves the source choices for later manual curation. It is not a gameplay mod installer.

## In the studio

The armour menu follows the Astartes Full 15.2 UI itself, rather than pooling mod choices into an extra section. Reading its two header rows left to right gives **Helm, Accessories, Pauldrons, Breastplate, Cloak; Wargear, Head, Gauntlets, Greaves, Tabard**. Native, Iron Hands and Astartes choices stay in their corresponding lists; the Astartes filter remains available.

`ssl/ui/assets/armor_customization/prefabs/ui_armor_slots.sso` supplies both the header grid coordinates and its `bodySections` mapping. `MODDED_SLOT_1` is Accessories (helmet ornaments, laurels, hoods and faceplates); `_2` is Cloak, `_3` is Head, `_4` is Tabard. Chest and Backpack are under Breastplate. The Wargear paginator contains `VANITY`, `VANITY_2`, `VANITY_3`, `CLOTH`, `COAT`, `HALO` and `ANTENNA`; the independently editable Forge Class equipment choice is alongside them. No recipe identity or equip mechanism changes when these navigation groups change.

Chaplain and Apothecary appear in Body Frame. Selecting either template applies its source starting outfit. Loading a saved recipe preserves the saved customisation instead. The templates use the actual modded soldier constructor and its skeleton, rather than renaming a native Tactical frame. Their preview palettes are authored defaults: the source outfit presets do not specify paint colours.

The same selected geometry is used by thumbnails, the main preview and GLB export. Source choices with different geometry receive separate scoped IDs; their original IDs and source records remain in the prepared catalogue. Native IDs and old IHF1 recipes stay valid.

## Resource provenance and completeness

The source snapshot contains 3,801 LOYALIST and CHAOS definitions. The LOYALIST shared Accessories section contains 171 source choices. A single source choice can require several models, or have separate implementations for different constructors. Therefore the number of selectable cards differs from the source definition count.

Models are resolved against the mod constructors, required native constructor parts, story/champion donors and equipment models. Composite options preserve every resolved source component. The signed catalogue retains the complete source definitions; the UI receives a smaller projection.

Source definitions that still refer to unavailable geometry remain visible as disabled cards with their missing selectors and an explanation. They are not replaced by None or guessed geometry. Exports reject such selections explicitly. This source state differs from a missing or corrupt prepared file, which makes the resource library fail validation.

## Equipment and animation

The Apothecary equipment actor follows the actual powerplant_backpack object. Shield variants follow shield_pos. Source local offsets, rotations, miniature rigs, inverse bind matrices and available skin influences are retained. No corrective placement angles are invented. Unconfigured actor names without creation/follow definitions are not automatically mounted.

Existing walk/run clips and timing are retained. The three source-backed frame aliases are separate from the seven native motion bindings. The real output is checked in Blender at rest and sampled walking poses.

Native surface topology, material splits, UV seams and decal carriers are preserved during import. This bulk import does not perform destructive welding, decimation or weight reduction. Armour still uses editable preview materials; full game PBR shaders and secondary cloth physics are separate work.

## Offline use

The complete release packages the prepared models, catalogues, motion and heraldry locally. The game, Astartes PAK, Python and extraction tools are not required during normal use. Every subset payload is declared with a relative path, size and SHA-256.

Author feature descriptions: [Nexus](https://www.nexusmods.com/warhammer40000spacemarine2/mods/89) and [Workshop](https://steamcommunity.com/sharedfiles/filedetails/?id=3774500004). The local CLS/SSO and geometry records establish the actual frame outfits and attachment locations.

## Geometry repair in 0.4.3

Source names are not sufficient to identify an interchangeable mesh: Astartes splits original complete helmets into a shell, faceplate and tubes. Source-specific Story bindings choose the complete native donor. Split modern Story definitions preserve their explicit components and validated donor geometry. Resolution decisions and the original definitions remain in the signed catalogue; fixed options keep their existing IDs.

Terminator is `PVE_PVP_CHARACTER_MOD_1`, with mod `cc_sm_constructor_tank`, exact `PREDEFINED_PRESET_1`, and source PvE actor scale 1.15. This wraps the complete rig and visual assembly exactly once. Chaplain and Apothecary remain available.

`shared/source-geometry.mjs` classifies geometry using source object flags, material roles and source cloth render/simulation bindings. Explicit render declarations take priority. Undocumented helper-like meshes are retained with a diagnostic instead of being silently dropped. Game and mod cloth bindings must be kept separate because names overlap. Native source topology, materials seams and source decal carriers are preserved for later curation.

Preparation may supply `source-resolution-policy.json`, `previous-catalog.json`, `native-source-geometry-bindings.json` and `mod-source-geometry-bindings.json` beneath `--source-root`. Policies are explicit `sourcePath` to `preferredPrimaryModelId` bindings; an unavailable prepared primary fails rather than silently choosing a similarly named model.

## Source correspondence and frame restrictions in 0.5.0

The complete prepared catalogue contains 2,267 available and 79 source-unavailable choices, preserving 3,801 source definitions. A source-selector audit found 36 available options where a normalized group alias was used even though an exact selector existed in a validated donor. Exact matches now take priority across eligible donors; fallback aliases remain available when no exact selector exists. The three reported examples are Chest scout, Chest belt helmet and Chest soldier deathwatch. Their IDs remain stable.

A compound source option can deliberately include geometry beyond its menu label. Scout explicitly includes its source leg mesh. The source files supply no cross-slot negative visibility rule for the reported three chests; geometric intersections alone are not treated as permission to delete source components. Each fix retains the authored selector list and its source object identities.

Terminator restrictions come from the set of LOYALIST local owners in `sourceDefinitions`, not from model filenames or display labels. Exactly 75 choices (74 available and one source-unavailable) belong only to `PVE_PVP_CHARACTER_MOD_1`; they are listed only for that Body Frame. The 36 common shield/no-shield variants remain shared. Incompatible archived codes receive an explicit error during preview/build/export.

Right-shoulder heraldry keeps its original UV0, including values outside the unit interval. Repeating the embedded texture preserves the source mapping; clamping those coordinates samples a transparent border. Actual model renders verify each of the ten company emblems and the independent left Chapter emblem.
