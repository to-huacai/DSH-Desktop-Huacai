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
console.log('✓ editor-mode CSS present (' + cssSeen.value.length + ' chars)')

console.log('\nALL CLIENT SMOKE TESTS PASSED')
