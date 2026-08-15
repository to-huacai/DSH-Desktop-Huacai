// Render-level smoke test for the @local/dsh-editor file tree + panels.
//   node tools/test-editor-render.mjs
// Boots the client with editor mode ON and mocked /dsh-editor endpoints, then
// server-renders the file tree and editor panel to catch render crashes.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire('C:/Users/花菜菜/AppData/Local/DSH-Desktop-Huacai/app/node_modules/@deepseek-ai/dsh/package.json')
const React = require('react')
const ReactDOMServer = require('react-dom/server')

// ── browser mocks ──
const styleEl = { setAttribute() {}, remove() {}, set textContent(v) { this._t = v }, get textContent() { return this._t || '' } }
globalThis.window = globalThis
globalThis.document = {
  body: { classList: { toggle() {} } },
  head: { appendChild() {} },
  createElement(tag) { return tag === 'style' ? styleEl : { setAttribute() {}, appendChild() {} } },
}
globalThis.localStorage = { getItem: (k) => (k === 'dsh.editor.mode' ? '1' : null), setItem() {}, removeItem() {} }
const treePayload = {
  ok: true, root: 'C:\\fake\\ws', title: 'WS',
  tree: [
    { name: 'src', kind: 'dir', path: 'src', children: [
      { name: 'index.js', kind: 'file', path: 'src/index.js', size: 27 },
      { name: 'style.css', kind: 'file', path: 'src/style.css', size: 12 },
    ] },
    { name: 'docs', kind: 'dir', path: 'docs', children: [] },
    { name: 'notes.md', kind: 'file', path: 'notes.md', size: 5 },
  ],
  truncated: false,
}
globalThis.fetch = async (url) => {
  const u = String(url)
  if (u.indexOf('/dsh-editor/roots') !== -1) return { json: async () => ({ ok: true, workspaces: [{ id: 'w1', title: 'WS', path: 'C:\\fake\\ws' }] }) }
  if (u.indexOf('/dsh-editor/tree') !== -1) return { json: async () => treePayload }
  if (u.indexOf('/dsh-editor/file') !== -1) return { json: async () => ({ ok: true, path: 'notes.md', content: '# hi\n', size: 5 }) }
  return { json: async () => ({ ok: false, error: 'unexpected ' + u }) }
}
globalThis.requestAnimationFrame = (fn) => { try { fn() } catch (e) {} }

// ── load client ──
let captured = null
new Function('window', readFileSync('C:/Users/花菜菜/Desktop/to-deepseek/dsh-bundle/plugin/@local/dsh-editor/lib/client.js', 'utf8') + '; return null')({ __ModuleLoader__: { load(e) { captured = e } } })
const exports = captured.factory(require)

// ── slots mock that captures components ──
const components = {}
let treeRegistered = 0
const slotsMock = {
  inject(key, cb) { components[key] = cb },
  register(def, comp) {
    components[def.name] = comp
    return () => { treeRegistered = -1 }
  },
}
exports.apply({
  get(name) { return name === 'slots' ? slotsMock : undefined },
  effect() { return () => {} },
})

// fire the sidebar.workspaces inject callback (slot ready, mode on → registers)
components['sidebar.workspaces']()

// wait for loadRoots/loadTree (async fetch)
await new Promise((resolve) => setTimeout(resolve, 100))

// render the file tree
const TreeComp = components['sidebar.workspaces']
if (typeof TreeComp !== 'function') throw new Error('file tree component missing')
const treeHtml = ReactDOMServer.renderToString(React.createElement(TreeComp, { wide: true }))
if (!treeHtml.includes('src')) throw new Error('tree did not render src dir: ' + treeHtml.slice(0, 200))
if (!treeHtml.includes('docs')) throw new Error('tree did not render docs dir')
if (!treeHtml.includes('notes.md')) throw new Error('tree did not render notes.md')
if (!treeHtml.includes('dsh-editor-node-dir')) throw new Error('dir class missing')
if (!treeHtml.includes('dsh-editor-node-file')) throw new Error('file class missing')
if (!treeHtml.includes('dsh-editor-node-dot')) throw new Error('file lang dot missing')
if (!treeHtml.includes('共 3 个文件')) throw new Error('file count foot missing')
console.log('✓ file tree renders (' + treeHtml.length + ' chars)')

