// App state. The station document lives here; the sim lives in the worker and
// is driven by the messages in sim/protocol.ts. Panels only — no sim logic.
//
// This file is only the `create()` wiring: every field and action is defined in
// `slices/*` (one concern group per file) and in `catalog.ts` (pure catalogue
// data), and composed here.

import { create } from 'zustand'
import { createStationSlice, type StationSlice } from './slices/StationSlice.ts'
import { createToolSlice, type ToolSlice } from './slices/ToolSlice.ts'
import { createViewSlice, type ViewSlice } from './slices/ViewSlice.ts'
import { createRailSlice, type RailSlice } from './slices/RailSlice.ts'
import { createLineSlice, type LineSlice } from './slices/LineSlice.ts'
import { createMoveSlice, type MoveSlice } from './slices/MoveSlice.ts'
import { createPaintSlice, type PaintSlice } from './slices/PaintSlice.ts'
import { createSignSlice, type SignSlice } from './slices/SignSlice.ts'
import { createSimSlice, type SimSlice } from './slices/SimSlice.ts'

export type AppState =
  & StationSlice
  & ToolSlice
  & ViewSlice
  & RailSlice
  & LineSlice
  & MoveSlice
  & PaintSlice
  & SignSlice
  & SimSlice

export const useStore = create<AppState>()((...a) => ({
  ...createStationSlice(...a),
  ...createToolSlice(...a),
  ...createViewSlice(...a),
  ...createRailSlice(...a),
  ...createLineSlice(...a),
  ...createMoveSlice(...a),
  ...createPaintSlice(...a),
  ...createSignSlice(...a),
  ...createSimSlice(...a),
}))
