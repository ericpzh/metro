// Geometry for the shared size mark, kept out of `AttributeArt.tsx` so the Node
// suite can pin where the bars actually sit. React views have no mount harness,
// and a source-regex assertion would not catch a gauge drawn off its centre.
//
// A **width** is a gauge read from the middle of the tile: 窄 / 宽 and 窄 / 中 / 宽
// are one pair of calipers, so every option's bar shares the tile's midline and
// the wider option cannot look like it starts farther along. A **length** grows
// away from the start edge instead (超短 短 中 长 超长 is one run getting longer),
// which is also what the tunnel and bridge controls expect.

export type DimensionMarkAlign = 'start' | 'center'

export interface DimensionBar {
  x: number
  y: number
  width: number
  height: number
}

/** A width centres; every other dimension keeps the start edge. */
export function dimensionMarkAlign(kind: string): DimensionMarkAlign {
  return kind === 'width' ? 'center' : 'start'
}

/** The bars of one mark in the 20 × 20 viewBox `DimensionArt` draws into. */
export function dimensionBars(
  count: number,
  { vertical = false, align = 'start' }: { vertical?: boolean; align?: DimensionMarkAlign } = {},
): DimensionBar[] {
  return Array.from({ length: count }, (_, i) => {
    const size = 5 + 12 * (i + 1) / count
    const cross = 2.4
    const lane = (20 - ((count - 1) * 16 / count + cross)) / 2 + i * 16 / count
    if (vertical) return { x: lane, y: 18.5 - size, width: cross, height: size }
    return { x: align === 'center' ? (20 - size) / 2 : 1.5, y: lane, width: size, height: cross }
  })
}