// fire the shell.overlay + footer inject callbacks so registrations store the
// real renderers, then render the editor panel (hint branch, mode on)
if (typeof components['shell.overlay'] === 'function') components['shell.overlay']()
const PanelComp = components['shell.overlay']
if (typeof PanelComp !== 'function') throw new Error('panel component missing')

// ── session switcher: mock session/workspace feeds and verify the compact
//    trigger shows the current session, and the dropdown lists the right items
//    (subagents/archived/blanks filtered, current marked) ──
const mockList = {
  ids: ['s1', 's2', 's3', 's4', 's5', 's6'],
  byId: {
    s1: { id: 's1', displayTitle: '会话甲', blank: false, updatedAt: 300 },
    s2: { id: 's2', displayTitle: '子代理', origin: 'subagent', blank: false, updatedAt: 400 },
    s3: { id: 's3', displayTitle: '已归档', blank: false, updatedAt: 200 },
    s4: { id: 's4', displayTitle: '空白会话', blank: true, updatedAt: 500 },
    s5: { id: 's5', displayTitle: '会话乙', blank: false, updatedAt: 500 },
    s6: { id: 's6', displayTitle: '会话丙', blank: false, updatedAt: 100 },
  },
  current: 's1',
}
const mockWorkspaces = {
  items: [{ workspaceId: 'w1', title: 'WS', path: 'C:\\fake\\ws', sessionIds: ['s1', 's2', 's3', 's4', 's5', 's6'] }],
  archivedSessionIds: ['s3'],
}
const hookProps = {
  useSessions: (sel) => sel(mockList),
  useWorkspaces: (sel) => sel(mockWorkspaces),
}
const panelHtml = ReactDOMServer.renderToString(React.createElement(PanelComp, hookProps))
if (!panelHtml.includes('dsh-editor-panel')) throw new Error('panel root missing: ' + panelHtml.slice(0, 120))
if (!panelHtml.includes('dsh-editor-resize')) throw new Error('resize handles missing in hint panel')
if (!panelHtml.includes('dsh-editor-session-tabs')) throw new Error('session strip missing in hint panel')
if (!panelHtml.includes('dsh-editor-session-trigger')) throw new Error('session trigger missing')
if (!panelHtml.includes('会话甲')) throw new Error('current session title missing in trigger: ' + panelHtml.slice(0, 300))
if (panelHtml.includes('dsh-editor-session-menu-item')) throw new Error('menu should be closed by default')
if (!panelHtml.includes('dsh-editor-session-new')) throw new Error('new-session pill missing')
if (!panelHtml.includes('+ 新会话')) throw new Error('new-session pill label missing')
console.log('✓ editor panel renders handles + session strip with current session (' + panelHtml.length + ' chars)')

// open the dropdown → items listed (filtered), current marked
if (typeof exports._testSessionMenu !== 'function') throw new Error('_testSessionMenu hook missing')
exports._testSessionMenu(true)
const sessionMenuHtml = ReactDOMServer.renderToString(React.createElement(PanelComp, hookProps))
if (!sessionMenuHtml.includes('dsh-editor-session-menu')) throw new Error('session menu missing when open')
if (!sessionMenuHtml.includes('会话甲')) throw new Error('current session missing in menu')
if (!sessionMenuHtml.includes('会话乙')) throw new Error('recent session missing in menu')
if (!sessionMenuHtml.includes('会话丙')) throw new Error('older session missing in menu')
if (!sessionMenuHtml.includes('dsh-editor-session-menu-item active')) throw new Error('active item class missing')
if (!sessionMenuHtml.includes('✓')) throw new Error('current-session check mark missing')
if (sessionMenuHtml.includes('子代理')) throw new Error('subagent session should be filtered out')
if (sessionMenuHtml.includes('已归档')) throw new Error('archived session should be filtered out')
if (sessionMenuHtml.includes('空白会话')) throw new Error('blank non-current session should be filtered out')
console.log('✓ session dropdown lists filtered sessions with active mark (' + sessionMenuHtml.length + ' chars)')

