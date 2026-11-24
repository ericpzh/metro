import type { ExampleStationId } from '../../data/reference-station.ts'

/** Shared orbit sensitivity matching `CameraSystem.orbitBy` and `StationCameraController.OrbitByPixels`. */
export const TOUR_ORBIT_RADIANS_PER_PIXEL = 0.008

/** Perspective vertical FOV (degrees) shared by Web (`DEFAULT_FOV`) and Unity (`DefaultFov`). */
export const TOUR_FOV_DEG = 45
const TOUR_TWO_TAN_HALF_FOV = 2 * Math.tan((TOUR_FOV_DEG * Math.PI) / 360)

/** Default isometric camera direction (from aim toward eye) matching `setPreset('iso')` and `StationCameraMath.PresetDirection(Iso)`. */
const DEFAULT_ISO_DIRECTION: readonly [number, number, number] = [1, -1.2, 0.85]

/**
 * Maximum camera-to-target distance (m) during the close-up touring phase.
 *
 * At `fov = 45°`, `span = 0.8284 * D`. At `D <= 15.0 m`, even a `1.7 m` adult passenger
 * projects to `>= 13.7%` of screen height — safely above Unity High's LOD0 entry threshold
 * (`12% × 1.10 = 13.2%`), while every station module (`>= 2 m` bounding sphere) stays at
 * full LOD0 and Web Three.js equipment/trees stay far above their `24 px`/`45 px` detail cutoffs.
 */
export const TOUR_LOD0_MAX_DISTANCE = 15

/** Minimum safe close-up distance (m) to avoid clipping walls or floor furniture. */
export const TOUR_MIN_DISTANCE = 10

export interface TourInitialPose {
  /** Plan center X (m) that `frame()` resets to on every storey switch. */
  centerX: number
  /** Plan center Y (m) that `frame()` resets to on every storey switch. */
  centerY: number
  /** Camera-to-target distance (m) at `t = 0` after opening framing and `initialZoom`. */
  initialDistance: number
}

export interface TourLevelStep {
  /** Wall-clock timestamp (ms from benchmark start) when the Q/E storey switch fires. */
  atMs: number
  /** Target storey elevation (m), always a ±5 m Q/E step onto an inhabited storey of the station. */
  level: number
  /** Equivalent keyboard shortcut (`Q` steps down, `E` steps up). */
  key: 'Q' | 'E'
  /** World plan `(x, y)` hotspot (m) to focus immediately after `frame()` resets to bounds center. */
  focus: readonly [number, number]
}

export type TourMotionSegment =
  | {
      kind: 'orbitZoom'
      startMs: number
      endMs: number
      /** Total yaw change around world Z (degrees). */
      yawDeg?: number
      /** Total pitch change around screen-right (degrees; + steeper toward top-down, - flatter). */
      pitchDeg?: number
      /** Absolute target camera distance (m) at `endMs` (compensates for Web vs Unity framing bounds). */
      targetDistance?: number
      /** Optional relative distance multiplier (used only when `targetDistance` is omitted). */
      zoomFactor?: number
    }
  | {
      kind: 'focusPan'
      startMs: number
      endMs: number
      /** Smoothly pan from `boundsCenter` onto the opening storey's world `(x, y)` hotspot (m). */
      target: readonly [number, number]
    }
  | {
      kind: 'worldPan'
      startMs: number
      endMs: number
      /** Camera-independent world-space ground displacement `(dx, dy)` in metres. */
      dx: number
      dy: number
    }

export interface StationCameraTourPlan {
  stationId: ExampleStationId
  /** Starting storey elevation (m) set during benchmark preparation. */
  initialLevel: number
  /** Optional starting perspective direction vector (`null` keeps the default isometric angle). */
  initialDirection: readonly [number, number, number] | null
  /** Opening camera distance factor applied after framing the station (matches Regular `2/3`). */
  initialZoom: number
  /** Fallback pose when live camera bounds are not supplied (matches Web `2/3` framing). */
  defaultPose: TourInitialPose
  /** Ordered Q/E storey transitions executed during the 30 s playback window. */
  levelSteps: readonly TourLevelStep[]
  /**
   * Continuous smooth camera motion windows. Motion windows never overlap each other or
   * level switches, so telescoping cosine easing produces identical world poses regardless
   * of frame rate (7 FPS WebGL to 300+ FPS native desktop).
   */
  motions: readonly TourMotionSegment[]
}

