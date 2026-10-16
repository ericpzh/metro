import * as THREE from 'three'
import type { ModelMaterials } from '../PieceBuilder.ts'
import type { Stock } from '../../../sim/stock.ts'
import { dSection, dCrown, dSurface, D_CROWN_HALF } from './DTrainShell.ts'

const NOSE_Z = 0.78

/** Low rounded tip, continuously lofted back into the D carriage section. */
export function dCabPoint(section: THREE.Vector2, distance: number, length: number, lift = 0): THREE.Vector3 {
  const t = distance / length
  const width = Math.sqrt(Math.max(0, t * (2 - t)))
  const ny = section.x / 1.65, nz = (section.y - 1.85) / 1.4
  const radius = Math.hypot(ny, nz)
  const blend = THREE.MathUtils.smoothstep(t, 0.48, 0.96)
  const y = THREE.MathUtils.lerp(ny / radius * 1.65, section.x, blend)
  const roundZ = THREE.MathUtils.lerp(1.85 + nz / radius * 1.4, section.y, blend)
  // Bring only the lower skirt down to the car sill; keep the crown and nose tip.
  const skirt = (1 - THREE.MathUtils.smoothstep(section.y, 0.7, 1.5)) * (1 - blend)
  const z = THREE.MathUtils.lerp(roundZ, section.y, skirt)
  const point = new THREE.Vector3(-distance, y * width, NOSE_Z + (z - NOSE_Z) * width)
  const normal = new THREE.Vector3((length - distance) / (length * length), point.y / (1.65 * 1.65),
    (point.z - NOSE_Z - (1.85 - NOSE_Z) * width) / (1.4 * 1.4)).normalize()
  return point.addScaledVector(normal, lift)
}

/** Sample the very triangles used by the cab skin, including their chord error. */
function cabSurface(q: number, distance: number, length: number, lift = 0): THREE.Vector3 {
  const section = dCrown(q)
  const sideT = Math.acos(THREE.MathUtils.clamp(1 - 2 * (section.y - 0.45) / 2.8, -1, 1)) / Math.PI
  const v = Math.abs(q) <= 0.5 ? 0.25 + (D_CROWN_HALF - section.x) / (D_CROWN_HALF * 2) * 0.25
    : q > 0 ? sideT * 0.25 : 0.75 - sideT * 0.25
  const row = THREE.MathUtils.clamp(distance / length * 64, 0, 64)
  const column = THREE.MathUtils.clamp(v * 128, 0, 128)
  const i = Math.min(63, Math.floor(row)), j = Math.min(127, Math.floor(column))
  const u = row - i, w = column - j
  const a = dCabPoint(dSection(j / 128), i / 64 * length, length)
  const b = dCabPoint(dSection(j / 128), (i + 1) / 64 * length, length)
  const c = dCabPoint(dSection((j + 1) / 128), i / 64 * length, length)
  const d = dCabPoint(dSection((j + 1) / 128), (i + 1) / 64 * length, length)
  const point = u + w <= 1
    ? a.clone().addScaledVector(b.clone().sub(a), u).addScaledVector(c.clone().sub(a), w)
    : d.clone().addScaledVector(c.clone().sub(d), 1 - u).addScaledVector(b.clone().sub(d), 1 - w)
  const t = distance / length, width = Math.sqrt(Math.max(0, t * (2 - t)))
  const normal = new THREE.Vector3((length - distance) / (length * length), point.y / (1.65 * 1.65),
    (point.z - NOSE_Z - (1.85 - NOSE_Z) * width) / (1.4 * 1.4)).normalize()
  return point.addScaledVector(normal, lift)
}

/** Fit an authored front-view contour onto the actual curved shell. */
function frontPoint(y: number, z: number, length: number, lift: number): { point: THREE.Vector3; error: number; distance: number; q: number } {
  let distance = THREE.MathUtils.clamp((z - NOSE_Z) / (3.25 - NOSE_Z) * length * 0.7, 0.1, length - 0.05)
  let q = y / 1.4
  for (let step = 0; step < 16; step++) {
    const p = cabSurface(q, distance, length)
    const a = cabSurface(q, distance + 0.001, length).sub(p).multiplyScalar(1000)
    const b = cabSurface(q + 0.001, distance, length).sub(p).multiplyScalar(1000)
    const ey = y - p.y, ez = z - p.z
    if (Math.hypot(ey, ez) < 0.00001) break
    const det = a.y * b.z - b.y * a.z
    if (Math.abs(det) < 1e-8) break
    distance = THREE.MathUtils.clamp(distance + THREE.MathUtils.clamp((ey * b.z - b.y * ez) / det, -0.6, 0.6), 0.02, length - 0.01)
    q = THREE.MathUtils.clamp(q + THREE.MathUtils.clamp((a.y * ez - ey * a.z) / det, -0.3, 0.3), -1.8, 1.8)
  }
  const fitted = cabSurface(q, distance, length)
  return { point: cabSurface(q, distance, length, lift), error: Math.hypot(fitted.y - y, fitted.z - z), distance, q }
}

