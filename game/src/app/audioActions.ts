export type ToolSound = 'place' | 'pick' | 'move' | 'select' | 'delete' | 'refused'
export interface SoundActionState {
  version: number; tool: string; notice: string | null; moveDraft: unknown; pickDraft: unknown
  selected: {kind:string;key:string} | null
}
/** Observe existing outcomes only: no document scan, mutation or scene query. */
export function actionSound(before: SoundActionState, after: SoundActionState, button: number, removal: boolean, announcedNotice = false): ToolSound | null {
  if(after.version!==before.version) return before.moveDraft?'move':removal||button===2||before.tool==='delete'?'delete':'place'
  if(before.moveDraft && !after.moveDraft)return null // Cancel / unchanged position.
  if(after.pickDraft!==before.pickDraft && after.pickDraft) return 'pick'
  if(!before.moveDraft && after.moveDraft) return 'pick'
  if(after.selected && (after.selected.kind!==before.selected?.kind || after.selected.key!==before.selected?.key)) return 'select'
  if(after.notice && (announcedNotice || after.notice!==before.notice) && before.tool!=='select' && before.tool!=='pick') return 'refused'
  return null
}
