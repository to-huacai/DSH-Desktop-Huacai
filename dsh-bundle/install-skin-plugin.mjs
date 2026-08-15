#!/usr/bin/env node
/**
 * install-skin-plugin.mjs — one-click install of the @local/dsh-skin plugin
 * into a dsh web profile.
 *
 *   node install-skin-plugin.mjs                install only (idempotent)
 *   node install-skin-plugin.mjs --restart      install, then restart dsh web
 *   node install-skin-plugin.mjs --uninstall    remove the plugin (+ --restart)
 *   node install-skin-plugin.mjs --profile <dir>   explicit profile directory
 *   node install-skin-plugin.mjs --port <n>         web port used for restart detection
 *   node install-skin-plugin.mjs --no-restart       never restart
 *
 * One-click flow (--restart, Windows):
 *   1. ensure the profile exists (bootstrap the standard web scaffold when
 *      missing — dsh would auto-create it on first boot anyway)
 *   2. copy the package into the profile node_modules + add the composition row
 *   3. ensure the dsh CLI is installed (npx download when missing)
 *   4. locate the running dsh web server (listener on the web port); when none
 *      is running, start one directly
 *   5. otherwise capture the old launch command line, kill the process tree,
 *      relaunch detached with the same command line
 *   6. poll http://127.0.0.1:<port>/ until the server answers
 *
 * So a brand-new computer needs no manual `npx @deepseek-ai/dsh web` first
 * run: the installer bootstraps the profile, installs the plugin, and starts
 * dsh itself.
 *
 * Portable: plain Node, zero dependencies. Windows restart automation;
 * on other platforms --restart prints manual instructions instead.
 */

import { existsSync, mkdirSync, copyFileSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { execFileSync, spawn } from 'node:child_process'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = join(SCRIPT_DIR, 'plugin', '@local', 'dsh-skin')
const PACKAGE_NAME = '@local/dsh-skin'

// ── profile scaffold (mirrors dsh-app-boot's initProfile/PROFILE_TEMPLATES) ─

const WEB_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
const PROFILE_PATCH_TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`
const PROFILE_PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

/** $DSH_HOME (default ~/.dsh). */
function resolveDshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/**
 * Create the standard `web` profile scaffold (manifest, empty user patch
 * layer, pnpm workspace settings). Mirrors the shipped initProfile; existing
 * files are never touched, and dsh's own boot would create these anyway.
 */
function bootstrapProfile(dir) {
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) {
    const manifest = {
      name: `dsh-profile-${basename(dir)}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [...WEB_BUNDLES] } },
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  }
  const patchPath = join(dir, 'cordis.patch.yml')
  if (!existsSync(patchPath)) writeFileSync(patchPath, PROFILE_PATCH_TEMPLATE)
  const workspacePath = join(dir, 'pnpm-workspace.yaml')
  if (!existsSync(workspacePath)) writeFileSync(workspacePath, PROFILE_PNPM_WORKSPACE)
}

