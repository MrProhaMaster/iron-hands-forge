# Iron Hands Forge

An offline Space Marine armour studio for assembling a character and transferring the same selected geometry into Blender.

## Launch the portable app

Extract the complete Windows release and run **IronHandsForge.exe**. Keep its app, data, runtime, shared and tools directories together. The release includes Node.js, the .NET runtime, seven native body frames, Terminator, Chaplain and Apothecary templates, the Astartes accessories library, the left-bionic library, motion clips, Iron Hands heraldry and the verified servo startup profile. An installed game, Astartes mod, Internet connection, Python or SDK is not required to customise or export GLB.

The launcher opens a local browser page. Keep its console running; closing it or pressing Ctrl+C stops only the server it created. Linux source/package support uses the same portable resource library; see [Linux](docs/linux.md).

## Armour studio - v0.5.0

- **One active marine.** The former five-character draft is migrated to one marine after an immutable backup is written. Existing IHF1 codes remain readable. Importing an old squad opens its first marine; the original code is unchanged.
- **Body frame and armour are independent.** Choose Tactical, Assault, Vanguard, Bulwark, Heavy, Sniper or Techmarine as the target rig. Compatible, fully resolved parts from the other frames are listed in their ordinary armour sections, with their source class. Source-owned Terminator armour is exclusive to the Terminator frame.
- **Iron Hands parts appear in the normal lists.** Chapter armour, helmets, pauldrons, gauntlets, greaves, backpack, tabard and servo-arm are tagged and named. Use the Iron Hands filter to find them. There is no separate equip-set button.
- **Game-style armour navigation.** The Astartes menu order is Helm, Accessories, Pauldrons, Breastplate, Cloak, Wargear, Head, Gauntlets, Greaves and Tabard. Native and mod parts share their corresponding source sections. Backpack is beside Chest in Breastplate; the native Wargear subslots remain together.
- **Fixed Chapter and Company heraldry.** Chapter applies to the left pauldron. Company applies to the right, with all ten native Iron Hands clan-company emblems. Each side keeps its own three-colour palette. Sculpted or source-forbidden shoulders show their compatibility reason.
- **Full accessory catalogue.** Helmet ornaments, laurels, hoods, faceplates, capes, heads, tabards and class equipment remain independent. Imported source choices are retained for later manual curation; unavailable source references are explicitly disabled.
- **Terminator, Chaplain and Apothecary templates.** Their real mod constructors, rig and source outfit presets initialise the new Body Frame choices. Individual parts remain editable afterwards.
- **Paint and finish.** Global armour, bionic metal, lenses, trim, cloth and beard colours; metallic armour and roughness; local paint overrides per armour slot. Bionic metal and trim colours are independent.
- **Native heraldry.** Genuine chapter, clan and successor emblems use 44 local PNGs and the original curved, skinned carriers. Up to three colour channels are composited into an embedded PNG for portable GLB. A missing or forbidden carrier produces a clear error instead of a guessed projection.
- **Folded servo-arm.** Eight verified Techmarine arm variants use the native SM2 startup pose. Source inverse bind matrices and tube lengths remain unchanged. Incompatible generic servo/tube channels are excluded from the shared walk/run preview and export.
- **Same preview and export.** The local server creates selected-part GLBs for both the viewport and export. Donor parts are adapted to the target rest pose with their original four or eight skin influences and any required helper bones.

The mechanisms were studied against Astartes Overhaul Full 15.2. Forge implements its own local assembly policy; gameplay balance, perks, weapon damage and the game's controller are outside this model editor. See [customisation behaviour](docs/astartes-customization.md) and [Iron Hands resources](docs/iron-hands-cosmetics.md), and [accessories and body-frame templates](docs/astartes-accessories.md).

## Save, share and export

