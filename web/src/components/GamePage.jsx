import { useEffect, useState } from 'react'
import { gameUrl } from '../site.js'

/**
 * The 游戏 tab: a full-viewport iframe around the game's own Worker, served at
 * `<site>/game/`. The site and the game stay separate builds and separate
 * deploys; this page is only the frame and the way back.
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

  // The site's document lives one level up from /game/.
  const backHref = new URL('../', window.location.href).href

  return (
    <div className="gamepage">
      <header className="gamebar">
        <a className="nav__brand" href={backHref}>
          <span className="nav__roundel" aria-hidden="true" />
          <span className="nav__name">
            地铁车站设计师
            <em>游戏</em>
          </span>
        </a>
        <nav className="tabs">
          <a className="tab" href={backHref}>
            概念图
          </a>
          <span className="tab tab--on" aria-current="page">
            游戏
          </span>
          <a className="tab tab--ext" href={gameUrl} target="_blank" rel="noreferrer">
            在新标签页打开 ↗
          </a>
        </nav>
      </header>
      <div className="gameframe">
        <iframe src={gameUrl} title="地铁车站设计师 — 游戏" onLoad={() => setLoaded(true)} />
        {!loaded && (
          <div className="gameframe__load" role="status">
            <span className="spinner" aria-hidden="true" />
            <p>正在载入游戏…</p>
            <small>
              如果长时间没有反应，请确认游戏 Worker 已部署，或
              <a href={gameUrl} target="_blank" rel="noreferrer">
                在新标签页打开
              </a>
              。
            </small>
          </div>
        )}
      </div>
    </div>
  )
}
