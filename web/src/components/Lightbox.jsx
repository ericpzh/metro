import { useEffect, useState } from 'react'
import { sheet } from '../site.js'

export default function Lightbox({ art, onClose }) {
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
      aria-label={`第 ${art.id} 张：${art.title}`}
      onClick={onClose}
    >
      <div className="lightbox__bar" onClick={(e) => e.stopPropagation()}>
        <p className="lightbox__title">
          <span className="lightbox__num" style={{ background: art.accent }}>
            {art.id}
          </span>
          {art.title}
        </p>
        <div className="lightbox__tools">
          <button
            type="button"
            className="btn btn--small"
            onClick={() => setFull((f) => !f)}
            aria-pressed={full}
          >
            {full ? '适应屏幕' : '原始分辨率'}
          </button>
          <button type="button" className="btn btn--small btn--close" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>

      <div
        className={'lightbox__stage' + (full ? ' lightbox__stage--full' : '')}
        onClick={(e) => e.stopPropagation()}
      >
        <img src={sheet(art.file)} alt={art.alt} />
      </div>

      <p className="lightbox__foot" onClick={(e) => e.stopPropagation()}>
        {art.lead}
      </p>
    </div>
  )
}
