// tools/test-browser-terminal.mjs — headless-Chrome CDP diagnosis of the
// embedded terminal panel. Loads the real dsh GUI, clicks the terminal
// button, then dumps console errors + plugin state + a screenshot.
//   node tools/test-browser-terminal.mjs [url] [screenshot.png]
import { existsSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.argv[2] || 'http://127.0.0.1:3080/'
const shotPath = process.argv[3] || join(here, '..', '_build', 'terminal-shot.png')

// ── locate a Chromium browser ──
const appRoot = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'DSH-Desktop-Huacai', 'app', 'node_modules')
  : null
const req = createRequire(join(appRoot, 'node-pty', 'package.json'))
const WebSocket = req('ws')

const browserCandidates = [
  process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe',
  process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
  process.env.PROGRAMFILES + '\\Microsoft\\Edge\\Application\\msedge.exe',
  process.env['PROGRAMFILES(X86)'] + '\\Microsoft\\Edge\\Application\\msedge.exe',
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
]
const browser = browserCandidates.find((p) => p && existsSync(p))
if (!browser) {
  console.error('FAIL: no Chrome/Edge found')
  process.exit(1)
}
console.log('browser:', browser)

// ── launch headless with remote debugging ──
const debugPort = 9333 + Math.floor(Math.random() * 200)
const profile = join(tmpdir(), 'dsh-cdp-' + Date.now())
const chrome = spawn(browser, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-port=' + debugPort,
  '--user-data-dir=' + profile,
  '--window-size=1440,900',
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets = null
for (let i = 0; i < 60; i++) {
  await sleep(500)
  try {
    const res = await fetch('http://127.0.0.1:' + debugPort + '/json/list')
    targets = await res.json()
    if (targets && targets.length > 0) break
  } catch (e) { /* chrome not up yet */ }
}
if (!targets || targets.length === 0) {
  console.error('FAIL: chrome debugging endpoint not reachable')
  chrome.kill()
  process.exit(1)
}

// ── CDP session ──
const page = targets.find((t) => t.type === 'page') || targets[0]
const ws = new WebSocket(page.webSocketDebuggerUrl)
let msgId = 0
const pending = new Map()
const consoleLogs = []
const exceptions = []

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++msgId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params: params || {} }))
  })
}

ws.on('message', (raw) => {
  let msg = null
  try { msg = JSON.parse(String(raw)) } catch (e) { return }
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error.message))
    else p.resolve(msg.result)
    return
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const args = (msg.params.args || []).map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ')
    consoleLogs.push('[console.' + msg.params.type + '] ' + args.slice(0, 300))
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails
    const text = d.exception ? (d.exception.description || d.exception.value) : d.text
    exceptions.push(String(text).slice(0, 500))
  }
})

await new Promise((resolve) => ws.on('open', resolve))

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')
await send('Page.navigate', { url })
console.log('navigated to', url)

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + JSON.stringify(r.exceptionDetails.exception))
  return r.result && r.result.value
}

// ── wait for the terminal button (client plugin boot) ──
let found = false
for (let i = 0; i < 120; i++) {
  await sleep(1000)
  try {
    found = await evalJs("!!document.querySelector('button[aria-label=\"打开终端\"]')")
  } catch (e) { /* page still loading */ }
  if (found) { console.log('terminal button found after', i + 1, 's'); break }
}
if (!found) {
  console.log('FAIL: terminal button never appeared')
  console.log('--- console logs ---')
  consoleLogs.slice(0, 40).forEach((l) => console.log('  ' + l))
  console.log('--- exceptions ---')
  exceptions.slice(0, 10).forEach((l) => console.log('  ' + l))
  try {
    const bodyText = await evalJs('document.body.innerText.slice(0, 400)')
    console.log('body text:', JSON.stringify(bodyText))
  } catch (e) { /* ignore */ }
  ws.close(); chrome.kill(); rmSync(profile, { recursive: true, force: true })
  process.exit(1)
}

// ── click the terminal button, wait, then diagnose ──
await evalJs("document.querySelector('button[aria-label=\"打开终端\"]').click()")
await sleep(5000)

let diag = null
try {
  diag = await evalJs(`(function () {
    const panel = document.querySelector('.dsh-editor-term-panel')
    const viewport = document.querySelector('.dsh-editor-term-viewport')
    const lines = viewport ? Array.from(viewport.querySelectorAll('.dsh-editor-term-line')).filter(function (el) { return el.style.visibility !== 'hidden' }) : []
    const d = window.__dshEditorTerm
    return {
      hasPanel: !!panel,
      panelHeight: panel ? panel.offsetHeight : 0,
      panelLeft: panel ? getComputedStyle(panel).left : null,
      bodyTermOpen: document.body.classList.contains('dsh-editor-terminal-open'),
      viewportChildren: viewport ? viewport.children.length : 0,
      visibleLines: lines.length,
      firstLineHtml: lines.length ? (lines[0].innerHTML || '').slice(0, 120) : '',
      status: d ? d.status() : null,
      error: d ? d.error() : null,
      meta: d ? d.meta() : null,
      wsState: d ? d.wsState() : null,
      wsUrl: d ? d.wsUrl() : null,
      emu: d ? d.emu() : null,
      emuCursor: d ? d.emuCursor() : null,
      els: d ? d.els() : null,
      cursorEl: (function () {
        const el = document.querySelector('.dsh-editor-term-cursor')
        if (!el) return null
        return { left: el.style.left, top: el.style.top, w: el.style.width, h: el.style.height, vis: el.style.visibility }
      })(),
      lineInfo: (function () {
        const lines = Array.from(document.querySelectorAll('.dsh-editor-term-line')).filter(function (el) { return el.style.visibility !== 'hidden' })
        return lines.map(function (el) {
          const text = (el.innerText || '').replace(/\s+$/, '')
          return { top: el.style.top, textLen: text.length, text: text.slice(0, 60) }
        })
      })(),
      panelWidth: (function () {
        const p = document.querySelector('.dsh-editor-term-panel')
        return p ? p.offsetWidth : 0
      })(),
      footerButtons: Array.from(document.querySelectorAll('[data-slot="sidebar.footer.action"] button')).map(function (b) { return b.getAttribute('aria-label') || b.innerText }),
    }
  })()`)
} catch (e) {
  console.log('diagnostic eval failed:', e.message)
}

const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot && shot.data) {
  writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
  console.log('screenshot:', shotPath)
}

console.log('--- diagnostics ---')
console.log(JSON.stringify(diag, null, 2))
console.log('--- console logs (tail 25) ---')
consoleLogs.slice(-25).forEach((l) => console.log('  ' + l))
console.log('--- exceptions (up to 10) ---')
exceptions.slice(0, 10).forEach((l) => console.log('  ' + l))

ws.close()
chrome.kill()
for (let i = 0; i < 5; i++) {
  try { rmSync(profile, { recursive: true, force: true }); break } catch (e) { await sleep(500) }
}
console.log('done')
process.exit(diag && diag.status === 'open' && diag.visibleLines > 0 ? 0 : 2)
