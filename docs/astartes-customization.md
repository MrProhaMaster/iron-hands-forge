# Astartes-style offline customisation

The reference is Astartes Overhaul Full Edition 15.2, studied on 29 October 2026 from its [author's Nexus description](https://www.nexusmods.com/warhammer40000spacemarine2/mods/89) and [author's Workshop listing](https://steamcommunity.com/sharedfiles/filedetails/?id=3774500004).

The confirmed mechanisms relevant to this editor are cross-class armour, a secondary wargear category, colourable capes and beards, metallic paint and additional heraldry. Forge recreates the assembly behaviour using its own code and the prepared local resource library. It does not install or require the mod, read game saves, reproduce gameplay changes, or package a mod PAK.

## Behaviour

The studio edits one marine. A body frame chooses the target skeleton; it does not restrict every visible armour slot to that class. Native option IDs are retained. Foreign choices use forge:<sourceClassId>:<sourceOptionId> and retain an explicit source-class record. Only resolved geometry is offered as a foreign part.

Donor vertices, normals, tangents and morph deltas are adapted from source rest space into target rest space. Joint palettes preserve the original weights, including eight influences. Missing helper chains are copied beneath compatible target ancestors. This is a skeletal adaptation; arbitrary armour combinations may still require artistic fit review.

Preview and final GLB use the same builder. The viewport requests selected-part-only models and small slot previews from the loopback server. Changing paint updates the same shared appearance policy used by export. No remote model service or installed game is queried.

Cloth, coat, halo, antenna and available vanity sections remain independent. Iron Hands armour is named and tagged inside its ordinary section; there is no separate equip-set action.

## Materials and heraldry

The new optional appearance field carries global auxiliary colours, armour finish, slot-local paint and decal selections. Bionic metal and trim have separate colours. Global metallic/roughness controls affect armour; explicit per-slot overrides may affect that slot's metallic surfaces.

Iron Hands heraldry uses genuine native UV0 carriers and local decoded PNGs. A CPU compositor interprets the three-colour masks and embeds the result into GLB. Left/right source materials are resolved by both section and material key. Exact Saber shader parity is not claimed; armour PBR maps and secondary physics are separate from these preview materials.

## Servo startup pose

The portable servo profile stores the first native sample for 29 mechanical hand/gun helpers, with source hash and eight verified option bindings. It does not replace source inverse bind matrices or tube bind lengths. The same pure motion-channel exclusion is used in the viewport and export so generic body clips cannot overwrite these helpers or incompatible tube translations.

The data comes from the previously reviewed native tacticus_wpn0_idle_mech_arm_intercessor clip. No angles or retimed servo animation are invented. The body walk/run clips retain their existing timing.

## Portability and legacy data

Release data includes seven native body frames plus source-backed Chaplain/Apothecary templates, the Astartes accessory subset, left bionics, four motion clips, the Iron Hands subset and servo profile with checksums. All paths inside the resource inventories are relative. Normal use needs only the unpacked app and a desktop browser.

Older custom libraries can still work without optional additional subsets. A present but incomplete/corrupted subset is rejected. Old IHF1 recipes remain valid; optional appearance is not inserted into old canonical payloads. A multi-marine workspace is backed up byte-for-byte before the single-marine draft is written.
