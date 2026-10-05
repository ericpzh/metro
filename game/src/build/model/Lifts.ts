// Build model: lifts — the elevator shaft column and its growth (§5).

import { liftExtendedDown, liftExtendedUp } from '../../sim/lifts.ts';
import type { Module } from '../../sim/types.ts';
import type { StationState } from './State.ts';

/** The elevator shaft standing in a column, if any. */
export function liftInColumn(modules: readonly Module[], x: number, y: number): Extract<Module, { type: 'lift' }> | undefined {
  for (const m of modules) if (m.type === 'lift' && m.x === x && m.y === y) return m;
  return undefined;
}

/**
 * Grow an existing shaft one storey up or down. The shaft keeps its id and its
 * column; only its reach changes, so a hover-extension reads as the same
 * elevator getting taller rather than a new piece appearing.
 */
export function extendLift(state: StationState, id: string, up: boolean): StationState {
  const mod = state.modules.find((m) => m.id === id);
  if (!mod || mod.type !== 'lift') return state;
  const grown = up ? liftExtendedUp(mod) : liftExtendedDown(mod);
  return { ...state, modules: state.modules.map((m) => (m.id === id ? grown : m)) };
}
