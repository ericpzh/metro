import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
 base:'./',
 resolve:{dedupe:['three']},
 // A batch export should not repeatedly reload clients while large GLBs are
 // streaming. Controls load the current asset; refresh after a regeneration.
 server:{host:'127.0.0.1',port:5175,strictPort:true,fs:{allow:[fileURLToPath(new URL('..',import.meta.url))]},watch:{ignored:['**/public/models/**']}},
 preview:{host:'127.0.0.1',port:4175,strictPort:true},
 build:{outDir:'dist',assetsInlineLimit:0,target:'es2022',rollupOptions:{input:{models:'index.html',sounds:'sounds.html',candidates:'candidates.html',softHuman:'soft-human.html'}}},
});
