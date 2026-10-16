// Shared builder capabilities for module transforms and variants. The rail and
// keyboard read this same ordered list, so controls, icons and shortcuts agree.
import { msg } from '../../sim/i18n.ts'
import { rampLengthLabel } from '../../sim/rampLengths.ts'
import { walkwayLengthLabel } from '../../sim/walkways.ts'
import { stairWidthLabel } from '../../sim/stairs.ts'
import { roofWidthLabel } from '../../sim/structures.ts'
import { trackRunLengthLabel } from '../../sim/track.ts'
import type { AppState } from './Store.ts'
import {
  isBenchType,
  isDoorType,
  isGateType,
  isRotatableType,
  isStairType,
  isStraightStairType,
} from './catalog.ts'

export type BuilderAttributeKind = 'rotation' | 'position' | 'width' | 'length' | 'height' | 'direction' | 'style'
export interface BuilderAttribute {
  kind: BuilderAttributeKind
  label: string
  shortcut: 'R' | 'Tab' | 'Shift+Tab' | undefined
  activate: () => void
  transform?: boolean
  visual?: 'grid-position' | 'roof-snap'
}

// Dimensions lead, followed by travel/orientation and material. This is the
// common priority used for row order and for Tab / Shift+Tab assignment.
const ATTRIBUTE_PRIORITY: Record<Exclude<BuilderAttributeKind, 'rotation'>, number> = {
  width: 10,
  length: 20,
  height: 30,
  direction: 40,
  position: 45,
  style: 50,
}

function variant(kind: Exclude<BuilderAttributeKind, 'rotation'>, label: string, activate: () => void): BuilderAttribute {
  return { kind, label, shortcut: undefined, activate }
}