export interface CameraTourDelta {
  /** Level transitions whose timestamps fell in `(prevMs, nowMs]`. */
  levelSteps: TourLevelStep[]
  /** Orbit pixel deltas at `TOUR_ORBIT_RADIANS_PER_PIXEL`. */
  orbitDx: number
  orbitDy: number
  /** Multiplicative zoom factor for this frame (`1` when unchanged). */
  zoomFactor: number
  /** Camera-relative planar pan in fractions of visible frustum height. */
  panRightFrac: number
  panForwardFrac: number
}

export interface TourLevelSwitchRecord {
  at: number
  level: number
  key: 'Q' | 'E'
}

/**
 * Station-specific 30-second LOD0 close-up architectural camera tours.
 *
 * Each tour opens briefly at the standard `2/3` framing overview, glides onto the opening
 * storey's architectural centerpiece, **zooms way in (`0.95–3.4 s`) to `D = 13.5 m`** so
 * passengers and station models enter full `LOD0` detail, and then spends the remaining
 * 26.6 seconds panning, orbiting, and toggling levels (`Q`/`E` ±5 m) at `D ∈ [13.2, 14.2] m`
 * without ever degrading to lower LODs or drifting into empty void.
 *
 * Design invariants verified by `game/test/benchmark-camera-tour.test.mjs`:
 * - Every level step is strictly ±5 m (`Q` down / `E` up) between real built storeys.
 * - After the opening zoom-in (`t >= 3.5 s`), distance stays strictly in `[10 m, 15 m]` (LOD0).
 * - Every visited hotspot and pan path sits on dense built cells/modules in the station JSON.
 * - Motion segments never overlap each other or level switches, guaranteeing frame-rate
 *   invariance across 7 FPS WebGL, 60 FPS Web, and 240+ FPS native desktop — and identical
 *   world-space poses across Web (`groundWindow` bounds) and Unity (`StationIndex` bounds).
 */
