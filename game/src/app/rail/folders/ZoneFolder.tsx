// The 分区 folder body (§5.7 fare zones).
//
// One tile per zone, in `ZONE_LIST`'s own order. A fare zone wears its overlay
// colour — exactly what the rectangle drag paints — while **无分区** has no slab to
// draw: that tile *is* the brush that takes a label off (`isEraseBrush`,
// `app/store/catalog.ts`), the way back to the state an unpainted cell is in, so
// it wears the eraser line icon instead. Thumbnails are the 3D palette icons
// rendered once per session and cached; the `tone` stays as the paint-time
// fallback.

import { useEffect, useState } from 'react'
import { useStore } from '../../store.ts'
import { getZoneThumbnails } from '../../zoneThumbnails.ts'
import { DEFAULT_ZONE, type Zone } from '../../../sim/types.ts'
import { ZONE_LIST } from '../../../sim/zones.ts'
import { Block } from '../shared/Block.tsx'

export function ZoneFolder(): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const zoneBrush = useStore((s) => s.zoneBrush)
  const [zoneThumbs, setZoneThumbs] = useState<Record<string, string>>({})
  const st = useStore.getState

  useEffect(() => {
    let alive = true
    void getZoneThumbnails().then((t) => {
      if (alive) setZoneThumbs(t)
    })
    return () => {
      alive = false
    }
  }, [])

  const arm = (id: Zone): void => {
    st().setZoneBrush(id)
    setTool('zone')
  }

  return (
    <div className="blockGrid">
      {ZONE_LIST.map((z) =>
        z.id === DEFAULT_ZONE ? (
          // 无分区: the tile that erases. There is no zone to render, and the tile
          // has to say "no zone" at 1 cm — a dashed zone outline with a rubber over
          // it (`Icon`'s `zoneErase`).
          <Block
            key={z.id}
            label={z.label}
            tile={z.id}
            icon="zoneErase"
            active={tool === 'zone' && zoneBrush === z.id}
            onClick={() => arm(z.id)}
          />
        ) : (
          <Block
            key={z.id}
            label={z.label}
            tile={z.id}
            thumb={zoneThumbs[z.id]}
            tone={`#${z.colour.toString(16).padStart(6, '0')}`}
            active={tool === 'zone' && zoneBrush === z.id}
            onClick={() => arm(z.id)}
          />
        ),
      )}
    </div>
  )
}
