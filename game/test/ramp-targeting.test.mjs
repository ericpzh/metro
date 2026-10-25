import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { cameraRig } from './support/camera-rig.mjs'
import { createModule, toState } from '../src/build/model.ts'
import { buildModule, disposeObject } from '../src/render/models.ts'
import { moduleAt, moduleEnvelope } from '../src/sim/placement.ts'
import { moduleTarget } from '../src/app/tools/moduleTarget.ts'
import { DeleteTool } from '../src/app/tools/DeleteTool.ts'
import { SelectTool } from '../src/app/tools/SelectTool.ts'
import { PickTool } from '../src/app/tools/PickTool.ts'
import { useStore } from '../src/app/store.ts'

const stairs = ['stair-straight', 'stair-leftForward', 'stair-rightForward', 'stair-left90', 'stair-right90', 'stair-left180', 'stair-right180']
const cases = [...stairs.flatMap(type => [0.68, 1.36, 2.04].map(width => [type, width])), ['escalator', 1], ['escalator', 2], ['escalator', 3]]
test('a visible block beside platform glazing does not resurrect a screen door through its coarse envelope',()=>{
  const screen={id:'screen',type:'platform-edge',x:219,y:-92,z:-20,w:173,rot:2,cfg:{from:'track',side:'right',psd:'full',line:'13'}}
  const cell=[60,-92,-19]
  assert.ok(moduleAt([screen],...cell),'the screen clearance reaches the pointed block')
  assert.equal(moduleTarget([screen],null,cell),undefined)
  assert.equal(moduleTarget([screen],screen.id,cell),screen,'an actual drawn glazing surface remains selectable')
})
for (const [type, width] of cases) {
  for (const rot of [0, 1, 2, 3]) test(`${type} width ${width} rotation ${rot}: a visible block occludes the run for hover, delete and undo`, () => {
    const previous = useStore.getState()
    const source = createModule(type, 0, 0, 0, 'run', rot, width, 'up', 'lane', [], undefined, { storeyHeight: 5 })
    const material = new THREE.MeshStandardMaterial()
    const data = { name: 'ramp target', seed: 1, cells: [], modules: [source], lines: [], storeyHeight: 5 }
    const root = buildModule(source, { mats: new Proxy({}, { get: () => material }), finish: () => material, data, storeyHeight: 5 })
    root.userData = { ...root.userData, moduleId: source.id, moduleType: source.type }
    const modules = new THREE.Group(); modules.add(root); modules.updateMatrixWorld(true)
    const block = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
    const { cam } = cameraRig(); cam.modules = { moduleMeshes: modules }; cam.setPickables([block])
    try {
      const envelope = moduleEnvelope(source)
      let target
      // Find a real visible tread/landing and put a block in front of it, while
      // the run's coarse storey envelope still covers the block's air column.
      search: for (let z = 0; z < Math.ceil(envelope.z1); z++) {
        for (let x = Math.floor(envelope.x0); x < Math.ceil(envelope.x1); x++) for (let y = Math.floor(envelope.y0); y < Math.ceil(envelope.y1); y++) {
          if (!moduleAt([source], x, y, z)) continue
          cam.camera.position.set(x + 0.5, y + 0.501, z + 20)
          cam.camera.lookAt(x + 0.5, y + 0.5, z + 0.5); cam.camera.updateMatrixWorld(true)
          block.visible = false
          if (!cam.pickModuleHit(640, 410)) continue
          block.position.set(x + 0.5, y + 0.5, z + 0.5); block.visible = true; block.updateMatrixWorld(true)
          const picked = cam.withPointerPick(() => ({ hit: cam.pick(640, 410, 0), module: cam.pickModuleHit(640, 410) }))
          if (!picked.module && picked.hit?.solid && picked.hit.cell.join(',') === [x, y, z].join(',')) {
            target = picked.hit; break search
          }
        }
      }
      assert.ok(target, 'fixture must hit a block in front of actual run geometry inside its storey envelope')
      assert.equal(cam.pickModuleInBounds(640, 410, new Set([source.id])), null, 'forgiving exit snapping respects the same visible block occlusion')
      assert.equal(moduleTarget([source], null, target.cell), undefined, 'occlusion survives cell fallback')
      assert.equal(moduleTarget([source], source.id, target.cell), source, 'an actual drawn run is still selectable')
      data.cells = [0, 1, 2, 3].map(x => ({ x: x + 30, y: 30, z: 0, fill: 'solid' }))
      data.cells.push({ x: target.cell[0], y: target.cell[1], z: target.cell[2], fill: 'solid' })
      useStore.setState({ station: toState(data), tool: 'delete', past: [], future: [], moveDraft: null, selected: null })
      let preview
      const scene = {
        pickModuleHit: (x, y) => cam.pickModuleHit(x, y), isModuleVisible: () => true,
        pickAgent: () => null,
        setGhost() {}, setModulePreview: m => { preview = m }, setFencePreview() {}, setCollisionHighlight() {}, setCursor() {},
      }
      const drag = { current: null }
      const context = { scene: () => scene, drag, facing: () => undefined, pickModule: (x, y) => cam.pickModule(x, y), thins: () => new Map(), solids: () => new Set(data.cells.map(c => `${c.x},${c.y},${c.z}`)), showMeasure() {}, clearMeasure() {} }
      const tool = new DeleteTool(context)
      const event = { clientX: 640, clientY: 410, button: 0, buttons: 1, shiftKey: false, hit: target, preventDefault() {} }
      cam.withPointerPick(() => { tool.onMove(event); tool.onDown(event) })
      assert.equal(preview, null, 'hover highlights the block rather than the run')
      assert.equal(drag.current.modules, undefined)
      tool.onUp(event)
      const state = useStore.getState()
      assert.ok(state.station.modules.some(m => m.id === source.id), 'the stair/escalator survives block deletion')
      assert.equal(state.station.cells.some(c => c.fill === 'solid' && [c.x, c.y, c.z].join(',') === target.cell.join(',')), false)
      assert.equal(state.past.length, 1)
      state.undo()
      assert.ok(useStore.getState().station.cells.some(c => c.fill === 'solid' && [c.x, c.y, c.z].join(',') === target.cell.join(',')))
      cam.withPointerPick(() => new SelectTool(context).onDown(event))
      assert.equal(useStore.getState().selected?.kind, 'cell', 'inspection does not resurrect an occluded run')
      cam.withPointerPick(() => new PickTool(context).onDown(event))
      assert.equal(useStore.getState().selected?.kind, 'cell', 'copying the block takes its finish rather than the neighbouring run')
      block.visible = false
      const direct = cam.pickModuleHit(640, 410)
      assert.equal(direct?.moduleId, source.id, 'removing the occluder exposes the original run surface')
      cam.withPointerPick(() => tool.onDown({ ...event, hit: cam.pick(640, 410, 0) }))
      assert.deepEqual(drag.current.modules, [source.id], 'a direct run hit still begins whole-run deletion')
      tool.onUp(event)
      assert.equal(useStore.getState().station.modules.some(m => m.id === source.id), false)
    } finally { useStore.setState(previous); cam.dispose(); disposeObject(root); block.geometry.dispose(); material.dispose() }
  })
}
