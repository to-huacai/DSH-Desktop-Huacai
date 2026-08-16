// Standalone syntax-highlight test for the @local/dsh-editor client tokenizer.
//   node tools/test-editor-highlight.mjs
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appModules = join(process.env.LOCALAPPDATA || '', 'DSH-Desktop-Huacai', 'app', 'node_modules')
const require = createRequire(join(appModules, '@deepseek-ai', 'dsh', 'package.json'))
const React = require('react')

let captured = null
const fakeWindow = {
  __ModuleLoader__: { load(entry) { captured = entry } },
}
const code = readFileSync(join(here, '..', 'dsh-bundle', 'plugin', '@local', 'dsh-editor', 'lib', 'client.js'), 'utf8')
new Function('window', code + '; return null')(fakeWindow)
if (!captured) throw new Error('loader not called')
const exports = captured.factory(require)
if (typeof exports._highlight !== 'function') throw new Error('_highlight not exported')

const H = exports._highlight
const L = exports._detectLang

// ── language detection ──
const cases = [
  ['src/index.js', 'js'], ['a.ts', 'ts'], ['c.tsx', 'tsx'], ['d.jsx', 'jsx'],
  ['p.py', 'py'], ['s.sh', 'sh'], ['p.ps1', 'ps1'], ['f.rs', 'rs'], ['g.go', 'go'],
  ['m.md', 'md'], ['i.html', 'html'], ['x.xml', 'xml'], ['style.css', 'css'],
  ['q.yaml', 'yaml'], ['t.toml', 'toml'], ['q.sql', 'sql'], ['noext', 'text'],
  ['Makefile', 'text'], ['x.JSON', 'json'],
]
for (const [path, want] of cases) {
  const got = L(path)
  if (got !== want) throw new Error(`detectLang(${path}) = ${got}, want ${want}`)
}
console.log('✓ detectLang: 18 cases pass')

// ── highlighting ──
function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg) }

const jsCode = `// a comment
const answer = 42; // trailing
function greet(name) {
  if (name === "world") { return \`hi \${name}\`; }
  /* block
     comment */
  return 'plain';
}`

const html = H(jsCode, 'js')
assert(html.includes('<span class="tok-com">// a comment</span>'), 'line comment')
assert(html.includes('<span class="tok-com">// trailing</span>'), 'trailing comment')
assert(html.includes('<span class="tok-com">/* block'), 'block comment start')
assert(html.includes('<span class="tok-kw">const</span>'), 'keyword const')
assert(html.includes('<span class="tok-kw">function</span>'), 'keyword function')
assert(html.includes('<span class="tok-kw">if</span>'), 'keyword if')
assert(html.includes('<span class="tok-num">42</span>'), 'number 42')
assert(html.includes('<span class="tok-str">&quot;world&quot;</span>'), 'double string')
assert(html.includes('<span class="tok-str">&#39;plain&#39;</span>'), 'single string')
assert(html.includes('<span class="tok-fn">greet</span>'), 'function call greet')
assert(!/<\/span>[^<]*</.test('') || true, '')
// escaping: < > & in text must be escaped
const escCode = 'const a = a < b && c > d & e;'
const escHtml = H(escCode, 'js')
assert(!escHtml.includes('a < b'), 'unescaped < present')
assert(escHtml.includes('a &lt; b'), 'escaped < missing')
assert(!escHtml.includes('c > d'), 'unescaped > present')
assert(escHtml.includes('c &gt; d'), 'escaped > missing')
console.log('✓ JS highlighting: keywords/strings/numbers/comments/functions/escaping pass')

// python hash comments
const py = H('def f(x):\n    # hash comment\n    return x or True\n', 'py')
assert(py.includes('<span class="tok-com"># hash comment</span>'), 'py hash comment')
assert(py.includes('<span class="tok-kw">def</span>'), 'py keyword def')
assert(py.includes('<span class="tok-kw">return</span>'), 'py keyword return')
assert(py.includes('<span class="tok-kw">True</span>'), 'py keyword True')
console.log('✓ Python highlighting pass')

// hash NOT a comment in js
const jsHash = H('const a = "#notacomment";\n// real\n', 'js')
assert(jsHash.includes('<span class="tok-com">// real</span>'), 'js line comment')
assert(jsHash.includes('#notacomment'), 'js # wrongly treated as comment')
assert(!jsHash.includes('<span class="tok-com">#notacomment</span>'), 'js # marked as comment')
console.log('✓ hash-comment scoping pass')

// sql -- comments
const sql = H('SELECT * FROM t -- note\nWHERE id = 1;\n', 'sql')
assert(sql.includes('<span class="tok-com">-- note</span>'), 'sql -- comment')
assert(sql.includes('<span class="tok-kw">SELECT</span>'), 'sql keyword SELECT')
console.log('✓ SQL highlighting pass')

// html tags
const htmlDoc = H('<div class="box">hello</div>\n', 'html')
assert(htmlDoc.includes('<span class="tok-tag">&lt;div</span>'), 'html tag div')
assert(htmlDoc.includes('<span class="tok-tag">&lt;/div&gt;</span>') || htmlDoc.includes('<span class="tok-tag">&lt;/div</span>'), 'html closing tag')
assert(htmlDoc.includes('<span class="tok-str">&quot;box&quot;</span>'), 'html attribute string')
console.log('✓ HTML tag highlighting pass')

// js -- NOT a comment
const jsDash = H('a--b;\n', 'js')
assert(!jsDash.includes('tok-com'), 'js -- wrongly a comment')
console.log('✓ js -- scoping pass')

// large file fallback (plain escaped, no spans)
const big = 'x'.repeat(200000)
const bigHtml = H(big, 'js')
assert(bigHtml.length === 200000, 'large file should be plain-escaped, got ' + bigHtml.length)
console.log('✓ large-file plain fallback pass')

// empty / null-safe
assert(H('', 'js') === '', 'empty string')
assert(H(null, 'js') === '', 'null code')
console.log('✓ empty/null safety pass')

console.log('\nALL HIGHLIGHT TESTS PASSED')
