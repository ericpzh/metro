import { writeFileSync } from 'node:fs'
import { ensureSignLayouts } from '../../game/src/build/model/Equipment.ts'
const sign={id:'test-sign',type:'sign',x:0,y:0,z:0,cfg:{mount:'wall',front:[
 {id:'same',kind:'text',text:'天河\nTianhe',x:0,y:4,scale:1.1,side:'front'},
 {id:'same',kind:'arrow',arrow:'uturn-left',x:0,y:2,scale:3,side:'back'},
 {id:'',kind:'icon',icon:'exit',x:0,y:2,scale:.2,side:'both'}],back:[]}}
const doc={static:{cells:[],modules:[sign],lines:[]}}
const expected=ensureSignLayouts([sign],{lines:[]})
const base='unity/Assets/StationDesigner/Tests/EditMode/'
writeFileSync(base+'sign-normalization-input.json',JSON.stringify(doc)+'\n')
writeFileSync(base+'sign-normalization-expected.json',JSON.stringify(expected)+'\n')
