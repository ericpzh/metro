// Prepare browser-sized assets from the approved artwork without redrawing it.
// Run from the repository root: node tools/prepare-brand-icon.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveDir, withPage } from './browser-harness.mjs'

const source = readFileSync('design/icon/station-designer-blue-bold.png')
const dataUrl = `data:image/png;base64,${source.toString('base64')}`
// The native SVG filter turns the dark background into alpha and keeps the
// approved white silhouette, including antialiased edges, for CSS recolouring.
const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><filter id="ink" color-interpolation-filters="sRGB"><feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 .3876 .3876 .3876 0 -.1395"/></filter></defs><image width="512" height="512" href="${dataUrl}" filter="url(#ink)"/></svg>`
const server = await serveDir('.', 4198)
let session
try {
  session = await withPage({ url: 'http://127.0.0.1:4198/web/index.html', profile: resolve('.preview/.chrome-brand-assets'), debugPort: 9348 })
  const variants = [
    ['station-designer-mark.png', 512, `data:image/svg+xml;base64,${Buffer.from(maskSvg).toString('base64')}`],
    ['favicon.png', 64, dataUrl],
    ['apple-touch-icon.png', 180, dataUrl],
  ]
  for (const [name, size, url] of variants) {
    const pixels = await session.evaluate(`(async () => {
      const image = new Image(); image.src = ${JSON.stringify(url)}; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = ${size};
      const context = canvas.getContext('2d'); context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, ${size}, ${size});
      return canvas.toDataURL(${JSON.stringify(name.endsWith('.webp') ? 'image/webp' : 'image/png')}, 0.95).split(',')[1];
    })()`)
    for (const app of name.startsWith('station-designer-') ? ['web'] : ['web', 'game']) {
      const directory = `${app}/src/assets/brand`
      mkdirSync(directory, { recursive: true })
      writeFileSync(`${directory}/${name}`, Buffer.from(pixels, 'base64'))
      console.log(`${directory}/${name}`)
    }
  }
} finally {
  if (session) await session.close()
  server.close()
}
