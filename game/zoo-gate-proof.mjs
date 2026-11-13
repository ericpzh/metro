import * as THREE from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {referenceStation} from '/src/data/reference-station.ts'
import {toState} from '/src/build/model.ts'
import {World} from '/src/sim/world.ts'
const station=referenceStation('zoo'),doc=toState(station),world=new World(station,7654321),g=world.graph
const start=g.nodeIndex.get('59,16,-15'),end=g.nodeIndex.get('59,20,-15'),gate=g.servers[52]
if(!gate||g.nodeX[gate.node]!==59.5||g.nodeY[gate.node]!==18.5)throw Error('Zoo gate changed')
const person=world.pool.spawn({origin:'',stops:[],dest:''},g.nodeX[start],g.nodeY[start],g.nodeZ[start],0)
person.state=1;person.needs={stepFree:false,luggage:false};person.path=world.path.search(start,end,person.needs);person.pathIdx=0;person.destNode=end;world.spawnStreet=()=>{}
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.setPixelRatio(1);renderer.setSize(960,600);renderer.setClearColor(new THREE.Color(.08,.11,.14));document.querySelector("#app").prepend(renderer.domElement)
const scene=new THREE.Scene(),cam=new THREE.OrthographicCamera(-18*1280/800,18*1280/800,18,-18,.3,400)
// The Unity bridge swaps Y/Z and reflects handedness; mirror X for the matching view.
const mirror=x=>119-x;cam.position.set(mirror(77.5),8,.5);cam.lookAt(59.5,-14,18.5);cam.updateProjectionMatrix()
const box=new THREE.BoxGeometry(1,1,1),blockMaterial=new THREE.MeshBasicMaterial({color:new THREE.Color(.45,.48,.51)}),gateMaterial=new THREE.MeshBasicMaterial({color:new THREE.Color(.85,.55,.12)}),crowdMaterial=new THREE.MeshBasicMaterial({color:new THREE.Color(.15,.55,.8)})
const matrix=new THREE.Matrix4(),translation=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3()
function batches(rows,material,make){for(let i=0;i<rows.length;i+=1023){let subset=rows.slice(i,i+1023),mesh=new THREE.InstancedMesh(box,material,subset.length);subset.forEach((v,k)=>{make(v,matrix);mesh.setMatrixAt(k,matrix)});mesh.frustumCulled=false;scene.add(mesh)}}
const cells=doc.cells.filter(c=>c.fill==='solid'&&c.z>=-15&&c.z< -10),gates=doc.modules.filter(m=>m.type==='gate'&&m.z===-15)
batches(cells,blockMaterial,(c,m)=>m.compose(translation.set(mirror(c.x+.5),c.z+.5,c.y+.5),rotation.identity(),scale.set(1,1,1)))
batches(gates,gateMaterial,(v,m)=>m.compose(translation.set(mirror(v.x+.5),v.z+1.5,v.y+.5),rotation.setFromAxisAngle(new THREE.Vector3(0,1,0),-(v.rot??0)*Math.PI/2),scale.set(.25,1,.8)))
const shapes=[[0,.98,0,.42,.62,.22],[0,1.47,0,.26,.32,.24],[-.14,.34,0,.15,.68,.18],[.14,.34,0,.15,.68,.18],[-.29,.99,0,.14,.58,.16],[.29,.99,0,.14,.58,.16],[.37,1.22,.12,.10,.10,.08]].map(([a,b,c,w,h,d])=>{let geo=new THREE.BoxGeometry(w,h,d);geo.translate(a,b,c);return geo})
const crowdGeometry=mergeGeometries(shapes);shapes.forEach(s=>s.dispose());const crowd=new THREE.Mesh(crowdGeometry,crowdMaterial);scene.add(crowd)
function publish(){window.__metroZooGate={tick:world.tick,state:person.state,pathIndex:person.pathIdx,gateDir:person.gateDir,queue:gate.queue.length,lane:gate.lane,waitCount:gate.waitCount,x:person.x,y:person.y,z:person.z,cooldown:gate.cooldown,waitAccum:gate.waitAccum,dead:person.dead};document.querySelector('#status').textContent=`Zoo gate 243 | tick ${world.tick} | queue ${gate.queue.length} | served ${gate.waitCount}`}
document.querySelector('#advance').onclick=()=>{if(!person.dead){world.tickOnce();publish()}};publish()
function render(){crowd.visible=!person.dead;crowd.position.set(mirror(person.x),person.z,person.y);renderer.render(scene,cam);requestAnimationFrame(render)}requestAnimationFrame(render)

