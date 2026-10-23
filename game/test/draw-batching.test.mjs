import { trainDoorMotion } from '../src/render/trainDoorMotion.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { bakedGeometry, BATCH_SOURCE_LAYER } from '../src/render/batchGeometry.ts'
import { EquipmentBatches } from '../src/render/equipmentBatches.ts'
import { PanelAtlas, atlasUV } from '../src/render/panelAtlas.ts'
import { batchStaticParts } from '../src/render/batchStaticModule.ts'
import { batchTrainDoors, batchTrainTransparent } from '../src/render/trainBatches.ts'
import { buildTrain, createModelMaterials, disposeModelMaterials, disposeObject, setDoorsSides } from '../src/render/models.ts'
import { stubCanvas } from './support/stub-canvas.mjs'
import { passengerEligible } from '../src/render/passengerEligibility.ts'
import { STOCK, STOCK_CLASSES, doorCentres, doorWidthAt } from '../src/sim/stock.ts'
import { TrainSystem } from '../src/render/scene/systems/TrainSystem.ts'

function canvas() {
  const node = { width: 0, height: 0 }
  const { g, ops } = stubCanvas(); g.canvas = node
  node.getContext = () => g; node.ops = ops
  return node
}

test('A alternates five doors with four B-sized inset windows on each car side', () => {
  const previous = globalThis.document; globalThis.document = { createElement: canvas }
  const mats = createModelMaterials()
  const reference = buildTrain(mats, { x:0, y:0, z:0, stock:'B', cars:4, doorsOpen:false, colour:'#e45526', dirSign:1, yaw:0 })
  const size = mesh => new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3())
  const expected = size(reference.getObjectByName('b-car-window'))
  try {
    for (const cars of [6, 8]) for (const dirSign of [-1, 1]) {
      const root = buildTrain(mats, { x:0, y:0, z:0, stock:'A', cars, doorsOpen:false, colour:'#e45526', dirSign, yaw:0 })
      try {
        root.updateMatrixWorld(true)
        const parts = []; root.traverse(o => { if (o.isMesh) parts.push(o) })
        const windows = parts.filter(o => o.name === 'a-car-window')
        assert.equal(windows.length, cars * 4 * 2, 'only four inter-door windows per side, with painted end bays')
        const centres = doorCentres({ stock:'A', cars })
        for (let car = 0; car < cars; car++) for (const side of [-1, 1]) {
          const doors = centres.slice(car * 5, car * 5 + 5)
          const panes = windows.filter(o => Math.sign(o.position.y) === side && o.position.x > doors[0] && o.position.x < doors[4]).sort((a,b) => a.position.x - b.position.x)
          assert.equal(panes.length, 4)
          for (const [i, pane] of panes.entries()) {
            assert.ok(size(pane).distanceTo(expected) < 1e-5, 'A uses the same smaller aperture as B')
            const box = new THREE.Box3().setFromObject(pane)
            assert.ok(box.min.x > doors[i] + STOCK.A.doorWidth / 2 + .25)
            assert.ok(box.max.x < doors[i + 1] - STOCK.A.doorWidth / 2 - .25)
            const ray = new THREE.Raycaster(new THREE.Vector3(pane.position.x, side * 4, pane.position.z), new THREE.Vector3(0, -side, 0))
            assert.equal(ray.intersectObjects(parts, false)[0]?.object, pane, 'glass is visible through a real opening')
          }
        }
        assert.equal(root.userData.doors.length, cars * 5 * 4)
        const closed = root.userData.doors.map(o => o.position.x)
        setDoorsSides(root, 1, 0)
        root.userData.doors.forEach((door, i) => assert.equal(door.position.x === closed[i], door.userData.side === -1))
      } finally { disposeObject(root) }
    }
  } finally { disposeObject(reference); disposeModelMaterials(mats); globalThis.document = previous }
})

test('B keeps its shell with a single cab shield and three framed windows between four doorways', () => {
  const previous = globalThis.document; globalThis.document = { createElement: canvas }
  let mats
  try {
    mats = createModelMaterials()
    for (const cars of [4, 6]) for (const dirSign of [-1, 1]) {
      const root = buildTrain(mats, {x:0, y:0, z:0, stock:'B', cars, doorsOpen:false, colour:'#e45526', dirSign, yaw:0})
      try {
        root.updateMatrixWorld(true)
        const parts = []; root.traverse(o => { if (o.isMesh) parts.push(o) })
        const shields = parts.filter(o => o.name === 'b-cab-windscreen')
        assert.equal(shields.length, 2)
        for (const shield of shields) {
          const bounds = new THREE.Box3().setFromObject(shield)
          assert.ok(bounds.max.y - bounds.min.y > STOCK.B.width * .7, 'one broad pane spans the cab')
        }
        assert.equal(parts.filter(o => o.name === 'cab-shell').length, 2)
        const windows = parts.filter(o => o.name === 'b-car-window')
        assert.equal(windows.length, cars * 3 * 2)
        const centres = doorCentres({ stock:'B', cars })
        for (let car = 0; car < cars; car++) {
          const doors = centres.slice(car * 4, car * 4 + 4)
          for (const side of [-1, 1]) {
            const panes = windows.filter(o => Math.sign(o.position.y) === side && o.position.x > doors[0] && o.position.x < doors[3])
            assert.equal(panes.length, 3)
            panes.sort((a,b) => a.position.x - b.position.x)
            for (const [i, pane] of panes.entries()) {
              const box = new THREE.Box3().setFromObject(pane)
              assert.ok(box.min.x > doors[i] + STOCK.B.doorWidth / 2 + .25)
              assert.ok(box.max.x < doors[i + 1] - STOCK.B.doorWidth / 2 - .25)
              const ray = new THREE.Raycaster(new THREE.Vector3(pane.position.x, side * 4, pane.position.z), new THREE.Vector3(0, -side, 0))
              const hits = ray.intersectObjects(parts, false)
              assert.equal(hits[0]?.object, pane, 'the pane is an open aperture, without an opaque panel behind it')
            }
          }
        }
        assert.equal(root.userData.doors.length, cars * 4 * 4)
        const closed = root.userData.doors.map(o => o.position.x)
        setDoorsSides(root, 1, 0)
        root.userData.doors.forEach((door, i) => assert.equal(door.position.x === closed[i], door.userData.side === -1))
      } finally { disposeObject(root) }
    }
    for (const stock of ['A', 'C', 'L']) {
      const root = buildTrain(mats, {x:0, y:0, z:0, stock, cars:4, doorsOpen:false, colour:'#e45526', dirSign:1, yaw:0})
      try { assert.equal(root.getObjectByName('b-cab-windscreen'), undefined); assert.equal(root.getObjectByName('b-car-window'), undefined) }
      finally { disposeObject(root) }
    }
  } finally { if (mats) disposeModelMaterials(mats); globalThis.document = previous }
})

