import * as THREE from 'three';

// Skin the approved surface in its existing standing pose; no replacement body.
export function createWalkRig(source,options={}) {
  source.updateMatrixWorld(true);
  const rig=new THREE.Group();rig.name='Passenger';
  const bones=[],named={};
  function bone(name,parent,position) {
    const b=new THREE.Bone();b.name=name;b.position.fromArray(position);bones.push(b);named[name]=b;(parent??rig).add(b);return b;
  }
  const hips=bone('Hips',null,[0,.85,0]);
  const spine=bone('Spine',hips,[0,.27,0]);
  const neck=bone('Neck',spine,[0,.26,0]);bone('Head',neck,[0,.15,0]);
  for(const [side,sign] of [['Left',-1],['Right',1]]) {
    const thigh=bone(side+'Thigh',hips,[sign*.115,-.035,.03]);
    const shin=bone(side+'Shin',thigh,[0,-.385,0]);bone(side+'Foot',shin,[0,-.305,.01]);
    const arm=bone(side+'Arm',spine,[sign*.205,.165,.03]);
    const forearm=bone(side+'Forearm',arm,[sign*.035,-.27,0]);bone(side+'Hand',forearm,[0,-.245,0]);
  }
  rig.updateMatrixWorld(true);
  const skeleton=new THREE.Skeleton(bones);skeleton.calculateInverses();
  const meshes=[];
  source.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const geometry=mesh.geometry.clone();geometry.applyMatrix4(mesh.matrixWorld);
    const p=geometry.attributes.position,colors=geometry.attributes.color;
    const indices=new Uint16Array(p.count*4),weights=new Float32Array(p.count*4);
    const point=new THREE.Vector3(),strapGrey=new THREE.Color().setRGB(.47,.47,.47,THREE.SRGBColorSpace).r;
    const pantsGrey=new THREE.Color().setRGB(.53,.53,.53,THREE.SRGBColorSpace).r;
    function legWeights(side){
      const thigh=side+'Thigh',shin=side+'Shin',foot=side+'Foot';
      if(options.female&&point.y>.80){const t=THREE.MathUtils.smoothstep(point.y,.80,.825);return [['Hips',t],[thigh,1-t]]}
      if(options.female&&point.y>.50)return [[thigh,1]];
      if(point.y>.75){const t=THREE.MathUtils.smoothstep(point.y,.75,.825);return [['Hips',t],[thigh,1-t]]}
      if(point.y>.50)return [[thigh,1]];
      if(point.y>.36){const t=THREE.MathUtils.smoothstep(point.y,.36,.50);return [[thigh,t],[shin,1-t]]}
      if(point.y>.17)return [[shin,1]];
      const t=THREE.MathUtils.smoothstep(point.y,.115,.17);return [[shin,t],[foot,1-t]];
    }
    for(let i=0;i<p.count;i++) {
      point.fromBufferAttribute(p,i);const side=point.x<0?'Left':'Right';
      let influences;
      const strap=colors&&Math.abs(colors.getX(i)-strapGrey)<.001;
      const pants=colors&&Math.abs(colors.getX(i)-pantsGrey)<.001;
      if(mesh.name.startsWith('Fingerless hand'))influences=[[side+'Hand',1]];
      else if(mesh.name.startsWith('Continuous strap'))influences=[['Spine',1]];
      else if(mesh.name.startsWith('Ankle continuity')){
        const t=THREE.MathUtils.smoothstep(point.y,.125,.18);
        influences=[[side+'Shin',t],[side+'Foot',1-t]];
      }
      else if(options.female&&pants&&point.y<.825)influences=legWeights(side);
      else if(options.female&&strap&&point.y>1.415)influences=[['Head',1]];
      else if(options.female&&Math.abs(point.x)>.13&&Math.abs(point.x)<.18&&point.y>.95&&point.y<1.415)influences=[['Spine',1]];
      else if(mesh.name==='Clean backpack panel'||(strap&&point.y<1.40&&point.y>.90))influences=[['Spine',1]];
      else if(Math.abs(point.x)>.15&&point.y<1.34&&point.y>.59) {
        const arm=side+'Arm',forearm=side+'Forearm',hand=side+'Hand';
        if(point.y>1.08)influences=[[arm,1]];
        else if(point.y>.94){const t=THREE.MathUtils.smoothstep(point.y,.94,1.08);influences=[[arm,t],[forearm,1-t]]}
        else if(point.y>.76)influences=[[forearm,1]];
        else {const t=THREE.MathUtils.smoothstep(point.y,.70,.76);influences=[[forearm,t],[hand,1-t]]}
        const strength=THREE.MathUtils.smoothstep(Math.abs(point.x),.15,.225)*(1-THREE.MathUtils.smoothstep(point.y,1.22,1.34));
        influences=influences.map(([name,weight])=>[name,weight*strength]);
        influences.push([point.y<.825?'Hips':'Spine',1-strength]);
      } else if(point.y<.825) {
        influences=legWeights(side);
      } else if(point.y>1.46)influences=[['Head',1]];
      else if(point.y>1.36)influences=[['Neck',1]];
      else if(point.y>.94)influences=[['Spine',1]];
      else {const t=THREE.MathUtils.smoothstep(point.y,.825,.94);influences=[['Hips',1-t],['Spine',t]]}
      influences.forEach(([name,weight],j)=>{indices[i*4+j]=bones.indexOf(named[name]);weights[i*4+j]=weight});
    }
    geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));
    geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
    const skinned=new THREE.SkinnedMesh(geometry,mesh.material);skinned.name=mesh.name||'Passenger surface';
    skinned.frustumCulled=false;rig.add(skinned);skinned.bind(skeleton,new THREE.Matrix4());meshes.push(skinned);
  });
  const binds={};for(const side of ['Left','Right'])binds[side]=named[side+'Foot'].matrixWorld.clone().invert();
  if(options.skinOnly)return {model:rig,skeleton,meshes};
  let strideBias=.30;
  function pose(time) {
    const phase=time/1.12*Math.PI*2;
    hips.position.set(0,.85,0);hips.rotation.set(0,.025*Math.sin(phase),.015*Math.sin(phase));
    spine.rotation.set(.025,-.035*Math.sin(phase),-.012*Math.sin(phase));
    neck.rotation.set(0,.018*Math.sin(phase),0);
    for(const [side,offset] of [['Left',0],['Right',Math.PI]]) {
      // Keep a soft stance knee and bias the compact stride in front of the
      // body, with the trailing heel calibrated to the backpack midline.
      const s=Math.sin(phase+offset),bend=.12+.46*Math.max(0,s),thigh=-strideBias-.22*s;
      // Legs point down (-Y): negative X swings toward +Z (forward),
      // while positive knee flexion folds the shin toward -Z (backward).
      named[side+'Thigh'].rotation.x=thigh;
      named[side+'Shin'].rotation.x=bend;
      named[side+'Foot'].rotation.x=-thigh-bend-.04*Math.max(0,s);
      named[side+'Arm'].rotation.x=.20*s;
      named[side+'Forearm'].rotation.x=-.10-.10*Math.max(0,s);
      named[side+'Hand'].rotation.x=-.04*s;
    }
    rig.updateMatrixWorld(true);
    let lowest=Infinity;
    for(const side of ['Left','Right'])for(const z of [-.025,.19]) {
      const v=new THREE.Vector3(side==='Left'?-.115:.115,.006,z);
      v.applyMatrix4(binds[side]).applyMatrix4(named[side+'Foot'].matrixWorld);lowest=Math.min(lowest,v.y);
    }
    hips.position.y-=lowest;rig.updateMatrixWorld(true);skeleton.update();
  }
  // Calibrate the furthest trailing heel against the actual backpack midline
  // surface, rather than approximating the requested line with a body bound.
  const body=meshes.find(m=>m.name!=='Clean backpack panel'),pack=meshes.find(m=>m.name==='Clean backpack panel');
  const shoeIndices={Left:[],Right:[]};
  const p=body.geometry.attributes.position;
  for(let i=0;i<p.count;i++)if(p.getY(i)<.145)shoeIndices[p.getX(i)<0?'Left':'Right'].push(i);
  function alignment(time,side) {
    pose(time);const v=new THREE.Vector3();let heel=Infinity,bagFront=-Infinity,bagBack=Infinity;
    for(const i of shoeIndices[side]){v.fromBufferAttribute(p,i);body.applyBoneTransform(i,v);heel=Math.min(heel,v.z)}
    const q=pack.geometry.attributes.position;
    for(let i=0;i<q.count;i++){v.fromBufferAttribute(q,i);pack.applyBoneTransform(i,v);bagFront=Math.max(bagFront,v.z);bagBack=Math.min(bagBack,v.z)}
    return heel-(bagFront+bagBack)/2;
  }
  let low=-.10,high=.40;
  for(let i=0;i<14;i++){
    strideBias=(low+high)/2;
    const delta=(alignment(.28,'Right')+alignment(.84,'Left'))/2;
    if(delta<0)low=strideBias;else high=strideBias;
  }
  strideBias=(low+high)/2;
  const frames=48,duration=1.12,times=[],rotations=bones.map(()=>[]),positions=[];
  for(let i=0;i<=frames;i++) {
    const t=duration*i/frames;times.push(t);pose(t);
    bones.forEach((b,j)=>rotations[j].push(...b.quaternion.toArray()));positions.push(...hips.position.toArray());
  }
  const tracks=bones.map((b,i)=>new THREE.QuaternionKeyframeTrack(b.name+'.quaternion',times,rotations[i]));
  tracks.push(new THREE.VectorKeyframeTrack('Hips.position',times,positions));
  const clip=new THREE.AnimationClip('Walk',duration,tracks);
  pose(0);const mixer=new THREE.AnimationMixer(rig),action=mixer.clipAction(clip);action.play();
  return {model:rig,clip,mixer,action,skeleton,meshes,setTime:t=>{mixer.setTime(t);rig.updateMatrixWorld(true);skeleton.update()}};
}
