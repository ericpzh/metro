import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Canvas, createCanvas, ImageData } from '@napi-rs/canvas'
import validator from 'gltf-validator'
import { exportTypeA } from './train-source.mjs'

globalThis.HTMLCanvasElement = Canvas
globalThis.ImageData = ImageData
globalThis.document = {
  createElement(name) {
    assert.equal(name, 'canvas')
    const canvas = createCanvas(1, 1)
    // @napi-rs exposes a `data()` method on Canvas. GLTFExporter treats any
    // image with a `data` property as a DataTexture, so shadow it or every
    // canvas is exported as transparent black.
    Object.defineProperty(canvas, 'data', { value: undefined })
    canvas.toBlob = async (callback, mime) => {
      const bytes = await canvas.encode(mime === 'image/jpeg' ? 'jpeg' : 'png')
      callback(new Blob([bytes], { type: mime }))
    }
    return canvas
  },
}
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => {
      this.result = result
      this.onloadend?.()
    })
  }
}

const out = resolve(process.argv[2] ?? '.preview/unity/train-proof/export')
const { bytes, manifest } = await exportTypeA()
const report = await validator.validateBytes(bytes, { uri: 'train.glb' })
await mkdir(out, { recursive: true })
await writeFile(join(out, 'validation.json'), JSON.stringify(report, null, 2) + '\n')
assert.equal(report.issues.numErrors + report.issues.numWarnings, 0, 'See validation.json')
manifest.sha256 = createHash('sha256').update(bytes).digest('hex')
await writeFile(join(out, 'train.glb'), bytes)
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`${manifest.id}: ${manifest.doors.length} door leaves, ${bytes.length} bytes, ${manifest.sha256}`)
