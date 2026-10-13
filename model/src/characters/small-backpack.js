import * as THREE from 'three';
import {coatBackZ} from './female.js';

// A closed daypack: narrow rounded crown, fuller lower body, shallow side view.
// Ring heights round both ends without a box lid or an added pocket silhouette.
export function smallBackpackGeometry(skeleton){
 const positions=[],indices=[],rows=48,segments=64;
 const spine=skeleton.bones.findIndex(b=>b.name==='Spine');
 for(let row=0;row<=rows;row++)for(let j=0;j<=segments;j++){
  const theta=row/rows*Math.PI,phi=j/segments*Math.PI*2;
  const y=1.08+.2125*Math.cos(theta),lower=(1-Math.cos(theta))/2;
  const round=Math.sin(theta)**.65,width=.158*round*(.64+.36*THREE.MathUtils.smoothstep(lower,.15,.7));
  const depth=.132*round*(.62+.38*THREE.MathUtils.smoothstep(lower,.15,.65));
  // Bury the closed front slightly in the coat rather than leaving a side slit.
  const front=coatBackZ(y)+.010,cos=Math.cos(phi),sin=Math.sin(phi);
  positions.push(width*Math.sign(sin)*Math.abs(sin)**.75,y,front-depth/2+depth/2*Math.sign(cos)*Math.abs(cos)**.75);
 }
 for(let row=0;row<rows;row++)for(let j=0;j<segments;j++){
  const a=row*(segments+1)+j,b=a+1,c=a+segments+1,d=c+1;
  indices.push(a,c,b,b,c,d);
 }
 const geometry=new THREE.BufferGeometry(),count=positions.length/3;
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
 const skinIndices=new Uint16Array(count*4),weights=new Float32Array(count*4);
 for(let i=0;i<count;i++){skinIndices[i*4]=spine;weights[i*4]=1}
 const grey=new THREE.Color().setRGB(.43,.43,.43,THREE.SRGBColorSpace).r;
 geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(count*3).fill(grey),3));
 geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skinIndices,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
 return geometry;
}
