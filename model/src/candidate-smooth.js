import * as THREE from 'three';

// Clean small source-mesh irregularities in the final 2D image. A local vote
// over the flat palette rounds the shapes without introducing shaded bands.
export function createCandidateSmoother(renderer){
 const target=new THREE.WebGLRenderTarget(1,1,{depthBuffer:true});
 target.texture.colorSpace=THREE.SRGBColorSpace;
 const size=new THREE.Vector2(),scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
 const uniforms={image:{value:target.texture},pixel:{value:new THREE.Vector2()},colours:{value:Array.from({length:5},()=>new THREE.Vector3())}};
 const material=new THREE.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,transparent:true,vertexShader:`varying vec2 uv0; void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}`,fragmentShader:`
  varying vec2 uv0; uniform sampler2D image; uniform vec2 pixel; uniform vec3 colours[5];
  void main(){
   float scores[5]; for(int i=0;i<5;i++)scores[i]=0.; float coverage=0.;
   for(int y=-2;y<=2;y++)for(int x=-2;x<=2;x++){
    float w=exp(-float(x*x+y*y)*.19); vec4 p=texture2D(image,uv0+vec2(float(x),float(y))*pixel*1.25);
    float best=1e9; int index=0;
    for(int i=0;i<5;i++){float d=dot(p.rgb-colours[i],p.rgb-colours[i]);if(d<best){best=d;index=i;}}
    scores[index]+=w*p.a; coverage+=w*p.a;
   }
   int first=0,second=1; if(scores[1]>scores[0]){first=1;second=0;}
   for(int i=2;i<5;i++){if(scores[i]>scores[first]){second=first;first=i;}else if(scores[i]>scores[second])second=i;}
   float blend=.5*(1.-smoothstep(0.,1.2,scores[first]-scores[second]));
   float alpha=smoothstep(5.0,6.4,coverage);
   gl_FragColor=vec4(mix(colours[first],colours[second],blend),alpha);
   #include <colorspace_fragment>
  }`});
 const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);scene.add(quad);
 return {render(source,view,palette){
  renderer.getDrawingBufferSize(size);if(target.width!==size.x||target.height!==size.y){target.setSize(size.x,size.y);uniforms.pixel.value.set(1/size.x,1/size.y)}
  [palette.skin,palette.hair,palette.top,palette.bottom,palette.shoe].forEach((value,i)=>uniforms.colours.value[i].set(value,value,value));
  renderer.setRenderTarget(target);renderer.clear();renderer.render(source,view);renderer.setRenderTarget(null);renderer.clear();renderer.render(scene,camera);
 },dispose(){target.dispose();quad.geometry.dispose();material.dispose()}};
}