export const STATION_CAMERA_TOURS: Record<ExampleStationId, StationCameraTourPlan> = {
  zoo: {
    stationId: 'zoo',
    initialLevel: -15,
    initialDirection: [-1, 1, 1],
    initialZoom: 2 / 3,
    defaultPose: { centerX: 67.5, centerY: 12.5, initialDistance: 111.6 },
    levelSteps: [
      { atMs: 10_000, level: -20, key: 'Q', focus: [58, 0] },
      { atMs: 16_700, level: -15, key: 'E', focus: [70, 10] },
      { atMs: 19_600, level: -10, key: 'E', focus: [56, 17] },
      { atMs: 24_600, level: -5, key: 'E', focus: [58, 16] },
      { atMs: 27_200, level: 0, key: 'E', focus: [63, 16] },
    ],
    motions: [
      // Opening glide onto -15 m ticketing & fare-gate hall, then zoom way-in to LOD0 (13.5 m)
      { kind: 'focusPan', startMs: 200, endMs: 900, target: [64, 22] },
      { kind: 'orbitZoom', startMs: 950, endMs: 3_400, yawDeg: 18, pitchDeg: 5, targetDistance: 13.5 },
      // -15 m concourse -> upper Line 5 platform: glide across fare gates onto PSDs & trains
      { kind: 'worldPan', startMs: 3_500, endMs: 7_500, dx: 12, dy: -16 },
      { kind: 'orbitZoom', startMs: 7_700, endMs: 9_600, yawDeg: -38, pitchDeg: -2, targetDistance: 14.2 },
      // -20 m deep platform: sweep dead-center along PSDs, TVs, clock, trains & lift, then orbit
      { kind: 'worldPan', startMs: 10_200, endMs: 14_200, dx: 26, dy: 0 },
      { kind: 'orbitZoom', startMs: 14_400, endMs: 16_300, yawDeg: 44, pitchDeg: 3, targetDistance: 13.2 },
      // -15 m return pass across escalators & ticketing hall
      { kind: 'worldPan', startMs: 16_900, endMs: 19_200, dx: -12, dy: 8 },
      // -10 m concourse convenience shops, vending & escalators
      { kind: 'worldPan', startMs: 19_800, endMs: 22_800, dx: 14, dy: 1 },
      { kind: 'orbitZoom', startMs: 22_900, endMs: 24_200, yawDeg: -28, targetDistance: 14.0 },
      // -5 m upper escalator & stair transfer mezzanine
      { kind: 'worldPan', startMs: 24_800, endMs: 26_800, dx: 18, dy: 0 },
      // 0 m street plaza: glide from Exit B to Exit C past pedestrians & trees
      { kind: 'worldPan', startMs: 27_400, endMs: 29_800, dx: 24, dy: 0 },
    ],
  },
  tanwei: {
    stationId: 'tanwei',
    initialLevel: 10,
    initialDirection: null,
    initialZoom: 2 / 3,
    defaultPose: { centerX: 0.5, centerY: 15.5, initialDistance: 157.8 },
    levelSteps: [
      { atMs: 7_600, level: 5, key: 'Q', focus: [12, 1] },
      { atMs: 13_200, level: 0, key: 'Q', focus: [14, -14] },
      { atMs: 17_200, level: -5, key: 'Q', focus: [16, 6] },
      { atMs: 19_600, level: -10, key: 'Q', focus: [16, 6] },
      { atMs: 26_000, level: -5, key: 'E', focus: [16, 6] },
      { atMs: 27_800, level: 0, key: 'E', focus: [12, 10] },
    ],
    motions: [
      // Opening glide onto +10 m elevated Line 5 platform, then zoom way-in to LOD0 (13.5 m)
      { kind: 'focusPan', startMs: 200, endMs: 900, target: [8, 0] },
      { kind: 'orbitZoom', startMs: 950, endMs: 3_400, yawDeg: 20, pitchDeg: 9, targetDistance: 13.5 },
      // +10 m elevated platform: close sweep along tracks, benches & waiting crowds
      { kind: 'worldPan', startMs: 3_500, endMs: 7_200, dx: 20, dy: 0 },
      // +5 m elevated concourse: pan across 10 fare gates & escalators, then orbit
      { kind: 'worldPan', startMs: 7_800, endMs: 11_000, dx: 16, dy: -1 },
      { kind: 'orbitZoom', startMs: 11_100, endMs: 12_800, yawDeg: -42, pitchDeg: -2, targetDistance: 14.2 },
      // 0 m ground concourse: glide north from south fare gates & shops into transfer atrium
      { kind: 'worldPan', startMs: 13_400, endMs: 16_800, dx: 4, dy: 18 },
      // -5 m underground transfer hall: close orbit
      { kind: 'orbitZoom', startMs: 17_400, endMs: 19_200, yawDeg: 36, pitchDeg: 2, targetDistance: 13.5 },
      // -10 m underground Line 6 platform: full north glide past PSDs, trains & into north gates
      { kind: 'worldPan', startMs: 19_800, endMs: 24_200, dx: 0, dy: 36 },
      { kind: 'orbitZoom', startMs: 24_300, endMs: 25_600, yawDeg: -34, targetDistance: 13.8 },
      // -5 m ascent pass across underground hall
      { kind: 'worldPan', startMs: 26_200, endMs: 27_400, dx: 6, dy: 0 },
      // 0 m street plaza entrance & stairs finale orbit
      { kind: 'orbitZoom', startMs: 28_000, endMs: 29_800, yawDeg: 24, targetDistance: 14.0 },
    ],
  },
  tianhe: {
    stationId: 'tianhe',
    initialLevel: -5,
    initialDirection: null,
    initialZoom: 2 / 3,
    defaultPose: { centerX: 85.5, centerY: -40.0, initialDistance: 266.7 },
    levelSteps: [
      { atMs: 7_800, level: -10, key: 'Q', focus: [-10, -6] },
      { atMs: 14_200, level: -15, key: 'Q', focus: [-10, -84] },
      { atMs: 15_800, level: -20, key: 'Q', focus: [110, -102] },
      { atMs: 22_800, level: -15, key: 'E', focus: [8, -84] },
      { atMs: 24_200, level: -10, key: 'E', focus: [8, -24] },
      { atMs: 26_200, level: -5, key: 'E', focus: [16, -112] },
      { atMs: 28_000, level: 0, key: 'E', focus: [173, -140] },
    ],
    motions: [
      // Opening glide onto -5 m open west concourse fare gates, then zoom way-in to LOD0 (13.5 m)
      { kind: 'focusPan', startMs: 200, endMs: 900, target: [-14, 24] },
      { kind: 'orbitZoom', startMs: 950, endMs: 3_400, yawDeg: 18, pitchDeg: 9, targetDistance: 13.5 },
      // -5 m open west concourse: glide south past fare gates, shops & commuter crowds
      { kind: 'worldPan', startMs: 3_500, endMs: 7_400, dx: 0, dy: -36 },
      // -10 m Line 11/13 west island platform: glide south past lifts, PSDs, escalators & trains
      { kind: 'worldPan', startMs: 8_000, endMs: 12_200, dx: 0, dy: -38 },
      { kind: 'orbitZoom', startMs: 12_300, endMs: 13_900, yawDeg: -42, pitchDeg: -2, targetDistance: 14.0 },
      // -15 m open west triple-escalator well: quick transit orbit into deep Line 21
      { kind: 'orbitZoom', startMs: 14_400, endMs: 15_600, yawDeg: 24, pitchDeg: 2, targetDistance: 13.5 },
      // -20 m deep Line 21 platform: long close glide east past benches, TVs, escalators, PSDs & trains
      { kind: 'worldPan', startMs: 16_000, endMs: 20_600, dx: 48, dy: 0 },
      { kind: 'orbitZoom', startMs: 20_700, endMs: 22_500, yawDeg: 46, pitchDeg: 0, targetDistance: 13.5 },
      // -15 m east triple-escalator well: quick ascent transit
      { kind: 'orbitZoom', startMs: 23_000, endMs: 24_000, yawDeg: -20, targetDistance: 13.8 },
      // -10 m east Line 11/13 island platform: smooth north glide past PSDs & crowds
      { kind: 'worldPan', startMs: 24_400, endMs: 26_000, dx: 0, dy: 16 },
      // -5 m south concourse 14-fare-gate hall glide
      { kind: 'worldPan', startMs: 26_400, endMs: 27_800, dx: -12, dy: 0 },
      // 0 m Tianhe Park exit entrance: close orbit over pedestrians, escalators, sidewalk & lawn
      { kind: 'orbitZoom', startMs: 28_200, endMs: 29_800, yawDeg: 28, pitchDeg: -2, targetDistance: 14.2 },
    ],
  },
}

