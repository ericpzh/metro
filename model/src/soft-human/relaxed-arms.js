import * as T from 'three';
import {solveLimb} from '../animation/interactions.js';

// Accepted escalator free arm, shared by idle and every station activity.
// Authored in the rig frame; equipment clearance must not reshape this pose.
export function relaxedArmTarget(c,{s,arm}){
 return c.body.localToWorld(c.body.worldToLocal(arm.getWorldPosition(new T.Vector3()))
  .add(new T.Vector3(s*.26,-.90,.06).multiplyScalar(c.metrics.armLength)));
}

export function relaxedArmBend(c,{s}){
 // Reflect the old elbow pole in side view about the shoulder-to-wrist line.
 // This reverses the bend without changing the wrist or either joint's width.
 const pole=new T.Vector3(s*.1,0,1).transformDirection(c.body.matrixWorld.clone().invert());
 const axis=new T.Vector3(0,-.90,.06).normalize(),side=new T.Vector3(0,pole.y,pole.z);
 const reflected=axis.multiplyScalar(2*side.dot(axis)).sub(side);
 pole.y=reflected.y;pole.z=reflected.z;
 return pole.transformDirection(c.body.matrixWorld);
}

export function poseRelaxedArm(c,limb,wrist){
 const target=relaxedArmTarget(c,limb);
 solveLimb(limb.arm,limb.fore,wrist,target,relaxedArmBend(c,limb));
}
