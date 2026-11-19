import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
 base:'./',
 resolve:{dedupe:['three']},
 server:{host:'127.0.0.1',port:5175,strictPort:true,fs:{allow:[fileURLToPath(new URL('..',import.meta.url))]}},
 preview:{host:'127.0.0.1',port:4175,strictPort:true},
 build:{outDir:'dist',assetsInlineLimit:0,target:'es2022',rollupOptions:{input:{sounds:'sounds.html',softHuman:'soft-human.html'}}},
});
