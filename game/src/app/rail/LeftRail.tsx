// The build rail (left column) shell.
//
// A blueprint-styled stack of folders. Each folder body lives in its own file
// under folders/; the variant sub-menus under menus/; the equipment action row
// under actions/; shared chrome under shared/. This shell owns only what the
// folders share: which folders are open, the single nested variant sub-menu slot
// (at most one of 楼梯 / 出入口 / 座椅 / 广告牌 / 搪瓷板 expanded), and the ladder that
// opens and closes them from the keyboard — **Shift+Q** the first folder, then
// W, E, R, T, Y, U, I down the stack (`RAIL_FOLDERS`). The order the folders are
// stacked in *is* the ladder, so both come from that one list.
// `Folder` stays here for now — Lane A will lift the shared chrome into
// app/windows/shared/; until then the barrel at app/LeftRail.tsx keeps both
// import paths working.

import { useEffect, useState } from 'react'
import { FACILITY_OPTIONS, isDecorType, isFacilityBrush, useStore } from '../store.ts'
import type { Tool } from '../store.ts'
import { FINISH_LIST } from '../../sim/finishes.ts'
import { ZONE_LIST } from '../../sim/zones.ts'
import { RAIL_FOLDERS, findSelectedTrack, subMenuForModule } from './helpers.ts'
import type { FolderKey, SubMenuKey } from './helpers.ts'
import { ToolsFolder } from './folders/ToolsFolder.tsx'
import { RailFolder } from './folders/RailFolder.tsx'
import { EquipmentFolder, gearOptions } from './folders/EquipmentFolder.tsx'
import { DecorFolder, decorOptions } from './folders/DecorFolder.tsx'
import { RoomFolder } from './folders/RoomFolder.tsx'
import { ZoneFolder } from './folders/ZoneFolder.tsx'
import { PaintFolder } from './folders/PaintFolder.tsx'
import { ViewFolder } from './folders/ViewFolder.tsx'

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
  const moduleType = useStore((s) => s.moduleType)
  const zoneBrush = useStore((s) => s.zoneBrush)
  const selected = useStore((s) => s.selected)
  const stationModules = useStore((s) => s.station.modules)
  const cutaway = useStore((s) => s.cutaway)

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

  // The Shift+letter ladder is the app's to read and this component's to fold:
  // the one global keydown listener (`app/windows/AppShell.tsx`) does not know
  // which folders are open, so it dispatches `metro:folder` with the FolderKey
  // and the fold happens here — the same split as `metro:preset` / `metro:frame`
  // between the app and the camera.
  useEffect(() => {
    const onFolder = (e: Event): void => {
      const key = (e as CustomEvent).detail as FolderKey
      setOpen((o) => (key in o ? { ...o, [key]: !o[key] } : o))
    }
    window.addEventListener('metro:folder', onFolder)
    return () => window.removeEventListener('metro:folder', onFolder)
  }, [])

  const toggle = (k: FolderKey): void => setOpen((o) => ({ ...o, [k]: !o[k] }))
  // Opening one variant list collapses any other; clicking the open one closes it.
  const toggleSubMenu = (k: SubMenuKey): void => setSubMenu((cur) => (cur === k ? null : k))

  // Selecting a rail makes it the 轨道 folder's subject, so reveal the folder —
  // the same way picking a tool opens the folder that owns it.
  const trackId = findSelectedTrack(selected, stationModules)?.id
  useEffect(() => {
    if (trackId) setOpen((prev) => (prev.rail ? prev : { ...prev, rail: true }))
  }, [trackId])

  // What each folder shows, and the count its header prints. The count is the
  // tiles the folder can put on screen *in the state the rail is in* — 工具 grows
  // by 自动生成墙壁 and 半墙 under the 地基 tool, 视图 by 旋转 while 剖切 is on — so a
  // header never counts tiles the player cannot see there and then. 视图's is 7:
  // 显示其他层 / 剖切 / 隐藏天花板 / 隐藏墙壁 / 热力图 / 分区图 / 隐藏UI.
  const folders: Record<FolderKey, { count: number; body: React.ReactNode }> = {
    tools: { count: tool === 'block' ? 8 : 6, body: <ToolsFolder /> },
    rail: { count: 2, body: <RailFolder /> },
    equipment: {
      count: gearOptions.length + 2,
      body: <EquipmentFolder subMenu={subMenu} onToggleSubMenu={toggleSubMenu} />,
    },
    decor: {
      count: decorOptions.length + 2,
      body: <DecorFolder subMenu={subMenu} onToggleSubMenu={toggleSubMenu} />,
    },
    rooms: { count: FACILITY_OPTIONS.length, body: <RoomFolder /> },
    zones: { count: ZONE_LIST.length, body: <ZoneFolder /> },
    surfaces: {
      count: FINISH_LIST.length + 3,
      body: <PaintFolder subMenu={subMenu} onToggleSubMenu={toggleSubMenu} />,
    },
    view: { count: cutaway ? 8 : 7, body: <ViewFolder /> },
  }

  return (
    <div className="rail">
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
