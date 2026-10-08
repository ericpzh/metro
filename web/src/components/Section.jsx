import { artworks } from '../artworks.js'
import Sheet from './Sheet.jsx'

/**
 * One reading section: an intro line, then every sheet tagged with this
 * section id, in the order they appear in `artworks`.
 */
export default function Section({ section }) {
  const sheets = artworks.filter((art) => art.section === section.id)

  return (
    <section className="group" id={`group-${section.id}`} aria-label={section.label} style={{ '--group-accent': sheets[0].accent }}>
      <div className="group__intro">
        <p className="group__note">{section.note}</p>
      </div>
      {sheets.map((art) => (
        <Sheet art={art} key={art.id} />
      ))}
    </section>
  )
}
