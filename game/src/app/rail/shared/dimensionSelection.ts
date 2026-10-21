import type { AppState } from '../../store/Store.ts'
import { isBenchType, isDoorType, isStairType } from '../../store/catalog.ts'
import { STAIR_WIDTHS } from '../../../sim/stairs.ts'
import { rampLengthsFor, rampLengthSpec } from '../../../sim/rampLengths.ts'
import { TRACK_RUN_LENGTHS } from '../../../sim/track.ts'

/** Read the selected size from builder state, never from translated labels. */
export function dimensionSelection(kind: string, type: string, s: AppState): { selected: number; count: number } | undefined {
  const choice = (value: unknown, values: readonly unknown[]) => ({ selected: Math.max(0, values.indexOf(value)), count: values.length })
  if (kind === 'width') {
    if (type === 'road') return choice(s.roadWidth, [6, 12, 18, 24])
    if (type === 'curtain-wall') return choice(s.curtainWidth, [1, 2, 3, 4])
    if (type === 'escalator' || type === 'walkway') return choice(s.escalatorWide, [false, true])
    if (isBenchType(type)) return choice(type.endsWith('-2'), [false, true])
    if (isDoorType(type)) return choice(s.doorWide, [false, true])
    if (isStairType(type)) return choice(s.stairWidth, STAIR_WIDTHS)
    return choice(s.roofWidth, [4, 8, 12])
  }
  if (kind === 'height') {
    if (type === 'curtain-wall') return choice(s.curtainHeight, [2, 3, 4])
    if (type === 'stair-block') return choice(s.stairBlockHeight, [0.5, 1])
    return choice(s.psdEndHeight, ['half', 'full'])
  }
  if (kind === 'length') {
    if (type === 'walkway') return choice(s.walkwayLength, ['short', 'medium', 'long'])
    if (type.startsWith('hanger')) return choice(s.hangerLength, [4, 6, 8])
    if (type.startsWith('pillar')) return choice(s.pillarLength, [2, 5])
    if (type === 'lift') return choice(s.liftInterval, [3, 4, 5, 6, 7])
    if (type === 'bridge') return choice(s.bridgeLength, TRACK_RUN_LENGTHS)
    // A 楼梯's family carries the extra 超长 6 m rung; a 扶梯 resolves the same
    // armed setting into its own 2–5 m family, so its marks show the piece it
    // will actually build.
    const span = type === 'escalator' ? s.escalatorSpan : 'single'
    const family = isStairType(type) ? 'stair' : 'escalator'
    const armed = span === 'double' ? s.doubleRampLength : s.rampLength
    return choice(rampLengthSpec(armed, span, family).id, rampLengthsFor(span, family).map(v => v.id))
  }
  return undefined
}
