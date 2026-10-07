// The station view's light rig and renderer settings, in one place.
//
// Everything the game draws outside the live scene — the build rail's icons, the zone
// palette, and the passes that photograph pieces into the concept sheets — used to set
// up its own lights and its own tone mapping. That is a second renderer by another name,
// and it drifted exactly as far as you would expect: the captures ran a four-light rig
// with **ACES tone mapping** where the station runs one key plus ambient plus a soft
// fill and no tone mapping at all. A car's paint came out charcoal on the sheets and
// pale in the station, and the art was photographing a rig the player never sees.
//
// GAME-SPEC §2.3 item 3 specifies the rig once, so it is written once, here, and the
// station and every capture read it from the same place.

import * as THREE from 'three'

/** The station view's own clear colour — the dark the world sits in. */
export const STATION_CLEAR = 0x0b0f16

/**
 * The renderer settings the station view runs with.
 *
 * `alpha` is the one thing a caller may vary: a capture that has to composite into a
 * drawing clears to nothing, where the station clears to its own dark. Everything else
 * — the colour space, and the **absence** of tone mapping — is the station's, because a
 * capture that tone mapped was compressing the mid-tones a painted car lives in.
 */
export function applyStationRenderer(renderer: THREE.WebGLRenderer, { alpha = 1 } = {}): void {
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.setClearColor(STATION_CLEAR, alpha)
}

/**
 * One key + ambient + a soft fill (§2.3 item 3).
 *
 * The positions are the station's, so a piece built at the world origin — which is where
 * every capture builds one — is lit the way it is lit standing in the station.
 */
export function addStationLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2f39, 1.15))
  const key = new THREE.DirectionalLight(0xfff3e0, 1.5)
  key.position.set(60, -80, 120)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xbcd2ff, 0.45)
  fill.position.set(-70, 60, 40)
  scene.add(fill)
  scene.add(new THREE.AmbientLight(0xffffff, 0.8))
}
