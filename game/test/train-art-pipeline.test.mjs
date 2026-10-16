import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { STOCK_CLASSES, trainLength, trainRatedCapacity } from '../src/sim/stock.ts'

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
