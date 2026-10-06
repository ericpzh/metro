// The identity of a module as a hover ghost. `SceneRenderer.setModulePreview`
// skips a rebuild whose key matches the one it is already drawing, so this has to
// name everything that changes what the ghost *looks like*: a 闸机's lane or fence
// (Tab), a stair's shape, an escalator's direction, a bench's variant and width, a
// track's bound line and power, and the three wall pieces' own choices — a 玻璃板's
// size, a 站名's hand and axis, a 线网图's mount. A setting left out of here means
// Tab or a palette click redraws nothing and the stale ghost stays under the
// pointer — which is exactly what the 闸机 toggle did until it was named here.
//
// Pure and three-free, so the contract can be tested in Node.

import { gateDoorOf } from '../sim/gates.ts'
import type { Module } from '../sim/types.ts'

/** The ghost identity of one module, ignoring its id (a ghost is a prototype). */
export function moduleGhostKey(mod: Module): string {
  const span =
    mod.type === 'stair'
      ? `:${mod.to.x},${mod.to.y},${mod.to.z}:${mod.cfg.width}:${mod.cfg.finish ?? ''}`
      : mod.type === 'escalator'
        ? `:${mod.from.x},${mod.from.y},${mod.from.z}>${mod.to.x},${mod.to.y},${mod.to.z}:${mod.cfg.dir}`
        : mod.type === 'lift'
          ? `:${mod.from.z}>${mod.to.z}:${mod.rot ?? 0}`
          : mod.type === 'track'
            ? `:${mod.w}x${mod.d ?? 1}:${mod.cfg.line}:${mod.cfg.dir ?? ''}:${mod.cfg.power}:${mod.cfg.tunnel ? 't' : 'p'}`
            : mod.type === 'billboard'
              ? `:${mod.w}:${mod.cfg.variant}`
              : mod.type === 'bench'
                ? `:${mod.w ?? 1}:${mod.cfg.variant}`
                : mod.type === 'gate'
                  ? `:${gateDoorOf(mod)}`
                  : mod.type === 'glass'
                    ? `:${mod.w}:${mod.cfg.variant}`
                    : mod.type === 'calligraphy'
                      ? `:${mod.w}:${mod.panelH}:${mod.cfg.style}:${mod.cfg.axis}`
                      : mod.type === 'linemap'
                        ? `:${mod.w}:${mod.cfg.mount}`
                        : ''
  return `${mod.type}:${mod.x},${mod.y},${mod.z}:${mod.rot ?? 0}${span}`
}
