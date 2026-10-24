// Compile the real atlas and verify its retained GPU pixels, gutters and restore.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { build } from '../game/node_modules/vite/dist/node/index.js'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const root = resolve('.preview/perf/panel-atlas')
mkdirSync(root, { recursive: true })
const modulePath = path => JSON.stringify(resolve(path).replaceAll('\\', '/'))
writeFileSync(resolve(root, 'fixture.js'), `
import * as THREE from ${modulePath('game/node_modules/three/build/three.module.js')};
import { PanelAtlas } from ${modulePath('game/src/render/panelAtlas.ts')};
window.check = async () => {
  const renderer = new THREE.WebGLRenderer(), atlas = new PanelAtlas(128);
  const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 16;
  const g = canvas.getContext('2d', {willReadFrequently:true});
  const paint = (top, bottom) => { g.fillStyle=top; g.fillRect(0,0,32,8); g.fillStyle=bottom; g.fillRect(0,8,32,8); };
  paint('#ff0000','#0000ff');
  const source = new THREE.CanvasTexture(canvas); source.colorSpace=THREE.SRGBColorSpace; source.userData.livePanel=true;
  const material = new THREE.MeshBasicMaterial({map:source}), region = atlas.resolve(material), texture=region.material.map;
  const gl=renderer.getContext();
  const read = () => {
    renderer.initTexture(texture);
    const f=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,renderer.properties.get(texture).__webglTexture,0);
    const pixels=new Uint8Array(128*128*4); gl.readPixels(0,0,128,128,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.deleteFramebuffer(f); renderer.resetState();
    return pixels;
  };
  const x=Math.round(region.u*128), y=Math.round(region.v*128);
  const pixel=(data,dx,dy)=>Array.from(data.slice(((y+dy)*128+x+dx)*4,((y+dy)*128+x+dx)*4+4));
  const before=read();
  const uploads=[], copy=renderer.copyTextureToTexture.bind(renderer);
  renderer.copyTextureToTexture=(src,...args)=>{ uploads.push(src.image.width*src.image.height*4); return copy(src,...args); };
  paint('#00ff00','#ffff00'); source.needsUpdate=true; atlas.update(renderer);
  const after=read(), restoredCPU=Array.from(texture.image.data);
  // A fresh WebGL allocation exercises the retained CPU image used after loss.
  texture.dispose(); texture.needsUpdate=true; const restored=read();
  const result={ before:[pixel(before,0,0),pixel(before,0,15),pixel(before,-2,-2),pixel(before,33,17)],
    after:[pixel(after,0,0),pixel(after,0,15),pixel(after,-2,-2),pixel(after,33,17)],
    restoredEqual:after.every((v,i)=>v===restored[i]), cpuEqual:after.every((v,i)=>v===restoredCPU[i]), uploads, glError:gl.getError() };
  atlas.dispose(); source.dispose(); material.dispose(); renderer.dispose(); return result;
};`)
writeFileSync(resolve(root, 'index.html'), '<script type="module" src="./dist/check.js"></script>')
await build({ configFile: false, logLevel: 'error', build: {
  lib: { entry: resolve(root, 'fixture.js'), formats: ['es'], fileName: () => 'check.js' },
  outDir: resolve(root, 'dist'), emptyOutDir: true,
} })
const server = await serveDir(root, 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`, profile: resolve(root, `chrome-${process.pid}`),
    debugPort: 9700 + process.pid % 100, softwareGpu: false })
  await waitFor(page.evaluate, '!!window.check', { what: 'atlas fixture' })
  const result = await page.evaluate('window.check()')
  writeFileSync(resolve(root, 'report.json'), JSON.stringify(result, null, 2))
  assert.deepEqual(result.before, [[0,0,255,255],[255,0,0,255],[0,0,255,255],[255,0,0,255]])
  assert.deepEqual(result.after, [[255,255,0,255],[0,255,0,255],[255,255,0,255],[0,255,0,255]])
  assert.equal(result.restoredEqual, true)
  assert.equal(result.cpuEqual, true)
  assert.deepEqual(result.uploads, [36*20*4])
  assert.equal(result.glError, 0)
  console.log(JSON.stringify(result))
} finally { await page?.close(); server.close() }
