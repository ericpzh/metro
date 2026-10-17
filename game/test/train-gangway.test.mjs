// The gap between two cars (§1.13). A car stops 12.5 cm short of its own length at each
// end, so two neighbouring shells stand a quarter of a metre apart — and on A/B/C/L stock
// that gap was simply open, which the platform reads as a hole through the train. The
// real stock closes it with an enclosed flexible gangway: a **black** piece a little
// smaller than the car on every axis, riding on the car's own outline so the two read as
// one body. These are its pins:
//
//   * the gangway's section is the car's own section, scaled by one factor — same shape,
//     not a different silhouette with a smaller one inside it;
//   * every boundary between two cars gets one, and they all sit strictly inside the
//     car's skin (a section that touched it would push through the shell);
//   * the bellows spans the gap the shells leave, and it is corrugated;
//   * the consist pays one draw call for all of them, and D keeps its own curved bellows.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildTrain, createModelMaterials, disposeModelMaterials, disposeObject } from '../src/render/models.ts'
import {
  CAR_CROWN_Z,
  CAR_GAP,
  CAR_SILL_Z,
  GANGWAY_SHRINK,
  GANGWAY_TUCK,
  carBodySection,
  gangwayGeometry,
  gangwaySection,
  sectionOutline,
} from '../src/render/models/pieces/TrainGangway.ts'
import { DOOR_HEAD_Z, STOCK_CLASSES, STOCK } from '../src/sim/stock.ts'
import { stubCanvas } from './support/stub-canvas.mjs'

function canvas() {
  const node = { width: 0, height: 0 }
  const { g, ops } = stubCanvas(); g.canvas = node
  node.getContext = () => g; node.ops = ops
  return node
}

/** Build one consist inside the model kit's own materials, as the game does. */
function withTrain(stock, cars, run) {
  const previous = globalThis.document
  globalThis.document = { createElement: canvas }
  let mats, root
  try {
    mats = createModelMaterials()
    root = buildTrain(mats, { x: 0, y: 0, z: 0, stock, cars, doorsOpen: false, colour: '#00679e', dirSign: 1, yaw: 0 })
    return run(root, mats)
  } finally {
    if (root) disposeObject(root)
    if (mats) disposeModelMaterials(mats)
    globalThis.document = previous
  }
}

/** The box of every vertex `keep` accepts, or null when it kept none. */
function pointBox(positions, keep = () => true) {
  const box = new THREE.Box3()
  for (let i = 0; i < positions.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(positions, i)
    if (keep(p)) box.expandByPoint(p)
  }
  return box.isEmpty() ? null : box
}

const CLOSED = STOCK_CLASSES.filter((cls) => cls !== 'D')

test('the gangway is the car section itself, lightly smaller on every axis', () => {
  for (const cls of CLOSED) {
    const width = STOCK[cls].width
    const car = carBodySection(width)
    const gap = gangwaySection(width)
    const carOutline = sectionOutline(car)
    const gapOutline = sectionOutline(gap)
    assert.equal(gapOutline.length, carOutline.length, `${cls}: one outline, sampled the same way`)
    const mid = (car.sill + car.crown) / 2
    for (const [i, point] of gapOutline.entries()) {
      // Same shape: one factor about the body's mid height, so a scaled copy of the car's
      // own point — not a second silhouette that happens to be smaller.
      assert.ok(Math.abs(point.x - carOutline[i].x * GANGWAY_SHRINK) < 1e-9, `${cls}: point ${i} is not the car's own flank, scaled`)
      assert.ok(Math.abs(point.y - (mid + (carOutline[i].y - mid) * GANGWAY_SHRINK)) < 1e-9, `${cls}: point ${i} is not at its scaled height`)
    }
    // And it is *slightly* smaller: a bellows, not a tube.
    assert.ok(gap.halfWidth < car.halfWidth && gap.halfWidth > car.halfWidth * 0.9, `${cls}: half width ${gap.halfWidth.toFixed(3)} m`)
    assert.ok(gap.crown < CAR_CROWN_Z && gap.sill > CAR_SILL_Z, `${cls}: the section is inboard of the car's sill and crown`)
    assert.ok(gap.crown > DOOR_HEAD_Z, `${cls}: the bellows must clear the doorway head, got ${gap.crown.toFixed(2)} m`)
    assert.ok(gap.shoulder > 0.3, `${cls}: the rolled shoulder is what makes it read as the same shape`)
  }
})

