// tools/test-terminal-pty.mjs — REAL embedded-terminal integration test.
//   node tools/test-terminal-pty.mjs
//
// Boots the dsh-editor plugin's terminal stack against a REAL node:http
// server: apply() with a fake ctx → captured upgrade handler → ws client →
// init → type a command → assert the ConPTY shell echoes it → restart the
// shell → assert a fresh meta arrives → cleanup. Verifies the whole host path
// (node-pty + ws + routes) without a full dsh boot.
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
const root = mkdtempSync(join(tmpdir(), 'dsh-term-pty-'))

const routes = []
const upgrades = []
const ctx = {
  get(name) {
    if (name === 'workspaceRegistry') return { list: () => [{ id: 'w', title: 'Pty', path: root }] }
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

const marker = 'PTY_WS_OK_' + Math.random().toString(36).slice(2, 8)
const ws = new WebSocket('ws://127.0.0.1:' + port + '/dsh-editor-terminal/ws')
let got = ''
let metas = 0
let firstMeta = null
let restarted = false
let done = false
let timedOut = false

function fail(message) {
  console.error('FAIL: ' + message)
  done = true
  try { ws.close() } catch (e) { /* ignore */ }
  setTimeout(() => process.exit(1), 200)
}
function finish(code, message) {
  done = true
  console.log(message)
  try { ws.close() } catch (e) { /* ignore */ }
  server.close()
  // let the shell die (it holds the temp cwd open), then clean up
  setTimeout(() => {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }) } catch (e) { /* best-effort */ }
    process.exit(code)
  }, 800)
}

const timer = setTimeout(() => {
  if (done) return
  timedOut = true
  fail('timed out; tail=' + JSON.stringify(got.slice(-300)))
}, 30000)

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'init', cols: 80, rows: 24 }))
})
ws.on('message', (raw) => {
  let msg = null
  try { msg = JSON.parse(String(raw)) } catch (e) { return }
  if (msg.t === 'meta') {
    metas += 1
    if (!firstMeta) {
      firstMeta = msg
      console.log('meta: shell=' + msg.shell + ' cwd=' + msg.cwd + ' pid=' + msg.pid)
      ws.send(JSON.stringify({ t: 'input', d: 'echo ' + marker + '\r' }))
    } else {
      console.log('restart meta: shell=' + msg.shell + ' cwd=' + msg.cwd + ' pid=' + msg.pid)
      if (done) return
      if (msg.cwd !== root) { fail('restart cwd mismatch: ' + msg.cwd); return }
      // shut the shell down so the temp cwd can be removed
      ws.send(JSON.stringify({ t: 'input', d: 'exit\r' }))
      finish(0, 'ALL PTY INTEGRATION TESTS PASSED')
    }
  } else if (msg.t === 'out') {
    got += msg.d
    if (got.includes(marker) && !restarted) {
      restarted = true
      console.log('✓ echo round trip through ConPTY: ' + marker)
      if (firstMeta.cwd !== root) { fail('cwd mismatch: ' + firstMeta.cwd); return }
      console.log('✓ cwd = workspace root')
      setTimeout(() => { if (!done) ws.send(JSON.stringify({ t: 'restart' })) }, 300)
    }
  } else if (msg.t === 'exit') {
    if (done) return
    if (!restarted) fail('shell exited early') // exit before marker: bad
  } else if (msg.t === 'err') {
    fail('server error: ' + msg.m)
  }
})
ws.on('close', () => {
  clearTimeout(timer)
  if (!done && !timedOut) {
    console.error('FAIL: connection closed early')
    server.close()
    rmSync(root, { recursive: true, force: true })
    process.exit(1)
  }
})
