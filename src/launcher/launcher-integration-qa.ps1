[CmdletBinding()]
param([string]$DistributionDirectory)
$ErrorActionPreference = 'Stop'
$productRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if (-not $DistributionDirectory) { $DistributionDirectory = Join-Path $productRoot 'dist/IronHandsForge-win-x64' }
$fixtureRoot = Join-Path $productRoot ('.build/launcher-qa-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
[void][IO.Directory]::CreateDirectory($fixtureRoot)
foreach ($file in Get-ChildItem -LiteralPath $DistributionDirectory -File | Where-Object Name -ne 'forge.config.json') {
    New-Item -ItemType HardLink -Path (Join-Path $fixtureRoot $file.Name) -Target $file.FullName | Out-Null
}
[void][IO.Directory]::CreateDirectory((Join-Path $fixtureRoot 'runtime'))
[void][IO.Directory]::CreateDirectory((Join-Path $fixtureRoot 'app'))
New-Item -ItemType HardLink -Path (Join-Path $fixtureRoot 'runtime/node.exe') -Target (Join-Path $DistributionDirectory 'runtime/node.exe') | Out-Null
@'
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const args = process.argv.slice(2);
const val = (name, def) => { const i=args.indexOf(name); return i<0?def:args[i+1]; };
const root = path.resolve(__dirname, '..');
const port = Number(val('--port', 8767));
const info = {appId:val('--app-id','iron-hands-forge'),version:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,appRoot:root,
 dataRoot:val('--data-root',path.join(root,'data')),stateRoot:val('--state-root',path.join(root,'state')),
 port,ready:true,resourcesReady:true,pid:process.pid,
 environment:{TEMP:process.env.TEMP,TMP:process.env.TMP,NODE_COMPILE_CACHE:process.env.NODE_COMPILE_CACHE,NODE_DISABLE_COMPILE_CACHE:process.env.NODE_DISABLE_COMPILE_CACHE}};
http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(info));}).listen(port,'127.0.0.1');
'@ | Set-Content -LiteralPath (Join-Path $fixtureRoot 'app/server.cjs') -Encoding utf8
$launcher = Join-Path $fixtureRoot 'IronHandsForge.exe'
$node = Join-Path $fixtureRoot 'runtime/node.exe'
$state = Join-Path $fixtureRoot 'state'
[void][IO.Directory]::CreateDirectory($state)
$results = [Collections.Generic.List[object]]::new()
$ownedProcesses = [Collections.Generic.List[Diagnostics.Process]]::new()

