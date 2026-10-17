// Derived only from the approved ash bake; no procedural work on a pointer/frame.
import { readFileSync, writeFileSync } from 'node:fs'
const source = JSON.parse(readFileSync(new URL('../game/src/assets/trees/street-ash.json', import.meta.url), 'utf8'))

function branches(mesh, step = .07) {
  const buckets = new Map(), remap = [], vertices = []
  for (let i = 0; i < mesh.position.length / 3; i++) {
    const p = mesh.position.slice(i * 3, i * 3 + 3)
    const key = p.map(v => Math.round(v / step)).join(',')
    let index = buckets.get(key)
    if (index === undefined) { index = vertices.length; buckets.set(key, index); vertices.push({ p: [0, 0, 0], n: [0, 0, 0], uv: [0, 0], count: 0 }) }
    const vertex = vertices[index]; vertex.count++
    p.forEach((value, j) => { vertex.p[j] += value; vertex.n[j] += mesh.normal[i * 3 + j] })
    vertex.uv[0] += mesh.uv[i * 2]; vertex.uv[1] += mesh.uv[i * 2 + 1]
    remap.push(index)
  }
  const output = { position: [], normal: [], uv: [], index: [] }
  for (const vertex of vertices) {
    output.position.push(...vertex.p.map(v => +(v / vertex.count).toFixed(5)))
    const length = Math.hypot(...vertex.n) || 1
    output.normal.push(...vertex.n.map(v => +(v / length).toFixed(4)))
    output.uv.push(...vertex.uv.map(v => +(v / vertex.count).toFixed(4)))
  }
  for (let i = 0; i < mesh.index.length; i += 3) {
    const face = mesh.index.slice(i, i + 3).map(v => remap[v])
    if (new Set(face).size === 3) output.index.push(...face)
  }
  return output
}

function trunk(mesh) {
  // EZ-Tree writes the main trunk first, as contiguous rings plus a UV seam.
  // Decimate those rings instead of clustering a thin trunk into disconnected faces.
  const sections = source.options.branch.sections[0], segments = source.options.branch.segments[0]
  const sides = 6, rings = []
  for (let i = 0; i < sections; i += 2) rings.push(i)
  rings.push(sections)
  const output = { position: [], normal: [], uv: [], index: [] }
  for (const ring of rings) for (let j = 0; j <= sides; j++) {
    const vertex = ring * (segments + 1) + Math.floor(j * segments / sides)
    output.position.push(...mesh.position.slice(vertex * 3, vertex * 3 + 3))
    output.normal.push(...mesh.normal.slice(vertex * 3, vertex * 3 + 3))
    output.uv.push(...mesh.uv.slice(vertex * 2, vertex * 2 + 2))
  }
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < sides; j++) {
    const a = i * (sides + 1) + j, b = a + sides + 1
    output.index.push(a, b, a + 1, a + 1, b, b + 1)
  }
  return output
}

function leaves(mesh, stride = 2, expansion = 1) {
  // Keep crossed cards intact (UVs and normals), including every canopy extremum.
  const keep = new Set(), output = { position: [], normal: [], uv: [], index: [] }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < mesh.position.length; i++) {
    min[i % 3] = Math.min(min[i % 3], mesh.position[i]); max[i % 3] = Math.max(max[i % 3], mesh.position[i])
  }
  for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
    let best = 0
    for (let i = 1; i < mesh.position.length / 3; i++) if (mesh.position[i * 3 + axis] * sign > mesh.position[best * 3 + axis] * sign) best = i
    keep.add(Math.floor(best / 8))
  }
  for (let card = 0; card < mesh.position.length / 24; card++) {
    if (card % stride && !keep.has(card)) continue
    const base = output.position.length / 3
    const points = mesh.position.slice(card * 24, card * 24 + 24)
    const centre = [0, 0, 0]
    points.forEach((p, i) => { centre[i % 3] += p / 8 })
    let scale = expansion
    points.forEach((p, i) => {
      const axis = i % 3, delta = p - centre[axis]
      if (delta) scale = Math.min(scale, ((delta > 0 ? max[axis] : min[axis]) - centre[axis]) / delta)
    })
    output.position.push(...points.map((p, i) => expansion === 1 ? p : centre[i % 3] + (p - centre[i % 3]) * scale))
    output.normal.push(...mesh.normal.slice(card * 24, card * 24 + 24))
    output.uv.push(...mesh.uv.slice(card * 16, card * 16 + 16))
    output.index.push(...mesh.index.slice(card * 12, card * 12 + 12).map(i => base + i - card * 8))
  }
  return output
}

const output = { source: source.source, derivation: '7 cm branch clustering; alternate intact crossed leaf cards, retaining canopy extrema', branches: branches(source.branches), leaves: leaves(source.leaves) }
writeFileSync(new URL('../game/src/assets/trees/street-ash-lod.json', import.meta.url), JSON.stringify(output))
console.log('Ash distant LOD triangles:', output.branches.index.length / 3, output.leaves.index.length / 3)
const far = { source: source.source, derivation: 'Continuous six-sided main trunk, alternate longitudinal rings; every thirty-second intact crossed leaf card plus canopy extrema, expanded up to 3x within authored bounds', branches: trunk(source.branches), leaves: leaves(source.leaves, 32, 3) }
writeFileSync(new URL('../game/src/assets/trees/street-ash-far.json', import.meta.url), JSON.stringify(far))
console.log('Ash far LOD triangles:', far.branches.index.length / 3, far.leaves.index.length / 3)
