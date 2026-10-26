**Techmarine support — Iron Hands Forge 0.2.0**

Techmarine (`PVE_PVP_ENGINEER`, `cc_sm_constructor_engineer`) uses the original game skeleton and catalogue identifiers. Its servo-arm hoses retain every source influence: verified WEIGHT4 records keep their existing interpretation, and WEIGHT8 records retain all nonzero weights. No hose is hidden and no fifth influence is discarded to fit a four-weight limit.

The local preparation restores the source vertex profiles after native export, before canonical bind conversion. Source-vertex identity guards verify vertex weights and ordered triangle corners. Published glTF uses matched `JOINTS_0`/`WEIGHTS_0` and `JOINTS_1`/`WEIGHTS_1` sets where necessary; weights sum to one across both sets. Existing four-influence constructors remain compatible.

The browser preserves source accessor weights before the Three.js loader can normalize the first set alone. The eight-influence adapter handles rendered positions and normals, shadows, CPU deformation, bounds and picking. Recipe GLBs retain both attribute sets; Blender imports the original influences and the servo-arm bones.

Four shared body preview loops are available: walk/run, unarmed/rifle grip, at 0.5–2× speed. Servo-arm-only joints retain their local bind pose and follow the animated body. These previews do not reproduce the native equipment controller, servo-arm combat actions, cloth, collision or secondary physics. The exported joints remain available for animation in Blender.

**Add Techmarine to existing local data.** From the source checkout or extracted Windows distribution, run the preparation command from [local preparation](local-preparation.md), adding `-Assets cc_sm_constructor_engineer`. Keep the same private data folder; existing constructors and saved builds are preserved. A receiving computer needs this prepared constructor before an IHF1 Techmarine recipe can be assembled. Game models and animation files are never included in the repository or Windows ZIP.
