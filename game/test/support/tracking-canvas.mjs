// A 2D context stub that tracks the transform matrix, so a test can measure where a
// drawing actually put its **ink** — not just which calls it made.
//
// `test/support/stub-canvas.mjs` records paint calls; this records the *geometry*
// they painted, which is what "is the board centred?" is a question about. Every
// path point is pushed through the matrix in force at the time, so a fill's box is
// the box the rasteriser would cover.

const noop = () => {}

export function trackingCanvas(width = 512, height = 256) {
  const state = {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineJoin: 'miter',
    lineCap: 'butt',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
  }
  const stack = []
  let m = [1, 0, 0, 1, 0, 0]
  let path = []
  /** Every painted thing: its kind, its colour, and its points in canvas space. */
  const painted = []
  const mul = (a, b) => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
  const at = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
  const fontPx = () => Number(/(\d+(?:\.\d+)?)px/.exec(state.font)?.[1] ?? 10)

  const g = {
    canvas: { width, height },
    setTransform(a, b, c, d, e, f) {
      m = [a, b, c, d, e, f]
    },
    resetTransform() {
      m = [1, 0, 0, 1, 0, 0]
    },
    save() {
      stack.push({ m: [...m], ...state })
    },
    restore() {
      const s = stack.pop()
      if (s) {
        m = s.m
        Object.assign(state, s)
      }
    },
    translate(x, y) {
      m = mul(m, [1, 0, 0, 1, x, y])
    },
    rotate(a) {
      m = mul(m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0])
    },
    scale(sx, sy) {
      m = mul(m, [sx, 0, 0, sy, 0, 0])
    },
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    beginPath() {
      path = []
    },
    closePath: noop,
    moveTo(x, y) {
      path.push(at(x, y))
    },
    lineTo(x, y) {
      path.push(at(x, y))
    },
    roundRect: noop,
    arc(cx, cy, r) {
      // The bend's own extent, which is all the box needs.
      path.push(at(cx - r, cy - r), at(cx + r, cy + r))
    },
    ellipse: noop,
    arcTo: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    fill() {
      if (path.length) painted.push({ kind: 'fill', colour: String(state.fillStyle), points: path.slice() })
      path = []
    },
    stroke() {
      if (path.length) painted.push({ kind: 'stroke', colour: String(state.strokeStyle), width: state.lineWidth, points: path.slice() })
      path = []
    },
    clip: noop,
    fillText(text, x, y) {
      painted.push({ kind: 'text', text: String(text), colour: String(state.fillStyle), size: fontPx(), points: [at(x, y)] })
    },
    strokeText: noop,
    measureText(text) {
      // What a browser's bold sans-serif reports, near enough: a CJK em is a full
      // em, Latin advances are narrower.
      const px = fontPx()
      let em = 0
      for (const ch of String(text)) {
        const c = ch.codePointAt(0) ?? 0
        if (c >= 0x2e80) em += 1
        else if (ch === ' ') em += 0.3
        else if (c >= 48 && c <= 57) em += 0.58
        else if (c >= 65 && c <= 90) em += 0.68
        else if (c >= 97 && c <= 122) em += 0.55
        else em += 0.6
      }
      return { width: em * px }
    },
    createLinearGradient: () => ({ addColorStop: noop }),
    drawImage: noop,
    toSvg: () => '',
  }
  for (const key of Object.keys(state)) {
    Object.defineProperty(g, key, {
      get: () => state[key],
      set: (v) => {
        state[key] = v
      },
    })
  }

  /** Every painted thing that is not the board's ground and not its frame. */
  const ink = () => painted.filter((p) => !(p.kind === 'fill' && p.colour === '#0d1116') && !(p.kind === 'stroke' && p.colour === '#3c434c'))

  /** The horizontal extent of the ink, in canvas pixels. */
  const inkSpan = () => {
    const xs = ink().flatMap((p) => p.points.map((q) => q[0]))
    return xs.length ? { left: Math.min(...xs), right: Math.max(...xs) } : null
  }

  return { g, painted, ink, inkSpan }
}
