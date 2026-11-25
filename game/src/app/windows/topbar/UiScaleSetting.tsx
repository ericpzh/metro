import { useEffect, useRef, useSyncExternalStore } from 'react'
import { Slider } from '../../Slider.tsx'
import {
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP,
  beginUiScaleDrag,
  endUiScaleDrag,
  getUiScale,
  getUiScaleState,
  resetUiScale,
  setUiScale,
  subscribeUiScale,
} from '../../uiScale.ts'
import { t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'

const MIN_PCT = Math.round(UI_SCALE_MIN * 100)
const MAX_PCT = Math.round(UI_SCALE_MAX * 100)
const STEP_PCT = Math.round(UI_SCALE_STEP * 100)

/**
 * Continuous UI scale slider (75%–150%). Updates the live workspace scale on
 * every drag frame while holding the settings dropdown at its drag-start scale
 * so the track never shifts underneath the cursor; releases and persists on up.
 */
export function UiScaleSetting(): React.ReactElement {
  useLanguage()
  const { scale, defaultScale, custom } = useSyncExternalStore(subscribeUiScale, getUiScaleState)
  const dragging = useRef(false)

  useEffect(() => () => {
    if (dragging.current) {
      dragging.current = false
      endUiScaleDrag()
    }
  }, [])

  const pct = Math.round(scale * 100)
  const defaultPct = Math.round(defaultScale * 100)

  return (
    <div className="settingsScale" role="group" aria-label={t('ui_scale')}>
      <div className="settingsScaleLabel">
        <span>{t('ui_scale')}</span>
        <span className="settingsScaleReadout">
          {!custom && <span className="settingsScaleBadge">{t('ui_scale_auto')}</span>}
          <output>{pct}%</output>
        </span>
      </div>
      <div className="settingsScaleRow">
        <span className="settingsScaleBound" aria-hidden="true">{MIN_PCT}%</span>
        <Slider
          min={MIN_PCT}
          max={MAX_PCT}
          step={STEP_PCT}
          value={pct}
          aria-label={t('ui_scale')}
          data-setting="ui-scale"
          onDragStart={() => {
            dragging.current = true
            beginUiScaleDrag()
          }}
          onChange={(event) => {
            setUiScale(Number(event.target.value) / 100, { persist: !dragging.current })
          }}
          onDragEnd={() => {
            dragging.current = false
            endUiScaleDrag()
            setUiScale(getUiScale(), { persist: true })
          }}
        />
        <span className="settingsScaleBound" aria-hidden="true">{MAX_PCT}%</span>
        <button
          type="button"
          className="ghost iconBtn"
          disabled={!custom}
          data-setting="ui-scale-reset"
          aria-label={t('ui_scale_reset', defaultPct)}
          title={t('ui_scale_reset', defaultPct)}
          onClick={() => resetUiScale()}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
            <path d="M13.5 1.8v3h-3" />
          </svg>
        </button>
      </div>
    </div>
  )
}
