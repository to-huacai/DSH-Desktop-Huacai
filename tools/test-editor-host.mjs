// Standalone smoke test for the @local/dsh-editor HOST half logic.
//   node tools/test-editor-host.mjs
// Exercises walkDir / safeResolve / workspaceById against a temp tree
// WITHOUT needing a running dsh (node:fs based logic only).
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
    },
  }
  injectCalls[0].cb(fakeWebCtx)
  if (routes.length !== 1) throw new Error('expected one route, got ' + routes.length)
  const route = routes[0]
  if (route.kind !== 'prefix' || route.path !== '/dsh-editor') throw new Error('bad route: ' + JSON.stringify({ kind: route.kind, path: route.path }))
  console.log('✓ webServer route registered: ' + route.path)

  // helper to call the handler with a fake req/res
  function call(url, method, body) {
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
      route.handler(req, res).catch(reject)
    })
  }

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

  console.log('\nALL HOST LOGIC TESTS PASSED')
} finally {
  rmSync(root, { recursive: true, force: true })
}
