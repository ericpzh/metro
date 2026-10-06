// Lane A split (Phase 1): moved verbatim from app/App.tsx — one card per exit
// (plan.md R3). The card is the RHS half of the selection link with the 3D view.
import { useEffect, useRef, useState } from 'react'
import { useStore, moduleLabel } from '../../store.ts'
import type { Module } from '../../../sim/types.ts'

/**
 * One exit's card in 出入口客流: its name (editable — the 3D header reprints on
 * commit), its demand and its open toggle. The card is the RHS half of the
 * selection link: it highlights when this exit is the 3D selection, and clicking
 * or focusing any control selects the exit so the 3D box follows.
 */
export function ExitCard({ mod }: { mod: Extract<Module, { type: 'exit' }> }): React.ReactElement {
  const station = useStore((s) => s.station)
  const commit = useStore((s) => s.commit)
  const selected = useStore((s) => s.selected)
  const select = useStore((s) => s.select)
  const [name, setName] = useState(mod.cfg.name)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => setName(mod.cfg.name), [mod.id, mod.cfg.name])

  const isSelected = selected?.kind === 'module' && selected.key === mod.id
  useEffect(() => {
    if (isSelected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [isSelected])

  const patch = (p: Partial<{ name: string; inRate: number; open: boolean }>): void => {
    const modules = station.modules.map((m) => (m.id === mod.id && m.type === 'exit' ? { ...m, cfg: { ...m.cfg, ...p } } : m))
    commit({ ...station, modules })
  }
  const commitName = (): void => {
    const t = name.trim()
    if (t && t !== mod.cfg.name) patch({ name: t })
    else setName(mod.cfg.name)
  }
  const pick = (): void => select({ kind: 'module', key: mod.id, label: moduleLabel('exit') })

  return (
    <div ref={ref} className={isSelected ? 'card sel' : 'card'} onClick={pick} onFocus={pick}>
      <label className="field">
        <span>名称</span>
        <input
          className="lineNameInput"
          value={name}
          maxLength={12}
          placeholder="出入口名"
          aria-label="出入口名称"
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') {
              setName(mod.cfg.name)
              e.currentTarget.blur()
            }
          }}
        />
      </label>
      <label className="field">
        <span>进站 {mod.cfg.inRate} 人/时</span>
        <input type="range" min={0} max={6000} step={10} value={mod.cfg.inRate} onChange={(e) => patch({ inRate: Number(e.target.value) })} />
      </label>
      <label className="field inline">
        <input type="checkbox" checked={mod.cfg.open} onChange={(e) => patch({ open: e.target.checked })} />
        <span>开放</span>
      </label>
    </div>
  )
}
