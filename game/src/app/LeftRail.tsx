// The build rail (left column).
//
// A blueprint-styled stack of folders. Each folder is a "menu" that folds open
// with an animated height transition and lays its entries out as square blocks
// in two columns. Equipment blocks are the real in-game 3D models, rendered to
// thumbnails by `moduleThumbnails.ts`; everything else uses a blueprint line
// icon or a colour field. Keyboard shortcuts work, and each tool shows its key
// as a small badge when hovered or focused.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FACILITY_OPTIONS,
  MODULE_OPTIONS,
  isBenchType,
  isBillboardType,
  isDecorType,
  isEscalatorType,
  isExitType,
  isFacilityBrush,
  isGateType,
  isRotatableType,
  isStairType,
  useStore,
  type Tool,
} from './store.ts'
import { getModuleThumbnails } from './moduleThumbnails.ts'
import { getZoneThumbnails } from './zoneThumbnails.ts'
import { FINISH_LIST, customFinishId, finishBaseId, finishLabel, finishTint } from '../sim/finishes.ts'
import { stairLanes } from '../sim/stairs.ts'
import { ZONE_LIST } from '../sim/zones.ts'
import type { GateDoor, Module } from '../sim/types.ts'
import { railSummary } from '../build/rail.ts'

/* ------------------------------------------------------------------- icons */

