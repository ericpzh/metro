import { artworks, sections } from '../artworks.js'

export default function Rail({ active }) {
  return (
    <nav className="rail" aria-label="概念图列表">
      {sections.map((section) => {
        const sheets = artworks.filter((a) => a.section === section.id)
        return (
          <div className="rail__group" key={section.id}>
            <a className="rail__label" href={`#group-${section.id}`}>
              {section.label}
            </a>
            <ol className="rail__list">
              {sheets.map((a) => (
                <li key={a.id}>
                  <a
                    href={`#sheet-${a.id}`}
                    className={active === a.id ? 'is-active' : undefined}
                    style={{ '--accent': a.accent }}
                  >
                    <span className="rail__tick" aria-hidden="true" />
                    <span className="rail__name">{a.nav}</span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        )
      })}
    </nav>
  )
}
