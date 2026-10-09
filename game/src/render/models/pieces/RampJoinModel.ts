// The stainless infill between neighbouring ramp balustrades (§5.1).
// Each seam belongs to one escalator, so a rebuild never draws it twice.
import * as THREE from 'three'
import { exitLandingHeight } from './ExitLanding.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import type { Module, Vec3i } from '../../../sim/types.ts'
import { escalatorBalustradeWidth, escalatorRun } from '../../../sim/escalators.ts'
import { STAIR_WIDTH_NARROW, stairFlightSlides, stairFlights, stairLaneMates, stairTreadTrim, stairWallSides } from '../../../sim/stairs.ts'
import { RAMP_JOIN_THICKNESS, RAMP_JOIN_RAIL_OVERLAP, RAMP_JOIN_DOME_RADIUS, RAMP_JOIN_DOME_SPACING, STAIR_RAIL_PROUD, ESCALATOR_SURFACE_CLEARANCE } from '../../../sim/constants.ts'

type Escalator = Extract<Module, { type: 'escalator' }>
interface Run {
  mod: Module
  lower: THREE.Vector3
  upper: THREE.Vector3
  axis: THREE.Vector3
  across: THREE.Vector3
  length: number
  planHalf: number
  railHalf: number
  trim: number
  railHeight: number
  normal: THREE.Vector3
  blocked: (side: number) => boolean
}

function run(ctx: ModuleContext, mod: Module, from: Vec3i, to: Vec3i, dx = 0, dy = 0): Run | null {
  const low = from.z <= to.z ? from : to
  const high = from.z <= to.z ? to : from
  const lower = new THREE.Vector3(low.x + 0.5 + dx, low.y + 0.5 + dy, low.z + 1 + exitLandingHeight(ctx.data.modules, low))
  const upper = new THREE.Vector3(high.x + 0.5 + dx, high.y + 0.5 + dy, high.z + 1 + exitLandingHeight(ctx.data.modules, high))
  const axis = upper.clone().sub(lower).setZ(0)
  const length = axis.length()
  if (length < 0.1 || high.z <= low.z || (axis.x !== 0 && axis.y !== 0)) return null
  axis.normalize()
  const across = new THREE.Vector3(-axis.y, axis.x, 0)
  const climb = upper.clone().sub(lower).normalize()
  const normal = new THREE.Vector3(-axis.x * climb.z, -axis.y * climb.z, Math.hypot(climb.x, climb.y))
  if (mod.type === 'escalator') return {
    mod, lower, upper, axis, across, length, normal,
    planHalf: mod.cfg.width === 2 ? 1 : 0.5,
    railHalf: escalatorBalustradeWidth(mod) / 2 + 0.03,
    trim: 0, railHeight: 1, blocked: () => false,
  }
  if (mod.type !== 'stair') return null
  const width = mod.cfg.width ?? STAIR_WIDTH_NARROW
  return {
    mod, lower, upper, axis, across, length, normal,
    planHalf: Math.max(0.5, width / 2 + STAIR_RAIL_PROUD),
    railHalf: width / 2 + 0.07,
    trim: stairTreadTrim(length), railHeight: 0.95, blocked: () => false,
  }
}

function runs(ctx: ModuleContext, mod: Module): Run[] {
  if (mod.type === 'escalator') {
    const f = escalatorRun(mod)
    const r = run(ctx, mod, f.from, f.to)
    return r ? [r] : []
  }
  if (mod.type !== 'stair' || mod.cfg.block) return []
  const slides = stairFlightSlides(mod)
  return stairFlights(mod).flatMap((f, i) => {
    const slide = slides[i] ?? { dx: 0, dy: 0 }
    const r = run(ctx, mod, f.from, f.to, slide.dx, slide.dy)
    if (!r) return []
    // Only scan the station's walls/lanes after finding an actual adjoining run.
    const blocked = (side: number): boolean => {
      const walls = stairWallSides(ctx.data.cells, f.from, f.to, mod.cfg.width ?? STAIR_WIDTH_NARROW, slide)
      if (side > 0 ? walls.left : walls.right) return true
      return stairLaneMates(ctx.data.modules, mod).some((mate) => mate.sameFlight && Math.sign(mate.step[0] * r.across.x + mate.step[1] * r.across.y) === side)
    }
    return [{ ...r, blocked }]
  })
}

