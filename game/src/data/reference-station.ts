// The shipped demo station — 动物园 (Zoo), 广州地铁 5号线. Converted from the
// author's `动物园.metro.json` save (metro-save v1, game 0.2.0, saved
// 2026-10-05) by `tools/bake-demo-station.mjs`, which parses the envelope with
// `persistence/save.ts` and writes the loader's own output, so the demo is
// already the document the game builds when a player opens the file. It is a
// real five-level station: surface plaza, a concourse/mezzanine, and a stacked
// two-level platform (up track at z = -16, down at z = -12) served by two lifts,
// five stairs and fourteen escalators, with a store, an office, two ticket
// booths, a gated fare line, and the author's prop pass over it — eleven 时钟,
// thirty-three 监控, seventeen 垃圾桶, the advertising, and the guard runs along
// the platform. Two head-houses feed the concourse — a covered C口 and an open
// B口 — and the line's up direction runs to 文冲.
//
// The raw document lives beside this file as `demo-station.json` so it is not
// hand-edited; `referenceStation()` hands back a fresh clone each call, because
// the app mutates the station it is given (undo, edits) and one shared object
// would leak those edits back into the demo.
//
// The old hand-built "Wusi Square" rig is kept for the sim tests as
// `test/support/scenario-station.ts`.

import type { StationData } from '../sim/types.ts'
import demo from './demo-station.json' with { type: 'json' }

const DEMO = demo as unknown as StationData

/** A fresh copy of the demo station, safe to mutate. */
export function referenceStation(): StationData {
  return structuredClone(DEMO)
}

/**
 * Cold-boot runtime for the demo: 07:27, no warmup, so the page opens on an
 * empty floor as the first Line 5 train runs in. The seed lives on the station.
 */
export const REFERENCE_BOOT = { startSeconds: 7.45 * 3600, warmup: 0 } as const

/** The 2x2 at-grade seed a new station starts from (§3 step 1, §4.1). */
export function emptyStation(name = '未命名车站'): StationData {
  return {
    name,
    seed: 7654321,
    cells: [
      { x: 0, y: 0, z: 0, fill: 'solid' },
      { x: 1, y: 0, z: 0, fill: 'solid' },
      { x: 0, y: 1, z: 0, fill: 'solid' },
      { x: 1, y: 1, z: 0, fill: 'solid' },
    ],
    modules: [],
    lines: [],
  }
}
