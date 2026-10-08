import { useEffect, useState } from 'react'
import { gallery } from './artworks.js'
import {
  canonicalPath,
  detectLang,
  isGamePath,
  isLangHash,
  ui,
} from './i18n.js'
import Nav from './components/Nav.jsx'
import Hero from './components/Hero.jsx'
import Rail from './components/Rail.jsx'
import Section from './components/Section.jsx'
import Footer from './components/Footer.jsx'

function setMeta(name, content) {
  const node = document.querySelector(`meta[name="${name}"]`)
  if (node) node.setAttribute('content', content)
}

export default function App() {
  const [lang, setLang] = useState(() => detectLang())
  const [active, setActive] = useState(gallery.zh.artworks[0].id)
  const copy = gallery[lang]
  const t = ui[lang]

  // Reflect the language in <html lang> / title / meta, and pin it to the
  // canonical path (/en/ for English) so the URL stays shareable.
  // Anchor hashes (#sheet-01 …) are preserved; alias hashes (#en) are dropped.
  useEffect(() => {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'
    document.title = t.doc.title
    setMeta('description', t.doc.desc)

    const url = new URL(window.location.href)
    const game = isGamePath(url.pathname)
    if (isLangHash(url.hash)) url.hash = ''
    if (url.searchParams.get('lang') != null) url.searchParams.delete('lang')
    url.pathname = canonicalPath(lang, game)
    const next = url.toString()
    if (next !== window.location.href) window.history.replaceState(null, '', next)
  }, [lang, t])

  // Stay in sync when the user walks between / and /en/ with back/forward.
  useEffect(() => {
    const onPop = () => setLang(detectLang())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Reveal sheets as they enter the viewport.
  useEffect(() => {
    const nodes = document.querySelectorAll('[data-reveal]')
    if (!('IntersectionObserver' in window)) {
      nodes.forEach((n) => n.classList.add('is-visible'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            io.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.04 },
    )
    nodes.forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [])

  // Track which sheet is on screen for the topic navigation.
  useEffect(() => {
    const nodes = document.querySelectorAll('.sheet')
    if (!('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (hit) setActive(hit.target.id.replace('sheet-', ''))
      },
      { rootMargin: '-30% 0px -40% 0px', threshold: [0, 0.2, 0.5] },
    )
    nodes.forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [])


  return (
    <>
      <Nav lang={lang} onLang={setLang} t={t} />
      <main>
        <Hero t={t} copy={copy} lang={lang} />
        <div className="gallery" id="gallery">
          <Rail active={active} t={t} copy={copy} />
          {copy.sections.map((section) => (
            <Section
              key={section.id}
              section={section}
              sheets={copy.artworks.filter((art) => art.section === section.id)}
            />
          ))}
        </div>
        <Footer t={t} />
      </main>
    </>
  )
}
