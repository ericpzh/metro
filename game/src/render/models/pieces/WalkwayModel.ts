// Moving walkway (自动步道) builder. The level twin of the escalator: the same
// rolling band, glass balustrades, handrails and newels, drawn by the shared
// `buildRampBand` with no climb, so the band lies flat on the floor and no truss
// hangs beneath it. See `sim/walkways.ts` for the piece and `EscalatorModel.ts`
// for the body builder they share.

import * as THREE from 'three'
import { PieceBuilder } from '../PieceBuilder.ts'
import { buildRampBand } from './EscalatorModel.ts'
import type { Module } from '../../../sim/types.ts'

export class WalkwayModel extends PieceBuilder {
  readonly kind = 'walkway'
  build(mod: Extract<Module, { type: 'walkway' }>): THREE.Group {
    return buildRampBand(this.ctx, mod)
  }
}
