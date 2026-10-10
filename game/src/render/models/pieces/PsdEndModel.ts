import * as THREE from 'three'
import type { Module } from '../../../sim/types.ts'
import { psdEndSpan } from '../../../sim/psdEnds.ts'
import { PieceBuilder } from '../PieceBuilder.ts'
import { buildPsd } from './PsdModel.ts'

/** Fixed glass from the platform-screen model, without door leaves (§5.7). */
export class PsdEndModel extends PieceBuilder {
  readonly kind = 'psd-end'
  build(mod: Extract<Module, { type: 'psd-end' }>): THREE.Group {
    const group = buildPsd(this.ctx, { ...mod, type: 'platform-edge', w: 1,
      cfg: { name: '屏蔽端门', dir: 'up', line: '', side: 'left', psd: mod.cfg.psd } }, psdEndSpan(mod, this.ctx.data.modules, this.ctx.data.lines))
    if (mod.cfg.offset) for (const child of group.children) {
      child.position.x += mod.cfg.offset[0]
      child.position.y += mod.cfg.offset[1]
    }
    return group
  }
}
