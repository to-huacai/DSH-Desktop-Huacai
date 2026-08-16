// tools/test-terminal-real.mjs — REAL spawn smoke test for /dsh-editor-terminal/open.
//   node tools/test-terminal-real.mjs
//
// Exercises the actual route handler with the REAL child_process.spawn (no
// stub): resolves the workspace cwd, opens an actual native terminal window
// (Windows Terminal when installed, else cmd.exe), then kills it after ~2.5s.
// A brief console window appears — run only on a dev machine where that is
// acceptable. Exit code 0 = route + spawn + kill all worked.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const cpMod = require('node:child_process')

const mod = await import('../dsh-bundle/plugin/@local/dsh-editor/lib/index.js')
const root = mkdtempSync(join(tmpdir(), 'dsh-term-real-'))
writeFileSync(join(root, 'hello.txt'), 'terminal smoke test\n')

// wrap spawn once: record the live child, then delegate to the real spawn
let spawned = null
const original = cpMod.spawn
cpMod.spawn = function (exe, args, opts) {
  const child = original.call(this, exe, args, opts)
  spawned = { child, exe, args, opts }
  return child
}

const routes = []
const ctx = {
  get(name) {
    if (name === 'workspaceRegistry') return { list: () => [{ id: 'w', title: 'Smoke', path: root }] }
    return undefined
  },
  inject(deps, cb) {
    cb({
      effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d() } },
      webServer: {
        register: (r) => { routes.push(r); return () => {} },
        registerUpgrade: () => () => {},
      },
    })
  },
}
mod.apply(ctx)
const route = routes.find((r) => r.kind === 'prefix' && r.path === '/dsh-editor-terminal')
if (!route) {
  console.error('FAIL: terminal route not registered: ' + JSON.stringify(routes.map((r) => r.path)))
  process.exit(1)
}

const res = {
  writeHead(status) { this.status = status },
  end(body) { console.log('response:', this.status, body) },
}
await route.handler({
  url: '/dsh-editor-terminal/open',
  method: 'POST',
  on(ev, cb) { if (ev === 'data') cb('{"root":"w"}'); if (ev === 'end') cb() },
  destroy() {},
}, res)

if (!spawned) {
  console.error('FAIL: spawn was never called')
  process.exit(1)
}
console.log('spawned:', spawned.exe, JSON.stringify(spawned.args), 'cwd=' + spawned.opts.cwd)
console.log('child pid:', spawned.child.pid)

// give the window a moment to appear, then verify the interactive terminal
// process persists and kill it. The cmd path spawns
// `cmd /c start "DSH Terminal" cmd /k` — the OUTER cmd (spawned.child) exits
// right after `start` detaches the INNER interactive cmd. Persistence is the
// key behavioral check (a directly spawned cmd with NUL stdio exits
// immediately). NOTE: in sandboxed/background shells the console window may
// live on an invisible desktop, so process persistence is the assertion —
// window title lookup is reported for interactive desktops.
await new Promise((r) => setTimeout(r, 500))
let innerPid = null
try {
  const script = `Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.ParentProcessId -eq ${spawned.child.pid} } | ForEach-Object { $_.ProcessId }`
  const out = cpMod.execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' })
  const ids = out.split('\n').map((s) => s.trim()).filter((s) => /^\d+$/.test(s))
  innerPid = ids.length > 0 ? Number(ids[0]) : null
} catch (e) { console.log('inner lookup failed:', e.message) }
console.log('inner terminal pid:', innerPid === null ? '(none)' : innerPid)

await new Promise((r) => setTimeout(r, 2000))
let alive = false
if (innerPid !== null) {
  try {
    const script = `if (Get-Process -Id ${innerPid} -ErrorAction SilentlyContinue) { 'ALIVE' } else { 'GONE' }`
    const out = cpMod.execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' })
    alive = out.includes('ALIVE')
  } catch (e) { /* ignore */ }
}
console.log('inner terminal persisted 2.5s:', alive ? 'YES' : 'NO')
if (!alive) {
  console.error('FAIL: interactive terminal did not persist')
  try { cpMod.execFileSync('taskkill', ['/PID', String(spawned.child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch (e) { /* ignore */ }
  process.exit(1)
}

// cleanup: kill the inner terminal (by pid; also by title on interactive desktops)
const title = 'DSH Terminal'
try {
  const script = `Get-Process cmd -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq '${title}' } | Stop-Process -Force`
  cpMod.execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' })
  console.log('killed terminal windows by title')
} catch (e) { /* title kill best-effort */ }
try { cpMod.execFileSync('taskkill', ['/PID', String(innerPid), '/T', '/F'], { stdio: 'ignore' }); console.log('killed inner terminal (pid ' + innerPid + ')') } catch (e) { /* ignore */ }
try { cpMod.execFileSync('taskkill', ['/PID', String(spawned.child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch (e) { /* ignore */ }
rmSync(root, { recursive: true, force: true })
console.log('REAL TERMINAL SMOKE OK')
