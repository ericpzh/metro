// Ticket vending machine (售票机) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, canvasTexture, slab, plate, ownedMaterial, placeLocalAtEdge } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'

/** The 车票 / Ticket marquee above a TVM, and the exit's signage. */
function signCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#12181f'
  g.fillRect(0, 0, 256, 64)
  g.strokeStyle = '#e8b23a'
  g.lineWidth = 3
  g.strokeRect(40, 6, 56, 52)
  g.fillStyle = '#e8b23a'
  g.font = 'bold 30px "Microsoft YaHei", sans-serif'
  g.fillText('车票', 48, 46)
  g.fillStyle = '#eef1f4'
  g.font = 'bold 22px sans-serif'
  g.fillText('Ticket', 118, 42)
  return c
}

/* ------------------------------------------------------------------- TVM */

/** Stainless cabinet with a projecting, upward-facing console (§5.2). */
function buildTvm(ctx: ModuleContext): THREE.Group {
  const mats = ctx.mats
  const g = new THREE.Group()
  const navy = ownedMaterial(ctx, new THREE.MeshStandardMaterial({ color: 0x243c85, roughness: 0.55 }))

  // The whole cabinet follows the console profile: merely tilting a screen
  // against a rectangular body leaves it buried in the front face.
  const profile = new THREE.Shape()
  profile.moveTo(-0.3, 0.1)
  profile.lineTo(0.3, 0.1)
  profile.lineTo(0.3, 1.84)
  profile.lineTo(-0.14, 1.84)
  profile.lineTo(-0.14, 1.36)
  profile.lineTo(-0.3, 0.86)
  profile.closePath()
  const shell = new THREE.ExtrudeGeometry(profile, { depth: 0.72, bevelEnabled: false })
  // Shape coordinates are (depth, height); extrusion runs across the cabinet.
  shell.rotateX(Math.PI / 2)
  shell.rotateZ(Math.PI / 2)
  shell.translate(-0.36, 0, 0)
  g.add(new THREE.Mesh(shell, mats.binSteel))
  slab(g, mats.darkSteel, 0, 0, 0.055, 0.74, 0.62, 0.11)
  slab(g, mats.steel, 0, -0.308, 0.16, 0.68, 0.018, 0.07)

  const tilt = Math.atan2(0.16, 0.5)
  const console = new THREE.Group()
  console.position.set(0, -0.22, 1.11)
  console.rotation.x = -tilt
  g.add(console)
  const consoleHeight = Math.hypot(0.5, 0.16)
  slab(console, mats.steel, 0, -0.009, 0, 0.68, 0.018, consoleHeight)
  slab(console, navy, 0, -0.021, 0, 0.64, 0.01, consoleHeight - 0.025)
  // Screen and payment hardware share one slope, including their bezels.
  slab(console, mats.black, -0.095, -0.038, 0.015, 0.39, 0.024, 0.35)
  slab(console, mats.steel, -0.095, -0.052, 0.015, 0.355, 0.007, 0.317)
  plate(console, mats.screen, 0.323, 0.282, -0.095, -0.057, 0.015, 0)
  slab(console, mats.darkSteel, 0.224, -0.034, -0.035, 0.13, 0.016, 0.34)
  slab(console, mats.steel, 0.224, -0.047, 0.095, 0.105, 0.014, 0.045)
  slab(console, mats.black, 0.224, -0.056, 0.095, 0.077, 0.008, 0.009)
  slab(console, mats.black, 0.224, -0.049, -0.055, 0.106, 0.018, 0.11)
  slab(console, mats.steel, 0.224, -0.067, -0.085, 0.098, 0.03, 0.038)
  slab(console, mats.black, 0.116, -0.043, 0.148, 0.014, 0.018, 0.047)
  slab(console, mats.steel, 0.116, -0.045, 0.19, 0.032, 0.018, 0.025)

  // Instruction strip sits on the upright upper section above the console.
  slab(g, navy, 0, -0.151, 1.475, 0.65, 0.018, 0.19)
  for (let i = 0; i < 5; i++) {
    slab(g, mats.white, -0.25 + i * 0.125, -0.164, 1.47, 0.055, 0.007, 0.056)
    slab(g, mats.blue, -0.25 + i * 0.125, -0.169, 1.469, 0.025, 0.004, 0.024)
  }
  slab(g, mats.darkSteel, 0, -0.151, 1.595, 0.65, 0.018, 0.055)
  // Ticket/change collection mouth, recessed into the lower service door.
  slab(g, navy, 0, -0.312, 0.64, 0.14, 0.022, 0.19)
  slab(g, mats.black, 0, -0.327, 0.64, 0.104, 0.012, 0.147)
  slab(g, mats.steel, 0, -0.342, 0.582, 0.095, 0.038, 0.023)
  // Marquee is integrated into the cabinet's steel header.
  slab(g, mats.black, 0, -0.153, 1.731, 0.64, 0.024, 0.16)
  const sign = plate(g, ownedMaterial(ctx, new THREE.MeshBasicMaterial({ map: canvasTexture(256, 64, (c) => c.drawImage(signCanvas(), 0, 0)) })), 0.61, 0.145, 0, -0.167, 1.731, 0)
  sign.renderOrder = 1
  return g
}

export class TvmModel extends PieceBuilder {
  readonly kind = 'tvm'
  build(mod: Extract<Module, { type: 'tvm' }>): THREE.Group {
    return placeLocalAtEdge(buildTvm(this.ctx), mod, 0.6)
  }
}

