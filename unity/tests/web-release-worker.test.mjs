import {test} from 'node:test'
import assert from 'node:assert/strict'
import worker from '../../tools/unity-web/release-worker.mjs'
const id='a'.repeat(40)+'-'+'b'.repeat(16)
const shell='<html lang="__METRO_LOCALE__"><script>window.metroLaunch=__METRO_CONFIG__</script><a href="__METRO_ASSET_BASE__/Build/game.wasm.br">x</a></html>'
const manifest={releaseId:id,files:[{path:'Build/game.wasm.br',bytes:4,contentType:'application/wasm',compression:'br'}]}
function env(mount='/game'){return {METRO_MOUNT:mount,ASSETS:{async fetch(request){const p=new URL(request.url).pathname;if(p==='/_unity-shell/manifest.json')return Response.json(manifest);if(p==='/_unity-shell/index.html')return new Response(shell);if(p===`/_unity/${id}/Build/game.wasm.br`)return new Response(new Uint8Array([1,2,3,4]));return new Response('',{status:404})}}}}
const req=path=>new Request('http://localhost'+path)
test('Worker routes only named locales and manifest assets',async()=>{
 const doc=await worker.fetch(req('/game/en/tianhe'),env());assert.equal(doc.status,200);const text=await doc.text();assert.match(text,/lang="en"/);assert.match(text,/"demoId":"tianhe"/);assert.match(text,new RegExp(id))
 const asset=await worker.fetch(req(`/game/_unity/${id}/Build/game.wasm.br`),env());assert.equal(asset.status,200);assert.equal(asset.headers.get('content-type'),'application/wasm');assert.equal(asset.headers.get('content-encoding'),'br')
 const missing=await worker.fetch(req(`/game/_unity/${id}/Build/missing`),env());assert.equal(missing.status,404)
 const unknown=await worker.fetch(req('/game/unknown'),env());assert.equal(unknown.status,404)
 const redirect=await worker.fetch(req('/game/en/tianhe/?foo=1'),env());assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),'http://localhost/game/en/tianhe?foo=1')
})
test('Worker supports root mount and HEAD',async()=>{
 const doc=await worker.fetch(new Request('http://localhost/en/',{method:'HEAD'}),env(''));assert.equal(doc.status,200);assert.equal(await doc.text(),'')
 const head=await worker.fetch(new Request(`http://localhost/_unity/${id}/Build/game.wasm.br`,{method:'HEAD'}),env(''));assert.equal(head.status,200);assert.equal(await head.text(),'')
 const method=await worker.fetch(new Request('http://localhost/',{method:'POST'}),env(''));assert.equal(method.status,405)
})
