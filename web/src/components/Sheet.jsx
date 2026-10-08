import { useEffect, useState } from 'react'
import useMediaQuery from '../useMediaQuery.js'
import { sheet } from '../site.js'

// Phone widths start with the note out of the way; the toggle brings it back.
const PHONE = '(max-width: 620px)'

/**
 * One concept sheet, edge to edge, with the design note pinned to the
 * lower-right corner of the drawing. On phones the note starts collapsed so
 * the drawing is unobstructed; on wider screens it starts expanded. The
 * button in its header flips it either way.
 */
export default function Sheet({ art, onOpen }) {
  const isPhone = useMediaQuery(PHONE)
  const [expanded, setExpanded] = useState(() => !isPhone)

  // Auto-hide on phones, auto-show when there is room again.
  useEffect(() => {
    setExpanded(!isPhone)
  }, [isPhone])

  const cls = 'panel' + (expanded ? '' : ' panel--collapsed')

  return (
    <section
      id={`sheet-${art.id}`}
      className="sheet"
      data-reveal
      style={{ '--accent': art.accent }}
    >
      {art.id === '06' ? (
        <div className="sheet__zoom">
          <object className="sheet__interactive" data={sheet(art.file)} type="image/svg+xml" aria-label={art.alt}>
            <img src={sheet(art.file)} alt={art.alt} loading="lazy" />
          </object>
        </div>
      ) : <button
        type="button"
        className="sheet__zoom"
        onClick={() => onOpen(art)}
        aria-label={`看大图：${art.title}`}
      >
        <img src={sheet(art.file)} alt={art.alt} loading="lazy" decoding="async" />
      </button>}

      <article className={cls}>
        <header className="panel__head">
          <span className="panel__cat">{art.nav}</span>
          <button
            type="button"
            className="panel__toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? `收起「${art.title}」的说明` : `展开「${art.title}」的说明`}
          >
            {expanded ? '收起' : '展开'}
          </button>
        </header>

        <div className="panel__body">
          <h2 className="panel__title">{art.title}</h2>
          <p className="panel__lead">{art.lead}</p>
          <p className="panel__note">{art.note}</p>

          <ul className="panel__tags">
            {art.tags.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>

          <button type="button" className="panel__open" onClick={() => onOpen(art)}>
            看大图
          </button>
        </div>
      </article>
    </section>
  )
}