/** Installed @deepseek-ai/dsh bin.js candidates (newest first). */
function dshBinCandidates() {
  const roots = []
  const localAppData = process.env.LOCALAPPDATA
  if (localAppData) roots.push(join(localAppData, 'npm-cache', '_npx'))
  roots.push(join(homedir(), '.npm', '_npx'))
  roots.push(join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules'))
  const bins = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    let entries = []
    try { entries = readdirSync(root) } catch { continue }
    for (const entry of entries) {
      const candidate = join(root, entry, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      if (existsSync(candidate)) bins.push(candidate)
    }
  }
  return bins.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
}

/** Ensure the dsh CLI is installed; download it via npx when missing. */
async function ensureDshCli() {
  const bins = dshBinCandidates()
  if (bins.length > 0) return { bin: bins[0], downloaded: false }
  console.log('未检测到 dsh CLI，正在下载（npx --yes @deepseek-ai/dsh）…')
  try {
    execFileSync('npx', ['--yes', '@deepseek-ai/dsh', '--version'], { stdio: 'inherit', shell: true })
  } catch (error) {
    throw new Error(`无法下载 dsh CLI（${error.message}）。请检查网络后重试。`)
  }
  const after = dshBinCandidates()
  if (after.length === 0) throw new Error('dsh CLI 下载完成，但未找到其安装位置（bin.js）')
  return { bin: after[0], downloaded: true }
}

// ── composition patching ───────────────────────────────────────────────────

const ROW_MARKER = PACKAGE_NAME
const INSERT_BLOCK = `# @local/dsh-skin - light-mode skin plugin (added by install-skin-plugin; delete this block to uninstall)
- insert:
    - id: skin
      name: '@local/dsh-skin'
`

/** Every plausible profile directory carrying a cordis.patch.yml. */
function findProfiles() {
  const dshHome = resolveDshHome()
  const candidates = [
    join(dshHome, 'profiles', 'web'),
    join(dshHome, 'profiles'),
  ]
  const profiles = []
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'cordis.patch.yml'))) profiles.push(candidate)
  }
  return profiles
}

/** The default `web` profile directory (exists after bootstrap/first boot). */
function defaultWebProfileDir() {
  return join(resolveDshHome(), 'profiles', 'web')
}

/** Add an insert entry (replacing an empty `[]` line, never appending after it). */
function patchCompositionFor(profile, marker, block) {
  const path = join(profile, 'cordis.patch.yml')
  let original
  try {
    original = readFileSync(path, 'utf8')
  } catch {
    original = PROFILE_PATCH_TEMPLATE
  }
  if (original.includes(marker)) return false
  const lines = original.split('\n')
  const emptyIndex = lines.findIndex((line) => line.trim() === '[]')
  if (emptyIndex !== -1) {
    lines[emptyIndex] = block.replace(/\n$/, '')
    writeFileSync(path, lines.join('\n'))
  } else {
    writeFileSync(path, original.replace(/\s*$/, '\n') + block)
  }
  return true
}

/** Add the skin insert entry. */
function patchComposition(profile) {
  return patchCompositionFor(profile, ROW_MARKER, INSERT_BLOCK)
}

/** Remove one insert entry (and its marker comment); restore `[]` when no entries remain. */
function uninstallCompositionFor(profile, marker) {
  const path = join(profile, 'cordis.patch.yml')
  if (!existsSync(path)) return false
  const text = readFileSync(path, 'utf8')
  const lines = text.split('\n')
  // locate the `- insert:` entry whose indented body names the package
  let insertAt = -1
  for (let i = 0; i < lines.length; i++) {
    if (!/^-\s*insert:/.test(lines[i])) continue
    let j = i + 1
    let found = false
    while (j < lines.length && /^\s+\S/.test(lines[j])) {
      if (lines[j].includes(marker)) { found = true; break }
      j++
    }
    if (found) { insertAt = i; break }
  }
  if (insertAt === -1) return false
  // also drop the marker comment line directly above the entry
  let start = insertAt
  if (start > 0 && lines[start - 1].trim().startsWith('#') && lines[start - 1].includes(marker)) start -= 1
  // the entry ends at the next top-level line (column-0 '-' or '[]') or EOF
  let end = lines.length
  for (let i = insertAt + 1; i < lines.length; i++) {
    if (/^-\s/.test(lines[i]) || lines[i].trim() === '[]') { end = i; break }
  }
  lines.splice(start, end - start)
  let out = lines.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
  const entries = out.split('\n').filter((line) => {
    const t = line.trim()
    return t !== '' && !t.startsWith('#')
  })
  if (entries.length === 0) out += '[]\n'
  writeFileSync(path, out)
  return true
}

/** Remove the skin insert entry. */
function uninstallComposition(profile) {
  return uninstallCompositionFor(profile, ROW_MARKER)
}

// ── install / uninstall ────────────────────────────────────────────────────

