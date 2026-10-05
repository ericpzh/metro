// Full-width fold-out rows for the rail's tile grids (§5 build-rail chrome).
//
// A derived row folds out right below its parent tile's row, reusing the subMenu
// 0fr → 1fr animation so later tiles are pushed down on expand and pulled back
// on collapse. `InlineExpand` forces a tile grid inside (variant lists, action
// rows); `InlinePanel` takes arbitrary folder content (titles, sliders, status).
// `interleaveRows` anchors those rows to their parent tiles in a 2-column grid.

import { useRef } from 'react'

/**
 * An inline derived row: a full-width grid item that folds out right below its
 * parent tile's row, reusing the subMenu 0fr → 1fr animation so later tiles are
 * pushed down on expand and pulled back on collapse. It stays mounted when
 * closed (and freezes its last open content) so switching tools shrinks the old
 * row while the new one expands instead of popping.
 */
export function InlineExpand({ open, children }: { open: boolean; children: React.ReactNode }): React.ReactElement {
  const retained = useRef(children)
  if (open) retained.current = children
  return (
    <div className={open ? 'subMenu open inlineExpand' : 'subMenu inlineExpand'} aria-hidden={!open} inert={!open}>
      <div className="subMenuInner">
        <div className="subMenuPad">
          <div className="blockGrid">{open ? children : retained.current}</div>
        </div>
      </div>
    </div>
  )
}

/**
 * An inline derived panel for arbitrary folder content (titles, sliders,
 * status): same full-width row, same subMenu fold and frozen-content swap as
 * InlineExpand, but without forcing a tile grid inside.
 */
export function InlinePanel({ open, children }: { open: boolean; children: React.ReactNode }): React.ReactElement {
  const retained = useRef(children)
  if (open) retained.current = children
  return (
    <div className={open ? 'subMenu open inlineExpand' : 'subMenu inlineExpand'} aria-hidden={!open} inert={!open}>
      <div className="subMenuInner">
        <div className="subMenuPad">{open ? children : retained.current}</div>
      </div>
    </div>
  )
}

/**
 * Interleave full-width expansions into a 2-column tile grid: after each row of
 * up to two tiles, emit the expansions anchored to that row's tiles. The grid
 * then grows a brand-new row directly under the parent instead of appending at
 * the folder bottom.
 */
export function interleaveRows(
  main: Array<{ anchor: string; node: React.ReactNode }>,
  getExpansions: (anchor: string) => React.ReactNode[],
): React.ReactNode[] {
  const out: React.ReactNode[] = []
  for (let i = 0; i < main.length; i += 2) {
    const row = main.slice(i, i + 2)
    for (const t of row) out.push(t.node)
    for (const t of row) {
      for (const e of getExpansions(t.anchor)) out.push(e)
    }
  }
  return out
}
