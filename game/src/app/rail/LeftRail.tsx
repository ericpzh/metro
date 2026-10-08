// The build rail (left column) shell.
//
// A blueprint-styled stack of folders. Each folder body lives in its own file
// under folders/; the variant sub-menus under menus/; the equipment action row
// under actions/; shared chrome under shared/. This shell owns only what the
// folders share: which folders are open, the single nested variant sub-menu slot
// (at most one of 楼梯 / 出入口 / 座椅 / 广告牌 / 搪瓷板 expanded), and the ladder that
// opens and closes them from the keyboard — **Shift+Q** the first folder, then
// W, E, R, T, Y, U down the stack (`RAIL_FOLDERS`). The order the folders are
// stacked in *is* the ladder, so both come from that one list. The 信息栏 is the other
// column and carries its own table with its own modifier — **Alt+Q … Alt+R** over
// 信息 / 视图 / 出入口 / 线路 (`INSPECTOR_FOLDERS`), which is where 视图 went: it is a set
// of look controls, so it lives beside the read-outs.
// `Folder` stays here for now — Lane A will lift the shared chrome into
// app/windows/shared/; until then the barrel at app/LeftRail.tsx keeps both
// import paths working.

import { useEffect, useRef, useState } from 'react'
import { FACILITY_OPTIONS, folderTiles, isDecorType, isFacilityBrush, useStore } from '../store.ts'
import type { Tool } from '../store.ts'
import { FINISH_LIST } from '../../sim/finishes.ts'
import { RAIL_FOLDERS, REVEAL_SETTLE_MS, armedRailTile, findSelectedTrack, revealScrollDelta, subMenuForModule, toolsFolderTiles, zoneFolderTiles } from './helpers.ts'
import type { FolderKey, RailFolderKey, SubMenuKey } from './helpers.ts'
import { ToolsFolder } from './folders/ToolsFolder.tsx'
import { RailFolder } from './folders/RailFolder.tsx'
import { EquipmentFolder } from './folders/EquipmentFolder.tsx'
import { DecorFolder } from './folders/DecorFolder.tsx'
import { RoomFolder } from './folders/RoomFolder.tsx'
import { ZoneFolder } from './folders/ZoneFolder.tsx'
import { PaintFolder } from './folders/PaintFolder.tsx'

interface FolderProps {
  title: string
  count?: number
  /** The Shift+letter that folds this folder, badged on the header on hover. */
  shortcut?: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}

export function Folder({ title, count, shortcut, open, onToggle, children }: FolderProps): React.ReactElement {
  return (
    <section className={open ? 'folder open' : 'folder'}>
      {/* The key is the ladder's (`RAIL_FOLDERS`), and it is worn the way a tile
          wears its own: a badge on the right of the bar, drawn on hover or focus
          (`styles.css` `.bpKey` / `.folderKey`), so a rail of closed folders stays
          as quiet as it was before there was a ladder. Nothing here is a text
          field, so pointing at the header and pressing the key still folds it
          (`isTypingTarget`). */}
      <button
        type="button"
        className="folderHead"
        onClick={onToggle}
        aria-expanded={open}
        aria-keyshortcuts={shortcut}
      >
        <span className="folderName">{title}</span>
        {typeof count === 'number' ? <span className="folderCount">{count}</span> : null}
        <span className="folderCaret" aria-hidden="true" />
        {shortcut ? (
          <span className="folderKey" aria-hidden="true">
            {shortcut}
          </span>
        ) : null}
      </button>
      <div className="folderBody" aria-hidden={!open} inert={!open}>
        <div className="folderInner">
          <div className="folderPad">{children}</div>
        </div>
      </div>
    </section>
  )
}

const FOLDER_FOR_TOOL: Record<Tool, RailFolderKey> = {
  select: 'tools',
  pick: 'tools',
  block: 'rail',
  wall: 'rail',
  delete: 'tools',
  move: 'tools',
  module: 'equipment',
  paint: 'surfaces',
  zone: 'zones',
  rail: 'rail',
  tunnel: 'rail',
}

/** The rail's own folder keys, so a 信息栏 folder's Alt+letter is not folded here. */
const RAIL_FOLDER_KEYS: ReadonlySet<string> = new Set(RAIL_FOLDERS.map((f) => f.key))

