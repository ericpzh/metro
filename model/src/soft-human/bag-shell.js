import * as T from 'three';

// Soft-human luggage is authored as a tapered fabric envelope. The crown is
// narrower than the base, with rounded gussets instead of the old hard boxes.
export function softBagGeometry(size){
 const g=new T.SphereGeometry(1,48,32),p=g.attributes.position;
 const round=v=>Math.sign(v)*Math.pow(Math.abs(v),.38);
 for(let i=0;i<p.count;i++){
  const y=round(p.getY(i)),taper=1-.11*(y+1)/2;
  p.setXYZ(i,round(p.getX(i))*size[0]/2*taper,y*size[1]/2,round(p.getZ(i))*size[2]/2);
 }
 g.computeVertexNormals();g.computeBoundingBox();return g;
}