/** The actual inclined black rail's endpoints, before its rounded returns. */
function rail(r: Run, side: number): [THREE.Vector3, THREE.Vector3] {
  const offset = r.across.clone().multiplyScalar(side * r.railHalf)
  if (r.mod.type === 'escalator') {
    offset.addScaledVector(r.normal, r.railHeight)
    return [r.lower.clone().add(offset), r.upper.clone().add(offset)]
  }
  offset.z = r.railHeight
  return [r.lower.clone().add(offset).addScaledVector(r.axis, r.trim), r.upper.clone().add(offset).addScaledVector(r.axis, -r.trim)]
}

function at(line: [THREE.Vector3, THREE.Vector3], axis: THREE.Vector3, u: number): THREE.Vector3 {
  const a = line[0].dot(axis)
  const b = line[1].dot(axis)
  return line[0].clone().lerp(line[1], (u - a) / (b - a))
}

/** Follow each real handrail's rounded return and close below its landing floor. */
function returnPoint(r: Run, side: number, end: -1 | 1, t: number): THREE.Vector3 {
  const p = (end < 0 ? r.lower : r.upper).clone().addScaledVector(r.across, side * r.railHalf)
  if (r.mod.type === 'escalator') {
    const phi = Math.PI * t
    const climb = r.upper.clone().sub(r.lower).normalize()
    return p.addScaledVector(r.normal, 0.5 * (1 + Math.cos(phi))).addScaledVector(climb, end * 0.5 * Math.sin(phi))
  }
  p.addScaledVector(r.axis, -end * r.trim)
  if (t <= 0.2) return p.addScaledVector(r.axis, end * 0.34 * t / 0.2).add(new THREE.Vector3(0, 0, r.railHeight))
  const phi = Math.min(1, (t - 0.2) / 0.35) * Math.PI / 2
  p.addScaledVector(r.axis, end * (0.34 + 0.25 * Math.sin(phi)))
  p.z += t <= 0.55 ? r.railHeight - 0.25 + 0.25 * Math.cos(phi) : (r.railHeight - 0.25) * (1 - (t - 0.55) / 0.45)
  return p
}

type Row = [THREE.Vector3, THREE.Vector3]

/** A vertical metal cheek meets a separate, stair-height folded shelf. */
function stairBoard(rows: Row[], first: Row, last: Row, side: number, own: Run, mat: THREE.Material): THREE.Mesh {
  const nearIndex = side > 0 ? 0 : 1
  const farIndex = 1 - nearIndex
  const a = first[nearIndex].clone(), b = last[nearIndex].clone()
  const c = b.clone().setZ(last[farIndex].z), d = a.clone().setZ(first[farIndex].z)
  c.z -= ESCALATOR_SURFACE_CLEARANCE
  d.z -= ESCALATOR_SURFACE_CLEARANCE
  a.z = Math.max(a.z, d.z + 0.01)
  b.z = Math.max(b.z, c.z + 0.01)
  const inward = first[nearIndex].clone().sub(first[farIndex]).setZ(0).normalize().multiplyScalar(RAMP_JOIN_THICKNESS)
  const front = [a,b,c,d]
  const back = front.map((p) => p.clone().add(inward))
  const positions: number[] = []
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): void => {
    positions.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...a.toArray(), ...c.toArray(), ...d.toArray())
  }
  // A closed cheek and shelf stop at the shared straight-rail interval.
  if (side > 0) {
    front.reverse()
    back.reverse()
  }
  quad(front[0],front[1],front[2],front[3])
  quad(back[3],back[2],back[1],back[0])
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    quad(front[i],back[i],back[j],front[j])
  }
  const shelfRows = rows.map((r): Row => {
    const shelf: Row = [r[0].clone(), r[1].clone()]
    shelf[nearIndex].z = shelf[farIndex].z
    return shelf
  })
  const shelf = board(shelfRows, mat, true)
  positions.push(...shelf.geometry.getAttribute('position').array)
  shelf.geometry.dispose()
  // Close the cut with a vertical face down to the landing, rather than
  // stretching a ribbon between two differently shaped handrail returns.
  for (const [row, floor, end] of [[shelfRows[0], own.lower.z, -1], [shelfRows.at(-1)!, own.upper.z, 1]] as const) {
    const topA = row[0].clone(), topB = row[1].clone()
    topA.z -= ESCALATOR_SURFACE_CLEARANCE
    topB.z -= ESCALATOR_SURFACE_CLEARANCE
    const bottomA = topA.clone().setZ(floor - ESCALATOR_SURFACE_CLEARANCE)
    const bottomB = topB.clone().setZ(floor - ESCALATOR_SURFACE_CLEARANCE)
    const face = [topA,topB,bottomB,bottomA]
    if (end > 0) face.reverse()
    const inner = face.map((p) => p.clone().addScaledVector(own.axis, -end * RAMP_JOIN_THICKNESS))
    quad(face[0],face[1],face[2],face[3])
    quad(inner[3],inner[2],inner[1],inner[0])
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      quad(face[i],inner[i],inner[j],face[j])
    }
  }
  // Stair-facing skin closes the open space beneath the shelf. Its lower
  // edge is buried in the stair stringer, covering the gaps between treads.
  // Inset its ends into the end caps and its top into the shelf thickness.
  const stairStart = shelfRows[0][farIndex].clone().addScaledVector(own.axis, ESCALATOR_SURFACE_CLEARANCE)
  const stairEnd = shelfRows.at(-1)![farIndex].clone().addScaledVector(own.axis, -ESCALATOR_SURFACE_CLEARANCE)
  stairStart.z -= 2 * ESCALATOR_SURFACE_CLEARANCE
  stairEnd.z -= 2 * ESCALATOR_SURFACE_CLEARANCE
  const sideFace = [stairStart, stairEnd,
    stairEnd.clone().setZ(own.upper.z - 0.15),
    stairStart.clone().setZ(own.lower.z - 0.15)]
  if (side > 0) sideFace.reverse()
  const sideBack = sideFace.map((p) => p.clone().add(inward))
  quad(sideFace[0],sideFace[1],sideFace[2],sideFace[3])
  quad(sideBack[3],sideBack[2],sideBack[1],sideBack[0])
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    quad(sideFace[i],sideBack[i],sideBack[j],sideFace[j])
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, mat)
  mesh.name = 'ramp-join'
  return mesh
}

