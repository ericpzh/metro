import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {solveLimb} from '../src/animation/interactions.js';

test('limb contact preserves lengths and reaches reachable targets',()=>{
 const root=new THREE.Bone(),mid=new THREE.Bone(),end=new THREE.Bone();root.add(mid);mid.add(end);mid.position.y=-.3;end.position.y=-.25;
 const parent=new THREE.Group();parent.rotation.y=.6;parent.scale.setScalar(.8);parent.add(root);
 const target=new THREE.Vector3(.17,-.2,.15);solveLimb(root,mid,end,target,new THREE.Vector3(1,0,0));
 assert(end.getWorldPosition(new THREE.Vector3()).distanceTo(target)<1e-6);
 assert.equal(mid.position.length(),.3);assert.equal(end.position.length(),.25);
 solveLimb(root,mid,end,new THREE.Vector3(4,3,2),new THREE.Vector3(1,0,0));
 assert(root.matrixWorld.elements.every(Number.isFinite));assert(end.getWorldPosition(new THREE.Vector3()).length()<=.4401);
});