/**
 * Recursive directory copy via mkdir + copyFile.
 * (fs.cpSync(recursive) fails with EIO/Access denied on some Node 24 /
 * Windows setups, so the installer deliberately avoids it.)
 */
function copyTree(src, dst) {
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src)) {
    const s = join(src, entry)
    const d = join(dst, entry)
    if (statSync(s).isDirectory()) copyTree(s, d)
    else copyFileSync(s, d)
  }
}

function installPackage(profile) {
  const target = join(profile, 'node_modules', '@local', 'dsh-skin')
  mkdirSync(join(profile, 'node_modules', '@local'), { recursive: true })
  if (existsSync(target)) rmSync(target, { recursive: true, force: true })
  copyTree(PACKAGE_DIR, target)
  return target
}

function uninstallPackage(profile) {
  const target = join(profile, 'node_modules', '@local', 'dsh-skin')
  if (existsSync(target)) rmSync(target, { recursive: true, force: true })
  return target
}

// ── companion plugins (DSH-Desktop-Huacai exe bundle) ─────────────────────
// The exe embeds several @local plugins next to this installer; when this
// script runs from such a bundle it also installs (or removes) them, so a
// brand-new computer gets the full set in one run. Standalone dsh-back
// deployments without the companion folders are unaffected.
const COMPANIONS = [
  {
    name: '@local/dsh-archive',
    marker: '@local/dsh-archive',
    block: `# @local/dsh-archive - archived session manager (added by install-skin-plugin / exe bundle; delete this block to uninstall)
- insert:
    - id: archive
      name: '@local/dsh-archive'
`,
    dir: join(SCRIPT_DIR, 'plugin', '@local', 'dsh-archive'),
  },
  {
    name: '@local/dsh-updater',
    marker: '@local/dsh-updater',
    block: `# @local/dsh-updater - DeepSeek Harness update checker (added by install-skin-plugin / exe bundle; delete this block to uninstall)
- insert:
    - id: updater
      name: '@local/dsh-updater'
`,
    dir: join(SCRIPT_DIR, 'plugin', '@local', 'dsh-updater'),
  },
  {
    name: '@local/dsh-editor',
    marker: '@local/dsh-editor',
    block: `# @local/dsh-editor - editor mode (file tree + editable file + chat, switchable with the default mode) (added by install-skin-plugin / exe bundle; delete this block to uninstall)
- insert:
    - id: editor
      name: '@local/dsh-editor'
`,
    dir: join(SCRIPT_DIR, 'plugin', '@local', 'dsh-editor'),
  },
]

function installCompanions(profiles) {
  for (const companion of COMPANIONS) {
    if (!existsSync(join(companion.dir, 'package.json'))) continue
    for (const profile of profiles) {
      const target = join(profile, 'node_modules', '@local', basename(companion.dir))
      mkdirSync(join(profile, 'node_modules', '@local'), { recursive: true })
      if (existsSync(target)) rmSync(target, { recursive: true, force: true })
      copyTree(companion.dir, target)
      const changed = patchCompositionFor(profile, companion.marker, companion.block)
      console.log(changed
        ? `附带安装 ${companion.name}（exe 捆绑）: 包已复制 + 组合行已添加: ${join(profile, 'cordis.patch.yml')}`
        : `附带安装 ${companion.name}（exe 捆绑）: 已就绪（组合行已存在，跳过）: ${join(profile, 'cordis.patch.yml')}`)
    }
  }
}

function uninstallCompanions(profiles) {
  let removedAny = false
  for (const companion of COMPANIONS) {
    if (!existsSync(join(companion.dir, 'package.json'))) continue
    for (const profile of profiles) {
      const rowRemoved = uninstallCompositionFor(profile, companion.marker)
      const target = join(profile, 'node_modules', '@local', basename(companion.dir))
      const packageExisted = existsSync(target)
      if (packageExisted) rmSync(target, { recursive: true, force: true })
      removedAny = removedAny || rowRemoved || packageExisted
      console.log(rowRemoved
        ? `附带移除 ${companion.name}（exe 捆绑）: 组合行已移除: ${join(profile, 'cordis.patch.yml')}`
        : `附带移除 ${companion.name}（exe 捆绑）: 组合行不存在（跳过）: ${join(profile, 'cordis.patch.yml')}`)
      if (packageExisted) console.log(`插件目录已删除: ${target}`)
    }
  }
  return removedAny
}