function Free-Port {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
    $listener.Start()
    $available = $listener.LocalEndpoint.Port
    $listener.Stop()
    return $available
}
function Read-Health([int]$Port) {
    try { return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 1 }
    catch { return $null }
}
function Start-Launcher([string[]]$Arguments, [string]$Name) {
    $start = [Diagnostics.ProcessStartInfo]::new($launcher)
    $start.WorkingDirectory = $fixtureRoot
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.ArgumentList.Add('--no-browser')
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    $child = [Diagnostics.Process]::Start($start)
    $ownedProcesses.Add($child)
    return $child
}
function Wait-Health([int]$Port) {
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        $health = Read-Health $Port
        if ($health -and $health.appRoot -eq $fixtureRoot -and $health.appId -eq 'iron-hands-forge') { return $health }
        Start-Sleep -Milliseconds 150
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Fixture health did not become ready on $Port."
}
function Stop-Launcher([Diagnostics.Process]$Process, [int]$Port) {
    if (-not $Process.HasExited) { $Process.Kill(); $Process.WaitForExit() }
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while ((Read-Health $Port) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    if (Read-Health $Port) { throw "Hidden server remained alive after its launcher closed on $Port." }
}
function Assert-Equal($Actual, $Expected, [string]$Message) {
    if ($Actual -ne $Expected) { throw "$Message : expected '$Expected', got '$Actual'." }
}
function New-LibraryFixture([string]$Directory) {
    $roster = Join-Path $Directory 'production/roster'
    $source = Join-Path $Directory 'assets/characters/SM2-retail-constructors/source-v5'
    [void][IO.Directory]::CreateDirectory($roster)
    [void][IO.Directory]::CreateDirectory($source)
    '{"classes":[{"id":"PVE_PVP_SOLDIER","available":true,"tpl":"fixture_soldier","slots":[]}]}' | Set-Content -LiteralPath (Join-Path $roster 'armor-options.json') -Encoding utf8
    '{"colors":[]}' | Set-Content -LiteralPath (Join-Path $roster 'armor-paints.json') -Encoding utf8
    '{"assets":[{"asset":"fixture_soldier","transformValidation":"passed","restSkinValidation":"passed","weightPackingValidation":"passed","skinProfileWeldValidation":"passed"}]}' | Set-Content -LiteralPath (Join-Path $source 'manifest.json') -Encoding utf8
    '{"meshes":[{"name":"fixture"}]}' | Set-Content -LiteralPath (Join-Path $source 'fixture_soldier.json') -Encoding utf8
    $bytes = [byte[]]::new(28)
    [BitConverter]::GetBytes([uint32]0x46546c67).CopyTo($bytes,0)
    [BitConverter]::GetBytes([uint32]2).CopyTo($bytes,4)
    [BitConverter]::GetBytes([uint32]28).CopyTo($bytes,8)
    [IO.File]::WriteAllBytes((Join-Path $source 'fixture_soldier.glb'),$bytes)
}
function Test-Data([string]$Name, [string[]]$Arguments, [string]$ExpectedData, [int]$Port) {
    $child = Start-Launcher $Arguments $Name
    $health = Wait-Health $Port
    Assert-Equal $health.dataRoot $ExpectedData $Name
    Assert-Equal $health.environment.TEMP (Join-Path $fixtureRoot 'cache/tmp') 'TEMP stays beside product'
    Assert-Equal $health.environment.TMP $health.environment.TEMP 'TMP stays beside product'
    Assert-Equal $health.environment.NODE_COMPILE_CACHE (Join-Path $fixtureRoot 'cache/node') 'Node cache stays beside product'
    Assert-Equal $health.environment.NODE_DISABLE_COMPILE_CACHE '1' 'Node compile cache is disabled'
    $results.Add([ordered]@{test=$Name;passed=$true;port=$Port;dataRoot=$health.dataRoot})
    Stop-Launcher $child $Port
}

try {
    $help = Start-Launcher @('--help') 'help'
    if (-not $help.WaitForExit(5000)) { throw 'Help command did not exit.' }
    Assert-Equal $help.ExitCode 0 'Help exit'
    $invalid = Start-Launcher @('--port','invalid') 'invalid argument'
    if (-not $invalid.WaitForExit(5000)) { throw 'Invalid argument command did not exit.' }
    Assert-Equal $invalid.ExitCode 1 'Invalid argument exit'
    $results.Add([ordered]@{test='help-and-invalid-CLI';passed=$true})
    New-LibraryFixture (Join-Path $fixtureRoot 'data')
    $port = Free-Port
    Test-Data 'default-data-root' @('--port',"$port") (Join-Path $fixtureRoot 'data') $port
    New-LibraryFixture (Join-Path $fixtureRoot 'saved data')
    @{dataRoot='saved data'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $state 'settings.json') -Encoding utf8
    $port = Free-Port
    Test-Data 'saved-settings-data-root' @('--port',"$port") (Join-Path $fixtureRoot 'saved data') $port
    $staleData = Join-Path $fixtureRoot 'removed prepared folder'
    @{dataRoot=$staleData} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $state 'settings.json') -Encoding utf8
    $port = Free-Port
    Test-Data 'stale-settings-fall-back-to-bundled-root' @('--port',"$port") (Join-Path $fixtureRoot 'data') $port
    if (Test-Path -LiteralPath $staleData) { throw 'The launcher created the stale external data folder.' }
    New-LibraryFixture (Join-Path $fixtureRoot 'данные cfg')
    $port = Free-Port
    @{dataRoot='данные cfg';port=$port} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $fixtureRoot 'forge.config.json') -Encoding utf8
    Test-Data 'config-overrides-settings-and-config-port' @() (Join-Path $fixtureRoot 'данные cfg') $port
    $staleConfig = Join-Path $fixtureRoot 'old config resources'
    @{dataRoot=$staleConfig} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $fixtureRoot 'forge.config.json') -Encoding utf8
    $port = Free-Port
    Test-Data 'stale-config-falls-back-without-creating-directory' @('--port',"$port") (Join-Path $fixtureRoot 'data') $port
    if (Test-Path -LiteralPath $staleConfig) { throw 'The launcher created the stale configured data folder.' }
    @{dataRoot='данные cfg'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $fixtureRoot 'forge.config.json') -Encoding utf8
    $port = Free-Port
    $cliData = Join-Path $fixtureRoot 'CLI data with spaces'
    $child = Start-Launcher @('--port',"$port",'--data-root',$cliData) 'CLI override'
    $health = Wait-Health $port
    Assert-Equal $health.dataRoot $cliData 'CLI overrides config/settings'
    $repeat = Start-Launcher @('--port',"$port",'--data-root',$cliData) 'reuse'
    if (-not $repeat.WaitForExit(7000)) { throw 'Second launcher did not reuse the matching instance.' }
    Assert-Equal $repeat.ExitCode 0 'Matching-instance reuse exit'
    Assert-Equal (Read-Health $port).pid $health.pid 'Reuse keeps original Node process'
    $results.Add([ordered]@{test='CLI-priority-and-matching-reuse';passed=$true;port=$port})
    Stop-Launcher $child $port

    $port = Free-Port
    $parallelA = Start-Launcher @('--port',"$port",'--data-root',$cliData) 'parallel A'
    $parallelB = Start-Launcher @('--port',"$port",'--data-root',$cliData) 'parallel B'
    $parallelHealth = Wait-Health $port
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while (-not $parallelA.HasExited -and -not $parallelB.HasExited -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    if (-not $parallelA.HasExited -and -not $parallelB.HasExited) { throw 'Concurrent launch did not reuse a single instance.' }
    $reuser = if ($parallelA.HasExited) { $parallelA } else { $parallelB }
    $owner = if ($parallelA.HasExited) { $parallelB } else { $parallelA }
    Assert-Equal $reuser.ExitCode 0 'Concurrent reuse exit'
    Assert-Equal (Read-Health $port).pid $parallelHealth.pid 'Concurrent launch preserves one Node process'
    Stop-Launcher $owner $port
    $results.Add([ordered]@{test='concurrent-start-lock';passed=$true;port=$port})

    # This deliberately unrelated server must survive fallback and launcher shutdown.
    $busyPort = Free-Port
    $foreignStart = [Diagnostics.ProcessStartInfo]::new($node)
    $foreignStart.UseShellExecute=$false; $foreignStart.CreateNoWindow=$true; $foreignStart.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
    foreach ($arg in @((Join-Path $fixtureRoot 'app/server.cjs'),'--port',"$busyPort",'--app-id','unrelated-test-service')) { $foreignStart.ArgumentList.Add($arg) }
    $foreign = [Diagnostics.Process]::Start($foreignStart); $ownedProcesses.Add($foreign)
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while (-not (Read-Health $busyPort) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    Assert-Equal (Read-Health $busyPort).appId 'unrelated-test-service' 'Busy-port fixture ready'
    $fallback = Start-Launcher @('--port',"$busyPort",'--data-root',$cliData) 'fallback'
    $fallbackHealth = $null
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        foreach ($candidate in 8767..8777) {
            $candidateHealth = Read-Health $candidate
            if ($candidateHealth -and $candidateHealth.appRoot -eq $fixtureRoot -and $candidateHealth.appId -eq 'iron-hands-forge') { $fallbackHealth=$candidateHealth;break }
        }
        if (-not $fallbackHealth) { Start-Sleep -Milliseconds 100 }
    } while (-not $fallbackHealth -and [DateTime]::UtcNow -lt $deadline)
    if (-not $fallbackHealth) { throw 'No matching fallback instance appeared in 8767-8777.' }
    Assert-Equal (Read-Health $busyPort).appId 'unrelated-test-service' 'Unrelated server survives launch'
    $foreign.Kill();$foreign.WaitForExit()
    $reclaimed = Start-Launcher @('--port',"$busyPort",'--data-root',$cliData) 'preferred port becomes free'
    if (-not $reclaimed.WaitForExit(7000)) { throw 'A newly free preferred port caused a duplicate server instead of fallback-instance reuse.' }
    Assert-Equal $reclaimed.ExitCode 0 'Reclaimed preferred-port reuse exit'
    Assert-Equal (Read-Health $fallbackHealth.port).pid $fallbackHealth.pid 'Existing fallback server remains the owner'
    Stop-Launcher $fallback $fallbackHealth.port
    $results.Add([ordered]@{test='unrelated-port-fallback-and-reuse-after-preferred-port-freed';passed=$true;busyPort=$busyPort;chosenPort=$fallbackHealth.port})
    [ordered]@{passed=$true;tests=$results.ToArray();fixtureRoot=$fixtureRoot;launcherSHA256=(Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash;managedLauncherSHA256=(Get-FileHash -LiteralPath (Join-Path $fixtureRoot 'IronHandsForge.dll') -Algorithm SHA256).Hash;at=[DateTimeOffset]::UtcNow.ToString('O')} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $fixtureRoot 'report.json') -Encoding utf8
    Write-Output "Launcher QA passed: $(Join-Path $fixtureRoot 'report.json')"
}
finally {
    foreach ($child in $ownedProcesses) {
        if (-not $child.HasExited) { $child.Kill(); $child.WaitForExit() }
        $child.Dispose()
    }
}
