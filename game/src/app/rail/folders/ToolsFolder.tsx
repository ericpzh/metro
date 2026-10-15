import { t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
// General editing controls. Structure placement lives in the 结构 folder.

import { useStore } from '../../store.ts'
import { Block } from '../shared/Block.tsx'

export function ToolsFolder(): React.ReactElement {
  useLanguage()
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)

  return <div className="blockGrid">
    <Block label={t('select')} icon="select" shortcut="Z" active={tool === 'select'} onClick={() => setTool('select')} />
    <Block label={t('pick')} icon="pick" shortcut="P" active={tool === 'pick'} onClick={() => setTool('pick')} />
    <Block label={t('move')} icon="move" tile="move" shortcut="M" active={tool === 'move'} onClick={() => setTool('move')} />
    <Block label={t('delete')} tutorialId="delete-tool" icon="bulldozer" shortcut="B" active={tool === 'delete'} onClick={() => setTool('delete')} />
  </div>
}
