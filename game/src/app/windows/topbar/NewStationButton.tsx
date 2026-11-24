import { t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store.ts'
import { useStationHost } from '../StationHost.tsx'
import { ReplaceStationDialog } from './ReplaceStationDialog.tsx'

/** The button and Ctrl+N share one confirmation before replacing the current station. */
export function NewStationButton(): React.ReactElement {
  useLanguage()
  const host = useStationHost()
  const newStation = useStore((s) => s.newStation)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const show = (): void => setOpen(true)
    window.addEventListener('metro:new-station', show)
    return () => window.removeEventListener('metro:new-station', show)
  }, [])

  const cancel = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  const confirm = (): void => {
    if (host) host.newStation(); else newStation()
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
      <ReplaceStationDialog
        open={open}
        title={t('new_station')}
        confirmLabel={t('new_station_483')}
        onCancel={cancel}
        onConfirm={confirm}
      />
    </>
  )
}
