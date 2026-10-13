// Standalone art-direction prototype B. Authored from scratch, independently
// of the game's passenger atlas; exports an editable glTF node rig with Walk.
import * as THREE from '../game/node_modules/three/build/three.module.js'
import { GLTFExporter } from '../game/node_modules/three/examples/jsm/exporters/GLTFExporter.js'
import { RoundedBoxGeometry } from '../game/node_modules/three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const palette = { skin: 0xc8c8c6, shirt: 0xd5d5d3, jacket: 0xb0b0ae, trousers: 0x858583, shoes: 0x777775, hair: 0x7b7b79, bag: 0x8d8d8b }
const materials = Object.fromEntries(Object.entries(palette).map(([name, color]) => {
 const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false })
 m.name = name
 return [name, m]
}))

// Rounded rectangular cross-sections give clothing broad, flat faces instead
// of tubular mannequin limbs. Input rings: [height, half-width, half-depth].
function loft(rings, segments = 24, opening = 0, power = 3) {
 const curve=new THREE.CatmullRomCurve3(rings.map(([y,w,d])=>new THREE.Vector3(w,y,d)),false,'centripetal')
 rings=curve.getPoints((rings.length-1)*3).map(v=>[v.y,Math.max(.001,v.x),Math.max(.001,v.z)])
 const p = [], indices = []
 for (const [y, width, depth] of rings) for (let s = 0; s <= segments; s++) {
  const a = opening + (Math.PI * 2 - opening * 2) * s / segments
  const si = Math.sin(a), co = Math.cos(a)
  p.push(Math.sign(si) * Math.abs(si) ** (2 / power) * width, y,
   Math.sign(co) * Math.abs(co) ** (2 / power) * depth)
 }
 for (let r = 0; r < rings.length - 1; r++) for (let s = 0; s < segments; s++) {
  const a = r * (segments + 1) + s, b = a + segments + 1
  indices.push(...(rings[r+1][0]>rings[r][0] ? [a,a+1,b,a+1,b+1,b] : [a,b,a+1,a+1,b,b+1]))
 }
 if (!opening) for (const r of [0, rings.length - 1]) {
  const center = p.length / 3
  p.push(0, rings[r][0], 0)
  for (let s = 0; s < segments; s++) {
   const a = r * (segments + 1) + s
   const bottom=(r===0)===(rings[0][0]<rings.at(-1)[0])
   indices.push(...(bottom ? [center,a+1,a] : [center,a,a+1]))
  }
 }
 const g = new THREE.BufferGeometry()
 g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
 g.setIndex(indices)
 g.computeVertexNormals()
 return g
}

function mesh(parent, name, geometry, material, position = [0, 0, 0]) {
 const m = new THREE.Mesh(geometry, materials[material])
 m.name = name; m.position.set(...position); parent.add(m)
 return m
}
function group(parent, name, position) {
 const g = new THREE.Group(); g.name = name; g.position.set(...position); parent.add(g); return g
}
function oval(parent, name, material, position, scale) {
 const g = new THREE.SphereGeometry(1, 20, 14); g.scale(...scale)
 return mesh(parent, name, g, material, position)
}
function rounded(parent, name, material, position, size, radius) {
 return mesh(parent, name, new RoundedBoxGeometry(...size, 2, radius), material, position)
}

