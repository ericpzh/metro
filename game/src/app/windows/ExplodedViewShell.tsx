import type React from 'react'
import { t } from '../../sim/i18n.ts'
import { useLanguage } from '../i18n.ts'
import { SimulationControls } from './topbar/SimulationControls.tsx'
import { SettingsMenu } from './topbar/SettingsMenu.tsx'
import { IoArrowBackOutline, IoEyeOutline, IoEyeOffOutline } from 'react-icons/io5'
import { TbWall, TbWallOff } from 'react-icons/tb'
import { RiResetLeftFill } from 'react-icons/ri'
import { clampExplodedFloorPanelPosition, type ExplodedFloorRow } from './explodedPanelBounds.ts'

export { clampExplodedFloorPanelPosition, type ExplodedFloorRow }

export function ExplodedLoading({ error }: { error?: string | null } = {}): React.ReactElement {
  useLanguage()
  if (error) {
    return (
      <div className="explodedLoading" role="alert" aria-live="assertive">
        <div className="explodedLoadingCard">
          <div className="explodedLoadingBrand">Station Designer</div>
          <h1>{t('exploded_view')}</h1>
          <p>{error}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="explodedLoading" role="status" aria-live="polite">
      <div className="explodedLoadingCard">
        <div className="explodedLoadingBrand">Station Designer</div>
        <h1>{t('exploded_loading')}</h1>
        <p>{t('exploded_loading_detail')}</p>
        <div className="explodedLoadingTrack" aria-hidden="true" />
      </div>
    </div>
  )
}

export interface ExplodedViewShellProps {
  dialogRef: React.RefObject<HTMLDialogElement | null>
  floorPanelRef?: React.RefObject<HTMLElement | null>
  ready: boolean
  equipped: boolean
  unityHost?: boolean
  error?: string | null
  rows: readonly ExplodedFloorRow[]
  selectedIndex: number | null
  onClose: () => void
  onReset: () => void
  onSelectIndex: (index: number | null) => void
  onToggleFloor: (index: number) => void
  onToggleWalls: (index: number) => void
  isCanvasTarget?: (target: EventTarget | null) => boolean
  children?: React.ReactNode
}

export function ExplodedViewShell({
  dialogRef,
  floorPanelRef,
  ready,
  equipped,
  unityHost = false,
  error = null,
  rows,
  selectedIndex,
  onClose,
  onReset,
  onSelectIndex,
  onToggleFloor,
  onToggleWalls,
  isCanvasTarget,
  children,
}: ExplodedViewShellProps): React.ReactElement {
  useLanguage()
  const selectedRow = selectedIndex !== null && selectedIndex >= 0 && selectedIndex < rows.length
    ? rows[selectedIndex]
    : null

  return (
    <dialog
      ref={dialogRef}
      className="explodedViewer"
      data-ready={ready}
      data-equipped={equipped}
      data-unity-host={unityHost ? 'true' : undefined}
      aria-label={t('exploded_view')}
      onCancel={event => {
        event.preventDefault()
        onClose()
      }}
      onPointerDownCapture={event => {
        const hitCanvas = isCanvasTarget ? isCanvasTarget(event.target) : false
        if (!hitCanvas && !(event.target as Element | null)?.closest?.('.explodedFloorPanel')) {
          onSelectIndex(null)
        }
      }}
    >
      <header className="explodedToolbar">
        <strong>{t('exploded_view')}</strong>
        <button
          className="explodedReset"
          disabled={!ready}
          aria-label={t('exploded_reset')}
          title={t('exploded_reset')}
          onClick={onReset}
        >
          <RiResetLeftFill />
        </button>
        <div className="explodedToolbarControls">
          <button className="explodedBack" autoFocus onClick={onClose} aria-label={t('back_to_game')}>
            <IoArrowBackOutline />
          </button>
          <SimulationControls />
          <SettingsMenu />
        </div>
      </header>
      {children}
      {error ? (
        <ExplodedLoading error={error} />
      ) : !ready ? (
        <ExplodedLoading />
      ) : (
        rows.length === 0 && <p className="explodedEmpty" role="status">{t('exploded_empty')}</p>
      )}
      {selectedRow !== null && selectedIndex !== null && (
        <aside
          ref={floorPanelRef}
          className="explodedFloorPanel"
          aria-label={t('exploded_layers')}
          onKeyDown={event => event.stopPropagation()}
        >
          <strong>{t('exploded_layers')} · {selectedRow.elevation} m</strong>
          <div className="selected">
            <span>{selectedRow.elevation > 0 ? '+' : ''}{selectedRow.elevation} m</span>
            <button
              type="button"
              aria-pressed={selectedRow.floorVisible}
              aria-label={t(
                'exploded_control_label',
                t(selectedRow.floorVisible ? 'exploded_hide_floor' : 'exploded_show_floor'),
                selectedRow.elevation,
              )}
              title={t(selectedRow.floorVisible ? 'exploded_hide_floor' : 'exploded_show_floor')}
              onClick={() => onToggleFloor(selectedIndex)}
            >
              {selectedRow.floorVisible ? <IoEyeOutline /> : <IoEyeOffOutline />}
            </button>
            <button
              type="button"
              aria-pressed={selectedRow.wallsVisible}
              aria-label={t(
                'exploded_control_label',
                t(selectedRow.wallsVisible ? 'hide_walls' : 'exploded_show_walls'),
                selectedRow.elevation,
              )}
              title={t(selectedRow.wallsVisible ? 'hide_walls' : 'exploded_show_walls')}
              onClick={() => onToggleWalls(selectedIndex)}
            >
              {selectedRow.wallsVisible ? <TbWall /> : <TbWallOff />}
            </button>
          </div>
        </aside>
      )}
      <footer className="explodedLevels">
        <span>{t('exploded_arrange_hint')}</span>
        {rows.map((row, index) => (
          <button
            type="button"
            key={row.elevation}
            disabled={!ready}
            aria-pressed={selectedIndex === index}
            className={`${selectedIndex === index ? 'explodedSelectedLevel ' : ''}${row.floorVisible ? '' : 'explodedHiddenLevel'}`}
            onKeyDown={event => event.stopPropagation()}
            onClick={() => onSelectIndex(index)}
          >
            {row.elevation > 0 ? '+' : ''}{row.elevation} m
          </button>
        ))}
      </footer>
    </dialog>
  )
}
