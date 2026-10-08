import { useEffect, useState } from 'react'
import { gameUrl } from '../site.js'

/**
 * The 游戏 tab: a full-viewport iframe around the game's own Worker, served at
 * `<site>/game/`. The site and the game stay separate builds and separate
 * deploys; this page is only the frame.
 */
export default function GamePage() {
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const previous = document.title
    document.title = '地铁车站设计师 — 游戏'
    return () => {
      document.title = previous
    }
  }, [])

  return (
    <div className="gamepage">
      <div className="gameframe">
        <iframe src={gameUrl} title="地铁车站设计师 — 游戏" onLoad={() => setLoaded(true)} />
        {!loaded && (
          <div className="gameframe__load" role="status">
            <span className="spinner" aria-hidden="true" />
            <p>正在载入游戏…</p>
            <small>如果一直没反应，可能是游戏服务没连上。</small>
          </div>
        )}
      </div>
    </div>
  )
}
