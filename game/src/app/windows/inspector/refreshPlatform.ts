import type { Module } from '../../../sim/types.ts'

/** Resolve a selected platform track or its screen door to the eligible track to refresh. */
export function refreshTrackForSelection(
  modules: readonly Module[],
  selected: Module | undefined,
): Extract<Module, { type: 'track' }> | undefined {
  const trackId = selected?.type === 'track'
    ? selected.id
    : selected?.type === 'platform-edge'
      ? selected.cfg.from
      : undefined
  const track = trackId ? modules.find((mod) => mod.id === trackId) : undefined
  return track?.type === 'track' && !track.cfg.tunnel && !track.cfg.bridge ? track : undefined
}
