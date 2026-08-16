/**
 * @local/dsh-editor — node half (DSH-Desktop-Huacai embedded edition).
 *
 * Serves the file API used by the editor-mode browser half:
 *   GET  /dsh-editor/roots        → { ok, workspaces: [{ id, title, path }] }
 *   GET  /dsh-editor/tree?root=   → { ok, root, title, tree, truncated }
 *   GET  /dsh-editor/file?root=&path= → { ok, path, content, size }
 *   GET  /dsh-editor/image?root=&path= → raw image bytes (1.14; png/jpg/gif/
 *         webp/bmp/ico/avif, 30 MB cap, proper content-type) so the browser
 *         half can preview image files straight from an <img> tag
 *   POST /dsh-editor/file         → body { root, path, content } → { ok, path }
 *   POST /dsh-editor-terminal/open → body { root?, dryRun? } → { ok, shell, cwd }
 *   WS   /dsh-editor-terminal/ws  → Qoder-style EMBEDDED terminal: ConPTY
 *         shells (node-pty, bundled inside the dsh app) relayed over JSON
 *         WebSocket frames. 1.13 adds VS Code style tabs — every frame
 *         carries a `sid` and the panel multiplexes one socket across many
 *         sessions:
 *           client → {t:'list'} {t:'init'|'new'|'attach', sid?, shell?, cols, rows, root?}
 *                    {t:'input'|'resize'|'restart'|'close', sid?, ...}
 *           server → {t:'list', sessions:[{sid,shell,cwd,exited}]}
 *                    {t:'meta'|'hist'|'out'|'exit'|'err'|'removed', sid, ...}
 *
 * Security model:
 *   - The tree/file endpoints only ever resolve paths under a workspace taken
 *     from the runtime workspaceRegistry by id — the client never supplies an
 *     absolute path.
 *   - Relative paths are sanitized (`..` and absolute segments rejected).
 *   - Text reads are capped (2 MB) so the browser never ingests a huge file;
 *     binary/known-heavy extensions are skipped in the tree walk — EXCEPT
 *     images (1.14), which are listed and served read-only via /image.
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
const MAX_IMAGE_BYTES = 30 * 1024 * 1024 // 30 MB image cap (1.14)

/** Directories never shown in the file tree (build/vendor/ignored). */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', '.idea', '.vscode', '.next', '.nuxt',
  '.turbo', '.cache', 'dist', 'build', '_build', 'out', 'target', 'bin', 'obj',
  'coverage', 'build-cache', '.dsh', '.DS_Store',
])

/**
 * Image files the browser can render natively (1.14). These are SHOWN in the
 * file tree (previously skipped as binary) and served read-only through the
 * /dsh-editor/image endpoint so the editor can preview them.
 */
const IMAGE_FILE_RE = /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i

/** content-type per image extension (lowercase, no dot). */
const IMAGE_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
}

/**
 * File names never shown in the file tree. Images are intentionally NOT in
 * this list since 1.14 — they appear in the tree and open as a preview.
 */
const SKIP_FILE_RE = /\.(exe|dll|so|dylib|zip|7z|rar|tar|gz|icns|pdf|woff2?|ttf|eot|otf|mp4|webm|mkv|avi|mov|mp3|wav|flac|ogg|bin|dat|class|jar|pyc|obj|o|a|lib|pdb)$/i

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

/**
 * Find the registered workspace whose root contains `target` (the path itself
 * or any subdirectory of it). Case-insensitive, trailing-separator tolerant.
 * Returns the workspace entity or null. This is the ONLY way a client-supplied
 * path is ever accepted — it must live under a workspaceRegistry entry.
 */
