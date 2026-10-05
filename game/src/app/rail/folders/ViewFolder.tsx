// The 视图 folder body (§8 view toggles).
//
// **The tile order is the menu order**, one row of the grid at a time, nearest
// the tool the player is likely to want next: the two `X` / `C` slice toggles
// first (显示其他层, 剖切), then the 隐藏 pair that takes station furniture away
// (隐藏天花板, 隐藏墙壁), then the one mode that puts the storey slice away —
// 隐藏UI (**U**, the store's `hideUI`: the station drawn whole, and the 1 m
// editing lattice and its cell cursor gone with the ghost sheet —
// `render/levelSlicing.ts`, `render/scene/systems/GridSystem.ts`) — and last the
// two overlays that paint the station rather than hide it (热力图, 分区图).
//
// The folder also carries the **剖切** surface's own controls: where the cut
// stands, which way it faces and how far it has slid. The cut itself lives in
// `render/section.ts` and `app/store.ts`'s view slice; this file is only the
// panel that writes them.

import { useEffect, useState } from 'react'
import { useStore } from '../../store.ts'
import { Block } from '../shared/Block.tsx'
import { InlinePanel } from '../shared/InlinePanel.tsx'
import {
  DEFAULT_SECTION_AZIMUTH,
  DEFAULT_SECTION_ELEVATION,
  SECTION_SNAP,
  formatSection,
  sectionNormal,
  sectionCoord,
} from '../../../render/section.ts'
import type { Section } from '../../../render/section.ts'

/** How far the cut may slide either way from where it was placed, metres. */
const SLIDE_LIMIT = 200

export function ViewFolder(): React.ReactElement {
  const ghost = useStore((s) => s.ghostOtherLevels)
  const autoCeiling = useStore((s) => s.autoCeiling)
  const cutaway = useStore((s) => s.cutaway)
  const hideWalls = useStore((s) => s.hideWalls)
  const hideUI = useStore((s) => s.hideUI)
  const overlayOn = useStore((s) => s.overlayOn)
  const zoneOverlayOn = useStore((s) => s.zoneOverlayOn)
  const section = useStore((s) => s.section)
  const st = useStore.getState
  return (
    <div className="blockGrid">
      {/* 显示其他层 / 剖切 lead: both are slice tools, and 剖切's own panel opens
          right under its tile. */}
      {/* Both slice toggles are shown but plainly out of play while 隐藏UI is on —
          it draws every storey with no ceiling lifted — so the rule is
          discoverable. */}
      <Block
        label="显示其他层"
        icon="ghost"
        shortcut="X"
        active={ghost}
        disabled={hideUI}
        onClick={() => st().setGhostOther(!ghost)}
      />
      <Block label="剖切" icon="cutaway" shortcut="C" active={cutaway} onClick={() => st().setCutaway(!cutaway)} />
      <InlinePanel open={cutaway}>
        <SectionControls section={section} />
      </InlinePanel>
      <Block
        label="隐藏天花板"
        icon="ceiling"
        shortcut="H"
        active={autoCeiling}
        disabled={hideUI}
        onClick={() => st().setAutoCeiling(!autoCeiling)}
      />
      <Block label="隐藏墙壁" icon="wall" active={hideWalls} onClick={() => st().setHideWalls(!hideWalls)} />
      <Block label="热力图" icon="heat" active={overlayOn} onClick={() => st().setOverlay(!overlayOn)} />
      <Block label="分区图" icon="zoneHeat" active={zoneOverlayOn} onClick={() => st().setZoneOverlay(!zoneOverlayOn)} />
      <Block label="隐藏UI" icon="gridOff" shortcut="U" active={hideUI} onClick={() => st().setHideUI(!hideUI)} />
    </div>
  )
}