test('every boundary between two cars is closed by one black bellows', () => {
  for (const cls of CLOSED) {
    const cars = cls === 'A' ? 8 : 6
    withTrain(cls, cars, (root, mats) => {
      const gangways = []
      root.traverse((o) => { if (o.name === 'car-intercar-gangway') gangways.push(o) })
      assert.equal(gangways.length, 1, `${cls}: the consist's gangways are one mesh, one draw call`)
      const mesh = gangways[0]
      assert.equal(mesh.material, mats.rubber, `${cls}: the gangway wears the kit's rubber`)
      const colour = mesh.material.color
      assert.ok(colour.r < 0.2 && colour.g < 0.2 && colour.b < 0.2, `${cls}: it has to read black, got ${colour.getHexString()}`)
      assert.equal(mesh.material.transparent, false, `${cls}: an opaque piece, not a tint over the gap`)

      const s = STOCK[cls]
      const total = s.length * cars
      const positions = mesh.geometry.getAttribute('position')
      const box = pointBox(positions)
      // Inside the car's own skin on every axis — the gangway tucks under the shell's end
      // face, so anything wider or taller would push through the body.
      assert.ok(box.max.y < s.width / 2 && box.min.y > -s.width / 2, `${cls}: ${box.max.y.toFixed(3)} m is not inside the ${s.width} m car`)
      assert.ok(box.max.z < CAR_CROWN_Z && box.min.z > CAR_SILL_Z, `${cls}: ${box.min.z.toFixed(2)}–${box.max.z.toFixed(2)} m is not inside the car's ${CAR_SILL_Z}–${CAR_CROWN_Z} m body`)
      assert.ok(box.min.x > -total / 2 && box.max.x < total / 2, `${cls}: a gangway hangs off the end of the consist`)

      const joints = []
      for (let c = 1; c < cars; c++) joints.push(c * s.length - total / 2)
      assert.ok(box.min.x <= joints[0] - CAR_GAP / 2 && box.max.x >= joints.at(-1) + CAR_GAP / 2, `${cls}: the bellows stops short of the gap it exists to close`)

      // One cross-section per boundary, standing square in the gap: its own width, its
      // sill and its crown, exactly where the car's end face is.
      const section = gangwaySection(s.width)
      for (const joint of joints) {
        const ring = pointBox(positions, (p) => Math.abs(p.x - joint) < GANGWAY_TUCK + 1e-6)
        assert.ok(ring, `${cls}: no gangway at the boundary ${joint.toFixed(2)} m`)
        assert.ok(Math.abs(ring.max.y - section.halfWidth) < 1e-6, `${cls}: the bellows meets the car ${ring.max.y.toFixed(3)} m wide, not ${section.halfWidth.toFixed(3)} m`)
        assert.ok(Math.abs(ring.max.z - section.crown) < 1e-6 && Math.abs(ring.min.z - section.sill) < 1e-6, `${cls}: the end ring is not the gangway's own section`)
      }

      // Corrugated: the folds pull the widest ring in from the end ring, which is the
      // bellows the real stock carries rather than a plain box on the join.
      let widest = 0, narrowest = Infinity
      for (let x = box.min.x + 1e-6; x < box.max.x; x += 0.01) {
        const slice = pointBox(positions, (p) => Math.abs(p.x - x) < 0.006)
        if (!slice) continue
        const half = Math.max(slice.max.y, -slice.min.y)
        widest = Math.max(widest, half); narrowest = Math.min(narrowest, half)
      }
      assert.ok(narrowest < widest * 0.99, `${cls}: the bellows is a smooth tube, folds ${narrowest.toFixed(3)}–${widest.toFixed(3)} m`)
    })
  }
})

test('D keeps its own curved bellows, and a one-car consist has no joint to close', () => {
  withTrain('D', 8, (root) => {
    const names = []
    root.traverse((o) => { if (o.name.endsWith('gangway')) names.push(o.name) })
    assert.equal(names.filter((n) => n === 'd-intercar-gangway').length, 7, 'D spans every gap with its own section')
    assert.equal(names.filter((n) => n === 'car-intercar-gangway').length, 0, 'D is not given the box-section bellows as well')
  })
  for (const cls of [...CLOSED, 'D']) {
    withTrain(cls, 1, (root) => {
      const names = []
      root.traverse((o) => { if (o.name.endsWith('gangway')) names.push(o.name) })
      assert.deepEqual(names, [], `${cls}: a single car has no gap between cars to close`)
    })
  }
})

test('the gangway geometry is what a consist would draw, at every car width', () => {
  // The pure builder, with no materials behind it: the game, a thumbnail and the concept
  // sheets all frame the same piece.
  for (const cls of CLOSED) {
    const width = STOCK[cls].width
    const joints = [-width, 0, width]
    const geometry = gangwayGeometry(joints, width)
    const positions = geometry.getAttribute('position')
    assert.ok(positions.count > 0 && geometry.index.count > 0, `${cls}: a bellows needs surface`)
    const box = pointBox(positions)
    assert.ok(box.min.x < joints[0] - CAR_GAP / 2 && box.max.x > joints.at(-1) + CAR_GAP / 2)
    // Every triangle faces out of the section: the surface is drawn, not turned inside out.
    const section = gangwaySection(width)
    const centreZ = (section.sill + section.crown) / 2
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), normal = new THREE.Vector3(), out = new THREE.Vector3()
    for (let i = 0; i < geometry.index.count; i += 3) {
      a.fromBufferAttribute(positions, geometry.index.getX(i))
      b.fromBufferAttribute(positions, geometry.index.getX(i + 1))
      c.fromBufferAttribute(positions, geometry.index.getX(i + 2))
      normal.copy(ab.subVectors(b, a)).cross(ac.subVectors(c, a))
      if (normal.lengthSq() < 1e-12) continue
      // The piece is a tube round the consist's x, so an outward face has to point away
      // from the section's own centre line.
      out.set(0, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3 - centreZ)
      assert.ok(normal.dot(out) > 0, `${cls}: a gangway face is wound inward`)
    }
  }
})
