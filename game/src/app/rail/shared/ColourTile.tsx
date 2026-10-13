import { msg, translate } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
// The shared colour picker tile for 搪瓷板 and 涂料 (§4.3).
//
// It is a palette tile like any other, but its art is a native colour input, so
// one click opens the OS picker rather than opening a sub-menu. `hexColour` is
// exported because the 材质 folder also needs it for the enamel tile's swatch.

/** Lowercase `#rrggbb` for a packed 0xRRGGBB colour (native `<input type=color>`). */
export function hexColour(colour: number): string {
  return `#${(colour >>> 0).toString(16).padStart(6, '0').slice(-6)}`
}

export function ColourTile({ colour, onChange }: { colour: number; onChange: (colour: number) => void }): React.ReactElement {
  useLanguage()
  return (
    <label className="bpBlock">
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
