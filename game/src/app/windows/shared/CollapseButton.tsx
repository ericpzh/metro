import { t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'

export function CollapseButton({ open, onToggle, controls, label, direction }: {
  open: boolean
  onToggle: () => void
  controls: string
  label: string
  direction: 'left' | 'right' | 'up'
}): React.ReactElement {
  useLanguage()
  return (
    <button type="button" className={`collapseButton ${direction}${open ? ' open' : ''}`}
      aria-expanded={open} aria-controls={controls}
      aria-label={t(open ? 'hide_panel' : 'show_panel', label)} onClick={onToggle}>
      <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="m12 4-6 6 6 6" />
      </svg>
    </button>
  )
}
