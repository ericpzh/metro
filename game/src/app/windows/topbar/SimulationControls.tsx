import { t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
import { useStore } from '../../store.ts'
import { useSimulationAvailability } from '../../../unity-web/playbackControls.ts'
import { PlaybackToggle } from './PlaybackToggle.tsx'

export function SimulationControls(): React.ReactElement {
  useLanguage()
  const playing = useStore(s => s.playing)
  const speed = useStore(s => s.speed)
  // Enabled by default; the Unity shell binds a port whose answers disable what C#
  // cannot honour, so a click never becomes a command the host drops.
  const available = useSimulationAvailability()
  return <div className="seg" role="group" aria-label={t('playback_controls')}>
    <PlaybackToggle playing={playing} label={t('pause')} disabled={!available.play} onClick={() => useStore.getState().setPlaying(!playing)} />
    {[1, 4, 16, 64].map(s => <button key={s} className={playing && speed === s ? 'on' : ''}
      aria-label={t('value_speed', s)} aria-pressed={playing && speed === s} disabled={!available.speed}
      onClick={() => {
        const state = useStore.getState()
        if (state.speed !== s) state.setSpeed(s)
        if (!state.playing) state.setPlaying(true)
      }}>{s}×</button>)}
  </div>
}
