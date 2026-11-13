// The ViewCube's viewport adapter. The widget itself only ever draws the cube and
// asks an adapter for what it cannot know: which way the live camera is looking, what
// projection and lens it is drawing through, and how to orbit, snap, home, change the
// lens/projection and hold the vertical pan.
//
// Two implementations exist:
//
// * `createThreeViewCubeAdapter` (here) keeps the existing Three entry working by
//   forwarding to `SceneRenderer` — the direct `sceneRef` calls the widget used to
//   make are now made here, in one place.
// * `game/src/unity-web/cameraAdapter.ts` (packet D2) speaks the Unity snapshot and
//   command bridge instead. It is a plain transport: it never touches a Three camera.
//
// The orientation contract is **document axes** — the save axes, `x` plan x, `y` plan y,
// `z` elevation. The cube dots its six face normals (also document axes) against
// `back`, and projects through `right`/`up`. Unity's world is `(x, elevation, y)`, a
// reflection of document space, so publishing `right/up/back = -forward` in document
// axes is what keeps the widget from mistaking the handedness change for a quaternion
// component swap.

import { useStore } from './store.ts'
import { goHomeView } from './viewHome.ts'
import { DEFAULT_FOV, PAN_DOWN, PAN_UP } from '../render/scene.ts'
import type { SceneRenderer } from '../render/scene.ts'
import type { RefObject } from 'react'
import * as THREE from 'three'

/** A document-space direction: `[x, y, z]` with `z` elevation. */
export type CubeVector = readonly [number, number, number]
export type CubeProjection = 'perspective' | 'orthographic'

/** Everything the cube needs to draw, in document axes. */
export interface CubeViewState {
  /** Screen-right of the rendered camera, in document axes. */
  right: CubeVector
  /** Screen-up of the rendered camera, in document axes. */
  up: CubeVector
  /** `-forward`: the direction from the station toward the eye. */
  back: CubeVector
  projection: CubeProjection
  /** The perspective lens the camera actually has, in degrees. */
  fov: number
  activeLevel?: number
}

/**
 * The viewport port the widget talks to. `read` is synchronous and may return null
 * before a renderer/station exists; `subscribe` pushes every orientation/lens change
 * (the Three adapter polls the live camera on `requestAnimationFrame`, the Unity
 * adapter listens to bridge snapshots). All command methods are no-ops without a live
 * viewport.
 */
export interface ViewCubeAdapter {
  read(): CubeViewState | null
  subscribe(listener: (state: CubeViewState) => void): () => void
  /** Orbit from a pointer drag, in CSS pixels, the cube's own rate. */
  orbit(deltaX: number, deltaY: number): void
  /** Snap to a face/edge (orthographic) or corner (perspective) direction. */
  snap(direction: CubeVector, projection: CubeProjection): void
  /** 回到默认视角: iso preset, perspective, the default lens. */
  home(): void
  setProjection(projection: CubeProjection): void
  setFov(degrees: number): void
  /** Start holding the vertical pan (the arrows and Ctrl+Q / Ctrl+E share it). */
  beginHeldPan(direction: -1 | 1): void
  /**
   * Advance a held pan by `seconds`. Adapters whose renderer already integrates the
   * hold per frame (Three) or whose host ticks it (Unity) ignore this; it exists so a
   * viewport without its own clock can be driven from the widget's frame loop.
   */
  updateHeldPan(seconds: number): void
  endHeldPan(): void
  dispose(): void
}

/** The neutral basis before a viewport reports: a camera looking down document −y. */
export const DEFAULT_CUBE_VIEW: CubeViewState = {
  right: [1, 0, 0],
  up: [0, 1, 0],
  back: [0, 0, 1],
  projection: 'perspective',
  fov: DEFAULT_FOV,
  activeLevel: 0,
}

/** Structural equality, so an idle camera does not re-render the widget. */
export function cubeViewEqual(a: CubeViewState | null, b: CubeViewState | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.projection === b.projection &&
    Math.round(a.fov) === Math.round(b.fov) &&
    a.activeLevel === b.activeLevel &&
    vectorEqual(a.right, b.right) &&
    vectorEqual(a.up, b.up) &&
    vectorEqual(a.back, b.back)
}

function vectorEqual(a: CubeVector, b: CubeVector): boolean {
  return Math.abs(a[0] - b[0]) < 1e-5 &&
    Math.abs(a[1] - b[1]) < 1e-5 &&
    Math.abs(a[2] - b[2]) < 1e-5
}

/** The rendered camera's document-space basis, from the Three camera quaternion. */
export function cubeBasisFromQuaternion(quaternion: THREE.Quaternion): Pick<CubeViewState, 'right' | 'up' | 'back'> {
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion)
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion)
  const back = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion)
  return {
    right: [right.x, right.y, right.z],
    up: [up.x, up.y, up.z],
    back: [back.x, back.y, back.z],
  }
}

/**
 * The Three entry's adapter: every action is the call the widget made directly before
 * this refactor, kept together so the SVG and all interaction/visual behaviour stay
 * untouched.
 */
export function createThreeViewCubeAdapter(sceneRef: RefObject<SceneRenderer | null>): ViewCubeAdapter {
  let disposed = false

  const read = (): CubeViewState | null => {
    const scene = sceneRef.current
    if (!scene || disposed) return null
    const state = useStore.getState()
    return {
      ...cubeBasisFromQuaternion(scene.camera.quaternion),
      projection: state.ortho ? 'orthographic' : 'perspective',
      fov: scene.fov(),
      activeLevel: state.activeZ,
    }
  }

  const clearPan = (): void => {
    const keys = sceneRef.current?.keys
    if (!keys) return
    keys.delete(PAN_UP)
    keys.delete(PAN_DOWN)
  }

  return {
    read,
    subscribe(listener) {
      let frame = 0
      let last: CubeViewState | null = null
      const tick = (): void => {
        frame = requestAnimationFrame(tick)
        const state = read()
        if (!state || cubeViewEqual(state, last)) return
        last = state
        listener(state)
      }
      frame = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(frame)
    },
    orbit(deltaX, deltaY) {
      sceneRef.current?.orbitBy(deltaX, deltaY)
    },
    snap(direction, projection) {
      const scene = sceneRef.current
      if (!scene) return
      scene.setViewDirection(new THREE.Vector3(direction[0], direction[1], direction[2]), projection === 'orthographic')
      // The source face/edge/corner clicks choose the projection as a side effect of
      // the view; the rail's flag follows so the next preset starts from the truth.
      useStore.getState().setOrtho(projection === 'orthographic')
    },
    home() {
      goHomeView(sceneRef.current)
    },
    setProjection(projection) {
      const scene = sceneRef.current
      const orthographic = projection === 'orthographic'
      scene?.setOrtho(orthographic)
      // The live scene is written immediately; the store follows so a later preset or
      // home view starts from the truth (the widget used to do both calls itself).
      useStore.getState().setOrtho(orthographic)
    },
    setFov(degrees) {
      sceneRef.current?.setFov(degrees)
    },
    beginHeldPan(direction) {
      const keys = sceneRef.current?.keys
      if (!keys) return
      keys.delete(PAN_UP)
      keys.delete(PAN_DOWN)
      keys.add(direction > 0 ? PAN_UP : PAN_DOWN)
    },
    updateHeldPan() {
      // The Three scene integrates the PAN_UP/PAN_DOWN token every frame.
    },
    endHeldPan: clearPan,
    dispose() {
      if (disposed) return
      disposed = true
      clearPan()
    },
  }
}
