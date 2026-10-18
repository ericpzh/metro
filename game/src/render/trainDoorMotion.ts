/** Fraction of opening travel reserved for withdrawing the plug from the skin. */
export const TRAIN_DOOR_PLUG_PHASE = 0.18

/** Reversible plug motion: pop out, then slide; close by sliding, then seating. */
export function trainDoorMotion(progress: number): { slide: number; plug: number } {
  const t = Math.max(0, Math.min(1, progress))
  return {
    slide: Math.max(0, (t - TRAIN_DOOR_PLUG_PHASE) / (1 - TRAIN_DOOR_PLUG_PHASE)),
    plug: Math.min(1, t / TRAIN_DOOR_PLUG_PHASE),
  }
}
