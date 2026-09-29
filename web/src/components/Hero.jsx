import { artworks, tagline } from '../artworks.js'
import { specUrl } from '../site.js'

const facts = [
  ['Platform', 'React 19 + Vite, three.js via react-three-fiber, Web Worker simulation'],
  ['Mode', 'Sandbox / puzzle-sim, single player'],
  ['View', '2:1 isometric 3D, cutaway, per-level slicing, full orbit'],
  ['Status', 'Specification, draft 1'],
]

export default function Hero() {
  const n = String(artworks.length).padStart(2, '0')

  return (
    <section className="hero" id="top">
      <div className="hero__grid" aria-hidden="true" />
      <div className="hero__inner">
        <p className="hero__eyebrow">Metro Station Designer · concept sheets</p>
        <h1>
          Build a metro station.
          <br />
          Then watch the crowd
          <br />
          <span className="hero__accent">try to use it.</span>
        </h1>
        <p className="hero__tagline">{tagline}</p>

        <div className="hero__actions">
          <a className="btn btn--primary" href="#gallery">
            See the {n} sheets
          </a>
          <a className="btn" href={specUrl} target="_blank" rel="noreferrer">
            Read the spec
          </a>
        </div>

        <dl className="hero__facts">
          {facts.map(([k, v]) => (
            <div className="hero__fact" key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <a className="hero__cue" href="#gallery" aria-label="Scroll to the concept art">
        <span className="hero__cue-dot" />
        scroll
      </a>
    </section>
  )
}
