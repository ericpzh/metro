import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('runtime assembly references follow the dependency boundary', () => {
  const base = new URL('../Assets/StationDesigner/Runtime/', import.meta.url)
  const allowed = {
    Sim: [], Build: ['Metro.Sim'], Persistence: ['Metro.Sim','Metro.Build','Unity.Newtonsoft.Json'],
    View: ['Metro.Sim','Metro.Build'], App: ['Metro.Sim','Metro.Build','Metro.Persistence','Metro.View','Metro.Runtime'],
  }
  for (const [layer, references] of Object.entries(allowed)) {
    const def = JSON.parse(readFileSync(new URL(`${layer}/Metro.${layer}.asmdef`,base),'utf8'))
    assert.equal(def.name, `Metro.${layer}`)
    assert.deepEqual(def.references, references)
    if (layer === 'Sim' || layer === 'Build') assert.equal(def.noEngineReferences, true)
  }
})
