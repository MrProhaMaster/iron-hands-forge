# Bionic left arms — v0.4.0

Choose **Left gauntlet → Bionic left arm** to use the prepared left bionic arm. It is available for Tactical, Sniper, Heavy, Assault, Bulwark, Vanguard and Techmarine. The Windows and Linux packaging paths include the same seven-class resource library. Using a complete packaged build requires no game installation, extra download or Python; a native Linux archive is built and validated separately on Linux.

Each class keeps its own source geometry and skinning. Techmarine uses its standard mechanical arm, including both native submeshes. The arm follows the existing native left arm and finger controls; the character's original body skeleton is retained.

## Save and transfer

The selection is saved with the marine and included in **Share build**, **Save JSON** and **Prepare GLB**. Its semantic recipe value is:

```json
{"LEFT_GAUNTLET":"forge_left_bionic_v1"}
```

This is one entry within the complete recipe's `selection` object. Keep the other armour selections when creating a recipe. A receiving installation needs Forge v0.4.0 or newer and a matching left-bionic resource library. Unavailable parts are reported rather than silently replaced.

Import the generated GLB into Blender, or use the usual [recipe importer](build-codes.md#import-into-blender). The selected arm, its native left-side binding and supported preview motion are retained. Use the native left arm and finger bones for posing; the bionic helper hierarchy remains parented to those controls.

## Prepared resources

The library lives under `assets/characters/SM2-left-bionic/native-v1/` inside the selected data folder. Its `manifest.json` identifies one GLB per supported class, its checksum, mesh names and required native connector. Forge adds the choice to the catalogue at runtime; it does not rewrite the original constructor models or game catalogue.

An older custom data folder may not contain this library. Select **Use included armour** to use the complete release data, or regenerate the additional library from the custom folder's own V5 constructors.

## Regenerate from local V5 data

This is a developer preparation step. Normal release users do not need it. Prepare the seven constructors and catalogue using [local resource preparation](local-preparation.md), then run Python 3.11+ with the NumPy dependency in `tools/requirements-prepare.txt`:

```sh
python tools/prepare_left_bionics.py --data-root '/path/to/ForgeData'
```

On Windows, pass the selected Python executable explicitly if needed:

```powershell
& 'C:/Tools/Python/python.exe' ./tools/prepare_left_bionics.py `
  --data-root 'E:/ForgeData'
```

The generator reads only `production/roster/armor-options.json` and each matching `source-v5/<constructor>.glb` and `.json`. It needs no review folders, prebuilt arm subsets, Blender scenes, raw game archives or network access. A private NumPy installation under `DataRoot/tools/python-packages` is detected automatically.

The default output is `DataRoot/assets/characters/SM2-left-bionic/native-v1/`. Choose a fresh `--output-root` for staging. Existing generated files are replaced only with explicit `--force`. The output includes seven GLB files, the portable runtime manifest, and private provenance reports. Constructor files and the original catalogue are left unchanged.

The preparation applies a geometric X reflection with matching normals and triangle winding. UVs and numerical skin weights are retained. Existing native left joints are reused, and the required bionic helper hierarchy is added with matching bind matrices. Helpers inherit the supported native left-parent motion; this does not add the game's full secondary-physics controller.
