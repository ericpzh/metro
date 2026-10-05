// The chunk cache's **GPU** half: a chunk whose content did not change must come back
// with the very buffer objects it had.
//
// `meshStation` releases the last rebuild exactly once, and only after the reuse set is
// known. It used to release first as well — unguarded — and because `releaseChunks` also
// empties `chunkMeshes`/`outlineMeshes`, the keep-aware call that followed had nothing
// left to skip: every cached geometry and every per-chunk outline material was disposed
// and then re-added, so three re-uploaded the whole station's buffers and recompiled the
// outline program on **every** edit, at a cost that grew with the station. CPU meshing was
// still cached, which is why the leak was invisible in the frame counters' triangle count
// and only showed as "it gets slower the longer I build".
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { ChunkSystem } from '../src/render/scene/systems/ChunkSystem.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'

/** A material kit just real enough for the mesher (no GL, no textures). */
function kit() {
  const made = new Map()
  return {
    finish: (id) => {
      let m = made.get(id)
      if (!m) {
        m = new THREE.MeshBasicMaterial()
        made.set(id, m)
      }
      return m
    },
    outline: new THREE.MeshBasicMaterial(),
  }
}

function renderer() {
  const ctx = new SceneContextData(new THREE.Scene(), kit(), undefined, undefined)
  return { ctx, chunks: new ChunkSystem(ctx) }
}

/** A station of solid cells at `z = 0`, `y = 0`. */
function row(xs) {
  return { name: 'cache', seed: 1, cells: xs.map((x) => ({ x, y: 0, z: 0, fill: 'solid' })), modules: [], lines: [] }
}

/**
 * Mesh a station into a renderer, recording every disposal in `disposed`. The watch is
 * registered on what the rebuild just produced, so a geometry that comes back a second
 * time keeps its listener (a `Set` absorbs the repeats).
 */
function mesh(chunks, data, disposed) {
  chunks.prepareStation(data)
  chunks.meshStation(data)
  for (const mesh of [...chunks.chunkMeshes, ...chunks.outlineMeshes]) {
    const geometry = mesh.geometry
    geometry.addEventListener('dispose', () => disposed.add(geometry))
    const material = mesh.material
    material.addEventListener('dispose', () => disposed.add(material))
  }
  return disposed
}

test('an unchanged chunk keeps its geometry and outline material across a rebuild', () => {
  // Two chunks far apart: an edit inside one must leave the other's buffers alone.
  const { chunks } = renderer()
  const disposed = new Set()
  mesh(chunks, row([2, 3, 4, 40, 41]), disposed)
  const before = chunks.chunkMeshes.map((m) => m.geometry)
  const outlinesBefore = chunks.outlineMeshes.map((m) => m.material)
  assert.ok(before.length > 0, 'the station meshed into chunk parts')
  assert.ok(chunks.chunkMeshes.length >= 4, 'and into more than one chunk')

  // An edit four chunks away, so every chunk under test is byte-identical.
  mesh(chunks, row([2, 3, 4, 40, 41, 90]), disposed)
  const after = chunks.chunkMeshes.map((m) => m.geometry)

  const kept = before.filter((g) => after.includes(g))
  assert.ok(kept.length > 0, 'the untouched chunks came back as the same geometry objects')
  for (const g of kept) assert.equal(disposed.has(g), false, 'and none of them was disposed on the way')
  for (const m of outlinesBefore) {
    assert.equal(disposed.has(m), false, 'the per-chunk outline material survived too (no program recompile)')
  }
})

test('a chunk whose content changed releases the geometry it is done with', () => {
  const { chunks } = renderer()
  const disposed = new Set()
  mesh(chunks, row([2, 3, 4]), disposed)
  const before = chunks.chunkMeshes.map((m) => m.geometry)

  // A block added inside the same chunk: it has to re-mesh, and the old buffers go.
  mesh(chunks, row([2, 3, 4, 5]), disposed)
  for (const g of before) assert.equal(disposed.has(g), true, 'a re-meshed chunk released its old geometry')
  for (const g of chunks.chunkMeshes.map((m) => m.geometry)) assert.equal(disposed.has(g), false, 'and the fresh one is live')
  assert.ok(chunks.chunkMeshes.some((m) => !before.includes(m.geometry)), 'the chunk was rebuilt, not reused')
})

test('a rebuild still prunes chunks the station no longer has', () => {
  const { chunks } = renderer()
  const disposed = new Set()
  mesh(chunks, row([2, 3, 4, 40, 41]), disposed)
  mesh(chunks, row([2, 3, 4]), disposed)
  assert.equal(chunks.chunkMeshes.length > 0, true, 'the remaining chunk is drawn')
  for (const g of chunks.chunkMeshes.map((m) => m.geometry)) {
    assert.equal(disposed.has(g), false, 'nothing live was disposed')
  }
})
