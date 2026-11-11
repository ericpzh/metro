import { readFileSync, writeFileSync } from 'node:fs'
import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { parse, serialize } from '../../game/src/persistence/save.ts'
const fixture={format:'metro-save',formatVersion:1,name:'测试站 😀',nameEn:'Test',seed:42,static:{cells:[{x:-2,y:0,z:0,fill:'solid'},{x:.5,y:0,z:0,fill:'solid'}],modules:[{id:'bench',type:'bench',x:0,y:1,z:0,cfg:{}}],lines:[]}}
const source=parse(JSON.stringify(fixture)), written=readFileSync('.preview/unity/save-parity/cs-simple.json','utf8'), output=parse(written)
if (!source.ok || !output.ok) throw Error('TypeScript failed to parse source or C# output')
strictEqual(source.droppedCells,1); strictEqual(source.droppedModules,0); strictEqual(output.droppedCells,0); strictEqual(output.droppedModules,0)
deepStrictEqual(output.state,source.state)
strictEqual(JSON.parse(written).savedAt,'2020-01-02T03:04:05.000Z')
const reserialized=JSON.parse(serialize(output.state,new Date('2020-01-02T03:04:05.000Z')))
deepStrictEqual(JSON.parse(written),reserialized)
const report={status:'passed',sourceDroppedCells:source.droppedCells,sourceDroppedModules:source.droppedModules,outputDroppedCells:output.droppedCells,outputDroppedModules:output.droppedModules,cells:output.state.cells.length,modules:output.state.modules.length,timestamp:reserialized.savedAt,limitations:'C# to TS only for this small supported fixture; authored-save parity is a separate check'}
writeFileSync('.preview/unity/save-parity/subset-report.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report))

