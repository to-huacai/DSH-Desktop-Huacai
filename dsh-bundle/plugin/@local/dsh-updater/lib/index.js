/**
 * @local/dsh-updater — node half (DSH-Desktop-Huacai embedded edition).
 *
 * Serves two JSON endpoints for the browser half:
 *   GET  /dsh-updater/check   → { ok, mode, localVersion, latestVersion,
 *                                 latestPublishedAt, upToDate, canUpdate, error? }
 *   POST /dsh-updater/update  → { ok, version, message, error? }
 *
 * mode is 'desktop' when this dsh runs from the DSH-Desktop-Huacai embedded install
 * (the app folder under %LOCALAPPDATA%\DSH-Desktop-Huacai, or DSH_DESKTOP=1), and
 * 'other' for any other launch (npx cache / npm global / dev source).
 *
 * The check reads the RUNNING install's version from its own package.json
 * (process.argv[1] → .../@deepseek-ai/dsh/package.json) and compares it with
 * the npm registry `latest` dist-tag (npmjs first, npmmirror fallback).
 *
 * The update is a handoff: the node half writes update-request.json into the
 * DSH-Desktop-Huacai base dir and exits the web server. The DSH-Desktop-Huacai launcher
 * (which spawned this process) notices the exit + request file, runs the
 * bundled apply-update.mjs (npm install of the embedded app with the embedded
 * npm), and restarts the server. The new server stays inside the launcher's
 * process tree, so tray "stop & exit" keeps working after an update.
 *
 * Install: place this package under the profile's node_modules and add one
 * row to the profile cordis.patch.yml (see install-skin-plugin.mjs companion
 * list), then restart dsh.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

/** Cordis plugin name. */
export const name = 'updater'

const REGISTRY_LATEST_URLS = [
  'https://registry.npmjs.org/@deepseek-ai/dsh/latest',
  'https://registry.npmmirror.com/@deepseek-ai/dsh/latest',
]
const REGISTRY_FULL_URLS = [
  'https://registry.npmjs.org/@deepseek-ai/dsh',
  'https://registry.npmmirror.com/@deepseek-ai/dsh',
]
const FETCH_TIMEOUT_MS = 15000
const EXIT_DELAY_MS = 800
const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

/** Semver-ish compare: returns 1 when a > b, -1 when a < b, 0 when equal.
 *  Handles 0.1.0-rc.6 style prerelease suffixes (a release > its rc). */
function parseVersion(v) {
  const s = String(v)
  const dash = s.indexOf('-')
  const mainPart = dash >= 0 ? s.slice(0, dash) : s
  const main = mainPart.split('.').map((n) => parseInt(n, 10) || 0)
  const pre = dash >= 0 ? s.slice(dash + 1).split('.') : null
  return { main, pre }
}

function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    const x = pa.main[i] || 0
    const y = pb.main[i] || 0
    if (x !== y) return x > y ? 1 : -1
  }
  if (pa.pre === null && pb.pre === null) return 0
  if (pa.pre === null) return 1
  if (pb.pre === null) return -1
  const len = Math.max(pa.pre.length, pb.pre.length)
  for (let i = 0; i < len; i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = parseInt(x, 10)
    const yn = parseInt(y, 10)
    const xIsNum = /^\d+$/.test(x)
    const yIsNum = /^\d+$/.test(y)
    if (xIsNum && yIsNum) {
      if (xn !== yn) return xn > yn ? 1 : -1
      continue
    }
    if (xIsNum !== yIsNum) return xIsNum ? -1 : 1
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

/** Package info of the RUNNING @deepseek-ai/dsh install. Resolved from
 *  process.argv[1] (its bin.js when launched as `node .../dsh/lib/bin.js web`),
 *  falling back to the embedded app dir derived from process.execPath. */
function runningDshPackage() {
  // 1) process.argv[1] → <pkg>\lib\bin.js → package dir is one level up
  try {
    const bin = process.argv && process.argv[1]
    if (bin && typeof bin === 'string' && /bin\.js$/i.test(bin)) {
      const pkgDir = join(dirname(bin), '..')
      const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
      if (pkg.name === '@deepseek-ai/dsh' && typeof pkg.version === 'string') {
        return { version: pkg.version, root: pkgDir }
      }
    }
  } catch (error) { /* try next source */ }
  // 2) embedded app dir (execPath = <base>\runtime\node.exe)
  try {
    const base = desktopBaseDir()
    if (base) {
      const pkgDir = join(base, 'app', 'node_modules', '@deepseek-ai', 'dsh')
      const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
      if (pkg.name === '@deepseek-ai/dsh' && typeof pkg.version === 'string') {
        return { version: pkg.version, root: pkgDir }
      }
    }
  } catch (error) { /* no embedded install */ }
  return null
}

/** The DSH-Desktop-Huacai base dir when running from the embedded install, else null:
 *  execPath = <base>\runtime\node.exe, or argv[1] =
 *  <base>\app\node_modules\@deepseek-ai\dsh\lib\bin.js; verified by the
 *  `.embedded` marker that only EnsureEmbedded writes. */
function desktopBaseDir() {
  try {
    if (process.execPath) {
      const base = join(dirname(process.execPath), '..')
      if (existsSync(join(base, '.embedded'))) return base
    }
    const bin = process.argv && process.argv[1]
    if (bin && typeof bin === 'string') {
      const base = join(dirname(bin), '..', '..', '..', '..', '..')
      if (existsSync(join(base, '.embedded'))) return base
    }
  } catch (error) { /* fall through */ }
  return null
}

/** True when this dsh runs from the DSH-Desktop-Huacai embedded install. */
function isDesktopMode() {
  if (process.env && process.env.DSH_DESKTOP === '1') return true
  return desktopBaseDir() !== null
}

/** Fetch the `latest` dist-tag version, trying each registry in order. */
async function fetchLatestVersion() {
  let lastError = null
  for (const url of REGISTRY_LATEST_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const data = await res.json()
      if (!data || typeof data.version !== 'string' || !data.version) throw new Error('无法解析 registry 响应')
      return data.version
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('无法连接 npm 官方源')
}

/** Publish timestamp of one version (best-effort). */
async function fetchPublishedAt(version) {
  for (const url of REGISTRY_FULL_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!res.ok) continue
      const doc = await res.json()
      const t = doc && doc.time
      if (t && typeof t[version] === 'string') return t[version]
      break
    } catch (error) { /* try next */ }
  }
  return null
}

