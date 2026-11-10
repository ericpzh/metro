import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
test('smoke rejects a one-line replacement of the packed font license and replaces a stale report', () => {
  const parent = join(root, '.preview/unity')
  mkdirSync(parent, { recursive: true })
  const out = mkdtempSync(join(parent, 'smoke-negative-'))
  try {
    const licenses = join(out, 'packed/licenses')
    mkdirSync(licenses, { recursive: true })
    const original = readFileSync(join(root, 'unity/Assets/StationDesigner/Fonts/OFL.txt'))
    writeFileSync(join(licenses, 'OFL.txt'), 'SIL OPEN FONT LICENSE\n')
    writeFileSync(join(out, 'packed/manifest.json'), JSON.stringify({files:[{path:'licenses/OFL.txt',bytes:original.length,sha256:createHash('sha256').update(original).digest('hex')}],splitFiles:{}}))
    writeFileSync(join(out, 'smoke-report.json'), JSON.stringify({status:'passed'}))
    const result = spawnSync(process.execPath, [join(root, 'tools/unity-web/smoke.mjs'), out], { encoding:'utf8' })
    assert.notEqual(result.status, 0)
    const report = JSON.parse(readFileSync(join(out, 'smoke-report.json'), 'utf8'))
    assert.equal(report.status, 'failed')
    assert.match(report.error, /Packed digest mismatch: licenses\/OFL\.txt/)
    assert.match(report.manifestSha256, /^[a-f0-9]{64}$/)
  } finally { rmSync(out, {recursive:true,force:true}) }
})
