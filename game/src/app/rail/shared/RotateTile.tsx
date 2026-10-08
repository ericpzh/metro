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

/** Plan view of a slim pillar's 3×3 in-cell positions, with the armed spot highlighted. */
export function PositionTile({ position, onClick }: { position: number; onClick: () => void }): React.ReactElement {
  // Keep this order in sync with sim/structures.ts `pillarOffset`.
  const offsets = [[0, 0], [0.35, 0], [0, 0.35], [-0.35, 0], [0, -0.35], [0.35, 0.35], [-0.35, 0.35], [-0.35, -0.35], [0.35, -0.35]] as const
  const [offsetX, offsetY] = offsets[((position % 9) + 9) % 9]
  const pillarSize = 4.8
  const pillarX = 10 + offsetX * 16 - pillarSize / 2
  const pillarY = 10 - offsetY * 16 - pillarSize / 2
  return (
    <Block
      label={`位置 ${position + 1}/9`}
      art={
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="0.8">
          <rect x="2" y="2" width="16" height="16" rx="0.6" opacity="0.45" />
          <rect x={pillarX} y={pillarY} width={pillarSize} height={pillarSize} rx="0.6" fill="currentColor" strokeWidth="0" />
        </svg>
      }
      shortcut="R"
      onClick={onClick}
    />
  )
}
