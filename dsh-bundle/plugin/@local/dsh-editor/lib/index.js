/**
 * @local/dsh-editor — node half (DSH-Desktop-Huacai embedded edition).
 *
 * Serves the file API used by the editor-mode browser half:
 *   GET  /dsh-editor/roots        → { ok, workspaces: [{ id, title, path }] }
 *   GET  /dsh-editor/tree?root=   → { ok, root, title, tree, truncated }
 *   GET  /dsh-editor/file?root=&path= → { ok, path, content, size }
 *   POST /dsh-editor/file         → body { root, path, content } → { ok, path }
 *
 * Security model:
 *   - The tree/file endpoints only ever resolve paths under a workspace taken
 *     from the runtime workspaceRegistry by id — the client never supplies an
 *     absolute path.
 *   - Relative paths are sanitized (`..` and absolute segments rejected).
 *   - Text reads are capped (2 MB) so the browser never ingests a huge file;
 *     binary/known-heavy extensions are skipped in the tree walk.
 *
 * Install: place this package under the profile's node_modules and add one
 * row to the profile cordis.patch.yml (see install-skin-plugin.mjs companion
 * list), then restart dsh.
 */

import { promises as fsp } from 'node:fs'
import { join, dirname, normalize, sep } from 'node:path'

/** Cordis plugin name. */
export const name = 'editor'

const MAX_TREE_DEPTH = 7
const MAX_TREE_ENTRIES = 6000
const MAX_FILE_BYTES = 2 * 1024 * 1024 // 2 MB text cap
const MAX_POST_BYTES = 8 * 1024 * 1024 // POST body cap

/** Directories never shown in the file tree (build/vendor/ignored). */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', '.idea', '.vscode', '.next', '.nuxt',
  '.turbo', '.cache', 'dist', 'build', '_build', 'out', 'target', 'bin', 'obj',
  'coverage', 'build-cache', '.dsh', '.DS_Store',
])

/** File names never shown in the file tree. */
const SKIP_FILE_RE = /\.(exe|dll|so|dylib|zip|7z|rar|tar|gz|png|jpe?g|gif|webp|bmp|ico|icns|pdf|woff2?|ttf|eot|otf|mp4|webm|mkv|avi|mov|mp3|wav|flac|ogg|bin|dat|class|jar|pyc|obj|o|a|lib|pdb)$/i

/** Concise error message helper. */
function msg(error) {
  return error && error.message ? error.message : String(error)
}

/** Escape HTML (used for error text only). */
function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Resolve a workspace entity by id; falls back to the first workspace. */
function workspaceById(ctx, id) {
  const registry = ctx.get('workspaceRegistry')
  if (!registry) return null
  let all = []
  try {
    all = registry.list()
  } catch (error) {
    return null
  }
  if (!Array.isArray(all) || all.length === 0) return null
  if (id !== undefined && id !== null && id !== '') {
    const found = all.find((w) => String(w && w.id) === String(id))
    if (found) return found
  }
  return all[0]
}

/**
 * Build a nested tree for one directory. `relDir` uses '/' separators
 * relative to the workspace root. Caps depth and total entries.
 */
async function walkDir(rootAbs, relDir, depth, out, stats) {
  if (depth > MAX_TREE_DEPTH) return
  if (stats.entries >= MAX_TREE_ENTRIES) return
  let dirents
  try {
    dirents = await fsp.readdir(join(rootAbs, relDir), { withFileTypes: true })
  } catch (error) {
    return // unreadable dir (permission / vanished) — skip silently
  }
  dirents.sort((a, b) => {
    const ad = a.isDirectory() ? 0 : 1
    const bd = b.isDirectory() ? 0 : 1
    if (ad !== bd) return ad - bd
    return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0
  })
  for (const entry of dirents) {
    if (stats.entries >= MAX_TREE_ENTRIES) return
    const name = entry.name
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      const rel = relDir ? relDir + '/' + name : name
      const node = { name, kind: 'dir', path: rel, children: [] }
      out.push(node)
      stats.entries += 1
      await walkDir(rootAbs, rel, depth + 1, node.children, stats)
    } else if (entry.isFile()) {
      if (SKIP_FILE_RE.test(name)) continue
      const rel = relDir ? relDir + '/' + name : name
      let size = 0
      try {
        const st = await fsp.stat(join(rootAbs, rel))
        size = st.size
      } catch (error) { /* size best-effort */ }
      out.push({ name, kind: 'file', path: rel, size })
      stats.entries += 1
    }
    // symlinks are intentionally skipped (avoid loops / surprises)
  }
}

/**
 * Resolve a client-supplied relative path inside a workspace root.
 * Rejects absolute paths, `..` escapes, and anything outside the root.
 * Returns an absolute OS path or null.
 */
