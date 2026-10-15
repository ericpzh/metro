import { readFileSync } from 'node:fs'
import { referenceStation } from '../game/src/data/reference-station.ts'
import { parse } from '../game/src/persistence/save.ts'
import { toData } from '../game/src/build/model.ts'

export function perfFixture() {
  if (!process.env.BENCH_STATION) return referenceStation()
  const result = parse(readFileSync(process.env.BENCH_STATION, 'utf8'))
  if (!result.ok) throw new Error(result.error)
  if (result.droppedCells || result.droppedModules) throw new Error('Benchmark fixture needs repair')
  return toData(result.state)
}
