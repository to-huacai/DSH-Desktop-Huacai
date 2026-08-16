// E2E: select a real session in the GUI, open the terminal, verify the cwd
// follows the SELECTED project (not the first workspace).
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
const debugPort = 9900 + Math.floor(Math.random() * 100)
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

// wait for the terminal button (client plugin boot)
let found = false
for (let i = 0; i < 150; i++) { await sleep(1000); try { found = await evalJs("!!document.querySelector('button[aria-label=\"打开终端\"]')") } catch (e) { /* */ }; if (found) break }
check(found, 'terminal button found')
if (!found) { chrome.kill(); process.exit(1) }

// dump the sidebar workspace/session items to find what's clickable
const sidebarInfo = await evalJs(`(function () {
  const texts = Array.from(document.querySelectorAll('[data-slot="sidebar.workspaces"] *')).filter(function (el) {
    return el.children.length === 0 && (el.textContent || '').trim()
  }).map(function (el) { return el.textContent.trim().slice(0, 40) })
  return { items: Array.from(new Set(texts)).slice(0, 30) }
})()`)
console.log('sidebar items:', JSON.stringify(sidebarInfo.items))

// click the to-deepseek workspace/session so it becomes the CURRENT selection
const clicked = await evalJs(`(function () {
  const all = Array.from(document.querySelectorAll('[data-slot="sidebar.workspaces"] *'))
  const leaf = all.filter(function (el) { return el.children.length === 0 && (el.textContent || '').indexOf('to-deepseek') !== -1 })
  for (const el of leaf) {
    let node = el
    for (let i = 0; i < 4 && node; i++) {
      if (node.getAttribute && node.getAttribute('role') === 'button') { node.click(); return 'clicked ' + node.textContent.trim().slice(0, 40) }
      node = node.parentElement
    }
  }
  return 'no clickable found; leafs=' + leaf.length
})()`)
console.log('click result:', clicked)
await sleep(2500)

// what session is now current?
const current = await evalJs(`(function () {
  const d = window.__dshEditorTerm
  // read the sessions store via the plugin's props is not possible; use the
  // sidebar highlight heuristics instead: dump titles + active states
  const buttons = Array.from(document.querySelectorAll('[data-slot="sidebar.workspaces"] [role="button"], [data-slot="sidebar.workspaces"] button'))
    .map(function (b) { return { t: (b.textContent || '').trim().slice(0, 40), cls: b.className || '' } })
  return buttons.slice(0, 20)
})()`)
console.log('sidebar buttons:', JSON.stringify(current, null, 1))

// open the terminal and read the session cwd
await evalJs("document.querySelector('button[aria-label=\"打开终端\"]').click()")
await sleep(6000)
const diag = await evalJs(`(function () {
  const d = window.__dshEditorTerm
  return { meta: d.meta(), status: d.status(), activeSid: d.activeSid(), tabs: d.tabs() }
})()`)
console.log('terminal meta:', JSON.stringify(diag))
const cwd = diag.meta && diag.meta.cwd
check(cwd === 'C:\\Users\\MSI\\Desktop\\to-deepseek', 'terminal cwd = SELECTED project (to-deepseek)', JSON.stringify(cwd))
check(cwd !== 'C:\\Users\\MSI\\Desktop\\lost-items', 'terminal NOT at the first workspace', JSON.stringify(cwd))

// + new tab should also follow the current project
await evalJs("document.querySelector('.dsh-editor-term-tab-add').click()")
await sleep(4000)
const diag2 = await evalJs(`(function () {
  const d = window.__dshEditorTerm
  const tabs = d.tabs()
  const active = tabs.find(function (t) { return t.sid === d.activeSid() })
  return { active: active }
})()`)
console.log('new tab:', JSON.stringify(diag2))
check(diag2.active && diag2.active.cwd === 'C:\\Users\\MSI\\Desktop\\to-deepseek', 'new tab follows the current project', JSON.stringify(diag2.active && diag2.active.cwd))

ws.close(); chrome.kill()
console.log(failures === 0 ? '\nALL PROJECT-FOLLOWING TESTS PASSED' : '\n' + failures + ' CHECK(S) FAILED')
process.exit(failures === 0 ? 0 : 2)