export function LeftRail(): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const moduleType = useStore((s) => s.moduleType)
  const zoneBrush = useStore((s) => s.zoneBrush)
  const selected = useStore((s) => s.selected)
  const stationModules = useStore((s) => s.station.modules)
  /** The rail itself: the scroll container every tile lives in (`styles.css` `.rail`). */
  const railRef = useRef<HTMLDivElement>(null)

  const [open, setOpen] = useState<Record<RailFolderKey, boolean>>({
    tools: true,
    equipment: false,
    rail: true,
    rooms: false,
    decor: false,
    surfaces: false,
    zones: false,
  })
  // The nested variant sub-menus (楼梯 / 出入口 / 座椅 / 广告牌) share one piece
  // of state, so at most one is expanded at a time: opening one collapses the
  // rest, and picking any module the sub-menu does not own collapses them all.
  const [subMenu, setSubMenu] = useState<SubMenuKey | null>(() => subMenuForModule(moduleType))

  // Fold the folder that owns the active tool open, so the menu tracks the mode.
  // A facility brush rides the zone tool but lives in its own 房间 folder, so it
  // opens that folder instead of 分区.
  useEffect(() => {
    const key: RailFolderKey =
      tool === 'zone' && isFacilityBrush(zoneBrush)
        ? 'rooms'
        : tool === 'module' && (moduleType.startsWith('roof') || moduleType.startsWith('pillar'))
          ? 'rail'
          : tool === 'module' && moduleType === 'bridge'
          ? 'rail'
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

  // The Shift+letter ladder is the app's to read and this component's to fold:
  // the one global keydown listener (`app/windows/AppShell.tsx`) does not know
  // which folders are open, so it dispatches `metro:folder` with the FolderKey
  // and the fold happens here — the same split as `metro:preset` / `metro:frame`
  // between the app and the camera. The event carries the 信息栏's own keys too
  // (its Alt ladder), so a key this table does not name is dropped rather than folded.
  useEffect(() => {
    const onFolder = (e: Event): void => {
      const key = (e as CustomEvent).detail as FolderKey
      if (!RAIL_FOLDER_KEYS.has(key)) return
      const railKey = key as RailFolderKey
      setOpen((prev) => ({ ...prev, [railKey]: !prev[railKey] }))
    }
    window.addEventListener('metro:folder', onFolder)
    return () => window.removeEventListener('metro:folder', onFolder)
  }, [])

  const toggle = (k: RailFolderKey): void => setOpen((o) => ({ ...o, [k]: !o[k] }))
  // Opening one variant list collapses any other; clicking the open one closes it.
  const toggleSubMenu = (k: SubMenuKey): void => setSubMenu((cur) => (cur === k ? null : k))

  // Selecting a rail makes it the 结构 folder's subject, so reveal the folder —
  // the same way picking a tool opens the folder that owns it.
  const trackId = findSelectedTrack(selected, stationModules)?.id
  useEffect(() => {
    if (trackId) setOpen((prev) => (prev.rail ? prev : { ...prev, rail: true }))
  }, [trackId])

  /**
   * Bring the tile of whatever is armed into view.
   *
   * A 吸取 hands the rail a piece the player may never have opened the folder for —
   * so the menu has to show them *where* it went, and a tile scrolled out of the
   * rail does not. The tile is the armed thing's own (`armedRailTile`, the rail's one
   * answer for pieces, cut pieces, rails, rooms and finishes); the folder and the
   * variant list that hold it are opened by the two effects above; and this only ever
   * moves the rail's own scroll, because a tile already on screen needs no movement at
   * all (`revealScrollDelta` answers 0).
   *
   * A fold is a ~280 ms height transition, so the first pass lands the tile near
   * where the fold ends and the second, once it has settled, lands on it.
   */
  const armedTile = useStore(armedRailTile)
  const revealTile = armedTile
  useEffect(() => {
    if (!revealTile) return
    const reveal = (): void => {
      const rail = railRef.current
      const el = rail?.querySelector<HTMLElement>(`[data-tile="${revealTile}"]`)
      if (!rail || !el) return
      const delta = revealScrollDelta(rail.getBoundingClientRect(), el.getBoundingClientRect())
      if (delta !== 0) rail.scrollTop += delta
    }
    const timers = [window.setTimeout(reveal, 0), window.setTimeout(reveal, REVEAL_SETTLE_MS)]
    return () => {
      for (const t of timers) window.clearTimeout(t)
    }
  }, [revealTile])

  // Header counts cover the main tiles. The 结构 folder's variant lists and inline
  // controls fold out beneath those tiles and do not change the count.
  const folders: Record<RailFolderKey, { count: number; body: React.ReactNode }> = {
    tools: { count: toolsFolderTiles(), body: <ToolsFolder /> },
    rail: { count: 10, body: <RailFolder subMenu={subMenu} onToggleSubMenu={toggleSubMenu} /> },
    equipment: {
      // The count is the grid's own arithmetic — the plain tiles plus one parent tile
      // per family, read from the very list `TileGrid` renders — so the header can
      // never disagree with what the folder shows.
      count: folderTiles('equipment').length,
      body: <EquipmentFolder subMenu={subMenu} onToggleSubMenu={toggleSubMenu} />,
    },
    decor: {
      count: folderTiles('decor').length,
      body: <DecorFolder subMenu={subMenu} onToggleSubMenu={toggleSubMenu} />,
    },
    surfaces: {
      count: FINISH_LIST.length + 2,
      body: <PaintFolder subMenu={subMenu} onToggleSubMenu={toggleSubMenu} />,
    },
    rooms: { count: FACILITY_OPTIONS.length, body: <RoomFolder /> },
    zones: { count: zoneFolderTiles(), body: <ZoneFolder /> },
  }

  return (
    <div className="rail" ref={railRef}>
      <div className="railStamp">
        <span className="railStampTitle">建造栏</span>
        <span className="railStampSub">METRO / BUILD</span>
      </div>

      {/* Stacked in ladder order, so the Shift+letter that folds a folder and the
          row it sits in are the same list read two ways (`RAIL_FOLDERS`). */}
      {RAIL_FOLDERS.map(({ key, title, shift }) => (
        <Folder
          key={key}
          title={title}
          count={folders[key].count}
          shortcut={`Shift+${shift}`}
          open={open[key]}
          onToggle={() => toggle(key)}
        >
          {folders[key].body}
        </Folder>
      ))}

    </div>
  )
}
