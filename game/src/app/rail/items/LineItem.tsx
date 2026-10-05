// One rail line row in the 轨道 folder (plan.md R3).
//
// A list file maps over items and never implements an item: the 轨道 folder
// maps `stationLines` to `LineItem`s, and all this file knows is how one row
// looks — a colour chip wearing the line id.

import { Block } from '../shared/Block.tsx'

export function LineItem({ lineId, colour, active, onSelect }: { lineId: string; colour: string; active: boolean; onSelect: () => void }): React.ReactElement {
  return (
    <Block
      label={lineId}
      tone={colour}
      active={active}
      onClick={onSelect}
    />
  )
}
