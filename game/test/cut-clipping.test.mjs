// The 剖切 cut and the storey slice are two halves of one picture, and this is the
// seam between them: the plane decides what is invisible, and the slice walk is
// what the plane reaches.
//
// The bug it guards was reported as "you are not truly cutting anything away, you
// are just colouring those things black". The slice **caches** the materials it
// derives (`dimMats` for a 35% ghost, `clearMats` for 隐藏墙壁), keyed by the
// material it cloned, and a `Material.clone()` carries whatever `clippingPlanes`
// the original had at that moment. A ghost made before the cut was switched on
// therefore has none, and the cache hands it out again on every later walk — so
// geometry in the half that should be gone came back at full strength. The plane
// has to be restated on whatever the walk just dressed, not only on the materials
// it was handed (`LevelSystem.clipMesh`, reached from `setClip`).
//
// Which storey a ghost actually *is* matters to the fixture: a storey **above**
// the active one is not a ghost at all — 隐藏天花板 keeps only its unsupported
// plates — so the drawn-and-derived case is a storey **below** it.
//
// No canvas here: the walk only reads scene-graph flags and writes material
// properties.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { LevelSystem } from '../src/render/scene/systems/LevelSystem.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'

const B2 = -8
const B1 = -4

/** A station of two storeys, one opaque mesh each, wired the way the walk reads it. */
function station() {
  const scene = new THREE.Scene()
  const ctx = new SceneContextData(scene, {}, {}, {})
  ctx.activeZ = B1
  ctx.bounds.set(new THREE.Vector3(0, 0, B2), new THREE.Vector3(20, 20, 0))
  const level = new LevelSystem(ctx)

  const levelGroups = new Map()
  for (const lz of [B2, B1]) {
    const group = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x888888 }))
    mesh.userData.baseMaterial = mesh.material
    group.add(mesh)
    levelGroups.set(lz, group)
  }
  level.chunks = { levelGroups, outlineSet: new Set(), chunkMeshes: [], outlineMeshes: [] }
  level.modules = { moduleMeshes: new THREE.Group() }
  level.trains = { trainGroup: new THREE.Group() }
  return { ctx, level, levelGroups, meshAt: (lz) => levelGroups.get(lz).children[0] }
}

/**
 * The same station, but the active storey's mesh is a **wall** — with its dark
 * outline hull standing beside it, the way the mesher draws one — so 隐藏墙壁 has
 * something to act on. `wallPanel` is the same face as a module (a 屏蔽门).
 */
function wallStation() {
  const s = station()
  const group = s.levelGroups.get(B1)
  const face = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x999999 }))
  face.userData.baseMaterial = face.material
  face.userData.wall = true
  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), new THREE.MeshStandardMaterial({ color: 0x111111 }))
  hull.userData.baseMaterial = hull.material
  hull.userData.wall = true
  group.add(face, hull)
  s.level.chunks.outlineSet = new Set([hull])
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x999999 }))
  panel.userData.wall = true
  s.level.modules.moduleMeshes.add(panel)
  return { ...s, wallFace: face, wallHull: hull, wallPanel: panel }
}

const planesOf = (mesh) => mesh.material.clippingPlanes
const isClipped = (mesh) => (planesOf(mesh)?.length ?? 0) > 0

/**
 * What `SectionSystem.applyClip()` does to **one** material, in order: hand the
 * plane to the base material the mesh is wearing, then tell the walk about it. The
 * base material is the one `SceneRenderer` collected into `chunkMeshes` /
 * `outlineMeshes`; here it is the mesh's own, recorded as `userData.baseMaterial`.
 */
function applyClip(level, mesh, plane) {
  mesh.userData.baseMaterial.clippingPlanes = plane ? [plane] : null
  level.setClip(plane)
}

/** `applyClip` for a whole station — every material the section system was handed. */
function applyClipAll(level, meshes, plane) {
  for (const mesh of meshes) mesh.userData.baseMaterial.clippingPlanes = plane ? [plane] : null
  level.setClip(plane)
}

test('a cached ghost is clipped when the cut comes on', () => {
  const { level, meshAt } = station()
  // 显示其他层 on, no cut: the storey below is drawn as a 35% ghost, and that clone
  // is now cached for reuse.
  level.setLevel(B1, true)
  const ghostFirst = meshAt(B2).material
  assert.equal(meshAt(B2).visible, true, 'the storey below draws')
  assert.equal(meshAt(B2).material.opacity, 0.35, 'as a ghost')
  assert.equal(isClipped(meshAt(B2)), false, 'and no cut is on, so nothing is clipped')

  // The cut comes on: `SectionSystem.applyClip` sets the plane on the materials it
  // was handed and then hands it to the walk (`LevelSystem.setClip`).
  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)
  applyClipAll(level, [meshAt(B1), meshAt(B2)], plane)

  assert.equal(isClipped(meshAt(B2)), true, 'the ghost the cache hands back carries the plane')
  assert.equal(planesOf(meshAt(B2))[0], plane, 'and it is the very same plane, so a slide stays two numbers')
  assert.equal(isClipped(meshAt(B1)), true, 'the storey being edited is clipped too')
  // The cache is the point: the walk must not have dropped it to get there.
  assert.equal(meshAt(B2).material, ghostFirst, 'and the walk reused the cached ghost rather than replacing it')
})

