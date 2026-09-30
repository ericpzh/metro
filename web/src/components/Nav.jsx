import { useEffect, useState } from 'react'
import { gamePath, repoUrl, specUrl } from '../site.js'

export default function Nav() {
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
            地铁车站设计师
            <em>概念图</em>
          </span>
        </a>
        <nav className="tabs tabs--nav" aria-label="站点">
          <a className="tab tab--on" href={import.meta.env.BASE_URL} aria-current="page">
            概念图
          </a>
          <a className="tab" href={gamePath}>
            游戏
          </a>
        </nav>
        <span className="nav__spacer" />
        <nav className="nav__links">
          <a href="#gallery">看图</a>
          <a href={specUrl} target="_blank" rel="noreferrer">
            设计文档
          </a>
          <a href={repoUrl} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
      </div>
      <div className="nav__progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
    </header>
  )
}
