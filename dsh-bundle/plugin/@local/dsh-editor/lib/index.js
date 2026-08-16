/**
 * @local/dsh-editor — node half (DSH-Desktop-Huacai embedded edition).
 *
 * Serves the file API used by the editor-mode browser half:
 *   GET  /dsh-editor/roots        → { ok, workspaces: [{ id, title, path }] }
 *   GET  /dsh-editor/tree?root=   → { ok, root, title, tree, truncated }
 *   GET  /dsh-editor/file?root=&path= → { ok, path, content, size }
 *   POST /dsh-editor/file         → body { root, path, content } → { ok, path }
 *   POST /dsh-editor-terminal/open → body { root?, dryRun? } → { ok, shell, cwd }
 *   WS   /dsh-editor-terminal/ws  → Qoder-style EMBEDDED terminal: a ConPTY
 *         shell (node-pty, bundled inside the dsh app) relayed over JSON
 *         WebSocket frames ({t:'init'|'input'|'resize'|'restart'} ←→
 *         {t:'meta'|'hist'|'out'|'exit'|'err'}).
 *
 * Security model:
 *   - The tree/file endpoints only ever resolve paths under a workspace taken
 *     from the runtime workspaceRegistry by id — the client never supplies an
 *     absolute path.
 *   - Relative paths are sanitized (`..` and absolute segments rejected).
 *   - Text reads are capped (2 MB) so the browser never ingests a huge file;
 *     binary/known-heavy extensions are skipped in the tree walk.
 *   - The terminal endpoints (1.12) run shells on the LOCAL machine — the
 *     browser is expected to be on the same host (the desktop launcher serves
 *     127.0.0.1). The working directory is resolved from the workspace
 *     registry (never a client-supplied absolute path); `dryRun: true`
 *     validates resolution without spawning a window.
 *
 * Install: place this package under the profile's node_modules and add one
 * row to the profile cordis.patch.yml (see install-skin-plugin.mjs companion
 * list), then restart dsh.
 */

import { promises as fsp } from 'node:fs'
import { existsSync } from 'node:fs'
import { join, dirname, normalize, sep } from 'node:path'
import { createRequire } from 'node:module'
import cp from 'node:child_process' // CJS default export; tests stub cp.spawn
import { homedir } from 'node:os'

/** Cordis plugin name. */
export const name = 'editor'

const MAX_TREE_DEPTH = 7
const MAX_TREE_ENTRIES = 6000
const MAX_FILE_BYTES = 2 * 1024 * 1024 // 2 MB text cap
const MAX_POST_BYTES = 8 * 1024 * 1024 // POST body cap

/** Directories never shown in the file tree (build/vendor/ignored). */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', '.idea', '.vscode', '.next', '.nuxt',
  '.turbo', '.cache', 'dist', 'build', '_build', 'out', 'target', 'bin', 'obj',
  'coverage', 'build-cache', '.dsh', '.DS_Store',
])

/** File names never shown in the file tree. */
const SKIP_FILE_RE = /\.(exe|dll|so|dylib|zip|7z|rar|tar|gz|png|jpe?g|gif|webp|bmp|ico|icns|pdf|woff2?|ttf|eot|otf|mp4|webm|mkv|avi|mov|mp3|wav|flac|ogg|bin|dat|class|jar|pyc|obj|o|a|lib|pdb)$/i

/** Concise error message helper. */
function msg(error) {
  return error && error.message ? error.message : String(error)
}

/** Escape HTML (used for error text only). */
function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Resolve a workspace entity by id; falls back to the first workspace. */
function workspaceById(ctx, id) {
  const registry = ctx.get('workspaceRegistry')
  if (!registry) return null
  let all = []
  try {
    all = registry.list()
  } catch (error) {
    return null
  }
  if (!Array.isArray(all) || all.length === 0) return null
  if (id !== undefined && id !== null && id !== '') {
    const found = all.find((w) => String(w && w.id) === String(id))
    if (found) return found
  }
  return all[0]
}

/**
 * Build a nested tree for one directory. `relDir` uses '/' separators
 * relative to the workspace root. Caps depth and total entries.
 */
