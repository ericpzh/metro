import * as THREE from 'three';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

// Positive signed distances are inside a garment. Intersect the actual triangles
// with these boundaries rather than interpolating different colors across them.
const regions = [
  { grey: .47, planes: [p => p.y - (1.525 + .065 * Math.tanh((p.z - .065) * 15) - .035 * Math.exp(-(((p.x-.065)/.045)**2))), p => p.y - 1.425] },
  // One smooth curve, without clamped shoulders or separate collar tabs.
  { grey: .78, planes: [p => p.y - (1.305 + 4.1*p.x*p.x)] },
  { grey: .40, planes: [p => .145 - p.y] },
  { grey: .78, planes: [p => Math.abs(p.x) - .201, p => .823 - p.y, p => p.y - .595] },
  // Include the upper corner attachments in the pack's continuous dark panel.
  { grey: .43, planes: [p => -.075-p.z, p => p.y-1.215, p => 1.35-p.y, p => .19-Math.abs(p.x)] },
  { grey: .43, planes: [p => -.108 - p.z - .12 * ((p.y-1.10)/.30)**4, p => p.y - .815, p => 1.35-p.y] },
  // Remove the narrow inner strap extensions above the pack (reference B).
  { grey: .66, planes: [p => .14-Math.abs(p.x), p => .035-p.z, p => p.y-1.22] },
  { grey: .47, planes: [p => Math.abs(p.x)-.075, p => .21-Math.abs(p.x), p => -.07-p.z, p => p.z+.145, p => p.y-1.245, p => 1.40-p.y] },
  // Two continuous ribbons run over the shoulders and down to the jacket.
  { grey: .47, planes: [p => Math.abs(p.x) - (.112 + .017*Math.tanh((p.z-.06)*14)), p => .203 + .024 * (1.32-p.y)/.34 - Math.abs(p.x), p => p.y - .99, p => 1.405 - p.y] },
  { grey: .53, planes: [p => .823 - p.y] },
  { grey: .89, planes: [p => .098 - Math.abs(p.x), p => p.z - .045] },
];

function interpolate(a,b,t) {
  const v={};for(const key of Object.keys(a)) v[key]=a[key].map((x,i)=>x+(b[key][i]-x)*t);
  return v;
}
function split(poly, distance) {
  const inside=[],outside=[];
  for(let i=0;i<poly.length;i++) {
    const a=poly[i],b=poly[(i+1)%poly.length];
    const da=distance({x:a.world[0],y:a.world[1],z:a.world[2]}),db=distance({x:b.world[0],y:b.world[1],z:b.world[2]});
    (da>=0?inside:outside).push(a);
    if((da>=0)!==(db>=0)) {const v=interpolate(a,b,da/(da-db));inside.push(v);outside.push(v)}
  }
  return [inside,outside];
}

