// A minimal 2D context stub, enough for `render/signFace.ts`: it records what was
// painted instead of rasterising it. Used by the sign render tests to prove a board
// prints marks rather than coming out as the model's own black panel.
const noop = () => {}

export function stubCanvas(width = 512, height = 256) {
  // `filled` records the colour of every painted area, which is what a test wants to
  // know: the ground is one colour, the board another, and a mark is the ink. Counting
  // calls alone cannot tell an empty board from a printed one. `words` keeps each word
  // with the size and baseline it was set at, because a label's *geometry* is as
  // silent a failure as a missing mark: a row set twice too large still prints the
  // right characters, off the top of the panel. `images` is the same record for a
  // **pictogram**, which is bitmap art rather than a path: a test can read which mark
  // was printed and in what box.
  const ops = { fills: 0, strokes: 0, texts: [], words: [], filled: [], stroked: [], images: 0, drawn: [] }
  const g = {
    canvas: { width, height },
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineJoin: 'miter',
    lineCap: 'butt',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    // Every path job is a no-op except the two that actually mark pixels.
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    rect: noop,
    roundRect: noop,
    arc: noop,
    arcTo: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    ellipse: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    setTransform: noop,
    resetTransform: noop,
    clip: noop,
    clearRect: noop,
    // A path fill and a rectangle fill are the same thing to a reader of the plate.
    fill: () => {
      ops.fills++
      ops.filled.push(String(g.fillStyle))
    },
    fillRect: () => {
      ops.fills++
      ops.filled.push(String(g.fillStyle))
    },
    stroke: () => {
      ops.strokes++
      ops.stroked.push(String(g.strokeStyle))
    },
    strokeRect: () => {
      ops.strokes++
      ops.stroked.push(String(g.strokeStyle))
    },
    fillText: (t, x, y) => {
      ops.texts.push(String(t))
      // `bold 81.9px "…"` — the size is after the weight, so `parseFloat` would only
      // ever see the word `bold`. The ink is recorded with the word because a strap
      // that prints the right words in the wrong colour is the same failure as a
      // strap that prints nothing: `fillStyle` at the moment of the call is the only
      // place the colour exists (a `fillText` paints no path for `filled` to catch).
      ops.words.push({ text: String(t), x, y, colour: String(g.fillStyle), size: Number(/(\d+(?:\.\d+)?)px/.exec(g.font)?.[1] ?? 0) })
    },
    strokeText: noop,
    measureText: (t) => ({ width: String(t).length * (parseFloat(g.font) || 10) * 0.95 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    drawImage: (image, x, y, w, h) => {
      ops.images++
      ops.drawn.push({ icon: image?.__icon ?? null, x, y, w, h })
    },
  }
  return { g, ops }
}
