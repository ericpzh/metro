import { useEffect, useId, useRef } from 'react'
import { t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'

export interface ReplaceStationDialogProps {
  open: boolean
  title: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}

/** Shared modal warning shown before any action that replaces the current station. */
export function ReplaceStationDialog({
  open,
  title,
  confirmLabel,
  onCancel,
  onConfirm,
}: ReplaceStationDialogProps): React.ReactElement | null {
  useLanguage()
  const titleId = useId()
  const messageId = useId()
  const confirmRef = useRef<HTMLButtonElement>(null)
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancelRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  if (!open) return null

  return (
    <div
      className="newStationDialog"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <section
        className="newStationPanel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <h2 id={titleId}>{title}</h2>
        <p id={messageId}>{t('the_current_station_will_be_replaced_save_anything_you_want_to_k')}</p>
        <div className="newStationActions">
          <button type="button" onClick={onCancel}>{t('cancel')}</button>
          <button ref={confirmRef} type="button" className="primary" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  )
}
