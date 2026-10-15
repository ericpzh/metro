// Serialized into the real viewer by check-model-outfits.mjs.
export async function captureOutfitOrbit(){
 const p=window.__modelPreview,T=p.camera.position.constructor,height=p.model.scale.y;
 const oldSize=p.renderer.getSize(new T()),ratio=p.renderer.getPixelRatio(),frustum=[p.camera.left,p.camera.right,p.camera.top,p.camera.bottom];
 const canvas=document.createElement('canvas');canvas.width=2880;canvas.height=1460;
 const c=canvas.getContext('2d');c.fillStyle='#eeefed';c.fillRect(0,0,canvas.width,canvas.height);c.fillStyle='#444';c.font='22px system-ui';c.fillText(document.querySelector('#outfit').selectedOptions[0].textContent,20,30);
 const probe=document.createElement('canvas');probe.width=180;probe.height=280;const pixels=probe.getContext('2d',{willReadFrequently:true});
 const skirt=p.model.getObjectByName('Long_skirt'),meshes=[];p.model.traverse(m=>{if(m.isMesh)meshes.push(m)});
 const visibility=meshes.map(m=>m.visible),leaks=[];
 const legMasks=[];
 if(skirt)for(const mesh of meshes){
  if(!mesh.isSkinnedMesh||!mesh.visible||mesh===skirt)continue;
  const a=mesh.geometry.attributes,index=mesh.geometry.index?.array??Array.from({length:a.position.count},(_,i)=>i),kept=[];
  const leg=i=>{for(let k=0;k<4;k++)if(a.skinWeight.array[i*4+k]>1e-5&&!/^(Hips|(Left|Right)(Thigh|Shin|Foot))$/.test(mesh.skeleton.bones[a.skinIndex.array[i*4+k]].name))return false;return true};
  for(let i=0;i<index.length;i+=3)if(leg(index[i])&&leg(index[i+1])&&leg(index[i+2]))kept.push(index[i],index[i+1],index[i+2]);
  if(!kept.length)continue;
  const mask=mesh.clone();mask.geometry=mesh.geometry.clone();mask.geometry.setIndex(kept);mask.visible=false;mask.frustumCulled=false;mesh.parent.add(mask);legMasks.push(mask);
 }
 const bottom=skirt?parseInt(p.model.userData.outfit.bottom.slice(1),16)&255:0;
 p.renderer.setPixelRatio(1);p.renderer.setSize(180,280,false);p.camera.left=-.68*height;p.camera.right=.68*height;p.camera.top=1.03*height;p.camera.bottom=-1.03*height;p.camera.zoom=1;p.camera.updateProjectionMatrix();p.state.walking=false;
 for(let pose=0;pose<5;pose++){
  if(pose===0)p.stand();else{p.mixer.stopAllAction();p.mixer.clipAction(p.clips[2]).play();p.state.standing=false;p.setTime((pose-1)*.28)}
  for(let angle=0;angle<16;angle++){
   const phi=(angle*22.5+11.25)*Math.PI/180;p.camera.position.set(5*Math.sin(phi),.86*height,5*Math.cos(phi));p.controls.target.set(0,.86*height,0);p.controls.update();p.renderer.render(p.scene,p.camera);
   const image=new Image();image.src=p.renderer.domElement.toDataURL();await image.decode();const x=angle*180,y=50+pose*280;c.drawImage(image,x,y,180,260);c.fillStyle='#444';c.font='12px system-ui';c.fillText((angle*22.5+11.25)+'° / '+(pose===0?document.querySelector('#stand').textContent:((pose-1)*.28).toFixed(2)+' s'),x+8,y+272);
   if(skirt){
    meshes.forEach(m=>m.visible=m===skirt);legMasks.forEach(m=>m.visible=true);p.renderer.render(p.scene,p.camera);pixels.clearRect(0,0,180,280);pixels.drawImage(p.renderer.domElement,0,0);const actual=pixels.getImageData(0,0,180,280).data;
    legMasks.forEach(m=>m.visible=false);p.renderer.render(p.scene,p.camera);pixels.clearRect(0,0,180,280);pixels.drawImage(p.renderer.domElement,0,0);const reference=pixels.getImageData(0,0,180,280).data;
    let count=0;const firstRow=Math.ceil((.86+1.03-.59)/2.06*280);
    for(let yy=firstRow;yy<280;yy++)for(let xx=0;xx<180;xx++){
     const i=(yy*180+xx)*4;
     if(reference[i+3]>250&&Math.abs(reference[i]-bottom)<=1&&Math.abs(actual[i]-199)<=1&&Math.abs(actual[i+1]-199)<=1&&Math.abs(actual[i+2]-199)<=1){count++;c.fillStyle='#d63232';c.fillRect(x+xx,y+yy*260/280,1,1)}
    }
    if(count)leaks.push({pose,angle:angle*22.5+11.25,pixels:count});
    meshes.forEach((m,i)=>m.visible=visibility[i]);
   }
  }
 }
 for(const mask of legMasks){mask.removeFromParent();mask.geometry.dispose()}
 p.renderer.setPixelRatio(ratio);p.renderer.setSize(oldSize.x,oldSize.y,false);[p.camera.left,p.camera.right,p.camera.top,p.camera.bottom]=frustum;p.camera.updateProjectionMatrix();
 return {image:canvas.toDataURL(),leaks};
}
