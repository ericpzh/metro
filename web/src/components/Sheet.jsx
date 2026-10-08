import { sheet } from '../site.js'

/** A short introduction followed by the full-width concept sheet. */
export default function Sheet({ art }) {
  return (
    <section id={`sheet-${art.id}`} className="sheet" data-reveal style={{ '--accent': art.accent }}>
      <div className="sheet__intro">
        <p>{art.lead}</p>
      </div>
      {art.id === '06' ? (
        <div className="sheet__art">
          <object className="sheet__interactive" data={sheet(art.file)} type="image/svg+xml" aria-label={art.alt}>
            <img src={sheet(art.file)} alt={art.alt} loading="lazy" />
          </object>
        </div>
      ) : (
        <div className="sheet__art">
          <img src={sheet(art.file)} alt={art.alt} loading="lazy" decoding="async" />
        </div>
      )}
    </section>
  )
}
