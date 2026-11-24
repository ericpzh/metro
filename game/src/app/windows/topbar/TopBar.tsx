import { t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
// Lane A split (Phase 1): moved verbatim from app/App.tsx — TopBar() plus its
// private StationName() editor and SPEEDS group.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useStore } from '../../store.ts'
import { ExampleStationsButton } from './ExampleStationsButton.tsx'
import { NewStationButton } from './NewStationButton.tsx'
import { IoIosBookmarks } from 'react-icons/io'
import { SettingsMenu } from './SettingsMenu.tsx'
import { SimulationControls } from './SimulationControls.tsx'
import { openSaveWithLoading } from '../../gameLoading.ts'
import { CityStyleSelect } from './CityStyleSelect.tsx'
import { FileButtons } from './FileButtons.tsx'
import { ReplaceStationDialog } from './ReplaceStationDialog.tsx'
import { useStationHost } from '../StationHost.tsx'
import { stationHostCommit } from '../../stationHostBridge.ts'

// Speed multipliers: the play/pause toggle and the speeds are one segmented
// group (暂停 | 1× | 4× | 16× | 64×). Exactly one is highlighted: paused ⇒ the
// pause icon, playing ⇒ the active speed. Clicking play or a speed resumes at
// that speed; Space toggles between paused and the last selected speed.
//
// **64× is the top of the range and it is a wall-clock multiple, not a promise.**
// One tick steps one simulated second whatever the speed (see `sim/constants.ts`),
// so 64× asks the worker for a tick every 15.6 ms (`intervalMs`) — a rate the crowd's
// own tick cost may not always meet in a busy station. The sim then simply runs at
// whatever the machine manages; nothing is skipped and §7.6 determinism is untouched,
// because the step size never changes.

/** Edit both station names as one undoable document change. */
function StationName({ editable = true }: { editable?: boolean }): React.ReactElement {
  useLanguage()
  const name = useStore((s) => s.station.name)
  const nameEn = useStore((s) => s.station.nameEn ?? '')
  const renameStation = useStore((s) => s.renameStation)
  const [draft, setDraft] = useState<{ name: string; nameEn: string } | null>(null)
  return (
    <div className="stationNameEditor">
      <button className="stationName" disabled={!editable} onClick={() => setDraft({ name, nameEn })} aria-label={t('station_name_click_to_rename')}>
        {name || t('unnamed_station')}{nameEn && <span className="stationNameEnglish">{nameEn}</span>}
      </button>
      {draft && (
        <form className="stationNameForm" aria-label={t('edit_station_name')} onSubmit={(e) => {
          e.preventDefault()
          if (!draft.name.trim()) return
          renameStation(draft.name, draft.nameEn)
          setDraft(null)
        }} onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); setDraft(null) }
        }}>
          <label>{t('chinese_station_name')}<input className="stationNameInput" autoFocus required maxLength={24} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <label>{t('english_station_name')}<input className="stationNameInput" maxLength={80} value={draft.nameEn} onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })} /></label>
          <div className="stationNameActions"><button type="submit" disabled={!draft.name.trim()}>{t('save')}</button><button type="button" onClick={() => setDraft(null)}>{t('cancel')}</button></div>
        </form>
      )}
    </div>
  )
}

const EMPTY_HISTORY = { canUndo: false, canRedo: false }
const noopSubscribe = (): (() => void) => () => {}

export function TopBar({ files }: { files?: { save: () => void; open: (text: string) => void } } = {}): React.ReactElement {
  useLanguage()
  const host = useStationHost()
  const saveToFile = useStore((s) => s.saveToFile)
  const loadFromText = useStore((s) => s.loadFromText)
  const storeUndo = useStore((s) => s.undo)
  const storeRedo = useStore((s) => s.redo)
  const storeCanUndo = useStore((s) => s.past.length > 0)
  const storeCanRedo = useStore((s) => s.future.length > 0)
  const hostHistory = useSyncExternalStore(
    host?.subscribeHistory ?? noopSubscribe,
    host?.getHistory ?? (() => EMPTY_HISTORY),
  )
  const undo = host?.undo ?? storeUndo
  const redo = host?.redo ?? storeRedo
  const canUndo = host?.getHistory ? hostHistory.canUndo : storeCanUndo
  const canRedo = host?.getHistory ? hostHistory.canRedo : storeCanRedo
  const [confirmOpenSave, setConfirmOpenSave] = useState(false)
  const openButtonRef = useRef<HTMLButtonElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Ctrl+L requests the same save-first confirmation as the Open button before
  // opening the file picker; the key handler lives in App, so it arrives as an event.
  useEffect(() => {
    const open = (): void => setConfirmOpenSave(true)
    window.addEventListener('metro:open', open)
    return () => window.removeEventListener('metro:open', open)
  }, [])
  const cancelOpenSave = (): void => {
    setConfirmOpenSave(false)
    openButtonRef.current?.focus()
  }
  const confirmOpenSaveDialog = (): void => {
    setConfirmOpenSave(false)
    fileRef.current?.click()
  }
  return (
    <div className="topbar">
      <div className="brand">
        <span className="logo">{t('metro_station_designer')}</span>
        <StationName editable={!files && (!host || Boolean(stationHostCommit()?.commitStationName))} />
      </div>
      <div className="spacer" />
      <NewStationButton />
      <ExampleStationsButton />
      <CityStyleSelect />
      <button className="ghost iconBtn" onClick={() => window.dispatchEvent(new Event('metro:tutorial'))} title={t('tutorial_title')} aria-label={t('tutorial_title')}>
        <IoIosBookmarks aria-hidden="true" />
      </button>
      <FileButtons
        onSave={files?.save ?? (host ? () => host.save() : saveToFile)}
        onOpen={() => setConfirmOpenSave(true)}
        openButtonRef={openButtonRef}
      />
      <ReplaceStationDialog
        open={confirmOpenSave}
        title={t('open_save_confirm_title')}
        confirmLabel={t('open_save_confirm')}
        onCancel={cancelOpenSave}
        onConfirm={confirmOpenSaveDialog}
      />
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f && files) void f.text().then(files.open, () => useStore.getState().setNotice(document.documentElement.lang === 'en' ? 'Could not read the save file.' : '无法读取存档文件。'))
          else if (f && host) void f.text().then(host.openSave, () => useStore.getState().setNotice(document.documentElement.lang === 'en' ? 'Could not read the save file.' : '无法读取存档文件。'))
          else if (f) void openSaveWithLoading(f, (text) => {
            const epoch = useStore.getState().stationEpoch
            loadFromText(text)
            return useStore.getState().stationEpoch !== epoch
          }, () => useStore.getState().setNotice(document.documentElement.lang === 'en'
            ? 'Could not read the save file.' : '无法读取存档文件。'))
          e.target.value = ''
        }}
      />
      <button
        className="ghost iconBtn"
        onClick={undo}
        disabled={!canUndo}
        title={t('undo_ctrl_z')}
        aria-label={t('undo')}
        aria-keyshortcuts="Control+Z"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 4 2.5 7.5 6 11" />
          <path d="M2.5 7.5H10a3.5 3.5 0 0 1 0 7H7" />
        </svg>
      </button>
      <button
        className="ghost iconBtn"
        onClick={redo}
        disabled={!canRedo}
        title={t('redo_ctrl_y')}
        aria-label={t('redo')}
        aria-keyshortcuts="Control+Y"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 4l3.5 3.5L10 11" />
          <path d="M13.5 7.5H6a3.5 3.5 0 0 0 0 7h3" />
        </svg>
      </button>
      <SimulationControls />
      <SettingsMenu />
    </div>
  )
}
