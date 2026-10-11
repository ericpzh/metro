import { msg, translate, t } from '../sim/i18n.ts'
import { useLanguage } from './i18n.ts'
// What a phone or tablet sees instead of the game: a single plain page that
// asks for a computer. It is all that main.tsx mounts in mobile mode, so the
// scene, the simulation and the three.js bundle never load.

import { useState } from 'react'

export function MobileNotice({ onProceed }: { onProceed: () => void }): React.ReactElement {
  useLanguage()
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(location.href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked (insecure context or denied): the address bar is
      // still there to copy from by hand.
    }
  }

  return (
    <div className="mobileGate">
      <div className="mobileCard">
        <div className="mobileBrand">{t('metro_station_designer')}</div>
        <h1>{t('please_open_on_a_computer')}</h1>
        <p className="mobileLead">{t('this_game_needs_a_mouse_and_keyboard_phones_and_tablets_are_not_')}</p>
        <p className="muted">{t('open_this_url_in_a_desktop_browser_to_start_designing_your_stati')}</p>

        <ul className="mobileWhy">
          <li>{t('use_the_mouse_to_rotate_the_view_build_and_remove_equipment')}</li>
          <li>{t('use_the_keyboard_to_change_floors_undo_and_redo')}</li>
          <li>{t('a_wider_screen_lets_you_see_the_whole_station')}</li>
        </ul>

        <button className="primary mobileCopy" onClick={() => void copy()}>
          {translate(copied ? msg('copied_paste_into_a_desktop_browser') : msg('copy_this_page_s_url'))}
        </button>
        <button className="mobileContinue" onClick={onProceed}>
          {t('continue_anyway')}</button>
      </div>
    </div>
  )
}