Use **Save marine** for the current workspace. Open **Transfer build** to copy a Soldier IHF1 code, import a code, save a JSON recipe, or prepare a GLB. Appearance, donor choices, emblems and the selected motion travel with the code. The receiving app needs a compatible included/custom resource library. Legacy recipes without the new optional appearance field remain supported.

The four existing walk/run and unarmed/rifle-grip clips retain 0.5-2x speed and their target-body timing. Rifle grip does not attach a weapon. Native full physics, foot IK and cloth simulation are not reproduced. Armour surface materials remain editable preview materials; the heraldry maps are actual embedded textures.

Import the resulting GLB normally in Blender, or use tools/import_recipe_blender.py with a recipe/code and a new output path. Existing scene objects and FPS are retained. See [build codes](docs/build-codes.md).

## Source development and packaging

Node.js 22+ is required for source development. Run scripts/vendor-three.mjs and app/server.cjs. Provide a prepared --data-root or place the verified complete resource bundle in data. All runtime requests stay on loopback and prepared data is resolved locally.

Build Windows with scripts/build-windows.ps1, passing explicit -DotnetExe, -NodeExe, -DataRoot and a new -OutputDirectory. Then run src/launcher/package-release.ps1 with a new archive path. Resources are checksum-verified, paths are made portable, and private state/raw archives are excluded. The launcher and resource-selection behaviour are covered by tests.

Preparing new resources is a developer operation, separate from normal use. See [local preparation](docs/local-preparation.md), tools/prepare_iron_hands_library.py and tools/prepare_servo_pose.mjs. The downloadable app already contains their verified outputs.

## Validation

The 0.5.0 source passed the full Node suite (217 passed; five environment-dependent skips), 39 Python tests, and offline browser checks of all ten body-frame templates. The browser checks render each of the ten companies, preserve the chapter on the opposite shoulder, save and round-trip IHF1, export actual embedded-texture GLB, and verify mobile/desktop layout. Native Linux packaging has a separate Ubuntu workflow gate. Common/Prestige static/walk servo exports were compared numerically with Blender; maximum bounds difference was below 0.000003 m. These are separate gates, not a claim that every possible armour combination has been visually reviewed.

Prepared models and resources remain outside Git. Do not force-add state, .build, data, runtime, dist, game archives or personal configurations. The project's own code is MIT; see [third-party notices](THIRD_PARTY_NOTICES.md).

### Local 0.4.4 geometry repair

Legacy Story armour now uses the source-bound retail geometry rather than identically named, split Astartes pieces. Modern split custom parts keep their mod source. Existing part IDs and saved IHF1 selections are preserved. Render eligibility uses native mesh flags and separate game/mod cloth bindings; a `_SIM` suffix alone no longer removes visible parts.

Body Frame also includes the source-backed Terminator preset (Astartes 15.2), using its actual Tank constructor rig and PvE actor scale 1.15. The source PvP scale is 1.1; this template follows PvE. Native locomotion preview clips retain their original timing.

### Part lists

All armour and accessory lists show one card per part name, across imported sources. Case, whitespace and underscores do not create extra cards. Generic imported `Variant N` labels use the original part name so unrelated numbered records remain distinct. The selected source variant stays selected; all original IDs remain supported by saved IHF1 builds and exports. Source filters and searches still resolve their matching source variant before duplicate names are grouped.

### Switching Body Frame

Selecting a Body Frame loads that class's complete starting outfit, including empty optional slots. Custom per-part paint and emblems from the previous armour are cleared; global paint is retained for native frames. The prepared Astartes profiles retain their source outfit and authored starting palette. Importing a build code, restoring the saved marine or refreshing resources keeps the saved custom selections. Heavy starts without a backpack; imported jetpacks remain available for manual selection.

### Local iteration versions

Current version: **0.5.0**. Historical local builds retain their canonical versions 0.4.1-0.4.6; see [version policy](docs/version-policy.md). Names containing guardsman, astropath, comissar or commissar are excluded from the active parts catalogue.
