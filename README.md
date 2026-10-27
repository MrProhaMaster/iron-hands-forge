**Iron Hands Forge** is an offline Space Marine 2 armour configurator that transfers selected characters into Blender.

**Windows x64 launch.** Download the ZIP from [Releases](https://github.com/MrProhaMaster/iron-hands-forge/releases), extract the whole folder, and run `IronHandsForge.exe`. Keep `app/`, `data/`, `runtime/`, `shared/`, `tools/`, and the .NET files beside it. The EXE needs the complete folder. It opens your browser; leave the launcher window open. Ctrl+C or closing that window stops its server. Node.js and the .NET Runtime are bundled.

**Linux x64 launch.** Extract the separate Linux `.tar.gz` and run `./IronHandsForge` (or `./IronHandsForge.sh`). The native Linux Node.js runtime and the same complete armour library are included. Wine, .NET, system Node.js, and an installed game are not needed. A desktop browser is required. Settings and builds use XDG user directories. See [Linux launch, Blender transfer and packaging](docs/linux.md).

**Ready on first launch.** The release includes the complete armour library for all seven supported classes, the paint catalogue, and the four shared walk/run clips. No installed game, resource preparation, Internet connection, Python, or SDK is needed to customise armour or prepare a GLB. Extract the whole ZIP before starting; do not run the EXE from inside the archive.

**Resources** is an optional setting for a different prepared library. **Use included armour** restores the packaged library. An unavailable saved library falls back to the included data automatically. Explicit `--data-root` paths remain authoritative and report missing resources rather than silently using another library. Developers can still prepare custom resources with [local preparation](docs/local-preparation.md).

**Select and share.** Supported classes are Tactical, Assault, Vanguard, Bulwark, Heavy, Sniper, and Techmarine. Choose a character, class, armour parts, and colours. All seven classes support four verified shared game walk/run clips: unarmed and rifle-grip poses, at 0.5–2× speed. These are compatible previews on the original skeletons; the full game controller, IK, and secondary physics are not reproduced. Fixed facial channels retain the selected head's original proportions. Materials currently provide preview colours; game PBR materials and emblems need separate work.

**Bionic left arm — v0.4.0.** Open **Left gauntlet** and choose **Bionic left arm**. Each of the seven classes uses its own mirrored native arm, bound to that class's existing left-side skeleton. The choice is saved with the marine, IHF1 code and JSON recipe, and carried into GLB and Blender exports. Packaged builds include the seven-class library for offline use through the shared Windows/Linux resource pipeline. See [left bionic arms and local regeneration](docs/left-bionics.md).

Select **Share build** to open **Transfer build**:

1. Generate **Soldier code** or **Squad code**, then select **Copy**.
2. On another computer, paste the complete `IHF1.…` code and select **Import**.
3. **Save JSON** writes a recipe to `state/exports/`. **Prepare GLB** creates models and a report in `state/builds/`.

A code stores class, slot, and option IDs, colours, and supported motion. It contains no game models or local raw ObjectIDs. CRC32 detects accidental corruption. The receiving copy uses its included library; custom parts still require a compatible custom catalogue, and unavailable parts produce an error. A recipe can contain one character or a squad of up to 20. In the JSON format, `motion` is optional: omitting it exports a static model. The interface includes the selected motion for all seven supported classes. See [build codes and recipe examples](docs/build-codes.md) for the format and complete workflows.

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

Open the [local application](http://127.0.0.1:8767). For source development, prepare a data library and pass `--data-root` to the server, or place a verified bundle in `data/`. The downloadable application already includes it.

To build the Windows folder distribution, use .NET SDK 8 and a local Node.js executable:

```powershell
./scripts/build-windows.ps1 `
  -DotnetExe 'E:/Tools/dotnet/dotnet.exe' `
  -NodeExe 'E:/Tools/node/node.exe' `
  -DataRoot 'E:/ForgeData'
```

The output is `dist/IronHandsForge-win-x64/`. The builder selects and copies only the seven-class runtime data, strips machine-specific paths, and creates a SHA-256 resource manifest. `src/launcher/package-release.ps1` verifies the complete bundle before creating the ZIP. User state, private configuration, raw game archives, and extraction tools are excluded. Use a new output folder for each release. See [offline distributions](docs/offline-distributions.md).

**Validation.** Tests live in the source repository; the Windows ZIP omits test suites and private acceptance data. These results belong to separate checks:

- Node.js: 36 tests, including eight-influence loader, shader and CPU regression checks.
- Python: 30 tests covering recipes, catalogues, motion and extended source profiles.
- Source review: 10 mandatory tests, plus 2 optional checks when the local extractor/core is available.
- 9 source constructors and 33.07 million vertices checked; 7 supported classes. The Techmarine upgrade preserves the other eight constructors.
- Blender: 9 import checks, including preservation of scene objects and FPS, plus 2 additional non-Tactical import checks.
- Techmarine: 569 source meshes / 3,774,248 vertices; both servo-arm variants checked across four loops. Three IHF1 code-to-Blender save/reopen checks passed, including 2x motion and a deliberate fifth-bone stress test. See [Techmarine support](docs/techmarine.md).
- Windows launcher: 7 groups covering startup, data paths, instance reuse, and shutdown of its own server.
- Motion: 24 class/clip combinations in default armour, plus 24 bare-headed combinations with preserved facial binds. Every frame, skin weights, limb lengths, and loop continuity were checked.
- Left bionics: seven native-left bindings checked through all four existing preview clips, covering 952 source frames. Original body matrices, mirrored geometry attributes and numerical weights are preserved.

Prepared armour models, catalogues, animation clips, and runtimes are included in the downloadable distribution through Releases, rather than Git source history. The original raw game archives, extractor binaries, personal rosters, and machine paths are not distributed. `state/`, `.build/`, `data/`, `runtime/`, `dist/`, and `forge.config.json` remain Git-ignored. Do not force-add private files or generated payloads to Git.

The project's own code uses the MIT licence. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party components and game-resource scope, and [licenses/](licenses/) for full texts.
