// 隐藏地面 — the street plane as its own mesh pass.
//
// The street is stored inverted (`sim/ground.ts`): the document holds its *holes*,
// and every other coordinate at z = 0 is ground for as far as anything can walk.
// The renderer materialises a bounded window of it (`withGround`), and **that
// window is one thing**: the surface the player can take away whole, which is what
// the 视图 folder's 隐藏地面 tile does.
//
// So this file pins the two halves of that decision, both of them in
// `ChunkSystem.meshStation`:
//
//   * **The window is its own pass** (`g`), tagged `ground`, and *only* that pass
//     draws it. It used to be emitted twice — once by the storey pass and once by
//     the unsupported-plate pass — because every street cell is a plate with
//     nothing under it: the two copies were byte-identical geometry, the second
//     losing the depth test, so half the street's triangles were built and
//     uploaded to draw nothing. A surface a toggle has to be able to hide whole
//     cannot be smeared across the storey's own chunks either.
//   * **隐藏地面 is one flag on those meshes** (`LevelSystem.applyLevel`), holding
//     in every mode — 显示其他层, 隐藏天花板, 隐藏UI and 剖切 alike — and touching
//     nothing that is not the street: the blocks the document owns at z = 0 stay
//     exactly where they were, and the sim goes on walking the same window.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { ChunkSystem } from '../src/render/scene/systems/ChunkSystem.ts'
import { LevelSystem } from '../src/render/scene/systems/LevelSystem.ts'
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

/** A meshed station, with the level walk wired to the real chunk meshes. */
function rig(data) {
  const ctx = new SceneContextData(new THREE.Scene(), kit(), undefined, undefined)
  const chunks = new ChunkSystem(ctx)
  const level = new LevelSystem(ctx)
  level.chunks = chunks
  // The walk also visits the fixtures and the consists; a station with neither is
  // the ground's own business, so both are empty groups.
  level.modules = { moduleMeshes: new THREE.Group() }
  level.trains = { trainGroup: new THREE.Group() }
  chunks.prepareStation(data)
  chunks.meshStation()
  return { ctx, chunks, level }
}

const station = (cells) => ({ name: 'street', seed: 1, cells, modules: [], lines: [] })

const streetMeshes = (chunks) => chunks.chunkMeshes.filter((m) => m.userData.ground === true)
const streetOutlines = (chunks) => chunks.outlineMeshes.filter((m) => m.userData.ground === true)
const ownMeshes = (chunks) => chunks.chunkMeshes.filter((m) => m.userData.ground !== true)

/** Which pass's mesh a cell's own geometry — strictly inside its square — belongs to. */
function drawnBy(chunks, x, y, z) {
  const out = new Set()
  for (const mesh of chunks.chunkMeshes) {
    const pos = mesh.geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i)
      const vy = pos.getY(i)
      const vz = pos.getZ(i)
      if (vx <= x + 1e-6 || vx >= x + 1 - 1e-6) continue
      if (vy <= y + 1e-6 || vy >= y + 1 - 1e-6) continue
      if (vz < z - 1e-6 || vz > z + 1 + 1e-6) continue
      out.add(mesh.userData.ground === true ? 'g' : mesh.userData.float === true ? 'f' : 's')
      break
    }
  }
  return [...out].sort()
}

/* ------------------------------------------------------------- the pass itself */

test('an empty document is the street alone, and the street is the ground pass', () => {
  // A new station holds no cells at all: everything the mesher draws is the
  // generated window (`sim/ground.ts`), which is exactly the set 隐藏地面 owns.
  const { chunks } = rig(station([]))
  assert.ok(chunks.chunkMeshes.length > 0, 'the street window meshed nothing')
  assert.equal(streetMeshes(chunks).length, chunks.chunkMeshes.length, 'the street is not the whole of an empty station')
  assert.deepEqual(drawnBy(chunks, 10, 10, 0), ['g'], 'the street cell is drawn by the ground pass and nothing else')
})

test('the street is meshed once, not by every pass that could draw it', () => {
  // Every street cell is a plate with nothing under it, so the unsupported-plate
  // pass claims it too — and the storey pass used to emit it as well. Two of those
  // three copies were the same surface drawn over itself.
  const { chunks } = rig(station([{ x: 0, y: 0, z: 0, fill: 'solid' }]))
  assert.deepEqual(drawnBy(chunks, 10, 10, 0), ['g'], 'a street cell away from the build is drawn once')
  // And the same holds for a street cell that touches the build: the document's
  // own block at (0,0,0) is solid, so the pavement beside it is a half-inset cap.
  assert.deepEqual(drawnBy(chunks, 1, 0, 0), ['g'], 'a street cell against a block is drawn once')
  assert.ok(ownMeshes(chunks).length > 0, 'the block the document owns is not part of the street')
})

test('the street wears the plate tags: hidden by 隐藏地面, kept by 隐藏天花板', () => {
  const { chunks } = rig(station([]))
  for (const mesh of [...streetMeshes(chunks), ...streetOutlines(chunks)]) {
    assert.equal(mesh.userData.float, true, 'the street is a plate with nothing under it, so 隐藏天花板 never lifts it')
  }
  assert.equal(streetOutlines(chunks).length > 0, true, 'the street carries outlines of its own to hide')
})

/* ---------------------------------------------------------------- the toggle */

test('隐藏地面 takes the street away, in every mode, and gives it back', () => {
  const { chunks, level } = rig(station([{ x: 0, y: 0, z: 0, fill: 'solid' }]))
  const visible = (list) => list.map((m) => m.visible)
  level.setLevel(0, true)
  assert.ok(
    streetMeshes(chunks).every((m) => m.visible),
    'the street draws before the toggle is pressed',
  )

  level.setHideGround(true)
  assert.deepEqual(new Set(visible(streetMeshes(chunks))), new Set([false]), 'the street is gone')
  assert.deepEqual(new Set(visible(streetOutlines(chunks))), new Set([false]), 'and so is its outline hull')
  assert.ok(
    ownMeshes(chunks).every((m) => m.visible),
    '隐藏地面 took a block the document owns with it: it is not the street',
  )

  // **Every mode**, one at a time: the slice toggles, 隐藏UI and the cut are all
  // ways of drawing a storey, and the street is not a storey.
  for (const [label, move] of [
    ['显示其他层 off', () => level.setLevel(0, false)],
    ['隐藏天花板 off', () => level.setAutoCeiling(false)],
    ['隐藏UI on', () => level.setHideUI(true)],
    ['剖切 on', () => level.setCutaway(true)],
  ]) {
    move()
    assert.deepEqual(new Set(visible(streetMeshes(chunks))), new Set([false]), `the street came back with ${label}`)
  }

  level.setHideGround(false)
  assert.ok(
    streetMeshes(chunks).every((m) => m.visible),
    'the street stays away once 隐藏地面 is switched off',
  )
})

test('隐藏地面 is a visibility flag, not a rebuild', () => {
  // The meshes the toggle writes on are the ones the rebuild already made: the
  // same objects, the same geometry. A pass that re-meshed the station would show
  // up here as fresh meshes (and as the hitch the toggle is meant not to have).
  const { chunks, level } = rig(station([{ x: 0, y: 0, z: 0, fill: 'solid' }]))
  const before = streetMeshes(chunks).map((m) => m.geometry)
  level.setHideGround(true)
  level.setHideGround(false)
  assert.deepEqual(
    streetMeshes(chunks).map((m) => m.geometry),
    before,
    'the street was rebuilt rather than hidden',
  )
})