async function walkDir(rootAbs, relDir, depth, out, stats) {
  if (depth > MAX_TREE_DEPTH) return
  if (stats.entries >= MAX_TREE_ENTRIES) return
  let dirents
  try {
    dirents = await fsp.readdir(join(rootAbs, relDir), { withFileTypes: true })
  } catch (error) {
    return // unreadable dir (permission / vanished) — skip silently
  }
  dirents.sort((a, b) => {
    const ad = a.isDirectory() ? 0 : 1
    const bd = b.isDirectory() ? 0 : 1
    if (ad !== bd) return ad - bd
    return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0
  })
  for (const entry of dirents) {
    if (stats.entries >= MAX_TREE_ENTRIES) return
    const name = entry.name
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      const rel = relDir ? relDir + '/' + name : name
      const node = { name, kind: 'dir', path: rel, children: [] }
      out.push(node)
      stats.entries += 1
      await walkDir(rootAbs, rel, depth + 1, node.children, stats)
    } else if (entry.isFile()) {
      if (SKIP_FILE_RE.test(name)) continue
      const rel = relDir ? relDir + '/' + name : name
      let size = 0
      try {
        const st = await fsp.stat(join(rootAbs, rel))
        size = st.size
      } catch (error) { /* size best-effort */ }
      out.push({ name, kind: 'file', path: rel, size })
      stats.entries += 1
    }
    // symlinks are intentionally skipped (avoid loops / surprises)
  }
}

/**
 * Resolve a client-supplied relative path inside a workspace root.
 * Rejects absolute paths, `..` escapes, and anything outside the root.
 * Returns an absolute OS path or null.
 */
function safeResolve(rootAbs, rel) {
  if (typeof rel !== 'string' || rel.length === 0) return null
  const cleaned = rel.replace(/\\/g, '/')
  if (cleaned.startsWith('/')) return null
  if (/(^|\/)\.\.(\/|$)/.test(cleaned)) return null
  const parts = cleaned.split('/').filter((p) => p.length > 0 && p !== '.')
  if (parts.length === 0) return null
  const full = normalize(join(rootAbs, ...parts))
  const rootNorm = normalize(rootAbs)
  if (full !== rootNorm && !full.startsWith(rootNorm + sep)) return null
  return full
}

