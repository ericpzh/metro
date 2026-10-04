// The 指示牌 pictograms, read the way the board receives them.
//
// `drawSignPanel` prints a mark with `drawImage`, and a mark's pixels are a PNG
// asset (`tools/prep-sign-icons.py` writes them, `render/pictograms.ts` loads
// them). The browser path — `import.meta.glob` and `new Image` — is Vite's and the
// DOM's, so a Node test cannot take it; this takes the same files apart instead,
// with the one piece of PNG the assets actually use.
//
// That makes the tests' marks the *shipping* marks rather than a stand-in: a test
// can prove a board prints the art, and can prove the art is what a board needs —
// square, pure white, and fully transparent behind the ink.
import { readFileSync, readdirSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ASSETS = resolve(HERE, '../../src/assets/pictograms')

/** The PNG signature every asset starts with. */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The five per-byte filters the PNG spec defines, applied row by row. */
function unfilter(raw, width, height, bpp) {
  const stride = width * bpp
  const out = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const row = out.subarray(y * stride, (y + 1) * stride)
    const prev = y === 0 ? Buffer.alloc(stride) : out.subarray((y - 1) * stride, y * stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      const x = src[i]
      switch (filter) {
        case 0:
          row[i] = x
          break
        case 1:
          row[i] = (x + a) & 0xff
          break
        case 2:
          row[i] = (x + b) & 0xff
          break
        case 3:
          row[i] = (x + ((a + b) >> 1)) & 0xff
          break
        case 4: {
          // The spec's Paeth predictor.
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          row[i] = (x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
          break
        }
        default:
          throw new Error(`unknown PNG filter ${filter}`)
      }
    }
  }
  return out
}

/**
 * One asset, decoded: its size and its RGBA pixels. Only the 8-bit truecolour
 * images `prep-sign-icons.py` writes are accepted, because those are the only ones
 * the game ships.
 */
export function readPictogram(name) {
  const file = readFileSync(resolve(ASSETS, `${name}.png`))
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error(`${name}.png is not a PNG`)
  let width = 0
  let height = 0
  let depth = 0
  let colour = 0
  const idat = []
  for (let at = 8; at < file.length; ) {
    const length = file.readUInt32BE(at)
    const type = file.toString('ascii', at + 4, at + 8)
    const body = file.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      depth = body[8]
      colour = body[9]
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }
    at += length + 12
  }
  if (depth !== 8 || colour !== 6) throw new Error(`${name}.png is not 8-bit RGBA (depth ${depth}, type ${colour})`)
  const pixels = unfilter(inflateSync(Buffer.concat(idat)), width, height, 4)
  return {
    name,
    width,
    height,
    /** The RGBA bytes at `(x, y)`. */
    at(x, y) {
      const o = (y * width + x) * 4
      return { r: pixels[o], g: pixels[o + 1], b: pixels[o + 2], a: pixels[o + 3] }
    },
  }
}

/** Every icon that has an asset on disk, by the name its block uses. */
export function pictogramNames() {
  return readdirSync(ASSETS)
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.replace(/\.png$/, ''))
    .sort()
}

/**
 * The marks as `drawImage` sources. The canvas stub only ever looks at these
 * objects, so an icon is identified by the asset it came from — which is what lets
 * a test say *which* marks a board printed rather than only how many.
 */
export function pictogramArt() {
  const art = new Map()
  for (const name of pictogramNames()) art.set(name, { __icon: name, ...readPictogram(name) })
  return art
}
