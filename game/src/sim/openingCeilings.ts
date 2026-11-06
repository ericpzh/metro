// A ramp carve marks an unsupported plate above its opening. Once a solid
// block is restored immediately underneath, the plate is part of a solid
// column again and the derived tag must no longer classify its top as ceiling.
import type { Cell } from './types.ts'

export const OPENING_CEILING = 'opening-ceiling'

export function clearSupportedOpeningCeilings(cells: Cell[], addedSolid: ReadonlySet<string>): Cell[] {
  let out: Cell[] | undefined
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    if (!c.tags?.includes(OPENING_CEILING) || !addedSolid.has(`${c.x},${c.y},${c.z - 1}`)) continue
    out ??= cells.slice()
    const tags = c.tags.filter(tag => tag !== OPENING_CEILING)
    const updated = { ...c }
    if (tags.length) updated.tags = tags
    else delete updated.tags
    out[i] = updated
  }
  return out ?? cells
}