// ── restart automation (Windows-first) ─────────────────────────────────────

function detectPort(explicit) {
  if (explicit !== undefined) {
    const value = Number(explicit)
    if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`无效端口: ${explicit}`)
    return value
  }
  const envUrl = process.env.DSH_WEB_URL
  if (envUrl) {
    try {
      const parsed = new URL(envUrl)
      if (parsed.port) return Number(parsed.port)
    } catch { /* ignore */ }
  }
  return 3080
}

/** PID of the process listening on `port` (netstat), or null. */
function findListenerPid(port) {
  try {
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' })
    for (const line of out.split('\n')) {
      const m = line.match(/TCP\s+[^\s]*:(\d+)\s+\S+\s+LISTENING\s+(\d+)/)
      if (m !== null && Number(m[1]) === port) return Number(m[2])
    }
  } catch { /* netstat unavailable */ }
  return null
}

/** Command line of a process (PowerShell/WMI), or null. */
function pidCommandLine(pid) {
  try {
    const script = `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' })
    const value = out.trim()
    return value === '' ? null : value
  } catch { /* unavailable */ }
  return null
}

/** Split a Windows command line, honoring double quotes. */
function tokenize(cmdline) {
  const tokens = []
  const re = /"([^"]*)"|(\S+)/g
  let m
  while ((m = re.exec(cmdline)) !== null) tokens.push(m[1] !== undefined ? m[1] : m[2])
  return tokens
}

/**
 * Rebuild a launch spec from the running dsh process's command line:
 * `node ...\@deepseek-ai\dsh\lib\bin.js web [...]` → { exe, args }.
 */
function parseLaunch(cmdline) {
  const tokens = tokenize(cmdline)
  if (tokens.length === 0) return null
  const binIndex = tokens.findIndex((token) => /(^|[\\/])bin\.js$/i.test(token))
  if (binIndex <= 0) return null
  return { exe: tokens[0], args: [tokens[binIndex], ...tokens.slice(binIndex + 1)] }
}

function killProcessTree(pid) {
  execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
}

/** Wait until the web server answers on the port. Returns true on success. */
async function pollReady(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) })
      return true // any HTTP response means the server is up
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return false
}

/** Restart dsh web: find the listener, capture its launch command, kill the
 * tree, relaunch detached with the same command line. When no dsh is running
 * (fresh machine), ensure the CLI and start one directly. Returns a report. */
async function restartDsh(port) {
  if (process.platform !== 'win32') {
    return { ok: false, message: '非 Windows 平台：请手动重启 dsh 后刷新浏览器' }
  }
  const pid = findListenerPid(port)
  if (pid === null) {
    console.log('未检测到运行中的 dsh 服务，将直接启动…')
    const cli = await ensureDshCli()
    const child = spawn(process.execPath, [cli.bin, 'web'], {
      detached: true,
      stdio: 'ignore',
      cwd: SCRIPT_DIR,
      windowsHide: true,
    })
    child.unref()
    console.log(`已启动: ${process.execPath} ${cli.bin} web`)
    if (await pollReady(port)) {
      return { ok: true, message: `dsh 已启动并就绪: http://127.0.0.1:${port}/ （如页面未刷新请按 Ctrl+R）` }
    }
    return { ok: false, message: `启动后 ${port} 端口 30s 内未就绪。请手动启动: ${process.execPath} ${cli.bin} web` }
  }
  const cmdline = pidCommandLine(pid)
  if (cmdline === null) {
    return { ok: false, message: `无法读取 dsh 进程(${pid})的命令行，请手动重启 dsh（taskkill /PID ${pid} /F 后重新启动）` }
  }
  const launch = parseLaunch(cmdline)
  if (launch === null) {
    return { ok: false, message: `无法从命令行解析启动方式: ${cmdline.slice(0, 160)}… 请手动重启 dsh` }
  }
  console.log(`检测到 dsh 服务进程 PID ${pid}，正在重启…`)
  try {
    killProcessTree(pid)
  } catch (error) {
    return { ok: false, message: `终止进程失败（${error.message}）。安装已完成，请以管理员身份运行或手动重启 dsh` }
  }
  const child = spawn(launch.exe, launch.args, {
    detached: true,
    stdio: 'ignore',
    cwd: SCRIPT_DIR,
    windowsHide: true,
  })
  child.unref()
  console.log(`已重新启动: ${launch.exe} ${launch.args.join(' ')}`)
  if (await pollReady(port)) {
    return { ok: true, message: `dsh 已重启并就绪: http://127.0.0.1:${port}/ （如页面未刷新请按 Ctrl+R）` }
  }
  return { ok: false, message: `重启后 ${port} 端口 30s 内未就绪。请手动启动: ${launch.exe} ${launch.args.join(' ')}` }
}

