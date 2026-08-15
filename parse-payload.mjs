#!/usr/bin/env node
/**
 * parse-payload.mjs — parse the embedded overlay payload of DSH-Desktop-Huacai-1.0.exe.
 *
 * Payload layout (overlay appended after the .NET assembly):
 *   [payloadStart] Int32 fileCount
 *   then fileCount entries, each: Int32 nameLen + name + Int64 dataLen + data
 *   [EOF-16] "DSHPAYLD" (8 bytes) + Int64 payloadLength (bytes from payloadStart to sentinel)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const EXE = process.argv[2] || 'DSH-Desktop-Huacai-1.0.exe'
const OUT = process.argv[3] || null // optional extract dir

const buf = readFileSync(EXE)
const n = buf.length

const MAGIC = Buffer.from('DSHPAYLD', 'ascii')
const sentinel = n - 16
if (buf.subarray(sentinel, sentinel + 8).toString('ascii') !== 'DSHPAYLD') {
  throw new Error(`未找到 DSHPAYLD 哨兵（EOF-16 = ${JSON.stringify(buf.subarray(sentinel, sentinel + 8).toString('ascii'))}）`)
}
const payloadLength = buf.readBigInt64LE(sentinel + 8)
const payloadStart = sentinel - Number(payloadLength)
console.log(`文件: ${EXE}`)
console.log(`总长度: ${n}`)
console.log(`哨兵偏移: ${sentinel}`)
console.log(`payload 长度: ${payloadLength}`)
console.log(`payload 起始: ${payloadStart}`)

let off = payloadStart
const fileCount = buf.readInt32LE(off)
off += 4
console.log(`文件数: ${fileCount}`)

const entries = []
for (let i = 0; i < fileCount; i++) {
  const nameLen = buf.readInt32LE(off); off += 4
  const name = buf.subarray(off, off + nameLen).toString('utf8'); off += nameLen
  const dataLen = Number(buf.readBigInt64LE(off)); off += 8
  const data = buf.subarray(off, off + dataLen); off += dataLen
  entries.push({ name, dataLen, data })
  console.log(`  [${i}] name=${JSON.stringify(name)} len=${dataLen} @ ${off - dataLen}`)
}
console.log(`解析结束偏移: ${off}（应等于哨兵偏移 ${sentinel}）`)

if (OUT) {
  mkdirSync(OUT, { recursive: true })
  for (const e of entries) {
    const p = join(OUT, e.name)
    // normalize nested dirs
    const dir = p.replace(/[^/\\]+$/, '')
    if (dir) mkdirSync(dir, { recursive: true })
    writeFileSync(p, e.data)
    console.log(`  已提取: ${p}`)
  }
}