function board(rows: Row[], mat: THREE.Material, verticalThickness = false): THREE.Mesh {
  const positions: number[] = []
  const centres = rows.map(([a,b]) => a.clone().add(b).multiplyScalar(0.5))
  const back = rows.map(([a,b], i): Row => {
    const tangent = centres[Math.min(i + 1, rows.length - 1)].clone().sub(centres[Math.max(0, i - 1)])
    const normal = verticalThickness ? new THREE.Vector3(0,0,-RAMP_JOIN_THICKNESS) : tangent.cross(b.clone().sub(a)).normalize().multiplyScalar(-RAMP_JOIN_THICKNESS)
    return [a.clone().add(normal), b.clone().add(normal)]
  })
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    // At a mixed return one rail can meet the incline before the other; the
    // resulting triangular shoulder needs no zero-area half of its quad.
    if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() < 1e-18) return
    positions.push(...a.toArray(), ...b.toArray(), ...c.toArray())
  }
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): void => { triangle(a,b,c); triangle(a,c,d) }
  // One closed shell from lower rounded nose, through the incline, to upper
  // rounded nose. No stacked end caps or coplanar faces along section seams.
  for (let i = 0; i + 1 < rows.length; i++) {
    const [a,b] = rows[i], [c,d] = rows[i + 1]
    const [aa,bb] = back[i], [cc,dd] = back[i + 1]
    quad(a,c,d,b)
    quad(aa,bb,dd,cc)
    quad(a,aa,cc,c)
    quad(b,d,dd,bb)
  }
  quad(rows[0][0],rows[0][1],back[0][1],back[0][0])
  const last = rows.length - 1
  quad(rows[last][0],back[last][0],back[last][1],rows[last][1])
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, mat)
  mesh.name = 'ramp-join'
  return mesh
}