/** Locate the running dsh web server and its launch spec (read-only). */
function detectDsh(port) {
  if (process.platform !== 'win32') {
    return { ok: false, message: '非 Windows 平台：请手动重启 dsh 后刷新浏览器' }
  }
  const pid = findListenerPid(port)
  if (pid === null) {
    return { ok: false, message: `未检测到正在监听 ${port} 端口的 dsh 服务（可能未启动）。请手动启动 dsh 后刷新浏览器。` }
  }
  const cmdline = pidCommandLine(pid)
  if (cmdline === null) {
    return { ok: false, message: `无法读取 dsh 进程(${pid})的命令行，请手动重启 dsh（taskkill /PID ${pid} /F 后重新启动）` }
  }
  const launch = parseLaunch(cmdline)
  if (launch === null) {
    return { ok: false, message: `无法从命令行解析启动方式: ${cmdline.slice(0, 160)}… 请手动重启 dsh` }
  }
  return { ok: true, pid, cmdline, launch }
}

// ── main ───────────────────────────────────────────────────────────────────

function printUsage() {
  console.log(`用法: node install-skin-plugin.mjs [选项]

一键安装 @local/dsh-skin 皮肤插件到 dsh web profile。

选项:
  --restart            安装后自动重启 dsh web（Windows）
  --no-restart         即使有 --restart 也不重启
  --uninstall          卸载插件（删除组合行与包目录）
  --detect             只检测正在运行的 dsh web 进程与启动方式，不修改任何东西
  --profile <目录>     指定 profile 目录（默认自动查找）
  --port <端口>        dsh web 端口（默认读 DSH_WEB_URL，否则 3080）
  --help               显示本帮助

示例:
  node install-skin-plugin.mjs --restart
  node install-skin-plugin.mjs --uninstall --restart`)
}

