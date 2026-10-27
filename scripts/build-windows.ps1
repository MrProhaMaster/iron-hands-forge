[CmdletBinding()]
param(
    [string]$DotnetExe,
    [string]$NodeExe,
    [string]$DataRoot,
    [string]$OutputDirectory,
    [switch]$IncludeLocalConfig
)

$ErrorActionPreference = 'Stop'
$productRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$projectFile = Join-Path $productRoot 'src/launcher/IronHandsForge.Launcher.csproj'
$nugetConfig = Join-Path $productRoot 'src/launcher/NuGet.Config'
$buildRoot = Join-Path $productRoot '.build'
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $productRoot 'dist/IronHandsForge-win-x64' }
$publishRoot = [IO.Path]::GetFullPath($OutputDirectory)

function Resolve-Tool([string]$ExplicitPath, [string[]]$Candidates, [string]$CommandName) {
    if ($ExplicitPath) {
        $toolPath = [IO.Path]::GetFullPath($ExplicitPath)
        if (-not (Test-Path -LiteralPath $toolPath -PathType Leaf)) { throw "Tool not found: $toolPath" }
        return $toolPath
    }
    foreach ($candidate in $Candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return [IO.Path]::GetFullPath($candidate) }
    }
    $command = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw "$CommandName was not found. Pass its executable path explicitly."
}

function Copy-DirectoryContents([string]$Source, [string]$Destination) {
    [void][IO.Directory]::CreateDirectory($Destination)
    foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
        if ($item.PSIsContainer) {
            if ($item.Name -eq '__pycache__') { continue }
            Copy-DirectoryContents $item.FullName (Join-Path $Destination $item.Name)
        }
        elseif ($item.Extension -notin @('.pyc', '.pyo')) {
            Copy-Item -LiteralPath $item.FullName -Destination $Destination -Force
        }
    }
}

$DotnetExe = Resolve-Tool $DotnetExe @((Join-Path $productRoot '../../tools/sm2-extractor/dotnet/dotnet.exe')) 'dotnet.exe'
$NodeExe = Resolve-Tool $NodeExe @((Join-Path $productRoot 'runtime/node.exe'), (Join-Path $productRoot '../../tools/node/node.exe')) 'node.exe'
if (-not $DataRoot) { throw 'Pass -DataRoot with a complete prepared library. Release builds include all seven classes for offline first launch.' }
$DataRoot = [IO.Path]::GetFullPath($DataRoot)
if (-not (Test-Path -LiteralPath $DataRoot -PathType Container)) { throw "Prepared resource folder not found: $DataRoot" }
foreach ($required in @($projectFile, $nugetConfig, (Join-Path $productRoot 'package.json'), (Join-Path $productRoot 'app/server.cjs'))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required application file is missing: $required" }
}

$buildEnvironment = @{
    DOTNET_ROOT = Split-Path -Parent $DotnetExe
    DOTNET_CLI_HOME = Join-Path $buildRoot 'dotnet-home'
    NUGET_PACKAGES = Join-Path $buildRoot 'nuget/packages'
    NUGET_HTTP_CACHE_PATH = Join-Path $buildRoot 'nuget/http'
    NUGET_PLUGINS_CACHE_PATH = Join-Path $buildRoot 'nuget/plugins'
    TEMP = Join-Path $buildRoot 'temp'
    TMP = Join-Path $buildRoot 'temp'
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
    DOTNET_CLI_TELEMETRY_OPTOUT = '1'
    DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
    DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE = '1'
    DOTNET_NOLOGO = '1'
    MSBUILDDISABLENODEREUSE = '1'
}
$previousEnvironment = @{}
foreach ($name in $buildEnvironment.Keys) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, $buildEnvironment[$name], 'Process')
}
foreach ($folder in @('dotnet-home', 'nuget/packages', 'nuget/http', 'nuget/plugins', 'temp')) {
    [void][IO.Directory]::CreateDirectory((Join-Path $buildRoot $folder))
}
[void][IO.Directory]::CreateDirectory($publishRoot)

try {
    & $NodeExe (Join-Path $productRoot 'scripts/vendor-three.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Verified local viewer dependencies could not be prepared.' }
    & $DotnetExe restore $projectFile --runtime win-x64 --configfile $nugetConfig --packages $buildEnvironment.NUGET_PACKAGES -p:SelfContained=true -p:NuGetAudit=false
    if ($LASTEXITCODE -ne 0) { throw "dotnet restore failed with exit code $LASTEXITCODE." }
    & $DotnetExe publish $projectFile --configuration Release --runtime win-x64 --self-contained true --no-restore --output $publishRoot -p:PublishSingleFile=false -p:UseAppHost=true -p:PublishReadyToRun=false -p:DebugType=None -p:DebugSymbols=false
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE." }

    foreach ($directory in @('app', 'shared', 'tools', 'docs', 'scripts', 'tests', 'licenses', 'examples')) {
        $directoryPath = Join-Path $productRoot $directory
        if (Test-Path -LiteralPath $directoryPath -PathType Container) {
            Copy-DirectoryContents $directoryPath (Join-Path $publishRoot $directory)
        }
    }
    foreach ($file in @('package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'THIRD-PARTY-NOTICES.md')) {
        $sourceFile = Join-Path $productRoot $file
        if (Test-Path -LiteralPath $sourceFile -PathType Leaf) { Copy-Item -LiteralPath $sourceFile -Destination (Join-Path $publishRoot $file) -Force }
    }
    $runtimeRoot = Join-Path $publishRoot 'runtime'
    [void][IO.Directory]::CreateDirectory($runtimeRoot)
    Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $runtimeRoot 'node.exe') -Force
    & $NodeExe (Join-Path $productRoot 'scripts/bundle-resources.mjs') --data-root $DataRoot --out (Join-Path $publishRoot 'data')
    if ($LASTEXITCODE -ne 0) { throw "Bundled resource preparation failed with exit code $LASTEXITCODE." }
    foreach ($license in @('LICENSE', 'LICENSE.txt')) {
        $licensePath = Join-Path (Split-Path -Parent $NodeExe) $license
        if (Test-Path -LiteralPath $licensePath -PathType Leaf) { Copy-Item -LiteralPath $licensePath -Destination (Join-Path $runtimeRoot ('NODE-' + $license)) -Force }
    }
    $localConfig = Join-Path $productRoot 'forge.config.json'
    $outputConfig = Join-Path $publishRoot 'forge.config.json'
    # Local machine paths should enter a portable distribution only by explicit request.
    if ($IncludeLocalConfig -and (Test-Path -LiteralPath $localConfig -PathType Leaf) -and -not (Test-Path -LiteralPath $outputConfig)) {
        Copy-Item -LiteralPath $localConfig -Destination $outputConfig
    }

    $package = Get-Content -LiteralPath (Join-Path $productRoot 'package.json') -Raw | ConvertFrom-Json
    $nodeVersion = (& $NodeExe --version | Out-String).Trim()
    [ordered]@{
        appId = 'iron-hands-forge'
        version = $package.version
        runtimeIdentifier = 'win-x64'
        selfContained = $true
        singleFile = $false
        nodeVersion = $nodeVersion
        resources = 'bundled-seven-class-offline-library'
        builtAt = [DateTimeOffset]::UtcNow.ToString('O')
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $publishRoot 'launcher-build.json') -Encoding utf8
    Write-Output "Portable application: $publishRoot"
    Write-Output "Start IronHandsForge.exe; keep the complete folder together."
}
finally {
    foreach ($name in $previousEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process') }
}
