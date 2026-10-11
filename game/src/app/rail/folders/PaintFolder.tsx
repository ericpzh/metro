import { msg, translate } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
import { useEffect } from 'react'
import { useStore } from '../../store.ts'
import { finishPaletteGroups, customFinishId, finishBaseId, finishTint } from '../../../sim/finishes.ts'
import { Block } from '../shared/Block.tsx'
import { ColourTile, hexColour } from '../shared/ColourTile.tsx'
import { InlineExpand, interleaveRows } from '../shared/InlinePanel.tsx'
import type { SubMenuKey } from '../helpers.ts'

// Material categories are shared with the capture pass. Choosing a finish or a
// custom colour preserves the folder's 单块 / 整面 brush setting (§4.3).
export function PaintFolder({ subMenu, onToggleSubMenu }: { subMenu: SubMenuKey | null; onToggleSubMenu: (k: SubMenuKey) => void }): React.ReactElement {
  useLanguage()
  const tool = useStore((s) => s.tool)
  const paintMode = useStore((s) => s.paintMode)
  const paintFinish = useStore((s) => s.paintFinish)
  const enamelColour = useStore((s) => s.enamelColour)
  const plasterColour = useStore((s) => s.plasterColour)
  const st = useStore.getState
  const colourFor = (id: string): number => id === 'wall.enamel' ? enamelColour : plasterColour
  const menuFor = (id: string): 'enamel' | 'plaster' | null => id === 'wall.enamel' ? 'enamel' : id === 'wall.plaster' ? 'plaster' : null
  const changeColour = (id: string, colour: number): void => {
    if (id === 'wall.enamel') st().setEnamelColour(colour)
    else st().setPlasterColour(colour)
    st().selectPaintFinish(customFinishId(id, colour))
  }
  // Eyedropping keeps each colour picker in step with the sampled finish.
  useEffect(() => {
    const tint = finishTint(paintFinish)
    if (tint === null) return
    const base = finishBaseId(paintFinish)
    if (base === 'wall.enamel') st().setEnamelColour(tint)
    if (base === 'wall.plaster') st().setPlasterColour(tint)
  }, [paintFinish])

  return (
    <>
      <div className="blockGrid">
        {([
          { id: 'single', label: msg('single_block'), icon: 'single', shortcut: 'N' },
          { id: 'surface', label: msg('whole_face'), icon: 'surface', shortcut: undefined },
        ] as const).map((m) => (
          <Block key={m.id} label={translate(m.label)} icon={m.icon} shortcut={m.shortcut}
            active={tool === 'paint' && paintMode === m.id}
            onClick={() => { st().setTool('paint'); st().setPaintMode(m.id) }} />
        ))}
      </div>
      {finishPaletteGroups().map(({ fam, label, items }) => (
        <div className="bpSub" key={fam}>
          <div className="bpSubTitle">{translate(label)}</div>
          <div className="blockGrid">
            {interleaveRows(items.map((f) => {
              const menu = menuFor(f.id)
              return {
                anchor: f.id,
                node: (
                  <Block key={f.id} label={translate(f.label)} tile={f.id}
                    tone={hexColour(menu ? colourFor(f.id) : f.tint)}
                    active={tool === 'paint' && finishBaseId(paintFinish) === f.id}
                    submenu={menu ? subMenu === menu : undefined}
                    onClick={() => {
                      st().selectPaintFinish(menu ? customFinishId(f.id, colourFor(f.id)) : f.id)
                      if (menu) onToggleSubMenu(menu)
                    }} />
                ),
              }
            }), (anchor) => {
              const menu = menuFor(anchor)
              return menu ? [
                <InlineExpand key={`${menu}-picker`} open={subMenu === menu}>
                  <ColourTile colour={colourFor(anchor)} onChange={(colour) => changeColour(anchor, colour)} />
                </InlineExpand>,
              ] : []
            })}
          </div>
        </div>
      ))}
    </>
  )
}
