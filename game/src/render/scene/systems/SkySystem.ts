import * as THREE from 'three'
import { STATION_CLEAR } from '../lightRig.ts'
import { DEFAULT_SIM_TIME, timeOfDayOf } from '../../../sim/constants.ts'

const SIZE = 512
const HORIZON = new THREE.Color('#d4e6ef')
const ZENITH = new THREE.Color('#438bd0')
const BELOW = new THREE.Color('#849ba9')
const CLOUD = new THREE.Color('#ffffff')

/** Local sunrise/sunset, repeating with the simulation's day rather than wall time. */
export function skyIntensity(simTime: number): number {
  const hour = timeOfDayOf(simTime) / 3600
  const daylight = smooth(5, 7, hour) * (1 - smooth(17, 19, hour))
  return THREE.MathUtils.lerp(0.015, 1, daylight)
}

function smooth(a: number, b: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return n - Math.floor(n)
}

function noise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y)
  const u = smooth(0, 1, x - ix), v = smooth(0, 1, y - iy)
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), u),
    THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u), v,
  )
}

function cloudField(x: number, y: number): number {
  return noise(x, y) * 0.55 + noise(x * 2.03 + 17, y * 2.03) * 0.25
    + noise(x * 4.07, y * 4.07 + 31) * 0.13 + noise(x * 8.11, y * 8.11) * 0.07
}

/** A fixed, seamless sky: cloud detail is baked once, rather than animated by sim time. */
function createSky(): THREE.CubeTexture {
  const direction = new THREE.Vector3()
  const color = new THREE.Color()
  const faces = Array.from({ length: 6 }, (_, face) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = SIZE
    const ctx = canvas.getContext('2d')!
    const pixels = ctx.createImageData(SIZE, SIZE)
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        const u = 2 * (col + 0.5) / SIZE - 1
        const v = 1 - 2 * (row + 0.5) / SIZE
        // CubeTexture order is +x, -x, +y, -y, +z, -z; the game uses z-up.
        switch (face) {
          case 0: direction.set(1, v, -u); break
          case 1: direction.set(-1, v, u); break
          case 2: direction.set(u, 1, -v); break
          case 3: direction.set(u, -1, v); break
          case 4: direction.set(u, v, 1); break
          default: direction.set(-u, v, -1)
        }
        direction.normalize()
        const height = direction.z
        color.copy(HORIZON).lerp(height >= 0 ? ZENITH : BELOW, Math.pow(Math.abs(height), 0.55))
        if (height > 0) {
          // Project onto a high cloud layer: distant clouds bunch towards the horizon.
          const x = direction.x * 2.8 / (height + 0.16) + 12
          const y = direction.y * 2.8 / (height + 0.16) + 7
          const field = cloudField(x, y)
          const cover = smooth(0.49, 0.7, field) * smooth(0.01, 0.18, height)
          const shade = smooth(0.48, 0.8, field)
          color.lerp(CLOUD, cover * (0.72 + 0.28 * shade))
        }
        color.convertLinearToSRGB()
        const i = (row * SIZE + col) * 4
        pixels.data[i] = Math.round(color.r * 255)
        pixels.data[i + 1] = Math.round(color.g * 255)
        pixels.data[i + 2] = Math.round(color.b * 255)
        pixels.data[i + 3] = 255
      }
    }
    ctx.putImageData(pixels, 0, 0)
    return canvas
  })
  const texture = new THREE.CubeTexture(faces)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

/** Presentation background only (GAME-SPEC §11); no picking, slicing or lighting. */
export class SkySystem {
  private texture = createSky()
  private shown = false
  private intensity = skyIntensity(DEFAULT_SIM_TIME)
  private appliedIntensity = NaN
  private scene: THREE.Scene
  private voidColor = new THREE.Color(STATION_CLEAR)

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  setSimTime(simTime: number): void {
    this.intensity = skyIntensity(simTime)
  }

  setVoidColor(color: number): void {
    this.voidColor.setHex(color)
    if (!this.shown && this.scene.fog instanceof THREE.Fog) this.scene.fog.color.copy(this.voidColor)
  }

  update(hideUI: boolean): void {
    if (hideUI === this.shown && this.intensity === this.appliedIntensity) return
    this.shown = hideUI
    this.appliedIntensity = this.intensity
    this.scene.background = hideUI ? this.texture : null
    this.scene.backgroundIntensity = hideUI ? this.intensity : 1
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(hideUI ? HORIZON : this.voidColor)
      if (hideUI) this.scene.fog.color.multiplyScalar(this.intensity)
    }
  }

  dispose(): void {
    if (this.scene.background === this.texture) this.scene.background = null
    this.scene.backgroundIntensity = 1
    this.texture.dispose()
  }
}
