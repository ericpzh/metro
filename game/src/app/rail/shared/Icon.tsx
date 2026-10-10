// A blueprint line icon, drawn in `currentColor` on a 20 × 20 grid (§5.8 tile art).
//
// The rail's tiles wear them, and so does the 指示牌 editor's bin — the one icon
// two menus share, so a bin on a sign and the 删除 tool in the rail cannot drift
// apart. Kept as one dispatcher file; split into icons/ only if it regrows past
// the ~300-line cap (plan.md Lane B).

import { GiBulldozer } from 'react-icons/gi'
import { RiDragDropLine } from 'react-icons/ri'
import { BsInfoCircleFill } from 'react-icons/bs'

export function Icon({ name }: { name: string }): React.ReactElement {
  const s = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.3,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  const svg = (children: React.ReactNode): React.ReactElement => (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      {children}
    </svg>
  )
  switch (name) {
    case 'move':
      return <RiDragDropLine />
    case 'bulldozer':
      return <GiBulldozer />
    case 'select':
      return svg(<path {...s} fill="currentColor" stroke="none" d="M5 3l10 7.2-4.3.6 2.5 4.4-1.9 1-2.4-4.4L5 15z" />)
    case 'block':
      return svg(
        <>
          <path {...s} d="M10 3l6 3.4v7.2L10 17l-6-3.4V6.4z" />
          <path {...s} d="M4 6.4l6 3.4 6-3.4M10 9.8V17" />
        </>,
      )
    // A thin roof plate, using the same outlined volume as the block tile.
    case 'roof':
      return svg(
        <>
          <path {...s} d="M10 5L17 9l-7 4-7-4zM3 9v2.5l7 4 7-4V9M10 13v2.5" />
        </>,
      )
    case 'roof-shell':
      return svg(<path {...s} d="M2 8l8-4 8 4M3 8v2l7 4 7-4V8M4 11h12" />)
    case 'roof-truss':
      return svg(<><path {...s} d="M2 7l8-3 8 3M2 7v2l8-3 8 3V7M3 10h14M3 15h14M3 10l3.5 5 3.5-5 3.5 5 3.5-5" /></>)
    case 'roof-tapered':
      return svg(<><path {...s} d="M2 7l8-3 8 3M2 7v2l8-3 8 3V7M3 10l7 6 7-6M5 12l5 4 5-4M4 16h12" /></>)
    // A column with its head and foot plates; the variants change shaft width.
    case 'pillar':
    case 'pillar-thick':
      return svg(
        <>
          <path {...s} d="M5 3h10v2H5zM7 5v10M13 5v10M5 15h10v2H5z" />
          <path {...s} strokeWidth="0.9" d="M10 6.5v7" />
        </>,
      )
    case 'pillar-slim':
      return svg(
        <>
          <path {...s} d="M6 3h8v2H6zM9 5v10M11 5v10M6 15h8v2H6z" />
        </>,
      )
    // A brick wall: three courses, joints staggered.
    case 'wall':
      return svg(
        <>
          <rect {...s} x="3.4" y="4" width="13.2" height="12" rx="0.6" />
          <path {...s} d="M3.4 8h13.2M3.4 12h13.2M8 4v4M12 8v4M8 12v4" />
        </>,
      )
    // A 半墙: the same courses at half the thickness, with the clear half of the
    // tile beside it left as dashed lines — the space the wall keeps usable.
    case 'halfwall':
      return svg(
        <>
          <rect {...s} x="3.4" y="4" width="6.4" height="12" rx="0.6" />
          <path {...s} d="M3.4 8h6.4M3.4 12h6.4M6.6 4v4M6.6 12v4" />
          <path {...s} strokeDasharray="2 2" d="M12.4 4v12M16.6 4v12" />
        </>,
      )
    // 三角上 / 三角下: the cell in plan, cut corner to corner, with the half that is
    // **not** built left dashed — the piece is the triangle, and which triangle it
    // is has to read at tile size. Hatched inside, the way the 半墙 mark hatches its
    // courses, so "this tile lays a cut block" reads the same in both.
    case 'triUpper':
      return svg(
        <>
          <rect {...s} strokeDasharray="2 2" x="3.4" y="4" width="13.2" height="12" rx="0.6" />
          <path {...s} d="M3.4 16L16.6 4" />
          <path {...s} d="M3.4 16h13.2V4" />
          <path {...s} strokeWidth="0.9" d="M6.4 13.4l2.6-2.6M9 14l2.6-2.6M11.6 14.6l2.6-2.6" />
        </>,
      )
    case 'triLower':
      return svg(
        <>
          <rect {...s} strokeDasharray="2 2" x="3.4" y="4" width="13.2" height="12" rx="0.6" />
          <path {...s} d="M3.4 4l13.2 12" />
          <path {...s} d="M3.4 16h13.2V4" />
          <path {...s} strokeWidth="0.9" d="M6.4 6.6l2.6 2.6M9 6l2.6 2.6M11.6 5.4l2.6 2.6" />
        </>,
      )
    // A waste bin: a block the delete tool tips away.
    case 'delete':
      return svg(
        <>
          <path {...s} d="M4.6 5.8h10.8" />
          <path {...s} d="M7.6 5.8V4.2c0-.5.4-.9.9-.9h3c.5 0 .9.4.9.9v1.6" />
          <path {...s} d="M6 5.8l.8 9.6c0 .6.5 1.1 1.1 1.1h4.2c.6 0 1.1-.5 1.1-1.1L14 5.8" />
          <path {...s} d="M8.7 8.6v4.8M11.3 8.6v4.8" />
        </>,
      )
    case 'module':
      return svg(
        <>
          <rect {...s} x="4" y="4" width="12" height="12" rx="1.2" />
          <path {...s} d="M7 8h6M7 11h4" />
        </>,
      )
    case 'paint':
      return svg(
        <>
          <rect {...s} x="4" y="4" width="8" height="5" rx="1" />
          <path {...s} d="M12 6.5h3.5v3H8.5v2.5" />
          <rect {...s} x="6.8" y="12" width="3.4" height="4.6" rx="0.8" />
        </>,
      )
    case 'zone':
      return svg(
        <>
          <rect {...s} strokeDasharray="3 2.2" x="3.6" y="3.6" width="12.8" height="12.8" rx="1" />
          <path {...s} d="M7 13l6-6" />
        </>,
      )
    // 无分区 (the 分区 folder's last tile): the zone mark — the same dashed outline
    // the 分区 tool's own tile wears — with a rubber laid across it. Taking a label
    // off is what that tile does (`eraseZoneCells`): the cell goes back to reading
    // 无分区, which is what an unpainted tile is.
    case 'zoneErase':
      return svg(
        <>
          <rect {...s} strokeDasharray="3 2.2" x="3.6" y="3.6" width="12.8" height="12.8" rx="1" />
          <g transform="rotate(-45 10 10)">
            <rect {...s} x="5.7" y="7.7" width="8.6" height="4.6" rx="1.1" />
            <path {...s} d="M10.7 7.7v4.6" />
          </g>
        </>,
      )
    case 'rail':
      return svg(
        <>
          <path {...s} d="M6 3v14M14 3v14" />
          <path {...s} d="M4 6h12M4 10h12M4 14h12" />
        </>,
      )
    // An elevated track deck on two piers, with rails and sleepers above it.
    case 'bridge':
      return svg(
        <>
          <path {...s} d="M2 4h16M2 6.5h16M4 3v4.5M8 3v4.5M12 3v4.5M16 3v4.5" />
          <path {...s} d="M2 8.5h16v2H2zM5 10.5V17h2v-6.5M13 10.5V17h2v-6.5M3.5 17h5M11.5 17h5" />
        </>,
      )
    // A tunnel mouth: an arch with the track running into it.
    case 'tunnel':
      return svg(
        <>
          <path {...s} d="M4 17V10a6 6 0 0 1 12 0v7" />
          <path {...s} d="M8 17v-6.5a2 2 0 0 1 4 0V17" />
          <path {...s} d="M4 13h4M12 13h4" />
        </>,
      )
    // Heroicons "refresh" — a two-arrow circular sweep, the icon the player
    // expects for "reset the screen doors".
    case 'refresh':
      return svg(
        <>
          <path {...s} d="M3.3 3.3v4.2h.5" />
          <path {...s} d="M16.6 9.2A6.7 6.7 0 0 0 3.8 7.5" />
          <path {...s} d="M3.8 7.5H7.5" />
          <path {...s} d="M16.7 16.7v-4.2h-.5" />
          <path {...s} d="M16.2 12.5a6.7 6.7 0 0 1-12.8-1.7" />
          <path {...s} d="M16.2 12.5H12.5" />
        </>,
      )
    case 'up':
      return svg(<path {...s} d="M5 12l5-5 5 5" />)
    case 'down':
      return svg(<path {...s} d="M5 8l5 5 5-5" />)
    case 'single':
      return svg(
        <>
          <rect {...s} x="7" y="7" width="6" height="6" rx="0.5" />
          <path {...s} d="M4 7V4h3M13 4h3v3M16 13v3h-3M7 16H4v-3" />
        </>,
      )
    case 'surface':
      return svg(
        <>
          <rect {...s} x="4" y="4" width="12" height="12" rx="0.6" />
          <path {...s} d="M8 4v12M12 4v12M4 8h12M4 12h12" />
        </>,
      )
    // A turnstile: the cabinet block, its leaf, and the way through beside it.
    case 'turnstile':
      return svg(
        <>
          <rect {...s} x="3.2" y="4.4" width="4.6" height="11.2" rx="0.8" />
          <path {...s} d="M8 10h4.6" />
          <path {...s} d="M11 8.2l1.8 1.8-1.8 1.8" />
          <path {...s} d="M16.6 5.4v9.2" />
        </>,
      )
    case 'pick':
      return svg(
        <>
          <path {...s} d="M4.5 15.5l1-3 7.2-7.2 2.2 2.2-7.2 7.2z" />
          <path {...s} d="M11.4 4.9l1.7-1.7 3.7 3.7-1.7 1.7" />
        </>,
      )
    case 'ortho':
      return svg(
        <>
          <rect {...s} x="4" y="4" width="12" height="12" rx="1" />
          <path {...s} d="M4 8h12M8 4v12" />
        </>,
      )
    // 隐藏天花板: the room below, and the slab over it lifted away.
    case 'ceiling':
      return svg(
        <>
          <path {...s} d="M4 10.4v4.2l6 2.6 6-2.6v-4.2" />
          <path {...s} d="M4 10.4l6 2.6 6-2.6-6-2.6z" />
          <path {...s} strokeDasharray="3 2" d="M4 5.2h12" />
          <path {...s} d="M8 3.4l-1.2 1.8M12 3.4l1.2 1.8" />
        </>,
      )
    // 隐藏地面: the street as a plate in section — the line the pavement is, the
    // block it is a course of, and the plane lifted off it (dashed, the way 隐藏天花板
    // draws the slab it takes away).
    case 'ground':
      return svg(
        <>
          <path {...s} d="M3 15.6h14" />
          <path {...s} d="M5 18.4l-2-2.8M9 18.4l-2-2.8M13 18.4l-2-2.8M17 18.4l-2-2.8" />
          <path {...s} strokeDasharray="3 2" d="M3 10.2h14" />
          <path {...s} d="M6.6 8l-1.2-1.8M13.4 8l1.2-1.8" />
        </>,
      )
    // 自定义: the 指示牌 editor's own mark — a pencil, because the tile opens an
    // editor rather than setting one property.
    case 'board':
      return svg(
        <>
          <path {...s} d="M3.4 16.6l.9-3.4 9.3-9.3 2.5 2.5-9.3 9.3z" />
          <path {...s} d="M12.2 5.3l2.5-2.5 2.5 2.5-2.5 2.5" />
        </>,
      )
    case 'ghost':
      return svg(
        <>
          <path {...s} d="M10 3l7 3.6-7 3.6-7-3.6z" />
          <path {...s} d="M3 10.4l7 3.6 7-3.6" />
          <path {...s} d="M3 13.8l7 3.6 7-3.6" />
        </>,
      )
    // 隐藏UI: the 1 m editing lattice, dashed, because what it stands for is the
    // lattice taken away rather than a plane of the station.
    case 'gridOff':
      return svg(
        <>
          <path {...s} strokeDasharray="2.6 2.2" d="M4 6.4h12M4 10h12M4 13.6h12M6.4 4v12M10 4v12M13.6 4v12" />
        </>,
      )
    case 'cutaway':
      return svg(
        <>
          <path {...s} d="M10 3l6 3.4v7.2L10 17l-6-3.4V6.4z" />
          <path {...s} d="M10 3v7l6-3.4M10 10l6 3.4M10 10l-6 3.4M10 10V17" />
        </>,
      )
    // 旋转: one quarter turn of the cut — a square in plan and the arc its edge
    // swings through, with the arrow head landing on the next face. The rail's 旋转
    // tiles do **not** wear it: they are one control (`shared/RotateTile.tsx`) and draw
    // a turning arrow of their own (`react-icons`' `AiOutlineRotateRight`), which reads
    // as "turn this" without the label. Nothing else uses this mark today.
    case 'rotate':
      return svg(
        <>
          <rect {...s} x="5" y="5" width="10" height="10" rx="1" />
          <path {...s} d="M3.2 10a6.8 6.8 0 0 1 6.8-6.8" />
          <path {...s} d="M13.4 2.4l1.4 1.6-1.4 1.6" />
        </>,
      )
    // 隐藏剖切面: the cut line in plan, and the direction arrow that says which
    // half of it is kept — the same mark the viewport draws in 3D.
    case 'cutSurface':
      return svg(
        <>
          <path {...s} d="M3 13.4h14" />
          <path {...s} d="M10 10.6V4.2" />
          <path {...s} d="M7.6 6.6L10 4.2l2.4 2.4" />
          <path {...s} strokeDasharray="2.4 2.2" d="M3 16.6h14" />
        </>,
      )
    case 'heat':
      return svg(
        <>
          <circle {...s} cx="10" cy="10" r="2" />
          <circle {...s} cx="10" cy="10" r="4.6" />
          <circle {...s} cx="10" cy="10" r="7.2" />
        </>,
      )
    case 'zoneHeat':
      return svg(
        <>
          <rect {...s} x="3.6" y="3.6" width="12.8" height="12.8" rx="1" />
          <circle {...s} cx="10" cy="10" r="2.4" />
        </>,
      )
    case 'undo':
      return svg(
        <>
          <path {...s} d="M7 5L3 9l4 4" />
          <path {...s} d="M3 9h8.5a4 4 0 0 1 0 8H8" />
        </>,
      )
    // The four 房间 types. These are the rail's own line marks, drawn like every
    // other blueprint icon: a facility room tile shows *what the room is for*,
    // which the tile's colour field could never say. 厕所 reuses the 指示牌's
    // restroom mark (the same two figures, the same silhouettes), so the room the
    // player builds and the sign they hang for it read as one thing.
    case 'roomStore':
      return svg(
        <>
          <path {...s} d="M4.4 8.2v8.4h11.2V8.2" />
          <path {...s} d="M7.6 16.6v-4.2h4.8v4.2" />
          <path {...s} d="M3 8.2l1.8-4.6h10.4L17 8.2z" />
          <path {...s} d="M6.7 3.6v4.6M10 3.6v4.6M13.3 3.6v4.6" />
        </>,
      )
    // 售票亭: a ticket, torn along its stub, with a punched hole.
    case 'roomTicket':
      return svg(
        <>
          <path {...s} d="M3.4 5.2h13.2v9.6H3.4z" />
          <path {...s} d="M12.6 5.2v9.6" strokeDasharray="1.8 1.6" />
          <path {...s} d="M5.6 8.4h5.2M5.6 11.6h3.8" />
          <circle {...s} cx="14.8" cy="10" r="0.62" />
        </>,
      )
    case 'roomInfo':
      return <BsInfoCircleFill />
    // 办公室: a desk with a monitor on it and a chair drawn up to the near side.
    case 'roomOffice':
      return svg(
        <>
          <rect {...s} x="7.2" y="5" width="8" height="5.6" rx="0.7" />
          <path {...s} d="M11.2 10.6v1.2" />
          <path {...s} d="M10.4 11.8h1.6" />
          <path {...s} d="M4 13h13.6M5.2 13v3.6M16.4 13v3.6" />
          <path {...s} d="M6.6 16.2h4.4M8.8 16.2v1.6" />
        </>,
      )
    // 厕所 — the 指示牌's restroom mark, drawn as lines.
    case 'roomRestroom':
      return svg(
        <>
          <circle {...s} cx="6.4" cy="5.9" r="1.75" />
          <path {...s} d="M6.4 7.9l-1.5 4.6h1.5v4.5h1.5V12.5h.9l-1.5-4.6" />
          <circle {...s} cx="13.6" cy="5.9" r="1.75" />
          <path {...s} d="M13.6 7.9c-1.3 0-2.1.9-2.1 2.1v2.5c0 .4.3.7.7.7h.25v3.8h2.3v-3.8h.25c.4 0 .7-.3.7-.7V10c0-1.2-.8-2.1-2.1-2.1z" />
        </>,
      )
    case 'redo':
      return svg(
        <>
          <path {...s} d="M13 5l4 4-4 4" />
          <path {...s} d="M17 9H8.5a4 4 0 0 0 0 8H12" />
        </>,
      )
    default:
      return svg(<rect {...s} x="4" y="4" width="12" height="12" rx="1" />)
  }
}