// search box appears with many sessions and filters the list
const bigList = { ids: [], byId: {}, current: undefined }
for (let i = 0; i < 12; i++) {
  bigList.ids.push('b' + i)
  bigList.byId['b' + i] = { id: 'b' + i, displayTitle: '批量会话' + i, blank: false, updatedAt: 1000 - i }
}
bigList.current = 'b0'
const bigProps = { useSessions: (sel) => sel(bigList), useWorkspaces: (sel) => sel({ items: [], archivedSessionIds: [] }) }
const searchHtml = ReactDOMServer.renderToString(React.createElement(PanelComp, bigProps))
if (!searchHtml.includes('dsh-editor-session-search')) throw new Error('search input missing with many sessions')
exports._testSessionMenu(true, '批量会话5')
const filteredHtml = ReactDOMServer.renderToString(React.createElement(PanelComp, bigProps))
if (!filteredHtml.includes('批量会话5')) throw new Error('search should keep matching sessions')
if (filteredHtml.includes('批量会话4')) throw new Error('search should filter out non-matching sessions')
if (filteredHtml.includes('批量会话6')) throw new Error('search should filter out non-matching sessions')
exports._testSessionMenu(false, '')
console.log('✓ session search filters the dropdown list')

// conversation pushed below the 44px strip (root div under the conversation slot)
if (!styleEl.textContent.includes('data-slot="conversation"]>div{padding-top:44px')) throw new Error('conversation padding CSS missing')
console.log('✓ conversation padding CSS present')

// ── markdown preview: select a .md file with preview ON ──
if (typeof exports._testSelect !== 'function') throw new Error('_testSelect hook missing')
exports._testSelect('README.md', '# Hello\n\nSome **bold** and `code` text.\n', true)
const mdHtml = ReactDOMServer.renderToString(React.createElement(PanelComp, {}))
if (!mdHtml.includes('dsh-editor-panel-previewbtn')) throw new Error('preview button missing for .md')
if (!mdHtml.includes('dsh-editor-preview-col')) throw new Error('preview pane missing')
if (!mdHtml.includes('Hello')) throw new Error('preview content missing')
if (!mdHtml.includes('dsh-editor-edit-col')) throw new Error('edit column missing in split view')
console.log('✓ markdown split preview renders (' + mdHtml.length + ' chars)')

// non-md file: no preview button
exports._testSelect('index.js', 'const a = 1\n', false)
const jsHtml = ReactDOMServer.renderToString(React.createElement(PanelComp, {}))
if (jsHtml.includes('dsh-editor-panel-previewbtn')) throw new Error('preview button shown for non-md file')
console.log('✓ non-markdown file has no preview button')

// ── context menu rendering ──
exports._testSelect('src/index.js', 'const a = 1\nconst b = 2\n', false)
exports._testMenu(100, 200, true, 'const a = 1', 0, 12)
const menuHtml = ReactDOMServer.renderToString(React.createElement(PanelComp, {}))
if (!menuHtml.includes('dsh-editor-menu')) throw new Error('menu root missing')
if (!menuHtml.includes('剪切')) throw new Error('cut item missing')
if (!menuHtml.includes('复制')) throw new Error('copy item missing')
if (!menuHtml.includes('添加到对话')) throw new Error('add-to-chat item missing')
if (menuHtml.includes('disabled')) throw new Error('items should be enabled with a selection')
console.log('✓ context menu renders with selection (' + menuHtml.length + ' chars)')

