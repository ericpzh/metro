import type { StationState } from './State.ts'
import type { Road } from '../../sim/roads.ts'
import { getRoadDocument, roadSegmentAt, type RoadPosition } from '../../sim/roadDocument.ts'

/** One undoable edit materialises segment splits, including legacy road strokes. */
export function addRoadSegment(state:StationState,road:Road):StationState {
  return {...state,modules:getRoadDocument([...state.modules,road]).modules}
}
export function removeRoadSegment(state:StationState,point:RoadPosition,z:number,sourceId?:string):StationState {
  const graph=getRoadDocument(state.modules),segment=roadSegmentAt(graph,point,z,sourceId)
  if(!segment)return state
  return {...state,modules:graph.modules.filter(m=>m.id!==segment.road.id)}
}
