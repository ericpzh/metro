import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs'
import {resolve} from 'node:path'
import * as THREE from '../game/node_modules/three/build/three.module.js'
// Only geometry is baked. Texture loading is deliberately inert in this Node build tool.
globalThis.document={createElementNS:()=>({addEventListener(){},removeEventListener(){},set src(_value){}})}
const {Tree}=await import('../game/node_modules/@dgreenheck/ez-tree/build/ez-tree.es.js')
const source=resolve('game/node_modules/@dgreenheck/ez-tree')
const options=JSON.parse(readFileSync(resolve(source,'src/lib/presets/ash_medium.json'),'utf8'))
options.branch.start[1]=.65;options.branch.force.strength=.015;options.branch.segments={0:9,1:6,2:4,3:3};options.leaves.count=14;options.leaves.size=7;options.leaves.sizeVariance=.35
const tree=new Tree();tree.loadFromJson(options)
const branches=tree.branchesMesh.geometry,leaves=tree.leavesMesh.geometry
branches.rotateX(Math.PI/2);leaves.rotateX(Math.PI/2)
const bounds=new THREE.Box3().setFromBufferAttribute(branches.getAttribute('position'));bounds.union(new THREE.Box3().setFromBufferAttribute(leaves.getAttribute('position')))
const scale=4.5/bounds.max.z
for(const geometry of [branches,leaves])geometry.scale(scale,scale,scale)
const pack=geometry=>({position:Array.from(geometry.getAttribute('position').array,v=>+v.toFixed(5)),normal:Array.from(geometry.getAttribute('normal').array,v=>+v.toFixed(4)),uv:Array.from(geometry.getAttribute('uv').array,v=>+v.toFixed(4)),index:Array.from(geometry.index.array)})
const output=resolve('game/src/assets/trees');mkdirSync(output,{recursive:true})
writeFileSync(resolve(output,'street-ash.json'),JSON.stringify({source:'@dgreenheck/ez-tree 1.1.0, Ash Medium, seed 36330',options,branches:pack(branches),leaves:pack(leaves)}))
copyFileSync(resolve(source,'src/lib/assets/leaves/ash_color.png'),resolve(output,'ash-leaves.png'))
copyFileSync(resolve(source,'LICENSE'),resolve(output,'EZ-TREE-LICENSE.txt'))
console.log({branches:branches.index.count/3,leaves:leaves.index.count/3,height:4.5})
