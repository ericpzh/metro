// Build model: lifts — the elevator shaft column and its growth (§5).

import { liftExtendedDown, liftExtendedUp, liftRises, type LiftInterval } from '../../sim/lifts.ts';
import type { Module } from '../../sim/types.ts';
import type { StationState } from './State.ts';

/** The elevator shaft standing in a column, if any. */
export function liftInColumn(modules: readonly Module[], x: number, y: number): Extract<Module, { type: 'lift' }> | undefined {
  for (const m of modules) if (m.type === 'lift' && m.x === x && m.y === y) return m;
  return undefined;
}

/**
 * Grow an existing shaft one **interval** up or down — the rise the 层高 tile is
 * currently set to, so a 5 m shaft can take a 3 m storey on top or a 7 m one
 * below. The shaft keeps its id and its column; only its reach and its stacked
 * rises change, so a hover-extension reads as the same elevator getting taller
 * rather than a new piece appearing. An omitted interval keeps the shaft's own
 * storey default (a legacy caller, the thumbnail pass).
 */
export function extendLift(state: StationState, id: string, up: boolean, interval?: LiftInterval): StationState {
  const mod = state.modules.find((m) => m.id === id);
  if (!mod || mod.type !== 'lift') return state;
  const grown = up ? liftExtendedUp(mod, interval) : liftExtendedDown(mod, interval);
  return { ...state, modules: state.modules.map((m) => (m.id === id ? grown : m)) };
}

/** Remove one outer extension interval, keeping the rest of the shaft intact. */
export function removeLiftExtension(state: StationState, id: string, end: 'bottom' | 'top'): StationState {
  const mod = state.modules.find((m) => m.id === id);
  if (!mod || mod.type !== 'lift') return state;
  const rises = liftRises(mod);
  if (rises.length < 2) return state;

  const cfg = { ...mod.cfg, rises: end === 'bottom' ? rises.slice(1) : rises.slice(0, -1) };
  const doors = { ...(mod.cfg.doors ?? {}) };
  if (end === 'bottom') {
    delete doors[String(mod.from.z)];
    if (Object.keys(doors).length) cfg.doors = doors;
    else delete cfg.doors;
  } else {
    const topLevel = mod.to.z - rises[rises.length - 1]!;
    delete doors[String(topLevel)];
    if (Object.keys(doors).length) cfg.doors = doors;
    else delete cfg.doors;
  }

  const trimmed = end === 'bottom'
    ? { ...mod, from: { ...mod.from, z: mod.from.z + rises[0]! }, cfg }
    : { ...mod, to: { ...mod.to, z: mod.to.z - rises[rises.length - 1]! }, cfg };
  return { ...state, modules: state.modules.map((m) => m.id === id ? trimmed : m) };
}
