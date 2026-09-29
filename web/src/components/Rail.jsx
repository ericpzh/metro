import { artworks } from '../artworks.js'

export default function Rail({ active }) {
  return (
    <nav className="rail" aria-label="Concept sheets">
      <span className="rail__label">Sheets</span>
      <ol className="rail__list">
        {artworks.map((a) => (
          <li key={a.id}>
            <a
              href={`#sheet-${a.id}`}
              className={active === a.id ? 'is-active' : undefined}
              style={{ '--accent': a.accent }}
            >
              <span className="rail__tick" aria-hidden="true" />
              <span className="rail__num">{a.id}</span>
              <span className="rail__name">{a.nav}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
