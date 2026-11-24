import type { RefObject } from 'react'
import { t } from '../../../sim/i18n.ts'

/** The same file controls can be connected to either station runtime. */
export function FileButtons({ onSave, onOpen, openButtonRef, disabled = false }: {
  onSave: () => void
  onOpen: () => void
  openButtonRef?: RefObject<HTMLButtonElement | null>
  disabled?: boolean
}): React.ReactElement {
  return <>
    <button className="ghost iconBtn" onClick={onSave} disabled={disabled}
      title={t('save_to_file_ctrl_s')} aria-label={t('save')} aria-keyshortcuts="Control+S">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 2h8l2 2v10H3z" /><path d="M5 2v3.5h6V2" /><rect x="5" y="9" width="6" height="5" />
      </svg>
    </button>
    <button ref={openButtonRef} className="ghost iconBtn" onClick={onOpen} disabled={disabled}
      title={t('open_save_ctrl_l')} aria-label={t('open_490')} aria-keyshortcuts="Control+L" aria-haspopup="dialog">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M1.5 4.5h4.5L7.2 6H14.5v6.5h-13z" />
      </svg>
    </button>
  </>
}
