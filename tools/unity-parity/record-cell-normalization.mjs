import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { clearContactFinishes } from '../../game/src/sim/contactFinishes.ts'
import { clearCeilingZoneLabels } from '../../game/src/build/model/Zones.ts'
const sides=['n','e','s','w']
const shapes=[[],...Array.from({length:14},(_,i)=>sides.filter((_,bit)=>((i+1)&(1<<bit))!==0).map(side=>'half-corner:'+side)),...sides.map(side=>['half-wall:'+side]),...['upper','lower'].flatMap(kind=>sides.map(side=>['tri-'+kind+':'+side]))]
const directions=[['e',1,0,0],['w',-1,0,0],['n',0,1,0],['s',0,-1,0],['top',0,0,1],['bottom',0,0,-1]]
let bits=''
for(const own of shapes)for(const other of shapes)for(const [face,x,y,z] of directions){
 const cells=[{x:0,y:0,z:0,fill:'solid',tags:own,finish:{[face]:'paint'}},{x,y,z,fill:'solid',tags:other}]
 const out=clearContactFinishes(clearCeilingZoneLabels(cells))
 bits += out[0].finish?.[face]===undefined?'0':'1'
}
const explicit=[
 [{x:0,y:0,z:0,fill:'solid',tags:['suspended-ceiling'],zone:'paid',room:'named',finish:{e:'red'}},{x:1,y:0,z:0,fill:'solid'}],
 [{x:0,y:0,z:0,fill:'solid',tags:['opening-ceiling'],zone:null,room:'R',finish:{e:'red'}},{x:1,y:0,z:0,fill:'solid'}],
 [{x:4097,y:0,z:0,fill:'solid',zone:'outside',finish:{e:'red',top:'blue'}},{x:4098,y:0,z:0,fill:'solid'}],
 [{x:0,y:0,z:0,fill:'solid',finish:{e:'red'}},{x:1,y:0,z:0,fill:'solid',tags:['suspended-ceiling']}],
]
const oracle={sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),shapes:shapes.map(s=>s.join('|')),bits,explicit:explicit.map(c=>({input:JSON.stringify(c),expected:JSON.stringify(clearContactFinishes(clearCeilingZoneLabels(c)))}))}
writeFileSync(new URL('../../unity/Assets/StationDesigner/Tests/EditMode/cell-normalization-oracle.json',import.meta.url),JSON.stringify(oracle,null,2)+'\n')
console.log(JSON.stringify({shapes:shapes.length,cases:bits.length,explicit:explicit.length,sourceSha:oracle.sourceSha}))