export function buildStreamlinedCab(root: THREE.Group, mats: ModelMaterials, stock: Stock, nose: number, outward: number, head: boolean, livery: THREE.Material): void {
  const cab = new THREE.Group()
  cab.name = 'streamlined-cab'
  cab.position.x = nose
  cab.rotation.z = outward > 0 ? 0 : Math.PI
  root.add(cab)
  const length = stock.cabLength!
  const shell = new THREE.Mesh(dSurface((u, v) => dCabPoint(dSection(v), u * length, length), 64, 128, true), mats.trainBody)
  const positions = shell.geometry.attributes.position, normals = shell.geometry.attributes.normal
  const smooth = new THREE.Vector3(), original = new THREE.Vector3()
  for (let i = 0; i < positions.count; i++) {
    const distance = -positions.getX(i), t = distance / length
    const width = Math.sqrt(Math.max(0, t * (2 - t)))
    smooth.set((length - distance) / (length * length), positions.getY(i) / (1.65 * 1.65),
      (positions.getZ(i) - NOSE_Z - (1.85 - NOSE_Z) * width) / (1.4 * 1.4)).normalize()
    original.fromBufferAttribute(normals, i)
    smooth.lerp(original, THREE.MathUtils.smoothstep(t, 0.36, 0.85)).normalize()
    normals.setXYZ(i, smooth.x, smooth.y, smooth.z)
  }
  shell.name = 'd-cab-shell'; cab.add(shell)
  const mesh = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const part = new THREE.Mesh(geometry, material); part.name = name; cab.add(part); return part
  }
  // Author the surround in plan, then drape it onto the crown. Each layer
  // closes into an ellipse; no rectangular rear patch or corner joins the sides.
  const planPoint = (x: number, y: number, lift: number) => {
    const distance = -x
    let low = 0, high = 1
    for (let i = 0; i < 28; i++) {
      const q = (low + high) / 2
      if (cabSurface(q, distance, length).y < Math.abs(y)) low = q
      else high = q
    }
    const p = cabSurface(Math.sign(y) * (low + high) / 2, distance, length)
    return new THREE.Vector3(x, y, p.z + lift)
  }
  // The line colour wraps the side panes and lamps and reaches down the nose.
  // Adjacent rings share boundaries, keeping the paint against the skin.
  const face = (name: string, material: THREE.Material, outer: [number, number], inner: [number, number]) => {
    mesh(name, dSurface((u, v) => {
      const angle = v * Math.PI * 2
      const rx = THREE.MathUtils.lerp(inner[0], outer[0], u)
      const ry = THREE.MathUtils.lerp(inner[1], outer[1], u)
      return planPoint(-2.35 + rx * Math.cos(angle), ry * Math.sin(angle), 0.010)
    }, 48, 128, true), material)
  }
  const rim: [number, number] = [2.23, 1.20]
  const colourEdge: [number, number] = [2.205, 1.175]
  const maskEdge: [number, number] = [1.91, 0.80]
  face('d-cab-gold-trim', mats.trainTrim, rim, colourEdge)
  face('d-cab-livery', livery, colourEdge, maskEdge)
  face('d-cab-mask', mats.trainDark, maskEdge, [0, 0])
  // Continue the passenger-window band as solid paint over the cab side,
  // and sweep the low car stripes down toward the skirt.
  const sidePoint = (distance: number, z: number, side: number, paintLift = 0.008) => {
    let low = 0, high = 1.805
    for (let i = 0; i < 24; i++) {
      const q = (low + high) / 2
      if (cabSurface(q, distance, length).z > z) low = q
      else high = q
    }
    // Keep paint height and longitudinal position exact at the join. A normal
    // offset would lift/drop the band edges and shift them along the cab.
    const point = cabSurface(side * (low + high) / 2, distance, length)
    point.y += side * paintLift
    point.z = z
    return point
  }
  for (const side of [-1, 1]) {
    mesh('d-cab-side-black-taper', dSurface((u, v) => {
      const distance = THREE.MathUtils.lerp(length, 2.65, u)
      const fall = THREE.MathUtils.smoothstep(u, 0, 1)
      const middle = THREE.MathUtils.lerp(2.075, 2.08, fall)
      const halfHeight = 0.555 * Math.pow(1 - fall, 0.75)
      return sidePoint(distance, middle + (v * 2 - 1) * halfHeight, side)
    }, 48, 24, side < 0), mats.trainDark)
    const stripe = (name: string, material: THREE.Material, low: number, high: number) => {
      mesh(name, dSurface((u, v) => {
        const distance = THREE.MathUtils.lerp(length, 2.55, u)
        const fall = THREE.MathUtils.smoothstep(u, 0, 1)
        const bottom = THREE.MathUtils.lerp(low, 0.55, fall)
        const top = bottom + (high - low) * (1 - fall)
        return sidePoint(distance, THREE.MathUtils.lerp(bottom, top, v), side)
      }, 48, 8, side < 0), material)
    }
    stripe('d-cab-side-livery-sweep', livery, 1.05, 1.16)
    stripe('d-cab-side-gold-sweep', mats.trainTrim, 1.01, 1.045)
  }
  const glass = new THREE.MeshStandardMaterial({color:0x527c91, roughness:0.13, metalness:0.08})
  const accent = new THREE.MeshStandardMaterial({color:0xe73541,roughness:0.45,metalness:0})
  ;(root.userData.ownedMats as THREE.Material[]).push(glass,accent)
  const shield = (name: string, material: THREE.Material, extra: number, lift: number) => {
    let error = 0
    const geometry = dSurface((u, v) => {
      const across = v * 2 - 1
      const halfWidth = 0.88 * (0.43 + 0.32 * Math.sin(u * Math.PI / 2) - 0.08 * THREE.MathUtils.smoothstep(u, 0.85, 1))
      const fitted = frontPoint(across * (halfWidth + extra), 2.08 - extra + (0.80 + 2 * extra) * u + 0.18 * across ** 2 * (1 - u) ** 3 - 0.08 * across ** 4 * u ** 3, length, lift)
      error = Math.max(error, fitted.error)
      return fitted.point
    }, 32, 36)
    geometry.userData.projectionError = error
    mesh(name, geometry, material)
  }
  shield('d-windscreen-seal', mats.rubber, 0.025, 0.012)
  shield('d-cab-windscreen', glass, 0, 0.014)
  // One pair of rails runs from the badge to the upper windshield corner.
  // A/window, B/light and C/accent are only intervals cut from that same strip.
  const innerEdge = (t: number) => new THREE.Vector2(0.10 + 0.68 * Math.sin(t * Math.PI / 2),1.96 + 0.94 * (1 - Math.cos(t * Math.PI / 2)))
  const outerEdge = (t: number) => new THREE.Vector2(0.12 + 0.94 * Math.sin(t * Math.PI / 2),1.89 + 0.97 * (1 - Math.cos(t * Math.PI / 2)))
  // Clip the existing surface strip against the same plan contour as the mask.
  // Resampling its rows preserves the shell fit and the outer panel silhouette.
  const clipToMask = (source: THREE.BufferGeometry, reverse: boolean) => {
    const positions = source.attributes.position
    const sample = (u: number, v: number) => {
      const row = u * 48, col = v * 12
      const i = Math.min(47, Math.floor(row)), j = Math.min(11, Math.floor(col))
      const a = new THREE.Vector3().fromBufferAttribute(positions, i * 13 + j)
      const b = new THREE.Vector3().fromBufferAttribute(positions, (i + 1) * 13 + j)
      const c = new THREE.Vector3().fromBufferAttribute(positions, i * 13 + j + 1)
      const d = new THREE.Vector3().fromBufferAttribute(positions, (i + 1) * 13 + j + 1)
      return a.lerp(b, row - i).lerp(c.lerp(d, row - i), col - j)
    }
    const outside = (p: THREE.Vector3) => Math.hypot((p.x + 2.35) / maskEdge[0], p.y / maskEdge[1]) >= 1
    let start = 0
    if (!outside(sample(0, 1))) {
      let row = 1
      while (row < 48 && !outside(sample(row / 48, 1))) row++
      let low = (row - 1) / 48, high = row / 48
      for (let i = 0; i < 24; i++) {
        const mid = (low + high) / 2
        if (outside(sample(mid, 1))) high = mid
        else low = mid
      }
      start = high
    }
    const cuts = new Map<number, number>()
    const clipped = dSurface((u, v) => {
      const row = THREE.MathUtils.lerp(start, 1, u)
      if (!cuts.has(u)) {
        let low = 0, high = 1
        if (!outside(sample(row, 0))) {
          for (let i = 0; i < 24; i++) {
            const mid = (low + high) / 2
            if (outside(sample(row, mid))) high = mid
            else low = mid
          }
        } else high = 0
        cuts.set(u, high)
      }
      return sample(row, THREE.MathUtils.lerp(cuts.get(u)!, 1, v))
    }, 48, 12, reverse)
    source.dispose()
    return clipped
  }
  const strip = (name: string, material: THREE.Material, side: number, from: number, to: number, lift: number, border = false, rearCut = false) => {
    const ends = new Map<number, number>()
    const geometry = dSurface((u,v) => {
      const across = border ? THREE.MathUtils.lerp(-0.035,1.035,v) : v
      let end = to
      if (rearCut && !ends.has(v)) {
        let low = from, high = 1
        for (let i = 0; i < 16; i++) {
          const mid = (low + high) / 2
          const p = innerEdge(mid).lerp(outerEdge(mid), across)
          if (frontPoint(side*p.x,p.y,length,0).distance < 2.25) low = mid
          else high = mid
        }
        ends.set(v, (low + high) / 2)
      }
      end = ends.get(v) ?? end
      const t = THREE.MathUtils.lerp(from,end,u)
      const p = innerEdge(t).lerp(outerEdge(t),across)
      return frontPoint(side*p.x,p.y,length,lift).point
    },48,12,side < 0)
    mesh(name,clipToMask(geometry,side < 0),material)
  }
  for (const side of [-1,1]) {
    strip('d-side-window-seal',mats.rubber,side,0.70,0.88,0.012,true,true)
    strip('d-cab-side-window',glass,side,0.70,0.88,0.014,false,true)
    strip('d-cab-lamp-housing',mats.trainDark,side,0.38,0.66,0.012,true)
    strip(head ? 'd-headlight' : 'd-taillight',head ? mats.headlight : mats.taillight,side,0.38,0.66,0.014)
    strip('d-cab-accent-band',accent,side,0.02,0.34,0.014)
  }
  // The upper brow and two marker lamps sit over the glazing, as on the reference.
  const brow = (name: string, material: THREE.Material, centreY: number, width: number, low: number, height: number, lift: number) => {
    mesh(name,dSurface((u,v) => {
      const across = v * 2 - 1
      const y = centreY + across * width / 2
      const z = low + u * height - 0.035 * across ** 4
      return frontPoint(y,z,length,lift).point
    },8,24),material)
  }
  brow('d-windscreen-upper-brow',mats.trainDark,0,1.43,2.76,0.12,0.016)
  brow('d-cab-upper-display',mats.rubber,0,0.28,2.81,0.045,0.018)
  for (const side of [-1,1]) {
    const marker = (name: string, material: THREE.Material, radius: number, lift: number) => {
      mesh(name,dSurface((u,v) => {
        const angle = v * Math.PI * 2
        return frontPoint(side * 0.35 + Math.cos(angle) * u * radius,2.835 + Math.sin(angle) * u * radius,length,lift).point
      },6,24,true),material)
    }
    marker('d-upper-marker-housing',mats.rubber,0.042,0.018)
    marker('d-upper-marker-light',head ? mats.headlight : mats.taillight,0.026,0.020)
  }
  mesh('d-metro-mark', dSurface((u, v) => frontPoint((v - 0.5) * 0.20, 1.79 + u * 0.13, length, 0.014).point, 8, 12), mats.trainMark)
  mesh('d-cab-bulkhead', dSurface((u, v) => {
    const edge = dCabPoint(dSection(v), length - 0.05, length)
    return new THREE.Vector3(-length + 0.05, 0, 1.85).lerp(edge, u)
  }, 1, 128, true), mats.trainInterior)
}
