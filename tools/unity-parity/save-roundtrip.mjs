import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { deepStrictEqual } from 'node:assert/strict'
import { parse, serialize } from '../../game/src/persistence/save.ts'

const out = resolve(process.argv[3] ?? '.preview/unity/save-parity')
const mode = process.argv[2] ?? 'prepare'
const timestamp = '2020-01-02T03:04:05.000Z'
const fixture = resolve('video/demo-station.metro.json')
const read = path => readFileSync(path, 'utf8')
const hash = text => createHash('sha256').update(text).digest('hex')
function parsed(text, label) {
  const result = parse(text)
  if (!result.ok) throw Error(`${label}: TS reader refused fixture: ${result.error}`)
  return result
}
function normalized(result) { return JSON.parse(serialize(result.state, new Date(timestamp))) }
function checkCsReport(name) {
  const report = JSON.parse(read(join(out, name)))
  if (report.droppedCells !== first.droppedCells || report.droppedModules !== first.droppedModules) throw Error(`${name}: C# repair counts differ`)
}
function compare(actual, expected, label) {
  try { deepStrictEqual(actual, expected) } catch (e) { throw Error(`${label}: semantic mismatch`, {cause:e}) }
}
mkdirSync(out, {recursive:true})
const original = read(fixture), first = parsed(original, 'authored source')
const expected = normalized(first)
if (mode === 'prepare') {
  writeFileSync(join(out, 'ts-write.json'), JSON.stringify(expected))
  writeFileSync(join(out, 'oracle.json'), JSON.stringify({schemaVersion:1, sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(), timestamp, fixtureSha256:hash(original), droppedCells:first.droppedCells, droppedModules:first.droppedModules, cells:first.state.cells.length, modules:first.state.modules.length, lines:first.state.lines.length}, null, 2))
  console.log(`Prepared TypeScript oracle in ${out}`)
} else if (mode === 'inspect') {
  const candidate = JSON.parse(read(join(out,'cs-candidate.json')))
  for (const key of ['name','nameEn','cityStyle','seed','levelBase','storeyHeight','cells','modules','lines','service','peaks','demand','calendar']) compare(candidate[key], first.state[key], 'candidate field ' + key)
  console.log('C# candidate matches authored TypeScript state fields; candidate is not a completed save round trip')
} else if (mode === 'verify') {
  checkCsReport('cs-from-ts.report.json'); checkCsReport('cs-from-authored.report.json')
  const tsToCs = parsed(read(join(out,'cs-from-ts.json')), 'TS → C# → TS')
  const csFirst = parsed(read(join(out,'cs-from-authored.json')), 'C# → TS')
  compare(normalized(tsToCs), expected, 'TS → C# → TS')
  compare(normalized(csFirst), expected, 'C# → TS')
  for (const result of [tsToCs,csFirst]) {
    if (result.droppedCells !== first.droppedCells || result.droppedModules !== first.droppedModules) throw Error('Repair count mismatch in TS read')
  }
  writeFileSync(join(out,'ts-from-cs.json'), serialize(csFirst.state, new Date(timestamp)))
  console.log('TS → C# → TS and C# → TS semantics passed; C# must read ts-from-cs.json to finish the reverse path')
} else if (mode === 'verify-final') {
  checkCsReport('cs-from-ts-from-cs.report.json')
  const csFinal = parsed(read(join(out,'cs-from-ts-from-cs.json')), 'C# → TS → C# → TS')
  compare(normalized(csFinal), expected, 'C# → TS → C#')
  if (csFinal.droppedCells !== first.droppedCells || csFinal.droppedModules !== first.droppedModules) throw Error('Final repair count mismatch')
  console.log('Both cross-engine semantic paths passed')
} else throw Error('Usage: node tools/unity-parity/save-roundtrip.mjs prepare|inspect|verify|verify-final [output-directory]')



