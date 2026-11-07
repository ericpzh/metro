import { t, translate } from '../../../sim/i18n.ts'
import { LINE_SPACING_OPTIONS, SPACING_BOX_COUNT, spacingActiveBoxes, type LineSpacing } from '../../../sim/lineSpacing.ts'
import { getLanguage, useLanguage } from '../../i18n.ts'
import { Block } from './Block.tsx'

/**
 * The 间隔 tile under a line-capable piece (§5.4): **one square action tile**
 * whose artwork is the line's gap, cycled by clicking it like the width,
 * length and direction tiles. 超短 … 超长 are the seven contents of that tile
 * — 0 to 6 empty blocks between one piece and the next.
 *
 * The artwork always shows the **whole row of eight boxes** (two pieces plus up
 * to six blocks between them). The two active boxes — this piece and the next —
 * are filled; the boxes between and around them are outlines. The active pair
 * is centred in the row, so the gap opens outward from the middle as the tile
 * is cycled.
 *
 * It takes its cycling action from the row's snapshot (`cycleLineSpacing`)
 * rather than subscribing to the store, so a closed action row keeps no live
 * store subscription.
 */
export function SpacingTile({ spacing, onCycle }: { spacing: LineSpacing; onCycle: () => void }): React.ReactElement {
  useLanguage()
  const option = LINE_SPACING_OPTIONS[spacing] ?? LINE_SPACING_OPTIONS[0]
  // The English names are long for a square tile; putting the tile's name on
  // its own line keeps "Medium-long" whole instead of breaking after the hyphen.
  const separator = getLanguage() === 'en' ? '\n' : ' '
  return (
    <Block
      tile="__spacing"
      label={`${t('line_spacing')}${separator}${translate(option.label)}`}
      art={<SpacingArt gap={option.value} />}
      onClick={onCycle}
    />
  )
}

/** The whole eight-box line; the two active pieces are filled. */
function SpacingArt({ gap }: { gap: number }): React.ReactElement {
  const box = 3.5
  const pitch = 3.9
  const [activeFrom, activeTo] = spacingActiveBoxes(gap)
  return (
    <svg aria-hidden="true" viewBox="0 0 32 20" fill="none" stroke="currentColor" strokeWidth="0.6">
      {Array.from({ length: SPACING_BOX_COUNT }, (_, i) => {
        const active = i === activeFrom || i === activeTo
        return (
          <rect
            key={i}
            className={active ? 'spacingBoxOn' : undefined}
            x={0.35 + i * pitch}
            y={8.25}
            width={box}
            height={box}
            rx={0.2}
            fill={active ? 'currentColor' : 'none'}
            stroke={active ? 'none' : 'currentColor'}
            opacity={active ? 1 : 0.42}
          />
        )
      })}
    </svg>
  )
}
