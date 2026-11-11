import {build} from '../../game/node_modules/vite/dist/node/index.js'
import {resolve} from 'node:path'
const root=resolve('game'),outDir=resolve('.preview/unity/zoo-ts-build')
await build({configFile:false,root,base:'./',build:{outDir,emptyOutDir:true,target:'es2022',rollupOptions:{input:resolve(root,'zoo-gate-proof.html')}}})
