// The 材质 folder body (§6 finishes).
//
// Brush modes (单块 / 整面) plus one tile per finish, grouped by family
// (地面·轨道 / 天花板 / 墙面). 搪瓷板 sits last in 墙面: it is the one tile with
// a variant sub-menu (its colour), wearing a custom colour while every other
// tile wears its fixed tint.
//
// Eyedropping moved to the 工具 folder's 吸取 (`P`): it lifts a finish off a
// bare face the same way, and a placed piece of equipment off its model.
//
// Clicking 搪瓷板 selects the brush and folds its colour-picker row out below,
// the way a variant sub-menu works. Neither it nor a plain finish tile touches
// the brush mode: the mode is the 材质 folder's own setting, so a texture
// picked here — including after a detour through another folder — leaves the
// brush in 单块 or 整面 as it was left.

import { useEffect, useMemo } from 'react'
import { useStore } from '../../store.ts'
import { FINISH_LIST, customFinishId, finishBaseId, finishLabel, finishTint } from '../../../sim/finishes.ts'
import { Block } from '../shared/Block.tsx'
import { ColourTile, hexColour } from '../shared/ColourTile.tsx'
import { InlineExpand, interleaveRows } from '../shared/InlinePanel.tsx'
import type { SubMenuKey } from '../helpers.ts'

const FAMILY_LABEL: Record<string, string> = { floor: '地面 · 轨道', ceiling: '天花板', wall: '墙面' }

export function PaintFolder({ subMenu, onToggleSubMenu }: { subMenu: SubMenuKey | null; onToggleSubMenu: (k: SubMenuKey) => void }): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const paintMode = useStore((s) => s.paintMode)
  const paintFinish = useStore((s) => s.paintFinish)
  const enamelColour = useStore((s) => s.enamelColour)
  const st = useStore.getState

  const finishFamilies = useMemo(() => {
    const order = ['floor', 'ceiling', 'wall'] as const
    return order.map((fam) => {
      const items = FINISH_LIST.filter((f) =>
        fam === 'floor' ? f.family === 'floor' || f.family === 'track' : f.family === fam,
      )
      // 搪瓷板 sits last in 墙面: it is the one tile that opens a colour sub-menu.
      if (fam === 'wall') items.sort((a, b) => Number(a.id === 'wall.enamel') - Number(b.id === 'wall.enamel'))
      return { fam, items }
    })
  }, [])

  // 搪瓷板 wears a custom colour. The tile stays in 墙面; clicking it selects the
  // brush and folds out its colour-picker row, the way a variant sub-menu works.
  // Neither it nor a plain finish tile touches the brush mode: the mode is the
  // 材质 folder's own setting, so a texture picked here — including after a detour
  // through another folder — leaves the brush in 单块 or 整面 as it was left.
  const enamelOpen = subMenu === 'enamel'
  const enamelActive = tool === 'paint' && finishBaseId(paintFinish) === 'wall.enamel'
  const selectEnamel = (colour: number = enamelColour): void => {
    st().selectPaintFinish(customFinishId('wall.enamel', colour))
  }
  const changeEnamel = (colour: number): void => {
    // The brush takes the colour straight from the picker. Reading the rendered
    // `enamelColour` here would still be the previous render's value, so the
    // brush — and the swatch, which follows the brush — lagged a step behind.
    st().setEnamelColour(colour)
    selectEnamel(colour)
  }
  // Eyedropping a custom-tinted enamel keeps the picker in step with the wall.
  useEffect(() => {
    const t = finishTint(paintFinish)
    if (t !== null && finishBaseId(paintFinish) === 'wall.enamel') st().setEnamelColour(t)
  }, [paintFinish])

  return (
    <>
      <div className="blockGrid">
        {(
          [
            { id: 'single', label: '单块', icon: 'single', shortcut: 'N' },
            { id: 'surface', label: '整面', icon: 'surface', shortcut: undefined },
          ] as const
        ).map((m) => (
          <Block
            key={m.id}
            label={m.label}
            icon={m.icon}
            shortcut={m.shortcut}
            active={tool === 'paint' && paintMode === m.id}
            onClick={() => {
              setTool('paint')
              st().setPaintMode(m.id)
            }}
          />
        ))}
      </div>
      {finishFamilies.map(({ fam, items }) => (
        <div className="bpSub" key={fam}>
          <div className="bpSubTitle">{FAMILY_LABEL[fam]}</div>
          <div className="blockGrid">
            {fam !== 'wall'
              ? items.map((f) => (
                  <Block
                    key={f.id}
                    label={finishLabel(f.id)}
                    tile={f.id}
                    tone={`#${f.tint.toString(16).padStart(6, '0')}`}
                    active={tool === 'paint' && paintFinish === f.id}
                    onClick={() => {
                      st().selectPaintFinish(f.id)
                    }}
                  />
                ))
              : interleaveRows(
                  items.map((f) => {
                    // 搪瓷板 is the one finish with a variant sub-menu: its colour.
                    const enamel = f.id === 'wall.enamel'
                    return {
                      anchor: f.id,
                      node: (
                        <Block
                          key={f.id}
                          label={finishLabel(f.id)}
                          tile={f.id}
                          tone={enamel ? hexColour(enamelColour) : `#${f.tint.toString(16).padStart(6, '0')}`}
                          active={enamel ? enamelActive : tool === 'paint' && paintFinish === f.id}
                          submenu={enamel ? enamelOpen : undefined}
                          onClick={() => {
                            if (!enamel) {
                              st().selectPaintFinish(f.id)
                              return
                            }
                            // Select the brush, then fold its colour picker out below.
                            selectEnamel()
                            onToggleSubMenu('enamel')
                          }}
                        />
                      ),
                    }
                  }),
                  (anchor) =>
                    anchor === 'wall.enamel'
                      ? [
                          <InlineExpand key="enamel-picker" open={enamelOpen}>
                            <ColourTile colour={enamelColour} onChange={changeEnamel} />
                          </InlineExpand>,
                        ]
                      : [],
                )}
          </div>
        </div>
      ))}
    </>
  )
}
