import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { ROAD_VEHICLE_VARIANTS, roadVehicleParts, roadVehicleVariant } from '../src/render/models/pieces/RoadVehicleModel.ts'
import { INK } from '../src/render/models/pieces/vehicles/VehicleKit.ts'
import { PASSENGER_OPACITY, PASSENGER_LOW_OPACITY } from '../src/sim/constants.ts'
import { RoadTrafficSystem } from '../src/render/scene/systems/RoadTrafficSystem.ts'

function model(variant, detail = 'high') {
  const group = new THREE.Group(), parts = roadVehicleParts(variant, detail)
  for (const part of parts) group.add(new THREE.Mesh(part.geometry, part.material))
  group.updateMatrixWorld(true)
  return { group, parts, bounds: new THREE.Box3().setFromObject(group), dispose() { for (const p of parts) { p.geometry.dispose(); p.material.dispose() } } }
}
const ray = (group, origin, direction) => new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction)).intersectObject(group, true)

test('six vehicle variants have finite outward geometry, grounded tires and bounded instanced material bins', () => {
  for (const variant of ROAD_VEHICLE_VARIANTS) {
    const high = model(variant), low = model(variant, 'low')
    try {
      for(const [detail,m] of [['high',high],['low',low]]) {
        assert.ok(m.parts.length <= 8)
        assert.ok(Math.abs(m.bounds.min.z) < .001, `${variant} ${detail}: tires contact the road`)
        assert.ok(m.bounds.max.x - m.bounds.min.x < (variant.startsWith('bus') ? 3 : variant === 'suv' || variant === 'sedan' ? 2.3 : 1))
        const maxLength = variant.startsWith('bus') ? 10.2 : variant === 'suv' || variant === 'sedan' ? 4.3 : 1.95
        assert.ok(m.bounds.max.y - m.bounds.min.y < maxLength, `${variant} ${detail}: queue footprint`)
        let triangles = 0
        for (const {geometry, material} of m.parts) {
          triangles += geometry.index.count / 3
          assert.ok([...geometry.attributes.position.array, ...geometry.attributes.normal.array].every(Number.isFinite))
          assert.equal(material.opacity, detail === 'low' ? PASSENGER_LOW_OPACITY : PASSENGER_OPACITY); assert.equal(material.depthWrite, false)
          assert.equal(material.side, THREE.FrontSide)
          assert.equal(material.color.r, material.color.g); assert.equal(material.color.g, material.color.b)
        }
        assert.ok(triangles < 16000, `${variant} ${detail}: bounded repeated road geometry (${triangles})`)
        assert.ok(ray(m.group, [0, 8, variant.startsWith('bus') ? 2 : 1.1], [0,-1,0]).length, `${variant} ${detail}: front faces are outward`)
      }
      const count = m => m.parts.reduce((n,{geometry})=>n+geometry.index.count/3,0)
      assert.ok(count(low) <= count(high) * .25, `${variant}: Low stays within 25% of High (${count(low)}/${count(high)})`)
      assert.equal(count(high), { suv:2568, sedan:2492, 'bus-orange':5612, 'bus-mosaic':5753, moped:3560, bicycle:4080 }[variant], 'High geometry is unchanged')
      for (const axis of ['x','y','z']) {
        assert.ok(Math.abs(high.bounds.min[axis]-low.bounds.min[axis]) < .08, `${variant}: Low retains minimum ${axis}`)
        assert.ok(Math.abs(high.bounds.max[axis]-low.bounds.max[axis]) < .08, `${variant}: Low retains maximum ${axis}`)
      }
    } finally { high.dispose(); low.dispose() }
  }
})

test('car variants retain exposed wheels, sloping front glazing and distinct SUV/fastback rooflines', () => {
  for (const detail of ['high','low']) {
  const suv = model('suv', detail), sedan = model('sedan', detail)
  try {
    assert.ok(suv.bounds.max.z - sedan.bounds.max.z > .2)
    for (const [m,r] of [[suv,.35],[sedan,.32]]) {
      for (const s of [-1,1]) {
        const hit = ray(m.group, [s * 2,1.3,r], [-s,0,0])[0]
        assert.equal(hit.object.material.color.getHex(), INK.metal, 'wheel hubs remain visible through the arch')
      }
      assert.equal(ray(m.group, [0,3,1.25], [0,-1,0])[0].object.material.color.getHex(), INK.glass)
      assert.equal(ray(m.group, [.4,3,.52], [0,-1,0])[0].object.material.color.getHex(), INK.glass,'lower grille stands in front of the nose shell')
      assert.equal(ray(m.group, [.5,-3,.79], [0,1,0])[0].object.material.color.getHex(), INK.tail,'rear lamps are outside the tail shell')
    }
  } finally { suv.dispose(); sedan.dispose() }
  }
})

test('buses keep front LED/lamps exposed and doors only on the curb side', () => {
  for (const detail of ['high','low']) for (const variant of ['bus-orange','bus-mosaic']) {
    const m=model(variant, detail)
    try {
      assert.equal(ray(m.group, [-.18,6,2.54], [0,-1,0])[0].object.material.color.getHex(), INK.lamp)
      assert.equal(ray(m.group, [.7,6,.88], [0,-1,0])[0].object.material.color.getHex(), INK.lamp)
      for(const y of [.1,3.79]) {
        assert.equal(ray(m.group, [2,y+.27,1.1], [-1,0,0])[0].object.material.color.getHex(), INK.glass)
        assert.notEqual(ray(m.group, [-2,y+.27,1.1], [1,0,0])[0].object.material.color.getHex(), INK.glass)
      }
      for(const s of [-1,1]) assert.equal(ray(m.group, [s*2,3.04,.82], [-s,0,0])[0].object.material.color.getHex(),INK.rubber,'upper tire is exposed inside the wheel arch')
      for(const s of [-1,1]) assert.equal(ray(m.group, [s*2,-2.74,.82], [-s,0,0])[0].object.material.color.getHex(),variant === 'bus-mosaic' ? INK.accent : INK.pale,'arch trim faces outward on both sides')
    } finally {m.dispose()}
  }
})

