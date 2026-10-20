import { useEffect, useRef } from 'react'
import { t } from '../../../sim/i18n.ts'
import type { MessageKey } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
import { liftDoorSide, liftLevels } from '../../../sim/lifts.ts'
import type { LiftModule } from '../../../sim/lifts.ts'
import type { LiftDoorSide } from '../../../sim/types.ts'
import { useStore } from '../../store.ts'

// The elevator's door picker (§5.1): one row per storey the shaft spans, each
// choosing whether that floor's cabin doors open on the front (local −y, the
// default), the back (local +y), both — the through-floor — or none, a sealed
// storey the car passes without stopping. A modal because the choice is per
// floor and a shaft may serve many; the row list is the only place it reads as
// one elevator rather than one setting.

const SIDES: ReadonlyArray<{ side: LiftDoorSide; label: MessageKey }> = [
  { side: 'front', label: 'lift_door_front' },
  { side: 'back', label: 'lift_door_back' },
  { side: 'both', label: 'lift_door_both' },
  { side: 'none', label: 'lift_door_none' },
]

/**
 * The door editor for one placed lift. Opens over the 信息 column, so the shaft
 * stays visible behind it; every choice commits at once (`setLiftDoorSide`), so
 * the model, the crowd's landings and undo all follow immediately. Escape, a
 * click outside and 完成 all close it.
 */
export function LiftDoorModal({ mod, onClose }: { mod: LiftModule; onClose: () => void }): React.ReactElement {
  useLanguage()
  const panelRef = useRef<HTMLElement>(null)
  const levels = liftLevels(mod)

  useEffect(() => {
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="liftDoorDialog"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <section
        ref={panelRef}
        tabIndex={-1}
        className="liftDoorPanel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="liftDoorTitle"
      >
        <h2 id="liftDoorTitle">{t('lift_doors')}</h2>
        <p className="muted small">{t('lift_doors_hint')}</p>
        <div className="liftDoorRows">
          {levels.map((z) => {
            const current = liftDoorSide(mod.cfg, z)
            const label = `${z} m`
            return (
              <div className="liftDoorRow" key={z}>
                <span className="liftDoorLevel">{label}</span>
                <div className="seg" role="group" aria-label={label}>
                  {SIDES.map(({ side, label: key }) => (
                    <button
                      key={side}
                      type="button"
                      className={current === side ? 'on' : undefined}
                      aria-pressed={current === side}
                      onClick={() => useStore.getState().setLiftDoorSide(mod.id, z, side)}
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        <div className="liftDoorActions">
          <button type="button" className="primary" onClick={onClose}>{t('done')}</button>
        </div>
      </section>
    </div>
  )
}