/** JSON response helper. */
function json(res, status, obj) {
  const body = JSON.stringify(obj)
  try {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch (error) {
    // connection already gone
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

// ── native terminal (1.12) ─────────────────────────────────────────────────
// The desktop launcher runs the browser on the same machine, so opening a
// real terminal window from the web process is the intended UX: prefer
// Windows Terminal when installed, fall back to the classic cmd console.

/** Pick the terminal program for this OS. Returns { exe, kind } or null. */
function pickTerminal() {
  if (process.platform !== 'win32') return null
  try {
    // Windows Terminal ships an App Execution Alias in %LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe
    const local = process.env.LOCALAPPDATA
    if (local) {
      const alias = join(local, 'Microsoft', 'WindowsApps', 'wt.exe')
      if (existsSync(alias)) return { exe: alias, kind: 'wt' }
    }
  } catch (error) { /* env unavailable */ }
  // cmd.exe is always present on Windows and gives a visible console window
  // (detached spawn from a hidden parent allocates a new console).
  return { exe: 'cmd.exe', kind: 'cmd' }
}

/** Working directory for the terminal: requested workspace → DSH_HOME → home. */
function terminalCwd(ctx, root) {
  const ws = workspaceById(ctx, root || undefined)
  if (ws && ws.path) {
    try {
      if (existsSync(ws.path)) return ws.path
    } catch (error) { /* stat failed, keep looking */ }
  }
  if (process.env.DSH_HOME) {
    try {
      if (existsSync(process.env.DSH_HOME)) return process.env.DSH_HOME
    } catch (error) { /* ignore */ }
  }
  return homedir()
}

/** Spawn a detached native terminal rooted at `cwd`; never blocks. */
function spawnTerminal(kind, exe, cwd) {
  if (kind === 'wt') {
    const child = cp.spawn(exe, ['-d', cwd], {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: false, // explicit: the window MUST be visible
    })
    if (child && child.unref) child.unref()
    return
  }
  // cmd.exe MUST be launched through the `start` builtin: a directly spawned
  // cmd with ignored stdio reads EOF on stdin and exits immediately. `start`
  // allocates a fresh interactive console for the inner cmd (real console
  // stdio), which then persists until the user closes it. The outer cmd /c is
  // hidden (windowsHide) so only the terminal window appears.
  const child = cp.spawn('cmd.exe', ['/c', 'start', 'DSH Terminal', 'cmd', '/k'], {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  if (child && child.unref) child.unref()
}

/**
 * POST /dsh-editor-terminal/open — body { root?, dryRun? }.
 * NOTE: this lives on its OWN '/dsh-editor-terminal' prefix route: the app's
 * webServer matches prefix routes by path SEGMENT, so '/dsh-editor-terminal/*'
 * would never reach the '/dsh-editor' handler (and '/dsh-terminal/*' is owned
 * by the app's built-in in-web terminal API).
 */
async function handleTerminalOpen(ctx, req, res) {
  let body
  try {
    body = await readBody(req, MAX_POST_BYTES)
  } catch (error) {
    json(res, 413, { ok: false, error: esc(msg(error)) })
    return
  }
  let payload = null
  try {
    payload = body && body.trim() ? JSON.parse(body) : null
  } catch (error) {
    json(res, 400, { ok: false, error: '请求体不是合法 JSON' })
    return
  }
  const root = payload && typeof payload.root === 'string' ? payload.root : ''
  const cwd = terminalCwd(ctx, root)
  const term = pickTerminal()
  if (!term) {
    json(res, 500, { ok: false, error: '终端功能仅支持 Windows 桌面版' })
    return
  }
  // dryRun validates cwd/shell resolution without popping a window
  if (payload && payload.dryRun === true) {
    json(res, 200, { ok: true, dryRun: true, shell: term.kind, exe: term.exe, cwd })
    return
  }
  try {
    spawnTerminal(term.kind, term.exe, cwd)
    json(res, 200, { ok: true, shell: term.kind, cwd })
  } catch (error) {
    json(res, 500, { ok: false, error: '打开终端失败: ' + esc(msg(error)) })
  }
}

// ── embedded terminal (1.12): Qoder-style in-page PTY ──────────────────────
// A ConPTY shell runs inside the dsh web process (node-pty — bundled with the
// dsh app) and is relayed to the browser panel over a WebSocket. Zero new
// dependencies: `node-pty` and `ws` both ship inside the embedded app. When
// node-pty cannot be resolved (non-embedded dev installs), the WS endpoint
// answers with a readable error instead of crashing.

/** Locate the embedded app's node_modules (node-pty/ws live there, NOT in the
 *  profile's node_modules — the plugin must resolve them from the app). */
function appNodeModulesRoot() {
  const candidates = [
    process.cwd() ? join(process.cwd(), 'app', 'node_modules') : null,
    process.execPath ? join(dirname(process.execPath), '..', 'app', 'node_modules') : null,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'DSH-Desktop-Huacai', 'app', 'node_modules') : null,
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      if (existsSync(join(candidate, 'node-pty', 'package.json'))) return candidate
    } catch (error) { /* keep looking */ }
  }
  return null
}

/** node-pty module (ConPTY) or null when unavailable. */
function loadNodePty() {
  try {
    const appRoot = appNodeModulesRoot()
    if (!appRoot) return null
    const appRequire = createRequire(join(appRoot, 'node-pty', 'package.json'))
    return appRequire('node-pty') || null
  } catch (error) {
    return null
  }
}

/** `ws` WebSocketServer (noServer mode) or null when unavailable. */
function loadWsServer() {
  try {
    const appRoot = appNodeModulesRoot()
    if (!appRoot) return null
    const appRequire = createRequire(join(appRoot, 'node-pty', 'package.json'))
    // require('ws') resolves to the WebSocket class; the server lives on the
    // WebSocketServer named export (both are attachable statics).
    const wsLib = appRequire('ws')
    return (wsLib && wsLib.WebSocketServer) || null
  } catch (error) {
    return null
  }
}

const TERM_HISTORY_CAP = 600000 // bytes of raw output retained for replay
const TERM_MAX_LINES = 4000

/** One shared embedded-terminal session (shell keeps running while the panel
 *  is closed; reopening replays history). */
const termState = {
  pty: null,          // node-pty IPty or null
  ptyGen: 0,          // increments per spawn; stale exit events are ignored
  cwd: '',
  shell: '',
  cols: 100,
  rows: 30,
  exited: false,
  history: '',
  historyBytes: 0,
  sockets: new Set(), // attached WebSockets (multiple tabs can attach)
}

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10)
  if (Number.isNaN(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function termSendAll(message) {
  const text = JSON.stringify(message)
  for (const ws of Array.from(termState.sockets)) {
    try {
      if (ws.readyState === 1) ws.send(text)
    } catch (error) { /* socket gone */ }
  }
}

function termAppendHistory(data) {
  termState.history += data
  termState.historyBytes = termState.history.length
  if (termState.historyBytes > TERM_HISTORY_CAP) {
    termState.history = termState.history.slice(termState.historyBytes - TERM_HISTORY_CAP)
    termState.historyBytes = termState.history.length
  }
}

/** Kill the current session (if any); its exit event is ignored (stale gen). */
function termKillCurrent() {
  const pty = termState.pty
  termState.pty = null
  termState.exited = true
  if (pty) {
    try { pty.kill() } catch (error) { /* already gone */ }
  }
}

/** Spawn (or reuse) the embedded shell at `cwd`. */
function termEnsureSession(cwd, shell, cols, rows) {
  if (termState.pty && !termState.exited && termState.shell === shell) return termState
  termKillCurrent()
  const ptyMod = loadNodePty()
  if (!ptyMod) throw new Error('终端组件不可用（node-pty 未随应用加载）')
  const argv = shell === 'cmd.exe' ? ['cmd.exe'] : ['powershell.exe', '-NoLogo']
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
  const pty = ptyMod.spawn(argv[0], argv.slice(1), {
    name: 'xterm-256color',
    cols: clampInt(cols, 20, 500, 100),
    rows: clampInt(rows, 5, 200, 30),
    cwd,
    env,
    useConpty: true,
  })
  const gen = ++termState.ptyGen
  termState.pty = pty
  termState.cwd = cwd
  termState.shell = shell
  termState.exited = false
  termState.cols = clampInt(cols, 20, 500, 100)
  termState.rows = clampInt(rows, 5, 200, 30)
  termState.history = ''
  termState.historyBytes = 0
  pty.onData((data) => {
    if (termState.pty !== pty) return // stale session
    termAppendHistory(data)
    termSendAll({ t: 'out', d: data })
  })
  pty.onExit(({ exitCode }) => {
    if (termState.pty !== pty) return // stale exit (replaced by a restart)
    termState.pty = null
    termState.exited = true
    termSendAll({ t: 'exit', code: exitCode === undefined ? 0 : exitCode, gen })
  })
  return termState
}

/** Handle one WebSocket client of the embedded terminal. */
function handleTerminalWs(ws, req, ctx) {
  let attached = false
  let url
  try {
    url = new URL(req.url || '/', 'http://dsh.local')
  } catch (error) {
    try { ws.close(1008, 'bad url') } catch (e) { /* ignore */ }
    return
  }
  const cwd = terminalCwd(ctx, url.searchParams.get('root') || '')
  ws.on('message', (raw) => {
    let msg = null
    try { msg = JSON.parse(String(raw)) } catch (error) { return }
    if (!msg || typeof msg !== 'object') return
    if (!attached) {
      if (msg.t !== 'init') return
      try {
        const shell = msg.shell === 'cmd' ? 'cmd.exe' : 'powershell.exe'
        const session = termEnsureSession(cwd, shell, msg.cols, msg.rows)
        termState.sockets.add(ws)
        attached = true
        termSendTo(ws, {
          t: 'meta',
          cwd: session.cwd,
          shell: session.shell,
          pid: session.pty ? session.pty.pid : 0,
        })
        if (termState.history) termSendTo(ws, { t: 'hist', d: termState.history })
        if (termState.exited) termSendTo(ws, { t: 'exit', code: 0, gen: termState.ptyGen })
      } catch (error) {
        termSendTo(ws, { t: 'err', m: esc(msg(error)) })
        try { ws.close(1011, 'terminal unavailable') } catch (e) { /* ignore */ }
      }
      return
    }
    if (msg.t === 'input' && termState.pty && !termState.exited) {
      try { termState.pty.write(String(msg.d || '')) } catch (error) { /* ignore */ }
      return
    }
    if (msg.t === 'resize' && termState.pty && !termState.exited) {
      try {
        termState.pty.resize(
          clampInt(msg.cols, 20, 500, termState.cols),
          clampInt(msg.rows, 5, 200, termState.rows),
        )
      } catch (error) { /* ignore */ }
      return
    }
    if (msg.t === 'restart') {
      try {
        const shell = msg.shell === 'cmd' ? 'cmd.exe' : (termState.shell || 'powershell.exe')
        termEnsureSession(cwd, shell, msg.cols || termState.cols, msg.rows || termState.rows)
        termSendTo(ws, {
          t: 'meta',
          cwd: termState.cwd,
          shell: termState.shell,
          pid: termState.pty ? termState.pty.pid : 0,
        })
      } catch (error) {
        termSendTo(ws, { t: 'err', m: esc(msg(error)) })
      }
      return
    }
  })
  ws.on('close', () => { termState.sockets.delete(ws) })
  ws.on('error', () => { termState.sockets.delete(ws) })
}

function termSendTo(ws, message) {
  try { ws.send(JSON.stringify(message)) } catch (error) { /* ignore */ }
}

export function apply(ctx) {
  // webServer is provided by a row that itself waits on webStartup, so it may
  // not exist yet when this row activates; inject() defers until it does.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: '/dsh-editor',
      handler: async (req, res) => {
        const url = new URL(req.url || '/', 'http://dsh.local')
        const path = url.pathname
        try {
          // ── roots ──────────────────────────────────────────────────────
          if (path === '/dsh-editor/roots' && (req.method === 'GET' || req.method === 'HEAD')) {
            const registry = ctx.get('workspaceRegistry')
            const workspaces = registry && Array.isArray(registry.list())
              ? registry.list().map((w) => ({ id: String(w.id), title: w.title || w.path, path: w.path }))
              : []
            json(res, 200, { ok: true, workspaces })
            return
          }

          // ── tree ───────────────────────────────────────────────────────
          if (path === '/dsh-editor/tree' && (req.method === 'GET' || req.method === 'HEAD')) {
            const ws = workspaceById(ctx, url.searchParams.get('root'))
            if (!ws) {
              json(res, 404, { ok: false, error: '未找到工作区，请先在对话模式创建或选择一个工作区' })
              return
            }
            const tree = []
            const stats = { entries: 0 }
            await walkDir(ws.path, '', 0, tree, stats)
            json(res, 200, {
              ok: true,
              root: ws.path,
              title: ws.title || ws.path,
              tree,
              truncated: stats.entries >= MAX_TREE_ENTRIES,
            })
            return
          }

          // ── read file ──────────────────────────────────────────────────
          if (path === '/dsh-editor/file' && req.method === 'GET') {
            const ws = workspaceById(ctx, url.searchParams.get('root'))
            const rel = url.searchParams.get('path') || ''
            const full = ws ? safeResolve(ws.path, rel) : null
            if (!full) {
              json(res, 400, { ok: false, error: '无效路径' })
              return
            }
            try {
              const st = await fsp.stat(full)
              if (!st.isFile()) {
                json(res, 400, { ok: false, error: '不是文件' })
                return
              }
              if (st.size > MAX_FILE_BYTES) {
                json(res, 413, { ok: false, error: '文件过大（超过 2MB），请在外部编辑' })
                return
              }
              const content = await fsp.readFile(full, 'utf8')
              json(res, 200, { ok: true, path: rel, content, size: st.size })
            } catch (error) {
              json(res, 404, { ok: false, error: '读取失败: ' + esc(msg(error)) })
            }
            return
          }

          // ── write file ─────────────────────────────────────────────────
          if (path === '/dsh-editor/file' && req.method === 'POST') {
            let body
            try {
              body = await readBody(req, MAX_POST_BYTES)
            } catch (error) {
              json(res, 413, { ok: false, error: esc(msg(error)) })
              return
            }
            let payload = null
            try {
              payload = body && body.trim() ? JSON.parse(body) : null
            } catch (error) {
              json(res, 400, { ok: false, error: '请求体不是合法 JSON' })
              return
            }
            const ws = workspaceById(ctx, payload && payload.root)
            const rel = payload && typeof payload.path === 'string' ? payload.path : ''
            const content = payload && typeof payload.content === 'string' ? payload.content : null
            if (!ws || rel === '' || content === null) {
              json(res, 400, { ok: false, error: '参数不完整（root / path / content）' })
              return
            }
            const full = safeResolve(ws.path, rel)
            if (!full) {
              json(res, 400, { ok: false, error: '无效路径' })
              return
            }
            try {
              await fsp.mkdir(dirname(full), { recursive: true })
              await fsp.writeFile(full, content, 'utf8')
              json(res, 200, { ok: true, path: rel })
            } catch (error) {
              json(res, 500, { ok: false, error: '写入失败: ' + esc(msg(error)) })
            }
            return
          }

          res.writeHead(404)
          res.end('not found')
        } catch (error) {
          json(res, 500, { ok: false, error: esc(msg(error)) })
        }
      },
    }), 'dsh-editor: api routes')

    // Terminal endpoint on its own segment prefix (see handleTerminalOpen).
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: '/dsh-editor-terminal',
      handler: async (req, res) => {
        const url = new URL(req.url || '/', 'http://dsh.local')
        const path = url.pathname
        try {
          if (path === '/dsh-editor-terminal/open' && req.method === 'POST') {
            await handleTerminalOpen(ctx, req, res)
            return
          }
          res.writeHead(404)
          res.end('not found')
        } catch (error) {
          json(res, 500, { ok: false, error: esc(msg(error)) })
        }
      },
    }), 'dsh-editor: terminal route')

    // Embedded terminal WebSocket (Qoder-style in-page PTY). ws ships inside
    // the app; when it cannot be resolved the handler answers a readable err.
    const WsServer = loadWsServer()
    if (WsServer) {
      const wss = new WsServer({ noServer: true })
      webCtx.effect(() => webCtx.webServer.registerUpgrade({
        path: '/dsh-editor-terminal/ws',
        handler: (req, socket, head) => {
          wss.handleUpgrade(req, socket, head, (ws) => handleTerminalWs(ws, req, ctx))
        },
      }), 'dsh-editor: terminal websocket')
      webCtx.effect(() => () => {
        // teardown: detach every client, kill the shell, drop the server
        for (const ws of Array.from(termState.sockets)) {
          try { ws.terminate() } catch (error) { /* ignore */ }
        }
        termState.sockets.clear()
        termKillCurrent()
        try { wss.close() } catch (error) { /* ignore */ }
      }, 'dsh-editor: terminal teardown')
    } else {
      webCtx.effect(() => webCtx.webServer.registerUpgrade({
        path: '/dsh-editor-terminal/ws',
        handler: (req, socket) => {
          try {
            socket.end([
              'HTTP/1.1 503 Service Unavailable',
              'Connection: close',
              'Content-Type: text/plain; charset=utf-8',
              'Content-Length: 26',
              '',
              'embedded terminal unavailable',
            ].join('\r\n'))
          } catch (error) { /* ignore */ }
        },
      }), 'dsh-editor: terminal websocket (unavailable)')
    }
  })
}