test('bicycle has open spoke wheels and a basket; moped has a leg shield and rear top box', () => {
  for (const detail of ['high','low']) {
  const bike=model('bicycle', detail), moped=model('moped', detail)
  try {
    assert.equal(ray(bike.group, [1,.78,.4], [-1,0,0]).length,0,'space between bicycle spokes stays open')
    assert.ok(ray(moped.group, [1,.76,.24], [-1,0,0]).length,'moped retains a solid tire')
    assert.ok(ray(bike.group, [1,.92,1.13], [-1,0,0]).length,'basket front upper wire')
    assert.ok(ray(moped.group, [1,-.77,1.04], [-1,0,0]).length,'rear top box')
    assert.equal(ray(bike.group, [1,-.77,1.04], [-1,0,0]).length,0,'bicycle has no luggage box')
  } finally { bike.dispose(); moped.dispose() }
  }
})

test('seeded appearance includes both variants per traffic family, and actual instance packing renders all six', () => {
  for (const kind of ['car','bus','scooter']) {
    const selected = Array.from({length:100},(_,id)=>roadVehicleVariant(kind,id,42))
    assert.equal(new Set(selected).size,2)
    assert.deepEqual(selected,Array.from({length:100},(_,id)=>roadVehicleVariant(kind,id,42)))
  }
  assert.equal(roadVehicleVariant('bike',1,42),'bicycle')
  const road={id:'street',type:'road',x:0,y:0,z:0,rot:0,w:24,d:1000,cfg:{direction:'two-way'}}
  const ctx={scene:new THREE.Scene(),stationData:{modules:[road],seed:42},lastStateTime:0,stateIntervalMs:1000,activeZ:0,ghost:false,hideGround:false,cutaway:false}
  const roots=new THREE.Group(),root=new THREE.Group();root.userData.moduleId=road.id;roots.add(root)
  const system=new RoadTrafficSystem(ctx)
  try {
    system.setSimTime(100);system.update(1000,roots)
    const meshes=ctx.scene.children[0].children
    for(const variant of ROAD_VEHICLE_VARIANTS) for(const detail of ['high','low']) {
      const bins=meshes.filter(m=>m.userData.vehicleVariant===variant&&m.userData.vehicleDetail===detail),depth=bins.filter(m=>!m.material.colorWrite)
      assert.equal(depth.length,1,'one depth prepass per variant')
      assert.equal(depth[0].material.transparent,true,'depth prepass follows the opaque street, preserving the colour beneath transparent paint')
      assert.equal(depth[0].material.depthWrite,true)
      assert.ok(depth[0].renderOrder < Math.min(...bins.filter(m=>m.material.colorWrite).map(m=>m.renderOrder)))
      assert.equal(depth[0].geometry.index.count,bins.filter(m=>m.material.colorWrite).reduce((n,m)=>n+m.geometry.index.count,0),'depth pass contains the exact visible surfaces')
      assert.ok(bins.filter(m=>m.material.colorWrite).every(m=>m.material.opacity===(detail==='low' ? .45 : .7)), 'each prepared quality owns its opacity')
    }
    assert.deepEqual(new Set(meshes.filter(m=>m.count>0).map(m=>m.userData.vehicleVariant)),new Set(ROAD_VEHICLE_VARIANTS))
    const counts=new Map()
    for(const mesh of meshes) {
      const v=`${mesh.userData.vehicleVariant}:${mesh.userData.vehicleDetail}`
      if(counts.has(v)) assert.equal(mesh.count,counts.get(v),'all material bins pack the same variant/detail instances')
      counts.set(v,mesh.count)
    }
    const allocations=meshes.map(m=>m.instanceMatrix), versions=allocations.map(a=>a.version)
    system.update(2000,roots)
    assert.deepEqual(meshes.map(m=>m.instanceMatrix),allocations)
    assert.deepEqual(allocations.map(a=>a.version),versions,'paused variants do not upload buffers')
    const highMeshes=meshes.filter(m=>m.userData.vehicleDetail==='high'),lowMeshes=meshes.filter(m=>m.userData.vehicleDetail==='low')
    ctx.graphicsQuality='low';system.update(2000,roots)
    assert.ok(highMeshes.every(m=>m.count===0&&!m.visible),'Low quality hides and empties the High draws')
    assert.ok(lowMeshes.some(m=>m.count>0&&m.visible),'Low quality packs traffic into reduced geometry')
    const lowVersions=lowMeshes.map(m=>m.instanceMatrix.version)
    ctx.graphicsQuality='high';system.update(2000,roots)
    assert.ok(lowMeshes.every(m=>m.count===0&&!m.visible),'High quality hides and empties the Low draws')
    assert.ok(highMeshes.some(m=>m.count>0&&m.visible),'High quality restores full geometry')
    assert.deepEqual(lowMeshes.map(m=>m.instanceMatrix.version),lowVersions,'return to High does not rewrite the inactive Low buffers')
    const releases=[]
    for(const mesh of meshes) for(const resource of [mesh,mesh.geometry,mesh.material]) { const record={count:0}; releases.push(record);resource.addEventListener('dispose',()=>record.count++) }
    system.dispose();assert.ok(releases.every(r=>r.count===1),'each variant instance/geometry/material is released once')
  } finally { if(ctx.scene.children.length)system.dispose() }
})
