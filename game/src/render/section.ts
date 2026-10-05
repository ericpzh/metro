// The 剖切 section — the pure arithmetic of the cut surface.
//
// 剖切 used to be one fixed plane through the middle of the station's bounds,
// facing +y: a toggle with nothing to set. It is now a *placed* surface — a
// location along its own normal, an azimuth and an elevation — so the plane,
// the highlighted surface drawn on it, the ray that snaps the pointer onto it
// and the drag that slides it all have to agree on one definition. That
// definition lives here, free of three.js, so `game/test/section.test.mjs` can
// pin it.
//
// Conventions (GAME-SPEC §4.1: `+z` up, `n` is `+y`, `e` is `+x`):
//
// * `azimuth` is the compass angle of the direction the cut looks in the
//   horizontal plane, measured from `+y` toward `+x`, in degrees. It is the
//   **view angle**: 0° looks north, 90° looks east.
// * `elevation` tilts that look up out of the horizontal plane, in degrees: 0 is
//   a vertical wall, +90 looks straight down from above, -90 straight up from
//   below.
// * `offset` is the signed distance from the section origin (`anchor`) to the
//   cut. It is measured **back along the look**: `+` slides the surface away
//   from what it faces — up a window looking north, down through a ceiling
//   looking down — so the number always means "how far past the anchor", never
//   "which way in z".
//
// The plane keeps everything on the **origin side**: `dot(normal, p - cut) <= 0`.
// Three.js' `THREE.Plane` is `dot(normal, p) + constant >= 0`, so `constant` is
// `-dot(normal, cut)`. `planeConstant` is that number, and `SectionSystem` is
// its only consumer.

/** A point or direction on the station grid. */
export type Vec3 = readonly [number, number, number]

/** Which way the cut surface faces (§ above). */
export interface SectionOrientation {
  /** Degrees, 0 = looking `+y`, 90 = looking `+x`. */
  azimuth: number
  /** Degrees, 0 = a vertical wall, ±90 = looking down / up. */
  elevation: number
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

export const DEFAULT_SECTION_AZIMUTH = 0
export const DEFAULT_SECTION_ELEVATION = 0

const DEG = Math.PI / 180

export function defaultOrientation(): SectionOrientation {
  return { azimuth: DEFAULT_SECTION_AZIMUTH, elevation: DEFAULT_SECTION_ELEVATION }
}

/**
 * The surface's outward normal — the way the cut **looks**, and so the axis the
 * slide runs along. Exactly (0, 1, 0) at the defaults, which is what makes a
 * fresh 剖切 slide north–south the way the old fixed plane did: the plane's
 * origin side (the half it keeps) is the −y half, behind the surface.
 */
export function sectionNormal(o: SectionOrientation): Vec3 {
  const a = o.azimuth * DEG
  const e = o.elevation * DEG
  const cos = Math.cos(e)
  return [Math.sin(a) * cos, Math.cos(a) * cos, -Math.sin(e)]
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

/** The surface's local Y: `normal` × `right`, so the quad's height is the tilt. */
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
 * offset grows, and one looking down walks down — one sign, read as "further
 * than the anchor in the direction the surface looks", rather than one per axis.
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
 * The world coordinate the cut surface reads as: the axis the normal leans on
 * most, and the surface's value on it. A default section reads as its `y`.
 */
export function sectionCoord(s: Section): { axis: 'x' | 'y' | 'z'; value: number } {
  const n = sectionNormal(s.orientation)
  const p = sectionPoint(s)
  const ax = Math.abs(n[0])
  const ay = Math.abs(n[1])
  const az = Math.abs(n[2])
  if (az >= ax && az >= ay) return { axis: 'z', value: p[2] }
  if (ax >= ay) return { axis: 'x', value: p[0] }
  return { axis: 'y', value: p[1] }
}

/** `+1.5 m · Y 3.0` — the offset, and the world line the surface has reached. */
export function formatSection(s: Section): string {
  const off = s.offset === 0 ? '0.0' : `${s.offset > 0 ? '+' : '−'}${Math.abs(s.offset).toFixed(1)}`
  const c = sectionCoord(s)
  const v = c.value
  const world = `${c.axis.toUpperCase()} ${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`
  return `${off} m · ${world}`
}

/**
 * How big to draw the highlight: the station's own plan, a little proud of it,
 * so the surface always reaches past the building it cuts. `size` is a
 * half-extent in metres (the quad is `2 × size` square), `thickness` the depth
 * of the section fill slab the cut exposes.
 */
export function sectionHighlightSize(size: Vec3): number {
  return Math.max(6, Math.hypot(size[0], size[1], size[2]) * 0.6)
}
