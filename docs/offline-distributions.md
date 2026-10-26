# Offline distributions

The release archive contains everything required to customise the seven supported armour classes, preview shared walk/run clips, exchange IHF1 codes, and prepare GLB files. Extract the complete archive and start the launcher. An installed game, SDK, Python, and Internet connection are not needed for those features.

The included `data/` library contains 1,728 catalogue options, seven validated constructor models and their metadata, the paint catalogue, and four shared movement clips. These are the same preview materials and motion policies used by Forge 0.2.0. This packaging update does not claim to reconstruct game PBR shaders or secondary physics.

## Resource selection

The launcher and direct Node server resolve relative library paths from the application folder. An explicit `--data-root` takes precedence. A valid custom library selected in **Resources** remains usable; an unavailable saved path falls back to `data/`. **Use included armour** restores the bundled library. Missing models or movement clips are reported as incomplete resources rather than a successful ready state.

Personal recipes, squads, settings, caches, and build outputs are stored separately from the included library. Moving the complete application folder preserves access to its bundled resources.

## Building and verifying the library

The source repository does not carry the generated payload. On a developer computer with prepared resources, run:

```powershell
node scripts/bundle-resources.mjs --data-root E:/ForgeData --out E:/Staging/Forge/data
node scripts/bundle-resources.mjs --verify E:/Staging/Forge/data
```

The builder selects the supported classes and their required runtime files, preserves model bytes, removes absolute machine paths from JSON metadata, and writes `bundle-manifest.json` with relative file paths, sizes, and SHA-256 hashes. Verification rejects missing, modified, extra, or linked files. Raw game archives, extraction tools, private state, and unrelated models are excluded.

The Windows builder accepts `-DataRoot` and creates this library inside its output folder. The release packager verifies it and includes only the declared payload. It continues to exclude personal configuration and saved rosters.

## Release checks

Run the unit suites, then `src/launcher/distribution-qa.ps1 -DistributionDirectory PATH` without `-DataRoot`. This starts the packaged EXE from an unrelated working directory and requires the included data, all seven models, and all 28 class/motion/grip combinations. Release acceptance also checks the actual extracted ZIP, browser operation with non-loopback requests blocked, armour and colour changes, a GLB build, relocation, and recovery from an unavailable saved library.