function matchWorkspaceUnder(ctx, target) {
  if (typeof target !== 'string' || target.length === 0) return null
  const registry = ctx.get('workspaceRegistry')
  if (!registry) return null
  let all = []
  try {
    all = registry.list()
  } catch (error) {
    return null
  }
  if (!Array.isArray(all)) return null
  const norm = (p) => normalize(String(p || '')).replace(/[\\/]+$/, '').toLowerCase()
  const t = norm(target)
  for (const w of all) {
    if (!w || !w.path) continue
    const p = norm(w.path)
    if (t === p || t.startsWith(p + sep.toLowerCase())) return w
  }
  return null
}

/**
 * Working directory for a terminal, in priority order:
 *   1. the exact cwd the client resolved from the CURRENT session/project
 *      (accepted only when it lives under a registered workspace — 1.13),
 *   2. the requested workspace id → path,
 *   3. DSH_HOME, 4. the user home.
 */
function terminalCwd(ctx, root, cwdPath) {
  if (typeof cwdPath === 'string' && cwdPath) {
    const ws = matchWorkspaceUnder(ctx, cwdPath)
    if (ws) {
      try {
        if (existsSync(cwdPath)) return cwdPath
      } catch (error) { /* stat failed, keep looking */ }
    }
  }
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
 * POST /dsh-editor-terminal/open — body { root?, cwd?, dryRun? }.
 * `cwd` (1.13) is the current session/project directory resolved by the client
 * and is accepted only when it lives under a registered workspace.
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
  const cwdPath = payload && typeof payload.cwd === 'string' ? payload.cwd : ''
  const cwd = terminalCwd(ctx, root, cwdPath)
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

// ── embedded terminal (1.12/1.13): Qoder-style in-page PTY with tabs ───────
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

const TERM_HISTORY_CAP = 600000 // bytes of raw output retained per session
const TERM_MAX_SESSIONS = 8 // hard cap on concurrent shells (one per tab)

/**
 * Embedded-terminal sessions (1.13: VS Code style tabs). Each tab owns one
 * ConPTY shell; shells keep running while the panel is closed, and reopening
 * the panel replays each session's history. `sid` strings address sessions in
 * every WS frame; the panel multiplexes one WebSocket across all tabs.
 */
const termSessions = new Map() // sid -> session
let termNextSid = 1

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10)
  if (Number.isNaN(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

/** Send a JSON message to one WebSocket (best-effort). */
function termSendTo(ws, message) {
  try { ws.send(JSON.stringify(message)) } catch (error) { /* ignore */ }
}

/** Send a JSON message to every WebSocket attached to one session. */
function termSessionSend(session, message) {
  const text = JSON.stringify(message)
  for (const ws of Array.from(session.sockets)) {
    try {
      if (ws.readyState === 1) ws.send(text)
    } catch (error) { /* socket gone */ }
  }
}

/** Send a JSON message to every attached WebSocket across ALL sessions. */
function termBroadcast(message) {
  const text = JSON.stringify(message)
  const seen = new Set()
  for (const session of termSessions.values()) {
    for (const ws of Array.from(session.sockets)) {
      if (seen.has(ws)) continue
      seen.add(ws)
      try {
        if (ws.readyState === 1) ws.send(text)
      } catch (error) { /* socket gone */ }
    }
  }
}

/** True when a session still exists (used to guard stale pty events). */
function termAlive(session) {
  return !!session && termSessions.get(session.sid) === session
}

/** Append raw output to a session's replay history (capped). */
function termAppendHistory(session, data) {
  session.history += data
  session.historyBytes = session.history.length
  if (session.historyBytes > TERM_HISTORY_CAP) {
    session.history = session.history.slice(session.historyBytes - TERM_HISTORY_CAP)
    session.historyBytes = session.history.length
  }
}

/**
 * Spawn (or respawn) the shell of an existing session object. Compact prompts
 * keep the cursor hugging the prompt text: PowerShell renders `PS <leaf>`
 * (no trailing space — PSReadLine would otherwise emit `\x1b[1C` and leave a
 * blank cell between the prompt and the cursor), cmd renders `C>` via the
 * PROMPT env var (`/d` ignores any AutoRun that could override it).
 */
function termSpawnShell(session, shell, cols, rows) {
  if (session.pty) {
    try { session.pty.kill() } catch (error) { /* already gone */ }
  }
  const ptyMod = loadNodePty()
  if (!ptyMod) throw new Error('终端组件不可用（node-pty 未随应用加载）')
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
  let argv
  if (shell === 'cmd.exe') {
    argv = ['cmd.exe', '/d']
    env.PROMPT = '$N$G' // e.g. `C>` instead of `C:\full\path>`
  } else {
    argv = ['powershell.exe', '-NoLogo', '-NoExit', '-Command',
      'function prompt {"PS " + (Split-Path -Leaf (Get-Location)) + ">"}']
  }
  session.shell = shell
  session.cols = clampInt(cols, 20, 500, session.cols)
  session.rows = clampInt(rows, 5, 200, session.rows)
  session.history = ''
  session.historyBytes = 0
  const gen = ++session.ptyGen
  const pty = ptyMod.spawn(argv[0], argv.slice(1), {
    name: 'xterm-256color',
    cols: session.cols,
    rows: session.rows,
    cwd: session.cwd,
    env,
    useConpty: true,
  })
  session.pty = pty
  session.exited = false
  pty.onData((data) => {
    if (!termAlive(session) || session.pty !== pty) return // stale session
    termAppendHistory(session, data)
    termSessionSend(session, { t: 'out', sid: session.sid, d: data })
  })
  pty.onExit(({ exitCode }) => {
    if (!termAlive(session) || session.pty !== pty) return // stale exit (restarted)
    session.pty = null
    session.exited = true
    termSessionSend(session, { t: 'exit', sid: session.sid, code: exitCode === undefined ? 0 : exitCode, gen })
  })
  return session
}

/** Create a brand-new session (new tab) rooted at `cwd`. */
function termCreateSession(cwd, shell, cols, rows) {
  if (termSessions.size >= TERM_MAX_SESSIONS) {
    // make room by dropping the oldest exited session
    let oldest = null
    for (const session of termSessions.values()) {
      if (session.exited && (!oldest || session.createdAt < oldest.createdAt)) oldest = session
    }
    if (oldest) termDestroySession(oldest, true)
    else throw new Error('终端会话数已达上限（' + TERM_MAX_SESSIONS + '），请先关闭部分终端')
  }
  const session = {
    sid: String(termNextSid++),
    pty: null,
    ptyGen: 0,
    cwd,
    shell: shell === 'cmd.exe' ? 'cmd.exe' : 'powershell.exe',
    cols: clampInt(cols, 20, 500, 100),
    rows: clampInt(rows, 5, 200, 30),
    exited: false,
    history: '',
    historyBytes: 0,
    sockets: new Set(),
    createdAt: Date.now(),
  }
  termSessions.set(session.sid, session)
  try {
    termSpawnShell(session, session.shell, session.cols, session.rows)
  } catch (error) {
    termSessions.delete(session.sid)
    throw error
  }
  return session
}

/** Restart one existing session's shell in place (keeps its sid + cwd). */
function termRestartSession(session, shell, cols, rows) {
  if (!termAlive(session)) throw new Error('会话不存在')
  const nextShell = shell === 'cmd.exe' ? 'cmd.exe' : (shell === 'powershell.exe' ? 'powershell.exe' : session.shell)
  termSpawnShell(session, nextShell, cols, rows)
  return session
}

/** Kill + forget a session. When `broadcast !== false`, tell every client. */
function termDestroySession(session, broadcast) {
  if (!termAlive(session)) return
  termSessions.delete(session.sid)
  if (session.pty) {
    try { session.pty.kill() } catch (error) { /* already gone */ }
  }
  session.pty = null
  session.exited = true
  if (broadcast !== false) termBroadcast({ t: 'removed', sid: session.sid })
  session.sockets.clear()
}

/** Attach a socket to a session (both directions). */
function termAttachSocket(ws, session) {
  if (!ws.__termSids) ws.__termSids = new Set()
  if (!ws.__termSids.has(session.sid)) {
    ws.__termSids.add(session.sid)
    session.sockets.add(ws)
  }
}

/** Detach a socket from every session it was attached to. */
function termDetachSocket(ws) {
  if (!ws.__termSids) return
  for (const sid of ws.__termSids) {
    const session = termSessions.get(sid)
    if (session) session.sockets.delete(ws)
  }
  ws.__termSids.clear()
}

/** The session this socket implicitly addresses (first attached, else last). */
function termSocketSession(ws) {
  if (ws.__termSids && ws.__termSids.size > 0) {
    const sid = Array.from(ws.__termSids)[0]
    const session = termSessions.get(sid)
    if (session) return session
  }
  let last = null
  for (const session of termSessions.values()) last = session
  return last
}

/** Handle one WebSocket client of the embedded terminal. */
function handleTerminalWs(ws, req, ctx) {
  let url
  try {
    url = new URL(req.url || '/', 'http://dsh.local')
  } catch (error) {
    try { ws.close(1008, 'bad url') } catch (e) { /* ignore */ }
    return
  }
  const urlRoot = url.searchParams.get('root') || ''
  const urlCwd = url.searchParams.get('cwd') || ''
  const shellOf = (shell) => (shell === 'cmd' || shell === 'cmd.exe' ? 'cmd.exe' : 'powershell.exe')

  const sendSessionState = (session) => {
    termSendTo(ws, {
      t: 'meta',
      sid: session.sid,
      cwd: session.cwd,
      shell: session.shell,
      pid: session.pty ? session.pty.pid : 0,
    })
    if (session.history) termSendTo(ws, { t: 'hist', sid: session.sid, d: session.history })
    if (session.exited) termSendTo(ws, { t: 'exit', sid: session.sid, code: 0, gen: session.ptyGen })
  }

  ws.on('message', (raw) => {
    let msg = null
    try { msg = JSON.parse(String(raw)) } catch (error) { return }
    if (!msg || typeof msg !== 'object') return
    const sid = typeof msg.sid === 'string' && msg.sid ? msg.sid : null
    const session = sid ? termSessions.get(sid) : null
    switch (msg.t) {
      // ── session list (panel reopened / tab bar rebuild) ────────────────
      case 'list': {
        termSendTo(ws, {
          t: 'list',
          sessions: Array.from(termSessions.values()).map((s) => ({
            sid: s.sid, shell: s.shell, cwd: s.cwd, exited: s.exited,
          })),
        })
        return
      }

      // ── backward-compatible init: attach to / create the default session ─
      case 'init': {
        let target = null
        for (const s of termSessions.values()) target = s
        try {
          if (!target || target.exited) {
            target = termCreateSession(terminalCwd(ctx, urlRoot, urlCwd), shellOf(msg.shell), msg.cols, msg.rows)
          }
        } catch (error) {
          termSendTo(ws, { t: 'err', m: esc(msg(error)) })
          try { ws.close(1011, 'terminal unavailable') } catch (e) { /* ignore */ }
          return
        }
        termAttachSocket(ws, target)
        sendSessionState(target)
        return
      }

      // ── create a new session (new tab) ─────────────────────────────────
      case 'new': {
        let created
        try {
          const root = typeof msg.root === 'string' && msg.root ? msg.root : urlRoot
          const cwdPath = typeof msg.cwd === 'string' && msg.cwd ? msg.cwd : urlCwd
          created = termCreateSession(terminalCwd(ctx, root, cwdPath), shellOf(msg.shell), msg.cols, msg.rows)
        } catch (error) {
          termSendTo(ws, { t: 'err', m: esc(msg(error)) })
          return
        }
        termAttachSocket(ws, created)
        sendSessionState(created)
        return
      }

      // ── attach to an existing session (switch tab / reopen) ────────────
      case 'attach': {
        if (!session) {
          termSendTo(ws, { t: 'err', m: '会话不存在（可能已被关闭）' })
          return
        }
        termAttachSocket(ws, session)
        if (msg.cols && msg.rows && session.pty && !session.exited) {
          try {
            session.pty.resize(
              clampInt(msg.cols, 20, 500, session.cols),
              clampInt(msg.rows, 5, 200, session.rows),
            )
          } catch (error) { /* ignore */ }
        }
        sendSessionState(session)
        return
      }

      // ── input / resize / restart / close (sid optional: socket session) ─
      case 'input': {
        const target = session || termSocketSession(ws)
        if (target && target.pty && !target.exited) {
          try { target.pty.write(String(msg.d || '')) } catch (error) { /* ignore */ }
        }
        return
      }
      case 'resize': {
        const target = session || termSocketSession(ws)
        if (target && target.pty && !target.exited) {
          try {
            target.pty.resize(
              clampInt(msg.cols, 20, 500, target.cols),
              clampInt(msg.rows, 5, 200, target.rows),
            )
          } catch (error) { /* ignore */ }
        }
        return
      }
      case 'restart': {
        const target = session || termSocketSession(ws)
        if (!target) {
          termSendTo(ws, { t: 'err', m: '会话不存在' })
          return
        }
        try {
          termRestartSession(target, shellOf(msg.shell), msg.cols, msg.rows)
          termSendTo(ws, {
            t: 'meta',
            sid: target.sid,
            cwd: target.cwd,
            shell: target.shell,
            pid: target.pty ? target.pty.pid : 0,
          })
        } catch (error) {
          termSendTo(ws, { t: 'err', m: esc(msg(error)) })
        }
        return
      }
      case 'close': {
        const target = session || termSocketSession(ws)
        if (target) {
          if (ws.__termSids) ws.__termSids.delete(target.sid)
          target.sockets.delete(ws)
          termDestroySession(target, true)
        }
        return
      }
      default:
        return
    }
  })
  ws.on('close', () => termDetachSocket(ws))
  ws.on('error', () => termDetachSocket(ws))
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

          // ── read image (1.14): raw bytes for an <img> preview ───────────
          if (path === '/dsh-editor/image' && req.method === 'GET') {
            const ws = workspaceById(ctx, url.searchParams.get('root'))
            const rel = url.searchParams.get('path') || ''
            const full = ws ? safeResolve(ws.path, rel) : null
            // extension whitelist: the endpoint never doubles as a generic
            // binary downloader — only renderable image types are served
            if (!full || !IMAGE_FILE_RE.test(rel)) {
              json(res, 400, { ok: false, error: '无效图片路径' })
              return
            }
            try {
              const st = await fsp.stat(full)
              if (!st.isFile()) {
                json(res, 400, { ok: false, error: '不是文件' })
                return
              }
              if (st.size > MAX_IMAGE_BYTES) {
                json(res, 413, { ok: false, error: '图片过大（超过 30MB）' })
                return
              }
              const extMatch = /\.([A-Za-z0-9]+)$/.exec(rel)
              const mime = IMAGE_MIME[extMatch ? extMatch[1].toLowerCase() : ''] || 'application/octet-stream'
              const data = await fsp.readFile(full)
              try {
                res.writeHead(200, {
                  'content-type': mime,
                  'content-length': data.length,
                  'cache-control': 'no-store',
                })
                res.end(data)
              } catch (error) {
                // connection already gone
              }
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
        // teardown: detach every client, kill every shell, drop the server
        for (const session of Array.from(termSessions.values())) {
          for (const ws of Array.from(session.sockets)) {
            try { ws.terminate() } catch (error) { /* ignore */ }
          }
          session.sockets.clear()
          if (session.pty) {
            try { session.pty.kill() } catch (error) { /* ignore */ }
          }
          session.pty = null
        }
        termSessions.clear()
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