test('while a cut is on the slice is put away: every storey draws, opaque', () => {
  const { level, meshAt } = station()
  // A player's rail left on 显示其他层 off: with the slice on, the storey below is
  // not drawn at all, so there would be nothing under the cut to see.
  level.setLevel(B1, false)
  assert.equal(meshAt(B2).visible, false)

  level.setCutaway(true)
  assert.equal(meshAt(B2).visible, true, 'the cut puts the slice away: every storey is there to be cut through')
  assert.equal(meshAt(B2).material.opacity, 1, 'and drawn as itself, not as a ghost — a cut through glass says nothing')
  assert.equal(meshAt(B1).material.opacity, 1)

  const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)
  applyClipAll(level, [meshAt(B1), meshAt(B2)], plane)
  assert.equal(isClipped(meshAt(B2)), true, 'and the plane reaches every storey')

  // Q/E and the slice toggles can no longer undo any of it: the cut is the only
  // thing hiding anything now.
  level.setAutoCeiling(true)
  level.setLevel(B1, true)
  assert.equal(meshAt(B2).material.opacity, 1, 'still opaque after the slice toggles are re-applied')
  assert.equal(isClipped(meshAt(B2)), true, 'and still clipped')

  // Turning the cut off hands the storeys back to the slice — and clears the plane
  // off the cached clones with it, or a ghost would stay cut forever.
  level.setCutaway(false)
  applyClipAll(level, [meshAt(B1), meshAt(B2)], null)
  assert.equal(isClipped(meshAt(B2)), false, 'no cut, no plane')
})

test('隐藏UI hands every storey back its own material, the storey below included', () => {
  // 隐藏UI's promise is "the station whole, every storey as itself" — and the half
  // of that a `visible` flag cannot do is the **material**. The mode put the slice
  // away, and the walk handed base materials back for walls (through `dressWall`)
  // but not for anything else, so a storey below kept the 35% ghost the slice had
  // given it: the floor under the camera stayed see-through and the storey beneath
  // showed up through it. The lower floor is therefore the case that matters here,
  // not the active one.
  const { level, meshAt } = station()
  level.setLevel(B1, true)
  assert.equal(meshAt(B2).material.opacity, 0.35, 'the slice ghosts the storey below')

  level.setHideUI(true)
  assert.equal(meshAt(B2).material.opacity, 1, '隐藏UI gives the storey below its own material back, not the ghost')
  assert.equal(meshAt(B2).material.transparent, false, 'and opaque, not a 35% sheet')
  assert.equal(meshAt(B2).material, meshAt(B2).userData.baseMaterial, 'it is the very base material the mesher assigned')
  assert.equal(meshAt(B2).visible, true, 'and the storey is drawn at all')
  assert.equal(meshAt(B1).material.opacity, 1, 'as is the storey being edited')

  // Switching it off asks the slice for the ghost back, from the same cache.
  level.setHideUI(false)
  assert.equal(meshAt(B2).material.opacity, 0.35, 'and leaving the mode returns the storey to the ghost')

  // 隐藏墙壁 is not the slice and survives the mode: a wall still reads through.
  const s = wallStation()
  s.level.setHideWalls(true)
  s.level.setHideUI(true)
  assert.equal(s.wallFace.material.opacity, 0.16, '隐藏墙壁 still reads a wall through while 隐藏UI is on')
  assert.equal(s.meshAt(B2).material.opacity, 1, 'while the floors are the building')
})

test('隐藏墙壁 hides walls completely while a cut is on, and reads through otherwise', () => {
  const s = wallStation()
  const { level, wallFace, wallHull, wallPanel } = s

  // 隐藏墙壁 alone: the wall faces read through at 16%, and the dark outline hull
  // is dropped — left in, it draws a solid black wall around its own faces.
  level.setHideWalls(true)
  assert.equal(wallFace.visible, true, 'the wall face is still there')
  assert.equal(wallFace.material.opacity, 0.16, 'but reads through')
  assert.equal(wallHull.visible, false, 'and its outline hull is gone')
  assert.equal(wallPanel.material.opacity, 0.16, 'a 屏蔽门 reads through the same way')

  // The cut joins in. Now a translucent wall is still an occluder, and the pair
  // exists to look at what the cut exposes — so the wall goes entirely, faces and
  // hull and module alike.
  const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)
  level.setCutaway(true)
  applyClipAll(level, [wallFace, wallHull, s.meshAt(B1), s.meshAt(B2)], plane)
  assert.equal(wallFace.visible, false, 'with the cut on, the wall face is gone — not see-through, gone')
  assert.equal(wallHull.visible, false, 'and the hull with it')
  assert.equal(wallPanel.visible, false, 'and a 屏蔽门 module too')
  assert.equal(s.meshAt(B1).visible, true, 'while the rest of the storey is still there to be cut through')

  // 隐藏墙壁 off, cut still on: the wall is part of the building again.
  level.setHideWalls(false)
  assert.equal(wallFace.visible, true, 'the wall comes back when 隐藏墙壁 is switched off')
  assert.equal(wallFace.material.opacity, 1, 'opaque, as the building')
})
