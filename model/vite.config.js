import {defineConfig} from 'vite';
export default defineConfig({
 base:'./',
 server:{host:'127.0.0.1',port:5175,strictPort:true},
 preview:{host:'127.0.0.1',port:4175,strictPort:true},
 build:{outDir:'dist',assetsInlineLimit:0,target:'es2022'},
});
