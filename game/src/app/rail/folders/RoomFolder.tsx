import { msg, translate } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
// The 房间 folder body (§5.6 facility rooms).
//
// The 房间 folder keeps the buildable ticket and information counters.

import { FACILITY_OPTIONS, useStore } from '../../store.ts'
import { Block } from '../shared/Block.tsx'
import { RotateTile } from '../shared/RotateTile.tsx'

export function RoomFolder(): React.ReactElement {
  useLanguage()
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const zoneBrush = useStore((s) => s.zoneBrush)
  const st = useStore.getState
  return (
    <div className="blockGrid">
      {FACILITY_OPTIONS.filter((f) => f.id === 'ticket' || f.id === 'info').map((f) => (
        <Block
          key={f.id}
          label={translate(f.label)}
          tile={f.id}
          icon={f.icon}
          active={tool === 'zone' && zoneBrush === f.id}
          onClick={() => {
            st().setZoneBrush(f.id)
            setTool('zone')
          }}
        />
      ))}
      {tool === 'zone' && (zoneBrush === 'ticket' || zoneBrush === 'info') ? (
        <RotateTile label={msg('rotate')} onClick={() => st().rotateFacility()} />
      ) : null}
    </div>
  )
}
