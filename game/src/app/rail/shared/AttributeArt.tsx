import { dimensionBars, type DimensionMarkAlign } from './dimensionMark.ts'

/** Shared abstract state marks for every builder tile. */
export function DimensionArt({ vertical = false, selected, count, align = 'start' }: { vertical?: boolean; selected: number; count: number; align?: DimensionMarkAlign }): React.ReactElement {
  return <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="0.8">
    {dimensionBars(count, { vertical, align }).map((bar, i) => (
      <rect key={i} {...bar} rx="0.4" fill={i === selected ? 'currentColor' : 'none'} opacity={i === selected ? 1 : 0.45} />
    ))}
  </svg>
}

export function DirectionArt({ direction }: { direction: 'up' | 'down' | 'one-way' | 'two-way' }): React.ReactElement {
  return <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round">
    <path d="M4 3h3v9h3l-4.5 5L1 12h3Z" fill={direction === 'down' || direction === 'two-way' ? 'currentColor' : 'none'} opacity={direction === 'up' || direction === 'one-way' ? 0.45 : 1} />
    <path d="M13 17h3V8h3l-4.5-5L10 8h3Z" fill={direction !== 'down' ? 'currentColor' : 'none'} opacity={direction === 'down' ? 0.45 : 1} />
  </svg>
}

export function RotationArt({ rotation = 0 }: { rotation?: number }): React.ReactElement {
  return <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round">
    <rect x="6" y="6" width="8" height="8" rx="0.5" />
    {['M7 3 10 1 13 3Z', 'M17 7 19 10 17 13Z', 'M7 17 10 19 13 17Z', 'M3 7 1 10 3 13Z'].map((d, i) => <path key={i} d={d} fill={i === ((rotation % 4) + 4) % 4 ? 'currentColor' : 'none'} opacity={i === ((rotation % 4) + 4) % 4 ? 1 : 0.45} />)}
  </svg>
}

/** Stacked floor planes: one or two storeys, sharing the size marks' ink. */
export function StoreyArt({ double }: { double: boolean }): React.ReactElement {
  return <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round">
    <path d="M2 7 7 3h11l-5 4Z" fill={double ? 'currentColor' : 'none'} opacity={double ? 1 : 0.45} />
    <path d="M2 16 7 12h11l-5 4Z" fill="currentColor" />
  </svg>
}
