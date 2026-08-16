# run-test.ps1 - isolated functional test for DSH-Desktop-Huacai-1.12.exe
# NOTE: keep this file ASCII-only (PS 5.1 parses BOM-less .ps1 as ANSI).
# 1) copies the exe to a scratch dir (no side folders => single-file path)
# 2) writes a launcher.json: port 3099, isolated DSH_HOME, no browser,
#    auto stop+exit 45s after ready
# 3) runs the exe, polls for the splash window / server / profile / plugins
# 4) waits for auto-exit, verifies the server process was killed
# Results are written to test-result.txt
# NOTE: run this only when the DSH-Desktop-Huacai launcher/server is NOT
# running - it re-extracts into the shared %LOCALAPPDATA%\DSH-Desktop-Huacai dir.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$root = $PSScriptRoot
$test = Join-Path $root '_test'
$home = Join-Path $test 'home'
$log  = Join-Path $root 'test-result.txt'
$exe = Join-Path $test 'DSH-Desktop-Huacai-1.12.exe'

function Write-Result([string]$line) {
    $line | Tee-Object -FilePath $log -Append
}

Remove-Item $log -Force -ErrorAction SilentlyContinue
Set-Content -LiteralPath $log -Value ("test start " + (Get-Date -Format 'HH:mm:ss')) -Encoding ASCII

# 1. scratch dir
# kill any leftover launcher from previous runs (never touches harness node)
Get-Process | Where-Object { $_.ProcessName -like 'DSH-Desktop-Huacai*' -or $_.ProcessName -like 'DSH Desktop*' } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
if (Test-Path $test) { Remove-Item $test -Recurse -Force }
New-Item -ItemType Directory -Force -Path $test | Out-Null
Copy-Item (Join-Path $root 'DSH-Desktop-Huacai-1.12.exe') $exe -Force
# keep dshHome on a pure-ASCII path so no encoding issue can corrupt it
$testHome = 'C:\Users\Public\dsh-test-home'
if (Test-Path $testHome) { Remove-Item $testHome -Recurse -Force }
$cfg = @{ port = 3099; openBrowser = $false; appMode = $false; dshHome = $testHome; exitAfterMs = 45000 } | ConvertTo-Json
$cfg | Out-File -LiteralPath (Join-Path $test 'launcher.json') -Encoding UTF8
Write-Result ("exe: {0:N1} MB" -f ((Get-Item $exe).Length / 1MB))

# 2. launch
$p = Start-Process -FilePath $exe -PassThru
if (-not $p) { Write-Result 'FAIL: Start-Process returned nothing'; exit 1 }
Write-Result ("launcher PID: {0}" -f $p.Id)

# 3. wait for splash window
$win = ''
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    $proc = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
    if ($proc) { $win = $proc.MainWindowTitle }
    if ($win) { break }
}
Write-Result ("splash window title: [{0}]" -f $win)

# 4. wait for server on 3099 (up to 240s)
$up = $false
for ($i = 0; $i -lt 240; $i++) {
    Start-Sleep -Seconds 1
    $proc = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
    if (-not $proc) { Write-Result 'launcher exited early!'; break }
    $conn = Get-NetTCPConnection -LocalPort 3099 -State Listen -ErrorAction SilentlyContinue
    if ($conn) { $up = $true; Write-Result ("server listening on 3099 after {0}s (pid {1})" -f ($i + 1), $conn[0].OwningProcess); break }
}
if (-not $up) { Write-Result 'FAIL: server never listened on 3099' }

