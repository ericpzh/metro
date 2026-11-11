import {writeFileSync} from 'node:fs'
import {referenceStation} from '../../game/src/data/reference-station.ts'
import {toState} from '../../game/src/build/model.ts'
import {serialize} from '../../game/src/persistence/save.ts'
const state=toState(referenceStation('zoo'))
writeFileSync('.preview/unity/zoo-v1.metro.json',serialize(state,new Date('2020-01-02T03:04:05Z')))
console.log(JSON.stringify({cells:state.cells.length,modules:state.modules.length,lines:state.lines.length}))
