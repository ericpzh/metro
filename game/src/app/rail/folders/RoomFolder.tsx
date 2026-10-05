// The 房间 folder body (§5.6 facility rooms).
//
// One tile per FacilityBrush. The tile shows the room's **type** — store,
// ticket desk, office, washroom — not a colour chip: which of the four a drag
// will build has to be legible at a glance, and the colour only ever said
// "purple" or "teal".

import { FACILITY_OPTIONS, useStore } from '../../store.ts'
import { Block } from '../shared/Block.tsx'

export function RoomFolder(): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const zoneBrush = useStore((s) => s.zoneBrush)
  const st = useStore.getState
  return (
    <div className="blockGrid">
      {FACILITY_OPTIONS.map((f) => (
        <Block
          key={f.id}
          label={f.label}
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
    </div>
  )
}
