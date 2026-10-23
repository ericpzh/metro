import { t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
import { useStore } from '../../store.ts'

export function SimulationControls(): React.ReactElement {
  useLanguage()
  const playing = useStore(s => s.playing)
  const speed = useStore(s => s.speed)
  return <div className="seg" role="group" aria-label={t('playback_controls')}>
    <button className={!playing ? 'on' : ''} aria-label={t('pause')} aria-pressed={!playing}
      onClick={() => useStore.getState().setPlaying(!playing)}>
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
        {playing ? <><rect x="3.5" y="3" width="3" height="10" rx="0.6" /><rect x="9.5" y="3" width="3" height="10" rx="0.6" /></>
          : <path d="M4.5 2.8v10.4L13.2 8z" />}
      </svg>
    </button>
    {[1, 4, 16, 64].map(s => <button key={s} className={playing && speed === s ? 'on' : ''}
      aria-label={t('value_speed', s)} aria-pressed={playing && speed === s}
      onClick={() => {
        const state = useStore.getState()
        if (state.speed !== s) state.setSpeed(s)
        if (!state.playing) state.setPlaying(true)
      }}>{s}×</button>)}
  </div>
}
