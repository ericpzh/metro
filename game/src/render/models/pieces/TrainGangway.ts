// The gangway between two cars of an A/B/C/L consist (§1.13).
//
// A car stops 12.5 cm short of its own length at each end, so two neighbouring shells
// stand a **quarter of a metre** apart. On the real stock that gap is closed by the
// enclosed flexible gangway: a black bellows a little smaller than the car all round,
// riding on the same outline — flat flanks, rolled shoulders, flat crown — so the pair
// reads as one continuous body from the platform.
//
// This is deliberately **not** the D car's gangway in `DTrainShell.ts`: D skins its cars
// on a broad-arc section (`dHalfWidth`), so its bellows is lofted from that curve. These
// cars are square-sectioned boxes under a rolled roof, and their gangway is the same box,
// `GANGWAY_SHRINK` inboard on every axis. Both are black; the outline is what differs.

import * as THREE from 'three'
import type { ModelMaterials } from '../PieceBuilder.ts'

/**
 * The car body's own outline, which `TrainModel` builds its roof section and its side
 * sill from: the flat flank stands from the sill up to the waist, where the **rolled
 * shoulder** curves in to the roof's flat crown. The gangway is derived from these
 * numbers, so it cannot drift from the shell it joins.
 */
export const CAR_SILL_Z = 0.45
export const CAR_WAIST_Z = 2.75
export const CAR_CROWN_Z = 3.15
/** The shoulder's plan run — and its rise, the curve being a quarter-turn. */
export const CAR_SHOULDER = 0.4

/**
 * How much smaller the gangway's section is than the car's, about the body's mid height.
 * 3 % of a 22 m A car's width is 9 cm, and of its height 8 cm — the "lightly smaller" a
 * bellows actually is, and the same order as the D car's own (`0.977` in `DTrainShell`).
 * It has to stay inside the car: the bellows tucks under the shell's own end face, and
 * anything wider would push through the skin.
 */
export const GANGWAY_SHRINK = 0.97

/** The space two car shells leave between them: `bodyLen` is a quarter-metre short. */
export const CAR_GAP = 0.25
/** How far the bellows runs into each car, under the shell's own end face. */
export const GANGWAY_TUCK = 0.05

/** Fold pitch along the gap — the bellows' own corrugation, as on the D car's. */
const RIBS = 4
/** Rings along the gap: six per fold, which keeps the fold crests from flattening. */
const RINGS = 24
/** Depth of a fold, as a fraction of the section's own size. */
const RIB_DEPTH = 0.018

/** A car body's cross-section, in the (y, z) plane: y outward, z up from the rail. */
export interface BodySection {
  /** Half the width the flat flanks stand at. */
  halfWidth: number
  sill: number
  waist: number
  crown: number
  /** The rolled shoulder's plan run from the flank to the crown. */
  shoulder: number
}

/** The section of a car `width` metres across. */
export function carBodySection(width: number): BodySection {
  return {
    halfWidth: width / 2,
    sill: CAR_SILL_Z,
    waist: CAR_WAIST_Z,
    crown: CAR_CROWN_Z,
    shoulder: CAR_SHOULDER,
  }
}

/**
 * The same outline, `GANGWAY_SHRINK` inboard, as a gangway's section.
 *
 * Scaling the whole profile about the body's mid height is what makes it *the same shape*:
 * the flank goes in, the shoulder keeps its roll and the crown stays flat, all by one
 * factor. The floor therefore rises with the roof instead of hanging at the car's sill.
 */
export function gangwaySection(width: number): BodySection {
  const car = carBodySection(width)
  const mid = (car.sill + car.crown) / 2
  const at = (z: number) => mid + (z - mid) * GANGWAY_SHRINK
  return {
    halfWidth: car.halfWidth * GANGWAY_SHRINK,
    sill: at(car.sill),
    waist: at(car.waist),
    crown: at(car.crown),
    shoulder: car.shoulder * GANGWAY_SHRINK,
  }
}

