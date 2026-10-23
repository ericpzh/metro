import { useEffect, useRef } from 'react'
import { FaGear } from 'react-icons/fa6'
import { FaBug } from 'react-icons/fa'
import { IoLanguageSharp } from 'react-icons/io5'
import { getLanguage, setLanguage, useLanguage } from '../../i18n.ts'
import { t } from '../../../sim/i18n.ts'
import { useStore } from '../../store.ts'

export function SettingsMenu(): React.ReactElement {
  const language = useLanguage()
  const quality = useStore(s => s.graphicsQuality)
  const setQuality = useStore(s => s.setGraphicsQuality)
  const edgeScrolling = useStore(s => s.edgeScrolling)
  const setEdgeScrolling = useStore(s => s.setEdgeScrolling)
  const shareStats = useStore(s => s.shareStats)
  const setShareStats = useStore(s => s.setShareStats)
  const restartSim = useStore(s => s.restartSim)
  const root = useRef<HTMLDetailsElement>(null)
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
      <div className="settingsQualityLabel">{t('graphics_quality')}</div>
      <div className="settingsQuality" role="group" aria-label={t('graphics_quality')}>
        <button type="button" aria-pressed={quality === 'low'} className={quality === 'low' ? 'on' : ''} onClick={() => setQuality('low')}>{t('graphics_low')}</button>
        <button type="button" aria-pressed={quality === 'high'} className={quality === 'high' ? 'on' : ''} onClick={() => setQuality('high')}>{t('graphics_high')}</button>
      </div>
      <div className="settingsQualityLabel">{t('edge_scrolling')}</div>
      <div className="settingsQuality" role="group" aria-label={t('edge_scrolling')}>
        <button type="button" aria-pressed={edgeScrolling} className={edgeScrolling ? 'on' : ''} onClick={() => setEdgeScrolling(true)}>{t('share_stats_on')}</button>
        <button type="button" aria-pressed={!edgeScrolling} className={!edgeScrolling ? 'on' : ''} onClick={() => setEdgeScrolling(false)}>{t('share_stats_off')}</button>
      </div>
      <div className="settingsQualityLabel">{t('share_stats')}</div>
      <div className="settingsQuality" role="group" aria-label={t('share_stats')}>
        <button type="button" aria-pressed={shareStats} className={shareStats ? 'on' : ''} onClick={() => setShareStats(true)}>{t('share_stats_on')}</button>
        <button type="button" aria-pressed={!shareStats} className={!shareStats ? 'on' : ''} onClick={() => setShareStats(false)}>{t('share_stats_off')}</button>
      </div>
      <p className="settingsNote">{t('share_stats_note')}</p>
      <button type="button" className="ghost settingsAction" onClick={() => { restartSim(); if (root.current) root.current.open = false }} title={t('restart_simulation_ctrl_r')} aria-label={t('restart')} aria-keyshortcuts="Control+R">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" /><path d="M13.5 1.8v3h-3" /></svg>
        <span>{t('restart')}</span>
      </button>
      <a className="ghost settingsAction" href="https://github.com/ericpzh/metro/issues" target="_blank" rel="noreferrer" title={t('report_issue')} aria-label={t('report_issue')}>
        <FaBug aria-hidden="true" /><span>{t('report_issue')}</span>
      </a>
      <button type="button" className="ghost settingsAction" onClick={() => setLanguage(getLanguage() === 'en' ? 'zh-CN' : 'en')} title={t('switch_language')} aria-label={t('switch_language')}>
        <IoLanguageSharp aria-hidden="true" /><span>{language === 'en' ? t('language_native_chinese') : t('language_native_english')}</span>
      </button>
    </div>
  </details>
}
