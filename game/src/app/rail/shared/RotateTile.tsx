import { translate, t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
import { RotationArt } from './AttributeArt.tsx'
import { IN_CELL_POSITIONS } from '../../../sim/inCellPositions.ts'
import { Block } from './Block.tsx'

export function RotateTile({
  label,
  onClick,
  rotation = 0,
}: {
  /** The tile's label — `旋转`, or `旋转 90°` where the angle is the interesting part. */
  label: string
  rotation?: number
  /** What one press turns. */
  onClick: () => void
}): React.ReactElement {
  useLanguage()
  return <Block label={translate(label)} art={<RotationArt rotation={rotation} />} shortcut="R" onClick={onClick} />
}

/** Plan view of a slim pillar's 3×3 in-cell positions, with the armed spot highlighted. */
export function PositionTile({ position, onClick, shortcut = 'R' }: { position: number; onClick: () => void; shortcut?: string }): React.ReactElement {
  useLanguage()
  const [x, y] = IN_CELL_POSITIONS[((position % 9) + 9) % 9]
  const offsetX = x * 0.35
  const offsetY = y * 0.35
  const pillarSize = 4.8
  const pillarX = 10 + offsetX * 16 - pillarSize / 2
  const pillarY = 10 - offsetY * 16 - pillarSize / 2
  return (
    <Block
      label={t('position_value_9', position + 1)}
      art={
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="0.8">
          <rect x="2" y="2" width="16" height="16" rx="0.6" opacity="0.45" />
          <rect x={pillarX} y={pillarY} width={pillarSize} height={pillarSize} rx="0.6" fill="currentColor" strokeWidth="0" />
        </svg>
      }
      shortcut={shortcut}
      onClick={onClick}
    />
  )
}
