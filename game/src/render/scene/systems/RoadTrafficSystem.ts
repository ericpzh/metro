import { ROAD_TRAFFIC_CAPACITY, ROAD_TRAFFIC_SPACING } from '../../../sim/constants.ts'
import * as THREE from 'three'
import { roadLayout, roadPoint, roadTrafficPose } from '../../../sim/roads.ts'
import { roadVehicleParts } from '../../models/pieces/RoadVehicleModel.ts'
import type { RoadVehicleKind } from '../../models/pieces/RoadVehicleModel.ts'
import type { Module } from '../../../sim/types.ts'
import { SceneSystem } from './SceneSystem.ts'

const CAPACITY = ROAD_TRAFFIC_CAPACITY
/** Ambient traffic uses the simulation clock, with bounded instance buffers and no document edits. */
export class RoadTrafficSystem extends SceneSystem {
  private root = new THREE.Group()
  private meshes = new Map<RoadVehicleKind, THREE.InstancedMesh[]>()
  private from = 0
  private to = 0
  private have = false
  private pose = new THREE.Object3D()
  private roads: Module[] | null = null
  constructor(...args: ConstructorParameters<typeof SceneSystem>) {
    super(...args)
    this.ctx.scene.add(this.root)
  }
  setSimTime(time: number): void {
    this.from = this.have && time >= this.to && time - this.to <= 60 ? this.to : time
    this.to = time; this.have = true
  }
  update(now: number, moduleRoots: THREE.Group, clip: THREE.Plane | null = null): void {
    const data = this.ctx.stationData
    if (!data) return
    const roads = data.modules.filter(m => m.type === 'road')
    if (!roads.length) { this.root.visible = false; return }
    this.root.visible = true
    if (!this.meshes.size) for (const kind of ['car', 'bus', 'bike', 'scooter'] as const) {
      this.meshes.set(kind, roadVehicleParts(kind).map(({ geometry, material }) => {
        const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY)
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        mesh.frustumCulled = false
        this.root.add(mesh)
        return mesh
      }))
    }
    for (const meshes of this.meshes.values()) for (const mesh of meshes) {
      const mat = mesh.material as THREE.Material
      if (!!mat.clippingPlanes?.length !== !!clip) { mat.clippingPlanes = clip ? [clip] : []; mat.needsUpdate = true }
    }
    const alpha = Math.min(1, Math.max(0, (now - this.ctx.lastStateTime) / this.ctx.stateIntervalMs))
    const time = this.from + (this.to - this.from) * alpha
    // Once interpolation settles, paused views require no further buffer uploads.
    const key = `${time}|${this.ctx.activeZ}|${this.ctx.ghost}|${this.ctx.hideGround}|${this.ctx.cutaway}`
    const visible = new Set(moduleRoots.children.filter(g => g.visible).map(g => g.userData.moduleId))
    const visibility = [...visible].join('|')
    if (this.roads === data.modules && this.root.userData.key === key && this.root.userData.visibility === visibility) return
    this.roads = data.modules; this.root.userData.key = key; this.root.userData.visibility = visibility
    const counts = new Map<RoadVehicleKind, number>()
    let total = 0
    for (const r of roads) {
      if (r.type !== 'road' || !visible.has(r.id)) continue
      const { lanes, length } = roadLayout(r)
      for (let lane = 0; lane < lanes && total < CAPACITY; lane++) for (let slot = 0; slot < Math.max(1, Math.floor(length / ROAD_TRAFFIC_SPACING)) && total < CAPACITY; slot++) {
        const p = roadTrafficPose(r, lane, slot, time, data.seed)
        if (!p.spawn || !p.visible) continue
        const [x, y] = roadPoint(r, p.across, p.along)
        this.pose.position.set(x, y, r.z + 1.05)
        this.pose.rotation.set(0, 0, ((r.rot ?? 0) % 2 ? -Math.PI / 2 : 0) + (p.sign < 0 ? Math.PI : 0))
        this.pose.updateMatrix()
        const index = counts.get(p.kind) ?? 0
        for (const mesh of this.meshes.get(p.kind)!) mesh.setMatrixAt(index, this.pose.matrix)
        counts.set(p.kind, index + 1); total++
      }
    }
    for (const [kind, meshes] of this.meshes) for (const mesh of meshes) {
      mesh.count = counts.get(kind) ?? 0
      mesh.instanceMatrix.needsUpdate = true
    }
  }
  dispose(): void {
    for (const meshes of this.meshes.values()) for (const mesh of meshes) {
      mesh.dispose(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose()
    }
    this.meshes.clear(); this.root.removeFromParent()
  }
}
