#!/usr/bin/env node
/**
 * pack-exe.mjs — assemble the final DSH-Desktop-Huacai exe:
 *   shell.exe + payload dir  →  out.exe (DSHPAYLD overlay)
 *
 * Overlay format (identical to the original DSH-Desktop-Huacai-1.0.exe so the
 * existing parse-payload.mjs keeps working):
 *   [payloadStart] Int32 fileCount
 *   fileCount entries: Int32 nameLen + UTF8 name + Int64 dataLen + data
 *   [EOF-16] "DSHPAYLD" (8 bytes) + Int64 payloadLength
 *
 * Usage: node pack-exe.mjs <shell.exe> <payloadDir> <out.exe>
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const [shell, payloadDir, out] = process.argv.slice(2)
if (!shell || !payloadDir || !out) {
  console.error('usage: node pack-exe.mjs <shell.exe> <payloadDir> <out.exe>')
  process.exit(2)
}

/** Collect all files under dir with forward-slash relative names. */
function walk(dir) {
  const result = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const rel = relative(payloadDir, full).split(sep).join('/')
    if (statSync(full).isDirectory()) {
      result.push(...walk(full))
    } else {
      result.push({ name: rel, data: readFileSync(full) })
    }
  }
  return result
}

const entries = walk(payloadDir)
entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

const prefix = readFileSync(shell)
const chunks = []
const countBuf = Buffer.alloc(4)
countBuf.writeInt32LE(entries.length)
chunks.push(countBuf)
let payloadBytes = 4
for (const e of entries) {
  const nameBuf = Buffer.from(e.name, 'utf8')
  const nl = Buffer.alloc(4); nl.writeInt32LE(nameBuf.length)
  const dl = Buffer.alloc(8); dl.writeBigInt64LE(BigInt(e.data.length))
  chunks.push(nl, nameBuf, dl, e.data)
  payloadBytes += 4 + nameBuf.length + 8 + e.data.length
}
const payload = Buffer.concat(chunks)
const magic = Buffer.from('DSHPAYLD', 'ascii')
const lenBuf = Buffer.alloc(8); lenBuf.writeBigInt64LE(BigInt(payload.length))
const final = Buffer.concat([prefix, payload, magic, lenBuf])

writeFileSync(out, final)
console.log('已写出: ' + out)
console.log('  shell: ' + prefix.length + ' 字节')
console.log('  payload 条目数: ' + entries.length + ' (' + (payloadBytes / 1048576).toFixed(1) + ' MB)')
console.log('  总大小: ' + (final.length / 1048576).toFixed(1) + ' MB')
for (const e of entries) {
  if (e.data.length > 512 * 1024) {
    console.log('  大文件: ' + e.name + '  ' + (e.data.length / 1048576).toFixed(1) + ' MB')
  }
}