/**
 * A blueprint line icon, drawn in `currentColor` on a 20 × 20 grid. The rail's tiles
 * wear them, and so does the 指示牌 editor's bin — the one icon two menus share, so a bin
 * on a sign and the 删除 tool in the rail cannot drift apart.
 */
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
    case 'select':
      return svg(<path {...s} fill="currentColor" stroke="none" d="M5 3l10 7.2-4.3.6 2.5 4.4-1.9 1-2.4-4.4L5 15z" />)
    case 'block':
      return svg(
        <>
          <path {...s} d="M10 3l6 3.4v7.2L10 17l-6-3.4V6.4z" />
          <path {...s} d="M4 6.4l6 3.4 6-3.4M10 9.8V17" />
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
    case 'rail':
      return svg(
        <>
          <path {...s} d="M6 3v14M14 3v14" />
          <path {...s} d="M4 6h12M4 10h12M4 14h12" />
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
    case 'cutaway':
      return svg(
        <>
          <path {...s} d="M10 3l6 3.4v7.2L10 17l-6-3.4V6.4z" />
          <path {...s} d="M10 3v7l6-3.4M10 10l6 3.4M10 10l-6 3.4M10 10V17" />
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

/* ------------------------------------------------------------ square block */

interface BlockProps {
  label: string
  active?: boolean
  title?: string
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
}

function Block({ label, active, title, onClick, thumb, icon, tone, submenu, shortcut }: BlockProps): React.ReactElement {
  return (
    <button
      type="button"
      className={active ? 'bpBlock on' : 'bpBlock'}
      title={title ?? label}
      onClick={onClick}
      aria-pressed={active}
      aria-expanded={submenu}
    >
      {shortcut ? (
        <span className="bpKey" aria-hidden="true">
          {shortcut}
        </span>
      ) : null}
      <span className="bpBlockArt">
        {thumb ? <img src={thumb} alt="" draggable={false} /> : null}
        {!thumb && icon ? <Icon name={icon} /> : null}
        {!thumb && !icon && tone ? <i className="bpTone" style={{ background: tone }} /> : null}
        {submenu !== undefined ? <span className={submenu ? 'bpCaret on' : 'bpCaret'} aria-hidden="true" /> : null}
      </span>
      <span className="bpBlockLabel">{label}</span>
    </button>
  )
}

/** Lowercase `#rrggbb` for a packed 0xRRGGBB colour (native `<input type=color>`). */
function hexColour(colour: number): string {
  return `#${(colour >>> 0).toString(16).padStart(6, '0').slice(-6)}`
}

/**
 * The colour picker tile for 搪瓷板. It is a palette tile like any other, but its
 * art is a native colour input, so one click opens the OS picker rather than
 * opening a sub-menu.
 */
function ColourTile({ colour, onChange }: { colour: number; onChange: (colour: number) => void }): React.ReactElement {
  return (
    <label className="bpBlock" title="选择搪瓷板的颜色">
      <span className="bpBlockArt">
        <input
          className="bpColour"
          type="color"
          value={hexColour(colour)}
          onChange={(e) => onChange(Number.parseInt(e.target.value.slice(1), 16))}
        />
      </span>
      <span className="bpBlockLabel">{hexColour(colour).toUpperCase()}</span>
    </label>
  )
}

/* ---------------------------------------------------------------- folder */

interface FolderProps {
  title: string
  count?: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}

export function Folder({ title, count, open, onToggle, children }: FolderProps): React.ReactElement {
  return (
    <section className={open ? 'folder open' : 'folder'}>
      <button type="button" className="folderHead" onClick={onToggle} aria-expanded={open}>
        <span className="folderName">{title}</span>
        {typeof count === 'number' ? <span className="folderCount">{count}</span> : null}
        <span className="folderCaret" aria-hidden="true" />
      </button>
      <div className="folderBody" aria-hidden={!open} inert={!open}>
        <div className="folderInner">
          <div className="folderPad">{children}</div>
        </div>
      </div>
    </section>
  )
}

const FAMILY_LABEL: Record<string, string> = { floor: '地面 · 轨道', ceiling: '天花板', wall: '墙面' }

/**
 * An inline derived row: a full-width grid item that folds out right below its
 * parent tile's row, reusing the subMenu 0fr → 1fr animation so later tiles are
 * pushed down on expand and pulled back on collapse. It stays mounted when
 * closed (and freezes its last open content) so switching tools shrinks the old
 * row while the new one expands instead of popping.
 */
function InlineExpand({ open, children }: { open: boolean; children: React.ReactNode }): React.ReactElement {
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
function InlinePanel({ open, children }: { open: boolean; children: React.ReactNode }): React.ReactElement {
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
function interleaveRows(
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

/** The 闸机 tile's Tab cycle, in the label the action tile wears. */
const GATE_DOOR_LABEL: Record<GateDoor, string> = { lane: '有门', fence: '围栏' }

/* ------------------------------------------------------------------- rail */

type FolderKey = 'tools' | 'equipment' | 'rail' | 'rooms' | 'decor' | 'surfaces' | 'zones' | 'view'

/** The nested variant sub-menus, at most one of which may be expanded. */
type SubMenuKey = 'stair' | 'exit' | 'bench' | 'billboard' | 'enamel'

/** Which nested variant sub-menu owns a module, or null if it owns none. */
function subMenuForModule(moduleType: string): SubMenuKey | null {
  if (isStairType(moduleType)) return 'stair'
  if (isExitType(moduleType)) return 'exit'
  if (isBenchType(moduleType)) return 'bench'
  if (isBillboardType(moduleType)) return 'billboard'
  return null
}

const FOLDER_FOR_TOOL: Record<Tool, FolderKey> = {
  select: 'tools',
  block: 'tools',
  wall: 'tools',
  delete: 'tools',
  module: 'equipment',
  paint: 'surfaces',
  zone: 'zones',
  rail: 'rail',
  tunnel: 'rail',
}

export function LeftRail(): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const autoWalls = useStore((s) => s.autoWalls)
  const moduleType = useStore((s) => s.moduleType)
  const setModuleType = useStore((s) => s.setModuleType)
  const moduleRot = useStore((s) => s.moduleRot)
  const escalatorDir = useStore((s) => s.escalatorDir)
  const gateDoor = useStore((s) => s.gateDoor)
  const stairWidth = useStore((s) => s.stairWidth)
  const paintMode = useStore((s) => s.paintMode)
  const paintFinish = useStore((s) => s.paintFinish)
  const enamelColour = useStore((s) => s.enamelColour)
  const zoneBrush = useStore((s) => s.zoneBrush)
  const ghost = useStore((s) => s.ghostOtherLevels)
  const autoCeiling = useStore((s) => s.autoCeiling)
  const cutaway = useStore((s) => s.cutaway)
  const hideWalls = useStore((s) => s.hideWalls)
  const overlayOn = useStore((s) => s.overlayOn)
  const zoneOverlayOn = useStore((s) => s.zoneOverlayOn)
  const railDir = useStore((s) => s.railDir)
  const railLineId = useStore((s) => s.railLineId)
  const railRot = useStore((s) => s.railRot)
  const tunnelLength = useStore((s) => s.tunnelLength)
  const selected = useStore((s) => s.selected)
  const stationModules = useStore((s) => s.station.modules)
  const stationLines = useStore((s) => s.station.lines)

  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [zoneThumbs, setZoneThumbs] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<Record<FolderKey, boolean>>({
    tools: true,
    equipment: false,
    rail: false,
    rooms: false,
    decor: false,
    surfaces: false,
    zones: false,
    view: false,
  })
  // The nested variant sub-menus (楼梯 / 出入口 / 座椅 / 广告牌) share one piece
  // of state, so at most one is expanded at a time: opening one collapses the
  // rest, and picking any module the sub-menu does not own collapses them all.
  const [subMenu, setSubMenu] = useState<SubMenuKey | null>(() => subMenuForModule(moduleType))
  const stairOpen = subMenu === 'stair'
  const exitOpen = subMenu === 'exit'
  const benchOpen = subMenu === 'bench'
  const billboardOpen = subMenu === 'billboard'

  const stairOptions = useMemo(() => MODULE_OPTIONS.filter((m) => isStairType(m.type)), [])
  const gearOptions = useMemo(
    () => MODULE_OPTIONS.filter((m) => !isStairType(m.type) && !isDecorType(m.type) && !isExitType(m.id)),
    [],
  )
  const billboardOptions = useMemo(() => MODULE_OPTIONS.filter((m) => isBillboardType(m.id)), [])
  const benchOptions = useMemo(() => MODULE_OPTIONS.filter((m) => isBenchType(m.id)), [])
  const exitOptions = useMemo(() => MODULE_OPTIONS.filter((m) => isExitType(m.id)), [])
  const decorOptions = useMemo(
    () => MODULE_OPTIONS.filter((m) => isDecorType(m.type) && !isBillboardType(m.id) && !isBenchType(m.id)),
    [],
  )

  useEffect(() => {
    let alive = true
    void getModuleThumbnails().then((t) => {
      if (alive) setThumbs(t)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    void getZoneThumbnails().then((t) => {
      if (alive) setZoneThumbs(t)
    })
    return () => {
      alive = false
    }
  }, [])

  // Fold the folder that owns the active tool open, so the menu tracks the mode.
  // A facility brush rides the zone tool but lives in its own 房间 folder, so it
  // opens that folder instead of 分区.
  useEffect(() => {
    const key: FolderKey =
      tool === 'zone' && isFacilityBrush(zoneBrush)
        ? 'rooms'
        : tool === 'module' && isDecorType(moduleType)
          ? 'decor'
          : FOLDER_FOR_TOOL[tool]
    setOpen((prev) => (prev[key] ? prev : { ...prev, [key]: true }))
  }, [tool, zoneBrush, moduleType])

  // Keep the sub-menu that owns the active piece open, and collapse the rest —
  // picking any tile (a variant, a plain module, or a different family) leaves
  // at most one variant list expanded.
  useEffect(() => {
    setSubMenu(subMenuForModule(moduleType))
  }, [moduleType])

  const toggle = (k: FolderKey): void => setOpen((o) => ({ ...o, [k]: !o[k] }))
  // Opening one variant list collapses any other; clicking the open one closes it.
  const toggleSubMenu = (k: SubMenuKey): void => setSubMenu((cur) => (cur === k ? null : k))
  const st = useStore.getState

  // The 轨道 folder is the rail panel. When a rail is selected it edits that
  // rail; otherwise it sets the defaults the next placement will use.
  const track =
    selected?.kind === 'module'
      ? (stationModules.find((m) => m.id === selected.key && m.type === 'track') as Extract<Module, { type: 'track' }> | undefined)
      : undefined
  // Selecting a rail makes it the 轨道 folder's subject, so reveal the folder —
  // the same way picking a tool opens the folder that owns it.
  useEffect(() => {
    if (track) setOpen((prev) => (prev.rail ? prev : { ...prev, rail: true }))
  }, [track?.id])
  const railDirNow = track ? (track.cfg.dir ?? 'up') : railDir
  const railLineNow = track ? track.cfg.line : railLineId || stationLines[0]?.id || ''
  const trackSummary = track ? railSummary(track, stationLines.find((l) => l.id === track.cfg.line)) : null
  // The platform-only controls (方向 / 线路 / 重置屏蔽门) make no sense for a
  // tunnel, so they are shown only while placing or editing a platform run.
  const editingTunnel = track ? !!track.cfg.tunnel : tool === 'tunnel'
  // Inline derived rows, same style as 设备 / 装饰: the platform row folds out
  // below 站台 while placing or editing a platform, the tunnel row below 隧道
  // while placing a tunnel. Clicking away closes both with the same shrink.
  const platformOpen = tool === 'rail' || (track !== undefined && !track.cfg.tunnel)
  const tunnelOpen = tool === 'tunnel'
  const setRailDirNow = (d: 'up' | 'down'): void => {
    if (track) st().updateRail(track.id, { dir: d })
    else st().setRailDir(d)
  }
  const setRailLineNow = (id: string): void => {
    if (track) st().updateRail(track.id, { line: id })
    else st().setRailLine(id)
  }

  const finishFamilies = useMemo(() => {
    const order = ['floor', 'ceiling', 'wall'] as const
    return order.map((fam) => {
      const items = FINISH_LIST.filter((f) =>
        fam === 'floor' ? f.family === 'floor' || f.family === 'track' : f.family === fam,
      )
      // 搪瓷板 sits last in 墙面: it is the one tile that opens a colour sub-menu.
      if (fam === 'wall') items.sort((a, b) => Number(a.id === 'wall.enamel') - Number(b.id === 'wall.enamel'))
      return { fam, items }
    })
  }, [])

  // 搪瓷板 wears a custom colour. The tile stays in 墙面; clicking it selects the
  // brush and folds out its colour-picker row, the way a variant sub-menu works.
  // Neither it nor a plain finish tile touches the `N`/`M` mode: the mode is the
  // 材质 folder's own setting, so a texture picked here — including after a detour
  // through another folder — leaves the brush in 单块 or 整面 as it was left.
  const enamelOpen = subMenu === 'enamel'
  const enamelActive = tool === 'paint' && finishBaseId(paintFinish) === 'wall.enamel'
  const selectEnamel = (colour: number = enamelColour): void => {
    st().selectPaintFinish(customFinishId('wall.enamel', colour))
  }
  const changeEnamel = (colour: number): void => {
    // The brush takes the colour straight from the picker. Reading the rendered
    // `enamelColour` here would still be the previous render's value, so the
    // brush — and the swatch, which follows the brush — lagged a step behind.
    st().setEnamelColour(colour)
    selectEnamel(colour)
  }
  // Eyedropping a custom-tinted enamel keeps the picker in step with the wall.
  useEffect(() => {
    const t = finishTint(paintFinish)
    if (t !== null && finishBaseId(paintFinish) === 'wall.enamel') st().setEnamelColour(t)
  }, [paintFinish])

  // Contextual actions for the equipment being placed, each gated by what the
  // piece actually supports: 旋转 only for turnable equipment, 宽度 for stairs,
  // 上行/下行 for the escalator. A future fixed-angle module simply loses its
  // rotation tile — no other change needed.
  //
  // 指示牌 is turnable **and** composed, so it shows both: 旋转 turns the hung
  // board, and 自定义 opens the board editor for the panel it will print (§5.8).
  const moduleActions: React.ReactNode[] = []
  if (isRotatableType(moduleType)) {
    moduleActions.push(
      <Block
        key="rotate"
        label={`旋转 ${((4 - moduleRot) % 4) * 90}°`}
        icon="redo"
        shortcut="R"
        title="R：旋转正在放置的设备"
        onClick={() => st().rotateModule()}
      />,
    )
  }
  if (moduleType === 'sign') {
    moduleActions.push(
      <Block
        key="custom"
        label="自定义"
        icon="board"
        title="打开指示牌面板：把内容拖到牌子上，牌子随内容伸缩；放下的指示牌就带着这块面板"
        onClick={() => st().openSignComposer()}
      />,
    )
  }
  if (isStairType(moduleType)) {
    const lanes = stairLanes(stairWidth)
    moduleActions.push(
      <Block
        key="width"
        label={`宽度 ${stairWidth.toFixed(1)}m`}
        icon="ortho"
        shortcut="Tab"
        title={`Tab：切换楼梯宽度。${lanes} 格 × 0.7m——一次放下的整跑是一体（中间不设栏杆）；另外单独放的楼梯各自保留栏杆，踏面依旧相接`}
        onClick={() => st().cycleStairWidth()}
      />,
    )
  }
  if (isEscalatorType(moduleType)) {
    moduleActions.push(
      <Block
        key="dir"
        label={escalatorDir === 'up' ? '上行' : '下行'}
        icon={escalatorDir === 'up' ? 'up' : 'down'}
        shortcut="Tab"
        title="Tab：切换扶梯上下行"
        onClick={() => st().cycleEscalatorDir()}
      />,
    )
  }
  if (isGateType(moduleType)) {
    moduleActions.push(
      <Block
        key="door"
        label={GATE_DOOR_LABEL[gateDoor]}
        icon="turnstile"
        shortcut="Tab"
        title="Tab：切换闸机 / 围栏。有门是正常闸机：机体占半格，另外半格是走道和红色挡板；围栏是一台没有闸机通道的机体，另外半格是围栏，用来给围栏收口。走道在哪一边用 R 转整个机体"
        onClick={() => st().cycleGateDoor()}
      />,
    )
  }

  // Where an equipment action row (旋转 / 宽度 / …) belongs: the tile that spawned
  // it, so the row can fold out right below its parent instead of at the folder
  // bottom. Group-owned pieces anchor to their parent tile; plain gear anchors to
  // its own tile. Null closes every row, letting the open one shrink away.
  const equipActionsAnchor =
    tool === 'module' && !isDecorType(moduleType) && moduleActions.length > 0
      ? isStairType(moduleType)
        ? '__stair'
        : isExitType(moduleType)
          ? '__exit'
          : moduleType
      : null
  // Same for 装饰: plain pieces anchor to their tile, 座椅 / 广告牌 variants to
  // their parent.
  const decorActionsAnchor =
    tool === 'module' && isDecorType(moduleType) && moduleActions.length > 0
      ? isBenchType(moduleType)
        ? '__bench'
        : isBillboardType(moduleType)
          ? '__billboard'
          : moduleType
      : null

  return (
    <div className="rail">
      <div className="railStamp">
        <span className="railStampTitle">建造栏</span>
        <span className="railStampSub">METRO / BUILD</span>
      </div>

      <Folder title="工具" count={tool === 'block' ? 7 : 6} open={open.tools} onToggle={() => toggle('tools')}>
        <div className="blockGrid">
          {(
            [
              { id: 'select', label: '选择', icon: 'select', shortcut: 'Z', title: '选择 (Z)：点方块或设备看它是什么' },
              {
                id: 'block',
                label: '地基',
                icon: 'block',
                shortcut: 'F',
                title: '地基 (F)：单击放一块，按住拖出一片（Tab 切换自动生成墙壁），右键删除',
              },
              { id: 'wall', label: '墙', icon: 'wall', shortcut: 'G', title: '墙 (G)：自动吸附到临空的一格；一个角落有两个朝向时按 R 选择贴哪一面。左键拖出 4m 高墙，右键拖拽整列拆除（自动生成的墙也可拆）' },
              {
                id: 'delete',
                label: '删除',
                icon: 'delete',
                shortcut: 'B',
                title: '删除 (B)：单击拆一块或一件设备；按住拖过同类设备/装饰可连续拆掉（拖过的都会亮起，松手一次拆完）；围栏沿拖拽方向整条拆除',
              },
            ] as Array<{ id: Tool; label: string; icon: string; title?: string; shortcut?: string }>
          ).map((t) => (
            <Block
              key={t.id}
              label={t.label}
              icon={t.icon}
              title={t.title}
              shortcut={t.shortcut}
              active={tool === t.id}
              onClick={() => setTool(t.id)}
            />
          ))}
          <Block label="撤销" icon="undo" shortcut="Ctrl+Z" title="撤销 (Ctrl+Z)" onClick={() => st().undo()} />
          <Block label="重做" icon="redo" shortcut="Ctrl+Y" title="重做 (Ctrl+Y 或 Ctrl+Shift+Z)" onClick={() => st().redo()} />
          {tool === 'block' && (
            <Block
              label="自动生成墙壁"
              icon="wall"
              active={autoWalls}
              shortcut="Tab"
              title="自动生成墙壁（Tab 切换）：开启后拖出一片地基会长出 4m 外墙；关闭则只铺地砖"
              onClick={() => st().setAutoWalls(!autoWalls)}
            />
          )}
        </div>
      </Folder>
      <Folder title="轨道" count={2} open={open.rail} onToggle={() => toggle('rail')}>
        <div className="blockGrid">
          {interleaveRows(
            [
              {
                anchor: '__platform',
                node: (
                  <Block
                    key="__platform"
                    label="站台"
                    icon="rail"
                    active={tool === 'rail'}
                    shortcut="L"
                    submenu={platformOpen}
                    title="站台轨道 (L)：在站台旁放一段列车长度的轨道床，自动生成屏蔽门"
                    onClick={() => setTool('rail')}
                  />
                ),
              },
              {
                anchor: '__tunnel',
                node: (
                  <Block
                    key="__tunnel"
                    label="隧道"
                    icon="tunnel"
                    active={tool === 'tunnel'}
                    submenu={tunnelOpen}
                    title="隧道轨道：在已有轨道端头接一段纯隧道，不生成屏蔽门"
                    onClick={() => setTool('tunnel')}
                  />
                ),
              },
            ],
            (anchor) => {
              if (anchor === '__platform') {
                return [
                  <InlinePanel key="platform-derived" open={platformOpen}>
                    {(tool !== 'tunnel' || !editingTunnel) && (
                      <div className="blockGrid">
                        {tool !== 'tunnel' && (
                          <Block
                            label={`旋转 ${((4 - railRot) % 4) * 90}°`}
                            icon="redo"
                            shortcut="R"
                            title="R：旋转站台轨道（东西 / 南北）"
                            onClick={() => st().rotateRail()}
                          />
                        )}
                        {!editingTunnel && (
                          <Block
                            label="重置屏蔽门"
                            icon="refresh"
                            title="按当前站台重新生成屏蔽门（选中轨道只重置它，否则重置全部）"
                            onClick={() => st().refreshRailDoors()}
                          />
                        )}
                      </div>
                    )}
                    {!editingTunnel && (
                      <>
                        <div className="bpSub">
                          <div className="bpSubTitle">方向</div>
                          <div className="blockGrid two">
                            <Block label="上行" icon="up" shortcut="Tab" title="上行（Tab 切换上下行）" active={railDirNow === 'up'} onClick={() => setRailDirNow('up')} />
                            <Block label="下行" icon="down" shortcut="Tab" title="下行（Tab 切换上下行）" active={railDirNow === 'down'} onClick={() => setRailDirNow('down')} />
                          </div>
                        </div>
                        <div className="bpSub">
                          <div className="bpSubTitle">线路</div>
                          <div className="blockGrid">
                            {stationLines.map((l) => (
                              <Block
                                key={l.id}
                                label={l.id}
                                tone={l.colour}
                                active={railLineNow === l.id}
                                title={`${l.name} · ${l.stock}型${l.cars}节`}
                                onClick={() => setRailLineNow(l.id)}
                              />
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </InlinePanel>,
                ]
              }
              if (anchor === '__tunnel') {
                return [
                  <InlinePanel key="tunnel-derived" open={tunnelOpen}>
                    <div className="bpSub">
                      <div className="bpSubTitle">隧道长度 {tunnelLength} m</div>
                      <input
                        type="range"
                        min={5}
                        max={200}
                        step={1}
                        value={tunnelLength}
                        onChange={(e) => st().setTunnelLength(Number(e.target.value))}
                      />
                    </div>
                  </InlinePanel>,
                ]
              }
              return []
            },
          )}
        </div>
        {track && (
          <div className="muted small railStatus">
            {`已选${track.cfg.tunnel ? '隧道' : '轨道'} · ${track.w} m × ${track.d ?? 1} m${trackSummary && !track.cfg.tunnel ? ` · ${trackSummary.cars} 节 ${trackSummary.trainLength} m · ${trackSummary.doors} 门` : ''}`}
          </div>
        )}
      </Folder>

      <Folder title="设备" count={gearOptions.length + 2} open={open.equipment} onToggle={() => toggle('equipment')}>
        <div className="blockGrid">
          {interleaveRows(
            [
              ...gearOptions.map((m) => ({
                anchor: m.id,
                node: (
                  <Block
                    key={m.id}
                    label={m.label}
                    thumb={thumbs[m.id]}
                    active={tool === 'module' && moduleType === m.id}
                    onClick={() => {
                      setModuleType(m.id)
                      setTool('module')
                    }}
                  />
                ),
              })),
              {
                anchor: '__stair',
                node: (
                  <Block
                    key="__stair"
                    label="楼梯"
                    thumb={thumbs[stairOptions[0]?.id ?? '']}
                    active={isStairType(moduleType)}
                    submenu={stairOpen}
                    title="楼梯：展开选形状"
                    onClick={() => toggleSubMenu('stair')}
                  />
                ),
              },
              {
                anchor: '__exit',
                node: (
                  <Block
                    key="__exit"
                    label="出入口"
                    thumb={thumbs['exit']}
                    active={isExitType(moduleType)}
                    submenu={exitOpen}
                    title="出入口：展开选有盖/无盖与单向/双向/三向"
                    onClick={() => toggleSubMenu('exit')}
                  />
                ),
              },
            ],
            (anchor) => {
              const rows: React.ReactNode[] = []
              if (anchor === '__stair') {
                rows.push(
                  <InlineExpand key="stair-variants" open={stairOpen}>
                    {stairOptions.map((m) => (
                      <Block
                        key={m.id}
                        label={m.label}
                        thumb={thumbs[m.id]}
                        active={tool === 'module' && moduleType === m.id}
                        onClick={() => {
                          setModuleType(m.id)
                          setTool('module')
                        }}
                      />
                    ))}
                  </InlineExpand>,
                )
              }
              if (anchor === '__exit') {
                rows.push(
                  <InlineExpand key="exit-variants" open={exitOpen}>
                    {exitOptions.map((m) => (
                      <Block
                        key={m.id}
                        label={m.label}
                        thumb={thumbs[m.id]}
                        active={tool === 'module' && moduleType === m.id}
                        onClick={() => {
                          setModuleType(m.id)
                          setTool('module')
                        }}
                      />
                    ))}
                  </InlineExpand>,
                )
              }
              // The contextual action row for whichever equipment spawned it; every
              // other anchor stays mounted but closed so the old row shrinks while
              // the new one expands.
              rows.push(
                <InlineExpand key={`equip-actions-${anchor}`} open={equipActionsAnchor === anchor}>
                  {moduleActions}
                </InlineExpand>,
              )
              return rows
            },
          )}
        </div>
      </Folder>

      <Folder title="房间" count={FACILITY_OPTIONS.length} open={open.rooms} onToggle={() => toggle('rooms')}>
        <div className="blockGrid">
          {FACILITY_OPTIONS.map((f) => (
            <Block
              key={f.id}
              label={f.label}
              thumb={zoneThumbs[f.id]}
              tone={`#${f.colour.toString(16).padStart(6, '0')}`}
              active={tool === 'zone' && zoneBrush === f.id}
              onClick={() => {
                st().setZoneBrush(f.id)
                setTool('zone')
              }}
            />
          ))}
        </div>
      </Folder>

      <Folder title="装饰" count={decorOptions.length + 2} open={open.decor} onToggle={() => toggle('decor')}>
        <div className="blockGrid">
          {interleaveRows(
            [
              ...decorOptions.map((m) => ({
                anchor: m.id,
                node: (
                  <Block
                    key={m.id}
                    label={m.label}
                    thumb={thumbs[m.id]}
                    active={tool === 'module' && moduleType === m.id}
                    onClick={() => {
                      setModuleType(m.id)
                      setTool('module')
                    }}
                  />
                ),
              })),
              {
                anchor: '__bench',
                node: (
                  <Block
                    key="__bench"
                    label="座椅"
                    thumb={thumbs[benchOptions[0]?.id ?? '']}
                    active={isBenchType(moduleType)}
                    submenu={benchOpen}
                    title="座椅：展开选不锈钢/靠背，各有 1m 与 2m"
                    onClick={() => toggleSubMenu('bench')}
                  />
                ),
              },
              {
                anchor: '__billboard',
                node: (
                  <Block
                    key="__billboard"
                    label="广告牌"
                    thumb={thumbs[billboardOptions[0]?.id ?? '']}
                    active={isBillboardType(moduleType)}
                    submenu={billboardOpen}
                    title="广告牌：展开选尺寸与比例"
                    onClick={() => toggleSubMenu('billboard')}
                  />
                ),
              },
            ],
            (anchor) => {
              const rows: React.ReactNode[] = []
              if (anchor === '__bench') {
                rows.push(
                  <InlineExpand key="bench-variants" open={benchOpen}>
                    {benchOptions.map((m) => (
                      <Block
                        key={m.id}
                        label={m.label}
                        thumb={thumbs[m.id]}
                        active={tool === 'module' && moduleType === m.id}
                        onClick={() => {
                          setModuleType(m.id)
                          setTool('module')
                        }}
                      />
                    ))}
                  </InlineExpand>,
                )
              }
              if (anchor === '__billboard') {
                rows.push(
                  <InlineExpand key="billboard-variants" open={billboardOpen}>
                    {billboardOptions.map((m) => (
                      <Block
                        key={m.id}
                        label={m.label}
                        thumb={thumbs[m.id]}
                        active={tool === 'module' && moduleType === m.id}
                        onClick={() => {
                          setModuleType(m.id)
                          setTool('module')
                        }}
                      />
                    ))}
                  </InlineExpand>,
                )
              }
              rows.push(
                <InlineExpand key={`decor-actions-${anchor}`} open={decorActionsAnchor === anchor}>
                  {moduleActions}
                </InlineExpand>,
              )
              return rows
            },
          )}
        </div>
      </Folder>

      <Folder title="分区" count={ZONE_LIST.length} open={open.zones} onToggle={() => toggle('zones')}>
        <div className="blockGrid">
          {ZONE_LIST.map((z) => (
            <Block
              key={z.id}
              label={z.label}
              thumb={zoneThumbs[z.id]}
              tone={`#${z.colour.toString(16).padStart(6, '0')}`}
              active={tool === 'zone' && zoneBrush === z.id}
              onClick={() => {
                st().setZoneBrush(z.id)
                setTool('zone')
              }}
            />
          ))}
        </div>
      </Folder>

      <Folder title="材质" count={FINISH_LIST.length + 3} open={open.surfaces} onToggle={() => toggle('surfaces')}>
        <div className="blockGrid three">
          {(
            [
              { id: 'single', label: '单块', icon: 'single', shortcut: 'N', title: '单块 (N)：左键刷一格，右键还原' },
              { id: 'surface', label: '整面', icon: 'surface', shortcut: 'M', title: '整面 (M)：左键刷一整片，右键还原' },
              { id: 'pick', label: '取色', icon: 'pick', shortcut: 'I', title: '取色 (I)：吸取一格表面的材质' },
            ] as const
          ).map((m) => (
            <Block
              key={m.id}
              label={m.label}
              icon={m.icon}
              shortcut={m.shortcut}
              title={m.title}
              active={tool === 'paint' && paintMode === m.id}
              onClick={() => {
                setTool('paint')
                st().setPaintMode(m.id)
              }}
            />
          ))}
        </div>
        {finishFamilies.map(({ fam, items }) => (
          <div className="bpSub" key={fam}>
            <div className="bpSubTitle">{FAMILY_LABEL[fam]}</div>
            <div className="blockGrid">
              {fam !== 'wall'
                ? items.map((f) => (
                    <Block
                      key={f.id}
                      label={finishLabel(f.id)}
                      tone={`#${f.tint.toString(16).padStart(6, '0')}`}
                      active={tool === 'paint' && paintFinish === f.id}
                      onClick={() => {
                        st().selectPaintFinish(f.id)
                      }}
                    />
                  ))
                : interleaveRows(
                    items.map((f) => {
                      // 搪瓷板 is the one finish with a variant sub-menu: its colour.
                      const enamel = f.id === 'wall.enamel'
                      return {
                        anchor: f.id,
                        node: (
                          <Block
                            key={f.id}
                            label={finishLabel(f.id)}
                            tone={enamel ? hexColour(enamelColour) : `#${f.tint.toString(16).padStart(6, '0')}`}
                            active={enamel ? enamelActive : tool === 'paint' && paintFinish === f.id}
                            submenu={enamel ? enamelOpen : undefined}
                            title={enamel ? '搪瓷板：支持自定义颜色，展开选颜色' : undefined}
                            onClick={() => {
                              if (!enamel) {
                                st().selectPaintFinish(f.id)
                                return
                              }
                              // Select the brush, then fold its colour picker out below.
                              selectEnamel()
                              toggleSubMenu('enamel')
                            }}
                          />
                        ),
                      }
                    }),
                    (anchor) =>
                      anchor === 'wall.enamel'
                        ? [
                            <InlineExpand key="enamel-picker" open={enamelOpen}>
                              <ColourTile colour={enamelColour} onChange={changeEnamel} />
                            </InlineExpand>,
                          ]
                        : [],
                  )}
            </div>
          </div>
        ))}
      </Folder>

      <Folder title="视图" count={6} open={open.view} onToggle={() => toggle('view')}>
        <div className="blockGrid">
          <Block
            label="显示其他层"
            icon="ghost"
            shortcut="X"
            title="显示其他层 (X)：关＝任何视角都只画当前层；开＝其他层按 35% 半透明叠加，被当前层挡住的部分不画"
            active={ghost}
            onClick={() => st().setGhostOther(!ghost)}
          />
          <Block
            label="隐藏天花板"
            icon="ceiling"
            shortcut="H"
            title="自动隐藏天花板 (H)：开＝收起楼上那层压在当前层上方的楼板（底下没东西的悬空板保留），俯视时能直接看进当前层"
            active={autoCeiling}
            onClick={() => st().setAutoCeiling(!autoCeiling)}
          />
          <Block label="剖切" icon="cutaway" shortcut="C" title="剖切 (C)：沿活动层切开，看站内结构" active={cutaway} onClick={() => st().setCutaway(!cutaway)} />
          <Block label="隐藏墙壁" icon="wall" active={hideWalls} onClick={() => st().setHideWalls(!hideWalls)} />
          <Block label="热力图" icon="heat" active={overlayOn} onClick={() => st().setOverlay(!overlayOn)} />
          <Block label="分区图" icon="zoneHeat" active={zoneOverlayOn} onClick={() => st().setZoneOverlay(!zoneOverlayOn)} />
        </div>
      </Folder>

    </div>
  )
}
