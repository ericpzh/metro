import * as T from 'three';

// Bridge the fitted skin ribbon to the bag's actual anchor. Skin fitting must
// not project the bag anchor inward onto the torso and leave a disconnected end.
export function connectStrapToBag(c,strap,bag,ends=[[0,.085,-.09],[0,.085,.09]]){
 const rings=strap.geometry.attributes.position.count/4,links=[];
 for(const [index,row] of [0,rings-1].entries()){
  const g=new T.BufferGeometry(),positions=new Float32Array(4*13*3),indices=[];
  for(let i=0;i<12;i++)for(let k=0;k<4;k++){const a=i*4+k,b=i*4+(k+1)%4;indices.push(a,b,b+4,a,b+4,a+4)}indices.push(0,2,1,0,3,2,48,49,50,48,50,51);
  g.setAttribute('position',new T.BufferAttribute(positions,3));g.setIndex(indices);
  const link=new T.Mesh(g,strap.material.clone());link.name=`Bag strap connector ${index}`;link.castShadow=true;strap.add(link);
  const anchor=new T.Vector3(...ends[index]);link.userData.bagAnchor=anchor.toArray();link.userData.strapRow=row;links.push({link,row,anchor});
 }
 strap.updateConnections=()=>{
  const inverse=c.body.matrixWorld.clone().invert();
  for(const {link,row,anchor} of links){
   const ring=[0,1,2,3].map(k=>strap.getVertexPosition(row*4+k,new T.Vector3()));
   const center=ring.reduce((s,p)=>s.add(p),new T.Vector3()).multiplyScalar(.25);
   const target=bag.localToWorld(anchor.clone()).applyMatrix4(inverse);
   const across=ring[1].clone().sub(ring[0]).normalize().multiplyScalar(.0125);
   const thick=ring[3].clone().sub(ring[0]).normalize().multiplyScalar(.0035);
   const end=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>target.clone().addScaledVector(across,a).addScaledVector(thick,b));
   for(let i=0;i<=12;i++)for(let k=0;k<4;k++){const p=ring[k].clone().lerp(end[k],i/12);link.geometry.attributes.position.setXYZ(i*4+k,p.x,p.y,p.z)}
   link.geometry.attributes.position.needsUpdate=true;link.geometry.computeVertexNormals();link.geometry.computeBoundingSphere();
  }
 };
 return links.map(x=>x.link);
}
