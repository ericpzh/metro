import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { EquipmentBatches } from '../src/render/equipmentBatches.ts'
import { ModuleSystem } from '../src/render/scene/systems/ModuleSystem.ts'
import { LevelSystem } from '../src/render/scene/systems/LevelSystem.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'
import { readFileSync } from 'node:fs'

function fixture() {
  const ctx = new SceneContextData(new THREE.Scene(), {}, {}, {})
  ctx.activeZ = 0
  const modules = new ModuleSystem(ctx), level = new LevelSystem(ctx)
  level.modules = modules
  level.chunks = {levelGroups:new Map(),outlineSet:new Set()}
  level.trains = {trainGroup:new THREE.Group()}
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial()
  for (const z of [0,4,8,12]) for(let i=0;i<256;i++) {
    const root = new THREE.Group()
    root.userData = {moduleId:`${z}:${i}`,moduleType:'bench',levelZs:[z]}
    root.position.set(i%16,Math.floor(i/16),z)
    root.add(new THREE.Mesh(geometry,material)); modules.moduleMeshes.add(root)
  }
  const dispose = () => {
    modules.batches.clear(); geometry.dispose(); material.dispose()
    for (const m of ctx.dimMats.values()) m.dispose()
  }
  return {ctx,modules,level,geometry,material,dispose}
}

test('1,024 modules: prepared Q/E views restore exact GPU allocations without traversing source geometry', () => {
  const f=fixture(), {level,modules}=f
  try {
    level.prepareViews([4,0])
    const original=modules.batches.root.children.slice()
    let walks=0, atlasResolves=0
    const update=modules.moduleMeshes.updateWorldMatrix.bind(modules.moduleMeshes)
    modules.moduleMeshes.updateWorldMatrix=(...a)=>{walks++; return update(...a)}
    const resolve=modules.batches.atlas.resolve.bind(modules.batches.atlas)
    modules.batches.atlas.resolve=(...a)=>{atlasResolves++; return resolve(...a)}
    level.setLevel(4,true); level.setLevel(0,true)
    assert.deepEqual(modules.batches.root.children,original)
    assert.equal(walks,0,'cached switches never walk world matrices')
    assert.equal(atlasResolves,0,'cached switches never inspect/rebake source surfaces')
    assert.ok(original.every(m=>m.visible))
    modules.setMovingModule('0:255')
    assert.ok(original.some(m=>!m.visible),'moving a cached source still masks its combined draw')
    modules.setMovingModule(null)
    assert.ok(original.every(m=>m.visible))
    modules.moduleMeshes.children[0].position.x=20
    modules.syncBatches()
    assert.ok(walks>0,'source transform changes invalidate dormant views')
    assert.equal(modules.batches.views.size,1)
    f.ctx.hideGround=true; modules.syncBatches()
    assert.equal(modules.batches.views.size,1,'global appearance changes invalidate dormant views')
  } finally {f.dispose()}
})

test('prepared level cache retains at most four views, disposes evicted resources once and releases all on invalidation', () => {
  const f=fixture(), {level,modules,material}=f
  const disposed=new Map(), watched=new Set()
  const watch=()=>{for(const entry of modules.batches.owned) if(!watched.has(entry.mesh)) {
    watched.add(entry.mesh); disposed.set(entry.mesh,0)
    entry.mesh.geometry.addEventListener('dispose',()=>disposed.set(entry.mesh,disposed.get(entry.mesh)+1))
  }}
  try {
    level.setLevel(0,true); watch()
    const active=modules.batches.root.children.find(m=>m.material===material)
    for(const z of [4,8,12,16]) {level.setLevel(z,true);watch()}
    assert.equal(modules.batches.views.size,4)
    assert.equal(disposed.get(active),1,'the oldest active-level geometry is evicted')
    modules.batches.invalidateViews()
    assert.equal(modules.batches.views.size,0)
    assert.equal(modules.batches.owned.size,modules.batches.root.children.length,'invalidation releases every dormant allocation')
    modules.batches.clear()
    assert.ok([...disposed.values()].every(count=>count===1),'eviction, invalidation and teardown dispose each allocation exactly once')
  } finally {f.dispose()}
})

test('clipping and explicit generations cannot return stale cached material batches', () => {
  const f=fixture()
  try {
    f.level.prepareViews([4,0])
    f.level.setClip(new THREE.Plane(new THREE.Vector3(1,0,0),0))
    assert.equal(f.modules.batches.views.size,1,'new plane membership clears prepared slices')
    f.ctx.cutaway=true; f.ctx.levelKey=''; f.level.applyLevel()
    assert.equal(f.modules.batches.views.size,0,'moving cuts never cache stale clipping material state')
    const batches=new EquipmentBatches(), source=new THREE.Group()
    batches.sync(source,'same','first')
    batches.sync(source,'same','second')
    assert.equal(batches.generation,'second','generation changes are checked before the revision shortcut')
    batches.clear()
  } finally {f.dispose()}
})

test('opening prewarm restores the active slice on failure and runs once per document with an offscreen target', () => {
  const f=fixture()
  try {
    assert.throws(()=>f.level.prepareViews([4],()=>{throw Error('upload failed')}),/upload failed/)
    assert.equal(f.ctx.activeZ,0,'temporary prewarm levels never become editing state')
    assert.equal(f.ctx.levelKey.split('|')[0],'0')
    const viewport=readFileSync(new URL('../src/app/Viewport.tsx',import.meta.url),'utf8')
    assert.match(viewport,/if \(!framedRef.current \|\| switched\)\s*\{[^}]*scene.prepareBuildViews\(\)/)
    const renderer=readFileSync(new URL('../src/render/scene/SceneRenderer.ts',import.meta.url),'utf8')
    const artwork=renderer.slice(renderer.indexOf('let artChanged ='),renderer.indexOf('// Light rig:'))
    assert.match(artwork,/Promise.all\(/)
    assert.equal((artwork.match(/this.modules.buildModules\(/g)??[]).length,1,'asset completion causes one model rebuild')
    assert.match(artwork,/pending === this.ctx.stationData/,'an older opening cannot prewarm a replaced document')
    const prewarm=renderer.slice(renderer.indexOf('prepareBuildViews('),renderer.indexOf('setAutoCeiling('))
    assert.match(prewarm,/new THREE.WebGLRenderTarget\(1, 1\)/)
    assert.match(prewarm,/if \(!this.artReady\)/,'prewarming waits until final artwork models exist')
    assert.match(prewarm,/finally\s*\{\s*this.renderer.setRenderTarget\(previous\)\s*target.dispose\(\)/)
  } finally {f.dispose()}
})
