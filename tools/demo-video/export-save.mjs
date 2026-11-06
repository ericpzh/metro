import {resolve} from 'node:path'
import {validateAuthoredReplay} from './authored-layout.mjs'
import {exportDemoSave} from './save.mjs'
const output=resolve(process.argv[2]??'.preview/demo-video/zh-studio-2k-v6')
console.log(JSON.stringify(exportDemoSave(validateAuthoredReplay().state,output),null,2))
