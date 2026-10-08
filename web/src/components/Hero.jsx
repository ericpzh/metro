import { sheet } from '../site.js'
import { gameHref } from '../i18n.js'

export default function Hero({ t, copy, lang }) {
  const first = copy.artworks[0]

  return (
    <section className="hero" id="top">
      <div className="hero__grid" aria-hidden="true" />
      <div className="hero__inner">
        <p className="hero__eyebrow">{t.hero.eyebrow}</p>
        <h1>
          {t.hero.line1}
          <br />
          {t.hero.line2}
          <br />
          <span className="hero__accent">{t.hero.accent}</span>
        </h1>

        <div className="hero__cols">
          <div>
            <p className="hero__tagline">{copy.tagline}</p>
            <div className="hero__actions">
              <a className="btn btn--primary" href={gameHref(lang)}>
                {t.hero.play}
              </a>
              <a className="btn" href="#gallery">
                {t.hero.browse}
              </a>
            </div>
          </div>

          <a className="hero__peek" href={`#sheet-${first.id}`} aria-label={t.hero.peekLabel}>
            <img src={sheet(first.file)} alt="" loading="eager" decoding="async" aria-hidden="true" />
            <span className="hero__peek-tag">{first.nav}</span>
          </a>
        </div>

        <dl className="hero__facts">
          {t.hero.facts.map(([k, v]) => (
            <div className="hero__fact" key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
