# Local resource preparation

Game models, textures, animations, and prepared catalogues are not included in the repository. Preparation reads your installed Space Marine 2 files and creates a private data folder. It does not modify the game directory.

Requirements: Windows x64, PowerShell **5.1+**, Git, .NET SDK **8.0.426**, Python **3.11+**, and NumPy **2.3.4**. The tested Python version is 3.13. Pass explicit paths to your existing `dotnet.exe` and `python.exe`. Blender's Python can be used if NumPy is available. The first run also obtains pinned upstream sources and NuGet dependencies; subsequent builds reuse the private cache.

Run from the application root, replacing the example paths with your own:

```powershell
./scripts/prepare-data.ps1 `
  -GameRoot 'E:/SteamLibrary/steamapps/common/Space Marine 2' `
  -DataRoot 'E:/ForgeData' `
  -DotNet 'E:/Tools/dotnet/dotnet.exe' `
  -Python 'E:/Tools/Python/python.exe'
```

All new files, caches, temporary files, dependency sources, and preparation results stay inside `DataRoot`. Choose a private folder outside the repository, or its ignored `data/` directory. Do not use the game directory as `DataRoot`.

If the selected Python does not contain NumPy, install it into a private folder:

```powershell
$data = 'E:/ForgeData'
New-Item -ItemType Directory -Force "$data/cache/temp" | Out-Null
$env:TEMP = "$data/cache/temp"
$env:TMP = $env:TEMP
& 'E:/Tools/Python/python.exe' -m pip install `
  --target "$data/tools/python-packages" `
  --cache-dir "$data/cache/pip" `
  -r ./tools/requirements-prepare.txt
```

Preparation includes seven classes: Tactical (`Soldier`), Sniper, Heavy (`Support`), Assault (`Raider`), Bulwark (`Tank`), Vanguard (`Berserk`), and Techmarine (`Engineer`). Techmarine includes its servo-arm hoses with all original bone influences, using a second glTF joint/weight set when required. `Medic` does not yet have a complete game-catalogue binding. Keep prepared resources out of Git.

Main outputs:

- `assets/characters/SM2-retail-constructors/source-v5/manifest.json` and model files beside it;
- `production/roster/armor-options.json`;
- two walk clips and two run clips under `assets/animations/`;
- private upstream sources, caches, and provenance under `tools/sm2-extractor/`.

**Left bionic arms (v0.4.0).** After preparing the seven V5 constructors, run the independent additional-resource generator:

```powershell
& 'E:/Tools/Python/python.exe' ./tools/prepare_left_bionics.py --data-root 'E:/ForgeData'
```

It creates `assets/characters/SM2-left-bionic/native-v1/manifest.json` and seven class-specific GLB files directly from that data folder's constructors and catalogue. It does not need prebuilt review models or change the originals. See [left bionic preparation](left-bionics.md#regenerate-from-local-v5-data) for staging and replacement options. The downloadable releases already include these additional resources.

All seven supported classes use the four verified shared preview clips described by `shared/motion-bindings.json`. The original game animation files remain unchanged. The preview preserves 83 listed fixed facial controls in the target bind pose, so heads retain their proportions while inheriting animated HEAD movement. This does not reproduce the full native game controller, foot IK, or secondary physics.

Each generated model is checked against source weights for every vertex, vertex-to-triangle assignments, and skeleton matrices. Original UVs are restored after protection against incorrect vertex welding. Existing models are not silently replaced: use a new results folder for another source version.

`-BuildOnly` checks compilation without producing a full resource set. `-SkipModels` updates the local catalogue without re-exporting models. `-SkipMotion` omits animation preparation. These modes alone do not produce a complete set of resources.

Pinned upstream revisions:

- IndexV2: `28a0ce0f857b650ae5ad9f15cd1052a36b7cbe01`;
- LibSaber: `1311ab287add95771fefd51001836dcfd958ba1c`;
- StirlingLabs.Assimp.Net: `23.4.1`; native win-x64: `5.2.5.4`; YamlDotNet: `16.1.2`.

IndexV2/LibSaber sources and compiled parser DLLs are not shipped in this repository. Preparation obtains them directly on your computer. Three small helper files are generated locally from the pinned upstream revision with functional changes. Third-party projects retain their own terms; the application licence does not cover them. Assimp.Net includes MIT/BSD notices, native Assimp uses BSD-3-Clause, and YamlDotNet uses MIT. See [third-party notices](../THIRD_PARTY_NOTICES.md).

**Upgrading existing prepared resources.** Keep your data folder and saved recipes. Run the preparation command again with `-Assets cc_sm_constructor_engineer` to add Techmarine; the other constructors do not need to be extracted again. Use the updated application for eight-influence browser skinning. See [Techmarine support](techmarine.md) for scope and verification.
