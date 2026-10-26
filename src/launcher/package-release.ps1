[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ReleaseDirectory,
    [Parameter(Mandatory=$true)][string]$ZipPath
)
$ErrorActionPreference='Stop'
$releaseRoot=[IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($ReleaseDirectory))
$archivePath=[IO.Path]::GetFullPath($ZipPath)
if (-not (Test-Path -LiteralPath $releaseRoot -PathType Container)) { throw 'Release folder does not exist.' }
if (Test-Path -LiteralPath $archivePath) { throw 'Archive already exists; use a new destination.' }
if (Test-Path -LiteralPath (Join-Path $releaseRoot 'forge.config.json')) { throw 'Private configuration is present. Package a fresh release folder.' }
$allowedFolders=@('app','shared','tools','docs','scripts','licenses','examples','runtime')
$privateFolders=@('state','cache','data','.build','tests','__pycache__','node_modules','bin','obj')
$allowedTop=@('.dll','.exe','.json','.md','.txt')
function Is-Private([string]$Relative) {
    $parts=$Relative -split '[\\/]'
    if (@($parts|Where-Object { $_ -in $privateFolders }).Count) { return $true }
    $leaf=$parts[-1]
    return $leaf -in @('forge.config.json','draft-roster.json','selected-roster.json','settings.json','job.json') -or
        $leaf -match '(?i)\.(?:pak|tpl|tpl_data|sani|sani_data|sso|nmb|glb|gltf|blend|blend1|dds|pyc|pyo|log)$' -or
        $leaf -match '(?i)\.(?:animation|ihf)\.json$' -or
        $leaf -match '(?i)^(?:LibSaber|Index|Assimp|StirlingLabs|YamlDotNet).*\.(?:dll|exe)$'
}
$files=@(Get-ChildItem -LiteralPath $releaseRoot -File -Force|Where-Object { $_.Extension -in $allowedTop -or $_.Name -eq 'LICENSE' })
foreach ($folder in $allowedFolders) {
    $directory=Join-Path $releaseRoot $folder
    if (Test-Path -LiteralPath $directory -PathType Container) { $files+=@(Get-ChildItem -LiteralPath $directory -File -Recurse -Force) }
}
$included=[Collections.Generic.List[object]]::new();$excluded=[Collections.Generic.List[string]]::new()
foreach ($file in $files|Sort-Object FullName -Unique) {
    $relative=[IO.Path]::GetRelativePath($releaseRoot,$file.FullName).Replace('\','/')
    if ($relative.StartsWith('../') -or [IO.Path]::IsPathRooted($relative)) { throw 'Archive path escaped the release folder.' }
    if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Do not package linked files: $relative" }
    if (Is-Private $relative) { $excluded.Add($relative);continue }
    $included.Add([ordered]@{file=$file.FullName;relative=$relative;bytes=$file.Length})
}
foreach ($required in @('IronHandsForge.exe','IronHandsForge.dll','coreclr.dll','hostfxr.dll','hostpolicy.dll','System.Private.CoreLib.dll','runtime/node.exe','app/server.cjs','shared/motion-bindings.json','shared/ui-labels.mjs','shared/eight-influence-skinning.mjs','LICENSE','THIRD_PARTY_NOTICES.md','licenses/Node.LICENSE.txt','licenses/Three.LICENSE.txt','licenses/DotNetRuntime.LICENSE.txt','licenses/DotNetRuntime.THIRD-PARTY-NOTICES.txt','docs/build-codes.md','examples/tactical-build.json')) {
    if ($required -notin $included.relative) { throw "Release file is missing: $required" }
}
$prefix=(Split-Path -Leaf $releaseRoot)+'/'
$stream=[IO.File]::Open($archivePath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try {
    $archive=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create,$true)
    try { foreach ($item in $included) { [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$item.file,$prefix+$item.relative,[IO.Compression.CompressionLevel]::Optimal) } }
    finally { $archive.Dispose() }
}
finally { $stream.Dispose() }
$verify=[IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    if ($verify.Entries.Count -ne $included.Count) { throw 'ZIP entry count does not match its selected files.' }
    foreach ($entry in $verify.Entries) { if (-not $entry.FullName.StartsWith($prefix) -or (Is-Private $entry.FullName.Substring($prefix.Length))) { throw "Unexpected ZIP entry: $($entry.FullName)" } }
}
finally { $verify.Dispose() }
$sha=(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
($sha+'  '+(Split-Path -Leaf $archivePath))|Set-Content -LiteralPath ($archivePath+'.sha256') -Encoding utf8
[long]$uncompressedBytes=0
foreach ($item in $included) { $uncompressedBytes += [long]$item.bytes }
$report=[ordered]@{passed=$true;archive=$archivePath;sha256=$sha;zipBytes=(Get-Item -LiteralPath $archivePath).Length;files=$included.Count;uncompressedBytes=$uncompressedBytes;rootFolder=$prefix;excluded=$excluded.ToArray();userStateAndGameResourcesIncluded=$false;createdAt=[DateTimeOffset]::UtcNow.ToString('O')}
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$reportRoot=Join-Path $projectRoot '.build'
[void][IO.Directory]::CreateDirectory($reportRoot)
$report|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $reportRoot 'release-packaging-report.json') -Encoding utf8
$report|ConvertTo-Json -Depth 5
