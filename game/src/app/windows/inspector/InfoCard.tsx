// Lane A split (Phase 1): moved verbatim from app/App.tsx — the 信息 folder's
// body: the selected-piece card with the 移动 lift (GAME-SPEC.md §9.5), the
// 指示牌 board-editor entry (GAME-SPEC.md §5.8), and the cell ZoneCard.
import { useStore, moduleLabel } from '../../store.ts'
import { isMovableModule } from '../../../sim/placement.ts'
import { ZoneCard } from './ZoneCard.tsx'

export function InfoCard(): React.ReactElement {
  const selected = useStore((s) => s.selected)
  const station = useStore((s) => s.station)
  const moveDraft = useStore((s) => s.moveDraft)
  const openSignEditor = useStore((s) => s.openSignEditor)
  // The selected piece, when the selection is a placed module — what 移动 acts on.
  const selectedModule = selected?.kind === 'module' ? station.modules.find((m) => m.id === selected.key) : undefined
  const isSign = selectedModule?.type === 'sign'
  const movable = selectedModule !== undefined && isMovableModule(selectedModule)
  // The lift's own controls take the card over the moment a piece is in the air, so
  // they are read from the lift rather than from the selection: whatever is selected,
  // 确认 / 取消 are always where the 移动 button was.
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
              <div className="kv" title="R 旋转；在地面左键放下；Esc / 右键放回原位">
                <span>移动</span>
                <b>{moduleLabel(moveDraft.module.type, moveDraft.module.type === 'shop' ? moveDraft.module.cfg.kind : undefined)}</b>
              </div>
              <div className="kv">
                <span>位置</span>
                <b className={canDrop ? undefined : 'bad'}>
                  {moveDraft.at ? `(${moveDraft.at.x}, ${moveDraft.at.y}, ${moveDraft.at.z})` : '移到要放的位置'}
                </b>
              </div>
              {moveDraft.reason !== '' && <div className="moveReason small">{moveDraft.reason}</div>}
              <div className="row">
                <button
                  className="chip primary"
                  disabled={!canDrop}
                  title="确认：把它放在这里（也可以直接在地面点一下，或按 Enter）"
                  onClick={() => useStore.getState().confirmMove()}
                >
                  确认
                </button>
                <button
                  className="chip"
                  title="取消：放回拿起来的地方（Esc、右键也一样）"
                  onClick={() => useStore.getState().cancelMove()}
                >
                  取消
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="kv">
                <span>已选</span>
                <b>{selected.label}</b>
              </div>
              <div className="kv">
                <span>类型</span>
                <b>{selected.kind === 'module' ? '设备' : '方块'}</b>
              </div>
              <div className="row">
                {/* 移动 lives here rather than on a tile: the piece is already
                    selected, so the card is where "move this one" belongs. Pressing
                    it lifts the piece in the 3D view and turns this card into the
                    move's own controls (above); a structure that cannot be moved
                    says why and stays disabled. */}
                {selected.kind === 'module' && (
                  <button
                    className="chip primary"
                    disabled={!movable}
                    title={
                      movable
                        ? '移动：把它拿起来换个位置。整件东西原样移过去——指示牌印的面板、闸机的门向、广告牌的画面都不变；Esc / 右键随时放回原位'
                        : `${selected.label}不能移动：用删除 (B) 拆掉再放`
                    }
                    onClick={() => useStore.getState().liftModule(selected.key)}
                  >
                    移动
                  </button>
                )}
                {/* A 指示牌 is composed on its own board (§5.8), so it is edited in
                    the board editor rather than in a property list here. */}
                {isSign && (
                  <button className="chip" onClick={() => openSignEditor(selected.key)}>
                    编辑指示牌面板
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="muted small">暂未选中任何物品。</div>
      )}
      {selected?.kind === 'cell' && <ZoneCard />}
    </>
  )
}