# 5. verify artifacts
Start-Sleep -Seconds 3
$runtime = "$env:LOCALAPPDATA\DSH-Desktop-Huacai\runtime\node.exe"
$appBin = "$env:LOCALAPPDATA\DSH-Desktop-Huacai\app\node_modules\@deepseek-ai\dsh\lib\bin.js"
Write-Result ("runtime node: {0}" -f (Test-Path $runtime))
Write-Result ("app bin: {0}" -f (Test-Path $appBin))
$web = Join-Path $testHome 'profiles\web'
Write-Result ("profile package.json: {0}" -f (Test-Path (Join-Path $web 'package.json')))
Write-Result ("profile cordis.patch.yml: {0}" -f (Test-Path (Join-Path $web 'cordis.patch.yml')))
Write-Result ("profile skin pkg: {0}" -f (Test-Path (Join-Path $web 'node_modules\@local\dsh-skin\package.json')))
Write-Result ("profile archive pkg: {0}" -f (Test-Path (Join-Path $web 'node_modules\@local\dsh-archive\package.json')))
Write-Result ("profile updater pkg: {0}" -f (Test-Path (Join-Path $web 'node_modules\@local\dsh-updater\package.json')))
Write-Result ("profile editor pkg: {0}" -f (Test-Path (Join-Path $web 'node_modules\@local\dsh-editor\package.json')))
$editorVer = (Get-Content (Join-Path $web 'node_modules\@local\dsh-editor\package.json') -Raw | ConvertFrom-Json).version
Write-Result ("profile editor version: {0}" -f $editorVer)
Write-Result ("profile editor client: {0}" -f (Test-Path (Join-Path $web 'node_modules\@local\dsh-editor\lib\client.js')))
Write-Result ("profile skin ecb2.png: {0}" -f (Test-Path (Join-Path $web 'node_modules\@local\dsh-skin\ecb2.png')))
Write-Result ("apply-update.mjs: {0}" -f (Test-Path (Join-Path $env:LOCALAPPDATA 'DSH-Desktop-Huacai\apply-update.mjs')))
$serverLog = "$env:LOCALAPPDATA\DSH-Desktop-Huacai\logs\launcher.log"
Write-Result ("launcher.log exists: {0}" -f (Test-Path $serverLog))

# 5.5 terminal endpoint: dry run resolves cwd/shell without opening a window
Start-Sleep -Seconds 2
try {
    $resp = Invoke-RestMethod -Uri 'http://127.0.0.1:3099/dsh-editor-terminal/open' -Method Post -ContentType 'application/json' -Body '{"dryRun":true}' -TimeoutSec 15
    Write-Result ("terminal dryRun ok: {0}" -f ($resp | ConvertTo-Json -Compress))
} catch {
    Write-Result ("terminal dryRun FAILED: {0}" -f $_.Exception.Message)
}

# 5.6 embedded terminal: WebSocket round trip (echo through the ConPTY shell)
try {
    $wsOut = & $runtime (Join-Path $root 'tools\test-terminal-ws.mjs') 3099 2>&1 | Out-String
    Write-Result ("terminal ws: {0}" -f ($wsOut.Trim() -replace "`r?`n", ' | '))
    if ($LASTEXITCODE -ne 0) { Write-Result 'terminal ws FAILED (non-zero exit)' }
} catch {
    Write-Result ("terminal ws FAILED: {0}" -f $_.Exception.Message)
}

# 6. wait for auto-exit (exitAfterMs=45000 after ready)
$exited = $false
for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    if (-not (Get-Process -Id $p.Id -ErrorAction SilentlyContinue)) { $exited = $true; break }
}
Write-Result ("launcher auto-exited: {0}" -f $exited)
Start-Sleep -Seconds 3
$conn2 = Get-NetTCPConnection -LocalPort 3099 -State Listen -ErrorAction SilentlyContinue
if ($conn2) { Write-Result 'port 3099 after exit: STILL LISTENING!' } else { Write-Result 'port 3099 after exit: closed' }

# 7. tail of launcher.log
if (Test-Path $serverLog) {
    Write-Result '--- launcher.log tail ---'
    Get-Content $serverLog -Tail 25 | ForEach-Object { Write-Result $_ }
}
Write-Result ("test end " + (Get-Date -Format 'HH:mm:ss'))
exit 0
