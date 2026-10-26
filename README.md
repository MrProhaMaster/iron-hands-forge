**Iron Hands Forge** is a local Space Marine 2 armour configurator that transfers selected characters into Blender.

**Windows x64 launch.** Download the ZIP from [Releases](https://github.com/MrProhaMaster/iron-hands-forge/releases), extract the whole folder, and run `IronHandsForge.exe`. Keep `app/`, `runtime/`, `shared/`, `tools/`, and the .NET files beside it. The EXE needs the complete folder. It opens your browser; leave the launcher window open. Ctrl+C or closing that window stops its server. Node.js and the .NET Runtime are bundled.

On first launch, connect your private prepared-data folder through **Local resources**. Create that folder from your installed game with `scripts/prepare-data.ps1`; preparation leaves the game directory unchanged. The tested preparation environment uses PowerShell 5.1+, Git, .NET SDK 8.0.426, Python 3.13, and NumPy 2.3.4. See [local preparation](docs/local-preparation.md) for commands and requirements. Viewing already prepared data does not require Python or the SDK.

**Select and share.** Supported classes are Tactical, Assault, Vanguard, Bulwark, Heavy, Sniper, and Techmarine. Choose a character, class, armour parts, and colours. All seven classes support four verified shared game walk/run clips: unarmed and rifle-grip poses, at 0.5–2× speed. These are compatible previews on the original skeletons; the full game controller, IK, and secondary physics are not reproduced. Fixed facial channels retain the selected head's original proportions. Materials currently provide preview colours; game PBR materials and emblems need separate work.

Select **Share build** to open **Transfer build**:

1. Generate **Soldier code** or **Squad code**, then select **Copy**.
2. On another computer, paste the complete `IHF1.…` code and select **Import**.
3. **Save JSON** writes a recipe to `state/exports/`. **Prepare GLB** creates models and a report in `state/builds/`.

A code stores class, slot, and option IDs, colours, and supported motion. It contains no game models or local raw ObjectIDs. CRC32 detects accidental corruption. The receiving computer needs compatible prepared resources; unavailable parts produce an error. A recipe can contain one character or a squad of up to 20. In the JSON format, `motion` is optional: omitting it exports a static model. The interface includes the selected motion for all seven supported classes. See [build codes and recipe examples](docs/build-codes.md) for the format and complete workflows.

**Blender.** Import a generated GLB normally, or transfer a recipe with `tools/import_recipe_blender.py`. Replace the example paths with your own:

```powershell
& 'C:/Tools/Blender/blender.exe' 'E:/Scenes/base.blend' --background `
  --python ./tools/import_recipe_blender.py -- `
  --recipe 'E:/ForgeRecipes/squad.ihf.json' `
  --data-root 'E:/ForgeData' --out 'E:/Scenes/squad.blend'
```

Use `--code 'IHF1.…'` instead of `--recipe` to pass a code directly. The script adds a separate collection, preserves existing scene objects and FPS, and saves a new `.blend` plus an import report. Choose a new output filename; existing files are not overwritten.

**Run from source.** Install Node.js 22+, then run these commands from the repository root:

```powershell
node scripts/vendor-three.mjs
node app/server.cjs
```

Open the [local application](http://127.0.0.1:8767). Connect the data folder in the interface or pass `--data-root` to the server.

To build the Windows folder distribution, use .NET SDK 8 and a local Node.js executable:

```powershell
./scripts/build-windows.ps1 `
  -DotnetExe 'E:/Tools/dotnet/dotnet.exe' `
  -NodeExe 'E:/Tools/node/node.exe'
```

The output is `dist/IronHandsForge-win-x64/`. Local configuration can be included explicitly with `-IncludeLocalConfig`; use clean staging when preparing a public release.

**Validation.** Tests live in the source repository; the Windows ZIP omits test suites and private acceptance data. These results belong to separate checks:

- Node.js: 36 tests, including eight-influence loader, shader and CPU regression checks.
- Python: 30 tests covering recipes, catalogues, motion and extended source profiles.
- Source review: 10 mandatory tests, plus 2 optional checks when the local extractor/core is available.
- 9 source constructors and 33.07 million vertices checked; 7 supported classes. The Techmarine upgrade preserves the other eight constructors.
- Blender: 9 import checks, including preservation of scene objects and FPS, plus 2 additional non-Tactical import checks.
- Techmarine: 569 source meshes / 3,774,248 vertices; both servo-arm variants checked across four loops. Three IHF1 code-to-Blender save/reopen checks passed, including 2x motion and a deliberate fifth-bone stress test. See [Techmarine support](docs/techmarine.md).
- Windows launcher: 7 groups covering startup, data paths, instance reuse, and shutdown of its own server.
- Motion: 24 class/clip combinations in default armour, plus 24 bare-headed combinations with preserved facial binds. Every frame, skin weights, limb lengths, and loop continuity were checked.

Game models, textures, animations, prepared catalogues, and binaries are not stored in this repository. Windows executables are distributed separately through Releases. Private `state/`, `.build/`, `data/`, `runtime/`, `dist/`, and `forge.config.json` are Git-ignored. Do not force-add private files or extracted game resources.

The project's own code uses the MIT licence. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party components and game-resource scope, and [licenses/](licenses/) for full texts.