export function cameraTourPlanFor(stationId: ExampleStationId): StationCameraTourPlan {
  return STATION_CAMERA_TOURS[stationId]
}

function clampUnit(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value
}

function cosineEase(u: number): number {
  const c = clampUnit(u)
  return 0.5 - 0.5 * Math.cos(Math.PI * c)
}

function segmentDelta(startMs: number, endMs: number, prevMs: number, nowMs: number): number {
  if (endMs <= startMs || nowMs <= startMs || prevMs >= endMs || nowMs <= prevMs) return 0
  const span = endMs - startMs
  const uPrev = (prevMs - startMs) / span
  const uNow = (nowMs - startMs) / span
  return cosineEase(uNow) - cosineEase(uPrev)
}

function resolveInitialPose(plan: StationCameraTourPlan, input?: Partial<TourInitialPose>): TourInitialPose {
  return {
    centerX: typeof input?.centerX === 'number' && Number.isFinite(input.centerX) ? input.centerX : plan.defaultPose.centerX,
    centerY: typeof input?.centerY === 'number' && Number.isFinite(input.centerY) ? input.centerY : plan.defaultPose.centerY,
    initialDistance:
      typeof input?.initialDistance === 'number' && Number.isFinite(input.initialDistance) && input.initialDistance > 0
        ? input.initialDistance
        : plan.defaultPose.initialDistance,
  }
}

/**
 * Stateful cursor advancing a station's deterministic LOD0 close-up camera tour from
 * wall-clock elapsed ms.
 *
 * Pre-resolving each segment's zoom factor and world-space displacement against the live
 * starting pose ensures both Web (`groundWindow` bounds) and Unity (`StationIndex` bounds)
 * converge to the exact same close-up distance (`D ≈ 13.5 m`) and world `(x, y)` hotspots
 * regardless of frame cadence (7 FPS to 300+ FPS).
 */
export class CameraTourDriver {
  readonly plan: StationCameraTourPlan
  readonly pose: TourInitialPose
  private lastElapsedMs = 0
  private nextLevelIdx = 0
  private theta: number
  private distance: number
  private readonly resolvedZoom: number[]
  private readonly resolvedPan: Array<{ dx: number; dy: number }>

  constructor(stationId: ExampleStationId, initialPose?: Partial<TourInitialPose>) {
    this.plan = cameraTourPlanFor(stationId)
    this.pose = resolveInitialPose(this.plan, initialPose)
    const dir = this.plan.initialDirection ?? DEFAULT_ISO_DIRECTION
    this.theta = Math.atan2(dir[1], dir[0])
    this.distance = this.pose.initialDistance

    let simDist = this.pose.initialDistance
    this.resolvedZoom = this.plan.motions.map((seg) => {
      if (seg.kind !== 'orbitZoom') return 1
      if (typeof seg.targetDistance === 'number' && Number.isFinite(seg.targetDistance) && seg.targetDistance > 0) {
        const factor = seg.targetDistance / simDist
        simDist = seg.targetDistance
        return factor
      }
      if (typeof seg.zoomFactor === 'number' && Number.isFinite(seg.zoomFactor) && seg.zoomFactor > 0) {
        simDist *= seg.zoomFactor
        return seg.zoomFactor
      }
      return 1
    })

    this.resolvedPan = this.plan.motions.map((seg) => {
      if (seg.kind === 'focusPan') {
        return { dx: seg.target[0] - this.pose.centerX, dy: seg.target[1] - this.pose.centerY }
      }
      if (seg.kind === 'worldPan') {
        return { dx: seg.dx, dy: seg.dy }
      }
      return { dx: 0, dy: 0 }
    })
  }

