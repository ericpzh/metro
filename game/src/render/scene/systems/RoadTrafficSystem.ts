import { ROAD_TRAFFIC_CAPACITY, ROAD_STEP } from '../../../sim/constants.ts'
import * as THREE from 'three'
import { getRoadNetwork, roadEdgePoint, roadSignal } from '../../../sim/roadNetwork.ts'
import { RoadTraffic } from '../../../sim/roadTraffic.ts'
import { roadVehicleDrawParts, roadVehicleVariant, ROAD_VEHICLE_VARIANTS } from '../../models/pieces/RoadVehicleModel.ts'
import type { RoadVehicleDetail, RoadVehicleVariant } from '../../models/pieces/RoadVehicleModel.ts'
import type { Module } from '../../../sim/types.ts'
import { SceneSystem } from './SceneSystem.ts'

const CAPACITY = ROAD_TRAFFIC_CAPACITY
/** Ambient traffic uses the simulation clock, with bounded instance buffers and no document edits. */
export class RoadTrafficSystem extends SceneSystem {
  private root = new THREE.Group()
  private meshes = new Map<RoadVehicleVariant, Record<RoadVehicleDetail, THREE.InstancedMesh[]>>()
  private from = 0
  private to = 0
  private have = false
  private pose = new THREE.Object3D()
  private roads: Module[] | null = null
  private traffic: RoadTraffic | null = null
  private signalMats = [new THREE.MeshBasicMaterial({color:0xff3535}),new THREE.MeshBasicMaterial({color:0xffbd35}),new THREE.MeshBasicMaterial({color:0x40e58a})]
  private unlit = new THREE.MeshBasicMaterial({color:0x202522})
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
    const network=getRoadNetwork(data.modules)
    if(!this.traffic || this.traffic.network!==network || this.traffic.seed!==data.seed) this.traffic=new RoadTraffic(network,data.seed)
    if (!network.roads.length) { this.root.visible = false; return }
    this.root.visible = !this.ctx.hideGround
    if (!this.meshes.size) for (const kind of ROAD_VEHICLE_VARIANTS) {
      const details = {} as Record<RoadVehicleDetail, THREE.InstancedMesh[]>
      for (const detail of ['high', 'low'] as const) {
        details[detail] = roadVehicleDrawParts(kind, detail).map(({ geometry, material }) => {
          const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY)
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
          mesh.frustumCulled = false
          mesh.userData.vehicleVariant = kind
          mesh.userData.vehicleDetail = detail
          mesh.renderOrder = material.colorWrite ? 0 : -1
          mesh.visible = (this.ctx.graphicsQuality ?? 'high') === detail
          this.root.add(mesh)
          return mesh
        })
      }
      this.meshes.set(kind, details)
    }
    const detail: RoadVehicleDetail = this.ctx.graphicsQuality === 'low' ? 'low' : 'high'
    for (const models of this.meshes.values()) for (const quality of ['high', 'low'] as const) for (const mesh of models[quality]) {
      mesh.visible = quality === detail
      const mat = mesh.material as THREE.Material
      if (!!mat.clippingPlanes?.length !== !!clip) { mat.clippingPlanes = clip ? [clip] : []; mat.needsUpdate = true }
    }
    for(const mat of [...this.signalMats,this.unlit]) if(!!mat.clippingPlanes?.length!==!!clip) {
      mat.clippingPlanes=clip?[clip]:[];mat.needsUpdate=true
    }
    const alpha = Math.min(1, Math.max(0, (now - this.ctx.lastStateTime) / this.ctx.stateIntervalMs))
    const time = this.from + (this.to - this.from) * alpha
    // Once interpolation settles, paused views require no further buffer uploads.
    const key = `${data.seed}|${time}|${this.ctx.activeZ}|${this.ctx.ghost}|${this.ctx.hideGround}|${this.ctx.cutaway}|${detail}`
    const visible = new Set(moduleRoots.children.filter(g => g.visible).map(g => g.userData.moduleId))
    const visibility = moduleRoots.children.filter(g=>g.visible).map(g=>g.uuid).join('|')
    if (this.roads === data.modules && this.root.userData.key === key && this.root.userData.visibility === visibility) return
    this.roads = data.modules; this.root.userData.key = key; this.root.userData.visibility = visibility
    const counts = new Map<RoadVehicleVariant, number>()
    this.traffic.advance(time)
    for(const root of moduleRoots.children) for(const signal of root.userData.roadSignals??[]) {
      const phase=roadSignal(signal.junction,signal.axis,time),active=phase==='red'?0:phase==='amber'?1:2
      signal.lenses.forEach((lens:THREE.Mesh,i:number)=>{lens.material=i===active?this.signalMats[i]:this.unlit})
    }
    for(const c of this.traffic.cars) {
      const fraction=Math.min(1,Math.max(0,(time-this.traffic.time)/ROAD_STEP))
      const previous=network.edges[c.previousEdge]
      let edge=c.edge,distance=c.distance
      if(c.previousEdge===c.edge) distance=c.previousDistance+(c.distance-c.previousDistance)*fraction
      else {
        const travelled=(previous.length-c.previousDistance+c.distance)*fraction
        if(c.previousDistance+travelled<previous.length) {edge=c.previousEdge;distance=c.previousDistance+travelled}
        else distance=c.previousDistance+travelled-previous.length
      }
      const e=network.edges[edge]
      if(!visible.has(e.road.id)) continue
      const t=Math.max(0,Math.min(1,distance/e.length)),[x,y]=roadEdgePoint(e,t)
      const dx=e.control?2*((1-t)*(e.control[0]-e.start[0])+t*(e.end[0]-e.control[0])):e.end[0]-e.start[0]
      const dy=e.control?2*((1-t)*(e.control[1]-e.start[1])+t*(e.end[1]-e.control[1])):e.end[1]-e.start[1]
      this.pose.position.set(x,y,e.road.z+1.05)
      this.pose.rotation.set(0,0,Math.atan2(-dx,dy));this.pose.updateMatrix()
      const variant = roadVehicleVariant(c.kind, c.id, data.seed)
      const index=counts.get(variant)??0
      for(const mesh of this.meshes.get(variant)![detail]) mesh.setMatrixAt(index,this.pose.matrix)
      counts.set(variant,index+1)
    }
    for (const [kind, models] of this.meshes) for (const quality of ['high', 'low'] as const) for (const mesh of models[quality]) {
      mesh.count = quality === detail ? counts.get(kind) ?? 0 : 0
      if (quality === detail) mesh.instanceMatrix.needsUpdate = true
    }
  }
  dispose(): void {
    for (const models of this.meshes.values()) for (const quality of ['high', 'low'] as const) for (const mesh of models[quality]) {
      mesh.dispose(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose()
    }
    this.meshes.clear(); this.root.removeFromParent()
    for(const m of this.signalMats) m.dispose()
    this.unlit.dispose()
  }
}
