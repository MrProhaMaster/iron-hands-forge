# Linux x64

Download a published `IronHandsForge-VERSION-linux-x64.tar.gz` from the Linux release, extract the complete archive, and run `./IronHandsForge` from its folder. Replace `VERSION` below with the version you downloaded. `./IronHandsForge.sh` is an equivalent entrypoint. A terminal stays open while the local application is running. Stop it with Ctrl+C. If your file manager does not run executables, open a terminal in the extracted folder.

```sh
tar -xzf IronHandsForge-VERSION-linux-x64.tar.gz
cd IronHandsForge-VERSION-linux-x64
./IronHandsForge
```

The archive includes a native Linux x64 Node.js runtime, Three.js, and the complete seven-class armour library. No Wine, .NET, system Node.js, Python, installed game, or additional resource download is needed to customise armour, use the shared motion previews, exchange IHF1 codes, or prepare GLB files. A desktop browser is required. The application listens on `127.0.0.1`; it does not expose the server on the network. This package targets standard glibc-based x86-64 desktop Linux, rather than Alpine/musl or ARM.

The v0.4.0 application and shared packaging pipeline support **Left gauntlet → Bionic left arm** for all seven classes. The choice is saved in IHF1/JSON recipes and retained in GLB and Blender transfers. A new Linux archive requires its own native Linux build and release checks; a successful Windows package does not establish Linux launch validation. See [left bionic arms](left-bionics.md) for the shared workflow.

The launcher opens your default browser with `xdg-open` or `gio open`. If neither command is available, open the printed `http://127.0.0.1:PORT/` address manually. `--no-browser` leaves browser opening to you:

```sh
./IronHandsForge --no-browser --port 8767
```

It first looks for an existing matching instance. A matching instance must use the same application folder, version, resource library and state folder. Otherwise it chooses a free port, trying the requested port followed by 8767–8777. Foreign services are left running. Startup is serialised with a kernel-owned abstract Unix socket; a crashed process cannot leave a stale lock file. SIGINT, SIGTERM and SIGHUP close this instance's server and its own model-build workers.

## Files and resource selection

The included `data/` folder is read from the application folder, independently of the current working directory. **Resources** can select an alternative prepared library; **Use included armour** restores the bundled data. An unavailable saved library falls back to the included library. An explicit `--data-root` remains authoritative and reports missing data instead of silently changing libraries.

User settings, squads, recipes, and GLB builds are stored in `$XDG_STATE_HOME/iron-hands-forge`, or `~/.local/state/iron-hands-forge` when the variable is unset. Cache and temporary data use `$XDG_CACHE_HOME/iron-hands-forge/INSTALL_ID`, or `~/.cache/iron-hands-forge/INSTALL_ID`. Relative XDG environment values are ignored. The launcher never reassigns `HOME`. These locations are separate from the included library, so replacing or moving the application folder does not replace your saved squad.

```sh
./IronHandsForge --state-root '/home/me/Forge state'
./IronHandsForge --data-root '/home/me/Custom Forge data'
./IronHandsForge --help
```

Relative command-line paths are resolved from the application folder. Keep the entire extracted directory together, including `runtime/node`. Normal extraction preserves its execute permission; if an archive tool removes permissions, restore them with `chmod +x IronHandsForge IronHandsForge.sh runtime/node`.

## Blender

Blender is installed separately. Import a generated GLB normally, or run the bundled recipe importer. It finds `runtime/node` in this Linux distribution without requiring system Node.js:

```sh
blender --background --python ./tools/import_recipe_blender.py -- \
  --recipe '/home/me/squad.ihf.json' --data-root "$PWD/data" \
  --out '/home/me/Scenes/squad.blend'
```

Choose a new output filename. Existing scene objects are preserved, and existing `.blend` files are not overwritten.

## Building the Linux archive

Build on Linux x64 with the pinned, official Node.js v24.19.0 Linux x64 binary. The Linux release workflow downloads the official runtime and verifies its archive against the official SHA-256 list. The source repository contains no generated model payload. Supply a prepared full data folder or the verified included `data/` folder from the Windows release:

```sh
node scripts/vendor-three.mjs
node scripts/build-linux.mjs \
  --data-root '/path/to/verified/data' \
  --node-binary '/path/to/node-v24.19.0-linux-x64/bin/node' \
  --out '/path/to/dist/IronHandsForge-0.4.0-linux-x64'
```

The builder verifies ELF architecture, exact Node version, resource inventory and checksums, and copies only runtime resources. It writes the distribution folder, `.tar.gz`, and `.tar.gz.sha256`. Entrypoints and `runtime/node` have mode 0755; data and code files use 0644. Windows .NET binaries, private configuration, user state, caches, raw game archives and extractor binaries are excluded. Choose a fresh output folder. The Windows ZIP and Linux archive are separate release assets; neither runs a background installer or downloads resources on first launch.

Run the Node tests before packaging. The native Linux release checks additionally extract the real archive, exercise the bundled runtime from another working directory, verify all seven classes and motion combinations, export GLB files, and check instance reuse, port conflicts, termination, relocation, and browser requests confined to localhost.
