import * as THREE from 'three'
import { PieceBuilder, slab, plate, placeLocal } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'
import { DESK_HEIGHT } from '../../../sim/constants.ts'

/** Control-room workstation, with the chair tucked into its own cell (§5.7). */
export class DeskModel extends PieceBuilder {
  readonly kind = 'desk'
  build(mod: Extract<Module, { type: 'desk' }>): THREE.Group {
    const g = new THREE.Group(), mats = this.ctx.mats
    slab(g, mats.white, 0, -0.18, 0.74, 0.98, 0.6, 0.045).name = 'desktop'
    slab(g, mats.darkSteel, 0, -0.18, 0.711, 0.96, 0.58, 0.012)
    // End panels and a modesty panel leave the knee space open on the chair side.
    for (const x of [-0.44, 0.44]) {
      slab(g, mats.white, x, -0.2, 0.36, 0.055, 0.52, 0.7).name = 'desk-end-panel'
      slab(g, mats.rubber, x, -0.2, 0.035, 0.07, 0.5, 0.04)
    }
    slab(g, mats.darkSteel, 0, -0.43, 0.43, 0.84, 0.025, 0.42).name = 'modesty-panel'
    slab(g, mats.white, -0.325, -0.22, 0.52, 0.16, 0.36, 0.37).name = 'drawer-pedestal'
    for (const z of [0.43, 0.58]) slab(g, mats.darkSteel, -0.325, -0.031, z, 0.07, 0.012, 0.012)
    slab(g, mats.darkSteel, 0, -0.425, 0.89, 0.84, 0.035, 0.24).name = 'cable-partition'
    // Both widescreen monitors face the operator; ink sits outside each bezel.
    for (const x of [-0.225, 0.225]) {
      slab(g, mats.rubber, x, -0.24, 0.78, 0.2, 0.14, 0.025)
      slab(g, mats.darkSteel, x, -0.265, 0.88, 0.035, 0.035, 0.19)
      slab(g, mats.rubber, x, -0.245, DESK_HEIGHT - 0.135, 0.42, 0.045, 0.27).name = 'monitor-housing'
      plate(g, mats.desktopScreen, 0.38, 0.225, x, -0.221, DESK_HEIGHT - 0.135, Math.PI).name = 'monitor-screen'
    }
    slab(g, mats.rubber, -0.07, 0.022, 0.775, 0.31, 0.115, 0.022).name = 'keyboard'
    for (let row = 0; row < 3; row++) slab(g, mats.darkSteel, -0.07, -0.012 + row * 0.03, 0.788, 0.275, 0.009, 0.004)
    slab(g, mats.darkSteel, 0.22, 0.025, 0.766, 0.14, 0.15, 0.006).name = 'mouse-pad'
    slab(g, mats.rubber, 0.22, 0.02, 0.782, 0.046, 0.067, 0.027).name = 'mouse'
    slab(g, mats.white, -0.34, 0.015, 0.766, 0.14, 0.16, 0.006).name = 'paperwork'
    // An open mesh chair with armrests, casters and a five-star base.
    const chairY = 0.265
    slab(g, mats.darkSteel, 0, chairY, 0.28, 0.055, 0.055, 0.39)
    for (let i = 0; i < 5; i++) {
      const angle = i * Math.PI * 2 / 5
      const spoke = slab(g, mats.darkSteel, Math.sin(angle) * 0.095, chairY + Math.cos(angle) * 0.095, 0.085, 0.035, 0.22, 0.035)
      spoke.rotation.z = -angle
      slab(g, mats.rubber, Math.sin(angle) * 0.195, chairY + Math.cos(angle) * 0.195, 0.035, 0.05, 0.05, 0.07).name = 'chair-caster'
    }
    slab(g, mats.rubber, 0, chairY, 0.455, 0.35, 0.33, 0.07).name = 'chair-seat'
    for (const x of [-0.17, 0.17]) {
      slab(g, mats.rubber, x, 0.445, 0.73, 0.025, 0.026, 0.48)
      slab(g, mats.darkSteel, x, chairY, 0.555, 0.018, 0.025, 0.17)
      slab(g, mats.rubber, x, chairY, 0.635, 0.045, 0.22, 0.025).name = 'chair-armrest'
    }
    for (const z of [0.5, 0.96]) slab(g, mats.rubber, 0, 0.445, z, 0.35, 0.03, 0.035)
    for (let i = 0; i < 10; i++) slab(g, mats.darkSteel, 0, 0.445, 0.535 + i * 0.04, 0.32, 0.012, 0.018).name = 'chair-mesh'
    // Default approach is −y, matching other floor furniture and the rail preview.
    g.rotation.z = Math.PI
    const placed = new THREE.Group()
    placed.add(g)
    return placeLocal(placed, mod)
  }
}

