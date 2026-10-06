// The 分区 folder body (§5.7 fare zones).
//
// One tile per fare zone, wearing its overlay colour — exactly what the
// rectangle drag paints. Thumbnails are the 3D palette icons rendered once per
// session and cached; the `tone` stays as the paint-time fallback.

import { useEffect, useState } from 'react'
import { useStore } from '../../store.ts'
import { getZoneThumbnails } from '../../zoneThumbnails.ts'
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

  return (
    <div className="blockGrid">
      {ZONE_LIST.map((z) => (
        <Block
          key={z.id}
          label={z.label}
          tile={z.id}
          thumb={zoneThumbs[z.id]}
          tone={`#${z.colour.toString(16).padStart(6, '0')}`}
          active={tool === 'zone' && zoneBrush === z.id}
          onClick={() => {
            st().setZoneBrush(z.id)
            setTool('zone')
          }}
        />
      ))}
    </div>
  )
}
