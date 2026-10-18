import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { STOCK_CLASSES, TRAIN_ORIGIN_Z, trainLength, trainRatedCapacity } from '../src/sim/stock.ts'
import { carImage, TRAIN_RAIL_DATUM_Z } from '../../tools/train-cards.mjs'
import { RAIL_HEAD_Z } from '../src/sim/constants.ts'
import { trainPieces } from '../src/app/captureTrains.ts'

test('catalogue captures include overhead collectors for A/D and third-rail roofs for B/C/L', () => {
  const frames = new Map(trainPieces().frames.map(frame => [frame.id, frame]))
  for (const stock of STOCK_CLASSES) for (const view of ['car', 'side', 'front']) {
    assert.equal(frames.get(`${view}-${stock}`).power, stock === 'A' || stock === 'D' ? 'catenary' : 'third-rail')
  }
  assert.equal(frames.get('open').power, 'catenary', 'the D door detail uses the same roof variant')
  assert.equal(frames.get('nose').power, 'catenary')
  assert.equal(frames.get('iso-A').power, 'catenary', 'station illustrations use the A overhead-wire roof')
})

for (const language of ['zh','en']) for (const name of ['05-trains-and-track','11-rolling-stock-3d']) {
  test(`${name} ${language} contains every stock class and keeps captures within the sheet`, () => {
    const file = `${name}${language==='en'?'-en':''}.svg`
    const svg = readFileSync(new URL(`../../art/${file}`,import.meta.url),'utf8')
    const [,width,height] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number)
    const labels = [...svg.matchAll(/<text\b[^>]*>(?:Type ([ABCDL])|([ABCDL]) 型)<\/text>/g)].map(m=>m[1]??m[2])
    assert.deepEqual(labels,[...STOCK_CLASSES],'all five class headings remain in shared stock order')
    for (const cls of STOCK_CLASSES) assert.ok(svg.includes(`data-stock="${cls}"`),`${cls} has captured model poses`)
    for (const image of svg.matchAll(/<image\b([^>]*)/g)) {
      const attrs=Object.fromEntries([...image[1].matchAll(/(x|y|width|height)="([-\d.]+)"/g)].map(m=>[m[1],Number(m[2])]))
      assert.ok(attrs.x>=0 && attrs.y>=0 && attrs.x+attrs.width<=width+0.1 && attrs.y+attrs.height<=height+0.1,'no train capture spills outside the canvas')
    }
    if(name.startsWith('05')) {
      assert.ok(svg.includes(String(trainRatedCapacity({stock:'D',cars:8}))))
      assert.ok(svg.includes(trainLength({stock:'D',cars:8}).toFixed(1)))
    } else {
      assert.ok((svg.match(/data-stock="D"/g)??[]).length>=2,'the door detail also uses the D model')
    }
  })
}


test('train elevation images anchor the new wheel tread to the rail while plans retain their centreline', () => {
  assert.equal(TRAIN_RAIL_DATUM_Z, RAIL_HEAD_Z - TRAIN_ORIGIN_Z)
  for (const kind of ['front','side','plan']) {
    const piece = {kind,metres:10,verticalMetres:4.4,box:{z:[-.2,4.2],y:[-2.2,2.2]},href:'test'}
    const image = carImage(piece,500,1000,20)
    const datum = kind === 'plan' ? 0 : TRAIN_RAIL_DATUM_Z
    const axis = piece.box[kind === 'plan' ? 'y':'z']
    const datumY = image.y + (axis[1]-datum)/(axis[1]-axis[0])*image.h
    assert.ok(Math.abs(datumY-1000)<1e-9)
  }
})
