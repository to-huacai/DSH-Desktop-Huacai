# build.ps1 - build the self-contained DSH-Desktop-Huacai exe (embedded Node.js + dsh app)
#
# Output:
#   DSH-Desktop-Huacai-1.0.exe - single-file launcher: double-click shows an instant
#   "Initializing environment..." splash window, then auto-extracts the
#   embedded runtime, bootstraps the profile, installs the bundled skin /
#   archive / updater plugins, starts `dsh web` with the embedded node, and
#   opens the browser UI. No system Node.js required; fully offline.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File build.ps1
#   powershell -ExecutionPolicy Bypass -File build.ps1 -OutExe 'DSH-Desktop-Huacai-1.11.exe'
#
# Options:
#   -SourceExe   previous release exe whose embedded plugin/script payload is
#                reused as the build baseline (default DSH-Desktop-Huacai-1.11.exe;
#                dsh-bundle\ is overlaid on top, app.zip/runtime.zip are rebuilt)
#   -OutExe      output file name (default DSH-Desktop-Huacai-1.12.exe)
#   -NodeVersion embedded Node.js version (default v24.14.1; a local node of
#                this version is reused when present, otherwise mirrors are tried)
#   -FreshApp    reinstall dsh from npm instead of copying the local npx cache
#
# Dependencies: a real Node.js on this machine (for the pack scripts) and the
# built-in .NET Framework 4.x csc.exe. The _build\ dir is disposable.
#
# NOTE: keep this file ASCII-only (PowerShell 5.1 parses BOM-less .ps1 as ANSI).
# Native commands are always run through Invoke-Native: with
# $ErrorActionPreference='Stop', PS 5.1 turns ANY stderr write into a
# terminating error, so every native call redirects 2>&1 and is judged by
# $LASTEXITCODE instead.

