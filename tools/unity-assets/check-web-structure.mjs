import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the generated structure family. The review scene is a
// compact two-row table framed by the manifest's own camera: the floor slab with
// its stair opening, the wall with a door and a window, the raised ceiling slab
// with its cutaway, the finished slab with a painted column, the sloped ground
// cut under a 30 degree run, and the stainless seam between two flush runs.
//
// Each prefab's projected box is the band; inside it the check counts model and
// holes (the slate clear visible through an opening), warm granite, white
// plaster, the enamel paint and the ramp's rising top edge. It also verifies the
// ramp band's silhouette climbs across the run, which a flat slab cannot do.
const proof = resolve(process.argv[2])
const manifest = JSON.parse(await readFile(join(proof, 'export', 'manifest.json'), 'utf8'))
const layout = manifest.parameters.layout
const assets = manifest.assets
const server = await serveDir(join(proof, 'web'), 0)
const debugPort = 9700 + (process.pid % 200)
const ids = assets.map(asset => asset.id)
let page
try {
  page = await withPage({
    url: `http://127.0.0.1:${server.address().port}/`,
    profile: join(proof, `chrome-structure-${process.pid}`),
    debugPort,
  })
  await waitFor(page.evaluate, `(() => {
    const bar = document.querySelector('#unity-loading-container');
    const canvas = document.querySelector('#unity-canvas');
    return bar?.style.display === 'none' && canvas?.width > 0;
  })()`, { what: 'Unity Web structure review build' })

  let data, pixels
  await waitFor(async () => {
    ({ data } = await page.send('Page.captureScreenshot', { format: 'png' }))
    pixels = await page.evaluate(`(async () => {
    const canvasRect = document.querySelector('#unity-canvas').getBoundingClientRect();
    const image = new Image();
    image.src = 'data:image/png;base64,${data}';
    await image.decode();
    const sample = document.createElement('canvas');
    sample.width = image.width;
    sample.height = image.height;
    const ctx = sample.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const scale = devicePixelRatio;
    const x0 = Math.max(0, Math.round(canvasRect.x * scale));
    const y0 = Math.max(0, Math.round(canvasRect.y * scale));
    const width = Math.max(1, Math.min(sample.width - x0, Math.round(canvasRect.width * scale)));
    const height = Math.max(1, Math.min(sample.height - y0, Math.round(canvasRect.height * scale)));
    const data = ctx.getImageData(x0, y0, width, height).data;

    // Rebuild the review camera exactly as ReviewStructure.cs places it.
    const camera = [${layout.cameraX}, ${layout.cameraY}, ${layout.cameraZ}];
    const target = [${layout.cameraTargetX}, ${layout.cameraTargetY}, ${layout.cameraTargetZ}];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = a => { const m = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / m, a[1] / m, a[2] / m] };
    const forward = norm(sub(target, camera));
    const right = norm(cross([0, 1, 0], forward));
    const up = cross(forward, right);
    const tanV = Math.tan(${layout.cameraFieldOfView} * Math.PI / 360);
    const tanH = tanV * (width / height);
    const project = p => {
      const v = sub(p, camera);
      const depth = dot(v, forward);
      return { x: (dot(v, right) / depth / tanH * 0.5 + 0.5) * width, y: (0.5 - dot(v, up) / depth / tanV * 0.5) * height };
    };
    const bands = ${JSON.stringify(assets.map(asset => ({ id: asset.id, layoutX: asset.layoutX, layoutY: asset.layoutY, layoutZ: asset.layoutZ, size: asset.size })))}.map(asset => {
      const corners = [];
      for (const dx of [-asset.size[0] / 2, asset.size[0] / 2])
        for (const dy of [0, asset.size[2]])
          for (const dz of [-asset.size[1] / 2, asset.size[1] / 2])
            corners.push(project([asset.layoutX + dx, asset.layoutY + dy, asset.layoutZ + dz]));
      const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
      return { id: asset.id, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    });
    const isBackground = (r, g, b) => b > r + 12 && b > g + 6 && b > 70 && b < 140 && r > 25 && r < 92 && g > 42 && g < 122;
    const tally = () => ({ model: 0, opening: 0, warm: 0, white: 0, blue: 0, dark: 0, cool: 0, top: -1, bottom: -1, tops: new Array(width).fill(-1) });
    const stats = bands.map(tally);
    const colors = new Set();
    let background = 0, model = 0;
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const i = (py * width + px) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (isBackground(r, g, b)) {
          background++;
          for (let k = 0; k < bands.length; k++) {
            const band = bands[k];
            if (px < band.x0 || px > band.x1 || py < band.y0 || py > band.y1) continue;
            stats[k].opening++;
          }
          continue;
        }
        model++;
        colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
        const warm = r > 45 && r > g + 10 && g >= b - 2;
        const white = Math.min(r, g, b) > 90 && Math.max(r, g, b) - Math.min(r, g, b) < 30;
        const blue = b > 60 && b > r + 25 && b > g + 12;
        const dark = Math.max(r, g, b) < 50;
        for (let k = 0; k < bands.length; k++) {
          const band = bands[k];
          if (px < band.x0 || px > band.x1 || py < band.y0 || py > band.y1) continue;
          const s = stats[k];
          s.model++;
          if (warm) s.warm++; else if (white) s.white++; else if (blue) s.blue++; else s.cool++;
          if (dark) s.dark++;
          if (s.top < 0) s.top = py;
          if (py > s.bottom) s.bottom = py;
          if (s.tops[px] < 0) s.tops[px] = py;
        }
      }
    }
    for (const s of stats) {
      const tops = s.tops.filter(value => value >= 0);
      s.height = tops.length ? Math.max(...tops) - Math.min(...tops) : 0;
      delete s.tops;
    }
    return {
      width, height, background, model, uniqueColors: colors.size,
      bands: bands.map(band => ({ id: band.id, width: band.x1 - band.x0, height: band.y1 - band.y0 })),
      stats,
    };
    })()`)
    // Every case must be on screen with its holes and finish colours. The
    // numbers are deliberately loose halves of the measured preview.
    const byId = Object.fromEntries(pixels.stats.map((s, i) => [ids[i], s]))
    const bandById = Object.fromEntries(pixels.bands.map(b => [b.id, b]))
    const allPresent = ids.every(id => byId[id]?.model > 0)
    const floor = byId['structure-floor'], wall = byId['structure-wall'], ceiling = byId['structure-ceiling']
    const finishes = byId['structure-finishes'], ramp = byId['ramp-surface'], join = byId['ramp-join']
    return allPresent && pixels.background > pixels.width * pixels.height * 0.4 &&
      pixels.uniqueColors > 10 &&
      floor.model > 6000 && floor.opening > 1000 && floor.warm > 3000 &&
      wall.model > 6000 && wall.opening > 1500 && wall.white > 4000 &&
      ceiling.model > 2500 && ceiling.opening > 500 &&
      finishes.model > 2000 && finishes.blue > 250 && finishes.warm > 250 &&
      ramp.model > 4000 && ramp.warm > 600 && ramp.height > bandById['ramp-surface'].height * 0.2 &&
      join.model > 200
  }, '', { tries: 80, every: 500, what: 'structure pixels after the Unity splash' }).finally(async () => {
    if (data) await writeFile(join(proof, 'structure-web.png'), Buffer.from(data, 'base64'))
    if (pixels) await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(pixels, null, 2) + '\n')
  })

  const byId = Object.fromEntries(pixels.stats.map((s, i) => [ids[i], s]))
  const bandById = Object.fromEntries(pixels.bands.map(b => [b.id, b]))
  console.log('bands', JSON.stringify(pixels.bands))
  console.log('stats', JSON.stringify(pixels.stats))
  assert.ok(pixels.background > pixels.width * pixels.height * 0.4,
    `Review scene background missing: ${pixels.background}/${pixels.width * pixels.height}`)
  assert.ok(pixels.uniqueColors > 10, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
  assert.ok(byId['structure-floor'].model > 6000, `Floor slab missing: ${byId['structure-floor'].model} pixels`)
  assert.ok(byId['structure-floor'].opening > 1000, `Floor opening missing: ${byId['structure-floor'].opening} background pixels`)
  assert.ok(byId['structure-floor'].warm > 3000, `Floor granite top missing: ${byId['structure-floor'].warm} warm pixels`)
  assert.ok(byId['structure-wall'].model > 6000, `Wall missing: ${byId['structure-wall'].model} pixels`)
  assert.ok(byId['structure-wall'].opening > 1500, `Wall door/window opening missing: ${byId['structure-wall'].opening} background pixels`)
  assert.ok(byId['structure-wall'].white > 4000, `Wall plaster face missing: ${byId['structure-wall'].white} white pixels`)
  assert.ok(byId['structure-ceiling'].model > 2500, `Ceiling slab missing: ${byId['structure-ceiling'].model} pixels`)
  assert.ok(byId['structure-ceiling'].opening > 500, `Ceiling cutaway missing: ${byId['structure-ceiling'].opening} background pixels`)
  assert.ok(byId['structure-finishes'].model > 2000, `Finished slab missing: ${byId['structure-finishes'].model} pixels`)
  assert.ok(byId['structure-finishes'].blue > 250, `Enamel face missing: ${byId['structure-finishes'].blue} blue pixels`)
  assert.ok(byId['structure-finishes'].warm > 250, `Granite face missing: ${byId['structure-finishes'].warm} warm pixels`)
  assert.ok(byId['ramp-surface'].model > 4000, `Ramp surface missing: ${byId['ramp-surface'].model} pixels`)
  assert.ok(byId['ramp-surface'].warm > 600, `Sloped granite cap missing: ${byId['ramp-surface'].warm} warm pixels`)
  assert.ok(byId['ramp-surface'].height > bandById['ramp-surface'].height * 0.2,
    `Ramp band does not climb: top edge spread ${byId['ramp-surface'].height.toFixed(1)} of ${bandById['ramp-surface'].height.toFixed(1)} px`)
  assert.ok(byId['ramp-join'].model > 200, `Ramp seam missing: ${byId['ramp-join'].model} pixels`)
  console.log(`Unity Web rendered the six structure cases (background ${Math.round(100 * pixels.background / (pixels.width * pixels.height))}%, ` +
    `${pixels.uniqueColors} colours; floor ${byId['structure-floor'].warm} warm/${byId['structure-floor'].opening} hole, ` +
    `wall ${byId['structure-wall'].white} white/${byId['structure-wall'].opening} hole, ceiling ${byId['structure-ceiling'].opening} hole, ` +
    `finishes ${byId['structure-finishes'].blue} enamel, ramp ${byId['ramp-surface'].warm} warm/${byId['ramp-surface'].height.toFixed(0)}px climb, ` +
    `seam ${byId['ramp-join'].model}px). See structure-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
}
