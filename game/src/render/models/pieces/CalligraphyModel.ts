// Station-name calligraphy (站名) builder. One piece file per piece; see
// PieceBuilder.ts for the shared kit.

import * as THREE from 'three'
import { PieceBuilder, plate } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { calligraphyBottom, calligraphyPanelSize } from '../../../sim/calligraphy.ts'
import { normRot, rotateLocal } from '../../../sim/track.ts'
import type { Module } from '../../../sim/types.ts'

/**
 * How far the ink stands off the wall's face, metres. An inscription is brush
 * strokes *on* the wall, so the plate hangs a hand's width proud of it — close
 * enough to read as painted on, far enough that the wall's own paint and the
 * block faces behind it never poke through the characters.
 */
const INK_OFFSET = 0.46

/**
 * Station-name calligraphy (站名): the station's own name, drawn as a large ink
 * inscription on the module's local −y wall. The rotation picks the wall; the hand
 * and the axis come from `cfg` (`sim/calligraphy.ts`); the panel's size is the
 * piece's own `w` × `panelH`, fixed when it was placed.
 *
 * The text is not on the piece: `ctx.calligraphyFace` prints the **live** station
 * name (`render/calligraphyFace.ts`), so renaming the station reprints every
 * inscription without touching one module. The plate is transparent ink, so the
 * wall shows through between the strokes and the piece reads as calligraphy rather
 * than as a poster of it.
 *
 * 横排 hangs as a band at eye height; 竖排 climbs from near the floor. Both are laid
 * out by the table's own `calligraphyBottom`, which is also the number
 * `wallMountCourses` reads for the backing rule — so the panel is backed exactly
 * where it is drawn.
 */
function buildCalligraphy(ctx: ModuleContext, mod: Extract<Module, { type: 'calligraphy' }>): THREE.Group {
  const axis = mod.cfg?.axis === 'v' ? 'v' : 'h'
  const style = mod.cfg?.style ?? 'kai'
  const panel = calligraphyPanelSize(axis, mod.w, mod.panelH)
  const g = new THREE.Group()
  const [dx, dy] = rotateLocal(mod.rot, (mod.w - 1) / 2, 0)
  g.position.set(mod.x + 0.5 + dx, mod.y + 0.5 + dy, mod.z + 1)
  g.rotation.z = (normRot(mod.rot) * Math.PI) / 2

  const zc = calligraphyBottom(axis) + panel.h / 2
  // The ink is a **material** — a printed plate the caller cut to this panel, or the
  // kit's own neutral inscription for a ctx with no scene behind it. The plate is the
  // panel's size and its alpha is the strokes, so everything it does not cover is the
  // wall.
  const material = ctx.calligraphyFace?.(mod.id, { style, axis, panel, showEnglish: mod.cfg.showEnglish }).material ?? ctx.mats.calligraphyInk
  let ink: THREE.Mesh
  if (mod.cfg.pillarId && axis === 'v') {
    // Project the flat artwork around the shaft, retaining its full UV width.
    const radius = 0.493, segments = 32, positions: number[] = [], uvs: number[] = [], indices: number[] = []
    for (let i = 0; i <= segments; i++) {
      const u = i / segments, angle = (u - 0.5) * panel.w / radius
      const x = -Math.sin(angle) * radius, y = Math.cos(angle) * radius
      positions.push(x, y, zc - panel.h / 2, x, y, zc + panel.h / 2)
      uvs.push(u, 0, u, 1)
      if (i < segments) { const a = i * 2; indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1) }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    ink = new THREE.Mesh(geometry, material)
    g.add(ink)
  } else {
    ink = plate(g, material, panel.w, panel.h, 0, -INK_OFFSET, zc, Math.PI)
  }
  ink.renderOrder = 1
  ink.userData.calligraphy = true
  return g
}

export class CalligraphyModel extends PieceBuilder {
  readonly kind = 'calligraphy'
  build(mod: Extract<Module, { type: 'calligraphy' }>): THREE.Group {
    return buildCalligraphy(this.ctx, mod)
  }
}
