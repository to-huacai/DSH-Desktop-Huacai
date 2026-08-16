// Standalone smoke test for the @local/dsh-editor HOST half logic.
//   node tools/test-editor-host.mjs
// Exercises walkDir / safeResolve / workspaceById / terminal open against a
// temp tree WITHOUT needing a running dsh (node:fs based logic only).
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

// import the module; it also exports nothing but name/apply, so reach into
// the internal functions via a small re-implementation check instead: we
// import and then exercise apply() with a fake ctx that captures the routes.
const mod = await import('../dsh-bundle/plugin/@local/dsh-editor/lib/index.js')

// 1) name/apply contract
if (mod.name !== 'editor') throw new Error('name mismatch: ' + mod.name)
if (typeof mod.apply !== 'function') throw new Error('apply missing')
console.log('✓ module contract (name=editor, apply=function)')

// 2) build a temp workspace tree
const root = mkdtempSync(join(tmpdir(), 'dsh-editor-test-'))
try {
  mkdirSync(join(root, 'src', 'components'), { recursive: true })
  mkdirSync(join(root, 'node_modules', 'somepkg'), { recursive: true })
  mkdirSync(join(root, '.git'), { recursive: true })
  mkdirSync(join(root, '_build'), { recursive: true })
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(join(root, 'README.md'), '# hello\n', 'utf8')
  writeFileSync(join(root, 'src', 'index.js'), 'export const x = 1\n', 'utf8')
  writeFileSync(join(root, 'src', 'components', 'App.jsx'), 'export default () => null\n', 'utf8')
  writeFileSync(join(root, 'docs', 'guide.md'), 'guide', 'utf8')
  writeFileSync(join(root, 'node_modules', 'somepkg', 'index.js'), 'skip me', 'utf8')
  writeFileSync(join(root, 'secret.png'), 'not text', 'utf8')
  writeFileSync(join(root, 'notes.md'), 'notes', 'utf8')

  // capture the registered route handlers
  const routes = []
  const upgrades = []
  const injectCalls = []
  const ctx = {
    get(name) {
      if (name === 'workspaceRegistry') {
        return {
          list() {
            return [
              { id: 'ws-1', title: 'Test WS', path: root },
              { id: 'ws-2', title: 'Other', path: join(root, '..', 'nonexistent') },
            ]
          },
        }
      }
      return undefined
    },
    inject(deps, cb) { injectCalls.push({ deps, cb }) },
  }
  mod.apply(ctx)
  if (injectCalls.length !== 1) throw new Error('expected one inject call')
  const fakeWebCtx = {
    effect(fn) { const d = fn(); return () => { if (typeof d === 'function') d() } },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
      registerUpgrade(route) {
        upgrades.push(route)
        return () => {}
      },
    },
  }
  injectCalls[0].cb(fakeWebCtx)
  if (routes.length !== 2) throw new Error('expected two routes, got ' + routes.length)
  if (upgrades.length !== 1) throw new Error('expected one upgrade route, got ' + upgrades.length)
  const route = routes.find((r) => r.kind === 'prefix' && r.path === '/dsh-editor')
  const terminalRoute = routes.find((r) => r.kind === 'prefix' && r.path === '/dsh-editor-terminal')
  if (!route) throw new Error('missing /dsh-editor route: ' + JSON.stringify(routes.map((r) => r.path)))
  if (!terminalRoute) throw new Error('missing /dsh-editor-terminal route: ' + JSON.stringify(routes.map((r) => r.path)))
  if (upgrades[0].path !== '/dsh-editor-terminal/ws') throw new Error('bad upgrade route: ' + JSON.stringify(upgrades.map((u) => u.path)))
  console.log('✓ webServer routes: ' + routes.map((r) => r.path).join(', ') + ' + ws ' + upgrades[0].path)

  // helper to call a route handler with a fake req/res
  function makeCall(r) {
    return function call(url, method, body) {
      return new Promise((resolve, reject) => {
        const req = {
          url,
          method,
          on(ev, cb) {
            if (ev === 'data') { if (body) cb(Buffer.from(body)) }
            if (ev === 'end') cb()
            if (ev === 'error') { /* noop */ }
          },
          destroy() {},
        }
        const chunks = []
        const res = {
          writeHead(status, headers) { res.status = status; res.headers = headers },
          end(data) { chunks.push(String(data)); resolve({ status: res.status, json: JSON.parse(chunks.join('')) }) },
        }
        r.handler(req, res).catch(reject)
      })
    }
  }
  const call = makeCall(route)
  const callTerminal = makeCall(terminalRoute)

  // roots
  const roots = await call('/dsh-editor/roots', 'GET')
  if (!roots.json.ok || roots.json.workspaces.length !== 2) throw new Error('roots bad: ' + JSON.stringify(roots.json))
  console.log('✓ /dsh-editor/roots →', roots.json.workspaces.map((w) => w.id).join(','))

  // tree
  const tree = await call('/dsh-editor/tree?root=ws-1', 'GET')
  const flat = []
  function walk(nodes) {
    for (const n of nodes) { flat.push(n.path); if (n.children) walk(n.children) }
  }
  walk(tree.json.tree || [])
  console.log('✓ /dsh-editor/tree →', flat.join(','))
  if (tree.json.title !== 'Test WS') throw new Error('tree title bad')
  if (!flat.includes('README.md')) throw new Error('missing README.md')
  if (!flat.includes('src/index.js')) throw new Error('missing src/index.js')
  if (!flat.includes('src/components/App.jsx')) throw new Error('missing nested file')
  if (flat.some((p) => p.includes('node_modules') || p.includes('.git') || p.includes('_build'))) {
    throw new Error('skip dirs leaked into tree: ' + flat.join(','))
  }
  if (flat.some((p) => p.includes('secret.png'))) throw new Error('binary file leaked: ' + flat.join(','))
  if (tree.json.truncated !== false) throw new Error('truncated flag bad')

  // read
  const file = await call('/dsh-editor/file?root=ws-1&path=src/index.js', 'GET')
  if (!file.json.ok || file.json.content !== 'export const x = 1\n') throw new Error('read bad: ' + JSON.stringify(file.json))
  console.log('✓ read file src/index.js')

  // path traversal must be rejected
  const evil = await call('/dsh-editor/file?root=ws-1&path=..%2F..%2Fwindows%2Fsystem32%2Fdrivers%2Fetc%2Fhosts', 'GET')
  if (evil.json.ok !== false) throw new Error('traversal NOT rejected: ' + JSON.stringify(evil.json))
  const evil2 = await call('/dsh-editor/file?root=ws-1&path=%2Fetc%2Fpasswd', 'GET')
  if (evil2.json.ok !== false) throw new Error('absolute path NOT rejected')
  console.log('✓ path traversal & absolute paths rejected')

  // write
  const w = await call('/dsh-editor/file', 'POST', JSON.stringify({ root: 'ws-1', path: 'src/newfile.txt', content: 'new content 新建文件' }))
  if (!w.json.ok) throw new Error('write bad: ' + JSON.stringify(w.json))
  const check = await call('/dsh-editor/file?root=ws-1&path=src/newfile.txt', 'GET')
  if (check.json.content !== 'new content 新建文件') throw new Error('write verify bad')
  console.log('✓ write + read back (incl. unicode)')

  // write traversal rejected
  const w2 = await call('/dsh-editor/file', 'POST', JSON.stringify({ root: 'ws-1', path: '../escape.txt', content: 'x' }))
  if (w2.json.ok !== false) throw new Error('write traversal NOT rejected')
  console.log('✓ write traversal rejected')

  // ── terminal endpoint (1.12): POST /dsh-editor-terminal/open ───────────────────
  // stub child_process.spawn (the ESM default import shares the CJS exports
  // object, so patching the property is visible to the plugin code)
  const cpMod = require('node:child_process')
  const originalSpawn = cpMod.spawn
  let spawnCalls = []
  cpMod.spawn = (exe, args, opts) => { spawnCalls.push({ exe, args, opts }); return { unref() {} } }
  try {
    // dry run: resolves shell + cwd, must NOT spawn a window
    spawnCalls = []
    const dry = await callTerminal('/dsh-editor-terminal/open', 'POST', JSON.stringify({ root: 'ws-1', dryRun: true }))
    if (!dry.json.ok || dry.json.dryRun !== true) throw new Error('dryRun bad: ' + JSON.stringify(dry.json))
    if (dry.json.cwd !== root) throw new Error('dryRun cwd bad: ' + dry.json.cwd)
    if (!['wt', 'cmd'].includes(dry.json.shell)) throw new Error('dryRun shell bad: ' + dry.json.shell)
    if (spawnCalls.length !== 0) throw new Error('dryRun must not spawn')
    console.log('✓ /dsh-editor-terminal/open dryRun → shell=' + dry.json.shell + ' cwd=' + dry.json.cwd)

    // no root → falls back to the first registry workspace
    const dry2 = await callTerminal('/dsh-editor-terminal/open', 'POST', JSON.stringify({ dryRun: true }))
    if (!dry2.json.ok || dry2.json.cwd !== root) throw new Error('fallback cwd bad: ' + JSON.stringify(dry2.json))
    console.log('✓ /dsh-editor-terminal/open no-root fallback → ' + dry2.json.cwd)

    // real open: spawns ONE detached terminal at the workspace
    spawnCalls = []
    const open = await callTerminal('/dsh-editor-terminal/open', 'POST', JSON.stringify({ root: 'ws-1' }))
    if (!open.json.ok || !['wt', 'cmd'].includes(open.json.shell)) throw new Error('open bad: ' + JSON.stringify(open.json))
    if (spawnCalls.length !== 1) throw new Error('expected one spawn, got ' + spawnCalls.length)
    const sp = spawnCalls[0]
    if (sp.opts.cwd !== root || sp.opts.detached !== true || sp.opts.stdio !== 'ignore') {
      throw new Error('spawn options bad: ' + JSON.stringify(sp.opts))
    }
    if (open.json.shell === 'cmd') {
      // cmd must go through `start` so the interactive console persists;
      // the outer cmd /c itself is hidden
      if (sp.opts.windowsHide !== true) throw new Error('cmd spawn must be hidden: ' + JSON.stringify(sp.opts))
      if (sp.args.join(' ') !== '/c start DSH Terminal cmd /k') {
        throw new Error('cmd args bad: ' + JSON.stringify(sp.args))
      }
    } else {
      if (sp.opts.windowsHide !== false) throw new Error('wt spawn must be visible: ' + JSON.stringify(sp.opts))
      if (sp.args[0] !== '-d' || sp.args[1] !== root) throw new Error('wt args bad: ' + JSON.stringify(sp.args))
    }
    console.log('✓ /dsh-editor-terminal/open spawn → ' + sp.exe + ' ' + JSON.stringify(sp.args))

    // spawn failure surfaces a readable 500
    cpMod.spawn = () => { throw new Error('boom') }
    const fail = await callTerminal('/dsh-editor-terminal/open', 'POST', JSON.stringify({ root: 'ws-1' }))
    if (fail.json.ok !== false || !String(fail.json.error).includes('打开终端失败')) {
      throw new Error('failure path bad: ' + JSON.stringify(fail.json))
    }
    console.log('✓ /dsh-editor-terminal/open failure path → ' + fail.json.error)

    // invalid JSON body rejected
    const bad = await callTerminal('/dsh-editor-terminal/open', 'POST', 'not json')
    if (bad.json.ok !== false) throw new Error('invalid JSON accepted')
    console.log('✓ /dsh-editor-terminal/open rejects invalid JSON')
  } finally {
    cpMod.spawn = originalSpawn
  }

  console.log('\nALL HOST LOGIC TESTS PASSED')
} finally {
  rmSync(root, { recursive: true, force: true })
}
