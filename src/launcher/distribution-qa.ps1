[CmdletBinding()]
param(
    [string]$DistributionDirectory,
    [Parameter(Mandatory=$true)][string]$DataRoot,
    [ValidateRange(0,65535)][int]$Port=0
)
$ErrorActionPreference = 'Stop'
$productRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if (-not $DistributionDirectory) { $DistributionDirectory = Join-Path $productRoot 'dist/IronHandsForge-win-x64' }
$DistributionDirectory = [IO.Path]::GetFullPath($DistributionDirectory)
$DataRoot = [IO.Path]::GetFullPath($DataRoot)
$qaRoot = Join-Path $productRoot ('.build/distribution-qa-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
[void][IO.Directory]::CreateDirectory($qaRoot)
$state = Join-Path $qaRoot 'state'
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$Port)
$listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
$start = [Diagnostics.ProcessStartInfo]::new((Join-Path $DistributionDirectory 'IronHandsForge.exe'))
$start.WorkingDirectory=$DistributionDirectory; $start.UseShellExecute=$false
$start.CreateNoWindow=$true; $start.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
$start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
foreach ($argument in @('--no-browser','--data-root',$DataRoot,'--state-root',$state,'--port',"$port")) { $start.ArgumentList.Add($argument) }
$process = [Diagnostics.Process]::Start($start)
try {
    $base = "http://127.0.0.1:$port"
    $deadline = [DateTime]::UtcNow.AddSeconds(25)
    $health = $null
    do {
        try { $health = Invoke-RestMethod -Uri "$base/api/health" -TimeoutSec 1 } catch { }
        if (-not $health) { Start-Sleep -Milliseconds 150 }
    } while (-not $health -and -not $process.HasExited -and [DateTime]::UtcNow -lt $deadline)
    if (-not $health) { throw 'Published application did not become healthy.' }
    $package = Get-Content -LiteralPath (Join-Path $DistributionDirectory 'package.json') -Raw | ConvertFrom-Json
    if ($health.appId -ne 'iron-hands-forge' -or $health.version -ne $package.version -or $health.appRoot -ne $DistributionDirectory -or $health.dataRoot -ne $DataRoot -or $health.stateRoot -ne $state -or -not $health.ready) { throw 'Published application identity/root health check failed.' }
    $page = Invoke-WebRequest -Uri "$base/" -TimeoutSec 8
    if ($page.Content -notmatch '<html lang="en"' -or $page.Content -notmatch 'Share build') { throw 'Published interface is not the English version.' }
    $routes = @('/','/web/configurator.js','/web/forge-tools.js','/web/vendor/three.module.js','/web/vendor/addons/loaders/GLTFLoader.js','/web/vendor/addons/utils/SkeletonUtils.js','/shared/recipe-codec.mjs','/shared/motion-policy.mjs','/shared/ui-labels.mjs')
    foreach ($route in $routes) {
        $response = Invoke-WebRequest -Uri ($base+$route) -Method Head -TimeoutSec 8
        if ($response.StatusCode -ne 200) { throw "Published route failed: $route" }
    }
    $catalog = Invoke-RestMethod -Uri "$base/api/catalog" -TimeoutSec 15
    $motions = [Collections.Generic.List[object]]::new()
    if ($health.resourcesReady) {
        $motionClasses = @($catalog.motionBindings.classes.PSObject.Properties | Where-Object { $_.Value.status -eq 'validated' })
        if ($motionClasses.Count -ne 6) { throw 'Expected six verified movement classes in the published catalogue.' }
        foreach ($motionClass in $motionClasses) {
            $classId = $motionClass.Name
            foreach ($gait in @('walk','run')) {
                foreach ($style in @('unarmed','armed')) {
                    $motion = Invoke-RestMethod -Uri "$base/api/motion?classId=$classId&gait=$gait&style=$style" -TimeoutSec 8
                    if (-not $motion.channels.Count -or $motion.frameCount -lt 2 -or $motion.duration -le 0 -or $motion.binding.classId -ne $classId -or $motion.binding.asset -ne $motionClass.Value.asset) { throw "Invalid published motion: $classId/$gait/$style" }
                    if ($motion.binding.inheritedOnlyChannels.Count -ne 83) { throw 'Published facial bind preservation policy is incomplete.' }
                    $motions.Add([ordered]@{classId=$classId;gait=$gait;style=$style;fps=$motion.fps;frameCount=$motion.frameCount;duration=$motion.duration;channels=$motion.channels.Count;bindingPolicy=$motion.binding.bindingPolicy})
                }
            }
        }
    }
    foreach ($required in @('tools/build_from_recipe.mjs','tools/import_recipe_blender.py','scripts/prepare-data.ps1','README.md','LICENSE','THIRD_PARTY_NOTICES.md','licenses/Node.LICENSE.txt','licenses/Three.LICENSE.txt','licenses/DotNetRuntime.LICENSE.txt','licenses/DotNetRuntime.THIRD-PARTY-NOTICES.txt','docs/local-preparation.md','docs/build-codes.md','examples/tactical-build.json')) {
        if (-not (Test-Path -LiteralPath (Join-Path $DistributionDirectory $required))) { throw "Published application file is missing: $required" }
    }
    foreach ($requiredRuntime in @('coreclr.dll','hostfxr.dll','hostpolicy.dll','System.Private.CoreLib.dll','IronHandsForge.deps.json','IronHandsForge.runtimeconfig.json','runtime/node.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $DistributionDirectory $requiredRuntime))) { throw "Self-contained runtime file is missing: $requiredRuntime" }
    }
    $files = Get-ChildItem -LiteralPath $DistributionDirectory -Recurse -File | Where-Object { $_.FullName -notmatch '[\\/](state|cache)[\\/]' }
    [ordered]@{passed=$true;health=$health;routes=$routes;classes=$catalog.armor.classes.Count;assets=$catalog.manifest.assets.Count;motions=$motions.ToArray();fileCount=$files.Count;bytes=($files|Measure-Object Length -Sum).Sum;launcherSHA256=(Get-FileHash -LiteralPath (Join-Path $DistributionDirectory 'IronHandsForge.exe')).Hash;managedLauncherSHA256=(Get-FileHash -LiteralPath (Join-Path $DistributionDirectory 'IronHandsForge.dll')).Hash;at=[DateTimeOffset]::UtcNow.ToString('O')} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $qaRoot 'report.json') -Encoding utf8
    Write-Output "Distribution QA passed: $(Join-Path $qaRoot 'report.json')"
}
finally {
    if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
    $process.StandardOutput.ReadToEnd() | Set-Content -LiteralPath (Join-Path $qaRoot 'launcher.stdout.log') -Encoding utf8
    $process.StandardError.ReadToEnd() | Set-Content -LiteralPath (Join-Path $qaRoot 'launcher.stderr.log') -Encoding utf8
    $process.Dispose()
}
