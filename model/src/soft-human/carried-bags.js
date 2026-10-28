import * as T from 'three';
import {softBagGeometry} from './bag-shell.js';
import {fittedStrap} from './strap-fit.js';
import {connectStrapToBag} from './bag-connectors.js';
import {shoulderStrapCurve} from './torso-fit.js';
import {mathematicalStrap} from './mathematical-strap.js';


// Adapted from characters/carried-bags.js: thin side panels in Y/Z,
// torso-owned shoulder/crossbody bags and hand-owned purses. Geometry is fitted
// for this soft rig instead of copying the reviewed model's bone coordinates.
export const CARRIED_BAGS=['shoulder','crossbody','handbag','purse'].flatMap(type=>['left','right'].map(side=>({id:`${type}-${side}`,type,side,label:({shoulder:'Shoulder bag / 单肩包',crossbody:'Crossbody / 斜挎包',handbag:'Handbag / 手提包',purse:'Small purse / 小手袋'})[type]+(side==='left'?' · Left / 左':' · Right / 右')})));
export function addSoftCarriedBag(c,source,id,outfit){
 const entry=CARRIED_BAGS.find(x=>x.id===id);if(!entry)throw Error('Unknown carried bag');const {type,side}=entry,s=side==='left'?-1:1,held=type==='handbag'||type==='purse',small=type==='purse';
 const group=new T.Group();group.name=`Carried-${id}`;group.userData.carriedBag={type,side,anchor:held?'Forearm':'Chest'};
 const material=color=>new T.MeshStandardMaterial({color,roughness:.87});const color=outfit.formal?'#654b3f':outfit.bag;
 function panel(name,size,pos,tone=color){const mesh=new T.Mesh(softBagGeometry(size),material(tone));mesh.name=name;mesh.position.set(...pos);mesh.castShadow=true;group.add(mesh);return mesh}
 const straps=[];
 if(held){
  const limb=c.limbs.find(x=>x.s===s),fore=limb.fore;fore.add(group);group.position.copy(limb.wrist??new T.Vector3(s*.21,-.295,.03));
  const h=small?.13:.18,depth=small?.16:.23;
  panel('Hand bag body',[.065,h,depth],[s*.025,-h/2-.10,0]);
  panel('Hand bag flap',[.012,h*.34,depth*.88],[s*.065,-.12,0],outfit.trim);
  // Two closed handles meet at the mitten's grip, then join the bag crown.
  for(const x of [-.022,.022]){
   const path=new T.CatmullRomCurve3([[x+s*.025,-.10,-depth*.34],[x,-.055,-depth*.25],[x,-.035,0],[x,-.055,depth*.25],[x+s*.025,-.10,depth*.34]].map(p=>new T.Vector3(...p)));
   const handle=new T.Mesh(new T.TubeGeometry(path,32,.007,6,false),material(color));handle.name='Hand bag handle';group.add(handle);
  }
  // The grip follows the mitten, while the suspended bag hangs down instead
  // of inheriting the forearm's bind-pose tilt into the thigh.
  group.userData.updateCarry=()=>{const rotation=new T.Quaternion();let b=fore;while(b&&b!==c.body){rotation.premultiply(b.quaternion);b=b.parent}group.quaternion.copy(rotation.invert());group.updateMatrixWorld(true)};
 }else{
  c.chest.add(group);group.position.set(s*.235,-.23,-.12);
  if(c.fitPoint)group.position.copy(c.fitPoint(new T.Vector3(s*.263,.75,-.04))).sub(c.chest.userData.rest);
  panel('Side bag body',[.060,.20,.18],[0,0,0]);panel('Side bag flap',[.012,.065,.16],[s*.037,.055,0],outfit.trim);
  const points=type==='crossbody'?
   [[s*.14,-.145,-.13],[s*.08,-.05,-.15],[-s*.08,.14,-.14],[-s*.12,.27,-.04],[-s*.12,.28,.025],[-s*.10,.18,.15],[0,.03,.16],[s*.12,-.12,.14],[s*.19,-.16,.02],[s*.18,-.15,-.10]]:
   [[s*.14,-.145,-.13],[s*.13,.06,-.15],[s*.12,.24,-.09],[s*.12,.28,.015],[s*.12,.19,.145],[s*.13,.03,.15],[s*.17,-.12,.12],[s*.19,-.16,.02],[s*.18,-.15,-.10]];
  const ends=[[0,.085,-.065],[0,.085,.065]],origin=c.chest.userData.rest.clone().add(group.position);
  const anchors=c.anatomy?{backAnchor:origin.clone().add(new T.Vector3(...ends[0])),frontAnchor:origin.clone().add(new T.Vector3(...ends[1]))}:{};
  const strap=c.anatomy?mathematicalStrap(c,shoulderStrapCurve(c,s,{crossbody:type==='crossbody',...anchors}),material(color),`Carried strap ${id}`,{width:type==='crossbody'?.024:.022}):fittedStrap(c,source,new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),material(color),`Carried strap ${id}`,{width:.038,surfaceWidth:true});
  connectStrapToBag(c,strap,group,ends);straps.push(strap);
 }
 c.carry={side:s,type};return {group,straps};
}



