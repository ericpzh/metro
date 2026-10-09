import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CubicleModel } from '../src/render/models/pieces/CubicleModel.ts'
import { rotateLocal } from '../src/sim/track.ts'

const cubicle = (id, x, y, rot = 0, z = 0) => ({ id, type: 'cubicle', x, y, z, rot, cfg: {} })
function context(modules, preview = false) {
  const metal = new THREE.MeshStandardMaterial()
  return { mats: { steel: metal, darkSteel: metal, green: metal }, data: { modules }, preview, owned: [] }
}
const panels = (group) => group.children.filter((mesh) => mesh.name === 'cubicle-partition')

test('a standalone cubicle encloses three sides and has a fourth-side privacy door', () => {
  for (let rot = 0; rot < 4; rot++) {
    const mod = cubicle('a', 0, 0, rot)
    const group = new CubicleModel(context([mod])).build(mod)
    assert.equal(panels(group).length, 3)
    assert.ok(group.getObjectByName('cubicle-door'))
    assert.equal(group.position.z, 1, 'rests on the floor surface')
  }
})

test('adjacent cubicles share one wall and their rear panels meet flush in every rotation', () => {
  for (let rot = 0; rot < 4; rot++) {
    const [dx, dy] = rotateLocal(rot, 1, 0)
    const mods = [cubicle('a', 0, 0, rot), cubicle('b', dx, dy, rot)]
    const groups = mods.map((mod) => new CubicleModel(context(mods)).build(mod))
    assert.equal(groups.reduce((count, group) => count + panels(group).length, 0), 5, 'one shared partition, never doubled')
    const backs = groups.map((group) => {
      group.updateMatrixWorld(true)
      const rear = panels(group).find((mesh) => mesh.position.y === 0.5)
      return new THREE.Box3().setFromObject(rear)
    })
    assert.ok(Math.abs(backs[0].distanceToPoint(backs[1].getCenter(new THREE.Vector3())) - 0.5) < 1e-6, 'rear panels span the whole cell to the seam')
    // Removing either neighbour rebuilds all three sides of the surviving stall.
    for (const mod of mods) assert.equal(panels(new CubicleModel(context([mod])).build(mod)).length, 3)
  }
})

test('shared panels respect rotated neighbours, floors and placement previews', () => {
  const a = cubicle('a', 0, 0)
  const b = cubicle('b', 1, 0, 2)
  const mods = [a, b]
  assert.equal(panels(new CubicleModel(context(mods)).build(b)).length, 2)
  assert.equal(panels(new CubicleModel(context(mods, true)).build(b)).length, 3, 'ghost shows the complete stall')
  const upstairs = { ...b, z: 4 }
  assert.equal(panels(new CubicleModel(context([a, upstairs])).build(upstairs)).length, 3, 'a different floor cannot own this wall')
})
