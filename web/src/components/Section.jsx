import { artworks } from '../artworks.js'
import Sheet from './Sheet.jsx'

/**
 * One reading section: an intro line, then every sheet tagged with this
 * section id, in the order they appear in `artworks`.
 */
export default function Section({ section, onOpen }) {
  const sheets = artworks.filter((art) => art.section === section.id)
  const titleId = `group-${section.id}-title`

  return (
    <section className="group" id={`group-${section.id}`} aria-labelledby={titleId}>
      <header className="group__head" data-reveal>
        <p className="group__kicker">{section.kicker}</p>
        <h2 className="group__title" id={titleId}>
          {section.label}
        </h2>
        <p className="group__note">{section.note}</p>
      </header>

      {sheets.map((art) => (
        <Sheet art={art} key={art.id} onOpen={onOpen} />
      ))}
    </section>
  )
}
