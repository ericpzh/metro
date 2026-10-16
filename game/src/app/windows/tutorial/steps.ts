import type { MessageKey } from '../../../sim/i18n.ts'

interface TutorialStep {
  title: MessageKey
  body: MessageKey
  targets: string[]
  folders?: string[]
  closedFolders?: string[]
  keys?: string[]
  practice?: { tool: 'block' | 'delete' | 'rail'; key: string }
}

const tile = (id: string): string => `[data-tile="${id}"]`
const folder = (id: string): string => `[data-tutorial-folder="${id}"]`

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  { title: 'tutorial_move', body: 'tutorial_move_body', targets: ['.stage'], keys: ['W', 'A', 'S', 'D'] },
  { title: 'tutorial_level', body: 'tutorial_level_body', targets: ['.depthRail'], keys: ['Q', 'E', 'Ctrl+Q', 'Ctrl+E'] },
  { title: 'tutorial_zoom', body: 'tutorial_zoom_body', targets: ['.stage'] },
  { title: 'tutorial_orbit', body: 'tutorial_orbit_body', targets: ['.viewCube'] },
  { title: 'tutorial_inspector', body: 'tutorial_inspector_body', targets: ['#rightMenu'] },
  { title: 'tutorial_ground', body: 'tutorial_ground_body', targets: ['[data-tutorial="hide-ground"]'], folders: ['view'] },
  { title: 'tutorial_line', body: 'tutorial_line_body', targets: ['[data-tutorial="new-line"]'], folders: ['lines'] },
  { title: 'tutorial_palette', body: 'tutorial_palette_body', targets: ['#leftMenu'] },
  { title: 'tutorial_blocks', body: 'tutorial_blocks_body', targets: [tile('block')], folders: ['rail'], keys: ['F'], practice: { tool: 'block', key: 'f' } },
  { title: 'tutorial_delete', body: 'tutorial_delete_body', targets: ['[data-tutorial="delete-tool"]', '[aria-keyshortcuts="Control+Z"]', '[aria-keyshortcuts="Control+Y"]'], folders: ['tools'], keys: ['B', 'Ctrl+Z', 'Ctrl+Shift+Z'], practice: { tool: 'delete', key: 'b' } },
  { title: 'tutorial_platform', body: 'tutorial_platform_body', targets: [tile('__platform')], folders: ['rail'], keys: ['L', 'R'], practice: { tool: 'rail', key: 'l' } },
  { title: 'tutorial_extend', body: 'tutorial_extend_body', targets: [tile('__tunnel'), tile('bridge')], folders: ['rail'] },
  { title: 'tutorial_equipment', body: 'tutorial_equipment_body', targets: [folder('equipment'), folder('decorCeiling'), folder('decorWall'), folder('decorFloor'), folder('decorOutside')], closedFolders: ['equipment', 'decorCeiling', 'decorWall', 'decorFloor', 'decorOutside'] },
  { title: 'tutorial_paint', body: 'tutorial_paint_body', targets: [folder('surfaces')], keys: ['Tab'] },
  { title: 'tutorial_save', body: 'tutorial_save_body', targets: ['.stationName', '[aria-keyshortcuts="Control+S"]', '[aria-keyshortcuts="Control+L"]'], keys: ['Ctrl+S', 'Ctrl+L'] },
  { title: 'tutorial_simulate', body: 'tutorial_simulate_body', targets: ['.topbar .seg'], keys: ['Space'] },
  { title: 'tutorial_examples', body: 'tutorial_examples_body', targets: ['[data-tutorial="examples"]'] },
  { title: 'tutorial_gpu', body: 'tutorial_gpu_body', targets: ['.stage'] },
]

export const TUTORIAL_STORAGE_KEY = 'metro-game.tutorial.v1'
export interface TutorialPreference { step: number; hidden: boolean }

export function readTutorialPreference(storage: Pick<Storage, 'getItem'>): TutorialPreference {
  try {
    const value = JSON.parse(storage.getItem(TUTORIAL_STORAGE_KEY) ?? 'null')
    return {
      step: Number.isInteger(value?.step) && value.step >= 0 && value.step < TUTORIAL_STEPS.length ? value.step : 0,
      hidden: value?.hidden === true,
    }
  } catch { return { step: 0, hidden: false } }
}

export function writeTutorialPreference(storage: Pick<Storage, 'setItem'>, value: TutorialPreference): void {
  try { storage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(value)) } catch { /* Storage can be unavailable. */ }
}
