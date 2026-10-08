// The identity of a module as a hover ghost. `SceneRenderer.setModulePreview`
// skips a rebuild whose key matches the one it is already drawing, so this has to
// name everything that changes what the ghost *looks like*: a 闸机's lane or fence
// (Tab), a stair's shape, an escalator's direction, a bench's variant and width, a
// track's bound line and power, and the wall pieces' own choices — a 玻璃板's
// size, a 门's variant, a 站名's hand and axis, a 线网图's mount, a 指示牌's own mount
// (the hung board and the wall board are two different pieces in one cell, so a
// palette click between them with the key unchanged would leave the old ghost
// standing under the pointer). A setting left out of here means Tab or a palette
// click redraws nothing and the stale ghost stays under the pointer — which is
// exactly what the 闸机 toggle did until it was named here.
//
// Pure and three-free — and **import-free but for the gate's own predicate**: this is
// read on every pointer move (the 移动 ghost asks it before it rebuilds anything), so it
// stays a leaf that cannot fail on a module the ghost has no other use for. The 指示牌's
// mount is therefore read here as the two words it is, not through `sim/sign.ts`.

import { gateDoorOf } from '../sim/gates.ts'
import type { Module } from '../sim/types.ts'

/** The ghost identity of one module, ignoring its id (a ghost is a prototype). */
export function moduleGhostKey(mod: Module): string {
  if (mod.type === 'pillar' || mod.type === 'roof' || mod.type === 'exit') return `${mod.type}:${mod.x},${mod.y},${mod.z}:${mod.rot ?? 0}:${JSON.stringify(mod)}`
  const span =
    mod.type === 'stair'
      ? `:${mod.to.x},${mod.to.y},${mod.to.z}:${mod.cfg.width}:${mod.cfg.finish ?? ''}`
      : mod.type === 'escalator'
        ? `:${mod.from.x},${mod.from.y},${mod.from.z}>${mod.to.x},${mod.to.y},${mod.to.z}:${mod.cfg.dir}`
        : mod.type === 'lift'
          ? `:${mod.from.z}>${mod.to.z}:${mod.rot ?? 0}`
          : mod.type === 'track'
            ? `:${mod.w}x${mod.d ?? 1}:${mod.cfg.line}:${mod.cfg.dir ?? ''}:${mod.cfg.power}:${mod.cfg.bridge ? 'b' : mod.cfg.tunnel ? 't' : 'p'}`
            : mod.type === 'billboard'
              ? `:${mod.w}:${mod.cfg.variant}`
              : mod.type === 'bench'
                ? `:${mod.w ?? 1}:${mod.cfg.variant}`
                : mod.type === 'gate'
                  ? `:${gateDoorOf(mod)}`
                  : mod.type === 'glass'
                    ? `:${mod.w}:${mod.cfg.variant}`
                    : mod.type === 'door'
                      ? `:${mod.w}:${mod.cfg.variant}`
                    : mod.type === 'calligraphy'
                      ? `:${mod.w}:${mod.panelH}:${mod.cfg.style}:${mod.cfg.axis}`
                      : mod.type === 'linemap'
                        ? `:${mod.w}:${mod.cfg.mount}`
                        : mod.type === 'sign'
                          // The mount, as the sign's own rules read it: the wall board is
                          // the wall board, and anything else — including a mount a save
                          // does not spell (`DEFAULT_SIGN_MOUNT`, `sim/sign.ts`) — is the
                          // hanging board it is drawn as.
                          ? `:${mod.cfg.mount === 'wall' ? 'wall' : 'ceiling'}`
                          : ''
  return `${mod.type}:${mod.x},${mod.y},${mod.z}:${mod.rot ?? 0}${span}`
}
