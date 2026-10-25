import {MusicSetting} from './MusicSetting.tsx'
import { Slider } from '../../Slider.tsx'
import { useEffect, useId, useRef, useSyncExternalStore } from 'react'
import {getAudioVolumes, subscribeAudioVolumes, setAudioVolume} from '../../audioSettings.ts'
import { FaGear } from 'react-icons/fa6'
import { FaBug } from 'react-icons/fa'
import { IoLanguageSharp } from 'react-icons/io5'
import { PiHighDefinition, PiGraphicsCard } from 'react-icons/pi'
import { CgScrollV } from 'react-icons/cg'
import { TbWorldUpload } from 'react-icons/tb'
import { SiSpeedtest } from 'react-icons/si'
import { getLanguage, setLanguage, useLanguage } from '../../i18n.ts'
import { t } from '../../../sim/i18n.ts'
import { useStore } from '../../store.ts'
import { reportIssueHrefFor } from '../../reportIssueRoute.ts'

const upscalingModes = ['native', 'ultra', 'quality', 'balanced', 'performance'] as const

export function SettingsMenu(): React.ReactElement {
  const volumes = useSyncExternalStore(subscribeAudioVolumes, getAudioVolumes)
  const language = useLanguage()
  const quality = useStore(s => s.graphicsQuality)
  const setQuality = useStore(s => s.setGraphicsQuality)
  const upscalingMode = useStore(s => s.upscalingMode)
  const setUpscalingMode = useStore(s => s.setUpscalingMode)
  const edgeScrolling = useStore(s => s.edgeScrolling)
  const setEdgeScrolling = useStore(s => s.setEdgeScrolling)
  const shareStats = useStore(s => s.shareStats)
  const setShareStats = useStore(s => s.setShareStats)
  const restartSim = useStore(s => s.restartSim)
  const root = useRef<HTMLDetailsElement>(null)
  const statsNoteId = useId()
  useEffect(() => {
    const outside = (event: PointerEvent): void => {
      if (root.current && !root.current.contains(event.target as Node)) root.current.open = false
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !root.current?.open) return
      event.preventDefault(); event.stopPropagation()
      root.current.open = false; root.current.querySelector('summary')?.focus()
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape, true)
    }
  }, [])
  return <details className="settingsMenu" ref={root} onKeyDown={event => {
    if (root.current?.open || event.key === ' ' || event.key === 'Enter') event.stopPropagation()
  }}>
    <summary className="ghost iconBtn" aria-label={t('settings')} title={t('settings')}><FaGear aria-hidden="true" /></summary>
    <div className="settingsDropdown" role="group" aria-label={t('settings')}>
      <div className="settingsHeading"><FaGear aria-hidden="true" /><span>{t('settings')}</span></div>
      <div className="settingsAudioGrid">
      <label className="settingsAudio"><span>{t('master_volume')}<output>{Math.round(volumes.master*100)}%</output></span><Slider min={0} max={100} step="1" value={Math.round(volumes.master*100)} aria-label={t('master_volume')} onChange={event=>setAudioVolume('master',Number(event.target.value)/100)}/></label>
      <label className="settingsAudio"><span>{t('sound_effects')}<output>{Math.round(volumes.effects*100)}%</output></span><Slider min={0} max={100} step="1" value={Math.round(volumes.effects*100)} aria-label={t('sound_effects')} onChange={event=>setAudioVolume('effects',Number(event.target.value)/100)}/></label>
      <label className="settingsAudio"><span>{t('ambient_sound')}<output>{Math.round(volumes.ambient*100)}%</output></span><Slider min={0} max={100} step="1" value={Math.round(volumes.ambient*100)} aria-label={t('ambient_sound')} onChange={event=>setAudioVolume('ambient',Number(event.target.value)/100)}/></label>
      <MusicSetting/>
      </div>
      <div className="settingsToggleGrid">
        <button type="button" className={`settingsToggle ${quality === 'high' ? 'on' : ''}`} onClick={() => setQuality(quality === 'high' ? 'low' : 'high')} aria-label={`${t('graphics_quality')}: ${t(quality === 'high' ? 'graphics_high' : 'graphics_low')}`}><PiHighDefinition aria-hidden="true"/><span>{t('graphics_quality')}</span><strong>{t(quality === 'high' ? 'graphics_high_short' : 'graphics_low_short')}</strong></button>
        <button type="button" className={`settingsToggle ${upscalingMode !== 'native' ? 'on' : ''}`} onClick={() => setUpscalingMode(upscalingModes[(upscalingModes.indexOf(upscalingMode)+1)%upscalingModes.length])} aria-label={`${t('upscaling')}: ${upscalingMode === 'native' ? t('share_stats_off') : t(`upscaling_${upscalingMode}`)}`} title={t('upscaling')}>
          <PiGraphicsCard aria-hidden="true"/><span>{t('upscaling')}</span><strong>{upscalingMode === 'native' ? t('share_stats_off') : t(`upscaling_${upscalingMode}`)}</strong>
        </button>
        <button type="button" className={`settingsToggle ${edgeScrolling ? 'on' : ''}`} aria-pressed={edgeScrolling} onClick={() => setEdgeScrolling(!edgeScrolling)}><CgScrollV aria-hidden="true"/><span>{t('edge_scrolling')}</span><strong>{t(edgeScrolling ? 'share_stats_on' : 'share_stats_off')}</strong></button>
        <div className="settingsStatsTile">
          <button type="button" className={`settingsToggle ${shareStats ? 'on' : ''}`} aria-pressed={shareStats} aria-describedby={statsNoteId} onClick={() => setShareStats(!shareStats)}><TbWorldUpload aria-hidden="true"/><span>{t('share_stats')}</span><strong>{t(shareStats ? 'share_stats_on' : 'share_stats_off')}</strong></button>
          <span className="settingsStatsTooltip" id={statsNoteId} role="tooltip">{t('share_stats_note')}</span>
        </div>
      </div>
      <div className="settingsActionGrid">
      <button type="button" className="ghost settingsAction" onClick={() => { restartSim(); if (root.current) root.current.open = false }} title={t('restart_simulation_ctrl_r')} aria-label={t('restart')} aria-keyshortcuts="Control+R">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" /><path d="M13.5 1.8v3h-3" /></svg>
        <span>{t('restart')}</span>
      </button>
      <a className="ghost settingsAction" href={reportIssueHrefFor(language, Boolean(import.meta.env?.DEV))} target="_blank" rel="noopener noreferrer" title={t('report_issue')} aria-label={t('report_issue')}>
        <FaBug aria-hidden="true" /><span>{t('report_issue')}</span>
      </a>
      <button type="button" className="ghost settingsAction" onClick={() => setLanguage(getLanguage() === 'en' ? 'zh-CN' : 'en')} title={t('switch_language')} aria-label={t('switch_language')}>
        <IoLanguageSharp aria-hidden="true" /><span>{language === 'en' ? t('language_native_chinese') : t('language_native_english')}</span>
      </button>
      <a className="ghost settingsAction" href={`${location.pathname.startsWith('/game') ? '/game' : ''}/benchmark${language === 'en' ? '/en' : ''}`} target="_blank" rel="noopener noreferrer" title={t('benchmark')} aria-label={t('benchmark')}>
        <SiSpeedtest aria-hidden="true" /><span>{t('benchmark')}</span>
      </a>
      </div>
    </div>
  </details>
}
