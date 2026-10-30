# Iron Hands portable cosmetics subset

Prepare from an existing local customization export. The generator does not open the game or change constructor models:

    python tools/prepare_iron_hands_library.py --source /path/to/SM2-customization-v001 --data-root /fresh/ForgeData

The output is assets/customization/iron-hands-v1 under DataRoot. Existing output is rejected rather than silently overwritten. Copy the complete generated directory into a prepared Forge library for offline use. Keep this generated payload out of Git.

## Included data

- 20 genuine native Iron Hands and successor decal options plus four native blank choices.
- 44 native-resolution decoded PNGs, including base/three-color masks, common surface maps and four blank-carrier bases.
- Seven native carrier GLBs, containing all 184 curved, skinned placement alternatives. The binary geometry, UV0, COLOR_0, weights and inverse bind matrices are preserved. Only local provenance paths in GLB JSON are sanitized.
- 77 named source decal colors including Transparent, class/armor-option bindings, explicit native bans, and semantic labels for existing Iron Hands armor parts.
- Relative resource paths and SHA-256/size records. No game path, network access, Python or extraction step is needed by the runtime loader.

## Runtime API

shared/iron-hands-library.cjs exports loadIronHandsLibrary(dataRoot), augmentIronHandsRegistry(registry, library), resolveIronHandsDecal(library, request), and resourcePath(dataRoot, relativePath).

Missing optional subset returns ready=false. A present but corrupt/incomplete subset throws an explicit error. The augmenter returns a copy: option IDs, selections, mesh identities and source restrictions stay unchanged. Existing matching options gain human labels, chapter='iron-hands' and an iron-hands tag.

The request to resolveIronHandsDecal is {classId, slot, armorOptionId, decalId}. Slot is an existing armor section: LEFT_PAULDRON, RIGHT_PAULDRON, LEFT_GREAVE or RIGHT_GREAVE. It returns the exact native material, palette defaults, carrierGLB relative path, sourceObjectIDs, subset GLB node/mesh indices, UV set 0 and skinning references. Passing null as decalId clears the selected native carrier. No replacement plane or guessed projection is generated for an unsupported armor option.

Material identity is (slot, materialKey). The same iron_hands_01 key uses different native images on the left and right. Carrier glbNodeIndices and glbMeshIndices point into the small included carrier GLB, not the large original constructor.

## Rendering limits

PNG base maps use sRGB; _cc, surface and normal data use Non-Color. An adapter may recolor native R/G/B masks sequentially in linear color and use normalized weighted color alpha multiplied by base alpha. This is a documented portable approximation; exact Saber GLT parity is not claimed. Native color surface parameters are retained for a renderer-specific interpretation.

Armor constructor GLBs have unresolved native image URI references, not embedded armor textures. This subset supplies actual decals and carriers; it does not claim complete armor PBR maps or unrestricted cross-class compatibility. Donor geometry must be grafted and validated on the target skeleton separately.

## Export PNG adapter

shared/iron-hands-appearance.mjs exports synchronous renderDecalTexture(dataRoot, library, request). Request fields are classId, slot, armorOptionId, decalId, color, secondaryColor and tertiaryColor. The result is {png: Buffer, width, height, mimeType: 'image/png', diagnostics}. The primary color defaults to white; omitted secondary/tertiary colors use the primary. Recipe colors remain the codec's six-digit RGB hex format. Native palette names and RGBA hex are additionally accepted by this low-level renderer for independent adapter checks; they do not extend the recipe schema.

The renderer decodes the actual PNG base and _cc mask with Node zlib, mixes RGB in linear color, preserves source dimensions and alpha coverage, and returns a self-contained RGBA PNG for glTF embedding. It does not transform native UVs, generate projection geometry or resolve a game directory. Palette Transparent was checked to produce zero visible pixels; the 2048-square native emblem was checked in white and red. Shared specular/normal sources remain in the subset for optional material adaptation; the returned PNG contains base color and alpha only.
