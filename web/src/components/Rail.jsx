export default function Rail({ active, t, copy }) {
  const currentIndex = copy.artworks.findIndex((art) => art.id === active)
  return (
    <nav className="rail" aria-label={t.rail.label}>
      <div className="rail__topics">
        {copy.sections.map((section) => (
          <div className="rail__group" key={section.id}>
            <a className="rail__label" href={`#group-${section.id}`}>{section.label}</a>
            <ol className="rail__list">
              {copy.artworks.filter((art) => art.section === section.id).map((art) => (
                <li key={art.id}>
                  <a href={`#sheet-${art.id}`}
                    className={active === art.id ? 'is-active' : copy.artworks.indexOf(art) < currentIndex ? 'is-read' : undefined}
                    aria-current={active === art.id ? 'location' : undefined}
                    style={{ '--accent': art.accent }}>
                    <span className="rail__tick" aria-hidden="true" />
                    <span>{art.nav}</span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </nav>
  )
}
