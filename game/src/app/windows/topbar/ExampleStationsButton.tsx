import { useEffect, useRef, useState } from 'react'
import { EXAMPLE_STATIONS } from './exampleStations.ts'

/** The button and shortcut open the same chooser; only a card loads a station. */
export function ExampleStationsButton(): React.ReactElement {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  const show = (): void => {
    const button = buttonRef.current
    const menu = menuRef.current
    if (!button || !menu) return
    const anchor = button.getBoundingClientRect()
    menu.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - 372))}px`
    menu.style.top = `${anchor.bottom + 8}px`
    menu.showPopover()
    menu.querySelector<HTMLButtonElement>('.exampleStationCard')?.focus()
  }
  useEffect(() => {
    window.addEventListener('metro:examples', show)
    return () => window.removeEventListener('metro:examples', show)
  }, [])

  return (
    <>
      <button
        ref={buttonRef}
        className="ghost iconBtn"
        onClick={() => open ? menuRef.current?.hidePopover() : show()}
        title="示例车站（Ctrl+Shift+N）"
        aria-label="示例车站"
        aria-keyshortcuts="Control+Shift+N"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="exampleStationsMenu"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1.5 6 8 2l6.5 4" />
          <path d="M3.5 6v6.5M12.5 6v6.5M6.2 6v6.5M9.8 6v6.5M1.5 12.5h13" />
        </svg>
      </button>
      <div
        ref={menuRef}
        id="exampleStationsMenu"
        className="exampleStationsMenu"
        popover="auto"
        role="dialog"
        aria-label="示例车站"
        onToggle={(e) => setOpen(e.newState === 'open')}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="exampleStationsHeading">
          <strong>示例车站</strong>
          <button className="ghost iconBtn" aria-label="关闭示例车站" onClick={() => menuRef.current?.hidePopover()}>×</button>
        </div>
        <div className="exampleStationsGrid">
          {EXAMPLE_STATIONS.map((station) => (
            <button
              key={station.id}
              className="exampleStationCard"
              onClick={() => {
                menuRef.current?.hidePopover()
                station.load()
              }}
              aria-label={`打开${station.name}示例车站`}
            >
              <img src={station.preview} alt={`${station.name}站大厅预览`} />
              <span className="exampleStationCaption">
                <strong>{station.name}</strong>
                <span>{station.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
