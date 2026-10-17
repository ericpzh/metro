import { msg } from '../sim/i18n.ts'
// The shipped demo station — 动物园 (Zoo), 广州地铁 5号线. Converted from the
// author's `动物园.metro.json` save (metro-save v1, game 0.2.0, saved
// 2026-10-16 06:16Z) by `tools/bake-demo-station.mjs`, which parses the envelope
// with `persistence/save.ts` and writes the loader's own output, so the demo is
// already the document the game builds when a player opens the file: 11,871
// cells and 4,062 modules. It is a
// real five-level station: surface plaza, a concourse/mezzanine, and a stacked
// two-level platform (up track at z = -16, down at z = -12) served by two lifts,
// five stairs and fourteen escalators, with two ticket booths, a gated
// fare line, and the author's prop pass over it — twelve 时钟, thirty-five 监控,
// seventeen 垃圾桶, eighteen 灭火器, two 收银台, six free-standing 门, the advertising, tactile
// paving, floor markings and platform screen-door ends, and the guard runs along
// the platform, and the author's lighting pass over it —
// one hundred and thirty-nine 灯具 and two 通风口. Two open exits feed the concourse — B口 and C口,
// each with a surface guidepost — and the line's up direction runs to 文冲.
// The author's street pass covers the surface the exits open onto — 2,414 人行道,
// 704 草坪, 86 树木 and two 道路 across the plaza — so the demo exercises the
// 站外 finishes as well as the building.
// The five stairs were rebuilt from the current catalogue without moving their
// landings: straight runs store 0.79 m treads (one full block with rails), and
// the two medium switchbacks store 1.79 m treads per run. `demo.test.mjs` pins
// these complete pieces and checks boarding reachability through door servers.
//
// 坦尾 (Tanwei) ships beside it as the second example, baked the same way from the
// author's `坦尾.metro.json` (metro-save v1, game 0.2.0, saved 2026-10-16 06:06Z):
// an elevated 5号线 / 6号线 interchange opening at street level (`levelBase` 1)
// with 14,554 cells and 9,572 modules — eighty-one 楼梯, eight 扶梯, two lifts and
// seven exits, over the author's own street pass of 6,252 人行道, 686 草坪, 68 树木,
// seven 道路 and a 公交站. `demo.test.mjs` pins its authored counts and that opening
// it repairs nothing.
//
// The raw documents live beside this file as `demo-station.json` and
// `tanwei-station.json` so they are not hand-edited; `referenceStation()` hands
// back a fresh clone each call, because the app mutates its station (undo, edits)
// and one shared object would leak those edits back into the demo.
//
// The old hand-built "Wusi Square" rig is kept for the sim tests as
// `test/support/scenario-station.ts`.

import type { StationData } from '../sim/types.ts'
import { DEFAULT_SIM_TIME } from '../sim/constants.ts'
import demo from './demo-station.json' with { type: 'json' }
import tanwei from './tanwei-station.json' with { type: 'json' }

const DEMO = demo as unknown as StationData
export type ExampleStationId = 'zoo' | 'tanwei'

/** A fresh copy of the demo station, safe to mutate. */
export function referenceStation(id: ExampleStationId = 'zoo'): StationData {
  return structuredClone(id === 'tanwei' ? tanwei as unknown as StationData : DEMO)
}

/**
 * Cold-boot runtime for the demo: the service opening, no warmup, so the page
 * opens on an empty floor — the same clock a fresh 打开 of any save gets
 * (`DEFAULT_SIM_TIME`). The seed lives on the station.
 */
export const REFERENCE_BOOT = { startSeconds: DEFAULT_SIM_TIME, warmup: 0 } as const

/**
 * A new station. There is nothing to seed: the street is an infinite plane of
 * blocks at z = 0, stored inverted (only holes are recorded, `sim/ground.ts`),
 * so an empty document already stands on built ground. The old 2 × 2 at-grade
 * seed existed only because a station with no cells had no floor at all.
 */
export function emptyStation(name = msg('unnamed_station')): StationData {
  return {
    name,
    seed: 7654321,
    cells: [],
    modules: [],
    lines: [],
  }
}
