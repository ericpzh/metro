// The 剖切 section — the pure arithmetic of the cut surface.
//
// 剖切 used to be one fixed plane through the middle of the station's bounds,
// facing +y: a toggle with nothing to set. It is now a *placed* surface — a
// location along its own normal and a quarter-turn orientation — so the plane,
// the highlighted surface drawn on it, the ray that snaps the pointer onto it
// and the drag that slides it all have to agree on one definition. That
// definition lives here, free of three.js, so `game/test/section.test.mjs` can
// pin it.
//
// Conventions (GAME-SPEC §4.1: `+z` up, `n` is `+y`, `e` is `+x`):
//
// * `azimuth` is the compass angle of the direction the cut looks in the
//   horizontal plane, measured from `+y` toward `+x`, in degrees. It is the
//   **view angle**: 0° looks north, 90° looks east. It is a **quarter turn** —
//   0, 90, 180 or 270 (`QUARTER_TURNS`) — because the cut is a wall through a
//   block grid: the 旋转 tile steps it one quarter at a time, and the surface is
//   never tilted out of the vertical.
// * `offset` is the signed distance from the section origin (`anchor`) to the
//   cut. It is measured **back along the look**: `+` slides the surface away
//   from what it faces, so the number always means "how far past the anchor".
//
// The plane keeps everything on the **origin side**: `dot(normal, p - cut) <= 0`.
// Three.js' `THREE.Plane` is `dot(normal, p) + constant >= 0`, so `constant` is
// `-dot(normal, cut)`. `planeConstant` is that number, and `SectionSystem` is
// its only consumer.

/** A point or direction on the station grid. */
export type Vec3 = readonly [number, number, number]

/** Which way the cut surface faces: north, east, south or west. */
export interface SectionOrientation {
  /** Degrees, a quarter turn: 0 = looking `+y`, 90 = looking `+x`, and so on. */
  azimuth: number
}

/** One 剖切 surface: where it started, how it is turned, how far it has slid. */
export interface Section {
  /** The station-space point the slice was placed at — the offset's zero. */
  anchor: Vec3
  orientation: SectionOrientation
  /** Metres along the normal from `anchor`. */
  offset: number
}

/** The horizontal step the slide snaps to, and the fine step Shift asks for. */
export const SECTION_SNAP = 0.5
export const SECTION_SNAP_FINE = 0.05

/** The only four looks the cut takes: one per quarter turn of 旋转 (R). */
export const QUARTER_TURNS = [0, 90, 180, 270] as const

/** A fresh cut looks north, the way the old fixed plane did. */
export const DEFAULT_SECTION_AZIMUTH = 0

const DEG = Math.PI / 180

/**
 * The next look a 旋转 press asks for: one quarter turn clockwise, wrapping at
 * 270. The angle is snapped into the quarter turns first, so a section saved with
 * an off-grid azimuth (an older document) lands back on the grid in one press.
 */
export function nextAzimuth(azimuth: number): number {
  const from = QUARTER_TURNS.reduce((best, turn) => (Math.abs(turn - azimuth) < Math.abs(best - azimuth) ? turn : best), QUARTER_TURNS[0])
  return (from + 90) % 360
}

/**
 * The surface's outward normal — the way the cut **looks**, and so the axis the
 * slide runs along. Exactly (0, 1, 0) at the default, which is what makes a
 * fresh 剖切 slide north–south the way the old fixed plane did: the plane's
 * origin side (the half it keeps) is the −y half, behind the surface.
 */
export function sectionNormal(o: SectionOrientation): Vec3 {
  const a = o.azimuth * DEG
  return [Math.sin(a), Math.cos(a), 0]
}

/**
 * The horizontal in-plane axis: `+z` × normal, normalised. It is the surface's
 * local X, so the highlight quad's width lies north–south at the defaults.
 */
export function sectionRight(n: Vec3): Vec3 {
  // (0, 0, 1) × (x, y, z) = (-y, x, 0)
  const x = -n[1]
  const y = n[0]
  const len = Math.hypot(x, y)
  // Looking straight down or up the normal has no horizontal part, so any
  // horizontal line will do: +x keeps the quad's frame defined rather than NaN.
  if (len < 1e-9) return [1, 0, 0]
  return [x / len, y / len, 0]
}

