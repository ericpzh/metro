import { sheet } from '../site.js'

/**
 * One concept sheet, edge to edge, with the design note floating over the
 * quietest part of the drawing (see `panel` in artworks.js).
 */
export default function Sheet({ art, onOpen }) {
  const p = art.panel
  const isEdge = p.mode === 'edge'
  const cls = isEdge ? `panel panel--${p.side}` : 'panel panel--free'
  // Placement travels as custom properties so the narrow-width rules can
  // reset it without !important fighting an inline left/right.
  const style = isEdge
    ? { '--panel-left': p.side === 'left' ? '5%' : 'auto', '--panel-right': p.side === 'right' ? '5%' : 'auto', '--panel-top': p.top }
    : { '--panel-left': p.left, '--panel-right': 'auto', '--panel-top': p.top }

  return (
    <section
      id={`sheet-${art.id}`}
      className="sheet"
      data-reveal
      style={{ '--accent': art.accent }}
    >
      <button
        type="button"
        className="sheet__zoom"
        onClick={() => onOpen(art)}
        aria-label={`放大看第 ${art.id} 张：${art.title}`}
      >
        <img src={sheet(art.file)} alt={art.alt} loading="lazy" decoding="async" />
      </button>

      <article className={cls} style={style}>
        <header className="panel__head">
          <span className="panel__num">{art.id}</span>
          <span className="panel__cat">{art.nav}</span>
        </header>

        <h2 className="panel__title">{art.title}</h2>
        <p className="panel__lead">{art.lead}</p>
        <p className="panel__note">{art.note}</p>

        <ul className="panel__tags">
          {art.tags.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>

        <button type="button" className="panel__open" onClick={() => onOpen(art)}>
          放大看原图
        </button>
      </article>
    </section>
  )
}
