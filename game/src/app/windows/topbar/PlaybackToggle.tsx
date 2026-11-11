export function PlaybackToggle({ playing, onClick, disabled, label }: {
  playing: boolean
  onClick: () => void
  disabled?: boolean
  label: string
}): React.ReactElement {
  return <button className={!playing ? 'on' : ''} aria-label={label} aria-pressed={!playing} disabled={disabled} onClick={onClick}>
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      {playing ? <><rect x="3.5" y="3" width="3" height="10" rx="0.6" /><rect x="9.5" y="3" width="3" height="10" rx="0.6" /></>
        : <path d="M4.5 2.8v10.4L13.2 8z" />}
    </svg>
  </button>
}
