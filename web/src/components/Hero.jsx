import { useEffect, useState } from 'react'
import {
  demoVideoEmbed,
  demoVideoPausedEmbed,
  demoVideoUrl,
  gameHref,
} from '../site.js'

// The Bilibili player is cross-origin and exposes no ended/seek API, so the
// hero uses the clip's known length (1:10) to swap to a fresh player paused at
// 0:01 once it has finished playing.
const demoSeconds = 71

export default function Hero({ t, copy, lang, onOpenDemos }) {
  const [played, setPlayed] = useState(false)

  useEffect(() => {
    if (played) return undefined
    const timer = setTimeout(() => setPlayed(true), demoSeconds * 1000)
    return () => clearTimeout(timer)
  }, [played])

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
              <button type="button" className="btn" onClick={onOpenDemos} data-demos="hero">
                {t.hero.demos}
              </button>
              <a className="btn" href="#gallery">
                {t.hero.browse}
              </a>
            </div>
          </div>

          <div className="hero__video-col">
            <figure className="hero__video">
              <iframe
                key={played ? 'paused' : 'playing'}
                src={played ? demoVideoPausedEmbed(lang) : demoVideoEmbed(lang)}
                title={t.hero.videoLabel}
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                loading="lazy"
              />
            </figure>
            <a
              className="hero__video-tag"
              href={demoVideoUrl(lang)}
              target="_blank"
              rel="noreferrer"
            >
              {t.hero.videoTag}
            </a>
          </div>
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
