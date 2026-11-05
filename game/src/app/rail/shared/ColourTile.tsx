import { msg, translate } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
import { Block } from './Block.tsx'
// The shared colour picker tile for 搪瓷板 and 涂料 (§4.3).
//
// Saved colours select the brush; the current colour opens a native picker.
// The caller must give the current tile a key that does not depend on its colour:
// the native picker stays open across `onChange` events only while this input
// keeps its DOM node, so remounting it on the first drag would drop the edit.
// `hexColour` is also used for the material tile's swatch.

/** Lowercase `#rrggbb` for a packed 0xRRGGBB colour (native `<input type=color>`). */
export function hexColour(colour: number): string {
  return `#${(colour >>> 0).toString(16).padStart(6, '0').slice(-6)}`
}

export function ColourTile({ colour, current, onChange }: { colour: number; current: boolean; onChange: (colour: number) => void }): React.ReactElement {
  useLanguage()
  if (!current) {
    return <Block label={hexColour(colour).toUpperCase()} tone={hexColour(colour)} onClick={() => onChange(colour)} />
  }
  return (
    <label className="bpBlock on">
      <span className="bpBlockArt">
        <input
          className="bpColour"
          type="color"
          value={hexColour(colour)}
          onChange={(e) => onChange(Number.parseInt(e.target.value.slice(1), 16))}
        />
      </span>
      <span className="bpBlockLabel">{translate(hexColour(colour).toUpperCase())}</span>
    </label>
  )
}

/** A separate palette slot for adding a new saved finish colour. */
export function NewColorTile({ colour, onChange }: { colour: number; onChange: (colour: number) => void }): React.ReactElement {
  useLanguage()
  return (
    <label className="bpBlock bpNewColourTile">
      <span className="bpBlockArt bpNewColourArt">
        <span aria-hidden="true" className="bpNewColourPlus">+</span>
        <input
          className="bpNewColourInput"
          type="color"
          value={hexColour(colour)}
          aria-label={translate(msg('new_color'))}
          onChange={(e) => onChange(Number.parseInt(e.target.value.slice(1), 16))}
        />
      </span>
      <span className="bpBlockLabel">{translate(msg('new_color'))}</span>
    </label>
  )
}