export function cleanMaterials(root,options={}) {
  const activeRegions=options.female?[
    // Bob follows the rear and sides down to the jaw; leave the front face blank.
    {grey:.47,planes:[p=>p.y-(1.54+.055*Math.tanh((p.z-.045)*16)-.04*Math.exp(-(((p.x-.045)/.045)**2))),p=>p.y-1.43]},
    {grey:.47,planes:[p=>p.y-(1.485-.10*THREE.MathUtils.smoothstep(Math.abs(p.x),.055,.10)),p=>p.y-1.42,p=>.015-p.z,p=>.15+.035*THREE.MathUtils.smoothstep(p.y,1.425,1.50)-Math.abs(p.x)]},
    {grey:.47,planes:[p=>p.y-1.42,p=>Math.abs(p.x)-.102,p=>.080-p.z,p=>.15+.035*THREE.MathUtils.smoothstep(p.y,1.425,1.50)-Math.abs(p.x)]},
    // Continuous shoulder bands also colour the underlying surface, so local
    // sleeve curvature cannot punch pale islands through a fitted ribbon.
    {grey:.47,planes:[p=>Math.abs(p.x)-.134,p=>.176-Math.abs(p.x),p=>p.y-.99,p=>1.300+4.1*p.x*p.x-p.y]},
    // Skin takes priority over ribbons at the curved neckline; otherwise a
    // rear connector paints a dark island inside the neck.
    regions[1],
    {grey:.66,planes:[p=>.155-Math.abs(p.x),p=>.035-p.z,p=>p.y-1.22]},
    {grey:.66,planes:[p=>.205-Math.abs(p.x),p=>-.025-p.z,p=>p.y-1.29]},
    {grey:.78,planes:[p=>Math.abs(p.x)-(.175+.026*THREE.MathUtils.smoothstep(p.y,.73,.838)),p=>.838-p.y,p=>p.y-.48]},
    ...regions.slice(1).filter((_,i)=>i!==6&&i!==7),
  ]:regions;
  root.updateMatrixWorld(true);
  root.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const geometry=mesh.geometry,attributes=geometry.attributes,vertices=[];
    const world=new THREE.Vector3(),local=new THREE.Vector3(),inverse=mesh.matrixWorld.clone().invert();
    for(let i=0;i<attributes.position.count;i++) {
      const v={};for(const [key,a] of Object.entries(attributes)) if(key!=='color')v[key]=Array.from(a.array.subarray(i*a.itemSize,(i+1)*a.itemSize));
      world.fromArray(v.position).applyMatrix4(mesh.matrixWorld);
      // Smooth the reconstructed collar ridges onto a rounded cross-section.
      // Continuous falloff avoids hard borders between modified vertices.
      const neckline=1.305+4.1*world.x*world.x;
      const collarWeight=1-THREE.MathUtils.smoothstep(Math.abs(world.y-neckline),.012,.075);
      const lateralWeight=1-THREE.MathUtils.smoothstep(Math.abs(world.x),.12,.20);
      const radius=Math.hypot(world.x/.155,(world.z-.045)/.105);
      if(radius>.1&&collarWeight*lateralWeight>0) {
        const weight=collarWeight*lateralWeight;
        world.x=THREE.MathUtils.lerp(world.x,world.x/radius,weight);
        world.z=THREE.MathUtils.lerp(world.z,.045+(world.z-.045)/radius,weight);
        local.copy(world).applyMatrix4(inverse);v.position=local.toArray();
      }
      // Fold the reconstructed corner tabs into one rounded backpack rim.
      if(!options.female&&world.y>1.215&&world.y<1.36&&world.z<-.075&&Math.abs(world.x)<.21) {
        const weight=THREE.MathUtils.smoothstep(world.y,1.215,1.245)*(1-THREE.MathUtils.smoothstep(Math.abs(world.x),.185,.21));
        const rim=1.265-.006*(world.x/.19)**2;
        world.y=THREE.MathUtils.lerp(world.y,Math.min(world.y,rim),weight);
        world.z=THREE.MathUtils.lerp(world.z,-.185,weight);
        local.copy(world).applyMatrix4(inverse);v.position=local.toArray();
      }
      v.world=world.toArray();vertices.push(v);
    }
    const output={};for(const key of Object.keys(vertices[0]))if(key!=='world')output[key]=[];output.color=[];
    const color=new THREE.Color();
    function emit(poly,grey) {
      if(grey===.43)return;
      color.setRGB(grey,grey,grey,THREE.SRGBColorSpace);
      for(let i=1;i<poly.length-1;i++)for(const v of [poly[0],poly[i],poly[i+1]]) {
        for(const key of Object.keys(output))if(key!=='color')output[key].push(...v[key]);
        output.color.push(color.r,color.g,color.b);
      }
    }
    const index=geometry.index?.array??Array.from({length:vertices.length},(_,i)=>i);
    for(let i=0;i<index.length;i+=3) {
      if(mesh.name.startsWith('Ankle continuity')){emit([vertices[index[i]],vertices[index[i+1]],vertices[index[i+2]]],.40);continue}
      let remaining=[[vertices[index[i]],vertices[index[i+1]],vertices[index[i+2]]]];
      for(const region of activeRegions) {
        const next=[];
        for(const poly of remaining) {
          let interior=poly;
          for(const plane of region.planes) {
            const [yes,no]=split(interior,plane);if(no.length>=3)next.push(no);interior=yes;
            if(interior.length<3)break;
          }
          if(interior.length>=3)emit(interior,region.grey);
        }
        remaining=next;if(!remaining.length)break;
      }
      for(const poly of remaining)emit(poly,.66);
    }
    const clean=new THREE.BufferGeometry();
    for(const [key,array] of Object.entries(output))clean.setAttribute(key,new THREE.Float32BufferAttribute(array,key==='color'?3:attributes[key].itemSize));
    mesh.geometry=mergeVertices(clean,1e-6);
    mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
  });
  // Replace the reconstructed bag panel, including its attachment tabs, with
  // one continuous rounded surface matching the original bag's envelope.
  const packGeometry=new RoundedBoxGeometry(.39,.445,.18,6,.065);
  const inverseRoot=root.matrixWorld.clone().invert();
  packGeometry.translate(0,1.075,-.165);packGeometry.applyMatrix4(inverseRoot);
  const packColor=new THREE.Color().setRGB(.43,.43,.43,THREE.SRGBColorSpace);
  const colors=new Float32Array(packGeometry.attributes.position.count*3);
  for(let i=0;i<colors.length;i+=3)colors.set([packColor.r,packColor.g,packColor.b],i);
  packGeometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  const pack=new THREE.Mesh(packGeometry,new THREE.MeshBasicMaterial({vertexColors:true}));
  pack.name='Clean backpack panel';root.add(pack);
}
