import { useCallback, useEffect, useState } from 'react'
import { artworks } from './artworks.js'
import Nav from './components/Nav.jsx'
import Hero from './components/Hero.jsx'
import Rail from './components/Rail.jsx'
import Sheet from './components/Sheet.jsx'
import Lightbox from './components/Lightbox.jsx'
import Footer from './components/Footer.jsx'

export default function App() {
  const [open, setOpen] = useState(null)
  const [active, setActive] = useState(artworks[0].id)

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

  // Track which sheet is on screen for the side rail.
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

  const closeLightbox = useCallback(() => setOpen(null), [])

  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Rail active={active} />
        <div className="gallery" id="gallery">
          {artworks.map((art) => (
            <Sheet art={art} key={art.id} onOpen={setOpen} />
          ))}
        </div>
        <Footer />
      </main>
      <Lightbox art={open} onClose={closeLightbox} />
    </>
  )
}
