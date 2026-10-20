import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildTrain, createModelMaterials, disposeModelMaterials, disposeObject, setDoorsSides } from '../src/render/models.ts'
import { STOCK, STOCK_CLASSES, DOOR_HEAD_Z, CABIN_CEILING_Z, doorCentres } from '../src/sim/stock.ts'
import { carRoofSection, openRoofUnderside, carShellAt } from '../src/render/models/pieces/CarShellProfile.ts'
import { dHalfWidth } from '../src/render/models/pieces/DTrainShell.ts'
import { modelDetailGeometry } from '../src/render/modelDetail.ts'
import { stubCanvas } from './support/stub-canvas.mjs'

test('the entire cabin ceiling is raised continuously with clear door headers at High and Low', () => {
 const previous = globalThis.document
 globalThis.document = { createElement() { const canvas={width:0,height:0};const {g}=stubCanvas();g.canvas=canvas;canvas.getContext=()=>g;return canvas } }
 const mats=createModelMaterials()
 try {
  for(const stock of STOCK_CLASSES) {
   const line={stock,cars:2}, doors=doorCentres(line)
   const root=buildTrain(mats,{x:0,y:0,z:0,stock,cars:2,power:'catenary',doorsOpen:false,colour:'#287db2',dirSign:1,yaw:0})
   try {
    const boards=root.children.filter(m=>m.name==='cabin-route-panel')
    assert.equal(boards.length,doors.length*2)
    const ceilings=root.children.filter(m=>m.name.startsWith('cabin-ceiling')||m.name.startsWith('cabin-door-ceiling'))
    assert.equal(ceilings.length, 2, 'one continuous ceiling per car, with no doorway cut-outs')
    assert.ok(ceilings.every(m=>m.name==='cabin-ceiling'))
    for(const low of [false,true]) {
     const originals=new Map()
     root.traverse(m=>{if(m.isMesh){originals.set(m,m.geometry);if(low)m.geometry=modelDetailGeometry(m)??m.geometry}})
     try {
      for(const open of [0,1]) {
       setDoorsSides(root,open,open)
       root.updateMatrixWorld(true)
       for(const board of boards) {
        const bounds=new THREE.Box3().setFromObject(board)
        assert.ok(bounds.min.z>=DOOR_HEAD_Z+.029,`${stock}: board clears the full door head`)
        for(const ceiling of ceilings) {
         const overlap=bounds.clone().intersect(new THREE.Box3().setFromObject(ceiling))
         const size=overlap.getSize(new THREE.Vector3())
         assert.ok(size.x*size.y*size.z<1e-9,`${stock}: board is not buried in the ceiling`)
        }
        const x=board.position.x, y=board.position.y
        const eye=new THREE.Vector3(x,0,1.57)
        const target=bounds.getCenter(new THREE.Vector3()), sight=target.clone().sub(eye)
        const roof=root.children.filter(m=>m.name==='car-roof'||m.name==='d-car-roof'||m.name==='d-car-shoulder'||m.name==='cabin-roof-lining')
        const obstruction=new THREE.Raycaster(eye,sight.clone().normalize()).intersectObjects([...ceilings,...roof])[0]
        assert.ok(!obstruction||obstruction.distance>sight.length(),'raised board is visible from the aisle below the ceiling')
        const ceiling=ceilings.find(m=>x>=m.position.x-m.geometry.parameters.width/2&&x<=m.position.x+m.geometry.parameters.width/2)
        assert.ok(ceiling)
        const ceilingBounds=new THREE.Box3().setFromObject(ceiling)
        const roofHalf=stock==='D'?dHalfWidth(ceilingBounds.max.z):carShellAt(STOCK[stock].width,ceilingBounds.max.z,low).y
        assert.ok(Math.max(Math.abs(ceilingBounds.min.y),Math.abs(ceilingBounds.max.y))<roofHalf,'lining stays inside the unchanged outer roof')
        assert.ok(ceilingBounds.min.z>=bounds.max.z+.039,'four centimetres of space above the board')
        for(const dx of [-.4,0,.4]) {
         const hit=new THREE.Raycaster(new THREE.Vector3(x+dx,y,DOOR_HEAD_Z),new THREE.Vector3(0,0,1)).intersectObjects(ceilings)[0]
         assert.ok(hit&&hit.point.z>bounds.max.z,'continuous ceiling clears the route board')
        }
       }
      }
      for(const ceiling of ceilings) {
       const box=new THREE.Box3().setFromObject(ceiling)
       for(const fraction of [.1,.3,.5,.7,.9])for(const y of [-.8,0,.8]) {
        const x=box.min.x+(box.max.x-box.min.x)*fraction
        const roof=root.children.filter(m=>m.name==='car-roof'||m.name==='d-car-roof'||m.name==='pantograph-roof-well')
        const hit=new THREE.Raycaster(new THREE.Vector3(x,y,2),new THREE.Vector3(0,0,1)).intersectObjects([...ceilings,...roof])[0]
        assert.ok(hit&&Math.abs(hit.point.z-2.94)<1e-6,'full cabin headroom stays raised between doors and under the collector')
       }
      }
      const linings=root.children.filter(m=>m.name==='cabin-roof-lining')
      assert.equal(linings.length,4,'both car shoulders have continuous inward lining')
      for(const ceiling of ceilings)for(const y of [-1,1]) {
       const ray=new THREE.Raycaster(new THREE.Vector3(ceiling.position.x,0,2.8),new THREE.Vector3(0,y,0))
       assert.ok(ray.intersectObjects(linings)[0],'inner roof shoulders close the cabin to the sky')
      }
      const centre=new THREE.Raycaster(new THREE.Vector3(doors[0],0,DOOR_HEAD_Z-.1),new THREE.Vector3(0,0,1)).intersectObjects(ceilings)[0]
      assert.ok(centre&&Math.abs(centre.point.z-(CABIN_CEILING_Z-.05))<1e-6,'centre ceiling is raised to the same 2.94 m underside')
     } finally {for(const [mesh,geometry] of originals)mesh.geometry=geometry}
    }
   } finally {disposeObject(root)}
  }
 } finally {disposeModelMaterials(mats);globalThis.document=previous}
})

test('hollowing the roof underside leaves exterior High/Low ray hits unchanged',()=>{
 const material=new THREE.MeshBasicMaterial()
 try{for(const stock of ['A','B','C','L'])for(const low of [false,true])for(const well of [undefined,2.85]) {
  const geometry=new THREE.ExtrudeGeometry(carRoofSection(STOCK[stock].width,low,well),{depth:8,bevelEnabled:false})
  geometry.rotateY(Math.PI/2);geometry.rotateX(Math.PI/2)
  const mesh=new THREE.Mesh(geometry,material);mesh.updateMatrixWorld(true)
  const probes=[-.9,-.4,0,.4,.9].map(y=>new THREE.Raycaster(new THREE.Vector3(4,y,4),new THREE.Vector3(0,0,-1)))
  const before=probes.map(ray=>ray.intersectObject(mesh)[0]?.point.z)
  openRoofUnderside(geometry)
  assert.deepEqual(probes.map(ray=>ray.intersectObject(mesh)[0]?.point.z),before,'outer crown, shoulders and collector well keep their height')
  geometry.dispose()
 }}finally{material.dispose()}
})