export function buildSoftPassenger() {
 const model = new THREE.Group(); model.name = 'SoftMinimalPassenger'
 model.userData = { direction: 'B — Soft minimal', units: 'metres', axes: 'Y up, +Z forward', prototype: true, faceless: true }
 const hips = group(model, 'Hips', [0, .91, 0])
 rounded(hips, 'Waist', 'trousers', [0, -.035, 0], [.345, .17, .145], .045)
 const torso = group(hips, 'Torso', [0, 0, 0])
 mesh(torso, 'Shirt', loft([[0,.154,.062],[.12,.16,.065],[.33,.179,.07],[.44,.16,.065],[.49,.08,.044]]), 'shirt')
 // A continuous back and two soft front panels; open in the middle so the
 // pale shirt remains a simple visible colour block from the front.
 mesh(torso, 'OpenJacket', loft([[-.015,.187,.076],[.01,.191,.08],[.13,.187,.081],[.33,.199,.085],[.43,.201,.075],[.475,.105,.048]], 32, .40), 'jacket')
 oval(torso, 'Neck', 'skin', [0,.535,0], [.050,.083,.044])
 const head = group(torso, 'Head', [0,.67,0])
 // No face geometry, nose, facial texture, eyeballs or oversized head.
 oval(head,'BlankHead','skin', [0,-.006,0], [.103,.139,.076])
 // One shallow wavy cap, with a higher forehead edge and lower sides/back.
 const hp = [], hi = [], columns = 40, rows = 10
 for (let r = 0; r <= rows; r++) for (let s = 0; s <= columns; s++) {
  const a = s / columns * Math.PI * 2
  const front = Math.max(0, Math.cos(a)), back = Math.max(0, -Math.cos(a))
  const end = 1.64 - front * .48 + back * .27 + Math.sin(a * 5 + .4) * .065
  const theta = r / rows * end
  const wave = Math.sin(a * 5 + theta * 3) * .0035 * Math.sin(theta)
  hp.push((.111 + wave) * Math.sin(theta) * Math.sin(a),
   .012 + (.136 + wave) * Math.cos(theta) + .007*(.5+.5*Math.sin(a*3+.2))*Math.sin(theta), (.082 + wave) * Math.sin(theta) * Math.cos(a))
 }
 for(let r=0;r<rows;r++)for(let s=0;s<columns;s++) {
  const a=r*(columns+1)+s,b=a+columns+1
  hi.push(a,b,a+1,a+1,b,b+1)
 }
 const hair = new THREE.BufferGeometry()
 hair.setAttribute('position',new THREE.Float32BufferAttribute(hp,3));hair.setIndex(hi);hair.computeVertexNormals()
 mesh(head,'SoftHair',hair,'hair')
 // Small, undecorated ears stay inside the restrained head silhouette.
 for(const side of [-1,1]) oval(head,`Ear${side < 0 ? 'L':'R'}`,'skin',[side*.106,-.033,-.008],[.019,.033,.018])

 for(const side of [-1,1]) {
  const name = side < 0 ? 'L' : 'R'
  const leg=group(hips,`Thigh${name}`,[side*.104,-.065,0])
  mesh(leg,`UpperTrousers${name}`,loft([[.012,.082,.070],[-.06,.084,.071],[-.22,.080,.068],[-.39,.075,.065],[-.41,.074,.065]]),'trousers')
  const knee=group(leg,`Knee${name}`,[0,-.398,0])
  mesh(knee,`LowerTrousers${name}`,loft([[.015,.074,.065],[-.10,.073,.063],[-.27,.067,.059],[-.335,.066,.058],[-.352,.062,.054]]),'trousers')
  const foot=group(knee,`Foot${name}`,[0,-.363,.013])
  rounded(foot,`Shoe${name}`,'shoes',[0,-.030,.032],[.138,.090,.233],.033)
  const arm=group(torso,`UpperArm${name}`,[side*.193,.424,0])
  arm.rotation.z=side*.06
  mesh(arm,`UpperSleeve${name}`,loft([[.05,.015,.015],[.034,.047,.043],[.012,.062,.055],[-.035,.070,.060],[-.18,.067,.058],[-.26,.064,.055]]),'jacket')
  const elbow=group(arm,`Elbow${name}`,[0,-.25,0])
  mesh(elbow,`LowerSleeve${name}`,loft([[.01,.064,.055],[-.10,.064,.053],[-.215,.061,.051],[-.228,.057,.048]]),'jacket')
  oval(elbow,`Hand${name}`,'skin',[0,-.274,.004],[.040,.064,.033])
 }
 rounded(torso,'Backpack','bag',[0,.25,-.145],[.272,.344,.130],.045)
 // Broad, flat straps curve around the shoulder without fine seams or buckles.
 for(const side of [-1,1]) {
  const path=new THREE.CatmullRomCurve3([
   new THREE.Vector3(side*.120,.44,-.145),new THREE.Vector3(side*.126,.48,-.048),
   new THREE.Vector3(side*.136,.43,.080),new THREE.Vector3(side*.129,.27,.085),
   new THREE.Vector3(side*.121,.105,.080)])
  const p=[],idx=[]
  for(let i=0;i<=20;i++) {
   const v=path.getPoint(i/20)
   for(const x of [-.015,.015])p.push(v.x+x,v.y,v.z+.006)
   if(i<20){const a=i*2;idx.push(a,a+1,a+2,a+1,a+3,a+2)}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(idx);g.computeVertexNormals()
  mesh(torso,`Strap${side<0?'L':'R'}`,g,'bag')
 }
 // Correct the exact foot origin after rounded geometry construction.
 model.updateMatrixWorld(true)
 const bounds=new THREE.Box3().setFromObject(model)
 hips.position.y-=bounds.min.y
 const times=Array.from({length:33},(_,i)=>i*1.2/32),tracks=[]
 const rotation=(name,angle)=>{
  const values=times.flatMap((t,i)=>new THREE.Quaternion().setFromEuler(new THREE.Euler(angle(i/32*Math.PI*2),0,0)).toArray())
  tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`,times,values))
 }
 for(const [name,phase]of [['L',0],['R',Math.PI]]) {
  rotation(`Thigh${name}`,p=>Math.sin(p+phase)*.33)
  rotation(`Knee${name}`,p=>-Math.max(0,Math.cos(p+phase))*.40)
  rotation(`Foot${name}`,p=>Math.sin(p+phase)*.11)
  rotation(`UpperArm${name}`,p=>-Math.sin(p+phase)*.22)
  rotation(`Elbow${name}`,p=>-.08-Math.max(0,Math.sin(p+phase))*.10)
 }
 const animations=[new THREE.AnimationClip('Walk',1.2,tracks)]
 return {model,animations}
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
 // GLTFExporter uses the browser FileReader interface even for texture-free
 // binary exports. Blob itself is supplied by Node.
 globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.()}) }
  readAsDataURL(blob) { blob.arrayBuffer().then(result=>{this.result=`data:${blob.type};base64,${Buffer.from(result).toString('base64')}`;this.onloadend?.()}) }
 }
 const {model,animations}=buildSoftPassenger()
 const data=await new GLTFExporter().parseAsync(model,{binary:true,animations})
 const folder=resolve('prototypes/soft-passenger')
 mkdirSync(folder,{recursive:true})
 writeFileSync(resolve(folder,'passenger-b.glb'),Buffer.from(data))
 let triangles=0;model.traverse(n=>{if(n.isMesh)triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3})
 console.log(JSON.stringify({file:resolve(folder,'passenger-b.glb'),bytes:data.byteLength,triangles,bounds:new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).toArray(),animations:animations.map(c=>c.name)}))
}
