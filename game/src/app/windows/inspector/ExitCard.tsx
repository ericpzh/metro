import { Slider } from '../../Slider.tsx'
import { translate, t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
// Lane A split (Phase 1): moved verbatim from app/App.tsx — one card per exit
// (plan.md R3). The card is the RHS half of the selection link with the 3D view.
import { useEffect, useRef, useState } from 'react'
import { useStore, moduleLabel } from '../../store.ts'
import { stationHostCommit } from '../../stationHostBridge.ts'
import type { Module } from '../../../sim/types.ts'

/**
 * One exit's card in 出入口客流: its name (editable — the 3D header reprints on
 * commit), its demand and its open toggle. The card is the RHS half of the
 * selection link: it highlights when this exit is the 3D selection, and clicking
 * or focusing any control selects the exit so the 3D box follows.
 */
export function ExitCard({ mod }: { mod: Extract<Module, { type: 'exit' }> }): React.ReactElement {
  useLanguage()
  const commit = useStore((s) => s.commit)
  const selected = useStore((s) => s.selected)
  const select = useStore((s) => s.select)
  const [name, setName] = useState(mod.cfg.name)
  const [rate, setRate] = useState(mod.cfg.inRate)
  const dragging = useRef(false)
  const pendingRate = useRef<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => setName(mod.cfg.name), [mod.id, mod.cfg.name])
  useEffect(() => {
    if (dragging.current) return
    if (pendingRate.current !== null) {
      if (mod.cfg.inRate === pendingRate.current) pendingRate.current = null
      else return
    }
    setRate(mod.cfg.inRate)
  }, [mod.id, mod.cfg.inRate])
  useEffect(() => {
    pendingRate.current = null
    setRate(mod.cfg.inRate)
  }, [mod.id])

  const isSelected = selected?.kind === 'module' && selected.key === mod.id
  useEffect(() => {
    if (isSelected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [isSelected])

  const patch = (p: Partial<{ name: string; inRate: number; open: boolean }>): void => {
    if (p.inRate !== undefined) {
      pendingRate.current = p.inRate
      setRate(p.inRate)
    }
    const host = stationHostCommit()
    if (host?.ownsStation() && host.commitExit?.(mod.id, p)) return
    pendingRate.current = null
    const station = useStore.getState().station
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
    <div ref={ref} className="card exitTile">
      <div className="exitTileHeader">
        <label className="field exitNameField">
          <input
            className="lineNameInput"
            value={name}
            maxLength={12}
            placeholder={t('exit_name')}
            aria-label={t('exit_name_377')}
            onFocus={pick}
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
        <button
          type="button"
          className={mod.cfg.open ? 'exitSwitch on' : 'exitSwitch'}
          role="switch"
          aria-checked={mod.cfg.open}
          aria-label={t('open')}
          title={mod.cfg.open ? t('open') : t('closed')}
          onFocus={pick}
          onClick={() => patch({ open: !mod.cfg.open })}
        >
          <span className="exitSwitchThumb" />
        </button>
      </div>
      <span className="exitRateReadout" title={`${t('entering')} ${translate(rate)} ${t('people_h')}`}>
        {t('exit_rate_compact', translate(rate))}
      </span>
      <Slider
        className="exitRateSlider"
        min={0}
        max={6000}
        step={10}
        value={rate}
        aria-label={`${t('entering')} ${translate(rate)} ${t('people_h')}`}
        onFocus={pick}
        onPointerDown={() => {
          dragging.current = true
        }}
        onDragStart={pick}
        onDragEnd={() => {
          dragging.current = false
          if (pendingRate.current !== null && mod.cfg.inRate === pendingRate.current) {
            pendingRate.current = null
          }
        }}
        onChange={(e) => patch({ inRate: Number(e.target.value) })}
      />
    </div>
  )
}
