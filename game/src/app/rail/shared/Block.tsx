// The rail's square tile button (§5 build-rail chrome).
//
// Art is one of three, in that order of preference: the real model thumbnail,
// a blueprint line icon, or a colour field. Shared by composition (plan.md R5):
// every folder and menu renders Blocks, none subclasses them.

import { Icon } from './Icon.tsx'

interface BlockProps {
  label: string
  active?: boolean
  onClick?: () => void
  /** A rendered model thumbnail (equipment). */
  thumb?: string
  /** A blueprint line icon. */
  icon?: string
  /** A solid colour field (finishes, zones). */
  tone?: string
  /**
   * Marks a tile that opens a nested sub-menu. `true` = expanded, `false` =
   * collapsed; leave undefined for ordinary tiles.
   */
  submenu?: boolean
  /** Keyboard shortcut, shown as a badge on hover / focus. */
  shortcut?: string
  /**
   * A tile another mode of the same tool has taken over: still drawn, so the rule
   * is discoverable, but plainly out of play (the 地基 tool's 自动生成墙壁 while
   * **半墙** is on).
   */
  disabled?: boolean
}

export function Block({ label, active, onClick, thumb, icon, tone, submenu, shortcut, disabled }: BlockProps): React.ReactElement {
  return (
    <button
      type="button"
      className={active ? 'bpBlock on' : 'bpBlock'}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-expanded={submenu}
    >
      {shortcut ? (
        <span className="bpKey" aria-hidden="true">
          {shortcut}
        </span>
      ) : null}
      <span className="bpBlockArt">
        {/* Art is one of three, in that order of preference: the real model, a
            blueprint line icon, or a colour field. The 房间 tiles hand over their
            icon *and* their colour, and the icon is the one that identifies the
            room — the colour is only what the drag paints the floor with. */}
        {thumb ? <img src={thumb} alt="" draggable={false} /> : icon ? <Icon name={icon} /> : tone ? <i className="bpTone" style={{ background: tone }} /> : null}
        {submenu !== undefined ? <span className={submenu ? 'bpCaret on' : 'bpCaret'} aria-hidden="true" /> : null}
      </span>
      <span className="bpBlockLabel">{label}</span>
    </button>
  )
}
