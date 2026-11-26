// The Unity shell's **build outcome** notices (plan 28 §4).
//
// The C# pointer router resolves one hit per event and answers with a stable refusal code
// (`occupied`, `floor`, `no-track`, …), but an ack payload never reaches the shared store: the
// player only ever saw the *ghost* refuse, and a click that did nothing looked like a dead
// button. The router now publishes one normalized outcome as `state.edit.notice` — the code,
// the host's own sentence, the tool and the outcome kind (`blocked` / `no-op` / `stale`) — and
// this module is the one place that turns a code into the player's language. It is pure and
// takes the locale explicitly (`tForLanguage`), so `unity/tests/edit-notices.test.mjs` pins
// both languages without a DOM.

import { tForLanguage, type Language, type MessageKey } from '../sim/i18n.ts'

/** The `state.edit.notice` snapshot the C# router publishes. */
export interface BuildOutcome {
  /** `blocked` (the surface refuses the candidate), `no-op` (nothing to change) or `stale`. */
  kind?: string
  /** The stable refusal code (`occupied`, `floor`, `no-track`, `nothing-to-do`, …). */
  code?: string
  /** The host's own sentence, used when a code has no message of its own. */
  reason?: string
  /** The committed tool that produced it (`block`, `module`, `tunnel`, …). */
  tool?: string
  /** The armed 设备 palette id, so a bridge and a tunnel read differently. */
  moduleType?: string
  /** The armed 分区/房间 brush id (`ticket`, `info`, `paid`, `none`, …). */
  zoneBrush?: string
  /** The aimed room footprint width/height (for `min-size`). */
  width?: number
  height?: number
}

/** A code's own message. Unknown codes fall back to the host's sentence. */
const MESSAGES: Record<string, MessageKey> = {
  occupied: 'equipment_already_occupies_this_location',
  floor: 'equipment_needs_a_solid_floor_here',
  track: 'cannot_place_blocks_on_track',
  wall: 'cannot_place_equipment_here_choose_another_location',
  ceiling: 'cannot_place_equipment_here_choose_another_location',
  'unsupported-mount': 'cannot_place_equipment_here_choose_another_location',
  'unsupported-family': 'cannot_place_equipment_here_choose_another_location',
  'exit-below-ground': 'cannot_place_equipment_here_choose_another_location',
  'outdoor-below-ground': 'cannot_place_equipment_here_choose_another_location',
  'exit-on-slab': 'cannot_place_equipment_here_choose_another_location',
  'no-hit': 'move_to_the_new_location',
  'nothing-to-do': 'nothing_to_remove_here',
  'no-track-to-remove': 'no_track_to_remove_here',
  'no-roof-to-remove': 'no_roof_to_remove_here',
  'no-line': 'select_existing_track_first_the_tunnel_connects_to_its_end',
  'no-track': 'select_existing_track_first_the_tunnel_connects_to_its_end',
  'bridge-pier': 'cannot_place_equipment_here_choose_another_location',
  'no-roof-to-place': 'cannot_place_a_roof_here_choose_another_location',
  'over-limit': 'drag_area_too_large',
  'no-module': 'nothing_selected_yet',
  'stale-tool': 'cannot_place_equipment_here_choose_another_location',
  'stale-revision': 'cannot_place_equipment_here_choose_another_location',
  clash: 'different_room_types_cannot_overlap',
  'min-size': 'room_minimum_is_value_value_current_size_is_value_value_draw_a_l',
  'no-floor': 'lay_a_complete_floor_before_drawing_a_room_here',
  'too-large': 'drag_area_too_large',
}

/** The tool-scoped overrides that read better than the generic sentence. */
function keyFor(outcome: BuildOutcome): MessageKey | null {
  const code = outcome.code ?? ''
  const tool = outcome.tool ?? ''
  const palette = outcome.moduleType ?? ''
  if (code === 'no-line' && tool === 'rail') return 'add_a_line_before_placing_a_platform'
  if (code === 'no-track' && palette.startsWith('bridge')) {
    return 'select_existing_track_first_the_bridge_connects_to_its_end'
  }
  if (code === 'nothing-to-do' && palette.startsWith('roof')) return 'no_roof_to_remove_here'
  if (code === 'occupied' && (tool === 'block' || tool === 'wall')) {
    return 'cannot_place_a_block_here_a_block_already_exists'
  }
  if (code === 'floor' && (tool === 'rail' || tool === 'tunnel')) {
    return 'platform_track_needs_a_solid_floor_at_least_three_cells_wide'
  }
  if (code === 'track' && tool === 'zone') return 'cannot_build_rooms_on_track'
  if (code === 'not-floor' && tool === 'zone') {
    return outcome.zoneBrush === 'none'
      ? 'zones_can_only_be_erased_on_floors'
      : 'zones_can_only_be_painted_on_floors'
  }
  return MESSAGES[code] ?? null
}

/** The format slots a code needs when its message is parameterized. */
function argumentsFor(outcome: BuildOutcome): Array<string | number> {
  const code = outcome.code ?? ''
  if (code === 'over-limit') return ['10000']
  if (code === 'too-large') return ['400']
  if (code === 'min-size') {
    const w = typeof outcome.width === 'number' && outcome.width > 0 ? outcome.width : 1
    const h = typeof outcome.height === 'number' && outcome.height > 0 ? outcome.height : 1
    return [3, 3, w, h]
  }
  return []
}

/**
 * The localized sentence for one published build outcome, or `''` when there is nothing worth
 * saying. A `no-op` with no message and no host sentence stays silent, so an ordinary click on
 * an ignored cell never raises a toast.
 */
export function noticeText(outcome: BuildOutcome | null | undefined, locale: Language): string {
  if (!outcome) return ''
  // A stale gesture is not actionable: the shell already re-aims, so it stays silent.
  if ((outcome.kind ?? '') === 'stale') return ''
  const key = keyFor(outcome)
  if (key) return tForLanguage(locale, key, ...argumentsFor(outcome))
  const reason = typeof outcome.reason === 'string' ? outcome.reason.trim() : ''
  const code = outcome.code ?? ''
  // Nothing was published (the host clears the notice with an empty outcome): say nothing.
  if (code.length === 0 && reason.length === 0) return ''
  // A host sentence is the best fallback; a bare code (`no-cell`, `no-candidate`) is not a
  // sentence, so it gets the family's generic wording instead of leaking the protocol.
  if (reason.length > 0 && reason !== code) return reason
  return (outcome.kind ?? '') === 'no-op'
    ? tForLanguage(locale, 'nothing_to_remove_here')
    : tForLanguage(locale, 'cannot_place_equipment_here_choose_another_location')
}

/** A stable key for one outcome, so the shell only shows a *new* notice once. */
export function noticeKey(outcome: BuildOutcome | null | undefined): string {
  if (!outcome) return ''
  const size = typeof outcome.width === 'number' && typeof outcome.height === 'number'
    ? `|${outcome.width}x${outcome.height}`
    : ''
  return `${outcome.kind ?? ''}|${outcome.code ?? ''}|${outcome.tool ?? ''}|${outcome.moduleType ?? ''}${size}`
}
