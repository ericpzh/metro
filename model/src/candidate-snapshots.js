import * as THREE from 'three';

// Deterministic source renders: no replacement geometry or style modifications.
export function captureDirections(scene, height) {
 const canvas=document.createElement('canvas');
 canvas.width=canvas.height=2048;
 const context=canvas.getContext('2d');
 const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
 renderer.setSize(512,512);renderer.outputColorSpace=THREE.SRGBColorSpace;
 const camera=new THREE.OrthographicCamera(-height*.7,height*.7,height*.7,-height*.7,.01,20);
 const ground=scene.children.find(n=>n.userData.studyGround),visible=ground?.visible;
 if(ground)ground.visible=false;
 try {
  for(let index=0;index<16;index++) {
   const angle=index*Math.PI/8;
   camera.position.set(Math.sin(angle)*4,height*.5+1.3,Math.cos(angle)*4);
   camera.lookAt(0,height*.5,0);renderer.render(scene,camera);
   context.drawImage(renderer.domElement,index%4*512,Math.floor(index/4)*512);
  }
 } finally {renderer.dispose();if(ground)ground.visible=visible}
 return canvas;
}