/** The surface's local Y: `normal` × `right` — vertical for every quarter turn. */
export function sectionUp(n: Vec3, right: Vec3): Vec3 {
  return [
    n[1] * right[2] - n[2] * right[1],
    n[2] * right[0] - n[0] * right[2],
    n[0] * right[1] - n[1] * right[0],
  ]
}

/**
 * Where the cut surface stands, in station space: the anchor walked **the way
 * the surface faces** by the offset. A cut looking north walks north as the
 * offset grows — one sign, read as "further than the anchor in the direction the
 * surface looks", rather than one per axis.
 */
export function sectionPoint(s: Section): Vec3 {
  const n = sectionNormal(s.orientation)
  return [s.anchor[0] + n[0] * s.offset, s.anchor[1] + n[1] * s.offset, s.anchor[2] + n[2] * s.offset]
}

/**
 * The plane constant for `THREE.Plane`. A `THREE.Plane` *keeps* the half where
 * `dot(normal, p) + constant >= 0`, and the half this surface keeps is the one
 * **behind** it — everything the cut has not yet reached — so with the normal
 * pointing the way the surface faces the kept half is `dot(normal, p) <= d`,
 * which is three's `dot(normal, p) − d >= 0`: the constant is `+d`, the
 * distance from the world origin to the cut along the normal.
 *
 * The sign is the whole of it. Built the other way round the plane keeps the
 * half it *faces*, which puts the cut's kept side on the far side of the
 * camera and cuts the room away in front of the player.
 */
export function planeConstant(s: Section): number {
  const n = sectionNormal(s.orientation)
  const p = sectionPoint(s)
  return n[0] * p[0] + n[1] * p[1] + n[2] * p[2]
}

/** Snap a slide distance: 0.5 m steps, 5 cm while Shift is held. */
export function snapOffset(value: number, fine = false): number {
  const step = fine ? SECTION_SNAP_FINE : SECTION_SNAP
  return Math.round(value / step) * step
}

/**
 * The offset a drag asks for, from where the pointer started and where it is
 * now. Both points lie on the plane the grab was measured in, so the pointer's
 * walk along the normal is exactly how far the surface should move: dragging
 * the sheet the way it faces increases the offset, and dragging it back
 * decreases it. Only the normal component counts — a pointer moving sideways
 * across the sheet moves the cut nowhere.
 */
export function slideOffset(current: number, from: Vec3, hit: Vec3, orient: SectionOrientation): number {
  const n = sectionNormal(orient)
  return current + n[0] * (hit[0] - from[0]) + n[1] * (hit[1] - from[1]) + n[2] * (hit[2] - from[2])
}

/**
 * What a drag asks for, from the pointer's travel on screen: the step along the
 * axis the cut slides, converted to metres.
 *
 * `axis` is the direction the cut slides as it appears **on screen** (a unit
 * vector in canvas pixels) and `span` how many pixels one metre of it covers, so
 * `walked / span` is metres however the camera is aimed. A pointer step across
 * the axis contributes nothing, which is the rule the mode is for: the cut only
 * ever moves the way 旋转 points it.
 */
export function dragOffset(startOffset: number, walked: number, span: number): number {
  if (!(span > 0)) return startOffset
  return startOffset + walked / span
}

/**
 * How far the pointer walked along a screen axis, in pixels. Both points are
 * pointer positions; `axis` is the slice's own axis on screen (`dragOffset`).
 */
export function walkAlong(start: readonly [number, number], now: readonly [number, number], axis: readonly [number, number]): number {
  return (now[0] - start[0]) * axis[0] + (now[1] - start[1]) * axis[1]
}

/**
 * How big to draw the highlight: the station's own plan, a little proud of it,
 * so the surface always reaches past the building it cuts. `size` is a
 * half-extent in metres (the quad is `2 × size` square).
 */
export function sectionHighlightSize(size: Vec3): number {
  return Math.max(6, Math.hypot(size[0], size[1], size[2]) * 0.6)
}
