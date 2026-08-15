#!/usr/bin/env node
/**
 * apply-update.mjs — apply an in-place update of the embedded dsh app.
 *
 * Run by the DSH-Desktop-Huacai launcher (embedded node) when the in-app updater
 * plugin (@local/dsh-updater) wrote update-request.json into the DSH-Desktop-Huacai
 * base dir and the web server exited:
 *
 *   node apply-update.mjs <path-to-update-request.json>
 *
 * Steps:
 *   1. backup the current @deepseek-ai/dsh package (restore point)
 *   2. npm install the target version into the app dir with the EMBEDDED npm
 *      (runtime\node_modules\npm), npmmirror registry first, npmjs fallback
 *   3. verify the installed version matches the target
 *   4. on failure restore the backup and leave the request file with the error
 *   5. on success remove the request file (renamed to update-done-<v>.json)
 *
 * The launcher restarts the web server after this script returns 0, so the
 * new version is live immediately and still inside the launcher's tree.
 * Portable: plain Node, zero dependencies (only the bundled npm + network).
 */

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, rmSync,
  readdirSync, statSync, copyFileSync, renameSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const BASE = dirname(fileURLToPath(import.meta.url)) // %LOCALAPPDATA%\DSH-Desktop-Huacai
const APP = join(BASE, 'app')
const RUNTIME = join(BASE, 'runtime')
const NPM_CLI = join(RUNTIME, 'node_modules', 'npm', 'bin', 'npm-cli.js')
const CACHE = join(BASE, 'npm-cache')
const BACKUP = join(BASE, 'update-backup', 'dsh')
const PKG_DIR = join(APP, 'node_modules', '@deepseek-ai', 'dsh')
const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

function log(line) {
  console.log(line)
}

/** Recursive copy (fs.cpSync can EIO/Access-denied on some Node 24/Windows
 *  setups; the same workaround the installer uses). */
function copyTree(src, dst) {
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src)) {
    const s = join(src, entry)
    const d = join(dst, entry)
    if (statSync(s).isDirectory()) copyTree(s, d)
    else copyFileSync(s, d)
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function main() {
  const reqPath = process.argv[2]
  if (!reqPath || !existsSync(reqPath)) {
    log('错误: 缺少 update-request.json 参数')
    return 2
  }
  if (!existsSync(NPM_CLI)) {
    log('错误: 未找到内置 npm: ' + NPM_CLI)
    return 3
  }
  let req = null
  try {
    req = readJson(reqPath)
  } catch (error) {
    log('错误: update-request.json 无法解析: ' + error.message)
    return 4
  }
  const target = req.version
  if (!target || !VERSION_RE.test(target)) {
    log('错误: 无效版本号: ' + String(target))
    return 4
  }

  // 1. backup the current package (restore point for a failed install)
  if (existsSync(BACKUP)) rmSync(BACKUP, { recursive: true, force: true })
  if (existsSync(PKG_DIR)) {
    log('备份当前 dsh 包…')
    copyTree(PKG_DIR, BACKUP)
  }

  mkdirSync(CACHE, { recursive: true })
  const env = { ...process.env, npm_config_cache: CACHE }

  // 2. npm install the target version (npmmirror first — DSH-Desktop-Huacai is
  //    China-oriented; fall back to the official registry).
  const registries = ['https://registry.npmmirror.com', 'https://registry.npmjs.org']
  let result = null
  for (const registry of registries) {
    log('npm install @deepseek-ai/dsh@' + target + '（' + registry + '）…')
    result = spawnSync(process.execPath, [
      NPM_CLI, '--prefix', APP, 'install',
      '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error',
      '--registry', registry,
      '@deepseek-ai/dsh@' + target,
    ], { cwd: BASE, env, encoding: 'utf8', timeout: 600000 })
    const out = ((result.stdout || '') + (result.stderr || '')).trim()
    if (out) log(out.split('\n').map((line) => '  ' + line).join('\n'))
    if (result.status === 0) break
  }

  if (!result || result.status !== 0) {
    log('npm install 失败，恢复原版本…')
    if (existsSync(PKG_DIR)) rmSync(PKG_DIR, { recursive: true, force: true })
    if (existsSync(BACKUP)) {
      mkdirSync(dirname(PKG_DIR), { recursive: true })
      copyTree(BACKUP, PKG_DIR)
    }
    try {
      writeFileSync(reqPath, JSON.stringify({
        ...req,
        error: 'npm install 失败 (exit=' + (result && result.status) + ')',
      }, null, 2), 'utf8')
    } catch (error) { /* keep going */ }
    return 5
  }

  // 3. verify the installed version
  let installed = null
  try {
    installed = readJson(join(PKG_DIR, 'package.json')).version
  } catch (error) { /* missing package.json */ }
  if (installed !== target) {
    log('版本校验失败: 期望 ' + target + '，实际 ' + String(installed) + '。恢复原版本…')
    if (existsSync(PKG_DIR)) rmSync(PKG_DIR, { recursive: true, force: true })
    if (existsSync(BACKUP)) {
      mkdirSync(dirname(PKG_DIR), { recursive: true })
      copyTree(BACKUP, PKG_DIR)
    }
    try {
      writeFileSync(reqPath, JSON.stringify({ ...req, error: '版本校验失败' }, null, 2), 'utf8')
    } catch (error) { /* keep going */ }
    return 6
  }

  // 4. success: cleanup backup + request file
  try { rmSync(BACKUP, { recursive: true, force: true }) } catch (error) { /* best-effort */ }
  try {
    renameSync(reqPath, join(BASE, 'update-done-' + target + '.json'))
  } catch (error) {
    try { rmSync(reqPath, { force: true }) } catch (error2) { /* best-effort */ }
  }
  log('更新完成: ' + installed)
  return 0
}

process.exit(main())
