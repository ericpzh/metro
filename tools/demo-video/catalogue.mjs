import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {MODULE_OPTIONS} from '../../game/src/app/store/catalog.ts'
import {getLanguage,setLanguage,translate} from '../../game/src/sim/i18n.ts'

// Use the measured High-geometry inventory to order the showcase, not a guessed
// complexity score. This is an editorial selection, not a new performance test.
export const inventorySource='.agents/skills/metro-repo/references/performance.md'
const reference=readFileSync(resolve(inventorySource),'utf8')
const start=reference.indexOf('| Equipment / decor model name |')
const table=reference.slice(start,reference.indexOf('\n\n',start))
const counts=new Map([...table.matchAll(/^\| ([\w-]+) \| (\d+) \| (\d+) \|/gm)].map(m=>[m[1],{low:Number(m[2]),high:Number(m[3])}]))
const selection=['tree','shelf-cooler','shelf-cooler-dark','shelf-white-tall','shelf-dark-tall','urinal','shelf-wire','cubicle','cctv-dome','walkway','cctv-post','sink','cctv-ptz','shelf-white-short','escalator','cubicle-toilet','ac-unit','stair-leftForward','stair-rightForward','stair-left180','stair-right180','stair-centerForward','stair-left90','stair-right90','clock','stair-straight','cctv','lift','electrical-cabinet','extinguisher-glass','exit-covered-1','exit-covered-3','roof-canopy','tactile-warning','fence-iron','checkout','gate-new','vending','tvm','busstop-long']
export const decorCatalogue=selection.map(catalogueId=>{
 const option=MODULE_OPTIONS.find(m=>m.id===catalogueId),geometry=counts.get(catalogueId)
 if(!option||!geometry)throw Error(`Missing catalogue/inventory entry: ${catalogueId}`)
 return {catalogueId,focusType:option.type,highTriangles:geometry.high,lowTriangles:geometry.low,label:option.label}
}).sort((a,b)=>b.highTriangles-a.highTriangles||selection.indexOf(a.catalogueId)-selection.indexOf(b.catalogueId))
export function catalogueLabel(item,language){
 const previous=getLanguage()
 try{setLanguage(language==='en'?'en':'zh-CN');return translate(item.label)}finally{setLanguage(previous)}
}
