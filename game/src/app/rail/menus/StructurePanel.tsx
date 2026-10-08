import { useStore } from '../../store.ts'
import { trackRunLengthLabel } from '../../../sim/track.ts'
import { Block } from '../shared/Block.tsx'
import { InlinePanel } from '../shared/InlinePanel.tsx'
import { findSelectedTrack } from '../helpers.ts'
import { bridgeRailingLabel, nextBridgeRailing } from '../../../sim/structures.ts'

export function StructurePanel({ anchor }: { anchor: string }): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const moduleType = useStore((s) => s.moduleType)
  const bridgeLength = useStore((s) => s.bridgeLength)
  const cycleBridgeLength = useStore((s) => s.cycleBridgeLength)
  const bridgeRailing = useStore((s) => s.bridgeRailing)
  const selected = useStore((s) => s.selected)
  const modules = useStore((s) => s.station.modules)
  const placing = tool === 'module' && moduleType === anchor
  const selectedTrack = findSelectedTrack(selected, modules)
  const bridge = !placing && selectedTrack?.cfg.bridge ? selectedTrack : undefined
  const railing = bridge?.cfg.bridgeRailing ?? (bridge ? 'railing' : bridgeRailing)
  const cycleRailing = (): void => {
    const value = nextBridgeRailing(railing)
    const st = useStore.getState()
    if (bridge) st.updateRail(bridge.id, { bridgeRailing: value })
    else st.setStructureOptions({ bridgeRailing: value })
  }
  return <InlinePanel open={placing || bridge !== undefined}>
    <div className="blockGrid">
      {placing && <Block label={trackRunLengthLabel(bridgeLength)} icon="ortho" shortcut="Tab" onClick={cycleBridgeLength} />}
      <Block label={bridgeRailingLabel(railing)} icon={railing === 'railing' ? 'fence' : 'glass'} onClick={cycleRailing} />
    </div>
  </InlinePanel>
}