param(
    [string]$SourceExe = 'DSH-Desktop-Huacai-1.11.exe',
    [string]$OutExe = 'DSH-Desktop-Huacai-1.12.exe',
    [string]$NodeVersion = 'v24.14.1',
    [switch]$FreshApp
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$build = Join-Path $root '_build'
$cache = Join-Path $root 'build-cache'
$payload = Join-Path $build 'payload'
$tools = Join-Path $build 'tools'
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'

# ---- native command runner (never lets stderr abort the script) ------------
function Invoke-Native {
    param([string]$Label, [scriptblock]$Command)
    # PS 5.1 with $ErrorActionPreference='Stop' turns ANY native stderr write
    # into a terminating error (curl progress, etc.). Locally relax it so the
    # command runs to completion and we judge by $LASTEXITCODE instead.
    $ErrorActionPreference = 'Continue'
    $out = & $Command 2>&1 | Out-String
    $rc = $LASTEXITCODE
    if ($rc -ne 0) {
        Write-Host ("[{0}] exit={1}" -f $Label, $rc) -ForegroundColor Red
        $text = $out.Trim()
        if ($text.Length -gt 0) {
            Write-Host ($text.Substring(0, [Math]::Min(1200, $text.Length))) -ForegroundColor DarkGray
        }
    }
    return $rc
}

Write-Host ''
Write-Host '===== DSH-Desktop-Huacai self-contained exe build =====' -ForegroundColor Cyan

# ---- 0. locate a real node (skip the C:\Windows\System32 store stub) ----
$nodeExe = $null
foreach ($c in @('E:\devleop\nodejs\node.exe', "$env:ProgramFiles\nodejs\node.exe",
                 "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
    if (Test-Path $c) { $nodeExe = $c; break }
}
if (-not $nodeExe) {
    $found = (Get-Command node.exe -ErrorAction SilentlyContinue | Where-Object {
        $_.Source -notlike 'C:\Windows\System32\*' } | Select-Object -First 1)
    if ($found) { $nodeExe = $found.Source }
}
if (-not $nodeExe -or -not (Test-Path $nodeExe)) {
    throw 'No usable node.exe found (install Node.js first)'
}
Write-Host ("Node: {0}" -f $nodeExe)

if (-not (Test-Path $csc)) { throw "csc.exe not found: $csc (need .NET Framework 4.x)" }

New-Item -ItemType Directory -Force -Path $build, $cache, $tools | Out-Null

# ---- 1. compile helper tools (zipdir / icon-gen) --------------------------
function Invoke-Csc([string]$src, [string]$outExe, [string]$target) {
    # NOTE: never name this $args — inside the scriptblock below, the automatic
    # $args of that block (empty) would shadow it and csc would get no source.
    $cscArgs = @('/nologo', "/target:$target", '/optimize', "/out:$outExe",
        '/reference:System.Drawing.dll',
        '/reference:System.IO.Compression.dll',
        '/reference:System.IO.Compression.FileSystem.dll',
        '/codepage:65001', $src)
    if ((Invoke-Native 'csc' { & $csc @cscArgs }) -ne 0) { throw "csc failed: $src" }
}
$zipdirExe = Join-Path $tools 'zipdir.exe'
$iconGenExe = Join-Path $tools 'icon-gen.exe'
if (-not (Test-Path $zipdirExe)) { Invoke-Csc (Join-Path $root 'tools\zipdir.cs') $zipdirExe 'exe' }
if (-not (Test-Path $iconGenExe)) { Invoke-Csc (Join-Path $root 'tools\icon-gen.cs') $iconGenExe 'exe' }

# ---- 2. extract the old exe's embedded resources (plugins/scripts/icons) --
if (-not (Test-Path $SourceExe)) { throw "Source exe not found: $SourceExe (place it here or use -SourceExe)" }
if (Test-Path $payload) { Remove-Item $payload -Recurse -Force }
New-Item -ItemType Directory -Force -Path $payload | Out-Null
Push-Location $root
if ((Invoke-Native 'parse-payload' { & $nodeExe parse-payload.mjs $SourceExe $payload }) -ne 0) {
    Pop-Location; throw 'parse-payload failed'
}
Pop-Location
Write-Host ("Extracted {0} embedded files from {1}" -f (Get-ChildItem $payload -Recurse -File).Count, $SourceExe)

# ---- 2.5 overlay the DSH-Desktop-Huacai bundle additions --------------------
# dsh-bundle\ carries payload content that ships with every build (the
# @local/dsh-updater and @local/dsh-editor plugins, apply-update.mjs, and an
# install-skin-plugin.mjs whose COMPANIONS list installs the editor/updater).
# Overlay it over the old exe's payload so a rebuild picks up these additions
# without rebuilding the v1 exe.
$bundle = Join-Path $root 'dsh-bundle'
if (Test-Path $bundle) {
    Copy-Item (Join-Path $bundle '*') $payload -Recurse -Force
    Write-Host ("Overlaid dsh-bundle additions -> payload ({0} files now)" -f (Get-ChildItem $payload -Recurse -File).Count)
}

# ---- 3. embedded Node.js runtime (runtime.zip = node.exe + LICENSE) -------
# Prefer a local node install of the exact version (no download); fall back to
# mirrors because nodejs.org large downloads are flaky on some networks.
$nodeZip = Join-Path $cache "node-$NodeVersion-win-x64.zip"
$nodeDir = Join-Path $cache "node-$NodeVersion-win-x64"
if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
    $localNode = $null
    foreach ($c in @('E:\devleop\nodejs\node.exe', "$env:ProgramFiles\nodejs\node.exe",
                     "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
        if (Test-Path $c) {
            $v = (& $c --version 2>$null | Select-Object -Last 1)
            if ($v -eq $NodeVersion) { $localNode = $c; break }
        }
    }
    if ($localNode) {
        Write-Host ("Using local Node.js {0} ({1})" -f $NodeVersion, $localNode) -ForegroundColor Green
        New-Item -ItemType Directory -Force -Path $nodeDir | Out-Null
        Copy-Item $localNode (Join-Path $nodeDir 'node.exe') -Force
        # best-effort LICENSE (MIT + third-party notices); non-fatal
        $lic = Join-Path $nodeDir 'LICENSE'
        $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
        if ($curl) {
            $null = Invoke-Native 'lic' {
                & $curl -sS -L --fail --ssl-no-revoke --connect-timeout 15 --max-time 60 `
                    -o $lic "https://raw.githubusercontent.com/nodejs/node/$NodeVersion/LICENSE"
            }
        }
        if (-not (Test-Path $lic)) {
            Set-Content -LiteralPath $lic -Value 'Node.js is distributed under the MIT license. See https://github.com/nodejs/node' -Encoding Ascii
        }
    } else {
        if (-not (Test-Path $nodeZip) -or (Get-Item $nodeZip).Length -lt 1000000) {
            $urls = @(
                "https://registry.npmmirror.com/-/binary/node/$NodeVersion/node-$NodeVersion-win-x64.zip",
                "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip")
            $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
            $ok = $false
            foreach ($url in $urls) {
                Write-Host ("Downloading Node.js from {0} ..." -f $url) -ForegroundColor Yellow
                if ($curl) {
                    $null = Invoke-Native 'node-dl' {
                        & $curl -sS -L --fail --ssl-no-revoke --connect-timeout 30 --retry 2 -o $nodeZip $url
                    }
                    if ((Test-Path $nodeZip) -and (Get-Item $nodeZip).Length -ge 1000000) { $ok = $true; break }
                } else {
                    try {
                        Invoke-WebRequest -Uri $url -OutFile $nodeZip -UseBasicParsing -TimeoutSec 300
                        $ok = $true; break
                    } catch { }
                }
            }
            if (-not $ok) { throw 'node zip download failed from all mirrors' }
        }
        Write-Host 'Extracting Node.js ...'
        Expand-Archive -LiteralPath $nodeZip -DestinationPath $cache -Force
    }
}
# LICENSE must always exist (MIT notice / fallback text) - outside the
# ensure-node block so a cached node.exe without LICENSE still gets one.
$lic = Join-Path $nodeDir 'LICENSE'
if (-not (Test-Path $lic)) {
    Set-Content -LiteralPath $lic -Value 'Node.js is distributed under the MIT license. See https://github.com/nodejs/node' -Encoding Ascii
}

# ---- 4. embedded dsh app (app.zip = full node_modules + package.json) -----
$appDir = Join-Path $build 'app'
if ($FreshApp -or -not (Test-Path (Join-Path $appDir 'node_modules\@deepseek-ai\dsh\lib\bin.js'))) {
    if (-not $FreshApp) {
        # prefer copying the local npx cache (no network)
        $cacheRoot = Join-Path $env:LOCALAPPDATA 'npm-cache\_npx'
        $cands = @()
        if (Test-Path $cacheRoot) {
            Get-ChildItem $cacheRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                $pkg = Join-Path $_.FullName 'node_modules\@deepseek-ai\dsh\package.json'
                if (Test-Path $pkg) {
                    $cands += [pscustomobject]@{ Path = $_.FullName; Time = (Get-Item $pkg).LastWriteTime }
                }
            }
        }
        if ($cands.Count -gt 0) {
            $best = ($cands | Sort-Object Time -Descending | Select-Object -First 1).Path
            Write-Host ("Copying npx-cache dsh install from {0}" -f $best) -ForegroundColor Yellow
            if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force }
            New-Item -ItemType Directory -Force -Path $appDir | Out-Null
            $null = Invoke-Native 'robocopy' {
                robocopy (Join-Path $best 'node_modules') (Join-Path $appDir 'node_modules') /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1
            }
            if ($LASTEXITCODE -ge 8) { throw 'robocopy failed' }
        }
    }
    if (-not (Test-Path (Join-Path $appDir 'node_modules\@deepseek-ai\dsh\lib\bin.js'))) {
        Write-Host 'No local dsh cache; installing from npm (needs network) ...' -ForegroundColor Yellow
        New-Item -ItemType Directory -Force -Path $appDir | Out-Null
        $npm = Join-Path (Split-Path -Parent $nodeExe) 'npm.cmd'
        if (-not (Test-Path $npm)) { $npm = 'npm' }
        Push-Location $appDir
        $rc = Invoke-Native 'npm-install' {
            & $npm install --omit=dev --no-audit --no-fund --loglevel=error @deepseek-ai/dsh
        }
        Pop-Location
        if ($rc -ne 0) { throw 'npm install failed' }
    }
}
$dshVersion = (Get-Content (Join-Path $appDir 'node_modules\@deepseek-ai\dsh\package.json') -Raw | ConvertFrom-Json).version
$appManifest = @{
    name = 'dsh-bundle'
    private = $true
    dependencies = @{ '@deepseek-ai/dsh' = $dshVersion }
} | ConvertTo-Json
Set-Content -LiteralPath (Join-Path $appDir 'package.json') -Value $appManifest -Encoding Ascii
if ((Invoke-Native 'zip-app' { & $zipdirExe dir $appDir (Join-Path $payload 'app.zip') }) -ne 0) {
    throw 'app.zip failed'
}
Write-Host ("Embedded dsh version: {0}" -f $dshVersion) -ForegroundColor Green

# ---- 5. runtime.zip + icon -------------------------------------------------
# runtime.zip = node.exe + LICENSE + npm (npm-cli.js etc.). npm is required
# by the in-app updater (apply-update.mjs) to install a new dsh version on the
# target machine without a system Node install. Prefer npm inside nodeDir;
# otherwise copy it from a full local node install.
$staging = Join-Path $build 'runtime-staging'
New-Item -ItemType Directory -Force -Path $staging | Out-Null
Copy-Item (Join-Path $nodeDir 'node.exe') $staging -Force
Copy-Item (Join-Path $nodeDir 'LICENSE') $staging -Force
$npmSrc = Join-Path $nodeDir 'node_modules\npm'
$npmCmd = Join-Path $nodeDir 'npm.cmd'
if (-not (Test-Path (Join-Path $npmSrc 'bin\npm-cli.js'))) {
    foreach ($c in @('E:\devleop\nodejs\node.exe', "$env:ProgramFiles\nodejs\node.exe",
                     "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
        if (-not (Test-Path $c)) { continue }
        $dir = Split-Path -Parent $c
        if (Test-Path (Join-Path $dir 'node_modules\npm\bin\npm-cli.js')) {
            $npmSrc = Join-Path $dir 'node_modules\npm'
            $npmCmd = Join-Path $dir 'npm.cmd'
            Write-Host ("Using npm from local Node install: {0}" -f $npmSrc) -ForegroundColor Green
            break
        }
    }
}
if (Test-Path $npmSrc) {
    Copy-Item $npmSrc (Join-Path $staging 'node_modules\npm') -Recurse -Force
    if (Test-Path $npmCmd) { Copy-Item $npmCmd $staging -Force }
    $npxCmd = Join-Path (Split-Path -Parent $npmCmd) 'npx.cmd'
    if (Test-Path $npxCmd) { Copy-Item $npxCmd $staging -Force }
    Write-Host ("runtime.zip will bundle npm ({0} files)" -f (Get-ChildItem (Join-Path $staging 'node_modules\npm') -Recurse -File).Count)
} else {
    Write-Host 'WARNING: no npm found to bundle; in-app update will be unavailable' -ForegroundColor Yellow
}
if ((Invoke-Native 'zip-runtime' {
    & $zipdirExe dir $staging (Join-Path $payload 'runtime.zip')
}) -ne 0) { throw 'runtime.zip failed' }

$ico = Join-Path $build 'app.ico'
if ((Invoke-Native 'icon-gen' { & $iconGenExe (Join-Path $payload 'icon-192.png') $ico }) -ne 0) {
    throw 'icon generation failed'
}

# ---- 6. compile the launcher shell -----------------------------------------
$shell = Join-Path $build 'shell.exe'
$cscArgs = @('/nologo', '/target:winexe', '/optimize', "/out:$shell", "/win32icon:$ico",
    '/reference:System.Windows.Forms.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.IO.Compression.dll',
    '/reference:System.IO.Compression.FileSystem.dll',
    '/reference:System.Web.Extensions.dll',
    '/codepage:65001',
    (Join-Path $root 'src\Launcher.cs'))
if ((Invoke-Native 'csc-launcher' { & $csc @cscArgs }) -ne 0) { throw 'launcher compile failed' }

# ---- 7. assemble the final exe ----------------------------------------------
Push-Location $root
$rc = Invoke-Native 'pack-exe' { & $nodeExe tools\pack-exe.mjs $shell $payload $OutExe }
Pop-Location
if ($rc -ne 0) { throw 'pack-exe failed' }

# ---- 8. verify --------------------------------------------------------------
Push-Location $root
$null = Invoke-Native 'verify' { & $nodeExe parse-payload.mjs $OutExe }
Pop-Location
Write-Host ''
$sizeMb = [math]::Round((Get-Item (Join-Path $root $OutExe)).Length / 1MB, 1)
Write-Host ("Build done: {0}  ({1} MB)" -f (Join-Path $root $OutExe), $sizeMb) -ForegroundColor Green
Write-Host ''
Write-Host 'Distribution notes:' -ForegroundColor Cyan
Write-Host "  * copy $OutExe to any Windows 10/11 PC (no Node.js install needed)"
Write-Host '  * double-click: the "Initializing environment..." window appears instantly'
Write-Host '  * optional launcher.json next to the exe overrides port etc.'
Write-Host '  * rebuild after a dsh update by rerunning this script'
