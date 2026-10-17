import { useEffect, useRef } from 'react'
import { demoHref, stationPreview } from '../site.js'
import { stations } from '../stations.js'

/**
 * The demo-station picker. Both entry points — the nav's 示例车站 and the hero
 * button between 开始游戏 and 浏览概念图 — open this one dialog.
 *
 * A card is a plain link to the game's own demo route (`/game/zoo`,
 * `/game/en/tanwei`), so the picture, the station and the URL are the same thing
 * the game ships; nothing is loaded or rendered on the site side.
 */
export default function DemoPicker({ open, onClose, lang, t }) {
  const restore = useRef(null)
  const firstCard = useRef(null)
  const copy = t.demos

  useEffect(() => {
    if (!open) return
    restore.current = document.activeElement
    firstCard.current?.focus({ preventScroll: true })
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      restore.current?.focus?.({ preventScroll: true })
      restore.current = null
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="demos" role="presentation" onClick={onClose}>
      <section
        className="demos__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demosTitle"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="demos__head">
          <div>
            <h2 id="demosTitle">{copy.title}</h2>
            <p>{copy.intro}</p>
          </div>
          <button type="button" className="btn btn--small demos__close" onClick={onClose} aria-label={copy.close}>
            ×
          </button>
        </header>

        <div className="demos__grid">
          {stations.map((station, index) => {
            const item = copy[station.id]
            return (
              <a
                key={station.id}
                ref={index === 0 ? firstCard : undefined}
                className="demos__card"
                data-demo={station.id}
                href={demoHref(lang, station.id)}
              >
                <img src={stationPreview(station.preview)} alt="" decoding="async" />
                <span className="demos__caption">
                  <strong>{item.name}</strong>
                  <span className="demos__line">{item.line}</span>
                  <span className="demos__note">{item.note}</span>
                </span>
              </a>
            )
          })}
        </div>
      </section>
    </div>
  )
}
