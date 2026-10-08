import { useEffect, useState } from 'react'
import { repoUrl } from '../site.js'
import { gameHref } from '../i18n.js'

export default function Nav({ lang, onLang, t }) {
  const [progress, setProgress] = useState(0)
  const [solid, setSolid] = useState(false)

  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement
      const max = doc.scrollHeight - doc.clientHeight
      setProgress(max > 0 ? Math.min(1, doc.scrollTop / max) : 0)
      setSolid(doc.scrollTop > 40)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return (
    <header className={'nav' + (solid ? ' nav--solid' : '')}>
      <div className="nav__inner">
        <a className="nav__brand" href="#top">
          <span className="nav__roundel" aria-hidden="true" />
          <span className="nav__name">
            {t.nav.brand}
          </span>
        </a>
        <nav className="tabs tabs--nav" aria-label={t.nav.siteLabel}>
          <a className="tab tab--on" href={gameHref(lang)} aria-current="page">
            {t.nav.game}
          </a>
        </nav>
        <span className="nav__spacer" />
        <nav className="nav__links">
          <a href="#gallery">{t.nav.gallery}</a>
          <a href={repoUrl} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
        <div className="langswitch" role="group" aria-label={t.nav.langLabel}>
          <button
            type="button"
            onClick={() => onLang('zh')}
            aria-pressed={lang === 'zh'}
            lang="zh-CN"
          >
            中文
          </button>
          <button
            type="button"
            onClick={() => onLang('en')}
            aria-pressed={lang === 'en'}
            lang="en"
          >
            EN
          </button>
        </div>
      </div>
      <div className="nav__progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
    </header>
  )
}
