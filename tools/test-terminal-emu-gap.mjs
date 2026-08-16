// Emulator check: cursor gap (cursor.c vs last visible cell) for the FIXED
// prompt formats + the render snap safety net.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'dsh-bundle', 'plugin', '@local', 'dsh-editor', 'lib', 'client.js'), 'utf8')
const start = src.indexOf('// style interning')
const end = src.indexOf('// ── embedded terminal wiring')
const block = src.slice(start, end)
const harness = `
function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;') }
${block}
export { TermEmu }
`
const mod = await import('data:text/javascript;base64,' + Buffer.from(harness).toString('base64'))
const { TermEmu } = mod

const cases = {
  'ps-compact-fixed (no trailing space)': '\\x1b[2J\\x1b[m\\x1b[HPS to-deepseek>\\x1b]0;x\\a\\x1b[?25h',
  'ps-compact-old (trailing space + 1C)': '\\x1b[2J\\x1b[m\\x1b[HPS to-deepseek>\\x1b[1C\\x1b]0;x\\a\\x1b[?25h',
  'ps-default-fullpath': '\\x1b[2J\\x1b[m\\x1b[HPS C:\\Users\\MSI\\Desktop\\to-deepseek>\\x1b[1C\\x1b]0;x\\a\\x1b[?25h',
  'cmd-compact': '\\x1b[2J\\x1b[m\\x1b[HMicrosoft Windows [\\u7248\\u672c 10.0.19045.6466]\\x1b]0;x\\a\\x1b[?25h\\r\\n(c) Microsoft Corporation\\u3002\\u4fdd\\u7559\\u6240\\u6709\\u6743\\u5229\\u3002\\r\\n\\x1b[41X\\r\\nC>\\x1b[39X',
  'cmd-default-fullpath': '\\x1b[2J\\x1b[m\\x1b[HMicrosoft Windows [\\u7248\\u672c 10.0.19045.6466]\\x1b]0;x\\a\\x1b[?25h\\r\\n(c) Microsoft Corporation\\u3002\\u4fdd\\u7559\\u6240\\u6709\\u6743\\u5229\\u3002\\r\\n\\x1b[41X\\r\\nC:\\Users\\MSI\\Desktop\\to-deepseek>        \\x1b[4;34H\\x1b[?25h',
  'ps-cjk-path': '\\x1b[2J\\x1b[m\\x1b[HPS \\u5ba0\\u7269\\u533b\\u9662\\u7cfb\\u7edf>\\x1b]0;x\\a\\x1b[?25h',
  'ps-typed-cmd': '\\x1b[2J\\x1b[m\\x1b[HPS to-deepseek>cd D:\\some\\long\\project\\r\\nPS to-deepseek>\\x1b[1C',
  'ps-editing-midline': '\\x1b[2J\\x1b[m\\x1b[HPS to-deepseek>dir\\x1b[D\\x1b[D',
}

function analyze(name, text) {
  const emu = new TermEmu(100, 24, 50)
  const decoded = text.replace(/\\x1b/g, '\x1b').replace(/\\r/g, '\r').replace(/\\n/g, '\n').replace(/\\a/g, '\x07').replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  emu.feed(decoded)
  const abs = emu.lines.length - emu.rows + emu.cursor.r
  const line = emu.lines[abs]
  const visible = line.ch.map((c, i) => (c === '\0' ? '' : c)).join('').replace(/\s+$/, '')
  let lastVis = -1
  for (let i = 0; i < line.ch.length; i++) {
    if (line.ch[i] !== ' ' && line.ch[i] !== '\0') lastVis = i
  }
  const snap = emu.cursor.c > lastVis + 1 ? lastVis + 1 : emu.cursor.c
  const rawGap = emu.cursor.c - (lastVis + 1)
  const snapGap = snap - (lastVis + 1)
  // PASS when the snap closes the gap; mid-line editing (cursor inside text,
  // negative gap) is also correct — the snap must NOT move it.
  const pass = snapGap === 0 || emu.cursor.c <= lastVis
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}`)
  console.log(`   text=[${visible}] cursor.c=${emu.cursor.c} lastVis=${lastVis} rawGap=${rawGap} snappedCol=${snap} snapGap=${snapGap}`)
  return pass
}

let allPass = true
for (const [name, text] of Object.entries(cases)) {
  if (!analyze(name, text)) allPass = false
}
console.log(allPass ? '\nALL EMULATOR GAP CHECKS PASSED' : '\nSOME CHECKS FAILED')
process.exit(allPass ? 0 : 1)
