import { t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store.ts'

/** The button and Ctrl+N share one confirmation before replacing the current station. */
export function NewStationButton(): React.ReactElement {
  useLanguage()
  const newStation = useStore((s) => s.newStation)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const show = (): void => setOpen(true)
    window.addEventListener('metro:new-station', show)
    return () => window.removeEventListener('metro:new-station', show)
  }, [])

  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const cancel = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  const confirm = (): void => {
    newStation()
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <>
      <button
        ref={triggerRef}
        className="ghost iconBtn"
        onClick={() => setOpen(true)}
        title={t('new_station_ctrl_n')}
        aria-label={t('new_479')}
        aria-keyshortcuts="Control+N"
        aria-haspopup="dialog"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 1.5h5l3 3V14.5H4z" />
          <path d="M9 1.5v3h3" />
          <path d="M8 8.5v4M6 10.5h4" />
        </svg>
      </button>
      {open && (
        <div className="newStationDialog" role="presentation" onMouseDown={(e) => {
          if (e.target === e.currentTarget) cancel()
        }}>
          <section className="newStationPanel" role="dialog" aria-modal="true" aria-labelledby="newStationTitle" aria-describedby="newStationMessage">
            <h2 id="newStationTitle">{t('new_station')}</h2>
            <p id="newStationMessage">{t('the_current_station_will_be_replaced_save_anything_you_want_to_k')}</p>
            <div className="newStationActions">
              <button type="button" onClick={cancel}>{t('cancel')}</button>
              <button ref={confirmRef} type="button" className="primary" onClick={confirm}>{t('new_station_483')}</button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