function safeResolve(rootAbs, rel) {
  if (typeof rel !== 'string' || rel.length === 0) return null
  const cleaned = rel.replace(/\\/g, '/')
  if (cleaned.startsWith('/')) return null
  if (/(^|\/)\.\.(\/|$)/.test(cleaned)) return null
  const parts = cleaned.split('/').filter((p) => p.length > 0 && p !== '.')
  if (parts.length === 0) return null
  const full = normalize(join(rootAbs, ...parts))
  const rootNorm = normalize(rootAbs)
  if (full !== rootNorm && !full.startsWith(rootNorm + sep)) return null
  return full
}

/** JSON response helper. */
function json(res, status, obj) {
  const body = JSON.stringify(obj)
  try {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch (error) {
    // connection already gone
  }
}

/** Collect a request body as a string with a hard size cap. */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let tooBig = false
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > limit) {
        tooBig = true
        req.destroy()
        return
      }
      chunks.push(String(chunk))
    })
    req.on('end', () => {
      if (tooBig) {
        reject(new Error('request body too large'))
        return
      }
      resolve(chunks.join(''))
    })
    req.on('error', reject)
  })
}

export function apply(ctx) {
  // webServer is provided by a row that itself waits on webStartup, so it may
  // not exist yet when this row activates; inject() defers until it does.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: '/dsh-editor',
      handler: async (req, res) => {
        const url = new URL(req.url || '/', 'http://dsh.local')
        const path = url.pathname
        try {
          // ── roots ──────────────────────────────────────────────────────
          if (path === '/dsh-editor/roots' && (req.method === 'GET' || req.method === 'HEAD')) {
            const registry = ctx.get('workspaceRegistry')
            const workspaces = registry && Array.isArray(registry.list())
              ? registry.list().map((w) => ({ id: String(w.id), title: w.title || w.path, path: w.path }))
              : []
            json(res, 200, { ok: true, workspaces })
            return
          }

          // ── tree ───────────────────────────────────────────────────────
          if (path === '/dsh-editor/tree' && (req.method === 'GET' || req.method === 'HEAD')) {
            const ws = workspaceById(ctx, url.searchParams.get('root'))
            if (!ws) {
              json(res, 404, { ok: false, error: '未找到工作区，请先在对话模式创建或选择一个工作区' })
              return
            }
            const tree = []
            const stats = { entries: 0 }
            await walkDir(ws.path, '', 0, tree, stats)
            json(res, 200, {
              ok: true,
              root: ws.path,
              title: ws.title || ws.path,
              tree,
              truncated: stats.entries >= MAX_TREE_ENTRIES,
            })
            return
          }

          // ── read file ──────────────────────────────────────────────────
          if (path === '/dsh-editor/file' && req.method === 'GET') {
            const ws = workspaceById(ctx, url.searchParams.get('root'))
            const rel = url.searchParams.get('path') || ''
            const full = ws ? safeResolve(ws.path, rel) : null
            if (!full) {
              json(res, 400, { ok: false, error: '无效路径' })
              return
            }
            try {
              const st = await fsp.stat(full)
              if (!st.isFile()) {
                json(res, 400, { ok: false, error: '不是文件' })
                return
              }
              if (st.size > MAX_FILE_BYTES) {
                json(res, 413, { ok: false, error: '文件过大（超过 2MB），请在外部编辑' })
                return
              }
              const content = await fsp.readFile(full, 'utf8')
              json(res, 200, { ok: true, path: rel, content, size: st.size })
            } catch (error) {
              json(res, 404, { ok: false, error: '读取失败: ' + esc(msg(error)) })
            }
            return
          }

          // ── write file ─────────────────────────────────────────────────
          if (path === '/dsh-editor/file' && req.method === 'POST') {
            let body
            try {
              body = await readBody(req, MAX_POST_BYTES)
            } catch (error) {
              json(res, 413, { ok: false, error: esc(msg(error)) })
              return
            }
            let payload = null
            try {
              payload = body && body.trim() ? JSON.parse(body) : null
            } catch (error) {
              json(res, 400, { ok: false, error: '请求体不是合法 JSON' })
              return
            }
            const ws = workspaceById(ctx, payload && payload.root)
            const rel = payload && typeof payload.path === 'string' ? payload.path : ''
            const content = payload && typeof payload.content === 'string' ? payload.content : null
            if (!ws || rel === '' || content === null) {
              json(res, 400, { ok: false, error: '参数不完整（root / path / content）' })
              return
            }
            const full = safeResolve(ws.path, rel)
            if (!full) {
              json(res, 400, { ok: false, error: '无效路径' })
              return
            }
            try {
              await fsp.mkdir(dirname(full), { recursive: true })
              await fsp.writeFile(full, content, 'utf8')
              json(res, 200, { ok: true, path: rel })
            } catch (error) {
              json(res, 500, { ok: false, error: '写入失败: ' + esc(msg(error)) })
            }
            return
          }

          res.writeHead(404)
          res.end('not found')
        } catch (error) {
          json(res, 500, { ok: false, error: esc(msg(error)) })
        }
      },
    }), 'dsh-editor: api routes')
  })
}
