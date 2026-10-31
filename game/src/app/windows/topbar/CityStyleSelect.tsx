import { useEffect, useRef, useState } from 'react'
import { CITY_STYLE_IDS, CITY_STYLES, type CityStyle } from '../../../sim/cityStyles.ts'
import { drawMetroMark } from '../../../render/cityBranding.ts'
import { t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
import { useStore } from '../../store.ts'

function CityIcon({ city, size = 80 }: { city: CityStyle; size?: number }): React.ReactElement {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const g = ref.current?.getContext('2d')
    if (!g) return
    g.clearRect(0, 0, size, size)
    drawMetroMark(g, size / 2, size / 2, size * .76, CITY_STYLES[city].logoColour, city)
  }, [city, size])
  return <canvas ref={ref} width={size} height={size} aria-hidden="true" />
}

export function CityStyleSelect(): React.ReactElement {
  useLanguage()
  const city = useStore(s => s.station.cityStyle)
  const setCityStyle = useStore(s => s.setCityStyle)
  const menu = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const show = (): void => {
    if (!menu.current || !button.current) return
    const rect = button.current.getBoundingClientRect()
    menu.current.style.top = `${rect.bottom + 8}px`
    menu.current.style.maxHeight = `${Math.max(0, window.innerHeight - rect.bottom - 20)}px`
    menu.current.showPopover()
    const width = menu.current.getBoundingClientRect().width
    menu.current.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`
    menu.current.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus()
  }
  return <>
    <button ref={button} className="ghost iconBtn cityStyleButton" title={t('city_style')} aria-label={t('city_style')}
      aria-haspopup="dialog" aria-expanded={open} aria-controls="cityStylesMenu"
      onClick={() => open ? menu.current?.hidePopover() : show()}><CityIcon city={city} size={20} /></button>
    <div ref={menu} id="cityStylesMenu" className="exampleStationsMenu cityStylesMenu" popover="auto" role="dialog"
      aria-label={t('city_style')} onToggle={e => setOpen(e.newState === 'open')} onKeyDown={e => e.stopPropagation()}>
      <div className="exampleStationsHeading"><strong>{t('city_style')}</strong>
        <button className="ghost iconBtn" aria-label={t('cancel')} onClick={() => menu.current?.hidePopover()}>×</button></div>
      <div className="cityStylesGrid" style={{ gridTemplateColumns: `repeat(${Math.min(4, CITY_STYLE_IDS.length)}, 84px)` }}>{CITY_STYLE_IDS.map(id => <button key={id} className="cityStyleTile" aria-pressed={city === id}
        onClick={() => { setCityStyle(id); menu.current?.hidePopover(); button.current?.focus() }}>
        <CityIcon city={id} /><strong>{t(CITY_STYLES[id].nameKey)}</strong>
      </button>)}</div>
    </div>
  </>
}
