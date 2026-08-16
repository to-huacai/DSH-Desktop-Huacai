// Standalone smoke test for the @local/dsh-editor CLIENT half.
//   node tools/test-editor-client.mjs
// Loads the built-artifact client.js with a mocked window.__ModuleLoader__,
// runs the factory with a real react, then calls apply() with a mocked slots
// ctx to verify registration + init paths don't throw.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire('C:/Users/花菜菜/AppData/Local/DSH-Desktop-Huacai/app/node_modules/@deepseek-ai/dsh/package.json')
const React = require('react')

let captured = null
const cssSeen = { value: '' }

// ── minimal browser mocks ──
const styleEl = {
  setAttribute() {},
  remove() {},
  _text: '',
  set textContent(v) { this._text = v; cssSeen.value = v },
  get textContent() { return this._text },
}
globalThis.window = globalThis
globalThis.document = {
  body: { classList: { toggle() {}, add() {}, remove() {} } },
  head: { appendChild() {} },
  createElement(tag) { return tag === 'style' ? styleEl : { setAttribute() {}, appendChild() {} } },
}
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, workspaces: [] }) })
globalThis.location = { href: 'http://127.0.0.1:3080/' }
globalThis.requestAnimationFrame = (fn) => { try { fn() } catch (e) {} }

// ── load the client through the module loader ──
const code = readFileSync('C:/Users/花菜菜/Desktop/to-deepseek/dsh-bundle/plugin/@local/dsh-editor/lib/client.js', 'utf8')
const fakeWindow = {
  __ModuleLoader__: {
    load(entry) { captured = entry },
  },
}
// run the loader call (the file body references window.__ModuleLoader__)
const fn = new Function('window', code + '; return null')
fn(fakeWindow)

if (!captured) throw new Error('ModuleLoader.load was not called')
if (captured.id !== '@local/dsh-editor') throw new Error('bad id: ' + captured.id)
if (typeof captured.factory !== 'function') throw new Error('factory missing')

const exports = captured.factory(require)
if (!exports || typeof exports !== 'object') throw new Error('factory did not return module exports')
if (!Array.isArray(exports.inject) || !exports.inject.includes('slots')) throw new Error('bad inject: ' + JSON.stringify(exports.inject))
if (typeof exports.apply !== 'function') throw new Error('apply missing')
console.log('✓ factory executed; inject =', JSON.stringify(exports.inject))

// ── call apply with a mocked slots ctx ──
const registrations = []
const slotsMock = {
  inject(key, cb) { registrations.push({ key, cb }); return () => {} },
  register() { return () => {} },
}
const ctx = {
  get(name) { return name === 'slots' ? slotsMock : undefined },
  effect(fn) { const d = fn(); return () => { if (typeof d === 'function') d() } },
}
exports.apply(ctx)
const keys = registrations.map((r) => r.key)
console.log('✓ apply ran; slot injections =', JSON.stringify(keys))
if (!keys.includes('sidebar.footer.action')) throw new Error('missing footer toggle')
if (!keys.includes('shell.overlay')) throw new Error('missing overlay panel')
if (!keys.includes('sidebar.workspaces')) throw new Error('missing sidebar.workspaces injection')

// footer action cells + overlay cells (1.12: terminal button + toast layer)
const registerCalls = []
slotsMock.register = (opts, comp) => { registerCalls.push({ opts, comp }); return () => {} }
for (const r of registrations) {
  if (r.key === 'sidebar.footer.action' || r.key === 'shell.overlay') {
    const result = r.cb() // seat ready → occupant registers
    if (typeof result === 'function') result()
  }
}
const toggleReg = registerCalls.find((c) => c.opts && c.opts.id === 'dsh-editor-toggle')
const terminalReg = registerCalls.find((c) => c.opts && c.opts.id === 'dsh-editor-terminal')
const panelReg = registerCalls.find((c) => c.opts && c.opts.id === 'dsh-editor-panel')
const toastReg = registerCalls.find((c) => c.opts && c.opts.id === 'dsh-editor-toast')
const termPanelReg = registerCalls.find((c) => c.opts && c.opts.id === 'dsh-editor-terminal-panel')
if (!toggleReg) throw new Error('missing mode toggle registration')
if (!terminalReg || typeof terminalReg.comp !== 'function') throw new Error('missing terminal button registration')
if (!panelReg) throw new Error('missing editor panel registration')
if (!toastReg) throw new Error('missing toast layer registration')
if (!termPanelReg || typeof termPanelReg.comp !== 'function') throw new Error('missing embedded terminal panel registration')
console.log('✓ footer/overlay cells: toggle + terminal + panel + toast + term-panel')