test('L keeps its shell, single windshield and small-door-big-door-big-door-small side layout', () => {
  const previous = globalThis.document; globalThis.document = { createElement: canvas }
  const mats = createModelMaterials()
  try {
    for (const cars of [4, 6]) for (const dirSign of [-1, 1]) {
      const root = buildTrain(mats, { x:0, y:0, z:0, stock:'L', cars, doorsOpen:false, colour:'#3399bb', dirSign, yaw:0 })
      try {
        root.updateMatrixWorld(true)
        const parts = []; root.traverse(o => { if (o.isMesh) parts.push(o) })
        assert.equal(parts.filter(o => o.name === 'cab-shell').length, 2)
        assert.equal(parts.filter(o => o.name === 'car-roof').length, cars)
        const shields = parts.filter(o => o.name === 'l-cab-windscreen')
        assert.equal(shields.length, 2)
        for (const shield of shields) {
          const box = new THREE.Box3().setFromObject(shield)
          assert.ok(box.max.y - box.min.y > STOCK.L.width * .7)
        }
        const big = parts.filter(o => o.name === 'l-car-big-window')
        const small = parts.filter(o => o.name === 'l-car-small-window' || o.name === 'l-cab-side-window')
        assert.equal(big.length, cars * 4)
        assert.equal(small.length, cars * 4)
        const centres = doorCentres({ stock:'L', cars })
        for (let car = 0; car < cars; car++) for (const side of [-1, 1]) {
          const start = car * STOCK.L.length - cars * STOCK.L.length / 2
          const inCar = list => list.filter(o => Math.sign(o.position.y) === side && o.position.x > start && o.position.x < start + STOCK.L.length).sort((a,b) => a.position.x - b.position.x)
          const bigPanes = inCar(big), smallPanes = inCar(small), doors = centres.slice(car * 3, car * 3 + 3)
          assert.equal(bigPanes.length, 2); assert.equal(smallPanes.length, 2)
          assert.ok(smallPanes[0].position.x < doors[0] && smallPanes[1].position.x > doors[2])
          for (const [i, pane] of bigPanes.entries()) {
            const box = new THREE.Box3().setFromObject(pane)
            assert.ok(box.max.x - box.min.x > 2.5)
            assert.ok(box.min.x > doors[i] + STOCK.L.doorWidth / 2 + .3)
            assert.ok(box.max.x < doors[i + 1] - STOCK.L.doorWidth / 2 - .3)
            const ray = new THREE.Raycaster(new THREE.Vector3(pane.position.x + .3, side * 4, pane.position.z), new THREE.Vector3(0, -side, 0))
            assert.equal(ray.intersectObjects(parts, false)[0]?.object, pane, 'glazing has a real aperture')
          }
          for (const pane of smallPanes) {
            const box = new THREE.Box3().setFromObject(pane)
            assert.ok(box.max.x - box.min.x < .75)
          }
        }
        assert.equal(root.userData.doors.length, cars * 12)
        const closed = root.userData.doors.map(o => o.position.x)
        setDoorsSides(root, 1, 0)
        root.userData.doors.forEach((door, i) => assert.equal(door.position.x === closed[i], door.userData.side === -1))
      } finally { disposeObject(root) }
    }
  } finally { disposeModelMaterials(mats); globalThis.document = previous }
})

test('C keeps two front panes, an evacuation door and small-door-big-door-big-door-big-door-small sides', () => {
  const previous = globalThis.document; globalThis.document = { createElement: canvas }
  const mats = createModelMaterials()
  try {
    for (const cars of [4, 6]) for (const dirSign of [-1, 1]) {
      const root = buildTrain(mats, { x:0, y:0, z:0, stock:'C', cars, doorsOpen:false, colour:'#3399bb', dirSign, yaw:0 })
      try {
        root.updateMatrixWorld(true)
        const parts = []; root.traverse(o => { if (o.isMesh) parts.push(o) })
        assert.equal(parts.filter(o => o.name === 'cab-shell').length, 2)
        assert.equal(parts.filter(o => o.name === 'car-roof').length, cars)
        const shields = parts.filter(o => o.name === 'c-cab-windscreen')
        assert.equal(shields.length, 2)
        for (const name of ['c-cab-door-window', 'c-cab-front-door', 'c-cab-front-door-frame', 'c-cab-door-handle']) {
          assert.equal(parts.filter(o => o.name === name).length, 2, `${name} at both ends`)
        }
        const frontWindows = parts.filter(o => o.name === 'c-cab-door-window')
        for (const [i, shield] of shields.entries()) {
          assert.ok(shield.position.y * frontWindows[i].position.y < 0, 'two panes straddle the front pillar')
        }
        for (const shield of shields) {
          const box = new THREE.Box3().setFromObject(shield)
          assert.ok(box.max.y - box.min.y > STOCK.C.width * .3)
        }
        for (const pane of [...shields, ...frontWindows]) {
          const outward = Math.sign(pane.position.x)
          const nose = outward * cars * STOCK.C.length / 2
          const box = new THREE.Box3().setFromObject(pane)
          const back = outward * (pane.position.x - nose) - (box.max.x - box.min.x) / 2
          const backing = pane.name === 'c-cab-windscreen' ? .19 : .196
          assert.ok(back < backing, 'the pane embeds in its backing instead of floating in front of it')
          assert.ok(outward * (pane.position.x - nose) + (box.max.x - box.min.x) / 2 > backing, 'the glass face remains visible')
        }
        const marks = parts.filter(o => o.name === 'c-cab-mark')
        assert.equal(marks.length, 2)
        for (const mark of marks) {
          const box = new THREE.Box3().setFromObject(mark)
          assert.ok(box.max.y - box.min.y <= .241 && box.max.z - box.min.z <= .281, 'C uses the smaller emblem')
          const sameEnd = [...shields, ...frontWindows].filter(o => Math.sign(o.position.x) === Math.sign(mark.position.x))
          for (const pane of sameEnd) assert.ok(box.max.z < new THREE.Box3().setFromObject(pane).min.z, 'the entire emblem clears the glazing')
          const door = parts.find(o => o.name === 'c-cab-front-door' && Math.sign(o.position.x) === Math.sign(mark.position.x))
          const doorBox = new THREE.Box3().setFromObject(door)
          assert.ok(box.max.y < doorBox.min.y || box.min.y > doorBox.max.y, 'the emblem also clears the front door')
        }
        for (const outward of [-1, 1]) for (const side of [-1, 1]) {
          const nose = outward * cars * STOCK.C.length / 2
          const ray = new THREE.Raycaster(new THREE.Vector3(nose + outward * 3, side * STOCK.C.width * .31 + .14, .99), new THREE.Vector3(-outward, 0, 0))
          const material = ray.intersectObjects(parts, false)[0]?.object.material
          assert.equal(material, outward === dirSign ? mats.headlight : mats.taillight, 'the evacuation door leaves both lamp clusters visible')
        }
        const big = parts.filter(o => o.name === 'c-car-big-window')
        const small = parts.filter(o => o.name === 'c-car-small-window' || o.name === 'c-cab-side-window')
        assert.equal(big.length, cars * 6)
        assert.equal(small.length, cars * 4)
        const centres = doorCentres({ stock:'C', cars })
        for (let car = 0; car < cars; car++) for (const side of [-1, 1]) {
          const start = car * STOCK.C.length - cars * STOCK.C.length / 2
          const inCar = list => list.filter(o => Math.sign(o.position.y) === side && o.position.x > start && o.position.x < start + STOCK.C.length).sort((a,b) => a.position.x - b.position.x)
          const bigPanes = inCar(big), smallPanes = inCar(small), doors = centres.slice(car * 4, car * 4 + 4)
          assert.equal(bigPanes.length, 3); assert.equal(smallPanes.length, 2)
          assert.ok(smallPanes[0].position.x < doors[0] && smallPanes[1].position.x > doors[3])
          for (const [i, pane] of bigPanes.entries()) {
            const box = new THREE.Box3().setFromObject(pane)
            assert.ok(box.max.x - box.min.x > 1.7)
            assert.ok(box.min.x > doors[i] + STOCK.C.doorWidth / 2 + .3)
            assert.ok(box.max.x < doors[i + 1] - STOCK.C.doorWidth / 2 - .3)
            const ray = new THREE.Raycaster(new THREE.Vector3(pane.position.x + .3, side * 4, pane.position.z), new THREE.Vector3(0, -side, 0))
            assert.equal(ray.intersectObjects(parts, false)[0]?.object, pane, 'glazing has a real aperture')
          }
          for (const pane of smallPanes) {
            const box = new THREE.Box3().setFromObject(pane)
            assert.ok(box.max.x - box.min.x < .75)
          }
        }
        assert.equal(root.userData.doors.length, cars * 16)
        const closed = root.userData.doors.map(o => o.position.x)
        setDoorsSides(root, 1, 0)
        root.userData.doors.forEach((door, i) => assert.equal(door.position.x === closed[i], door.userData.side === -1))
      } finally { disposeObject(root) }
    }
  } finally { disposeModelMaterials(mats); globalThis.document = previous }
})

