// PLAN.md §3: "Dependency direction is one-way: app/ -> render/ -> sim/, and
// sim/ imports nothing." A lint rule would do this; a test keeps it honest
// without another toolchain.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const SRC = new URL('../src/', import.meta.url)

function filesIn(dir) {
  const out = []
  for (const entry of fs.readdirSync(new URL(dir, SRC), { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...filesIn(dir + entry.name + '/'))
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(dir + entry.name)
  }
  return out
}

function importsOf(file) {
  const text = fs.readFileSync(new URL(file, SRC), 'utf8')
  const re = /from\s+'([^']+)'/g
  const out = []
  let m
  while ((m = re.exec(text))) out.push(m[1])
  return out
}

/**
 * A relative import spec resolved against the importing file, as a path from `src/`.
 * A layer may be a **folder tree** (`sim/world/World.ts`), so `../agents.ts` from
 * inside `sim/world/` stays in `sim/` and is legal — only a resolution that leaves the
 * layer is a violation. The old flat check rejected every `..`, which is not the rule.
 */
function resolveFrom(file, spec) {
  const parts = file.split('/')
  parts.pop()
  for (const part of spec.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

test('sim/ imports nothing outside sim/', () => {
  for (const file of filesIn('sim/')) {
    for (const spec of importsOf(file)) {
      if (!spec.startsWith('.')) assert.fail(`${file} imports the package "${spec}"`)
      assert.ok(resolveFrom(file, spec).startsWith('sim/'), `${file} escapes sim/ with ${spec}`)
    }
  }
})

test('sim/ never touches the DOM, three or react', () => {
  for (const file of filesIn('sim/')) {
    for (const spec of importsOf(file)) {
      assert.ok(!spec.includes('three') && !spec.includes('react'), `${file} imports ${spec}`)
    }
    const text = fs.readFileSync(new URL(file, SRC), 'utf8')
    for (const banned of ['document.', 'window.', 'requestAnimationFrame']) {
      assert.ok(!text.includes(banned), `${file} references ${banned}`)
    }
  }
})

test('render/ does not import app/, and build/ imports neither render/ nor app/', () => {
  for (const file of filesIn('render/')) {
    for (const spec of importsOf(file)) {
      if (!spec.startsWith('.')) continue
      assert.ok(!resolveFrom(file, spec).startsWith('app/'), `${file} imports ${spec}`)
    }
  }
  for (const file of filesIn('build/')) {
    for (const spec of importsOf(file)) {
      if (!spec.startsWith('.')) continue
      const resolved = resolveFrom(file, spec)
      assert.ok(!resolved.startsWith('render/'), `${file} imports ${spec}`)
      assert.ok(!resolved.startsWith('app/'), `${file} imports ${spec}`)
    }
  }
})