exports._testMenu(100, 200, false, '', 0, 0)
const menuDisabledHtml = ReactDOMServer.renderToString(React.createElement(PanelComp, {}))
if (!menuDisabledHtml.includes('disabled')) throw new Error('items should be disabled without a selection')
console.log('✓ context menu disables items without selection')

// ── snippet builder: backticked path + code fence sent to chat ──
if (typeof exports._buildSnippet !== 'function') throw new Error('_buildSnippet missing')
const snip = exports._buildSnippet('src/index.js', 'const a = 1\n')
if (!snip.includes('`src/index.js`')) throw new Error('file path reference missing in snippet: ' + JSON.stringify(snip))
if (!snip.includes('```js')) throw new Error('language fence missing: ' + JSON.stringify(snip))
if (!snip.includes('const a = 1')) throw new Error('code missing in snippet')
const snipNoFence = exports._buildSnippet('notes.md', 'line with ``` fence\n')
if (!snipNoFence.includes('`notes.md`')) throw new Error('md snippet path missing')
console.log('✓ snippet includes backticked path + language fence')

// ── file-reference card row above the composer ──
if (typeof exports._testCards !== 'function') throw new Error('_testCards missing')
components['conversation.input.dock']() // fire the inject callback → stores the real renderer
const DockComp = components['conversation.input.dock']
if (typeof DockComp !== 'function') throw new Error('dock component missing')
const emptyDock = ReactDOMServer.renderToString(React.createElement(DockComp, {}))
if (emptyDock.trim() !== '') throw new Error('dock should render nothing with no cards')
exports._testCards([{ id: 'c1', kind: 'file', path: 'src/index.js', block: '\n`src/index.js`\n' }])
const dockHtml = ReactDOMServer.renderToString(React.createElement(DockComp, {}))
if (!dockHtml.includes('dsh-editor-card')) throw new Error('card missing')
if (!dockHtml.includes('src/index.js')) throw new Error('card path missing')
if (!dockHtml.includes('dsh-editor-card-close')) throw new Error('card close button missing')
console.log('✓ reference card row renders above composer (' + dockHtml.length + ' chars)')

// ── file-tree context menu (right-click a file) ──
if (typeof exports._testTreeMenu !== 'function') throw new Error('_testTreeMenu missing')
exports._testCards([])
exports._testTreeMenu(80, 120, 'notes.md')
const treeMenuHtml = ReactDOMServer.renderToString(React.createElement(TreeComp, { wide: true }))
if (!treeMenuHtml.includes('dsh-editor-menu')) throw new Error('tree menu root missing')
if (!treeMenuHtml.includes('添加到对话')) throw new Error('tree menu add-to-chat missing')
if (!treeMenuHtml.includes('复制路径')) throw new Error('tree menu copy-path missing')
console.log('✓ file-tree context menu renders (' + treeMenuHtml.length + ' chars)')

// ── send-time injection: references merged into the outgoing message ──
if (typeof exports._buildSubmitText !== 'function') throw new Error('_buildSubmitText missing')
const merged = exports._buildSubmitText(
  [
    { kind: 'file', path: 'src/index.js', block: '\n`src/index.js`\n' },
    { kind: 'code', path: 'notes.md', block: '\n`notes.md`\n\n```md\n# hi\n```\n' },
  ],
  '请解释这段代码',
)
if (!merged.includes('`src/index.js`')) throw new Error('file ref missing in merged text')
if (!merged.includes('```md')) throw new Error('code block missing in merged text')
if (!merged.includes('请解释这段代码')) throw new Error('user text missing in merged text')
const mergedEmptyUser = exports._buildSubmitText([{ kind: 'file', path: 'a.py', block: '\n`a.py`\n' }], '   ')
if (!mergedEmptyUser.includes('a.py')) throw new Error('file ref missing with empty user text')
console.log('✓ send-time injection merges references + user text')

console.log('\nALL RENDER TESTS PASSED')
