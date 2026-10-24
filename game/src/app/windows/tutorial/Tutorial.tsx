import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../../../sim/i18n.ts'
import { setLanguage, useLanguage } from '../../i18n.ts'
import { useStore } from '../../store.ts'
import { isTypingTarget } from '../../Viewport.tsx'
import { readTutorialPreference, TUTORIAL_STEPS, tutorialAutoDisabled, writeTutorialPreference } from './steps.ts'
import './tutorial.css'

interface Box { x: number; y: number; width: number; height: number }
function initialPreference() {
  const preference = (() => {
    try { return readTutorialPreference(window.localStorage) } catch { return { step: 0, hidden: false } }
  })()
  return tutorialAutoDisabled(window.location.pathname) ? { ...preference, hidden: true } : preference
}

export function Tutorial({ reveal }: { reveal: () => void }): React.ReactElement | null {
  const language = useLanguage()
  const [preference, setPreference] = useState(initialPreference)
  const [open, setOpen] = useState(() => !preference.hidden)
  const [boxes, setBoxes] = useState<Box[]>([])
  const [position, setPosition] = useState({ left: 24, top: 90 })
  const [practiceSelected, setPracticeSelected] = useState(false)
  const card = useRef<HTMLElement>(null)
  const next = useRef<HTMLButtonElement>(null)
  const step = TUTORIAL_STEPS[preference.step]
  const tutorialLineId = useStore((state) => open && step.title === 'tutorial_line' ? state.station.lines.at(-1)?.id : undefined)
  const practice = step.practice
  const practiceActive = useStore((state) => state.tool === practice?.tool)
  const showBuildArea = open && practiceSelected && practiceActive

  useLayoutEffect(() => {
    setPracticeSelected(false)
    if (!open || !practice) return
    let current = true
    // An earlier step may have left the tool active. Require the player's own
    // selection in this step before revealing the construction area.
    const activate = (): void => {
      queueMicrotask(() => {
        if (current && useStore.getState().tool === practice.tool) setPracticeSelected(true)
      })
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() === practice.key && !event.ctrlKey && !event.metaKey && !event.altKey && !isTypingTarget(event.target)) activate()
    }
    const onClick = (event: MouseEvent): void => {
      if (event.target instanceof Element && event.target.closest(step.targets[0])) activate()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('click', onClick)
    return () => {
      current = false
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('click', onClick)
    }
  }, [open, step, practice])

  useEffect(() => {
    if (open) next.current?.focus({ preventScroll: true })
  }, [open, step])

  useEffect(() => {
    if (tutorialAutoDisabled(window.location.pathname)) return
    try { writeTutorialPreference(window.localStorage, preference) } catch { /* Private browsing. */ }
  }, [preference])

  useEffect(() => {
    const show = (): void => {
      setPreference((prev) => ({ ...prev, step: 0 }))
      setOpen(true)
    }
    window.addEventListener('metro:tutorial', show)
    return () => window.removeEventListener('metro:tutorial', show)
  }, [])

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    next.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      // Keep the game's camera and tool shortcuts live so players can try each
      // instruction. Only dismissal and focus navigation belong to the tour.
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        setOpen(false)
      }
      if (event.key === 'Tab' && card.current?.contains(event.target as Node)) {
        event.stopImmediatePropagation()
        const items = [...(card.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input') ?? [])]
        const first = items[0], last = items.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      previousFocus?.focus()
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    reveal()
    window.dispatchEvent(new CustomEvent('metro:tutorial-folders', { detail: { open: step.folders ?? [], close: step.closedFolders ?? [] } }))
    // A reopened tour may follow a collapsed navigation cube.
    const cubeToggle = document.querySelector<HTMLButtonElement>('[aria-controls="viewNavigation"]')
    if (cubeToggle?.getAttribute('aria-expanded') === 'false') cubeToggle.click()
    let frame = 0
    let folderTimer = 0
    let current = true
    const selectors = tutorialLineId === undefined ? [...step.targets] : [`[data-tutorial="${CSS.escape(`line-${tutorialLineId}`)}"]`]
    if (showBuildArea) selectors.push('.stage canvas')
    const targets = (): HTMLElement[] => selectors.flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)])
    const measure = (): void => {
      const width = window.innerWidth, height = window.innerHeight
      const rects = targets().map((element) => {
        const rect = element.getBoundingClientRect()
        const scroller = element.closest('.panelBody, .rail')?.getBoundingClientRect()
        const x = Math.max(6, rect.left - 5, scroller?.left ?? 0), y = Math.max(6, rect.top - 5, scroller?.top ?? 0)
        return { x, y, width: Math.max(0, Math.min(width - 6, rect.right + 5, scroller?.right ?? width) - x), height: Math.max(0, Math.min(height - 6, rect.bottom + 5, scroller?.bottom ?? height) - y) }
      }).filter((rect) => rect.width > 0 && rect.height > 0)
      setBoxes(rects)
      const cw = card.current?.offsetWidth ?? 352, ch = card.current?.offsetHeight ?? 290
      const clampX = (x: number): number => Math.max(12, Math.min(width - cw - 12, x))
      const clampY = (y: number): number => Math.max(12, Math.min(height - ch - 12, y))
      const centerX = (width - cw) / 2, centerY = (height - ch) / 2
      const candidates = [
        ...rects.flatMap((rect) => [
          { left: rect.x + rect.width + 20, top: rect.y },
          { left: rect.x - cw - 20, top: rect.y },
          { left: centerX, top: rect.y + rect.height + 20 },
          { left: centerX, top: rect.y - ch - 20 },
        ]),
        { left: centerX, top: centerY },
      ].map(({ left, top }) => ({ left: clampX(left), top: clampY(top) }))
      const overlap = (p: typeof position): number => rects.reduce((sum, rect) => sum +
        Math.max(0, Math.min(p.left + cw, rect.x + rect.width) - Math.max(p.left, rect.x)) *
        Math.max(0, Math.min(p.top + ch, rect.y + rect.height) - Math.max(p.top, rect.y)), 0)
      candidates.sort((a, b) => overlap(a) - overlap(b))
      setPosition(candidates[0])
    }
    const schedule = (): void => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    const onFolderClick = (event: MouseEvent): void => {
      const head = event.target instanceof Element ? event.target.closest('.folderHead') : null
      const folder = head?.parentElement
      if (!folder || !targets().includes(folder)) return
      const revealFolder = (): void => {
        if (!current || head?.getAttribute('aria-expanded') !== 'true') return
        folder.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' })
        schedule()
      }
      window.clearTimeout(folderTimer)
      folderTimer = window.setTimeout(revealFolder, 340)
    }
    const scroll = (): void => {
      for (const target of targets()) target.scrollIntoView({ block: tutorialLineId === undefined ? 'nearest' : 'start', inline: 'nearest', behavior: 'instant' })
      schedule()
    }
    scroll()
    // Folder chrome animates its height; remeasure after the opening settles.
    const timer = window.setTimeout(scroll, 340)
    const observer = new ResizeObserver(schedule)
    if (card.current) observer.observe(card.current)
    for (const target of targets()) observer.observe(target)
    window.addEventListener('resize', schedule)
    document.addEventListener('scroll', schedule, true)
    document.addEventListener('transitionend', schedule, true)
    document.addEventListener('click', onFolderClick)
    return () => {
      current = false
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      clearTimeout(folderTimer)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('scroll', schedule, true)
      document.removeEventListener('transitionend', schedule, true)
      document.removeEventListener('click', onFolderClick)
    }
  }, [open, step, language, reveal, tutorialLineId, showBuildArea])

  if (!open) return null
  const last = preference.step === TUTORIAL_STEPS.length - 1
  return createPortal(
    <div className="tutorialOverlay" onContextMenu={(event) => event.preventDefault()}>
      <svg className="tutorialShade" width="100%" height="100%" aria-hidden="true">
        <defs><mask id="tutorialSpotlights"><rect width="100%" height="100%" fill="white" />
          {boxes.map((box, index) => <rect key={index} {...box} rx="8" fill="black" />)}
        </mask></defs>
        <rect width="100%" height="100%" fill="rgba(5, 12, 22, .78)" mask="url(#tutorialSpotlights)" />
        {boxes.map((box, index) => <rect key={index} {...box} rx="8" fill="none" stroke="#9bdacc" strokeWidth="2" />)}
      </svg>
      <section ref={card} className="tutorialCard" style={position} role="dialog" aria-labelledby="tutorialTitle" aria-describedby="tutorialBody">
        <div className="tutorialEyebrow">{t('tutorial_title')}<span>{t('tutorial_progress', preference.step + 1, TUTORIAL_STEPS.length)}</span></div>
        {preference.step === 0 && <div className="tutorialLanguage" role="group" aria-label={t('switch_language')}>
          <button type="button" aria-pressed={language === 'zh-CN'} onClick={() => setLanguage('zh-CN')}>{t('language_native_chinese')}</button>
          <button type="button" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>{t('language_native_english')}</button>
        </div>}
        <div aria-live="polite" aria-atomic="true">
          <h2 id="tutorialTitle">{t(step.title)}</h2>
          {(step.title === 'tutorial_orbit' || step.title === 'tutorial_zoom') && <svg className="tutorialMouse" viewBox="0 0 80 80" width="60" height="60" fill="none" aria-hidden="true">
            <rect x="10" y="3" width="44" height="72" rx="22" stroke="currentColor" strokeWidth="2" />
            <path d="M10 32h44M32 3v13" stroke="currentColor" strokeWidth="2" />
            <rect x="25" y="13" width="14" height="26" rx="7" fill="#a6ddcb" stroke="#132b26" strokeWidth="2" />
            <path d="M32 20v12" stroke="#132b26" strokeWidth="2" strokeLinecap="round" />
            {step.title === 'tutorial_zoom' && <path d="M68 18v40m-6-34 6-6 6 6m-12 28 6 6 6-6" stroke="#a6ddcb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
          </svg>}
          {step.keys && <div className={`tutorialKeys${preference.step === 0 ? ' wasd' : ''}`} aria-hidden="true">{step.keys.map((shortcut) => (
            <span className="tutorialKeyChord" key={shortcut}>{shortcut.split('+').map((key, index) => (
              <Fragment key={index}>{index > 0 && <span className="tutorialKeyPlus">+</span>}<kbd>{key}</kbd></Fragment>
            ))}</span>
          ))}</div>}
          <p id="tutorialBody">{t(step.body)}</p>
        </div>
        <label className="tutorialPreference"><input type="checkbox" checked={preference.hidden} onChange={(event) => setPreference((prev) => ({ ...prev, hidden: event.target.checked }))} />{t('tutorial_dont_show')}</label>
        <div className="tutorialActions">
          <button className="ghost" onClick={() => setOpen(false)}>{t('tutorial_skip')}</button>
          <div className="spacer" />
          <button className="ghost" disabled={preference.step === 0} onClick={() => setPreference((prev) => ({ ...prev, step: prev.step - 1 }))}>{t('tutorial_back')}</button>
          <button ref={next} className="primary" onClick={() => {
            setPreference((prev) => ({ ...prev, step: last ? 0 : prev.step + 1 }))
            if (last) setOpen(false)
          }}>{t(last ? 'tutorial_finish' : 'tutorial_next')}</button>
        </div>
      </section>
    </div>, document.body,
  )
}
