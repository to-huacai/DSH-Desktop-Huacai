// E2E: switch the selected session to the OTHER workspace, then verify a new
// terminal tab follows the newly selected project.
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const appRoot = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'DSH-Desktop-Huacai', 'app', 'node_modules') : null
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
const debugPort = 9930 + Math.floor(Math.random() * 60)
const profile = join(tmpdir(), 'dsh-cdp-' + Date.now())
const chrome = spawn(browser, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + debugPort, '--user-data-dir=' + profile,
  '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets = null
for (let i = 0; i < 60; i++) { await sleep(500); try { const res = await fetch('http://127.0.0.1:' + debugPort + '/json/list'); targets = await res.json(); if (targets && targets.length) break } catch (e) { /* */ } }
const page = targets.find((t) => t.type === 'page') || targets[0]
const ws = new WebSocket(page.webSocketDebuggerUrl)
let msgId = 0
const pending = new Map()
function send(method, params) { return new Promise((resolve, reject) => { const id = ++msgId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params: params || {} })) }) }
ws.on('message', (raw) => { let msg = null; try { msg = JSON.parse(String(raw)) } catch (e) { return }; if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result) } })
await new Promise((resolve) => ws.on('open', resolve))
await send('Page.enable'); await send('Runtime.enable'); await send('Page.navigate', { url: 'http://127.0.0.1:3080/' })
async function evalJs(expression) { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result && r.result.value }
let failures = 0
function check(cond, label, extra) { console.log((cond ? '✓ ' : '✗ FAIL: ') + label + (extra ? ' — ' + extra : '')); if (!cond) failures += 1 }

let found = false
for (let i = 0; i < 150; i++) { await sleep(1000); try { found = await evalJs("!!document.querySelector('button[aria-label=\"打开终端\"]')") } catch (e) { /* */ }; if (found) break }
check(found, 'terminal button found')
if (!found) { chrome.kill(); process.exit(1) }

// find and click the FIRST session row (role=treeitem .sessionRow) — the
// running "终端界面优化与路径调整" session belongs to to-deepseek; clicking it
// changes the current selection and the terminal must keep following cwd.
const clickInfo = await evalJs(`(function () {
  const rows = Array.from(document.querySelectorAll('[data-slot="sidebar.workspaces"] [role="treeitem"]'))
  const sessionRow = rows.find(function (el) { return (el.className || '').indexOf('sessionRow') !== -1 && (el.textContent || '').indexOf('排查点击终端后') !== -1 })
  if (!sessionRow) return 'session row not found; rows=' + rows.length
  sessionRow.click()
  return 'clicked session [' + sessionRow.textContent.trim().slice(0, 40) + ']'
})()`)
console.log('click:', clickInfo)
await sleep(2500)

// open the terminal; the FIRST tab's cwd should follow the selected session
await evalJs("document.querySelector('button[aria-label=\"打开终端\"]').click()")
await sleep(6000)
let diag = await evalJs(`(function () { const d = window.__dshEditorTerm; return { meta: d.meta(), tabs: d.tabs() } })()`)
console.log('terminal after selecting the running session:', JSON.stringify(diag))
let cwd = diag.meta && diag.meta.cwd
check(cwd === 'C:\\Users\\MSI\\Desktop\\to-deepseek', 'terminal follows the selected session cwd', JSON.stringify(cwd))
check(cwd !== 'C:\\Users\\MSI\\Desktop\\lost-items', 'terminal NOT at the first workspace', JSON.stringify(cwd))

// now switch BACK to a to-deepseek session and + a new tab
await evalJs(`(function () {
  const wsSlot = document.querySelector('[data-slot="sidebar.workspaces"]')
  const walker = document.createTreeWalker(wsSlot, NodeFilter.SHOW_ELEMENT)
  let node = walker.nextNode()
  let inDeep = false
  while (node) {
    const t = (node.textContent || '').trim()
    if (!inDeep && node.children.length <= 2 && t === 'to-deepseek') { inDeep = true }
    else if (inDeep) {
      if (node.children.length === 0 && t && t !== 'to-deepseek' && t !== '工作区') {
        let el = node
        for (let i = 0; i < 5 && el && el !== wsSlot; i++) {
          if (el.getAttribute && el.getAttribute('role') === 'button') { el.click(); return 'clicked [' + t.slice(0, 30) + ']' }
          el = el.parentElement
        }
      }
    }
    node = walker.nextNode()
  }
  return 'nothing clickable under to-deepseek'
})()`)
await sleep(2500)
await evalJs("document.querySelector('.dsh-editor-term-tab-add').click()")
await sleep(4000)
diag = await evalJs(`(function () {
  const d = window.__dshEditorTerm
  const tabs = d.tabs()
  const active = tabs.find(function (t) { return t.sid === d.activeSid() })
  return { active: active }
})()`)
console.log('new tab after switching back:', JSON.stringify(diag))
check(diag.active && diag.active.cwd === 'C:\\Users\\MSI\\Desktop\\to-deepseek', 'new tab follows the newly selected project again', JSON.stringify(diag.active && diag.active.cwd))

ws.close(); chrome.kill()
console.log(failures === 0 ? '\nALL SWITCH TESTS PASSED' : '\n' + failures + ' CHECK(S) FAILED')
process.exit(failures === 0 ? 0 : 2)
