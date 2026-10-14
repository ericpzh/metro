// Leave room between the coat and the carrying arm for a thin side bag.
// Mesh metadata survives GLB export, so the viewer and atlas use the same pose.
export function applyPassengerCarryPose(scene,side) {
 const bones={};
 scene.traverse(n=>{
  if(n.isBone)bones[n.name]=n;
  const bag=n.visible&&n.userData.carriedBag;
  if(bag?.component==='body'&&bag.type!=='purse')side=bag.side;
 });
 if(!side)return;
 const prefix=side==='left'?'Left':'Right',sign=side==='left'?-1:1;
 bones[prefix+'Arm'].rotation.z+=sign*.16;
 bones[prefix+'Forearm'].rotation.z-=sign*.08;
 bones[prefix+'Arm'].rotation.x*=.28;
}