/** Full check payload shared by the check route and the update preflight. */
async function checkPayload() {
  const running = runningDshPackage()
  const mode = isDesktopMode() ? 'desktop' : 'other'
  let latest = null
  let error = null
  try {
    latest = await fetchLatestVersion()
  } catch (e) {
    error = (e && e.message) ? e.message : String(e)
  }
  const published = latest ? await fetchPublishedAt(latest) : null
  const localVersion = running ? running.version : null
  let upToDate = null
  if (localVersion && latest) upToDate = compareVersions(latest, localVersion) <= 0
  return {
    ok: true,
    mode,
    localVersion,
    latestVersion: latest,
    latestPublishedAt: published,
    upToDate,
    canUpdate: mode === 'desktop' && !!localVersion && !!latest && upToDate === false,
    error,
  }
}

/** Write update-request.json, reply, then exit the web server so the launcher
 *  picks up the handoff (response is flushed before the delayed exit). */
function requestUpdate(target) {
  const base = desktopBaseDir()
  if (!base) return { ok: false, error: '无法定位 DSH-Desktop-Huacai 安装目录' }
  const req = {
    version: target,
    source: 'npm',
    requestedAt: new Date().toISOString(),
    dshHome: process.env.DSH_HOME || '',
  }
  writeFileSync(join(base, 'update-request.json'), JSON.stringify(req, null, 2), 'utf8')
  setTimeout(() => {
    try { process.exit(0) } catch (error) { /* nothing else we can do */ }
  }, EXIT_DELAY_MS)
  return { ok: true, version: target, message: '正在更新到 ' + target + '，界面将自动重启，请稍候…' }
}

function json(res, status, obj) {
  const body = JSON.stringify(obj)
  try {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch (error) {
    // connection already gone; nothing to do
  }
}

/** Collect a request body as a string with a hard size cap. */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let tooBig = false
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > limit) {
        tooBig = true
        req.destroy()
        return
      }
      chunks.push(String(chunk))
    })
    req.on('end', () => {
      if (tooBig) {
        reject(new Error('request body too large'))
        return
      }
      resolve(chunks.join(''))
    })
    req.on('error', reject)
  })
}

export function apply(ctx) {
  // webServer is provided by a row that itself waits on webStartup, so it may
  // not exist yet when this row activates; inject() defers until it does.
  ctx.inject(['webServer'], (webCtx) => {
    let updating = false

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: '/dsh-updater',
      handler: async (req, res) => {
        const url = (req.url || '').split('?')[0]
        try {
          if (url === '/dsh-updater/check' && (req.method === 'GET' || req.method === 'HEAD')) {
            json(res, 200, await checkPayload())
            return
          }
          if (url === '/dsh-updater/update' && req.method === 'POST') {
            if (updating) {
              json(res, 409, { ok: false, error: '更新正在进行中，请稍候' })
              return
            }
            updating = true
            try {
              if (!isDesktopMode()) {
                json(res, 200, { ok: false, error: '请通过 DSH-Desktop-Huacai 启动后再更新（当前不是内置版）' })
                return
              }
              let body = null
              try {
                const raw = await readBody(req, 8192)
                if (raw.trim()) body = JSON.parse(raw)
              } catch (error) { /* no/empty body is fine */ }
              const info = await checkPayload()
              if (info.error) {
                json(res, 200, { ok: false, error: info.error })
                return
              }
              const target = body && typeof body.version === 'string' && body.version
                ? body.version
                : info.latestVersion
              if (!target || !VERSION_RE.test(target)) {
                json(res, 200, { ok: false, error: '无效版本号: ' + String(target) })
                return
              }
              if (info.localVersion === target) {
                json(res, 200, { ok: false, error: '当前已是该版本，无需更新' })
                return
              }
              json(res, 200, requestUpdate(target))
            } finally {
              updating = false
            }
            return
          }
          res.writeHead(404)
          res.end('not found')
        } catch (error) {
          json(res, 500, { ok: false, error: error && error.message ? error.message : String(error) })
        }
      },
    }), 'updater: api routes')
  })
}
