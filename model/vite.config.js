import {defineConfig} from 'vite';
export default defineConfig({
 base:'./',
 // A batch export should not repeatedly reload clients while large GLBs are
 // streaming. Controls load the current asset; refresh after a regeneration.
 server:{host:'127.0.0.1',port:5175,strictPort:true,watch:{ignored:['**/public/models/**']}},
 preview:{host:'127.0.0.1',port:4175,strictPort:true},
 build:{outDir:'dist',assetsInlineLimit:0,target:'es2022'},
});
