import {build} from '../../game/node_modules/vite/dist/node/index.js'
import {copyFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
const root=resolve('game'),outDir=resolve('.preview/unity/tianhe-ts-build')
await build({configFile:false,root,base:'./',build:{outDir,emptyOutDir:true,target:'es2022',rollupOptions:{input:resolve(root,'tianhe-gate-proof.html')}}})
copyFileSync(resolve('.preview/unity/feasibility/graph.bytes'),join(outDir,'tianhe-graph.bytes'))
