// General editing controls. Structure placement lives in the 结构 folder.

import { useStore } from '../../store.ts'
import { Block } from '../shared/Block.tsx'

export function ToolsFolder(): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)

  return <div className="blockGrid">
    <Block label="选择" icon="select" shortcut="Z" active={tool === 'select'} onClick={() => setTool('select')} />
    <Block label="吸取" icon="pick" shortcut="P" active={tool === 'pick'} onClick={() => setTool('pick')} />
    <Block label="移动" icon="move" tile="move" shortcut="M" active={tool === 'move'} onClick={() => setTool('move')} />
    <Block label="删除" icon="delete" shortcut="B" active={tool === 'delete'} onClick={() => setTool('delete')} />
  </div>
}
