// The 1 m courses a panel crosses — the arithmetic behind every wall-mounted
// piece's backing rule (`sim/placement.ts` `wallMountMissing`).
//
// A wall in this game is a stack of 1 m courses (`AUTO_WALL_H` of them under the
// 墙 tool), and a piece bolted flat to it is backed wherever the courses it
// actually crosses are solid. A panel that starts 1.5 m up and is 1 m tall crosses
// the second and third courses — not the first — so a wall that stops after one
// metre is not a wall it can hang on, which is precisely the refusal a tall
// inscription or a 2 m glass panel has to make.
//
// One function, in its own leaf module, because three tables (`glassPanels`,
// `calligraphy`, `linemaps`) and the placement rule all have to agree about where
// a course begins: an off-by-one here is a panel that hangs half a metre into thin
// air, which no test of the drawing would ever notice.
//
// Pure arithmetic — no three, no DOM, no imports.

/**
 * The courses a panel from `bottom` to `bottom + height` (metres above the floor
 * top) crosses, as local course indices: 0 is the first metre above the floor.
 *
 * A course is `[c, c + 1)`, so a panel whose edges land exactly on a course line
 * does **not** claim the course it merely touches — a 1 m panel mounted at 1.5 m
 * crosses courses 1 and 2, and a 2 m panel standing on the floor crosses 0 and 1.
 */
export function wallCourses(bottom: number, height: number): number[] {
  const first = Math.floor(bottom + 1e-9)
  const last = Math.max(first, Math.ceil(bottom + height - 1e-9) - 1)
  const out: number[] = []
  for (let c = first; c <= last; c++) out.push(c)
  return out
}