/** Capabilities exposed by the armed module, in the shared priority order. */
export function moduleBuilderAttributes(type: string, s: AppState): BuilderAttribute[] {
  const attrs: BuilderAttribute[] = []
  if (isRotatableType(type) && !type.startsWith('pillar-slim')) {
    attrs.push({
      kind: 'rotation',
      label: type==='road'?msg('road_reverse'):msg('rotate_value', type === 'light-rectangular' ? (s.moduleRot % 2) * 90 : ((4 - s.moduleRot) % 4) * 90),
      shortcut: 'R',
      activate: s.rotateModule,
    })
  }
  if (type.startsWith('pillar-slim')) attrs.push({ kind: 'position', label: msg('position_value_9', s.moduleRot + 1), shortcut: 'R', activate: s.rotateModule, transform: true, visual: 'grid-position' })

  if (type === 'road') {
    attrs.push(variant('width', msg('road_width_value', s.roadWidth), s.cycleRoadWidth))
    attrs.push(variant('direction', msg(s.roadDirection === 'one-way' ? 'road_one_way' : 'road_two_way'), s.toggleRoadDirection))
  }
  if (type === 'curtain-wall') {
    attrs.push(variant('width', msg(s.curtainWidth === 1 ? 'extra_narrow' : s.curtainWidth === 2 ? 'narrow' : s.curtainWidth === 3 ? 'medium' : 'wide'), s.cycleCurtainWidth))
    attrs.push(variant('height', msg(s.curtainHeight === 2 ? 'short' : s.curtainHeight === 3 ? 'medium' : 'long'), s.cycleCurtainHeight))
  }
  if (type === 'escalator') {
    attrs.push(variant('width', msg(s.escalatorWide ? 'wide' : 'narrow'), s.toggleEscalatorWidth))
    attrs.push(variant('length', rampLengthLabel(s.rampLength), s.cycleRampLength))
    attrs.push(variant('direction', msg(s.escalatorDir), s.cycleEscalatorDir))
  }
  // The 自动步道 is the escalator's level twin: it shares the 窄/宽 width and the
  // up/down direction tabs, and carries its own three-length cycle beside them.
  if (type === 'walkway') {
    attrs.push(variant('width', msg(s.escalatorWide ? 'wide' : 'narrow'), s.toggleEscalatorWidth))
    attrs.push(variant('length', walkwayLengthLabel(s.walkwayLength), s.cycleWalkwayLength))
    attrs.push(variant('direction', msg(s.escalatorDir), s.cycleEscalatorDir))
  }
  if (type === 'hanger-roof' || type === 'hanger-post') attrs.push(variant('length', msg(s.hangerLength === 4 ? 'short' : s.hangerLength === 6 ? 'medium' : 'long'), s.cycleHangerLength))
  if (type.startsWith('pillar')) attrs.push(variant('length', msg(s.pillarLength === 2 ? 'short' : 'long'), s.togglePillarLength))
  if (type === 'light-rectangular') attrs.push({ kind: 'position', label: msg('position_value_9', s.lightPosition + 1), shortcut: undefined, activate: s.cycleLightPosition, visual: 'grid-position' })
  if (isBenchType(type)) attrs.push(variant('width', msg(type.endsWith('-2') ? 'wide' : 'narrow'), s.cycleBenchWidth))
  if (isStairType(type)) {
    attrs.push(variant(
      type === 'stair-block' ? 'height' : 'width',
      type === 'stair-block' ? msg(s.stairBlockHeight === 1 ? 'tall' : 'low') : stairWidthLabel(s.stairWidth),
      type === 'stair-block' ? () => s.setStairBlockHeight(s.stairBlockHeight === 1 ? 0.5 : 1) : s.cycleStairWidth,
    ))
    // A 单跑楼梯 climbs the same four lengths a 扶梯 does (`sim/rampLengths.ts`), so a
    // bank of the two stands flush and the seam between them fills. A turning stair
    // and a 楼梯块 have no run length of their own, so they grow no tile.
    if (isStraightStairType(type)) attrs.push(variant('length', rampLengthLabel(s.rampLength), s.cycleRampLength))
  }
  if (isDoorType(type)) attrs.push(variant('width', msg(s.doorWide ? 'wide' : 'narrow'), s.toggleDoorWidth))
  if (type === 'roof-shell' || type === 'roof-truss' || type === 'roof-tapered') attrs.push(variant('width', roofWidthLabel(s.roofWidth), s.cycleRoofWidth))
  if (type === 'roof') attrs.push({ ...variant('position', msg(s.roofPlateSnap === 'lower' ? 'roof_snap_lower' : 'roof_snap_upper'), s.cycleRoofPlateSnap), visual: 'roof-snap' })
  if (type === 'lift') attrs.push(variant('style', msg(s.liftStyle), s.cycleLiftStyle))
  if (type === 'psd-end') attrs.push(variant('height', msg(s.psdEndHeight === 'half' ? 'half_height' : 'full_height'), s.cyclePsdEndHeight))
  if (isGateType(type)) attrs.push(variant('style', msg(s.gateDoor === 'lane' ? 'doors' : 'fence'), s.cycleGateDoor))
  if (type === 'bridge') attrs.push(variant('length', trackRunLengthLabel(s.bridgeLength), s.cycleBridgeLength))

  const variants = attrs.filter((a) => a.kind !== 'rotation' && !a.transform)
    .sort((a, b) => ATTRIBUTE_PRIORITY[a.kind as keyof typeof ATTRIBUTE_PRIORITY] - ATTRIBUTE_PRIORITY[b.kind as keyof typeof ATTRIBUTE_PRIORITY])
  variants.forEach((a, i) => { a.shortcut = i === 0 ? 'Tab' : i === 1 ? 'Shift+Tab' : undefined })
  return [...attrs.filter((a) => a.kind === 'rotation' || a.transform), ...variants]
}

/** Fire the framework-owned module shortcut. Returns false when no attribute owns it. */
export function activateModuleBuilderShortcut(type: string, s: AppState, key: 'R' | 'Tab' | 'Shift+Tab'): boolean {
  const attr = moduleBuilderAttributes(type, s).find((a) => a.shortcut === key)
  if (!attr) return false
  attr.activate()
  return true
}
