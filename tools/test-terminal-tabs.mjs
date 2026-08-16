// tools/test-terminal-tabs.mjs — 1.13 multi-session (VS Code tabs) WS test.
//   node tools/test-terminal-tabs.mjs
//
// Boots the plugin's terminal stack against a REAL node:http server (same
// harness as test-terminal-pty.mjs) and verifies the tab protocol end to end:
//   list(empty) → new A (PowerShell @wa) → new B (CMD @wb) → sid-routed echo →
//   list shows both → attach A replay → close B → removed → A still usable.
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'

const appRoot = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'DSH-Desktop-Huacai', 'app', 'node_modules')
  : null
if (!appRoot) { console.error('FAIL: no app root'); process.exit(1) }
const req = createRequire(join(appRoot, 'node-pty', 'package.json'))
const WebSocket = req('ws')

const mod = await import('../dsh-bundle/plugin/@local/dsh-editor/lib/index.js')
const rootA = mkdtempSync(join(tmpdir(), 'dsh-term-tabs-a-'))
const rootB = mkdtempSync(join(tmpdir(), 'dsh-term-tabs-b-'))

const routes = []
const upgrades = []
const ctx = {
  get(name) {
    if (name === 'workspaceRegistry') return { list: () => [
      { id: 'wa', title: 'TabA', path: rootA },
      { id: 'wb', title: 'TabB', path: rootB },
    ] }
    return undefined
  },
  inject(deps, cb) {
    cb({
      effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d() } },
      webServer: {
        register: (r) => { routes.push(r); return () => {} },
        registerUpgrade: (r) => { upgrades.push(r); return () => {} },
      },
    })
  },
}
mod.apply(ctx)
const upgrade = upgrades.find((u) => u.path === '/dsh-editor-terminal/ws')
if (!upgrade) { console.error('FAIL: ws upgrade route missing'); process.exit(1) }

const server = http.createServer((req2, res2) => { res2.writeHead(404); res2.end() })
server.on('upgrade', (req2, socket, head) => { upgrade.handler(req2, socket, head) })
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const marker = 'TABS_OK_' + Math.random().toString(36).slice(2, 8)
const ws = new WebSocket('ws://127.0.0.1:' + port + '/dsh-editor-terminal/ws?root=wa')
let done = false
let timedOut = false
let step = 'list-empty'
const sids = { A: null, B: null }
let bEcho = false
let aEchoAfterClose = false
let aLeak = false

function fail(message) {
  console.error('FAIL: ' + message)
  done = true
  try { ws.close() } catch (e) { /* ignore */ }
  setTimeout(() => process.exit(1), 200)
}
function finish(message) {
  done = true
  console.log(message)
  try { ws.close() } catch (e) { /* ignore */ }
  server.close()
  setTimeout(() => {
    for (const d of [rootA, rootB]) { try { rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }) } catch (e) { /* best-effort */ } }
    process.exit(0)
  }, 800)
}
const timer = setTimeout(() => { if (!done) { timedOut = true; fail('timed out at step ' + step) } }, 40000)

function send(obj) { ws.send(JSON.stringify(obj)) }

ws.on('open', () => send({ t: 'list' }))
ws.on('message', (raw) => {
  let msg = null
  try { msg = JSON.parse(String(raw)) } catch (e) { return }
  if (msg.t === 'list') {
    const list = Array.isArray(msg.sessions) ? msg.sessions : []
    if (step === 'list-empty') {
      if (list.length !== 0) { fail('expected empty list, got ' + list.length); return }
      console.log('✓ list empty on first open')
      step = 'new-a'
      send({ t: 'new', cols: 80, rows: 24, root: 'wa' })
      return
    }
    if (step === 'list-two') {
      if (list.length !== 2) { fail('expected 2 sessions, got ' + list.length); return }
      console.log('✓ list shows both sessions: ' + list.map((s) => s.shell).join(' + '))
      step = 'attach-a'
      send({ t: 'attach', sid: sids.A, cols: 80, rows: 24 })
      return
    }
    if (step === 'list-one') {
      if (list.length !== 1 || String(list[0].sid) !== sids.A) { fail('expected only session A after close, got ' + JSON.stringify(list)); return }
      console.log('✓ close removed session B from the server list')
      finish('ALL MULTI-SESSION (TABS) TESTS PASSED')
      return
    }
    return
  }
  if (msg.t === 'meta') {
    if (step === 'new-a') {
      if (msg.shell !== 'powershell.exe') { fail('session A should be powershell, got ' + msg.shell); return }
      if (msg.cwd !== rootA) { fail('session A cwd mismatch: ' + msg.cwd); return }
      sids.A = String(msg.sid)
      console.log('✓ session A created: shell=' + msg.shell + ' cwd=' + msg.cwd)
      step = 'new-b'
      send({ t: 'new', shell: 'cmd', cols: 80, rows: 24, root: 'wb' })
      return
    }
    if (step === 'new-b') {
      if (msg.shell !== 'cmd.exe') { fail('session B should be cmd, got ' + msg.shell); return }
      if (msg.cwd !== rootB) { fail('session B cwd mismatch: ' + msg.cwd); return }
      sids.B = String(msg.sid)
      console.log('✓ session B created: shell=' + msg.shell + ' cwd=' + msg.cwd)
      step = 'echo-b'
      send({ t: 'input', sid: sids.B, d: 'echo ' + marker + '\r' })
      return
    }
    if (step === 'attach-a') {
      if (String(msg.sid) !== sids.A) { fail('attach replay targeted wrong session'); return }
      console.log('✓ attach replays session A meta (shell=' + msg.shell + ')')
      step = 'close-b'
      send({ t: 'close', sid: sids.B })
      return
    }
    return
  }
  if (msg.t === 'out') {
    if (msg.sid === sids.A && step === 'echo-b' && msg.d && msg.d.indexOf(marker) !== -1) {
      aLeak = true // session B's echo leaked into session A — routing broken
      return
    }
    if (msg.sid === sids.B && step === 'echo-b' && msg.d && msg.d.indexOf(marker) !== -1) {
      bEcho = true
      console.log('✓ echo routed to the right session (sid=' + msg.sid + ')')
      step = 'list-two'
      send({ t: 'list' })
      return
    }
    if (msg.sid === sids.A && step === 'echo-a' && msg.d && msg.d.indexOf(marker + '_A') !== -1) {
      aEchoAfterClose = true
      console.log('✓ session A still works after B was closed')
      step = 'list-one'
      send({ t: 'list' })
      return
    }
    return
  }
  if (msg.t === 'removed') {
    if (String(msg.sid) !== sids.B) { fail('removed wrong session: ' + msg.sid); return }
    console.log('✓ removed broadcast for session B')
    step = 'echo-a'
    send({ t: 'input', sid: sids.A, d: 'echo ' + marker + '_A\r' })
    return
  }
  if (msg.t === 'err') { fail('server error: ' + msg.m) }
})