// the sidebar.workspaces inject callback must only register when slot ready
let treeRegistered = 0
slotsMock.register = () => { treeRegistered += 1; return () => {} }
for (const r of registrations) {
  if (r.key === 'sidebar.workspaces') {
    const result = r.cb() // slot becomes ready; mode=false so nothing registers
    if (typeof result === 'function') result()
  }
}
console.log('✓ sidebar.workspaces inject callback executed (mode off → no tree registration; registered=' + treeRegistered + ')')

// CSS sanity
if (!cssSeen.value.includes('body.dsh-editor-mode')) throw new Error('editor-mode CSS missing')
if (!cssSeen.value.includes('data-shell-overlay')) throw new Error('frame selector CSS missing')
if (!cssSeen.value.includes('.dsh-editor-toast')) throw new Error('toast CSS missing')
if (!cssSeen.value.includes('.dsh-editor-term-panel')) throw new Error('terminal panel CSS missing')
console.log('✓ editor-mode CSS present (' + cssSeen.value.length + ' chars)')

// ── embedded-terminal emulator (parser/grid, no DOM) ──
const term = exports._termNew(20, 5)
exports._termFeed(term, 'hello 世界\r\n')
let text = exports._termText(term)
if (!text.includes('hello 世界')) throw new Error('basic text missing: ' + JSON.stringify(text))
console.log('✓ emulator basic text + wide chars')

exports._termFeed(term, '\x1b[31mred\x1b[0m plain')
text = exports._termText(term)
if (!text.includes('red') || !text.includes('plain')) throw new Error('sgr text broken: ' + JSON.stringify(text))
if (exports._termWidthOf(0x4e16) !== 2) throw new Error('wide char width wrong')
console.log('✓ emulator SGR + cursor sequences')

exports._termFeed(term, '\x1b[2J\x1b[Hreset')
text = exports._termText(term)
if (!text.startsWith('reset')) throw new Error('clear/home broken: ' + JSON.stringify(text))
console.log('✓ emulator clear/home')

// scrollback: fill 20 lines into a 5-row terminal → history capped at 50
const term2 = exports._termNew(10, 5)
for (let i = 0; i < 20; i++) exports._termFeed(term2, 'line' + i + '\r\n')
text = exports._termText(term2)
if (!text.includes('line19')) throw new Error('scroll lost latest: ' + JSON.stringify(text))
console.log('✓ emulator scrollback')

// ── React render regression: hooks must stay consistent across modes ──
// The terminal button/panel call useSessions — rendering them twice with a
// different state.rootId (null vs set) catches conditional-hook violations
// ("Rendered fewer hooks than expected") that crash the footer slot. The
// mock is a REAL hook (useSyncExternalStore) so React enforces ordering.
const ReactDOMServer = require('react-dom/server')
const realUseSessions = (sel) => {
  const snap = React.useSyncExternalStore(
    () => () => {},
    () => ({ ids: [], byId: {}, current: undefined }),
    () => ({ ids: [], byId: {}, current: undefined }),
  )
  return sel(snap)
}
let html
exports._testTerminalOpen(false)
html = ReactDOMServer.renderToString(exports._termButtonElement({ wide: true, useSessions: realUseSessions }))
if (!html.includes('终端')) throw new Error('button render missing label: ' + html.slice(0, 120))
// switch "mode": rootId becomes set (editor mode) → hook count must stay stable
exports._testTreeRoot('ws-x')
html = ReactDOMServer.renderToString(exports._termButtonElement({ wide: true, useSessions: realUseSessions }))
if (!html.includes('终端')) throw new Error('button render broken after rootId change: ' + html.slice(0, 120))
exports._testTreeRoot(null)
console.log('✓ TerminalButton renders consistently across modes (hook rules)')

exports._testTerminalOpen(true)
html = ReactDOMServer.renderToString(exports._termPanelElement({ useSessions: realUseSessions }))
if (!html.includes('dsh-editor-term-panel')) throw new Error('panel render missing root class')
if (!html.includes('重新启动') || !html.includes('外部终端')) throw new Error('panel header buttons missing')
exports._testTerminalOpen(false)
html = ReactDOMServer.renderToString(exports._termPanelElement({ useSessions: realUseSessions }))
if (html.trim() !== '') throw new Error('panel should render nothing when closed')
console.log('✓ TerminalPanel renders header + viewport (hook rules)')

console.log('\nALL CLIENT SMOKE TESTS PASSED')
