import { msg, translate } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
import { useEffect } from 'react'
import { useStore } from '../../store.ts'
import { finishPaletteGroups, customFinishId, finishBaseId, finishTint } from '../../../sim/finishes.ts'
import { Block } from '../shared/Block.tsx'
import { ColourTile, NewColorTile, hexColour } from '../shared/ColourTile.tsx'
import { InlinePanel, interleaveRows } from '../shared/InlinePanel.tsx'
import type { SubMenuKey } from '../helpers.ts'
import { customPaintColoursInStation } from '../paintColours.ts'

// Material categories are shared with the capture pass. Choosing a finish or a
// custom colour preserves the brush mode; each finish tile owns its mode submenu (§4.3).
export function PaintFolder({ subMenu, onToggleSubMenu }: { subMenu: SubMenuKey | null; onToggleSubMenu: (k: SubMenuKey) => void }): React.ReactElement {
  useLanguage()
  const tool = useStore((s) => s.tool)
  const paintMode = useStore((s) => s.paintMode)
  const paintFinish = useStore((s) => s.paintFinish)
  const station = useStore((s) => s.station)
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
      {finishPaletteGroups().map(({ fam, label, items }) => (
        <div className="bpSub" key={fam}>
          <div className="bpSubTitle">{translate(label)}</div>
          <div className="blockGrid">
            {interleaveRows(items.map((f) => {
              const colourMenu = menuFor(f.id)
              const menu = `paint:${f.id}` as const
              return {
                anchor: f.id,
                node: (
                  <Block key={f.id} label={translate(f.label)} tile={f.id}
                    tone={hexColour(colourMenu ? colourFor(f.id) : f.tint)}
                    active={tool === 'paint' && finishBaseId(paintFinish) === f.id}
                    submenu={subMenu === menu}
                    onClick={() => {
                      st().selectPaintFinish(colourMenu ? customFinishId(f.id, colourFor(f.id)) : f.id)
                      onToggleSubMenu(menu)
                    }} />
                ),
              }
            }), (anchor) => {
              const colourMenu = menuFor(anchor)
              const colours = colourMenu ? customPaintColoursInStation(station, anchor) : []
              const menu = `paint:${anchor}` as const
              return [
                <InlinePanel key={`${menu}-options`} open={subMenu === menu}>
                  <div className="blockGrid">
                    {([
                      { id: 'single', label: msg('single_block'), icon: 'single' },
                      { id: 'surface', label: msg('whole_face'), icon: 'surface' },
                    ] as const).map((mode) => (
                      <Block key={mode.id} label={translate(mode.label)} icon={mode.icon} shortcut="Tab"
                        active={tool === 'paint' && paintMode === mode.id}
                        onClick={() => { st().setTool('paint'); st().setPaintMode(mode.id) }} />
                    ))}
                  </div>
                  {colours.length > 0 ? (
                    <div className="blockGrid">
                      {colours.map((colour) => (
                        <ColourTile key={colour} colour={colour} onChange={(next) => changeColour(anchor, next)} />
                      ))}
                      <NewColorTile colour={colourFor(anchor)} onChange={(colour) => changeColour(anchor, colour)} />
                    </div>
                  ) : colourMenu ? (
                    <div className="blockGrid">
                      <NewColorTile colour={colourFor(anchor)} onChange={(colour) => changeColour(anchor, colour)} />
                    </div>
                  ) : null}
                </InlinePanel>,
              ]
            })}
          </div>
        </div>
      ))}
    </>
  )
}
