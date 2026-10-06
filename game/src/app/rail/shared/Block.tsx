// The rail's square tile button (§5 build-rail chrome).
//
// Art is one of four, in that order of preference: the real model thumbnail, a caller's
// own glyph, a blueprint line icon, or a colour field. Shared by composition (plan.md R5):
// every folder and menu renders Blocks, none subclasses them.
//
// **A tile carries no tooltip.** It shows its label, its art and its key badge, and
// nothing else about itself: hover text is a second, quieter label that says what the
// tile already says, and it covers the picture it belongs to. A control that needs words
// of its own wears them as its label (the 旋转 tile names the angle it turns to) or as
// the state it is in (重做 / 撤销 are disabled by the store, not explained on hover).

import { Icon } from './Icon.tsx'

interface BlockProps {
  label: string
  active?: boolean
  onClick?: () => void
  /** A rendered model thumbnail (equipment). */
  thumb?: string
  /**
   * A glyph the caller draws itself, for a mark the rail's own line-icon set does not
   * have — a `react-icons` component, say (`rail/shared/RotateTile.tsx`). Any `<svg>`
   * here is sized and centred by `.bpBlockArt`, exactly as an `icon` name is.
   */
  art?: React.ReactNode
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
   * is discoverable, but plainly out of play (the 方块 tool's 生成墙壁 while a cut piece
   * owns the tool — though there the tile is not drawn at all, since the cut *is* the
   * wall a patch would grow; the 显示其他层 / 隐藏天花板 pair while **隐藏UI** is on is
   * the state this wears).
   */
  disabled?: boolean
  /**
   * What this tile *is*, as the palette option / finish / brush id it arms — worn
   * as `data-tile`, and the handle the rail scrolls a tile into view by
   * (`rail/helpers.ts` `armedRailTile`). Left off by tiles that arm nothing (an
   * action, a tool), which is also what keeps them out of the reveal's way.
   */
  tile?: string
}

export function Block({ label, active, onClick, thumb, art, icon, tone, submenu, shortcut, disabled, tile }: BlockProps): React.ReactElement {
  return (
    <button
      type="button"
      className={active ? 'bpBlock on' : 'bpBlock'}
      onClick={onClick}
      disabled={disabled}
      data-tile={tile}
      aria-pressed={active}
      aria-expanded={submenu}
    >
      {shortcut ? (
        <span className="bpKey" aria-hidden="true">
          {shortcut}
        </span>
      ) : null}
      <span className="bpBlockArt">
        {/* Art is one of four, in that order of preference: the real model, the
            caller's own glyph, a blueprint line icon, or a colour field. The 房间 tiles
            hand over their icon *and* their colour, and the icon is the one that
            identifies the room — the colour is only what the drag paints the floor
            with. */}
        {thumb ? (
          <img src={thumb} alt="" draggable={false} />
        ) : art ? (
          art
        ) : icon ? (
          <Icon name={icon} />
        ) : tone ? (
          <i className="bpTone" style={{ background: tone }} />
        ) : null}
        {submenu !== undefined ? <span className={submenu ? 'bpCaret on' : 'bpCaret'} aria-hidden="true" /> : null}
      </span>
      <span className="bpBlockLabel">{label}</span>
    </button>
  )
}
