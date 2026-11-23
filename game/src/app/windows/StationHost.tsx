import { createContext, useContext } from 'react'
import type { ExampleStationId } from '../../data/reference-station.ts'
import type { UpscalingMode } from '../../render/upscaling.ts'

export type ModelDetailProfile = 'high' | 'balanced' | 'low'

/**
 * The station runtime that owns the document. In the Three/TS app there is no
 * host: the store itself is the document owner, and every control keeps its
 * existing `useStore` path. In the Unity player the host is the C# station
 * session, so New, the example menu, file Open and Save must ask it instead of
 * mutating the React store — the committed revision lives in C# (`11 A6`).
 */
export interface StationHost {
  newStation(): void
  openDemo(id: ExampleStationId): void
  openSave(text: string): void
  save(): void
  modelDetail?(profile?: ModelDetailProfile): Promise<ModelDetailProfile>
  upscaling?(mode?: UpscalingMode): Promise<UpscalingMode>
  /** Desktop Unity player hook to open the interactive benchmark route in-place. */
  openBenchmark?(): void
  /** Authoritative undo/redo driven by the C# edit history when the host owns the document. */
  undo?(): void
  redo?(): void
  getHistory?(): { canUndo: boolean; canRedo: boolean }
  subscribeHistory?(listener: () => void): () => void
  /** An edit the host does not implement yet: shown, not attempted. */
  unsupported?(feature: string): void
}

const StationHostContext = createContext<StationHost | null>(null)

export const StationHostProvider = StationHostContext.Provider

export function useStationHost(): StationHost | null {
  return useContext(StationHostContext)
}