test('D has two small windows between each of four doorways, with a single doorway at each cab', () => {
  const previous = globalThis.document; globalThis.document = { createElement: canvas }
  const mats = createModelMaterials()
  try {
    for (const dirSign of [-1, 1]) {
      const pose = {x:0, y:0, z:0, stock:'D', cars:8, doorsOpen:false, colour:'#254eae', dirSign, yaw:0}
      const root = buildTrain(mats, pose)
      try {
        root.updateMatrixWorld(true)
        const parts = []; root.traverse(o => { if (o.isMesh) parts.push(o) })
        const windows = parts.filter(o => o.name === 'd-car-window').map(mesh => ({mesh, box:new THREE.Box3().setFromObject(mesh)}))
        assert.equal(windows.length, 8 * 6 * 2, 'six small windows on every side, with no extra end panes')
        const centres = doorCentres(pose)
        for (let car = 0; car < 8; car++) for (const side of [-1, 1]) {
          const doors = centres.slice(car * 4, car * 4 + 4)
          for (let bay = 0; bay < 3; bay++) {
            const panes = windows.filter(({box}) => Math.sign(box.min.y) === side && box.min.x > doors[bay] && box.max.x < doors[bay + 1])
            assert.equal(panes.length, 2, `car ${car}, side ${side}, bay ${bay}: exactly two panes`)
            for (const {mesh, box} of panes) {
              assert.ok(box.max.x - box.min.x <= .781 && box.max.x - box.min.x >= .77, 'the small pane width is retained')
              assert.ok(box.min.x > doors[bay] + doorWidthAt(pose, doors[bay]) / 2)
              assert.ok(box.max.x < doors[bay + 1] - doorWidthAt(pose, doors[bay + 1]) / 2)
              const point = box.getCenter(new THREE.Vector3())
              const ray = new THREE.Raycaster(new THREE.Vector3(point.x, side * 4, point.z), new THREE.Vector3(0, -side, 0))
              assert.equal(ray.intersectObjects(parts, false)[0]?.object, mesh, 'glass stays visible through its shell opening')
            }
          }
          const widths = doors.map(x => doorWidthAt(pose, x))
          assert.deepEqual(widths, [car === 0 ? .8 : 1.4, 1.4, 1.4, car === 7 ? .8 : 1.4])
        }
        assert.equal(root.userData.doors.length, 124, 'three double plus one single per cab side; four doubles per middle side')
        const closed = root.userData.doors.map(o => o.position.x)
        setDoorsSides(root, 1, 0)
        root.userData.doors.forEach((door, i) => assert.equal(door.position.x === closed[i], door.userData.side === -1))
      } finally { disposeObject(root) }
    }
  } finally { disposeModelMaterials(mats); globalThis.document = previous }
})