/**
 * The 剖切 surface's controls: 位置 (the slide, typed or dragged), 方向 (its
 * azimuth and its tilt), and a 复位 that puts it back on the storey being
 * edited. The same three fields the 3D surface answers to — the drag writes
 * `offset`, **R** writes the azimuth — so the panel and the pointer are two
 * ways into one record, never two states.
 */
function SectionControls({ section }: { section: Section }): React.ReactElement {
  const setSectionOffset = useStore((s) => s.setSectionOffset)
  const setSectionOrientation = useStore((s) => s.setSectionOrientation)
  const rotateSection = useStore((s) => s.rotateSection)
  const az = Math.round(section.orientation.azimuth)
  const el = Math.round(section.orientation.elevation)
  const coord = sectionCoord(section)
  return (
    <>
      <div className="bpSubTitle">剖切面</div>
      <div className="secRow">
        <span className="secLabel">位置</span>
        <input
          type="range"
          min={-SLIDE_LIMIT}
          max={SLIDE_LIMIT}
          step={SECTION_SNAP}
          value={Math.max(-SLIDE_LIMIT, Math.min(SLIDE_LIMIT, section.offset))}
          onChange={(e) => setSectionOffset(Number(e.target.value))}
        />
        <NumberBox value={section.offset} step={SECTION_SNAP} onCommit={setSectionOffset} />
      </div>
      <div className="secRow">
        <span className="secLabel">方位角</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={5}
          value={az}
          onChange={(e) => setSectionOrientation(Number(e.target.value), section.orientation.elevation)}
        />
        <span className="secValue">{az}°</span>
      </div>
      <div className="secRow">
        <span className="secLabel">倾角</span>
        <input
          type="range"
          min={-90}
          max={90}
          step={5}
          value={el}
          onChange={(e) => setSectionOrientation(section.orientation.azimuth, Number(e.target.value))}
        />
        <span className="secValue">{el}°</span>
      </div>
      <div className="bpReadout">
        <span>剖切位置</span>
        <b>
          {coord.axis.toUpperCase()} {coord.value.toFixed(1)}
        </b>
      </div>
      <div className="hint">
        拖动高亮面沿法线移动（Shift 半米），R 旋转 15°（Shift 5°）。{formatSection(section)}
      </div>
      <div className="secRow">
        <button
          type="button"
          onClick={() => {
            setSectionOrientation(DEFAULT_SECTION_AZIMUTH, DEFAULT_SECTION_ELEVATION)
            setSectionOffset(0)
          }}
        >
          复位
        </button>
        {/* The cut keeps the half **behind** the surface, so which half survives
            is which way it looks. A 180° turn is therefore the one thing a
            player wants when the cut is on the wrong side — a wall, not an
            angle to find with the slider. */}
        <button type="button" onClick={() => rotateSection(180)}>
          翻转
        </button>
        <span className="secValue">
          {sectionNormal(section.orientation)
            .map((v) => v.toFixed(2))
            .join(', ')}
        </span>
      </div>
    </>
  )
}

/**
 * A whole-metre-or-fraction box for the slide location. The draft is local so
 * typing is never rewritten mid-keystroke; Enter and blur commit, and Escape
 * puts the field back. This is the input the spec asks for: a player who knows
 * the cut belongs at `-3.5` types it rather than nudging a slider.
 */
function NumberBox({ value, step, onCommit }: { value: number; step: number; onCommit: (v: number) => void }): React.ReactElement {
  const [draft, setDraft] = useState(value.toFixed(2))
  useEffect(() => {
    setDraft(value.toFixed(2))
  }, [value])
  const commit = (): void => {
    const n = Number(draft)
    if (Number.isFinite(n)) onCommit(n)
    else setDraft(value.toFixed(2))
  }
  return (
    <input
      className="secBox"
      type="text"
      inputMode="decimal"
      value={draft}
      step={step}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
          ;(e.target as HTMLInputElement).blur()
        } else if (e.key === 'Escape') {
          setDraft(value.toFixed(2))
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}
