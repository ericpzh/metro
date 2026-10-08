import { useEffect, useState } from 'react'
import { sheet } from '../site.js'
import { ui } from '../i18n.js'

// Unused at the moment (the gallery renders sheets inline), but kept for a
// future zoom view. Takes the same `t` strings as the rest of the page.
export default function Lightbox({ art, onClose, t = ui.zh }) {
  const [full, setFull] = useState(false)

  useEffect(() => {
    if (!art) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [art, onClose])

  useEffect(() => setFull(false), [art])

  if (!art) return null

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={art.title}
      onClick={onClose}
    >
      <div className="lightbox__bar" onClick={(e) => e.stopPropagation()}>
        <p className="lightbox__title">{art.title}</p>
        <div className="lightbox__tools">
          <button
            type="button"
            className="btn btn--small"
            onClick={() => setFull((f) => !f)}
            aria-pressed={full}
          >
            {full ? t.lightbox.fit : t.lightbox.full}
          </button>
          <button type="button" className="btn btn--small btn--close" onClick={onClose}>
            {t.lightbox.close}
          </button>
        </div>
      </div>

      <div
        className={'lightbox__stage' + (full ? ' lightbox__stage--full' : '')}
        onClick={(e) => e.stopPropagation()}
      >
        {art.id === '06' ? (
          <object className="sheet__interactive" data={sheet(art.file)} type="image/svg+xml" aria-label={art.alt}>
            <img src={sheet(art.file)} alt={art.alt} />
          </object>
        ) : <img src={sheet(art.file)} alt={art.alt} />}
      </div>

      <p className="lightbox__foot" onClick={(e) => e.stopPropagation()}>
        {art.lead}
      </p>
    </div>
  )
}