test('D model keeps swept cabs inside the consist and plugs only the platform door bank', () => {
  const previous = globalThis.document; globalThis.document = { createElement: canvas }
  let mats, root
  try {
    mats = createModelMaterials()
    root = buildTrain(mats, {x:0, y:0, z:0, stock:'D', cars:8, doorsOpen:false, colour:'#254eae', dirSign:-1, yaw:0})
    const cabs = root.children.filter(o => o.name === 'streamlined-cab')
    assert.equal(cabs.length, 2)
    const parts = []
    root.traverse(o => { if (o.isMesh) parts.push(o) })
    assert.equal(parts.filter(o => o.name === 'd-car-roof').length, 8, 'every car has the dedicated D shell')
    assert.equal(parts.filter(o => o.name === 'car-roof').length, 0, 'no generic car roof behind the cab')
    const total = STOCK.D.length * 8
    for (const cab of cabs) {
      const bounds = new THREE.Box3().setFromObject(cab)
      assert.ok(bounds.min.x >= -total / 2 - 1e-5 && bounds.max.x <= total / 2 + 1e-5)
      const shell = cab.getObjectByName('d-cab-shell')
      const glass = cab.getObjectByName('d-cab-windscreen')
      assert.ok(shell && glass, 'a separate shell and sloped windscreen are present')
      assert.ok(glass.geometry.userData.projectionError < 0.002, `window projection fits without a folded edge: ${glass.geometry.userData.projectionError}`)
      const glassBounds = new THREE.Box3().setFromObject(glass)
      assert.ok(glassBounds.max.z - glassBounds.min.z > 0.7 && glassBounds.max.z - glassBounds.min.z < 0.95, 'windscreen preserves its physical U outline in the front view')
      const area = mesh => {
        const p = mesh.geometry.attributes.position, index = mesh.geometry.index
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
        let sum = 0
        for (let i = 0; i < index.count; i += 3) {
          a.fromBufferAttribute(p, index.getX(i)); b.fromBufferAttribute(p, index.getX(i + 1)); c.fromBufferAttribute(p, index.getX(i + 2))
          sum += b.sub(a).cross(c.sub(a)).length() / 2
        }
        return sum
      }
      const mask = cab.getObjectByName('d-cab-mask')
      const maskBounds = new THREE.Box3().setFromObject(mask)
      const relativeWidth = (glassBounds.max.y - glassBounds.min.y) / (maskBounds.max.y - maskBounds.min.y)
      assert.ok(relativeWidth > 0.65 && relativeWidth < 0.85, 'slim central shield stays inside the narrower dark surround')
      assert.ok(glassBounds.max.y-glassBounds.min.y<1.34,'central windshield retains the slimmer width')
      const colour=cab.getObjectByName('d-cab-livery')
      assert.ok(area(colour)/area(mask)>0.5,'line colour covers a broad surround rather than a thin edge')
      colour.geometry.computeBoundingBox()
      assert.ok(colour.geometry.boundingBox.min.z<1.55,'coloured surround reaches down the front of the nose')
      assert.ok(area(glass) / area(mask) > 0.15, 'the shorter shield keeps a substantial glazed area')
      assert.equal(cab.children.filter(o => o.name === 'd-cab-side-window').length, 2)
      for (const window of cab.children.filter(o => o.name === 'd-cab-side-window')) {
        window.geometry.computeBoundingBox()
        const box = window.geometry.boundingBox
        // The four-sided pane retains a finite short edge.
        const projectedArea = mesh => {
          const p = mesh.geometry.attributes.position, ix = mesh.geometry.index
          let sum = 0
          for (let i = 0; i < ix.count; i += 3) {
            const [a,b,c] = [ix.getX(i),ix.getX(i+1),ix.getX(i+2)]
            sum += Math.abs((p.getY(b)-p.getY(a))*(p.getZ(c)-p.getZ(a)) - (p.getZ(b)-p.getZ(a))*(p.getY(c)-p.getY(a))) / 2
          }
          return sum
        }
        const ratio = projectedArea(window) / ((box.max.y-box.min.y)*(box.max.z-box.min.z))
        assert.ok(ratio > 0.55 && ratio < 0.95, 'side glazing has a full trapezoid silhouette rather than a triangle')
        const p = window.geometry.attributes.position
        const a = new THREE.Vector2(p.getY(48*13),p.getZ(48*13))
        const b = new THREE.Vector2(p.getY(48*13+12),p.getZ(48*13+12))
        assert.ok(a.distanceTo(b) > 0.16,'trapezoid keeps a visible short top edge')
        assert.ok(Math.abs(p.getX(48*13)-p.getX(48*13+12))<0.002,'rear pane edge is cut across the cab instead of trailing into a spike')
        assert.ok(Math.abs(p.getZ(48*13)-p.getZ(48*13+12))>0.12,'rear pane edge has a finite height in side view')
      }
      assert.equal(cab.children.filter(o => o.name.startsWith('d-crew-door')).length, 0, 'no extra cab door beyond the passenger door run')
      cab.updateWorldMatrix(true, true)
      assert.ok(cab.getObjectByName('d-windscreen-upper-brow'))
      assert.ok(cab.getObjectByName('d-cab-upper-display'))
      const markers = cab.children.filter(o => o.name === 'd-upper-marker-light')
      assert.equal(markers.length,2,'two marker lamps above the windscreen')
      for (const marker of markers) {
        const centre = new THREE.Vector3().fromBufferAttribute(marker.geometry.attributes.position,0)
        const origin = cab.localToWorld(new THREE.Vector3(5,centre.y,centre.z))
        const direction = new THREE.Vector3(-1,0,0).transformDirection(cab.matrixWorld)
        assert.equal(new THREE.Raycaster(origin,direction).intersectObject(cab,true)[0]?.object,marker,'upper lamps remain visible over the brow')
      }
      const lamps = cab.children.filter(o => o.name === 'd-headlight' || o.name === 'd-taillight')
      assert.equal(lamps.length, 2)
      for (const side of [-1,1]) {
        const panels = ['d-cab-accent-band', lamps[0].name, 'd-cab-side-window'].map(name =>
          cab.children.find(o => o.name === name && Math.sign(o.geometry.attributes.position.getY(24*13+6)) === side))
        const point = (mesh,row,col) => new THREE.Vector2().fromArray([
          mesh.geometry.attributes.position.getY(row*13+col),mesh.geometry.attributes.position.getZ(row*13+col)])
        for (let i=1;i<panels.length;i++) for (const col of [0,12]) {
          const end = point(panels[i-1],48,col),start = point(panels[i],0,col)
          const before = end.clone().sub(point(panels[i-1],47,col)).normalize()
          const after = point(panels[i],1,col).sub(start).normalize()
          const gap = start.clone().sub(end)
          assert.ok(gap.length()>0.01 && gap.length()<0.10,'panel sections retain small gaps')
          assert.ok(before.dot(after)>0.99,'both boundary lines continue smoothly across each gap')
          assert.ok(gap.normalize().dot(before)>0.99 && gap.dot(after)>0.99,'window, light and accent share both boundary curves')
        }
      }
      for (const lamp of lamps) {
        lamp.geometry.computeBoundingBox()
        const box = lamp.geometry.boundingBox
        assert.ok(box.max.z - box.min.z > 0.3 && box.max.y - box.min.y > 0.25, 'lamp is a steep diagonal wedge rather than a horizontal bar')
        const p = lamp.geometry.attributes.position
        const end = (row) => Math.hypot(p.getY(row*13)-p.getY(row*13+12),p.getZ(row*13)-p.getZ(row*13+12))
        assert.ok(end(0)>0.10 && end(48)>0.20,'lamp retains two finite end edges instead of oval caps')
        const sample = new THREE.Vector3().fromBufferAttribute(p, 24 * 13 + 6)
        const origin = cab.localToWorld(new THREE.Vector3(5, sample.y, sample.z))
        const direction = new THREE.Vector3(-1, 0, 0).transformDirection(cab.matrixWorld)
        const hit = new THREE.Raycaster(origin, direction).intersectObject(cab, true)[0]
        assert.equal(hit?.object, lamp, 'both corner lamps are exposed in the direct front view')
      }
      const maskOutline=cab.getObjectByName('d-cab-mask').geometry.attributes.position
      const edgePoints=Array.from({length:128},(_,i)=>new THREE.Vector2(maskOutline.getX(48*129+i),maskOutline.getY(48*129+i)))
      const outlineBounds=new THREE.Box2().setFromPoints(edgePoints)
      const centre=outlineBounds.getCenter(new THREE.Vector2()),radii=outlineBounds.getSize(new THREE.Vector2()).multiplyScalar(0.5)
      for (const panel of cab.children.filter(o=>['d-cab-side-window','d-side-window-seal',lamps[0].name,'d-cab-lamp-housing','d-cab-accent-band'].includes(o.name))) {
        const p=panel.geometry.attributes.position
        for (let i=0;i<p.count;i++) {
          const radius=Math.hypot((p.getX(i)-centre.x)/radii.x,(p.getY(i)-centre.y)/radii.y)
          assert.ok(radius>0.99999,`${panel.name} is trimmed out of the black surround`)
          if (i%13===0) assert.ok(Math.abs(radius-1)<0.00002,'all inner panel edges follow the black boundary')
        }
      }
      for (const panel of [...lamps,...cab.children.filter(o=>o.name==='d-cab-side-window')]) {
        const p = panel.geometry.attributes.position
        const index = 24*13
        const glazing = glass.geometry.attributes.position
        let gap = Infinity
        for (let i=0;i<glazing.count;i++) gap = Math.min(gap,Math.hypot(p.getY(index)-glazing.getY(i),p.getZ(index)-glazing.getZ(i)))
        assert.ok(gap>0.02 && gap<0.22,`side panels closely hug the windshield without overlap (${gap})`)
      }
      for (const ribbon of cab.children.filter(o => ['d-headlight','d-taillight','d-cab-accent-band'].includes(o.name))) {
        const p = ribbon.geometry.attributes.position
        const a = new THREE.Vector2(),b = new THREE.Vector2(),c = new THREE.Vector2()
        for (let row = 2; row < 47; row++) {
          const index = row * 13 + 6
          a.set(p.getY(index-13),p.getZ(index-13))
          b.set(p.getY(index),p.getZ(index))
          c.set(p.getY(index+13),p.getZ(index+13))
          const previous = b.clone().sub(a).normalize(),next = c.sub(b).normalize()
          assert.ok(previous.dot(next) > 0.995,'band and lamp tangents stay smooth along the shared arc')
        }
      }
      for (const name of ['d-cab-windscreen','d-cab-side-window',lamps[0].name,'d-cab-accent-band']) {
        for (const panel of cab.children.filter(o=>o.name===name)) {
          const p=panel.geometry.attributes.position,n=panel.geometry.attributes.normal
          const index=name==='d-cab-windscreen'?16*37+18:24*13+6
          const origin=cab.localToWorld(new THREE.Vector3().fromBufferAttribute(p,index))
          const direction=new THREE.Vector3().fromBufferAttribute(n,index).negate().transformDirection(cab.matrixWorld)
          const hit=new THREE.Raycaster(origin,direction).intersectObject(shell)[0]
          assert.ok(hit && hit.distance<0.025,`${name} sits against the rendered skin rather than floating (${hit?.distance})`)
        }
      }
      for (const z of [0.55,2.9,3.21]) {
        const edges=[]
        for (const offset of [-0.001,0.001]) {
          const origin=cab.localToWorld(new THREE.Vector3(-STOCK.D.cabLength+offset,5,z))
          const direction=new THREE.Vector3(0,-1,0).transformDirection(cab.matrixWorld)
          const hit=new THREE.Raycaster(origin,direction).intersectObject(root,true)[0]
          assert.ok(hit,'both sides of the cab/car seam are enclosed')
          edges.push(cab.worldToLocal(hit.point).y)
        }
        assert.ok(Math.abs(edges[0]-edges[1])<0.002,`cab and car shoulder edges coincide at height ${z}`)
        if (z===3.21) assert.ok(edges[1]<1.10,'rounded roof shoulders retreat inward instead of retaining the square crown')
        if (z===0.55) assert.ok(edges[1]<1.35,'rounded lower car corners follow the head silhouette')
      }
      // Compare the actual rear loft vertices to the adjoining car shoulder,
      // rather than just checking the cab's overall bounding box.
      const p = shell.geometry.attributes.position
      const n = shell.geometry.attributes.normal
      assert.ok(Math.abs(p.getZ(16*129+48)-2.4137683)<0.001,'original long nose crown is preserved at the quarter-length landmark')
      assert.ok(p.getZ(32*129)<0.55,'lower side skirt stays down near the car sill')
      const back = []
      for (let i = 0; i < p.count; i++) {
        if (Math.abs(p.getX(i) + STOCK.D.cabLength) < 1e-5) back.push([p.getY(i), p.getZ(i)])
        if (Math.abs(p.getX(i)) < 1e-6) {
          assert.ok(n.getX(i) > 0.99, 'rounded pole normals meet smoothly without triangular shading seams')
          assert.ok(p.getZ(i) > 0.7 && p.getZ(i) < 0.85, 'nose tip is low rather than a raised bulb')
        }
      }
      assert.ok(Math.abs(Math.max(...back.map(v => v[1])) - 3.25) < 1e-5)
      const trim = cab.getObjectByName('d-cab-gold-trim').geometry.attributes.position
      assert.ok(Math.min(...Array.from({length:129},(_,i)=>trim.getZ(48*129+i))) + 0.45 < trim.getZ(48*129+64), 'trim curves from the lower nose back over the crown')
      for (const name of ['d-cab-livery','d-cab-gold-trim','d-cab-mask']) {
        const p = cab.getObjectByName(name).geometry.attributes.position
        const outline = Array.from({length:128},(_,i)=>new THREE.Vector2(p.getX(48*129+i),p.getY(48*129+i)))
        const bounds = new THREE.Box2().setFromPoints(outline),centre = bounds.getCenter(new THREE.Vector2())
        const size = bounds.getSize(new THREE.Vector2())
        assert.ok(size.x / size.y > 1.4,'surround remains elongated along the original nose')
        const radii = outline.map(v=>Math.hypot((v.x-centre.x)/(size.x/2),(v.y-centre.y)/(size.y/2)))
        assert.ok(Math.max(...radii)-Math.min(...radii)<0.002,'surround closes into an ellipse in plan without squared rear corners')
      }
      assert.equal(cab.getObjectByName('d-cab-rear-livery'),undefined,'no broad rectangular rear colour patch')
      const carShoulder = parts.find(o => o.name === 'd-car-shoulder')
      carShoulder.geometry.computeBoundingBox()
      assert.ok(Math.abs(carShoulder.geometry.boundingBox.max.z - Math.max(...back.map(v => v[1]))) < 1e-5, 'cab and carriage crowns meet at the same height')
      for (const y of [-0.50, 0.50]) assert.ok(back.some(v => Math.abs(v[0] - y) < 1e-5 && Math.abs(v[1] - 3.25) < 1e-5), 'narrow crown and rounded shoulders share the car section')
    }
    assert.ok(cabs[0].getObjectByName('d-headlight'))
    assert.ok(cabs[1].getObjectByName('d-taillight'))
    const roof=parts.find(o=>o.name==='d-car-roof')
    roof.geometry.computeBoundingBox()
    assert.ok(roof.geometry.boundingBox.max.y-roof.geometry.boundingBox.min.y<1.1,'flat roof strip is narrow between the broad curved shoulders')
    assert.ok(root.getObjectByName('d-transverse-seat'))
    assert.ok(root.getObjectByName('cabin-bench'))
    const gangways = parts.filter(o => o.name === 'd-intercar-gangway')
    assert.equal(gangways.length, 7)
    root.updateMatrixWorld(true)
    for (let c = 1; c < 8; c++) {
      const x = c * STOCK.D.length - total / 2
      const sideRay = new THREE.Raycaster(new THREE.Vector3(x, -5, 2), new THREE.Vector3(0, 1, 0))
      const topRay = new THREE.Raycaster(new THREE.Vector3(x, 0, 5), new THREE.Vector3(0, 0, -1))
      assert.ok(sideRay.intersectObjects(gangways).length, 'bellows close the view through each car gap')
      assert.ok(topRay.intersectObjects(gangways).length, 'gangway also encloses the roof gap')
    }
    const corners=parts.filter(o=>o.name==='d-door-upper-corner-infill')
    assert.equal(corners.length,doorCentres({stock:'D',cars:8}).length*4,'stationary upper corners cover both jambs on both sides')
    for (const x of doorCentres({stock:'D',cars:8}).slice(0,2)) for (const side of [-1,1]) for (const jamb of [-1,1]) {
      const width=doorWidthAt({stock:'D',cars:8},x)
      const ray=new THREE.Raycaster(new THREE.Vector3(x+jamb*(width/2-0.025),side*5,2.61),new THREE.Vector3(0,-side,0))
      assert.ok(ray.intersectObjects(corners).length,'no uncovered top corner beside single or paired doors')
    }
    for (const cab of cabs) {
      assert.equal(cab.children.filter(o=>o.name==='d-cab-side-black-taper').length,2)
      for (const [cabName,carName,columns] of [
        ['d-cab-side-black-taper','d-car-window-surround',24],
        ['d-cab-side-livery-sweep','d-car-livery',8],
        ['d-cab-side-gold-sweep','d-car-gold-line',8],
      ]) for (const part of cab.children.filter(o=>o.name===cabName)) for (const index of [0,columns]) {
        const endpoint=part.localToWorld(new THREE.Vector3().fromBufferAttribute(part.geometry.attributes.position,index))
        let gap=Infinity
        for (const car of parts.filter(o=>o.name===carName)) {
          const p=car.geometry.attributes.position
          for (let i=0;i<p.count;i++) {
            const point=car.localToWorld(new THREE.Vector3().fromBufferAttribute(p,i))
            gap=Math.min(gap,point.distanceTo(endpoint))
          }
        }
        assert.ok(gap<0.00001,`${cabName} meets the carriage band without a step (${gap})`)
      }
      const colour=cab.getObjectByName('d-cab-livery')
      colour.geometry.computeBoundingBox()
      assert.ok(colour.geometry.boundingBox.min.x<-4.5,'upper colour extends back to the car joint')
      for (const name of ['d-cab-side-livery-sweep','d-cab-side-gold-sweep']) for (const part of cab.children.filter(o=>o.name===name)) {
        part.geometry.computeBoundingBox()
        assert.ok(part.geometry.boundingBox.min.z<0.6,'lower bands sweep into the skirt')
      }
    }
    const leaves = root.userData.doors
    assert.equal(leaves.length, doorCentres({stock:'D', cars:8}).length * 4 - 4, 'paired leaves except the two single cab-end doorways per side')
    assert.equal(leaves.filter(o=>o.name==='d-passenger-single-door').length,4,'only the doorway nearest each cab is single on both sides')
    for (const window of parts.filter(o=>o.name==='d-car-window')) {
      window.geometry.computeBoundingBox()
      const box=window.geometry.boundingBox
      assert.ok(box.max.x-box.min.x<0.8 && box.max.z-box.min.z<0.55,'small passenger panes sit within the black band')
    }
    for (const leaf of leaves) {
      assert.ok(['d-passenger-single-door','d-passenger-double-door'].includes(leaf.name))
      const pane = leaf.getObjectByName('train-door-window')
      assert.ok(pane)
      pane.geometry.computeBoundingBox()
      const box = pane.geometry.boundingBox
      assert.ok(box.max.x - box.min.x < 0.30 && box.max.z - box.min.z > 1.1, 'every passenger door uses the tall narrow capsule window')
    }
    setDoorsSides(root, 1, 0)
    for (const leaf of leaves) {
      const side = leaf.userData.side
      assert.ok(Math.abs(leaf.position.y - leaf.userData.closedY - (side > 0 ? 0.09 : 0)) < 1e-8)
      assert.equal(leaf.position.x,leaf.userData.closedX+(side>0?leaf.userData.openSign*leaf.userData.travel:0),'paired leaves slide apart while the opposite bank stays shut')
    }
    setDoorsSides(root, 0, 0)
    for (const leaf of leaves) assert.equal(leaf.position.y, leaf.userData.closedY)
  } finally {
    if (root) { disposeObject(root); root.userData.ownedMats.forEach(m => m.dispose()) }
    if (mats) disposeModelMaterials(mats)
    globalThis.document = previous
  }
})
function surfaces(root) {
  const out = []
  root.traverseVisible(o => { if (o.isMesh && o.layers.isEnabled(0)) out.push(o) })
  return out
}
function matrixClose(a, b) { a.elements.forEach((v, i) => assert.ok(Math.abs(v - b.elements[i]) < 1e-5, `matrix ${i}`)) }

