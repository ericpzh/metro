import { msg, translate, t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
// Lane A split (Phase 1): moved verbatim from app/App.tsx — the 信息 folder's
// body: the selected-piece card with the 移动 lift (GAME-SPEC.md §9.5), the
// 指示牌 board-editor entry (GAME-SPEC.md §5.8).
//
// The card's own acts are **icons, not words** — 移动 and 编辑指示牌面板 beside a
// selected piece, and the lift's own 确认 / 取消, which are a tick and a cross
// (`IoMdCheckmark` / `IoMdClose`, the same Ionicons the 移动 button is drawn from, so
// the card the button turns into is visibly the same card). A label apiece made it
// read as text where the rail reads as tiles; the glyph carries the meaning and the
// `aria-label` carries the name (which is also what a screen reader reads), and the
// buttons wear no tooltip, here or anywhere else in this column.
import { FaEdit, FaRegEye } from 'react-icons/fa'
import { HiOutlineRefresh, HiSwitchVertical } from 'react-icons/hi'
import { IoMdCheckmark, IoMdClose, IoMdMove } from 'react-icons/io'
import { useStore, moduleLabel } from '../../store.ts'
import { isMovableModule } from '../../../sim/placement.ts'
import { refreshTrackForSelection } from './refreshPlatform.ts'

export function InfoCard(): React.ReactElement {
  useLanguage()
  const selected = useStore((s) => s.selected)
  const followAgentId = useStore((s) => s.followAgentId)
  const station = useStore((s) => s.station)
  const moveDraft = useStore((s) => s.moveDraft)
  const openSignEditor = useStore((s) => s.openSignEditor)
  // The selected piece, when the selection is a placed module — what 移动 acts on.
  const selectedModule = selected?.kind === 'module' ? station.modules.find((m) => m.id === selected.key) : undefined
  const refreshTrack = refreshTrackForSelection(station.modules, selectedModule)
  const isSign = selectedModule?.type === 'sign'
  const movable = selectedModule !== undefined && isMovableModule(selectedModule)
  // The lift's own controls take the card over the moment a piece is in the air, so
  // they are read from the lift rather than from the selection: whatever is selected,
  // the tick and the cross are always where the 移动 button was.
  const canDrop = moveDraft !== null && moveDraft.at !== null && moveDraft.candidate !== null && moveDraft.reason === ''

  return (
    <>
      {selected ? (
        <div className="card">
          {moveDraft ? (
            // 移动 (§9.5): while a piece is in the air this card **is** the move's
            // control surface — the same place the 移动 button was pressed, so
            // there is nothing to look for anywhere else. The 3D view shows the
            // translucent ghost under the pointer; here is where it is, whether it
            // will land, and the two ways out of it.
            <>
              <div className="kv">
                <span>{t('move')}</span>
                <b>{translate(moduleLabel(moveDraft.module))}</b>
              </div>
              <div className="kv">
                <span>{t('position')}</span>
                <b className={canDrop ? undefined : 'bad'}>
                  {translate(moveDraft.at ? `(${moveDraft.at.x}, ${moveDraft.at.y}, ${moveDraft.at.z})` : msg('move_to_the_new_location'))}
                </b>
              </div>
              {moveDraft.reason !== '' && <div className="moveReason small">{translate(moveDraft.reason)}</div>}
              <div className="row">
                <button
                  className="chip primary iconOnly"
                  disabled={!canDrop}
                  aria-label={t('confirm_move')}
                  onClick={() => useStore.getState().confirmMove()}
                >
                  <IoMdCheckmark />
                </button>
                <button
                  className="chip iconOnly"
                  aria-label={t('cancel_move')}
                  onClick={() => useStore.getState().cancelMove()}
                >
                  <IoMdClose />
                </button>
              </div>
            </>
          ) : (
            <>
            <div className="infoCardLayout">
              <div className="infoCardDetails">
              <div className="kv">
                <span>{t('selected')}</span>
                <b>{translate(selected.label)}</b>
              </div>
              <div className="kv">
                <span>{t('type')}</span>
                <b>{translate(selected.kind === 'module' ? msg('equipment') : selected.kind === 'agent' ? msg('passenger') : msg('block'))}</b>
              </div>
              </div>
              <div className="infoCardActions">
                {selected.kind === 'agent' && (
                  <button className="chip iconOnly" aria-label={t('passenger_eye_view')}
                    aria-pressed={followAgentId === Number(selected.key)}
                    onClick={() => {
                      const st = useStore.getState()
                      if (st.followAgentId !== null) st.endPassengerView()
                      else st.followPassenger(Number(selected.key))
                    }}>
                    <FaRegEye />
                  </button>
                )}
                {selected.kind === 'module' && (
                  <button
                    className="chip primary iconOnly"
                    disabled={!movable}
                    aria-label={t('move_value', translate(selected.label))}
                    onClick={() => useStore.getState().liftModule(selected.key)}
                  >
                    <IoMdMove />
                  </button>
                )}
                {selectedModule?.type === 'escalator' && (
                  <button
                    className="chip iconOnly"
                    aria-label={t('reverse_escalator')}
                    onClick={() => useStore.getState().switchEscalatorDirection(selectedModule.id)}
                  >
                    <HiSwitchVertical />
                  </button>
                )}
                {refreshTrack && (
                  <button
                    className="chip iconOnly"
                    aria-label={t('refresh_selected_platform_doors')}
                    onClick={() => useStore.getState().regenRail(refreshTrack.id)}
                  >
                    <HiOutlineRefresh />
                  </button>
                )}
                {isSign && (
                  <button
                    className="chip iconOnly"
                    aria-label={t('edit_sign_board')}
                    onClick={() => openSignEditor(selected.key)}
                  >
                    <FaEdit />
                  </button>
                )}
              </div>
            </div>
            </>
          )}
        </div>
      ) : (
        <div className="muted small">{t('nothing_selected_yet')}</div>
      )}
    </>
  )
}
