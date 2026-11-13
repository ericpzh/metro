import * as THREE from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {referenceStation} from '/src/data/reference-station.ts'
import {toState} from '/src/build/model.ts'
import {World} from '/src/sim/world.ts'
const station=referenceStation('tianhe'),doc=toState(station),world=new World(station,7654321),g=world.graph
const start=g.nodeIndex.get('172,-112,-5'),end=g.nodeIndex.get('176,-112,-5'),gate=g.servers[419]
if(!gate||g.nodeX[gate.node]!==174.5||g.nodeY[gate.node]!==-111.5)throw Error('Tianhe gate changed')
const person=world.pool.spawn({origin:'',stops:[],dest:''},g.nodeX[start],g.nodeY[start],g.nodeZ[start],0)
person.state=1;person.needs={stepFree:false,luggage:false};person.path=world.path.search(start,end,person.needs);person.pathIdx=0;person.destNode=end;world.spawnStreet=()=>{}
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.setPixelRatio(1);renderer.setSize(960,600);renderer.setClearColor(new THREE.Color(.08,.11,.14));document.querySelector("#app").prepend(renderer.domElement)
const scene=new THREE.Scene(),cam=new THREE.OrthographicCamera(-18*1280/800,18*1280/800,18,-18,.3,400)
// The Unity bridge swaps Y/Z and reflects handedness; mirror X for the matching view.
const mirror=x=>349-x;cam.position.set(mirror(192.5),18,-129.5);cam.lookAt(174.5,-4,-111.5);cam.updateProjectionMatrix()
const box=new THREE.BoxGeometry(1,1,1),blockMaterial=new THREE.MeshBasicMaterial({color:new THREE.Color(.45,.48,.51)}),gateMaterial=new THREE.MeshBasicMaterial({color:new THREE.Color(.85,.55,.12)}),crowdMaterial=new THREE.MeshBasicMaterial({color:new THREE.Color(.15,.55,.8)})
const matrix=new THREE.Matrix4(),translation=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3()
function batches(rows,material,make){for(let i=0;i<rows.length;i+=1023){let subset=rows.slice(i,i+1023),mesh=new THREE.InstancedMesh(box,material,subset.length);subset.forEach((v,k)=>{make(v,matrix);mesh.setMatrixAt(k,matrix)});mesh.frustumCulled=false;scene.add(mesh)}}
const cells=doc.cells.filter(c=>c.fill==='solid'&&c.z>=-5&&c.z<0),gates=doc.modules.filter(m=>m.type==='gate'&&m.z===-5)
batches(cells,blockMaterial,(c,m)=>m.compose(translation.set(mirror(c.x+.5),c.z+.5,c.y+.5),rotation.identity(),scale.set(1,1,1)))
batches(gates,gateMaterial,(v,m)=>m.compose(translation.set(mirror(v.x+.5),v.z+1.5,v.y+.5),rotation.setFromAxisAngle(new THREE.Vector3(0,1,0),-(v.rot??0)*Math.PI/2),scale.set(.25,1,.8)))
const shapes=[[0,.98,0,.42,.62,.22],[0,1.47,0,.26,.32,.24],[-.14,.34,0,.15,.68,.18],[.14,.34,0,.15,.68,.18],[-.29,.99,0,.14,.58,.16],[.29,.99,0,.14,.58,.16],[.37,1.22,.12,.10,.10,.08]].map(([a,b,c,w,h,d])=>{let geo=new THREE.BoxGeometry(w,h,d);geo.translate(a,b,c);return geo})
const crowdGeometry=mergeGeometries(shapes);shapes.forEach(s=>s.dispose());const crowd=new THREE.Mesh(crowdGeometry,crowdMaterial);scene.add(crowd)
// The background load uses the exact graph-byte fixture and 512-tick-verified
// synthetic queue/adjacency algorithm; it is separate from the real World passenger.
const binary=await (await fetch('./tianhe-graph.bytes')).arrayBuffer(),dv=new DataView(binary);let offset=0
const readInt=()=>{let v=dv.getInt32(offset,true);offset+=4;return v},readFloat=()=>{let v=dv.getFloat32(offset,true);offset+=4;return v}
if(readInt()!==0x4d475231)throw Error('Wrong graph');const n=readInt(),e=readInt(),serverCount=readInt()
const floats=count=>Float32Array.from({length:count},readFloat),ints=count=>Int32Array.from({length:count},readInt)
const nx=floats(n),ny=floats(n),nz=floats(n),starts=ints(n+1),edges=ints(e),serverNodes=new Int32Array(serverCount),rates=new Float32Array(serverCount)
for(let i=0;i<serverCount;i++){serverNodes[i]=readInt();rates[i]=readFloat()}if(offset!==binary.byteLength||starts[n]!==e)throw Error('Invalid graph')
const population=5171,capacity=128,floor=[];for(let i=0;i<n;i++)if(Math.abs(nz[i]+5)<.01)floor.push(i)
const nodes=new Int32Array(population),agentQueue=new Int32Array(population).fill(-1),heads=new Int32Array(serverCount),lengths=new Int32Array(serverCount),credits=new Float32Array(serverCount),queueData=new Int32Array(serverCount*capacity)
for(let i=0;i<population;i++)nodes[i]=floor[(Math.imul(i,2654435761)>>>0)%floor.length]
let syntheticTick=0,syntheticQueued=0,syntheticAdmitted=0,syntheticCompleted=0
function syntheticStep(){syntheticTick++;for(let s=0;s<serverCount;s++){credits[s]=Math.min(8,Math.fround(credits[s]+Math.max(0,rates[s])));let cap=Math.min(8,Math.floor(credits[s]));credits[s]=Math.fround(credits[s]-cap);while(cap-->0&&lengths[s]>0){let id=queueData[s*capacity+heads[s]];heads[s]=(heads[s]+1)%capacity;lengths[s]--;agentQueue[id]=-1;syntheticQueued--;syntheticCompleted++}}for(let i=0;i<population;i++){if(agentQueue[i]>=0)continue;let node=nodes[i];if((i+syntheticTick)%97===0){let s=((Math.imul(i,2654435761)+syntheticTick)>>>0)%serverCount;if(serverNodes[s]>=0&&serverNodes[s]<n&&lengths[s]<capacity){nodes[i]=serverNodes[s];queueData[s*capacity+(heads[s]+lengths[s])%capacity]=i;lengths[s]++;agentQueue[i]=s;syntheticQueued++;syntheticAdmitted++;continue}}let count=starts[node+1]-starts[node];if(count>0)nodes[i]=edges[starts[node]+(((Math.imul(i,1103515245)+Math.imul(syntheticTick,12345))>>>0)%count)]}}
const background=[];for(let i=0;i<population;i+=1023){let batch=new THREE.InstancedMesh(crowdGeometry,crowdMaterial,Math.min(1023,population-i));batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);batch.frustumCulled=false;scene.add(batch);background.push(batch)}
function renderBackground(){for(let i=0;i<population;i++){let node=nodes[i];matrix.compose(translation.set(mirror(nx[node]),nz[node],ny[node]),rotation.identity(),scale.set(1,1,1));background[Math.floor(i/1023)].setMatrixAt(i%1023,matrix)}for(const batch of background)batch.instanceMatrix.needsUpdate=true}
function publish(){window.__metroZooGate={tick:world.tick,state:person.state,pathIndex:person.pathIdx,gateDir:person.gateDir,queue:gate.queue.length,lane:gate.lane,waitCount:gate.waitCount,x:person.x,y:person.y,z:person.z,cooldown:gate.cooldown,waitAccum:gate.waitAccum,dead:person.dead,syntheticTick,syntheticQueued,syntheticAdmitted,syntheticCompleted};document.querySelector('#status').textContent=`Tianhe gate 574 | tick ${world.tick} | queue ${gate.queue.length} | served ${gate.waitCount}`}
document.querySelector('#advance').onclick=()=>{if(!person.dead){syntheticStep();world.tickOnce();publish()}};publish()
function render(){renderBackground();crowd.visible=!person.dead;crowd.position.set(mirror(person.x),person.z,person.y);renderer.render(scene,cam);requestAnimationFrame(render)}requestAnimationFrame(render)