function renderedTriangles(root) {
  let count = 0
  root.traverseVisible(mesh => {
    if (!mesh.isMesh || !mesh.layers.isEnabled(0)) return
    if (mesh.isBatchedMesh) for (let i = 0; i < mesh.instanceCount; i++) count += mesh.getGeometryRangeAt(mesh.getGeometryIdAt(i)).count / 3
    else count += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3 * (mesh.isInstancedMesh ? mesh.count : 1)
  })
  return count
}

test('profiling preserves reviewed passenger pools across legacy and explicit age metadata', () => {
  assert.equal(passengerEligible({ bag: false, hair: 'short' }, 'child'), true)
  assert.equal(passengerEligible({ bag: true, hair: 'short' }, 'child'), false)
  assert.equal(passengerEligible({ bag: false, hair: 'bald' }, 'child'), false)
  assert.equal(passengerEligible({ bag: true, hair: 'bald' }, 'adult'), true)
  assert.equal(passengerEligible({ bag: false, hair: 'short', adultEligible: false }, 'adult'), false)
  assert.equal(passengerEligible({ bag: true, hair: 'short', childEligible: true }, 'child'), true)
})

test('reflection baking retains FrontSide ray hits and winding for mirrored seats', () => {
  const source = new THREE.BoxGeometry(2, 3, 4)
  const transform = new THREE.Matrix4().makeScale(1, -1, 1)
  const geometry = bakedGeometry(source, transform)
  const original = new THREE.Mesh(source, new THREE.MeshBasicMaterial()); original.scale.y = -1
  const batch = new THREE.Mesh(geometry, original.material)
  original.updateMatrixWorld(); batch.updateMatrixWorld()
  const ray = new THREE.Raycaster(new THREE.Vector3(0, -5, 0), new THREE.Vector3(0, 1, 0))
  assert.equal(ray.intersectObject(original)[0].distance, ray.intersectObject(batch)[0].distance, 'outside face remains reachable rather than becoming back-facing')
  assert.equal(geometry.getAttribute('position').count, source.index.count, 'all triangles survive')
  source.dispose(); geometry.dispose(); original.material.dispose()
})

