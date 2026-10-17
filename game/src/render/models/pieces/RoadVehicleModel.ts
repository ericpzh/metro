import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { roadHash } from '../../../sim/roads.ts'
import { VehicleKit } from './vehicles/VehicleKit.ts'
import { buildRoadCar } from './vehicles/RoadCar.ts'
import { buildRoadBus } from './vehicles/RoadBus.ts'
import { buildRoadCycle } from './vehicles/RoadCycle.ts'

export type RoadVehicleKind = 'car' | 'bus' | 'bike' | 'scooter'
export const ROAD_VEHICLE_VARIANTS = ['suv', 'sedan', 'bus-orange', 'bus-mosaic', 'moped', 'bicycle'] as const
export type RoadVehicleVariant = typeof ROAD_VEHICLE_VARIANTS[number]
export type RoadVehicleDetail = 'low' | 'high'

/** Appearance is stable across frames/seeks and never consumes the traffic RNG (§4.1). */
export function roadVehicleVariant(kind: RoadVehicleKind, id: number, seed: number): RoadVehicleVariant {
  const alternate = roadHash(`${seed}:vehicle:${id}`) % 2 === 1
  if (kind === 'car') return alternate ? 'sedan' : 'suv'
  if (kind === 'bus') return alternate ? 'bus-mosaic' : 'bus-orange'
  return kind === 'bike' || alternate ? 'bicycle' : 'moped'
}

/** Procedural models face +Y, Z up. Colour bins remain bounded instanced draws. */
export function roadVehicleParts(kind: RoadVehicleKind | RoadVehicleVariant, detail: RoadVehicleDetail = 'high'): Array<{ geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }> {
  const variant = kind === 'car' ? 'suv' : kind === 'bus' ? 'bus-orange' : kind === 'bike' ? 'bicycle' : kind === 'scooter' ? 'moped' : kind
  const kit = new VehicleKit(detail === 'low')
  if (variant === 'suv' || variant === 'sedan') buildRoadCar(kit, variant === 'suv')
  else if (variant === 'bus-orange' || variant === 'bus-mosaic') buildRoadBus(kit, variant === 'bus-mosaic')
  else buildRoadCycle(kit, variant === 'bicycle')
  return kit.finish()
}

/** One depth-only instance draw per variant prevents rear fittings ghosting through
 * the 70% colour surfaces. All depth draws precede colour, independent of bin sorting. */
export function roadVehicleDrawParts(variant: RoadVehicleVariant, detail: RoadVehicleDetail = 'high'): ReturnType<typeof roadVehicleParts> {
  const parts = roadVehicleParts(variant, detail)
  const geometry = mergeGeometries(parts.map(p => p.geometry))!
  // Transparent queue puts this after the opaque street, preserving its colour
  // beneath the 70% surfaces; renderOrder puts it before all vehicle colour bins.
  const material = new THREE.MeshStandardMaterial({ transparent: true, colorWrite: false, depthWrite: true })
  return [{ geometry, material }, ...parts]
}
