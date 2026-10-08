// Lane A split (Phase 1): moved verbatim from app/App.tsx — TopBar() plus its
// private StationName() editor and SPEEDS group.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store.ts'
import { ExampleStationsButton } from './ExampleStationsButton.tsx'

// Speed multipliers: the play/pause toggle and the speeds are one segmented
// group (暂停 | 1× | 4× | 16× | 64×). Exactly one is highlighted: paused ⇒ the
// pause icon, playing ⇒ the active speed. Clicking a speed resumes at that
// speed; Space toggles between paused and the last selected speed.
//
// **64× is the top of the range and it is a wall-clock multiple, not a promise.**
// One tick steps one simulated second whatever the speed (see `sim/constants.ts`),
// so 64× asks the worker for a tick every 15.6 ms (`intervalMs`) — a rate the crowd's
// own tick cost may not always meet in a busy station. The sim then simply runs at
// whatever the machine manages; nothing is skipped and §7.6 determinism is untouched,
// because the step size never changes.
const SPEEDS = [1, 4, 16, 64]

/**
 * The station title in the top bar. Click to edit: Enter or blur keeps the
 * change, Escape throws it away. An empty name is refused by the store.
 */
function StationName(): React.ReactElement {
  const name = useStore((s) => s.station.name)
  const renameStation = useStore((s) => s.renameStation)
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)

  const start = (): void => {
    cancelled.current = false
    setDraft(name)
  }
  // Runs on blur and on Enter. Escape flags the field first, so the blur that
  // follows an unmount does not overwrite the name it just discarded.
  const save = (): void => {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    if (draft !== null) renameStation(draft)
    setDraft(null)
  }
  const cancel = (): void => {
    cancelled.current = true
    setDraft(null)
  }

  if (draft === null) {
    return (
      <button className="stationName" onClick={start} aria-label="车站名称，点击重命名">
        {name || '未命名车站'}
      </button>
    )
  }
  return (
    <input
      className="stationNameInput"
      value={draft}
      autoFocus
      maxLength={24}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          save()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        }
      }}
    />
  )
}

export function TopBar(): React.ReactElement {
  const playing = useStore((s) => s.playing)
  const speed = useStore((s) => s.speed)
  const setPlaying = useStore((s) => s.setPlaying)
  const setSpeed = useStore((s) => s.setSpeed)
  const newStation = useStore((s) => s.newStation)
  const saveToFile = useStore((s) => s.saveToFile)
  const loadFromText = useStore((s) => s.loadFromText)
  const restartSim = useStore((s) => s.restartSim)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const fileRef = useRef<HTMLInputElement>(null)
  // Ctrl+L opens the file picker, but the input lives here while the key
  // handler lives in App, so it arrives as an event.
  useEffect(() => {
    const open = (): void => fileRef.current?.click()
    window.addEventListener('metro:open', open)
    return () => window.removeEventListener('metro:open', open)
  }, [])
  const playAt = (s: number): void => {
    if (speed !== s) setSpeed(s)
    if (!playing) setPlaying(true)
  }
  return (
    <div className="topbar">
      <div className="brand">
        <span className="logo">地铁站设计师</span>
        <StationName />
      </div>
      <div className="spacer" />
      <button
        className="ghost iconBtn"
        onClick={newStation}
        title="新建车站（Ctrl+N）"
        aria-label="新建"
        aria-keyshortcuts="Control+N"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 1.5h5l3 3V14.5H4z" />
          <path d="M9 1.5v3h3" />
          <path d="M8 8.5v4M6 10.5h4" />
        </svg>
      </button>
      <ExampleStationsButton />
      <button
        className="ghost iconBtn"
        onClick={saveToFile}
        title="保存到文件（Ctrl+S）"
        aria-label="保存"
        aria-keyshortcuts="Control+S"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 2h8l2 2v10H3z" />
          <path d="M5 2v3.5h6V2" />
          <rect x="5" y="9" width="6" height="5" />
        </svg>
      </button>
      <button
        className="ghost iconBtn"
        onClick={() => fileRef.current?.click()}
        title="打开存档（Ctrl+L）"
        aria-label="打开"
        aria-keyshortcuts="Control+L"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1.5 4.5h4.5L7.2 6H14.5v6.5h-13z" />
        </svg>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void f.text().then(loadFromText)
          e.target.value = ''
        }}
      />
      <button
        className="ghost iconBtn"
        onClick={undo}
        disabled={!canUndo}
        title="撤销（Ctrl+Z）"
        aria-label="撤销"
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
        title="重做（Ctrl+Y）"
        aria-label="重做"
        aria-keyshortcuts="Control+Y"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 4l3.5 3.5L10 11" />
          <path d="M13.5 7.5H6a3.5 3.5 0 0 0 0 7h3" />
        </svg>
      </button>
      <div className="seg" role="group" aria-label="播放控制">
        <button
          className={!playing ? 'on' : ''}
          onClick={() => {
            if (playing) setPlaying(false)
          }}
          aria-label="暂停"
          aria-pressed={!playing}
        >
          {playing ? (
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
              <rect x="3.5" y="3" width="3" height="10" rx="0.6" />
              <rect x="9.5" y="3" width="3" height="10" rx="0.6" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M4.5 2.8v10.4L13.2 8z" />
            </svg>
          )}
        </button>
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={playing && speed === s ? 'on' : ''}
            onClick={() => playAt(s)}
            aria-label={`${s} 倍速`}
            aria-pressed={playing && speed === s}
          >
            {s}×
          </button>
        ))}
      </div>
      <button
        className="ghost iconBtn"
        onClick={restartSim}
        title="重启仿真（Ctrl+R）"
        aria-label="重启"
        aria-keyshortcuts="Control+R"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
          <path d="M13.5 1.8v3h-3" />
        </svg>
      </button>
    </div>
  )
}