test('real train batches preserve both door banks, moving glass, and train-local transforms', () => {
  const previous = globalThis.document; globalThis.document = { createElement: canvas }
  let mats, root
  try {
    mats = createModelMaterials()
    root = buildTrain(mats, { x: 10, y: 20, z: -15.5, cars: 4, stock: 'B', doorsOpen: false, colour: '#336699', dirSign: 1, yaw: Math.PI / 2 })
    const before = surfaces(root).length
    const leaves = root.userData.doors.slice()
    batchStaticParts(root, new Set(leaves), true)
    batchTrainDoors(root); batchTrainTransparent(root)
    assert.ok(surfaces(root).length < before / 3, 'most repeated train parts no longer submit separate meshes')
    assert.deepEqual(root.userData.doors, leaves, 'door rigs keep their original references')
    assert.ok(root.userData.trainDoorBatches.length >= 2, 'frames and kick plates both instance')
    const glass = root.userData.trainGlassBatches.find(b => b.sources.some(s => s.name === 'train-door-window'))
    assert.ok(glass); assert.equal(glass.mesh.sortObjects, true, 'transparent surfaces keep depth sorting')
    for (const [plus, minus] of [[1, 0], [0, 1], [0.3, 0.8], [0, 0]]) {
      setDoorsSides(root, plus, minus)
      root.updateWorldMatrix(true, true)
      const inverse = root.matrixWorld.clone().invert(), matrix = new THREE.Matrix4()
      for (const batch of root.userData.trainDoorBatches) for (let i = 0; i < batch.sources.length; i++) {
        batch.mesh.getMatrixAt(i, matrix)
        matrixClose(matrix, inverse.clone().multiply(batch.sources[i].matrixWorld))
      }
      for (let i = 0; i < glass.sources.length; i++) {
        glass.mesh.getMatrixAt(i, matrix)
        matrixClose(matrix, inverse.clone().multiply(glass.sources[i].matrixWorld))
      }
      for (const leaf of leaves) assert.equal(leaf.position.x, leaf.userData.closedX + leaf.userData.openSign * leaf.userData.travel * trainDoorMotion(leaf.userData.side >= 0 ? plus : minus).slide)
    }
    let released = 0
    for (const mesh of surfaces(root)) if (mesh.isBatchedMesh || mesh.isInstancedMesh) mesh.addEventListener('dispose', () => released++)
    const expected = surfaces(root).filter(m => m.isBatchedMesh || m.isInstancedMesh).length
    disposeObject(root); root = null
    assert.equal(released, expected, 'instance buffers and batched matrix textures are released with the consist')
  } finally { if (root) disposeObject(root); if (mats) disposeModelMaterials(mats); globalThis.document = previous }
})

