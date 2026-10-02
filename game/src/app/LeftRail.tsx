// The build rail (left column).
//
// A blueprint-styled stack of folders. Each folder is a "menu" that folds open
// with an animated height transition and lays its entries out as square blocks
// in two columns. Equipment blocks are the real in-game 3D models, rendered to
// thumbnails by `moduleThumbnails.ts`; everything else uses a blueprint line
// icon or a colour field. Keyboard shortcuts still work, they are just not
// printed on the blocks.

import { useEffect, useMemo, useState } from 'react'
import {
  FACILITY_OPTIONS,
  MODULE_OPTIONS,
  isEscalatorType,
  isRotatableType,
  isStairType,
  useStore,
  type Tool,
} from './store.ts'
import { getModuleThumbnails } from './moduleThumbnails.ts'
import { getZoneThumbnails } from './zoneThumbnails.ts'
import { FINISH_LIST, finishLabel } from '../sim/finishes.ts'
import { ZONE_LIST } from '../sim/zones.ts'

/* ------------------------------------------------------------------- icons */

function Icon({ name }: { name: string }): React.ReactElement {
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
}

function Block({ label, active, title, onClick, thumb, icon, tone, submenu }: BlockProps): React.ReactElement {
  return (
    <button
      type="button"
      className={active ? 'bpBlock on' : 'bpBlock'}
      title={title ?? label}
      onClick={onClick}
      aria-pressed={active}
      aria-expanded={submenu}
    >
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

/* ---------------------------------------------------------------- folder */

interface FolderProps {
  title: string
  count?: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}

function Folder({ title, count, open, onToggle, children }: FolderProps): React.ReactElement {
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

/* ------------------------------------------------------------------- rail */

type FolderKey = 'tools' | 'equipment' | 'surfaces' | 'zones' | 'view'

const FOLDER_FOR_TOOL: Record<Tool, FolderKey> = {
  select: 'tools',
  block: 'tools',
  module: 'equipment',
  paint: 'surfaces',
  zone: 'zones',
}

export function LeftRail(): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const moduleType = useStore((s) => s.moduleType)
  const setModuleType = useStore((s) => s.setModuleType)
  const moduleRot = useStore((s) => s.moduleRot)
  const escalatorDir = useStore((s) => s.escalatorDir)
  const stairWidth = useStore((s) => s.stairWidth)
  const paintMode = useStore((s) => s.paintMode)
  const paintFinish = useStore((s) => s.paintFinish)
  const zoneBrush = useStore((s) => s.zoneBrush)
  const ortho = useStore((s) => s.ortho)
  const ghost = useStore((s) => s.ghostOtherLevels)
  const cutaway = useStore((s) => s.cutaway)
  const overlayOn = useStore((s) => s.overlayOn)
  const zoneOverlayOn = useStore((s) => s.zoneOverlayOn)

  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [zoneThumbs, setZoneThumbs] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<Record<FolderKey, boolean>>({
    tools: true,
    equipment: true,
    surfaces: false,
    zones: false,
    view: false,
  })
  // 楼梯 is a sub-menu: one tile that folds out the four stair shapes.
  const [stairOpen, setStairOpen] = useState(() => isStairType(moduleType))

  const stairOptions = useMemo(() => MODULE_OPTIONS.filter((m) => isStairType(m.type)), [])
  const gearOptions = useMemo(() => MODULE_OPTIONS.filter((m) => !isStairType(m.type)), [])

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
  useEffect(() => {
    setOpen((prev) => (prev[FOLDER_FOR_TOOL[tool]] ? prev : { ...prev, [FOLDER_FOR_TOOL[tool]]: true }))
  }, [tool])

  // Keep the stair sub-menu open while a stair shape is the active piece.
  useEffect(() => {
    if (isStairType(moduleType)) setStairOpen(true)
  }, [moduleType])

  const toggle = (k: FolderKey): void => setOpen((o) => ({ ...o, [k]: !o[k] }))
  const st = useStore.getState

  const finishFamilies = useMemo(() => {
    const order = ['floor', 'ceiling', 'wall'] as const
    return order.map((fam) => ({
      fam,
      items: FINISH_LIST.filter((f) => (fam === 'floor' ? f.family === 'floor' || f.family === 'track' : f.family === fam)),
    }))
  }, [])

  // Contextual actions for the equipment being placed, each gated by what the
  // piece actually supports: 旋转 only for turnable equipment, 宽度 for stairs,
  // 上行/下行 for the escalator. A future fixed-angle module simply loses its
  // rotation tile — no other change needed.
  const moduleActions: React.ReactNode[] = []
  if (isRotatableType(moduleType)) {
    moduleActions.push(
      <Block key="rotate" label={`旋转 ${((4 - moduleRot) % 4) * 90}°`} icon="redo" onClick={() => st().rotateModule()} />,
    )
  }
  if (isStairType(moduleType)) {
    moduleActions.push(
      <Block key="width" label={`宽度 ${stairWidth.toFixed(1)}m`} icon="ortho" onClick={() => st().cycleStairWidth()} />,
    )
  }
  if (isEscalatorType(moduleType)) {
    moduleActions.push(
      <Block
        key="dir"
        label={escalatorDir === 'up' ? '上行' : '下行'}
        icon={escalatorDir === 'up' ? 'up' : 'down'}
        onClick={() => st().cycleEscalatorDir()}
      />,
    )
  }

  return (
    <div className="rail">
      <div className="railStamp">
        <span className="railStampTitle">建造栏</span>
        <span className="railStampSub">METRO / BUILD</span>
      </div>

      <Folder title="工具" count={4} open={open.tools} onToggle={() => toggle('tools')}>
        <div className="blockGrid">
          {(
            [
              { id: 'select', label: '选择', icon: 'select' },
              { id: 'block', label: '建造', icon: 'block' },
            ] as Array<{ id: Tool; label: string; icon: string }>
          ).map((t) => (
            <Block key={t.id} label={t.label} icon={t.icon} active={tool === t.id} onClick={() => setTool(t.id)} />
          ))}
          <Block label="撤销" icon="undo" onClick={() => st().undo()} />
          <Block label="重做" icon="redo" onClick={() => st().redo()} />
        </div>
      </Folder>

      <Folder title="设备" count={MODULE_OPTIONS.length} open={open.equipment} onToggle={() => toggle('equipment')}>
        <div className="blockGrid">
          {gearOptions.map((m) => (
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
          <Block
            label="楼梯"
            thumb={thumbs[stairOptions[0]?.id ?? '']}
            active={isStairType(moduleType)}
            submenu={stairOpen}
            title="楼梯：展开选形状"
            onClick={() => setStairOpen((v) => !v)}
          />
        </div>
        {/* Nested sub-menu: the stair shapes, indented under their parent tile. */}
        <div className={stairOpen ? 'subMenu open' : 'subMenu'} aria-hidden={!stairOpen} inert={!stairOpen}>
          <div className="subMenuInner">
            <div className="subMenuPad">
              <div className="blockGrid">
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
              </div>
            </div>
          </div>
        </div>
        {tool === 'module' && moduleActions.length > 0 && <div className="blockGrid two">{moduleActions}</div>}
      </Folder>

      <Folder title="分区" count={ZONE_LIST.length + FACILITY_OPTIONS.length} open={open.zones} onToggle={() => toggle('zones')}>
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
        <div className="bpSub">
          <div className="bpSubTitle">房间（拖框画）</div>
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
        </div>
      </Folder>

      <Folder title="材质" count={FINISH_LIST.length + 3} open={open.surfaces} onToggle={() => toggle('surfaces')}>
        <div className="blockGrid three">
          {(
            [
              { id: 'single', label: '单块', icon: 'single' },
              { id: 'surface', label: '整面', icon: 'surface' },
              { id: 'pick', label: '取色', icon: 'pick' },
            ] as const
          ).map((m) => (
            <Block
              key={m.id}
              label={m.label}
              icon={m.icon}
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
              {items.map((f) => (
                <Block
                  key={f.id}
                  label={finishLabel(f.id)}
                  tone={`#${f.tint.toString(16).padStart(6, '0')}`}
                  active={tool === 'paint' && paintFinish === f.id}
                  onClick={() => {
                    st().setPaintFinish(f.id)
                    st().setPaintMode('single')
                    setTool('paint')
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </Folder>

      <Folder title="视图" count={5} open={open.view} onToggle={() => toggle('view')}>
        <div className="blockGrid">
          <Block label="正交 / 透视" icon="ortho" active={ortho} onClick={() => st().setOrtho(!ortho)} />
          <Block label="显示其他层" icon="ghost" active={ghost} onClick={() => st().setGhostOther(!ghost)} />
          <Block label="剖切" icon="cutaway" active={cutaway} onClick={() => st().setCutaway(!cutaway)} />
          <Block label="热力图" icon="heat" active={overlayOn} onClick={() => st().setOverlay(!overlayOn)} />
          <Block label="分区图" icon="zoneHeat" active={zoneOverlayOn} onClick={() => st().setZoneOverlay(!zoneOverlayOn)} />
        </div>
      </Folder>

    </div>
  )
}
