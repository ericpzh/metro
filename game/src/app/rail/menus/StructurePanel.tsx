import { useStore } from '../../store.ts'
import { trackRunLengthLabel } from '../../../sim/track.ts'
import { Block } from '../shared/Block.tsx'
import { InlinePanel } from '../shared/InlinePanel.tsx'

export function StructurePanel({ anchor }: { anchor: string }): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const moduleType = useStore((s) => s.moduleType)
  const bridgeLength = useStore((s) => s.bridgeLength)
  const cycleBridgeLength = useStore((s) => s.cycleBridgeLength)
  return <InlinePanel open={tool === 'module' && moduleType === anchor}>
    <div className="blockGrid">
      <Block label={trackRunLengthLabel(bridgeLength)} icon="ortho" shortcut="Tab" onClick={cycleBridgeLength} />
    </div>
  </InlinePanel>
}
