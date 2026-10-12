import { msg, t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
// 指示牌 editor (§5.8) — the 文字 group's two boxes. 中文 on the first line, English on the
// second, and to their left the label they add up to, drawn like every other tile's mark.

import { useEffect, useRef, useState } from 'react'
import { SIGN_TEXT_EN_MAX, SIGN_TEXT_MAX, signTextLines, type SignComponent } from '../../../sim/sign.ts'
import type { LineDef } from '../../../sim/types.ts'
import { MarkTile } from './palette.tsx'
import { paletteMark } from './tokens.ts'

/**
 * The one text box: 中文 on the first line, English on the second — and, to the left of
 * them, the **label they add up to**, drawn by the sign like every other tile's mark.
 *
 * That tile is the group's drag handle, and it is the only one: the boxes are text
 * fields, so a press inside one has to mean "put the caret here" (or "select this
 * word"), never "lift this mark" — dragging a selection out of an input used to start a
 * drag and lay down a label nobody asked for. The tile is rebuilt from the two rows as
 * they are typed, so what the pointer picks up is what the board would print.
 */
export function TextFields({
  comp,
  lines: stationLines,
  onCommit,
  onArmDrag,
  onPick,
}: {
  comp: Extract<SignComponent, { kind: 'text' }> | undefined
  /** The station's lines, so the tile is drawn by the same call as every other tile. */
  lines: readonly LineDef[]
  onCommit: (text: string) => void
  /** The tile was pressed: the rows it shows are what the drag carries. */
  onArmDrag: (text: string, e: React.PointerEvent) => void
  /** And a press that never moved is a click, which picks the label already up. */
  onPick: () => void
}): React.ReactElement {
  useLanguage()
  const rows = comp ? signTextLines(comp.text) : []
  const [zh, setZh] = useState(rows[0] ?? '')
  const [en, setEn] = useState(rows[1] ?? '')
  // The boxes are re-seeded only when a **different** text box is picked: an edit
  // writes the board back through the store, so re-seeding on every write would
  // overwrite what is being typed with the text that typing just produced.
  const forId = useRef<string | null>(null)
  useEffect(() => {
    const id = comp?.id ?? null
    if (forId.current === id) return
    forId.current = id
    const next = comp ? signTextLines(comp.text) : []
    setZh(next[0] ?? '')
    setEn(next[1] ?? '')
  }, [comp])
  const push = (a: string, b: string): void => {
    // Each box keeps its own limit — 中文 eight, English twenty-four — so typing the
    // gloss never eats the name and the joined label is what `signTextLines`
    // reads back out of the component.
    const zh = [...a].slice(0, SIGN_TEXT_MAX).join('')
    const en = [...b].slice(0, SIGN_TEXT_EN_MAX).join('')
    onCommit([zh, en].filter((r) => r.trim() !== '').join('\n'))
  }
  // The two rows as one label: 中文 over its gloss, empty rows dropped, which is what
  // `signTextLines` reads back out of a component.
  const text = [zh, en].map((r) => r.trim()).filter((r) => r !== '').join('\n')
  return (
    <>
      <MarkTile
        mark={paletteMark({ kind: 'text', text: text === '' ? msg('text') : text })}
        lines={stationLines}
        active={comp !== undefined}
        label={text === '' ? msg('text') : text.replace('\n', ' / ')}
        onPointerDown={(e) => onArmDrag(text, e)}
        onClick={onPick}
      />
      <input
        className="signText"
        value={zh}
        maxLength={SIGN_TEXT_MAX}
        placeholder={t('primary_sign_text')}
        aria-label={t('primary_sign_text')}
        onChange={(e) => {
          setZh(e.target.value)
          push(e.target.value, en)
        }}
      />
      <input
        className="signCaption"
        value={en}
        maxLength={SIGN_TEXT_EN_MAX}
        placeholder={t('secondary_sign_text')}
        aria-label={t('secondary_sign_text')}
        onChange={(e) => {
          setEn(e.target.value)
          push(zh, e.target.value)
        }}
      />
    </>
  )
}
