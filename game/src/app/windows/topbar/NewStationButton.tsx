import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store.ts'

/** The button and Ctrl+N share one confirmation before replacing the current station. */
export function NewStationButton(): React.ReactElement {
  const newStation = useStore((s) => s.newStation)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const show = (): void => setOpen(true)
    window.addEventListener('metro:new-station', show)
    return () => window.removeEventListener('metro:new-station', show)
  }, [])

  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const cancel = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  const confirm = (): void => {
    newStation()
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <>
      <button
        ref={triggerRef}
        className="ghost iconBtn"
        onClick={() => setOpen(true)}
        title="新建车站（Ctrl+N）"
        aria-label="新建"
        aria-keyshortcuts="Control+N"
        aria-haspopup="dialog"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 1.5h5l3 3V14.5H4z" />
          <path d="M9 1.5v3h3" />
          <path d="M8 8.5v4M6 10.5h4" />
        </svg>
      </button>
      {open && (
        <div className="newStationDialog" role="presentation" onMouseDown={(e) => {
          if (e.target === e.currentTarget) cancel()
        }}>
          <section className="newStationPanel" role="dialog" aria-modal="true" aria-labelledby="newStationTitle" aria-describedby="newStationMessage">
            <h2 id="newStationTitle">新建车站？</h2>
            <p id="newStationMessage">当前车站将被新车站替换。请先保存需要保留的内容。</p>
            <div className="newStationActions">
              <button type="button" onClick={cancel}>取消</button>
              <button ref={confirmRef} type="button" className="primary" onClick={confirm}>新建车站</button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