/** Add infill only where two full runs stand flush, with real facing handrails. */
export function addRampJoins(ctx: ModuleContext, mod: Escalator, group: THREE.Group): void {
  if (!ctx.data) return
  const own = runs(ctx, mod)[0]
  if (!own) return
  group.updateMatrixWorld(true)
  const inverse = group.matrixWorld.clone().invert()
  for (const neighbour of ctx.data.modules) {
    if (neighbour.id === mod.id) continue
    if (neighbour.type === 'escalator' && !ctx.preview && mod.id > neighbour.id) continue
    for (const other of runs(ctx, neighbour)) {
      if (own.axis.dot(other.axis) < 0.999 || Math.abs(own.lower.z - other.lower.z) > 0.001 || Math.abs(own.upper.z - other.upper.z) > 0.001) continue
      const delta = other.lower.clone().sub(own.lower)
      if (Math.abs(delta.dot(own.axis)) > 0.001 || Math.abs(own.length - other.length) > 0.001) continue
      const distance = delta.dot(own.across)
      if (Math.abs(Math.abs(distance) - own.planHalf - other.planHalf) > 0.001) continue
      const side = Math.sign(distance)
      if (other.blocked(-side)) continue
      const first = rail(own, side)
      const second = rail(other, -side)
      const start = Math.max(first[0].dot(own.axis), second[0].dot(own.axis))
      const end = Math.min(first[1].dot(own.axis), second[1].dot(own.axis))
      if (end - start < 0.1) continue
      const gap = Math.abs(distance) - own.railHalf - other.railHalf
      if (gap <= 0.03) continue
      const near = (u: number): THREE.Vector3 => at(first, own.axis, u).addScaledVector(own.across, -side * RAMP_JOIN_RAIL_OVERLAP).add(new THREE.Vector3(0, 0, -0.04 - ESCALATOR_SURFACE_CLEARANCE))
      const far = (u: number): THREE.Vector3 => at(second, own.axis, u).addScaledVector(own.across, side * RAMP_JOIN_RAIL_OVERLAP).add(new THREE.Vector3(0, 0, -0.04 - ESCALATOR_SURFACE_CLEARANCE))
      const row = (a: THREE.Vector3, b: THREE.Vector3): Row => side > 0 ? [a,b] : [b,a]
      const rows: Row[] = []
      const append = (r: Row): void => {
        const prev = rows.at(-1)
        if (!prev || prev[0].distanceTo(r[0]) + prev[1].distanceTo(r[1]) > 1e-6) rows.push(r)
      }
      const returned = (end: -1 | 1, t: number): Row => {
        const a = returnPoint(own, side, end, t).addScaledVector(own.across, -side * RAMP_JOIN_RAIL_OVERLAP)
        const b = returnPoint(other, -side, end, t).addScaledVector(own.across, side * RAMP_JOIN_RAIL_OVERLAP)
        a.z -= 0.04 + ESCALATOR_SURFACE_CLEARANCE
        b.z -= 0.04 + ESCALATOR_SURFACE_CLEARANCE
        return row(a,b)
      }
      const mixed = neighbour.type === 'stair'
      if (!mixed) for (let i = 20; i >= 0; i--) append(returned(-1, i / 20))
      const firstRow = row(near(start), far(start))
      const lastRow = row(near(end), far(end))
      append(firstRow)
      append(lastRow)
      if (!mixed) for (let i = 0; i <= 20; i++) append(returned(1, i / 20))
      const mesh = mixed ? stairBoard(rows, firstRow, lastRow, side, own, ctx.mats.steel) : board(rows, ctx.mats.steel)
      mesh.geometry.applyMatrix4(inverse)
      mesh.userData.neighbourId = neighbour.id
      group.add(mesh)
      if (mixed) {
        // The facing escalator balustrade becomes a metal side panel. The
        // outer balustrade and escalator–escalator glass remain as modelled.
        for (const child of group.children) {
          if (!(child instanceof THREE.Mesh) || child.material !== ctx.mats.glass) continue
          const position = child.getWorldPosition(new THREE.Vector3())
          if (Math.sign(position.sub(own.lower).dot(own.across)) === side) child.material = ctx.mats.steel
        }
        // Domes belong on the stair-height shelf, below the vertical panel.
        for (const r of [firstRow, lastRow]) r[side > 0 ? 0 : 1].z = r[side > 0 ? 1 : 0].z
      }
      const centreStart = firstRow[0].clone().add(firstRow[1]).multiplyScalar(0.5)
      const centreEnd = lastRow[0].clone().add(lastRow[1]).multiplyScalar(0.5)
      const count = Math.max(1, Math.floor(centreStart.distanceTo(centreEnd) / RAMP_JOIN_DOME_SPACING))
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count
        // Seat each hemisphere on the actual triangle under the centreline,
        // including a mixed pair's tilted cap, rather than floating above it.
        const [a,b] = firstRow, [c,d] = lastRow
        const centre = t >= 0.5
          ? a.clone().multiplyScalar(1-t).addScaledVector(c, t-0.5).addScaledVector(d, 0.5)
          : a.clone().multiplyScalar(0.5).addScaledVector(d,t).addScaledVector(b,0.5-t)
        const normal = t >= 0.5 ? c.clone().sub(a).cross(d.clone().sub(a)).normalize() : d.clone().sub(a).cross(b.clone().sub(a)).normalize()
        const geometry = new THREE.SphereGeometry(RAMP_JOIN_DOME_RADIUS, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)
        geometry.rotateX(Math.PI / 2) // three's hemisphere is +y; the panel uses +z
        const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), normal)
        geometry.applyMatrix4(new THREE.Matrix4().compose(centre,rotation,new THREE.Vector3(1,1,1)))
        geometry.applyMatrix4(inverse)
        const dome = new THREE.Mesh(geometry, ctx.mats.steel)
        dome.name = 'ramp-join-dome'
        dome.userData.neighbourId = neighbour.id
        group.add(dome)
      }
    }
  }
}
