// tools/test-terminal-tabs-browser.mjs — headless Chrome CDP check of the
// 1.13 terminal: tab bar renders, + creates a second tab, tab switching works,
// cursor hugs the prompt text (gap fix), closing a tab works.
//   node tools/test-terminal-tabs-browser.mjs [url]
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.argv[2] || 'http://127.0.0.1:3080/'
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
if (!browser) { console.error('FAIL: no Chrome/Edge'); process.exit(1) }

const debugPort = 9800 + Math.floor(Math.random() * 100)
const profile = join(tmpdir(), 'dsh-cdp-' + Date.now())
const chrome = spawn(browser, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + debugPort, '--user-data-dir=' + profile,
  '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets = null
for (let i = 0; i < 60; i++) {
  await sleep(500)
  try {
    const res = await fetch('http://127.0.0.1:' + debugPort + '/json/list')
    targets = await res.json()
    if (targets && targets.length > 0) break
  } catch (e) { /* not up */ }
}
if (!targets || targets.length === 0) { console.error('FAIL: cdp endpoint'); chrome.kill(); process.exit(1) }
const page = targets.find((t) => t.type === 'page') || targets[0]
const ws = new WebSocket(page.webSocketDebuggerUrl)
let msgId = 0
const pending = new Map()
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
})
await new Promise((resolve) => ws.on('open', resolve))
await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url })
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result && r.result.value
}
let failures = 0
function check(cond, label, extra) {
  console.log((cond ? '✓ ' : '✗ FAIL: ') + label + (extra ? ' — ' + extra : ''))
  if (!cond) failures += 1
}

let found = false
for (let i = 0; i < 120; i++) {
  await sleep(1000)
  try { found = await evalJs("!!document.querySelector('button[aria-label=\"打开终端\"]')") } catch (e) { /* */ }
  if (found) break
}
check(found, 'terminal button found')
if (!found) { chrome.kill(); process.exit(1) }

await evalJs("document.querySelector('button[aria-label=\"打开终端\"]').click()")
await sleep(5000)

async function snap(label) {
  const s = await evalJs(`(function () {
    const d = window.__dshEditorTerm
    const tabs = Array.from(document.querySelectorAll('.dsh-editor-term-tab')).map(function (el) {
      return { label: el.querySelector('.dsh-editor-term-tab-label').textContent, active: el.className.indexOf('active') !== -1 }
    })
    const addBtn = !!document.querySelector('.dsh-editor-term-tab-add')
    const cur = document.querySelector('.dsh-editor-term-cursor')
    const lines = Array.from(document.querySelectorAll('.dsh-editor-term-line')).filter(function (el) { return el.style.visibility !== 'hidden' })
    const first = lines.length ? (lines[0].innerText || '') : ''
    return {
      status: d ? d.status() : null,
      tabs,
      addBtn,
      activeSid: d ? d.activeSid() : null,
      cursor: d ? d.emuCursor() : null,
      curLeft: cur ? cur.style.left : null,
      firstLine: first.replace(/\\s+$/, ''),
      meta: d ? d.meta() : null,
    }
  })()`)
  console.log('--- ' + label + ' ---')
  console.log(JSON.stringify(s, null, 1))
  return s
}

// 1. initial: one tab (PowerShell), cursor after the prompt
let s = await snap('initial')
check(s.tabs.length >= 1, 'at least one tab rendered')
check(s.status === 'open', 'terminal open')
const firstLine = s.firstLine || ''
const m = firstLine.match(/PS [^>]+>$/)
check(!!m, 'prompt shows compact leaf (no full path in viewport)', JSON.stringify(firstLine))
check(s.cursor && s.cursor.c <= (firstLine.length + 1), 'cursor column near prompt text end', JSON.stringify(s.cursor))

// 2. create a second tab via +
await evalJs("document.querySelector('.dsh-editor-term-tab-add').click()")
await sleep(4000)
s = await snap('after +')
check(s.tabs.length >= 2, 'second tab created')
const secondActive = s.tabs.filter((t) => t.active).length === 1
check(secondActive, 'exactly one active tab')

// 3. switch back to the first tab
const firstSid = await evalJs("Array.from(document.querySelectorAll('.dsh-editor-term-tab'))[0].getAttribute ? null : null")
const firstTab = await evalJs(`(function () {
  const el = document.querySelectorAll('.dsh-editor-term-tab')[0]
  el.click()
  return window.__dshEditorTerm.activeSid()
})()`)
await sleep(2500)
s = await snap('after switch to first tab')
check(s.tabs[0] && s.tabs[0].active, 'first tab active after click')
const curSid = await evalJs('window.__dshEditorTerm.activeSid()')
const sidOk = curSid && curSid !== 'null' && typeof curSid === 'string'
check(sidOk, 'activeSid is a real session id', JSON.stringify(curSid))

// 4. cursor gap: effective cursor must sit right after the prompt text
const gapInfo = await evalJs(`(function () {
  const d = window.__dshEditorTerm
  const emu = d.emu()
  const lines = Array.from(document.querySelectorAll('.dsh-editor-term-line')).filter(function (el) { return el.style.visibility !== 'hidden' })
  const text = lines.length ? (lines[0].innerText || '') : ''
  const cur = d.emuCursor()
  const cursorEl = document.querySelector('.dsh-editor-term-cursor')
  return { text: text.replace(/\\s+$/, ''), cursorCol: cur ? cur.c : null, cursorLeft: cursorEl ? cursorEl.style.left : null, emu }
})()`)
const textLen = (gapInfo.text || '').length
check(gapInfo.cursorCol <= textLen + 1, 'cursor hugs the prompt text (gap fix)', JSON.stringify({ textLen, cursorCol: gapInfo.cursorCol }))

// 5. close the second tab via its ×
const closeBtn = await evalJs(`(function () {
  const tabs = document.querySelectorAll('.dsh-editor-term-tab')
  if (tabs.length < 2) return 'none'
  const close = tabs[1].querySelector('.dsh-editor-term-tab-close')
  close.click()
  return 'clicked'
})()`)
await sleep(2500)
s = await snap('after closing tab 2')
check(s.tabs.length === 1, 'tab count back to 1 after close', JSON.stringify(s.tabs.map((t) => t.label)))

ws.close(); chrome.kill()
console.log(failures === 0 ? '\nALL BROWSER TAB TESTS PASSED' : '\n' + failures + ' CHECK(S) FAILED')
process.exit(failures === 0 ? 0 : 2)
