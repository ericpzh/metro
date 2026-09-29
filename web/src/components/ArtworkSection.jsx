import { sheet } from '../site.js'

export default function ArtworkSection({ art, index, onOpen }) {
  const flip = index % 2 === 1

  return (
    <section
      id={`sheet-${art.id}`}
      className={'section' + (flip ? ' section--flip' : '')}
      data-reveal
      style={{ '--accent': art.accent }}
    >
      <div className="section__art">
        <button
          type="button"
          className="art-card"
          onClick={() => onOpen(art)}
          aria-label={`Open sheet ${art.id}, ${art.title}, at full size`}
        >
          <span className="art-card__num" aria-hidden="true">
            {art.id}
          </span>
          <img src={sheet(art.file)} alt={art.alt} loading="lazy" decoding="async" />
          <span className="art-card__hint" aria-hidden="true">
            <span className="art-card__hint-icon" />
            Click to enlarge
          </span>
        </button>
      </div>

      <div className="section__text">
        <p className="kicker">{art.kicker}</p>
        <h2 className="section__title">{art.title}</h2>
        <p className="lead">{art.lead}</p>
        {art.body?.map((p) => (
          <p className="para" key={p}>
            {p}
          </p>
        ))}
        {art.tags && (
          <ul className="tags">
            {art.tags.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
