// Incremental bake from the authoritative full atlas. No export, pose or High
// topology changes: useful when only the offline Low reduction policy changes.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {inflateSync,deflateSync} from 'node:zlib';
import {MeshoptSimplifier} from '../game/node_modules/meshoptimizer/meshopt_simplifier.js';
import {restorePassengerFrames} from '../game/src/render/passengerAtlas.ts';
import {writeAsset} from '../model/scripts/write-asset.mjs';
import {passengerLowTopology} from './passenger-low-topology.mjs';

await MeshoptSimplifier.ready;
const path=new URL('../game/src/assets/passenger-approved.json',import.meta.url);
const atlas=JSON.parse(readFileSync(path));
if(atlas.encoding!=='zlib-base64')throw Error('Incremental Low bake requires the packed approved atlas');
const decode=(key,T)=>{
 const b=inflateSync(Buffer.from(atlas[key],'base64'));
 return new T(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
};
const IndexArray=atlas.indexBits===32?Uint32Array:Uint16Array;
const poses=restorePassengerFrames(decode('positions',Int16Array),atlas.vertices,atlas.poseEncoding);
const indices=decode('indices',IndexArray),regions=decode('regions',Uint8Array),rows=[];
for(const [row,entry] of atlas.library.entries()){
 const bytes=readFileSync(new URL('../model/public/models/'+entry.file,import.meta.url));
 if(createHash('sha256').update(bytes).digest('hex')!==entry.sourceSha256)throw Error(`Stale full passenger atlas: ${entry.id}; run npm run bake:passengers`);
 const source=indices.subarray(row*atlas.corners,row*atlas.corners+entry.triangles*3);
 const vertices=[...new Set(source)],lookup=new Map(vertices.map((v,i)=>[v,i]));
 const localPoses=new Int16Array(vertices.length*3*atlas.frames);
 for(let f=0;f<atlas.frames;f++)for(let v=0;v<vertices.length;v++){
  const from=(f*atlas.vertices+vertices[v])*3;
  localPoses.set(poses.subarray(from,from+3),(f*vertices.length+v)*3);
 }
 const low=passengerLowTopology({indices:Array.from(source,v=>lookup.get(v)),poses:localPoses,vertices:vertices.length,regions:Uint8Array.from(vertices,v=>regions[v]),garmentShape:entry.garmentShape,positionScale:atlas.positionScale});
 const result=low.indices.map(v=>vertices[v]);
 rows.push(result);entry.lowTriangles=result.length/3;
 console.log(entry.id,{high:entry.triangles,low:entry.lowTriangles,error:low.error});
}
atlas.lowCorners=Math.max(...rows.map(row=>row.length));atlas.lowTriangles=atlas.lowCorners/3;
const table=new IndexArray(atlas.lowCorners*rows.length);
for(const [row,values] of rows.entries()){
 table.fill(values[0],row*atlas.lowCorners,(row+1)*atlas.lowCorners);
 table.set(values,row*atlas.lowCorners);
}
atlas.lowIndices=deflateSync(Buffer.from(table.buffer)).toString('base64');
await writeAsset(path,JSON.stringify(atlas));
console.log({variants:rows.length,highStride:atlas.triangles,lowStride:atlas.lowTriangles,lowTotal:atlas.library.reduce((sum,m)=>sum+m.lowTriangles,0)});
