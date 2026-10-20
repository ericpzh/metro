import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { PreviewMaterialCache } from '../src/render/previewMaterialCache.ts'

test('preview materials retain shader identity, preserve base ownership and separate refusal tints', () => {
  const base = new THREE.MeshStandardMaterial({color:0xabcdef,side:THREE.BackSide})
  const color = base.color.clone(), good = new THREE.Color(0x168cff), bad = new THREE.Color(0xff3030)
  const cache = new PreviewMaterialCache(2)
  const a = cache.get(base,good,0.72)
  assert.equal(cache.get(base,good,0.72),a)
  assert.notEqual(a,base)
  assert.equal(a.transparent,true);assert.equal(a.depthWrite,false);assert.equal(a.side,THREE.DoubleSide)
  assert.deepEqual(base.color,color)
  assert.equal(base.side,THREE.BackSide)
  base.clippingPlanes=[new THREE.Plane(new THREE.Vector3(1,0,0),2)]
  assert.equal(cache.get(base,good,0.72),a)
  assert.notEqual(a.clippingPlanes[0],base.clippingPlanes[0])
  assert.equal(a.clippingPlanes[0].constant,2,'retained materials follow the current clipping state')
  base.clippingPlanes=null
  cache.get(base,good,0.72)
  assert.equal(a.clippingPlanes,null)
  const b = cache.get(base,bad,0.72)
  assert.notEqual(a,b)
  assert.notDeepEqual(a.color,b.color)
  let releases=0,baseReleases=0
  a.addEventListener('dispose',()=>releases++)
  base.addEventListener('dispose',()=>baseReleases++)
  cache.get(base,bad,0.5)
  assert.equal(releases,1,'least recently used shader owner is released once')
  cache.dispose();cache.dispose()
  assert.equal(releases,1)
  assert.equal(baseReleases,0,'the scene still owns its base material')
  base.dispose()
})
