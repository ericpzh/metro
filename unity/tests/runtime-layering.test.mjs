import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../..')

function walkFiles(dir, predicate, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, predicate, out)
    else if (entry.isFile() && predicate(full)) out.push(full)
  }
  return out.sort()
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
}

test('runtime assembly references follow the dependency boundary', () => {
  const base = new URL('../Assets/StationDesigner/Runtime/', import.meta.url)
  const allowed = {
    Sim: [], Build: ['Metro.Sim'], Persistence: ['Metro.Sim','Metro.Build','Unity.Newtonsoft.Json'],
    View: ['Metro.Sim','Metro.Build'], App: ['Metro.Sim','Metro.Build','Metro.Persistence','Metro.View','Metro.Runtime','Unity.InputSystem','Unity.ugui'],
  }
  for (const [layer, references] of Object.entries(allowed)) {
    const def = JSON.parse(readFileSync(new URL(`${layer}/Metro.${layer}.asmdef`,base),'utf8'))
    assert.equal(def.name, `Metro.${layer}`)
    assert.deepEqual(def.references, references)
    if (layer === 'Sim' || layer === 'Build' || layer === 'Persistence') {
      assert.equal(def.noEngineReferences, true, `Metro.${layer} must stay engine-free`)
    }
  }
})

test('Metro.Sim C# sources ban non-deterministic random and wall-clock APIs', () => {
  const simDir = join(repo, 'unity/Assets/StationDesigner/Runtime/Sim')
  const files = walkFiles(simDir, file => file.endsWith('.cs'))
  assert.ok(files.length > 0, 'Expected C# source files under Runtime/Sim')

  const banned = [
    { label: 'UnityEngine.Random', pattern: /\bUnityEngine\.Random\b/ },
    { label: 'System.Random', pattern: /\bSystem\.Random\b/ },
    { label: 'new Random(...)', pattern: /\bnew\s+Random\s*\(/ },
    { label: 'DateTime.Now', pattern: /\bDateTime\.Now\b/ },
    { label: 'DateTime.UtcNow', pattern: /\bDateTime\.UtcNow\b/ },
    { label: 'Environment.TickCount', pattern: /\bEnvironment\.TickCount\b/ },
  ]

  const violations = []
  for (const file of files) {
    const code = stripComments(readFileSync(file, 'utf8'))
    const rel = relative(repo, file).replaceAll('\\', '/')
    for (const rule of banned) {
      if (rule.pattern.test(code)) violations.push(`${rel}: banned non-deterministic API ${rule.label}`)
    }
  }
  assert.deepEqual(violations, [], `Non-deterministic APIs found in Metro.Sim:\n${violations.join('\n')}`)
})

test('Unity web shell never imports three or runtime ../render/scene', () => {
  const webDir = join(repo, 'game/src/unity-web')
  const files = walkFiles(webDir, file => /\.(?:ts|tsx)$/.test(file))
  assert.ok(files.length > 0, 'Expected TypeScript files under game/src/unity-web')

  const staticImport = /\bimport\s+(type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g
  const dynamicImport = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  const isThree = spec => spec === 'three' || spec.startsWith('three/')
  const isRenderScene = spec => /(?:^|\/)render\/scene(?:\.ts)?(?:$|\/)/.test(spec)

  const violations = []
  for (const file of files) {
    const code = stripComments(readFileSync(file, 'utf8'))
    const rel = relative(repo, file).replaceAll('\\', '/')
    for (const match of code.matchAll(staticImport)) {
      const isTypeOnly = Boolean(match[1])
      const spec = match[2]
      if (isThree(spec)) {
        violations.push(`${rel}: forbidden three import '${spec}'`)
      } else if (isRenderScene(spec)) {
        // Legacy zooUi.tsx keeps one erased type-only SceneRenderer reference;
        // no runtime import (and no scene import anywhere else) is allowed.
        const allowedLegacyTypeStub = rel === 'game/src/unity-web/zooUi.tsx' && isTypeOnly
        if (!allowedLegacyTypeStub) {
          violations.push(`${rel}: forbidden render/scene import '${spec}'`)
        }
      }
    }
    for (const match of code.matchAll(dynamicImport)) {
      const spec = match[1]
      if (isThree(spec) || isRenderScene(spec)) {
        violations.push(`${rel}: forbidden dynamic import '${spec}'`)
      }
    }
  }
  assert.deepEqual(violations, [], `Forbidden Three/scene imports found in game/src/unity-web:\n${violations.join('\n')}`)
})
