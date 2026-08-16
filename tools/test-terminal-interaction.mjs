// Browser test: typing echo, restart (same tab), shell switch, tab persistence.
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
const debugPort = 9990 + Math.floor(Math.random() * 10)
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
const marker = 'ECHO_' + Math.random().toString(36).slice(2, 7)
let found = false
for (let i = 0; i < 120; i++) { await sleep(1000); try { found = await evalJs("!!document.querySelector('button[aria-label=\"打开终端\"]')") } catch (e) { /* */ }; if (found) break }
check(found, 'terminal button found')
await evalJs("document.querySelector('button[aria-label=\"打开终端\"]').click()")
await sleep(5000)

async function viewText() {
  return evalJs(`(function () {
    const lines = Array.from(document.querySelectorAll('.dsh-editor-term-line')).filter(function (el) { return el.style.visibility !== 'hidden' })
    return lines.map(function (el) { return (el.innerText || '').replace(/\\s+$/, '') }).join('\\n')
  })()`)
}

// type a command: focus the hidden textarea, then send real key events via CDP
await evalJs("document.querySelector('.dsh-editor-term-viewport').click()")
await send('Input.insertText', { text: 'echo ' + marker })
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r' })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' })
await sleep(3000)
let text = await viewText()
check(text.indexOf('echo') !== -1 && text.indexOf(marker) !== -1, 'typed command echoed through ConPTY', JSON.stringify(text.slice(-120)))
check(text.indexOf('PS ') !== -1 || text.indexOf('C>') !== -1, 'prompt visible after typing')

// restart the active session (keep the same tab)
await evalJs("Array.from(document.querySelectorAll('.dsh-editor-term-btn')).find(function (b) { return b.textContent === '重新启动' }).click()")
await sleep(3500)
text = await viewText()
check(text.indexOf('PS ') !== -1, 'prompt re-rendered after restart')
const tabsAfter = await evalJs("document.querySelectorAll('.dsh-editor-term-tab').length")
check(tabsAfter === 1, 'restart keeps the same tab', 'tabs=' + tabsAfter)

// switch shell to CMD via the dropdown → same tab restarts as CMD
await evalJs(`(function () {
  const sel = document.querySelector('.dsh-editor-term-select')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  setter.call(sel, 'cmd')
  sel.dispatchEvent(new Event('change', { bubbles: true }))
})()`)
await sleep(3500)
const tabLabel = await evalJs("document.querySelector('.dsh-editor-term-tab-label').textContent")
text = await viewText()
check(tabLabel === 'CMD', 'tab label updates after shell switch', tabLabel)
check(text.indexOf('C>') !== -1, 'cmd prompt rendered', JSON.stringify(text.slice(-80)))

// close the panel, reopen → session persists (same tab, same content)
await evalJs("Array.from(document.querySelectorAll('.dsh-editor-term-btn')).find(function (b) { return b.textContent === '×' }).click()")
await sleep(1200)
await evalJs("document.querySelector('button[aria-label=\"打开终端\"]').click()")
await sleep(4000)
text = await viewText()
const tabAfterReopen = await evalJs("document.querySelector('.dsh-editor-term-tab-label').textContent")
check(text.indexOf('C>') !== -1, 'session persists across panel close/reopen', JSON.stringify(text.slice(-60)))
check(tabAfterReopen === 'CMD', 'tab restored after reopen', tabAfterReopen)

ws.close(); chrome.kill()
console.log(failures === 0 ? '\nALL INTERACTION TESTS PASSED' : '\n' + failures + ' CHECK(S) FAILED')
process.exit(failures === 0 ? 0 : 2)
