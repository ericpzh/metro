// The rail's one **旋转** tile (§5.4) — the control that turns whatever is armed.
//
// Four places in the rail turn something: the piece being placed (`rotateModule`), a cut
// piece's half or corner (`rotateWallSnap`), a 轨道 run (`rotateRail`) and the 剖切
// surface (`rotateSection`). They are one control — a quarter turn of the thing in hand,
// on **R** — so they are one tile, and this is it.
//
// **The mark is named here and nowhere else**: Ant Design's `AiOutlineRotateRight`, a
// turning arrow, which says "turn this" on its own where the rail's blueprint line icons
// only say it once the label is read. A fifth caller cannot drift from it either — it
// uses this component, and the glyph and the **R** badge come with it. What a caller
// still owns is the words (`旋转 90°` reads the angle the piece will turn *to*) and what
// the press does.

import { AiOutlineRotateRight } from 'react-icons/ai'
import { Block } from './Block.tsx'

/** The rail's 旋转 mark, drawn once here: `Block`'s `art`, because no line icon is it. */
const ROTATE_ART = <AiOutlineRotateRight aria-hidden="true" />

export function RotateTile({
  label,
  onClick,
}: {
  /** The tile's label — `旋转`, or `旋转 90°` where the angle is the interesting part. */
  label: string
  /** What one press turns. */
  onClick: () => void
}): React.ReactElement {
  return <Block label={label} art={ROTATE_ART} shortcut="R" onClick={onClick} />
}