/**
 * A section as the closed loop of (y, z) points the surface is swept round — anticlockwise
 * seen down the consist (+x), up the near flank, over the shoulder and the crown, down the
 * far flank, and back along the underfloor. The samples bunch on the shoulder, which is
 * where the shape has curvature, and stay sparse on the flat flanks and crown.
 */
export function sectionOutline(
  section: BodySection,
  flankSteps = 4,
  shoulderSteps = 8,
  crownSteps = 2,
  floorSteps = 3,
): THREE.Vector2[] {
  const { halfWidth: hw, sill, waist, crown, shoulder } = section
  const out: THREE.Vector2[] = []
  const at = (y: number, z: number) => out.push(new THREE.Vector2(y, z))
  const curve = (fromY: number, fromZ: number, ctrlY: number, ctrlZ: number, toY: number, toZ: number) => {
    for (let i = 1; i <= shoulderSteps; i++) {
      const t = i / shoulderSteps, k = 1 - t
      at(k * k * fromY + 2 * k * t * ctrlY + t * t * toY, k * k * fromZ + 2 * k * t * ctrlZ + t * t * toZ)
    }
  }
  for (let i = 0; i <= flankSteps; i++) at(hw, THREE.MathUtils.lerp(sill, waist, i / flankSteps))
  curve(hw, waist, hw, crown, hw - shoulder, crown)
  for (let i = 1; i <= crownSteps; i++) at(THREE.MathUtils.lerp(hw - shoulder, -hw + shoulder, i / crownSteps), crown)
  curve(-hw + shoulder, crown, -hw, crown, -hw, waist)
  for (let i = 1; i <= flankSteps; i++) at(-hw, THREE.MathUtils.lerp(waist, sill, i / flankSteps))
  // The underfloor closes the loop; its last step is the first point again.
  for (let i = 1; i < floorSteps; i++) at(THREE.MathUtils.lerp(-hw, hw, i / floorSteps), sill)
  return out
}

/**
 * Every gangway of a consist as one geometry, in the consist's own frame.
 *
 * One mesh for the whole consist rather than one per joint: the pieces are identical
 * apart from their place along the train, and an 8-car consist would otherwise add seven
 * more draw calls to a model that batches everything else.
 */
export function gangwayGeometry(joints: readonly number[], width: number): THREE.BufferGeometry {
  const section = gangwaySection(width)
  const outline = sectionOutline(section)
  const mid = (section.sill + section.crown) / 2
  const length = CAR_GAP + 2 * GANGWAY_TUCK
  const ring = outline.length
  const positions: number[] = []
  const indices: number[] = []
  for (const joint of joints) {
    const base = positions.length / 3
    for (let i = 0; i <= RINGS; i++) {
      const u = i / RINGS
      // The bellows folds in and out along the gap. Both ends sit at the section's own
      // size, so each meets the car's end face square.
      const fold = 1 - RIB_DEPTH * (1 - Math.cos(u * Math.PI * 2 * RIBS))
      const x = joint + (u - 0.5) * length
      for (const p of outline) positions.push(x, p.x * fold, mid + (p.y - mid) * fold)
    }
    for (let i = 0; i < RINGS; i++) {
      for (let j = 0; j < ring; j++) {
        const a = base + i * ring + j
        const next = base + i * ring + ((j + 1) % ring)
        const b = base + (i + 1) * ring + j
        const bNext = base + (i + 1) * ring + ((j + 1) % ring)
        indices.push(a, next, b, next, bNext, b)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Add the consist's gangways to a car group: the black piece that closes every gap
 * between two cars. `joints` are the car boundaries, in the consist's own x.
 */
export function buildConsistGangways(g: THREE.Group, mats: ModelMaterials, joints: readonly number[], width: number): void {
  if (!joints.length) return
  const mesh = new THREE.Mesh(gangwayGeometry(joints, width), mats.rubber)
  mesh.name = 'car-intercar-gangway'
  g.add(mesh)
}
