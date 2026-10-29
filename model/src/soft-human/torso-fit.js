import * as T from 'three';

// Find the narrow neck section above the shoulder fan, rather than carrying
// collar heights over from a different body. All measurements are in bind space.
export function measureSoftTorso(geometry,head,arms){
 const p=geometry.attributes.position,index=geometry.index,count=index?.count??p.count;
 let neck;
 for(let y=head.y+.025;y<head.y+.095;y+=.002){
  const points=[];
  for(let i=0;i<count;i+=3)for(let j=0;j<3;j++){
   const a=index?index.getX(i+j):i+j,b=index?index.getX(i+(j+1)%3):i+(j+1)%3;
   const da=p.getY(a)-y,db=p.getY(b)-y;if(da*db>=0)continue;
   const t=da/(da-db);points.push(new T.Vector3(T.MathUtils.lerp(p.getX(a),p.getX(b),t),y,T.MathUtils.lerp(p.getZ(a),p.getZ(b),t)));
  }
  if(!points.length)continue;
  const box=new T.Box3().setFromPoints(points),size=box.getSize(new T.Vector3()),area=size.x*size.z;
  if(!neck||area<neck.area)neck={area,y,center:box.getCenter(new T.Vector3()),radiusX:size.x/2,radiusZ:size.z/2};
 }
 if(!neck)throw Error('Cannot identify the selected base neck');
 const necklineY=neck.y-.006;
 const shoulderX=Math.abs(arms[1].x)*.79;
 return {neck,necklineY,shoulderX,centerZ:head.z,neckline:p=>p[1]-necklineY};
}

// Authored mathematical dimensions of the selected 1.7 m body. These are a
// smooth torso envelope, not sampled render triangles or a per-frame fit.
export const STRAP_TORSO={shoulderY:1.10,shoulderRise:.105,shoulderFrontDepth:.140,shoulderBackDepth:.110,centerZ:-.075,returnY:.855,returnWidth:.249,returnDepth:.180,returnCenterZ:-.026,exponent:2.7};

class TorsoArc extends T.Curve{
 constructor(side,from,to){super();this.side=side;this.from=from;this.to=to}
 getPoint(t,target=new T.Vector3()){
  const q=STRAP_TORSO,angle=T.MathUtils.lerp(this.from,this.to,t);
  // Elliptic rib wrap. Its height is exactly constant and its curvature is
  // continuous, including at the side of the body and the lower bag anchor.
  const power=v=>Math.sign(v)*Math.abs(v)**(2/q.exponent);
  return target.set(this.side*q.returnWidth*power(Math.sin(angle)),q.returnY,q.returnCenterZ+q.returnDepth*power(Math.cos(angle)));
 }
}
class TorsoDiagonal extends T.Curve{
 constructor(a,b,c,d,front){super();this.guide=new T.CubicBezierCurve3(a,b,c,d);this.front=front}
 getPoint(t,target=new T.Vector3()){
  this.guide.getPoint(t,target);
  const y=target.y,low=1-T.MathUtils.smoothstep(y,.70,.98),rx=.218+.077*low,cz=-.01-.04*T.MathUtils.smoothstep(y,.70,1.10);
  // Reserve clearance for the weighted belly moving independently of Chest.
  // This is one smooth authored envelope, shared by both strap edges and ages.
  const front=.140+.105*low-.035*T.MathUtils.smoothstep(y,.98,1.10),back=-.205-.005*T.MathUtils.smoothstep(y,.94,1.10);
  const profile=Math.max(0,1-Math.min(1,Math.abs(target.x)/rx)**3.5)**(1/3.5);
  const z=this.front?cz+(front-cz)*profile+.004:cz-(cz-back)*profile-.004;
  const blend=T.MathUtils.smoothstep(t,0,.25)*(1-T.MathUtils.smoothstep(t,.60,.85));target.z=T.MathUtils.lerp(target.z,z,blend);return target;
 }
}
export function shoulderStrapCurve(c,side,{crossbody=false,backpack=false,upper=null,backAnchor=null,frontAnchor=null}={}){
 const q=STRAP_TORSO,x=c.anatomy.shoulderX,s=side,topSide=crossbody?-s:s,k=.5522847498307936;
 const B=new T.Vector3(topSide*x,q.shoulderY,q.centerZ-q.shoulderBackDepth),C=new T.Vector3(topSide*x,q.shoulderY+q.shoulderRise,q.centerZ),F=new T.Vector3(topSide*x,q.shoulderY,q.centerZ+q.shoulderFrontDepth);
 const path=new T.CurvePath(),add=(a,b,c,d)=>path.add(new T.CubicBezierCurve3(a,b,c,d)),v=(x,y,z)=>new T.Vector3(x,y,z);
 if(backpack){
  const start=upper??v(s*.085,1.040,-.23);
  add(start,start.clone().add(v(s*.030,0,0)),B.clone().add(v(0,-.035,0)),B);
 }else{
  const start=backAnchor??v(s*.320,.709,-.113);
  add(start,v(s*(crossbody?.12:.19),.80,-.27),B.clone().add(v(0,-.10,0)),B);
 }
 // Two exact quarter-ellipse Beziers make the shoulder crown with matching
 // tangents, so a ribbon can never kink where it changes from back to front.
 add(B,B.clone().add(v(0,k*q.shoulderRise,0)),C.clone().add(v(0,0,-k*q.shoulderBackDepth)),C);
 add(C,C.clone().add(v(0,0,k*q.shoulderFrontDepth)),F.clone().add(v(0,k*q.shoulderRise,0)),F);
 if(backpack){
  const from=Math.asin((.21/q.returnWidth)**(q.exponent/2)),to=Math.PI-Math.asin((.085/q.returnWidth)**(q.exponent/2)),arc=new TorsoArc(s,from,to),end=arc.getPoint(0),tangent=arc.getTangent(0);
  add(F,F.clone().add(v(0,-.105,0)),end.clone().addScaledVector(tangent,-.065),end);path.add(arc);
 }else{
  const end=frontAnchor??v(s*.320,.709,.017);
  path.add(new TorsoDiagonal(F,F.clone().add(v(0,-.10,0)),v(s*(crossbody?.15:.19),.79,crossbody?.35:.32),end,true));
 }
 return path;
}

export function strapNormal(point){
 const q=STRAP_TORSO;
 if(point.y>=q.shoulderY)return new T.Vector3(0,(point.y-q.shoulderY)/q.shoulderRise,(point.z-q.centerZ)/(point.z>q.centerZ?q.shoulderFrontDepth:q.shoulderBackDepth)).normalize();
 const normal=new T.Vector3(point.x/(q.returnWidth*q.returnWidth),0,(point.z-q.returnCenterZ)/(q.returnDepth*q.returnDepth)).normalize();
 // Near the shoulder the band lies across X; lower down it follows the ribs.
 const crownNormal=new T.Vector3(0,0,point.z<q.centerZ?-1:1);
 return normal.lerp(crownNormal,T.MathUtils.smoothstep(point.y,1.00,q.shoulderY)).normalize();
}
