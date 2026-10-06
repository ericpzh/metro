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
  // was printed and in what box. `rotations` keeps every `rotate` an angle, in radians,
  // because a drawn mark's **orientation** is part of its drawing — the arrows are one
  // path turned about their own centre, and a mark that quietly turned itself would be
  // a different sign.
  const ops = { fills: 0, strokes: 0, texts: [], words: [], filled: [], stroked: [], strokeWidths: [], images: 0, drawn: [], ellipses: [], arcs: [], rotations: [] }
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
    // The two curve jobs are recorded rather than ignored, because their **arguments carry the
    // drawing**: an arc's start/end angle and its `anticlockwise` flag decide which side of the
    // circle it bulges, and a sign whose bend sweeps the wrong way is a blob rather than a
    // U-turn. Counting calls cannot tell the two apart; the arguments can.
    arc: (cx, cy, r, a0, a1, anticlockwise) => {
      ops.arcs.push({ cx, cy, r, a0, a1, anticlockwise: Boolean(anticlockwise) })
    },
    arcTo: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    ellipse: (cx, cy, rx, ry, rot, a0, a1, anticlockwise) => {
      ops.ellipses.push({ cx, cy, rx, ry, a0, a1, anticlockwise: Boolean(anticlockwise) })
    },
    save: noop,
    restore: noop,
    translate: noop,
    rotate: (angle) => {
      ops.rotations.push(angle)
    },
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
      // The **width** of the line, not just its colour: a mark drawn as a stroked centre line is
      // as wide as its `lineWidth` and no wider, so that number is the drawing.
      ops.strokeWidths.push(g.lineWidth)
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