  /** Current tracked camera-to-target distance in metres (for diagnostics and tests). */
  currentDistance(): number {
    return this.distance
  }

  advance(elapsedMs: number): CameraTourDelta {
    const prevMs = this.lastElapsedMs
    const nowMs = Number.isFinite(elapsedMs) ? Math.max(prevMs, elapsedMs) : prevMs
    this.lastElapsedMs = nowMs

    const levelSteps: TourLevelStep[] = []
    while (
      this.nextLevelIdx < this.plan.levelSteps.length &&
      this.plan.levelSteps[this.nextLevelIdx]!.atMs <= nowMs
    ) {
      levelSteps.push(this.plan.levelSteps[this.nextLevelIdx]!)
      this.nextLevelIdx++
    }

    let orbitDx = 0
    let orbitDy = 0
    let zoomFactor = 1

    // Apply orbit & zoom first so the screen-space pan conversion below uses the exact
    // post-orbit/post-zoom camera basis (matching route execution order: level -> orbit -> zoom -> pan).
    for (let i = 0; i < this.plan.motions.length; i++) {
      const seg = this.plan.motions[i]!
      if (seg.kind !== 'orbitZoom') continue
      const du = segmentDelta(seg.startMs, seg.endMs, prevMs, nowMs)
      if (du <= 0) continue
      if (seg.yawDeg) {
        const yawRad = ((seg.yawDeg * Math.PI) / 180) * du
        orbitDx += yawRad / TOUR_ORBIT_RADIANS_PER_PIXEL
        // Matches `offset.applyAxisAngle(+Z, -dxPx * 0.008)` in Web & Unity.
        this.theta -= yawRad
      }
      if (seg.pitchDeg) {
        orbitDy += ((seg.pitchDeg * Math.PI) / 180) * du / TOUR_ORBIT_RADIANS_PER_PIXEL
      }
      const segZoom = this.resolvedZoom[i]!
      if (segZoom !== 1) {
        const stepZoom = Math.pow(segZoom, du)
        zoomFactor *= stepZoom
        this.distance *= stepZoom
      }
    }

    let moveX = 0
    let moveY = 0
    if (levelSteps.length > 0) {
      // Every level switch calls `frame()`, resetting camera target XY to `(centerX, centerY)`.
      // Jump straight to the target storey's hotspot plus any pan that begins after `lastStep.atMs`.
      const lastStep = levelSteps[levelSteps.length - 1]!
      moveX = lastStep.focus[0] - this.pose.centerX
      moveY = lastStep.focus[1] - this.pose.centerY
      for (let i = 0; i < this.plan.motions.length; i++) {
        const seg = this.plan.motions[i]!
        if (seg.kind === 'orbitZoom') continue
        const du = segmentDelta(seg.startMs, seg.endMs, lastStep.atMs, nowMs)
        if (du <= 0) continue
        moveX += this.resolvedPan[i]!.dx * du
        moveY += this.resolvedPan[i]!.dy * du
      }
    } else {
      for (let i = 0; i < this.plan.motions.length; i++) {
        const seg = this.plan.motions[i]!
        if (seg.kind === 'orbitZoom') continue
        const du = segmentDelta(seg.startMs, seg.endMs, prevMs, nowMs)
        if (du <= 0) continue
        moveX += this.resolvedPan[i]!.dx * du
        moveY += this.resolvedPan[i]!.dy * du
      }
    }

    let panRightFrac = 0
    let panForwardFrac = 0
    if (moveX !== 0 || moveY !== 0) {
      const span = TOUR_TWO_TAN_HALF_FOV * Math.max(1e-3, this.distance)
      const cosT = Math.cos(this.theta)
      const sinT = Math.sin(this.theta)
      // Camera looks along `forward = (-cosT, -sinT)`; `right = (forward.y, -forward.x) = (-sinT, cosT)`.
      panRightFrac = (-moveX * sinT + moveY * cosT) / span
      panForwardFrac = (-moveX * cosT - moveY * sinT) / span
    }

    return { levelSteps, orbitDx, orbitDy, zoomFactor, panRightFrac, panForwardFrac }
  }
}
