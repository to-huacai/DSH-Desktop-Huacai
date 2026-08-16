// tools/test-terminal-ws.mjs — WebSocket smoke client for the embedded terminal.
//   node tools/test-terminal-ws.mjs <port> [--shell cmd]
//
// Connects to /dsh-editor-terminal/ws on a RUNNING dsh web server, sends the
// init frame, types `echo TERM_WS_OK_<rand>` and waits for the echoed text to
// come back through the ConPTY shell. Exit code 0 = full round trip works.
// Used by run-test.ps1 and the scratch-server e2e script.
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

const port = process.argv[2] || '3099'
const wantShell = process.argv.includes('--shell') ? process.argv[process.argv.indexOf('--shell') + 1] : undefined

function appNodeModulesRoot() {
  const candidates = [
    process.cwd() ? join(process.cwd(), 'app', 'node_modules') : null,
    process.execPath ? join(dirname(process.execPath), '..', 'app', 'node_modules') : null,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'DSH-Desktop-Huacai', 'app', 'node_modules') : null,
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    try { if (existsSync(join(candidate, 'node-pty', 'package.json'))) return candidate } catch (e) { /* next */ }
  }
  return null
}

const appRoot = appNodeModulesRoot()
if (!appRoot) {
  console.error('FAIL: app node_modules (node-pty) not found')
  process.exit(1)
}
const req = createRequire(join(appRoot, 'node-pty', 'package.json'))
const WebSocket = req('ws')

const marker = 'TERM_WS_OK_' + Math.random().toString(36).slice(2, 8)
const url = 'ws://127.0.0.1:' + port + '/dsh-editor-terminal/ws'
const ws = new WebSocket(url)
let got = ''
let meta = null
let timedOut = false

const timer = setTimeout(() => { timedOut = true; ws.close() }, 30000)

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'init', cols: 80, rows: 24, shell: wantShell === 'cmd' ? 'cmd' : undefined }))
})

ws.on('message', (raw) => {
  let msg = null
  try { msg = JSON.parse(String(raw)) } catch (e) { return }
  if (msg.t === 'meta') {
    meta = msg
    ws.send(JSON.stringify({ t: 'input', d: 'echo ' + marker + '\r' }))
  } else if (msg.t === 'out') {
    got += msg.d
    if (got.includes(marker)) {
      clearTimeout(timer)
      console.log('✓ ws round trip ok (shell=' + meta.shell + ', cwd=' + meta.cwd + ', pid=' + meta.pid + ')')
      try { ws.close() } catch (e) { /* ignore */ }
      process.exit(0)
    }
  }
})

ws.on('close', () => {
  clearTimeout(timer)
  if (timedOut) {
    console.error('FAIL: timed out; collected output tail: ' + JSON.stringify(got.slice(-400)))
    process.exit(1)
  }
  if (!meta) {
    console.error('FAIL: no meta frame received')
    process.exit(1)
  }
  if (!got.includes(marker)) {
    console.error('FAIL: marker not echoed back; output tail: ' + JSON.stringify(got.slice(-400)))
    process.exit(1)
  }
  console.log('✓ ws round trip ok (shell=' + meta.shell + ', cwd=' + meta.cwd + ', pid=' + meta.pid + ')')
  process.exit(0)
})
