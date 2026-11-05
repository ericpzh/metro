import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createModule } from '../game/src/build/model.ts'
import { signBoardsOf, signBoardsPanel, signPieces, settleSignBoards } from '../game/src/sim/sign.ts'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const output = resolve('.preview/perf/sign-preview')
mkdirSync(output, { recursive: true })
const line = { id: '11', name: '11号线', colour: '#efb900', stock: 'B', cars: 6,
  power: 'third-rail', headwayProfile: { peak: 150, offpeak: 240, late: 480 },
  alightPerTrain: 420, terminus: 'through', direction: 'up', travelSign: 1, stations: [] }
const mark = (id, kind, extra) => ({ id, kind, x: 0, y: .3, scale: 1, side: 'left', ...extra })
const boards = settleSignBoards({
  front: [mark('a', 'arrow', { arrow: 'left' }), mark('l', 'line', { lineId: '11', english: true }),
    mark('t', 'text', { text: 'B.E.F' }), mark('i', 'icon', { icon: 'lift' }), mark('r', 'arrow', { arrow: 'right' })],
  back: [mark('b', 'text', { text: 'C.D' })],
})
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`,
    profile: resolve(output, `chrome-${process.pid}`), debugPort: 12000 + process.pid % 30000, softwareGpu: false })
  await waitFor(page.evaluate, '!!window.__scene && !!window.__metro?.getState().metrics')
  await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click()`)
  const results = []
  for (const type of ['sign-ceiling', 'sign-wall']) {
    const sign = createModule(type, 0, 0, 0, 'audit-sign', 0, undefined, 'up', 'right', [line], boards)
    await page.evaluate(`(() => {
      __metro.getState().closeSignEditor();
      const s = __metro.getState();
      s.commit({ ...s.station, name: 'Sign audit', cells: [
        { x: 0, y: 0, z: 0, fill: 'solid' }, { x: 0, y: 0, z: 5, fill: 'solid' },
        { x: 0, y: -1, z: 2, fill: 'solid' }], modules: [${JSON.stringify(sign)}], lines: [${JSON.stringify(line)}] });
      __metro.setState({ playing: false, activeZ: 0 });
    })()`)
    await page.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
    await page.evaluate(`__metro.getState().openSignEditor('audit-sign')`)
    await waitFor(page.evaluate, `document.querySelector('.signBoardPreview canvas')?.width > 100`)
    await page.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))')
    const printedBoards = signBoardsOf(sign.cfg, { lines: [line] })
    const panel = signBoardsPanel(printedBoards)
    const expectedTargets = [printedBoards.front, ...(type === 'sign-wall' ? [] : [printedBoards.back])].map(layout => {
      const pieces = signPieces(layout, panel)
      const left = Math.min(...pieces.map(p => p.x - p.inkW / 2))
      const right = Math.max(...pieces.map(p => p.x + p.inkW / 2))
      return pieces.map(p => ({ id: p.id, x: .5 + (p.x - (left + right) / 2) / panel.w }))
    })
    const hitTargets = await page.evaluate(`(() => {
      const expected=${JSON.stringify(expectedTargets)};
      return [...document.querySelectorAll('.signBoardPreview')].map((row,i)=>{
        const r=row.getBoundingClientRect();
        return expected[i].map(p=>({expected:p.id,actual:document.elementFromPoint(r.left+p.x*r.width,r.top+r.height/2)?.closest('[data-sign-mark]')?.dataset.signMark}));
      });
    })()`)
    assert.ok(hitTargets.flat().every(p => p.expected === p.actual), 'each printed mark must hit its own drag target')
    const rows = await page.evaluate(`(() => {
      return [...document.querySelectorAll('.signBoardPreview')].map((row, i) => {
        const canvas = row.querySelector('canvas'), g = canvas.getContext('2d');
        const pixels = g.getImageData(0, 0, canvas.width, canvas.height).data;
        let ink = 0;
        for (let k = 0; k < pixels.length; k += 4) if (pixels[k] > 160 && pixels[k + 1] > 160 && pixels[k + 2] > 160) ink++;
        const box = row.getBoundingClientRect();
        const plate = [...__scene.plates.signPlates.entries()].find(([key]) => key.startsWith('audit-sign|' + (i === 0 ? 'left' : 'right') + '|'))?.[1];
        return { matchesPlate: plate?.texture.image.toDataURL() === canvas.toDataURL(), face: i,
          width: box.width, height: box.height, textureWidth: canvas.width, textureHeight: canvas.height, ink,
          targets: [...row.querySelectorAll('.bin')].map(bin => bin.getBoundingClientRect().width) };
      });
    })()`)
    assert.equal(rows.length, type === 'sign-wall' ? 1 : 2)
    assert.ok(rows.every(r => r.matchesPlate && r.ink > 50 && r.height > 10
      && Math.abs(r.width / r.height - r.textureWidth / r.textureHeight) < .03), JSON.stringify({ type, rows }))
    const shot = await page.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(resolve(output, `${type}.png`), Buffer.from(shot.data, 'base64'))
    results.push({ type, rows })
    // Delete marks through the editor's drag-to-trash path. Shortening a
    // sign must never magnify it or push the action buttons out of the modal.
    const deletionSizes = []
    for (let remaining = printedBoards.front.length; remaining > 0; remaining--) {
      deletionSizes.push(await page.evaluate(`(() => {
        const row = document.querySelector('.signBoardPreview');
        const box = row.getBoundingClientRect();
        const bin = row.querySelector('[data-sign-mark]');
        if (row.querySelectorAll('[data-sign-mark]').length !== ${remaining}) throw new Error('deletion did not remove one mark');
        bin.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: box.left + 2, clientY: box.top + 2 }));
        return { width: box.width, height: box.height };
      })()`))
      await page.evaluate(`(() => {
        const box = document.querySelector('.signAct.trash').getBoundingClientRect();
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }));
      })()`)
      await page.evaluate('new Promise(r => requestAnimationFrame(r))')
      await page.evaluate(`window.dispatchEvent(new PointerEvent('pointerup'))`)
      await page.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
      const current = await page.evaluate('__metro.getState().currentBoards')
      const currentPanel = signBoardsPanel(current)
      const pieces = signPieces(current.front, currentPanel)
      for (let i = 1; i < pieces.length; i++) {
        assert.ok(pieces[i - 1].left + pieces[i - 1].w <= pieces[i].left + 1e-9,
          `deletion stacked ${pieces[i - 1].id} and ${pieces[i].id}`)
      }
      if (remaining > 1) assert.equal(await page.evaluate(`(() => {
        const canvas = document.querySelector('.signBoardPreview canvas');
        const plate = [...__scene.plates.signPlates.entries()].find(([key]) => key.startsWith('audit-sign|left|'))?.[1];
        return plate?.texture.image.toDataURL() === canvas.toDataURL();
      })()`), true, 'after deletion the local preview must match the settled production artwork: ' + remaining)
    }
    assert.equal(await page.evaluate(`document.querySelector('.signBoardPreview').querySelectorAll('[data-sign-mark]').length`), 0)
    assert.ok(deletionSizes.every((size, i) => size.height <= 65
      && (!i || size.height <= deletionSizes[i - 1].height + 1)
      && (!i || size.width <= deletionSizes[i - 1].width + 1)), JSON.stringify({ type, deletionSizes }))
    results.push({ type, deletionSizes })
  }
  writeFileSync(resolve(output, 'browser.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results))
} finally {
  await page?.close()
  server.close()
}
