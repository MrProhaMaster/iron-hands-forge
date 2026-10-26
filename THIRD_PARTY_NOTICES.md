**Iron Hands Forge third-party components**

The [project MIT licence](LICENSE), copyright 2026 MrProhaMaster, applies to Iron Hands Forge's own code. It does not change the rights covering the components below, Space Marine 2, or extracted game resources.

| Component | Use | Terms |
| --- | --- | --- |
| Three.js 0.186.1 | Local 3D viewer; MIT, copyright Three.js authors | [Three.LICENSE.txt](licenses/Three.LICENSE.txt); vendoring also creates `app/web/vendor/LICENSE` |
| Node.js 24.19.0 | Windows folder distribution: `runtime/node.exe` | [Node.LICENSE.txt](licenses/Node.LICENSE.txt), including bundled dependency notices |
| .NET Runtime 8.0.32 | Self-contained Windows launcher; MIT and third-party terms | [DotNetRuntime.LICENSE.txt](licenses/DotNetRuntime.LICENSE.txt), [THIRD-PARTY-NOTICES](licenses/DotNetRuntime.THIRD-PARTY-NOTICES.txt) |
| .NET SDK 8.0.426 | Separate launcher-build and local-preparation tool; the SDK is not included in the EXE package | [DotNetSDK.LICENSE.txt](licenses/DotNetSDK.LICENSE.txt), [ThirdPartyNotices](licenses/DotNetSDK.ThirdPartyNotices.txt) |

The Node.js LICENSE is copied unchanged from the [official v24.19.0 tag](https://github.com/nodejs/node/blob/v24.19.0/LICENSE). The local executable version was checked with `--version`. `IronHandsForge.runtimeconfig.json` identifies .NET Runtime 8.0.32; its licence and notices were copied from `Microsoft.NETCore.App.Runtime.win-x64/8.0.32`, restored by SDK 8.0.426. SDK licence/notices came from that local SDK distribution. The Three.js LICENSE was copied from the package verified by SHA-512 in `scripts/vendor-three.mjs`.

**Local-preparation dependencies**

`scripts/prepare-data.ps1` obtains [IndexV2](https://github.com/Wildenhaus/IndexV2) and [LibSaber](https://github.com/Wildenhaus/LibSaber) sources in the user's private data folder. Pinned revisions and dependencies are listed in [docs/local-preparation.md](docs/local-preparation.md). Their source files, modified helper files, and compiled parser DLLs are not included in this repository or the portable application.

The checked upstream checkouts contain no LICENSE file. Iron Hands Forge's MIT licence does not grant rights to their code; obtain applicable use/distribution terms from their respective authors. Assimp.Net, native Assimp, and YamlDotNet obtained through NuGet retain their own licences and notices. Python, NumPy, and Git are installed separately and are not bundled with Iron Hands Forge.

**Game resources**

The application distribution includes a prepared armour library containing models, catalogues, and animation clips derived from Space Marine 2. These prepared resources are separate from the public Git source and retain their original rights; they are not covered by the project MIT licence. Raw game archives and extractor binaries are not included. IHF1 codes contain selections and colours, not model data. Rights to Warhammer 40,000, Space Marine 2, and related game materials remain with their respective rights holders.