async function main() {
  const args = process.argv.slice(2)
  let profileArg
  let portArg
  let doRestart = false
  let noRestart = false
  let doUninstall = false
  let doDetect = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') { printUsage(); return }
    else if (arg === '--profile') { profileArg = args[++i]; if (profileArg === undefined) throw new Error('--profile 需要一个目录参数') }
    else if (arg === '--port') { portArg = args[++i]; if (portArg === undefined) throw new Error('--port 需要一个端口参数') }
    else if (arg === '--restart') doRestart = true
    else if (arg === '--no-restart') noRestart = true
    else if (arg === '--uninstall') doUninstall = true
    else if (arg === '--detect') doDetect = true
    else throw new Error(`未知参数: ${arg}（--help 查看用法）`)
  }

  if (!existsSync(join(PACKAGE_DIR, 'package.json'))) {
    throw new Error(`未找到插件包: ${PACKAGE_DIR}`)
  }

  let profiles = profileArg !== undefined ? [profileArg] : findProfiles()
  const port = detectPort(portArg)

  if (doDetect) {
    console.log(`web 端口: ${port}`)
    const profileDir = profileArg !== undefined ? profileArg : defaultWebProfileDir()
    console.log(`profile: ${profileDir}（${existsSync(profileDir) ? '已存在' : '不存在，安装时自动创建'}）`)
    const bins = dshBinCandidates()
    console.log(`dsh CLI: ${bins.length > 0 ? bins[0] : '未安装（--restart 时自动下载）'}`)
    const detected = detectDsh(port)
    if (!detected.ok) {
      console.log(detected.message)
      console.log('（--detect 仅检测，未做任何修改）')
      return
    }
    console.log(`监听进程 PID: ${detected.pid}`)
    console.log(`原命令行: ${detected.cmdline}`)
    console.log(`重启将执行: ${detected.launch.exe} ${detected.launch.args.join(' ')}（工作目录: ${SCRIPT_DIR}）`)
    console.log('（--detect 仅检测，未做任何修改）')
    return
  }

  if (profiles.length === 0) {
    if (doUninstall) {
      console.log('未找到 dsh profile，无需卸载。')
      return
    }
    // No profile at all: bootstrap the standard web scaffold (dsh would create
    // it on first boot anyway) so a brand-new machine needs no manual run.
    const dir = profileArg !== undefined ? profileArg : defaultWebProfileDir()
    console.log(`未找到 dsh profile，正在自动创建: ${dir}`)
    bootstrapProfile(dir)
    profiles = [dir]
  } else if (!doUninstall) {
    // Explicit target or auto-discovered profile: complete the scaffold when
    // only part of it exists (package.json / pnpm-workspace.yaml).
    for (const profile of profiles) {
      if (!existsSync(join(profile, 'package.json'))) {
        console.log(`补齐 profile 脚手架: ${profile}`)
        bootstrapProfile(profile)
      }
    }
  }

  let installedAny = false
  let removedAny = false

  for (const profile of profiles) {
    if (doUninstall) {
      const rowRemoved = uninstallComposition(profile)
      const target = uninstallPackage(profile)
      removedAny = removedAny || rowRemoved || existsSync(target)
      console.log(rowRemoved
        ? `组合行已移除: ${join(profile, 'cordis.patch.yml')}`
        : `组合行不存在（跳过）: ${join(profile, 'cordis.patch.yml')}`)
      console.log(`插件目录已删除: ${target}`)
    } else {
      const target = installPackage(profile)
      console.log(`插件包已复制: ${target}`)
      const changed = patchComposition(profile)
      console.log(changed
        ? `组合行已添加: ${join(profile, 'cordis.patch.yml')}`
        : `组合行已存在（跳过）: ${join(profile, 'cordis.patch.yml')}`)
      installedAny = true
    }
  }

  // Companion plugins bundled with the DSH-Desktop-Huacai exe: install/remove them
  // alongside the skin so a fresh machine gets everything in one run.
  if (doUninstall) {
    removedAny = uninstallCompanions(profiles) || removedAny
  } else {
    installCompanions(profiles)
  }

  if (doUninstall && !removedAny) {
    console.log('\n提示：未发现已安装的皮肤插件，无需卸载。')
    return
  }
  if (!doUninstall && !installedAny) return

  if (doRestart && !noRestart) {
    console.log('\n--- 重启/启动 dsh ---')
    const report = await restartDsh(port)
    if (report.ok) console.log(`\n完成！${report.message}`)
    else console.log(`\n${report.message}`)
  } else {
    console.log('\n完成！插件已安装。请启动 dsh（npx @deepseek-ai/dsh web）后刷新浏览器。')
    console.log('一键模式（自动启动/重启）: node install-skin-plugin.mjs --restart')
  }
}

main().catch((error) => {
  console.error(`错误: ${error.message}`)
  process.exit(1)
})
