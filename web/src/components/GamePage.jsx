import { useEffect, useState } from 'react'
import { gameUrl } from '../site.js'
import { detectLang, ui } from '../i18n.js'

/**
 * The 游戏 tab: a full-viewport iframe around the game's own Worker, served at
 * `<site>/game/` (or `<site>/en/game/`). The site and the game stay separate
 * builds and separate deploys; this page is only the frame.
 */
export default function GamePage() {
  const [loaded, setLoaded] = useState(false)
  const [lang] = useState(() => detectLang())
  const t = ui[lang]

  useEffect(() => {
    const previous = document.title
    document.title = t.game.title
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'
    return () => {
      document.title = previous
    }
  }, [lang, t])

  return (
    <div className="gamepage">
      <div className="gameframe">
        <iframe src={gameUrl} title={t.game.frameTitle} onLoad={() => setLoaded(true)} />
        {!loaded && (
          <div className="gameframe__load" role="status">
            <span className="spinner" aria-hidden="true" />
            <p>{t.game.loading}</p>
            <small>{t.game.loadingHint}</small>
          </div>
        )}
      </div>
    </div>
  )
}
