// A 薄墙角 joins the half wall already standing in the same cell.
//
// The unit suite pins the tags, the quarter mask, the meshes and the paint. This
// check drives the production build with real pointer events: hover the floor of
// a cell that already holds a north-facing 半墙, press R to turn the armed corner
// into its free south-west quarter, click, and read the document back. The
// overlapping side must box the cell red and leave it alone. A screenshot of the
// L is written for looking at.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { packKey, shapeOf } from '../game/src/sim/types.ts'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const output = resolve('.preview/wall-cuts')
mkdirSync(output, { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({
    url: `http://127.0.0.1:${server.address().port}/`,
    profile: resolve(output, `chrome-${process.pid}`),
    debugPort: 12000 + (process.pid % 30000),
    softwareGpu: false,
  })
  await waitFor(page.evaluate, '!!window.__scene && !!window.__metro?.getState().metrics')
  // Dismiss the tutorial overlay so pointer events land on the canvas.
  await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click()`)
  const settle = () => page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const point = (x, y, z) => page.evaluate(`(() => {
    const scene=__scene, cam=scene.cameraSys.activeCamera(), r=scene.renderer.domElement.getBoundingClientRect();
    const p=cam.position.clone().set(${x},${y},${z}).project(cam);
    return { x:r.left+(p.x+1)*r.width/2, y:r.top+(1-p.y)*r.height/2 };
  })()`)
  const send = async (type, p) => {
    await page.send('Input.dispatchMouseEvent', {
      type, ...p, ...(type === 'mouseMoved' ? {} : { button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }),
    })
    await settle()
  }

  // A clean raised floor with the north-facing 半墙 in the cell above (0,0,1).
  await page.evaluate(`(async () => {
    const store=__metro, s=store.getState(), cells=[];
    for(let x=-3;x<=3;x++)for(let y=-3;y<=3;y++)cells.push({x,y,z:1,fill:'solid'});
    cells.push({x:0,y:0,z:2,fill:'solid',tags:['wall','half-wall:n']});
    s.commit({...s.station,name:'Wall cut audit',levelBase:0,cells,modules:[],lines:[]});
    store.setState({tool:'block',halfWall:true,halfCorner:true,triangles:false,autoWalls:false,wallSnapCycle:3,activeZ:0,playing:false,ghostOther:true,autoCeiling:false,cutaway:false,past:[],future:[]});
    __cutAudit={ ghosts:[] };
    const original=__scene.setGhost.bind(__scene);
    __scene.setGhost=function(cells,mode,module,thin,refused){
      __cutAudit.ghosts.push({cells:(cells??[]).map(c=>[...c]),mode,thin:thin?[...thin.entries()]:null,refused:(refused??[]).map(c=>[...c])});
      return original(cells,mode,module,thin,refused);
    };
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const cs=__scene.cameraSys; cs.controls.enableDamping=false; __scene.setOrtho(false);
    cs.camera.position.set(2.6,-4.6,5.2); cs.controls.target.set(.5,.5,2.4); cs.controls.update(); cs.camera.updateMatrixWorld(true);
  })()`)
  await waitFor(page.evaluate, '!!__scene.ctx?.stationData && __scene.ctx.stationData.cells.length >= 50')
  await settle()
  // The free south half of the cell, in front of the half wall.
  const target = await point(0.5, 0.22, 2.01)
  await send('mouseMoved', target)
  const freeGhost = await page.evaluate('__cutAudit.ghosts.at(-1)')
  assert.deepEqual(freeGhost?.cells, [[0, 0, 2]], 'the cell already holding the half wall is a candidate')
  assert.deepEqual(freeGhost?.refused, [])
  assert.deepEqual([...freeGhost.thin].map(([k, s]) => [k, s]), [[packKey(0, 0, 2), { kind: 'corner', side: 'w' }]],
    'the ghost shows the new south-west corner at the half-wall cell')

  // The overlapping north-west corner (cycle 0) must be refused, not merged.
  await page.evaluate('__metro.getState().setCutMode("corner")')
  await settle()
  await send('mouseMoved', { x: target.x + .5, y: target.y + .5 })
  await send('mouseMoved', target)
  const overlapGhost = await page.evaluate('__cutAudit.ghosts.at(-1)')
  assert.deepEqual(overlapGhost?.cells, [])
  assert.deepEqual(overlapGhost?.refused, [[0, 0, 2]], 'an overlapping corner reds the cell')
  await send('mousePressed', target)
  await send('mouseReleased', target)
  const untouched = await page.evaluate('__metro.getState().station.cells.find(c=>c.x===0&&c.y===0&&c.z===2)')
  assert.deepEqual(untouched.tags, ['wall', 'half-wall:n'], 'the refused click changed nothing')

  // R to the south-west corner, then click: the cell keeps one record with both tags.
  await page.evaluate('__metro.getState().setCutMode("corner"); for(let i=0;i<3;i++)__metro.getState().rotateWallSnap()')
  await settle()
  await send('mouseMoved', { x: target.x + .5, y: target.y + .5 })
  await send('mouseMoved', target)
  const mergeGhost = await page.evaluate('__cutAudit.ghosts.at(-1)')
  assert.deepEqual(mergeGhost?.cells, [[0, 0, 2]])
  await send('mousePressed', target)
  await send('mouseReleased', target)
  const materialized = await page.evaluate('__metro.getState().station.cells.find(c=>c.x===0&&c.y===0&&c.z===2)')
  assert.deepEqual(materialized.tags, ['wall', 'half-wall:n', 'half-corner:w'], 'the corner joined the same cell')
  assert.equal(await page.evaluate('__metro.getState().station.cells.filter(c=>c.x===0&&c.y===0&&c.z===2).length'), 1,
    'the merge added no second record')
  assert.deepEqual(shapeOf(materialized), { kind: 'cuts', mask: 11 }, 'the L the mesher draws')
  assert.equal(await page.evaluate(`__metro.getState().past.length > 0`), true, 'the merge is undoable')

  // A clean picture of the L: the refusal toast is dismissed, the camera looks
  // down on the cell, and a second capture hides the editor chrome.
  await page.evaluate(`(() => {
    __metro.getState().setNotice(null);
    const cs=__scene.cameraSys;
    cs.camera.position.set(2.1,-3.1,5.2); cs.controls.target.set(.5,.5,2.4); cs.controls.update(); cs.camera.updateMatrixWorld(true);
    __metro.setState({hideUI:true});
  })()`)
  await settle()
  await settle()
  const clean = await page.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(resolve(output, 'half-wall-corner.png'), Buffer.from(clean.data, 'base64'))
  await page.evaluate('__metro.setState({hideUI:false})')
  await settle()

  await page.evaluate('__metro.getState().undo()')
  await settle()
  const undone = await page.evaluate('__metro.getState().station.cells.find(c=>c.x===0&&c.y===0&&c.z===2)')
  assert.deepEqual(undone.tags, ['wall', 'half-wall:n'], 'undo restores the half wall alone')
  console.log('wall cuts: half wall + corner merged in one cell; overlapping corner refused')
} finally {
  await page?.close()
  await new Promise((r) => server.close(r))
}
