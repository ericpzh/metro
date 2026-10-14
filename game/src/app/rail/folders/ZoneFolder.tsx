import { translate } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
import { FaDoorOpen, FaTicket, FaTicketSimple, FaTrainSubway } from 'react-icons/fa6'
import { HiMiniWrenchScrewdriver } from 'react-icons/hi2'
// The 分区 folder body (§5.7 fare zones).
//
// One tile per fare zone or room label, in `ZONE_PAINT_LIST` order. Each uses its
// overlay color — exactly what the rectangle drag paints — while **无分区** has no zone
// to paint: that tile *is* the brush that takes a label off (`isEraseBrush`,
// `app/store/catalog.ts`), the way back to the state an unpainted cell is in, so
// it wears the eraser line icon instead. Area labels share the same color tiles.

import { useStore, type ZoneBrush } from '../../store.ts'
import { DEFAULT_ZONE } from '../../../sim/types.ts'
import { ZONE_PAINT_LIST } from '../../../sim/zones.ts'
import { Block } from '../shared/Block.tsx'

const ZONE_ART: Record<string, React.ReactNode> = {
  outside: <FaDoorOpen />,
  unpaid: <FaTicketSimple />,
  paid: <FaTicket />,
  platform: <FaTrainSubway />,
  restricted: <HiMiniWrenchScrewdriver />,
}

const ROOM_ICON: Record<string, string> = {
  store: 'roomStore',
  toilet: 'roomRestroom',
  office: 'roomOffice',
}

export function ZoneFolder(): React.ReactElement {
  useLanguage()
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const zoneBrush = useStore((s) => s.zoneBrush)
  const st = useStore.getState

  const arm = (id: ZoneBrush): void => {
    st().setZoneBrush(id)
    setTool('zone')
  }

  return (
    <div className="blockGrid">
      {ZONE_PAINT_LIST.map((z) =>
        z.id === DEFAULT_ZONE ? (
          // 无分区: the tile that erases. There is no zone to render, and the tile
          // has to say "no zone" at 1 cm — a dashed zone outline with a rubber over
          // it (`Icon`'s `zoneErase`).
          <Block
            key={z.id}
            label={translate(z.label)}
            tile={z.id}
            icon="zoneErase"
            active={tool === 'zone' && zoneBrush === z.id}
            onClick={() => arm(z.id)}
          />
        ) : (
          <Block
            key={z.id}
            label={translate(z.label)}
            tile={z.id}
            art={ZONE_ART[z.id]}
            icon={ROOM_ICON[z.id]}
            active={tool === 'zone' && zoneBrush === z.id}
            onClick={() => arm(z.id)}
          />
        ),
      )}
    </div>
  )
}
