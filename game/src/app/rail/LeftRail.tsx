// The build rail (left column) shell.
//
// A blueprint-styled stack of folders. Each folder body lives in its own file
// under folders/; the variant sub-menus under menus/; the equipment action row
// under actions/; shared chrome under shared/. This shell owns only what the
// folders share: which folders are open, and the single nested variant
// sub-menu slot (at most one of 楼梯 / 出入口 / 座椅 / 广告牌 / 搪瓷板 expanded).
// `Folder` stays here for now — Lane A will lift the shared chrome into
// app/windows/shared/; until then the barrel at app/LeftRail.tsx keeps both
// import paths working.

import { useEffect, useState } from 'react'
import { FACILITY_OPTIONS, isDecorType, isFacilityBrush, useStore } from '../store.ts'
import type { Tool } from '../store.ts'
import { FINISH_LIST } from '../../sim/finishes.ts'
import { ZONE_LIST } from '../../sim/zones.ts'
import { findSelectedTrack, subMenuForModule } from './helpers.ts'
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

  const toggle = (k: FolderKey): void => setOpen((o) => ({ ...o, [k]: !o[k] }))
  // Opening one variant list collapses any other; clicking the open one closes it.
  const toggleSubMenu = (k: SubMenuKey): void => setSubMenu((cur) => (cur === k ? null : k))

  // Selecting a rail makes it the 轨道 folder's subject, so reveal the folder —
  // the same way picking a tool opens the folder that owns it.
  const trackId = findSelectedTrack(selected, stationModules)?.id
  useEffect(() => {
    if (trackId) setOpen((prev) => (prev.rail ? prev : { ...prev, rail: true }))
  }, [trackId])

  return (
    <div className="rail">
      <div className="railStamp">
        <span className="railStampTitle">建造栏</span>
        <span className="railStampSub">METRO / BUILD</span>
      </div>

      <Folder title="工具" count={tool === 'block' ? 8 : 6} open={open.tools} onToggle={() => toggle('tools')}>
        <ToolsFolder />
      </Folder>
      <Folder title="轨道" count={2} open={open.rail} onToggle={() => toggle('rail')}>
        <RailFolder />
      </Folder>

      <Folder title="设备" count={gearOptions.length + 2} open={open.equipment} onToggle={() => toggle('equipment')}>
        <EquipmentFolder subMenu={subMenu} onToggleSubMenu={toggleSubMenu} />
      </Folder>

      <Folder title="装饰" count={decorOptions.length + 2} open={open.decor} onToggle={() => toggle('decor')}>
        <DecorFolder subMenu={subMenu} onToggleSubMenu={toggleSubMenu} />
      </Folder>

      <Folder title="房间" count={FACILITY_OPTIONS.length} open={open.rooms} onToggle={() => toggle('rooms')}>
        <RoomFolder />
      </Folder>

      <Folder title="分区" count={ZONE_LIST.length} open={open.zones} onToggle={() => toggle('zones')}>
        <ZoneFolder />
      </Folder>

      <Folder title="材质" count={FINISH_LIST.length + 3} open={open.surfaces} onToggle={() => toggle('surfaces')}>
        <PaintFolder subMenu={subMenu} onToggleSubMenu={toggleSubMenu} />
      </Folder>

      <Folder title="视图" count={6} open={open.view} onToggle={() => toggle('view')}>
        <ViewFolder />
      </Folder>

    </div>
  )
}