test('all stock classes retain geometry and door poses in all track rotations', () => {
  const previous = globalThis.document; globalThis.document = { createElement: canvas }
  let mats
  try {
    mats = createModelMaterials()
    for (const stock of STOCK_CLASSES) for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const root = buildTrain(mats, { x: -50, y: 20, z: -7.5, cars: 2, stock, doorsOpen: false, colour: '#336699', dirSign: -1, yaw })
      try {
        const triangles = renderedTriangles(root), before = new THREE.Box3().setFromObject(root)
        batchStaticParts(root, new Set(root.userData.doors), true); batchTrainDoors(root); batchTrainTransparent(root)
        assert.equal(renderedTriangles(root), triangles, `${stock}/${yaw}: fewer draws must not remove or duplicate triangles`)
        const after = new THREE.Box3().setFromObject(root)
        assert.ok(before.min.distanceTo(after.min) < 1e-5 && before.max.distanceTo(after.max) < 1e-5, 'rounded body/cabs stay in their original world-space envelope')
        for (const [plus, minus] of [[0.25, 0.75], [1, 0], [0, 1]]) {
          setDoorsSides(root, plus, minus); root.updateWorldMatrix(true, true)
          const inverse = root.matrixWorld.clone().invert(), matrix = new THREE.Matrix4()
          for (const batch of [...root.userData.trainDoorBatches, ...root.userData.trainGlassBatches]) for (let i = 0; i < batch.sources.length; i++) {
            batch.mesh.getMatrixAt(i, matrix); matrixClose(matrix, inverse.clone().multiply(batch.sources[i].matrixWorld))
          }
        }
      } finally { disposeObject(root); root.userData.ownedMats.forEach(m => m.dispose()) }
    }
  } finally { if (mats) disposeModelMaterials(mats); globalThis.document = previous }
})

test('actual train system holds paused/hidden door buffers and evicts their GPU resources', () => {
  const previous = globalThis.document; globalThis.document = { createElement: canvas }
  let mats, trains
  try {
    mats = createModelMaterials()
    const ctx = { scene: new THREE.Scene(), modelMats: mats, levelBase: 0, lastStateTime: 1000, stateIntervalMs: 1000 }
    trains = new TrainSystem(ctx); trains.level = { applyGroupLevel(root) { root.visible = true } }
    const pose = new Float32Array([0, 0, -15.5, 2, 1, 1, 0x336699, 1, 0, 1])
    trains.setTrains(pose); const root = trains.trainGroup.children[0]
    trains.updateTrains(2000, 1)
    const attributes = root.userData.trainDoorBatches.map(b => b.mesh.instanceMatrix), versions = attributes.map(a => a.version)
    const poses = attributes.map(a => a.array.slice())
    trains.setPlaying(false); trains.updateTrains(4000, 100)
    assert.deepEqual(attributes.map(a => a.version), versions, 'paused doors make no buffer uploads')
    attributes.forEach((a, i) => assert.deepEqual(a.array, poses[i]))
    root.visible = false; trains.setPlaying(true); trains.updateTrains(5000, 1)
    assert.deepEqual(attributes.map(a => a.version), versions, 'hidden train visuals hold their buffers')
    root.visible = true; trains.updateTrains(6000, 1)
    assert.ok(attributes.some((a, i) => a.version > versions[i]), 'visible doors resume towards the commanded bank')
    let released = 0, expected = 0
    root.traverse(o => { if (o.isInstancedMesh || o.isBatchedMesh) { expected++; o.addEventListener('dispose', () => released++) } })
    for (let i = 0; i < 5; i++) trains.setTrains(new Float32Array())
    assert.equal(root.visible, false)
    trains.setTrains(pose)
    assert.equal(trains.trainGroup.children[0], root, 'the next service reuses the same consist and GPU allocations')
    for (let index = 0; index < 9; index++) {
      // Colours now reuse the owned livery material. Distinct orientations still
      // need separate configurations and must exercise bounded GPU eviction.
      const other = pose.slice(); other[8] = (index + 1) * Math.PI / 10
      trains.setTrains(other)
    }
    assert.equal(trains.trainGroup.children.length, 9, 'one active train plus eight dormant configurations bounds the cache')
    assert.equal(released, expected, 'evicting the least recently used consist releases every instance buffer and batch texture')
    trains.setTrains(pose); trains.setDrawBatching(false)
    assert.equal(trains.trainGroup.children[0].userData.trainDoorBatches, undefined, 'profiling ablation creates the original door rendering')
    trains.setDrawBatching(true); assert.ok(trains.trainGroup.children[0].userData.trainDoorBatches.length)
  } finally { trains?.dispose(); if (mats) disposeModelMaterials(mats); globalThis.document = previous }
})

