import * as THREE from 'three'
import type {Module} from '../sim/types.ts'
import {STOREY_HEIGHT} from '../sim/constants.ts'
import {stairFlights,stairFlightSlides} from '../sim/stairs.ts'
import {escalatorInclineRun} from '../sim/escalators.ts'
import {liftSizeOf} from '../sim/lifts.ts'

interface Connection {
  moduleId:string
  lower:number
  upper:number
  point:THREE.Vector3
}

/** Guides join corresponding cut surfaces; they never deform or pick floor geometry. */
export class ExplodedConnections {
  readonly connections:Connection[]=[]
  readonly lines:THREE.LineSegments
  readonly levels:readonly number[]
  private readonly offsets:ReadonlyMap<number,number>
  private readonly direction:readonly [number,number]
  private readonly shifts:readonly THREE.Vector3[]
  constructor(modules:readonly Module[],levels:readonly number[],
    offsets:ReadonlyMap<number,number>,direction:readonly [number,number],shifts:readonly THREE.Vector3[]) {
    this.levels=levels;this.offsets=offsets;this.direction=direction;this.shifts=shifts
    for(const module of modules) {
      if(module.type!=='escalator' && module.type!=='stair' && module.type!=='lift')continue
      const lo=Math.min(module.from.z,module.to.z),hi=Math.max(module.from.z,module.to.z)
      for(let upper=0;upper<levels.length;upper++) {
        const z=levels[upper],lower=levels.indexOf(z-STOREY_HEIGHT)
        if(lower<0 || z<=lo || z>hi)continue
        let point:THREE.Vector3|undefined
        if(module.type==='lift') {
          const center=liftSizeOf(module)/2
          point=new THREE.Vector3(module.x+center,module.y+center,z)
        } else {
          const flights=module.type==='stair'?stairFlights(module):[escalatorInclineRun(module)]
          const slides=module.type==='stair'?stairFlightSlides(module):[]
          for(const [i,flight]of flights.entries()) {
            const {from,to}=flight
            // Models stand one metre above their floor-cell anchors. Intersect
            // the walking line with the same world-height plane used by tray cuts.
            if(z<Math.min(from.z,to.z)+1 || z>Math.max(from.z,to.z)+1 || from.z===to.z)continue
            const t=(z-1-from.z)/(to.z-from.z),slide=slides[i]
            point=new THREE.Vector3(from.x+(to.x-from.x)*t+.5+(slide?.dx??0),from.y+(to.y-from.y)*t+.5+(slide?.dy??0),z)
            break
          }
        }
        if(point)this.connections.push({moduleId:module.id,lower,upper,point})
      }
    }
    const geometry=new THREE.BufferGeometry()
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(this.connections.length*6),3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('lineDistance',new THREE.Float32BufferAttribute(new Float32Array(this.connections.length*2),1).setUsage(THREE.DynamicDrawUsage))
    const material=new THREE.LineDashedMaterial({color:0x8ed8ff,dashSize:1.5,gapSize:1,transparent:true,opacity:.9,depthWrite:false})
    this.lines=new THREE.LineSegments(geometry,material)
    this.lines.name='exploded-floor-connections'
    this.lines.raycast=()=>{} // Guides never intercept a floor click.
    this.lines.frustumCulled=false
    this.update()
  }
  update():void {
    const position=this.lines.geometry.getAttribute('position') as THREE.BufferAttribute
    const distances=this.lines.geometry.getAttribute('lineDistance') as THREE.BufferAttribute
    this.connections.forEach((connection,i)=>{
      for(const [end,index]of [connection.lower,connection.upper].entries()) {
        const level=this.levels[index],offset=this.offsets.get(level)??0,shift=this.shifts[index]
        position.setXYZ(i*2+end,connection.point.x+offset*this.direction[0]+shift.x,
          connection.point.y+offset*this.direction[1]+shift.y,connection.point.z+shift.z)
      }
      const a=i*2,b=a+1
      distances.setX(a,0)
      distances.setX(b,Math.hypot(position.getX(b)-position.getX(a),position.getY(b)-position.getY(a),position.getZ(b)-position.getZ(a)))
    })
    position.needsUpdate=true
    distances.needsUpdate=true
  }
  dispose():void {this.lines.geometry.dispose();(this.lines.material as THREE.Material).dispose();this.lines.removeFromParent()}
}
