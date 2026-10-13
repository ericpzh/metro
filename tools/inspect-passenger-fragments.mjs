import {readFileSync} from 'node:fs';
import {GLTFLoader} from '../game/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from '../game/node_modules/three/build/three.module.js';
const b=readFileSync(new URL('../prototypes/trellis-passenger/passenger-b-walk-forward.glb',import.meta.url));
const gltf=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
const m=gltf.scene.getObjectByName('mesh_0'),p=m.geometry.attributes.position,c=m.geometry.attributes.color,idx=m.geometry.index.array;
const grey=new THREE.Color().setRGB(.53,.53,.53,THREE.SRGBColorSpace).r;
const parent=[],keys=new Map(),vertex=new Map(),tris=[];
function root(i){return parent[i]===i?i:parent[i]=root(parent[i])}
function id(i){if(vertex.has(i))return vertex.get(i);const k=[p.getX(i),p.getY(i),p.getZ(i)].map(x=>Math.round(x*1e5)).join(',');let a=keys.get(k);if(a===undefined){a=parent.length;keys.set(k,a);parent.push(a)}vertex.set(i,a);return a}
for(let i=0;i<idx.length;i+=3){const t=[idx[i],idx[i+1],idx[i+2]];if(!t.every(j=>Math.abs(c.getX(j)-grey)<.001))continue;const a=t.map(id);parent[root(a[1])]=root(a[0]);parent[root(a[2])]=root(a[0]);tris.push(t)}
const groups=new Map();for(const t of tris){const r=root(id(t[0]));let g=groups.get(r);if(!g){g={triangles:0,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};groups.set(r,g)}g.triangles++;for(const i of t)for(let k=0;k<3;k++){g.min[k]=Math.min(g.min[k],p.array[i*3+k]);g.max[k]=Math.max(g.max[k],p.array[i*3+k])}}
console.log([...groups.values()].sort((a,b)=>b.triangles-a.triangles).slice(0,25));
