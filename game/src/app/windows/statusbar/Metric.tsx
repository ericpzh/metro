import { translate } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
// Lane A split (Phase 1): moved verbatim from app/App.tsx — the status-bar dot
// shared by BottomBar's metrics (plan.md R5 composition chrome).
export function Metric({ label, value, warn, tone }: { label: string; value: string | number; warn?: boolean; tone?: string }): React.ReactElement {
  useLanguage()
  const cls = warn ? 'metric warn' : tone === 'F' || tone === 'E' ? 'metric danger' : 'metric'
  return (
    <div className={cls}>
      <span className="metricLabel">{translate(label)}</span>
      <b>{translate(value)}</b>
    </div>
  )
}
