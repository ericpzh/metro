import { t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
import { useStore } from '../../store.ts'
import { PlaybackToggle } from './PlaybackToggle.tsx'

export function SimulationControls(): React.ReactElement {
  useLanguage()
  const playing = useStore(s => s.playing)
  const speed = useStore(s => s.speed)
  return <div className="seg" role="group" aria-label={t('playback_controls')}>
    <PlaybackToggle playing={playing} label={t('pause')} onClick={() => useStore.getState().setPlaying(!playing)} />
    {[1, 4, 16, 64].map(s => <button key={s} className={playing && speed === s ? 'on' : ''}
      aria-label={t('value_speed', s)} aria-pressed={playing && speed === s}
      onClick={() => {
        const state = useStore.getState()
        if (state.speed !== s) state.setSpeed(s)
        if (!state.playing) state.setPlaying(true)
      }}>{s}×</button>)}
  </div>
}
