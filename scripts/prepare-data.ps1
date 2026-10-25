[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$GameRoot,
  [Parameter(Mandatory=$true)][string]$DataRoot,
  [string]$DotNet='dotnet',
  [string]$Python='python',
  [string]$Git='git',
  [string]$UpstreamCacheRoot='',
  [string[]]$Assets=@('cc_sm_constructor_soldier','cc_sm_constructor_sniper','cc_sm_constructor_support','cc_sm_constructor_raider','cc_sm_constructor_tank','cc_sm_constructor_berserk'),
  [switch]$BuildOnly,
  [switch]$SkipModels,
  [switch]$SkipMotion
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$appRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$data=[IO.Path]::GetFullPath($DataRoot)
$game=[IO.Path]::GetFullPath($GameRoot)
function Is-Within([string]$Base,[string]$Candidate){
  $normalizedBase=[IO.Path]::GetFullPath($Base).TrimEnd([char[]]@('\','/'))
  $normalizedCandidate=[IO.Path]::GetFullPath($Candidate).TrimEnd([char[]]@('\','/'))
  return $normalizedCandidate.Equals($normalizedBase,[StringComparison]::OrdinalIgnoreCase) -or $normalizedCandidate.StartsWith($normalizedBase+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)
}
if(Is-Within $game $data){throw 'Choose a private data folder outside the installed game.'}
if((Is-Within $appRoot $data) -and -not(Is-Within (Join-Path $appRoot 'data') $data) -and -not(Is-Within (Join-Path $appRoot '.build') $data)){
  throw 'Inside the repository use an ignored data/ or .build/ folder, or choose an external private data folder.'
}
$paks=Join-Path $game 'client_pc/root/paks/client'
if(-not(Test-Path -LiteralPath (Join-Path $paks 'default/default_other.pak'))){throw 'The selected folder does not contain the installed Space Marine 2 client archives.'}
foreach($asset in $Assets){if($asset -notmatch '^cc_sm_constructor_[a-z0-9_]{1,64}$'){throw 'Invalid constructor ID.'}}
foreach($folder in @($data,(Join-Path $data 'cache/temp'),(Join-Path $data 'logs'),(Join-Path $data 'tools/sm2-extractor/src'))){[void](New-Item -ItemType Directory -Path $folder -Force)}
$toolRoot=Join-Path $data 'tools/sm2-extractor'
$env:TEMP=Join-Path $data 'cache/temp';$env:TMP=$env:TEMP
$env:DOTNET_CLI_HOME=Join-Path $toolRoot 'dotnet-home'
$env:NUGET_PACKAGES=Join-Path $toolRoot 'nuget'
$env:NUGET_HTTP_CACHE_PATH=Join-Path $toolRoot 'nuget-http'
$env:NUGET_PLUGINS_CACHE_PATH=Join-Path $toolRoot 'nuget-plugins'
$env:DOTNET_CLI_TELEMETRY_OPTOUT='1';$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE='1';$env:DOTNET_NOLOGO='1'
$env:PYTHONNOUSERSITE='1';$env:PYTHONDONTWRITEBYTECODE='1';$env:PYTHONPYCACHEPREFIX=Join-Path $data 'cache/python'
$env:PYTHONUSERBASE=Join-Path $data 'cache/python-user'
$privatePythonPackages=Join-Path $data 'tools/python-packages'
$env:PYTHONPATH=if($env:PYTHONPATH){$privatePythonPackages+[IO.Path]::PathSeparator+$env:PYTHONPATH}else{$privatePythonPackages}
$env:NODE_DISABLE_COMPILE_CACHE='1'
function Run-Checked([string]$Exe,[string[]]$Arguments){
  & $Exe @Arguments
  if($LASTEXITCODE -ne 0){throw "Command failed with exit code $LASTEXITCODE : $Exe"}
}
Run-Checked $Python @('-c','import sys,numpy; print(sys.version); print(numpy.__version__); sys.exit(0 if sys.version_info >= (3,11) else 2)')
$pins=@(
  @{Name='IndexV2';Url='https://github.com/Wildenhaus/IndexV2.git';Commit='28a0ce0f857b650ae5ad9f15cd1052a36b7cbe01'},
  @{Name='LibSaber';Url='https://github.com/Wildenhaus/LibSaber.git';Commit='1311ab287add95771fefd51001836dcfd958ba1c'}
)
foreach($pin in $pins){
  $checkout=Join-Path $toolRoot ('src/'+$pin.Name)
  if(-not(Test-Path -LiteralPath (Join-Path $checkout '.git'))){
    $cached=if($UpstreamCacheRoot){Join-Path $UpstreamCacheRoot $pin.Name}else{''}
    if($cached -and (Test-Path -LiteralPath (Join-Path $cached '.git'))){
      Run-Checked $Git @('clone','--no-hardlinks','--no-checkout',$cached,$checkout)
      Run-Checked $Git @('-C',$checkout,'checkout','--detach',$pin.Commit)
    }else{
      Run-Checked $Git @('init',$checkout)
      Run-Checked $Git @('-C',$checkout,'remote','add','origin',$pin.Url)
      Run-Checked $Git @('-C',$checkout,'fetch','--depth=1','origin',$pin.Commit)
      Run-Checked $Git @('-C',$checkout,'checkout','--detach','FETCH_HEAD')
    }
  }
  $actual=(& $Git -C $checkout rev-parse HEAD).Trim()
  if($LASTEXITCODE -ne 0 -or $actual -ne $pin.Commit){throw "Unexpected upstream revision in $checkout; use a clean private data folder."}
}
$generated=Join-Path $toolRoot 'app';[void](New-Item -ItemType Directory -Path $generated -Force)
Copy-Item -LiteralPath (Join-Path $appRoot 'tools/extractor/Program.cs') -Destination (Join-Path $generated 'Program.cs') -Force
Copy-Item -LiteralPath (Join-Path $appRoot 'tools/extractor/Sm2Extractor.csproj') -Destination (Join-Path $generated 'Sm2Extractor.csproj') -Force

# These small functional transforms operate only on sources fetched on this
# computer. No IndexV2/LibSaber source files or compiled parser are bundled here.
$indexProfile=Join-Path $toolRoot 'src/IndexV2/src/Profiles/Index.Profiles.SpaceMarine2'
$builder=[IO.File]::ReadAllText((Join-Path $indexProfile 'Meshes/MeshBuilder.cs')).TrimStart([char]0xFEFF)
$builder=$builder.Replace('using Microsoft.EntityFrameworkCore;','')
if(-not $builder.Contains('if ( boneObjectId == -1 )') -or -not $builder.Contains('var transform = invMatrix.ToAssimp();')){throw 'Pinned upstream helper shape changed.'}
$builder=$builder.Replace('if ( boneObjectId == -1 )','if ( boneObjectId < 0 || weight <= 0 || boneObjectId >= Graph.objects.Count )')
$builder=$builder.Replace('var transform = invMatrix.ToAssimp();','var transform = (Object.MatrixLT * invMatrix).ToAssimp();')
$method='private void AddVertexSkinningData( Vertex vertex )'
if(-not $builder.Contains($method)){throw 'Pinned upstream skin entry point changed.'}
$builder=[regex]::Replace($builder,'(private void AddVertexSkinningData\( Vertex vertex \)\s*\{)','$1'+[Environment]::NewLine+'      if (vertex.HasWeight5 || vertex.HasWeight6 || vertex.HasWeight7 || vertex.HasWeight8) throw new InvalidDataException("WEIGHT8 is not supported by the verified local preparation.");',1)
[IO.File]::WriteAllText((Join-Path $generated 'MeshBuilder.cs'),$builder)
$context=[IO.File]::ReadAllText((Join-Path $indexProfile 'Meshes/SceneContext.cs')).TrimStart([char]0xFEFF).Replace('using HelixToolkit.SharpDX.Core;','')
[IO.File]::WriteAllText((Join-Path $generated 'SceneContext.cs'),$context)
Copy-Item -LiteralPath (Join-Path $indexProfile 'Common/AssimpHelper.cs') -Destination (Join-Path $generated 'AssimpHelper.cs') -Force
$libraryProject=Join-Path $toolRoot 'src/LibSaber/src/LibSaber.SpaceMarine2/LibSaber.SpaceMarine2.csproj'
[xml]$project=[IO.File]::ReadAllText($libraryProject)
foreach($node in @($project.SelectNodes("//PackageReference[@Include='ILRepack.MSBuild.Task'] | //Target[@Name='ILRepack']"))){[void]$node.ParentNode.RemoveChild($node)}
foreach($node in @($project.SelectNodes("//PackageReference[@Include='YamlDotNet']"))){$node.SetAttribute('Version','[16.1.2]')}
$project.Save($libraryProject)
[IO.File]::WriteAllText((Join-Path $toolRoot 'global.json'),' {"sdk":{"version":"8.0.426","rollForward":"disable","allowPrerelease":false}}')
$bin=Join-Path $toolRoot 'bin'
Push-Location $generated
try{Run-Checked $DotNet @('build','Sm2Extractor.csproj','-c','Release','-o',$bin,'--nologo','-v','quiet','/clp:ErrorsOnly')}
finally{Pop-Location}
$provenance=@{schema='iron-hands-forge-local-prepare-v1';sdk='8.0.426';upstream=$pins;helperSources='Fetched and transformed locally; not redistributed in the app';assets=$Assets;gameRoot=$game;dataRoot=$data}
$provenance | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $toolRoot 'prepare-provenance.json') -Encoding utf8
if($BuildOnly){Write-Output 'BUILD_READY';exit 0}
$native=Join-Path $data 'assets/characters/SM2-retail-constructors/source-native-v5'
$published=Join-Path $data 'assets/characters/SM2-retail-constructors/source-v5'
$gameBuild='unknown'
$steamManifest=Join-Path ([IO.Directory]::GetParent([IO.Directory]::GetParent($game).FullName).FullName) 'appmanifest_2183900.acf'
if(Test-Path -LiteralPath $steamManifest){$match=[regex]::Match([IO.File]::ReadAllText($steamManifest),'"buildid"\s+"(\d+)"');if($match.Success){$gameBuild=$match.Groups[1].Value}}
if(-not $SkipModels){
  foreach($asset in $Assets){
    $out=Join-Path $native $asset
    $metaFile=Join-Path $out ($asset+'.json')
    $ready=$false
    if(Test-Path -LiteralPath $metaFile){try{$meta=Get-Content -Raw -LiteralPath $metaFile | ConvertFrom-Json;$ready=$meta.extractorVersion -eq '5.0-skin-safe-three-weight' -and (Test-Path -LiteralPath (Join-Path $out ($asset+'.glb')))}catch{$ready=$false}}
    if(-not $ready){Run-Checked $DotNet @((Join-Path $bin 'Sm2Extractor.dll'),'--game',$game,'--data-root',$data,'--out',$out,'--asset',$asset)}
    Run-Checked $Python @((Join-Path $appRoot 'tools/canonicalize_local.py'),'--data-root',$data,'--native-root',$native,'--output-root',$published,'--asset',$asset,'--game-build',$gameBuild)
  }
}
Run-Checked $Python @((Join-Path $appRoot 'tools/prepare_catalog.py'),'--game',$game,'--data-root',$data,'--inventory-root',$published)
if(-not $SkipMotion){Run-Checked $Python @((Join-Path $appRoot 'tools/prepare_motion.py'),'--game',$game,'--data-root',$data)}
Write-Output ('DATA_READY '+$data)
