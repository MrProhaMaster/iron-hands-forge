param(
 [Parameter(Mandatory=$true)][string]$Recipe,
 [Parameter(Mandatory=$true)][string]$DataRoot,
 [Parameter(Mandatory=$true)][string]$Out,
 [string]$BlenderExe,
 [string]$NodeExe
)
$ErrorActionPreference='Stop'
$forgeRoot=Split-Path $PSScriptRoot -Parent
$forgeOutput=[System.IO.Path]::GetFullPath($Out)
$forgeCache=Join-Path (Split-Path $forgeOutput -Parent) '.forge-cache'
New-Item -ItemType Directory -Path $forgeCache -Force | Out-Null
foreach($forgeKey in @('TEMP','TMP','APPDATA','LOCALAPPDATA','BLENDER_USER_CONFIG','BLENDER_USER_SCRIPTS','BLENDER_USER_DATAFILES','CUDA_CACHE_PATH')){[Environment]::SetEnvironmentVariable($forgeKey,(Join-Path $forgeCache $forgeKey),'Process');New-Item -ItemType Directory -Path (Join-Path $forgeCache $forgeKey) -Force|Out-Null}
$env:PYTHONDONTWRITEBYTECODE='1'
$env:NODE_DISABLE_COMPILE_CACHE='1'
if(-not $BlenderExe){$forgeCandidate=Join-Path $DataRoot 'tools\blender\blender.exe';if(Test-Path -LiteralPath $forgeCandidate){$BlenderExe=$forgeCandidate}else{$forgeFound=Get-Command blender -ErrorAction SilentlyContinue;if($forgeFound){$BlenderExe=$forgeFound.Source}else{throw 'Укажи -BlenderExe с полным путём к Blender.'}}}
if(-not $NodeExe){$NodeExe=Join-Path $forgeRoot 'runtime\node.exe'}
& $BlenderExe --background --factory-startup --python (Join-Path $forgeRoot 'tools\import_recipe_blender.py') '--' --recipe ([System.IO.Path]::GetFullPath($Recipe)) --data-root ([System.IO.Path]::GetFullPath($DataRoot)) --out $forgeOutput --node $NodeExe
if($LASTEXITCODE -ne 0){throw 'Blender не смог импортировать рецепт; подробности находятся выше.'}