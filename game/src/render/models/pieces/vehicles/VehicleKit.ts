import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ROAD_VEHICLE_OPACITY, ROAD_VEHICLE_LOW_OPACITY } from '../../../../sim/constants.ts'

export const INK = { paint: 0xa5a5a5, pale: 0xe2e2e2, accent: 0x777777, glass: 0x303030, rubber: 0x202020, metal: 0xbcbcbc, lamp: 0xf4f4f4, tail: 0x555555 }
export type Point = [number, number, number]

export class VehicleKit {
  readonly low: boolean
  constructor(low = false) { this.low = low }
  private bins = new Map<number, THREE.BufferGeometry[]>()
  add(c: number, geo: THREE.BufferGeometry, p: Point = [0, 0, 0]): void {
    if (!geo.index) geo.setIndex(Array.from({ length: geo.getAttribute('position').count }, (_, i) => i))
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2))
    geo.translate(...p)
    const list = this.bins.get(c) ?? []; list.push(geo); this.bins.set(c, list)
  }
  box(c: number, p: Point, size: Point): void {
    const geometry = new THREE.BoxGeometry(...size)
    const axes = size.map((value, axis) => ({ value, axis })).sort((a,b)=>a.value-b.value)
    if (this.low && (axes[0].value <= .09 || axes[0].value <= axes[1].value * .3)) {
      const axis = axes[0].axis, offset = axis * 12 + (p[axis] < 0 ? 6 : 0)
      geometry.setIndex(Array.from(geometry.index!.array.slice(offset, offset + 6))); geometry.clearGroups()
    }
    this.add(c, geometry, p)
  }
  ellipsoid(c: number, p: Point, size: Point): void {
    const geo = this.low ? new THREE.OctahedronGeometry(1) : new THREE.SphereGeometry(1, 12, 8); geo.scale(...size); this.add(c, geo, p)
  }
  rod(c: number, a: Point, b: Point, r: number, segments = 8, caps = false): void {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), delta = to.clone().sub(from)
    const geo = new THREE.CylinderGeometry(r, r, delta.length(), this.low ? 3 : segments, 1, this.low && !caps)
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()))
    this.add(c, geo, from.add(to).multiplyScalar(.5).toArray() as Point)
  }
  panel(c: number, points: Point[]): void {
    const vertices: number[] = []
    for (let i = 1; i < points.length - 1; i++) vertices.push(...points[0], ...points[i], ...points[i + 1])
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geo.computeVertexNormals(); geo.setIndex(Array.from({ length: vertices.length / 3 }, (_, i) => i)); this.add(c, geo)
  }
  /** Closed cross sections along Y: chamfered in High, four corners in Low. */
  loft(c: number, sections: Array<[number, number, number, number]>): void {
    const rings = sections.map(([y, half, bottom, top]) => {
      if (this.low) return [[-half, y, bottom], [half, y, bottom], [half, y, top], [-half, y, top]] as Point[]
      const bevel = Math.min(.07, (top - bottom) * .25)
      return [
        [-half * .83, y, bottom], [half * .83, y, bottom], [half, y, bottom + bevel],
        [half, y, top - bevel], [half * .85, y, top], [-half * .85, y, top],
        [-half, y, top - bevel], [-half, y, bottom + bevel],
      ] as Point[]
    })
    this.panel(c, rings[0]); this.panel(c, [...rings.at(-1)!].reverse())
    for (let i = 1; i < rings.length; i++) for (let j = 0; j < rings[i].length; j++) {
      if(this.low&&j===0)continue // underside is hidden by the road/body below
      const n = (j + 1) % rings[i].length; this.panel(c, [rings[i - 1][n], rings[i - 1][j], rings[i][j], rings[i][n]])
    }
  }
  wheel(x: number, y: number, radius: number, depth: number, bicycle = false): void {
    if (bicycle) {
      if (this.low) {
        for (const side of [-1,1]) for (let i=0;i<8;i++) {
          const points: Point[] = [[radius, i], [radius-.05, i], [radius-.05, i+1], [radius, i+1]].map(([r,n])=>[x+side*.025,y+Math.cos(n*Math.PI/4)*r,radius+Math.sin(n*Math.PI/4)*r])
          this.panel(INK.rubber, side>0?points.reverse():points)
        }
      } else {
        const tire = new THREE.TorusGeometry(radius - .025, .025, 6, 24); tire.rotateY(Math.PI / 2)
        this.add(INK.rubber, tire, [x, y, radius])
      }
      if (!this.low) {
        const rim = new THREE.TorusGeometry(radius - .055, .012, 4, 24); rim.rotateY(Math.PI / 2)
        this.add(INK.metal, rim, [x, y, radius])
      }
      for (let i = 0; i < (this.low ? 4 : 12); i++) {
        const a = i * Math.PI / (this.low ? 2 : 6)
        if (this.low) {
          const dy=Math.cos(a)*(radius-.06),dz=Math.sin(a)*(radius-.06),w=.007
          for(const side of [-1,1]) {
            const points: Point[]=[[x+side*.005,y-Math.sin(a)*w,radius+Math.cos(a)*w], [x+side*.005,y+dy-Math.sin(a)*w,radius+dz+Math.cos(a)*w], [x+side*.005,y+dy+Math.sin(a)*w,radius+dz-Math.cos(a)*w], [x+side*.005,y+Math.sin(a)*w,radius-Math.cos(a)*w]]
            this.panel(INK.metal,side>0?points.reverse():points)
          }
        } else this.rod(INK.metal, [x, y, radius], [x, y + Math.cos(a) * (radius - .06), radius + Math.sin(a) * (radius - .06)], .007, 4)
      }
    } else if(this.low&&x!==0) {
      const ring=(face:number,n:number):Point=>[face,y+Math.sin(n*Math.PI/2)*radius,radius+Math.cos(n*Math.PI/2)*radius]
      for(let i=0;i<4;i++)this.panel(INK.rubber,[ring(x-depth/2,i),ring(x+depth/2,i),ring(x+depth/2,i+1),ring(x-depth/2,i+1)])
      const face=Array.from({length:4},(_,i)=>ring(x+Math.sign(x)*depth/2,i))
      this.panel(INK.rubber,x>0?face.reverse():face)
    } else {
      const tire = new THREE.CylinderGeometry(radius, radius, depth, this.low ? 4 : 20); tire.rotateZ(Math.PI / 2)
      this.add(INK.rubber, tire, [x, y, radius])
    }
    if (this.low && !bicycle) {
      // Flat diamond hubs retain the exposed wheel face without an axle tube.
      for (const side of [-1, 1]) {
        if(x!==0&&Math.sign(x)!==side)continue // axle-side hub is inside the body
        const points: Point[] = Array.from({ length: 4 }, (_, i) => {
          const a = i * Math.PI / 2
          return [x + side * depth * .52, y + Math.sin(a) * radius * .57, radius + Math.cos(a) * radius * .57]
        })
        this.panel(INK.metal, side === 1 ? points.reverse() : points)
      }
    } else this.rod(INK.metal, [x - depth * .52, y, radius], [x + depth * .52, y, radius], bicycle ? .04 : radius * .57, 12)
    if (!bicycle && !this.low) for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * .4, face = x + side * depth * .54
      this.rod(INK.rubber, [face, y + Math.sin(a) * radius * .18, radius + Math.cos(a) * radius * .18],
        [face, y + Math.sin(a + .24) * radius * .48, radius + Math.cos(a + .24) * radius * .48], radius * .055, 4)
    }
  }
  finish(): Array<{ geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }> {
    return [...this.bins].map(([color, parts]) => {
      const geometry = mergeGeometries(parts)!
      for (const part of parts) part.dispose()
      return { geometry, material: new THREE.MeshStandardMaterial({ color, roughness: .65,
        transparent: true, opacity: this.low ? ROAD_VEHICLE_LOW_OPACITY : ROAD_VEHICLE_OPACITY, depthWrite: false }) }
    })
  }
}
