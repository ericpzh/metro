// Build model: reference — the lab station and the default station (§4 V1).

import { referenceStation } from '../../data/reference-station.ts';
import type { Cell, Module, StationData } from '../../sim/types.ts';
import { toState, type StationState } from './State.ts';

/** The lab station: one 16^3 chunk with a hole and a step (§4 V1). */
export function labStation(): StationData {
  const cells: Cell[] = [];
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      cells.push({ x, y, z: 0, fill: 'solid' });
      // A step: a second course on the far half.
      if (y >= 5) cells.push({ x, y, z: 1, fill: 'solid' });
    }
  }
  // A hole cut through the slab.
  for (let x = 2; x < 5; x++) for (let y = 2; y < 5; y++) cells.splice(cells.findIndex((c) => c.x === x && c.y === y && c.z === 0), 1);
  // A few modules, so the lab also shows contact shadows and the metal / enamel
  // material language against the granite.
  const modules: Module[] = [
    { id: 'lab-gate', type: 'gate', x: 0, y: 6, z: 1, cfg: { dir: 'both' } },
    { id: 'lab-gate2', type: 'gate', x: 1, y: 6, z: 1, cfg: { dir: 'both' } },
    { id: 'lab-tvm', type: 'tvm', x: 7, y: 6, z: 1, cfg: {} },
    { id: 'lab-bench', type: 'bench', x: 4, y: 6, z: 1, cfg: {} },
    { id: 'lab-exit', type: 'exit', x: 6, y: 0, z: 0, cfg: { name: 'A口', inRate: 900, open: true } },
  ];
  return {
    name: '材质试验台',
    seed: 1,
    cells,
    modules,
    lines: [],
  };
}

export function initialStation(): StationState {
  return toState(referenceStation());
}
