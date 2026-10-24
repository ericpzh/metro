import {useId,useSyncExternalStore} from 'react'
import {FaPause,FaPlay} from 'react-icons/fa'
import {Slider} from '../../Slider.tsx'
import {getAudioVolumes,subscribeAudioVolumes,setAudioVolume} from '../../audioSettings.ts'
import {gameMusic} from '../../gameMusic.ts'
import {MUSIC_TRACKS} from '../../musicTracks.ts'
import {t} from '../../../sim/i18n.ts'

export function MusicSetting():React.ReactElement {
 const volumes=useSyncExternalStore(subscribeAudioVolumes,getAudioVolumes)
 const music=useSyncExternalStore(gameMusic.subscribe,gameMusic.getSnapshot)
 const creditId=useId(),track=MUSIC_TRACKS[music.track]!
 return <div className="settingsMusic" role="group" aria-label={t('music')} aria-describedby={creditId}>
  <div className="settingsMusicLabel"><span>{t('music')}</span><output>{Math.round(volumes.music*100)}%</output></div>
  <div className="settingsMusicRow">
   <Slider min={0} max={100} step="1" value={Math.round(volumes.music*100)} aria-label={t('music_volume')} onChange={event=>setAudioVolume('music',Number(event.target.value)/100)}/>
   <button type="button" className="ghost iconBtn" onClick={gameMusic.toggle} aria-label={t(music.paused||music.unavailable?'music_play':'music_pause')} title={t(music.paused||music.unavailable?'music_play':'music_pause')}>{music.paused||music.unavailable?<FaPlay aria-hidden="true"/>:<FaPause aria-hidden="true"/>}</button>
  </div>
  <div className="musicCreditsPanel" id={creditId} role="note">
   <strong>{t('music_credits')}</strong><p>{t('music_now')}: <a href={track.source} target="_blank" rel="noreferrer">{track.title} — {track.author}</a></p>
   <p>{track.credit}<br/><a href={track.licenseUrl} target="_blank" rel="noreferrer">{track.license}</a></p>
  </div>
  {music.unavailable&&<p className="settingsNote" role="status">{t('music_unavailable')}</p>}
 </div>
}
