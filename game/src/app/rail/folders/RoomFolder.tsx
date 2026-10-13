import { msg, translate } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
// The 房间 folder body (§5.6 facility rooms).
//
// One tile per FacilityBrush. The tile shows the room's **type** — store,
// ticket desk, office, washroom — not a colour chip: which of the four a drag
// will build has to be legible at a glance, and the colour only ever said
// "purple" or "teal".

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
          // The tile shows the room's **type** — store, ticket desk, office,
          // washroom — not a colour chip: which of the four a drag will build
          // has to be legible at a glance, and the colour only ever said
          // "purple" or "teal".
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