function equipment(x, id, geometry, material, type = 'bench') {
  const group = new THREE.Group(); group.position.x = x
  group.userData = { moduleId: id, moduleType: type, levelZs: [0] }
  group.add(new THREE.Mesh(geometry, material)); return group
}

test('equipment batch size follows quality and keeps source picking and local allocations', () => {
  const modules = new THREE.Group(), material = new THREE.MeshBasicMaterial()
  for (const [x, id] of [[0, 'a'], [3, 'b'], [32, 'c'], [35, 'd'], [64, 'e'], [67, 'f']]) modules.add(equipment(x, id, new THREE.BoxGeometry(), material))
  const batches = new EquipmentBatches()
  try {
    batches.sync(modules)
    assert.equal(batches.root.children.length, 3, 'High keeps separate 16 m buckets')
    assert.ok(batches.root.children.every(m => m.isInstancedMesh), 'identical models share their vertex buffer')
    const far = batches.root.children.find(m => m.boundingBox.min.x > 60)
    const ray = new THREE.Raycaster(new THREE.Vector3(0, -5, 0), new THREE.Vector3(0, 1, 0)); ray.layers.enable(BATCH_SOURCE_LAYER)
    assert.equal(ray.intersectObjects(modules.children, true)[0].object.parent.userData.moduleId, 'a', 'picking still resolves the source module')
    modules.children[0].position.x = 1
    batches.sync(modules)
    assert.ok(batches.root.children.includes(far), 'editing a near bucket preserves the far allocation')
    modules.children[4].visible = modules.children[5].visible = false
    batches.sync(modules)
    assert.equal(batches.root.children.length, 2, 'hidden equipment submits no batch')
    modules.children[4].visible = modules.children[5].visible = true
    batches.sync(modules); assert.equal(batches.root.children.length, 3, 'showing a storey restores its equipment')
    batches.graphicsQuality = 'low'; batches.sync(modules)
    assert.equal(batches.root.children.length, 2, 'Low joins adjacent 16 m regions inside a 64 m bucket')
    batches.graphicsQuality = 'high'; batches.sync(modules)
    assert.equal(batches.root.children.length, 3, 'returning to High restores finer buckets')
  } finally { batches.clear(); modules.traverse(o => { if (o.isMesh) o.geometry.dispose() }); material.dispose() }
})

test('equipment merge retains mirrored geometry, material boundaries and preview visibility', () => {
  const modules = new THREE.Group(), material = new THREE.MeshBasicMaterial(), batches = new EquipmentBatches()
  modules.add(equipment(0, 'a', new THREE.BoxGeometry(), material, 'fence'))
  modules.add(equipment(2, 'b', new THREE.BoxGeometry(2, 1, 1), material, 'fence'))
  modules.children[1].scale.y = -1
  try {
    batches.sync(modules)
    assert.equal(batches.root.children.length, 1)
    assert.equal(batches.root.children[0].geometry.getAttribute('position').count, 72, '24 box triangles retain their transformed winding')
    modules.children.forEach(g => g.visible = false); batches.sync(modules)
    assert.equal(batches.root.children.length, 0, 'committed fences disappear while the drag preview owns their drawing')
    modules.children.forEach(g => g.visible = true); batches.sync(modules)
    material.transparent = true; material.opacity = 0.35; batches.sync(modules)
    assert.equal(batches.root.children[0].isBatchedMesh, true, 'ghosted equipment keeps per-surface sorting')
  } finally { batches.clear(); modules.traverse(o => { if (o.isMesh) o.geometry.dispose() }); material.dispose() }
})

test('panel atlas retains full resolution, correct UV orientation and live screen repaints', () => {
  const previous = globalThis.document; globalThis.document = { createElement: canvas }
  const atlas = new PanelAtlas(128), a = canvas(), b = canvas()
  a.width = b.width = 32; a.height = b.height = 16
  const textures = [a, b].map(c => new THREE.CanvasTexture(c))
  const materials = textures.map(map => new THREE.MeshBasicMaterial({ map }))
  try {
    const regions = materials.map(m => atlas.resolve(m))
    assert.equal(regions[0].material, regions[1].material, 'different label textures can share one material')
    assert.equal(regions[0].w * 128, 32, 'label resolution stays 32 pixels wide')
    const geometry = new THREE.PlaneGeometry(); atlasUV(geometry, regions[0])
    const uv = geometry.getAttribute('uv')
    assert.equal(uv.getY(0), regions[0].v + regions[0].h, 'top of the label stays at the top of the atlas slot')
    const page = regions[0].material.map
    const initialVersion = page.version
    atlas.update(); assert.equal(page.version, initialVersion, 'unchanged screens do not re-upload')
    textures[0].needsUpdate = true; atlas.update()
    assert.equal(page.version, initialVersion + 1, 'a countdown repaint reaches the page')
    assert.equal(atlas.resolve(materials[0]).u, regions[0].u, 'repaint does not move a panel UV region')
    atlas.retain(new Set([textures[1]]))
    const version = page.version; textures[0].needsUpdate = true; atlas.update()
    assert.equal(page.version, version, 'deleted screens stop causing atlas uploads')
    const replacement = new THREE.CanvasTexture(a), replacementMaterial = new THREE.MeshBasicMaterial({ map: replacement })
    assert.equal(atlas.resolve(replacementMaterial).u, regions[0].u, 'deleted panel slots recycle instead of growing pages across undo/rebuilds')
    replacement.dispose(); replacementMaterial.dispose()
    geometry.dispose()
  } finally { atlas.dispose(); textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose()); globalThis.document = previous }
})

test('equipment batching leaves door, wing, clock and cabin descendants live', () => {
  const modules = new THREE.Group(), material = new THREE.MeshBasicMaterial(), batches = new EquipmentBatches()
  const root = equipment(0, 'gate', new THREE.BoxGeometry(), material, 'gate')
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), material))
  const wing = new THREE.Group(), moving = new THREE.Mesh(new THREE.BoxGeometry(), material)
  wing.add(moving); root.add(wing); root.userData.wing = wing
  const hand = new THREE.Group(), arm = new THREE.Mesh(new THREE.BoxGeometry(), material)
  hand.add(arm); root.add(hand); root.userData.clockRig = { hour: [hand], minute: [] }
  modules.add(root)
  try {
    batches.sync(modules)
    assert.equal(batches.root.children.length, 1, 'static cabinet parts can share a draw')
    assert.equal(moving.layers.mask, 1); assert.equal(arm.layers.mask, 1, 'animated descendants keep their own draw')
    wing.scale.x = 0.1; hand.rotation.y = 1
    assert.equal(moving.parent, wing); assert.equal(arm.parent, hand, 'the actual pivots still own the visible surfaces')
  } finally { batches.clear(); modules.traverse(o => { if (o.isMesh) o.geometry.dispose() }); material.dispose() }
})
