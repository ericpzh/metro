// The rendered rolling stock, for the sheets that draw a car.
//
// `tools/render-train-cards.mjs` leaves a directory of PNGs and an `index.json` that
// says, for each picture, **how much of the world it covers** — `metres` across,
// `verticalMetres` up, the world `box` it was framed in, and which way the camera was
// pointing (`kind`). That is what lets a sheet place the game's own car into its own
// drawing at its own scale, and stand it on the right line: a front or a side stands on
// the rail (`z = 0`), a plan straddles the track centreline (`y = 0`).
//
// Sheets 02, 05, 11 and 12 all do that, so the two functions live here rather than in
// four copies that could drift apart.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
export const TRAIN_CARDS = resolve(repo, process.env.TRAIN_CARDS_DIR ?? join('.preview', 'train-cards'))

/**
 * Every picture, keyed by id, with its pixels inlined as a data URL.
 *
 * Read once per process: a sheet asks for a handful of the same sixteen pictures and
 * base64-ing a 40 KB PNG sixteen times is noticeable.
 */
let cached = null
export function loadTrainCards() {
  if (cached) return cached
  const indexPath = join(TRAIN_CARDS, 'index.json')
  if (!existsSync(indexPath)) {
    throw new Error(
      `no rendered rolling stock in ${TRAIN_CARDS} — run:\n  npm run build:game\n  node tools/render-train-cards.mjs`,
    )
  }
  cached = new Map(
    JSON.parse(readFileSync(indexPath, 'utf8')).pieces.map((p) => [
      p.id,
      { ...p, href: `data:image/png;base64,${readFileSync(join(TRAIN_CARDS, p.file)).toString('base64')}` },
    ]),
  )
  return cached
}

/** One picture, or a failure that says how to make it. */
export function trainCard(id) {
  const piece = loadTrainCards().get(id)
  if (!piece) throw new Error(`the capture has no \`${id}\` — re-run tools/render-train-cards.mjs`)
  return piece
}

/**
 * A picture of a car, sized so that a metre is `pxPerM` pixels and a known world line
 * lands on `datumY` — the rail for a front or a side, the track centreline for a plan.
 *
 * Returns the box it occupies as well as the `<image>`, because a caller that has to
 * put something *beside* the car (a platform edge, a screen door) needs to know where
 * the car starts and ends.
 */
export function carImage(piece, centreX, datumY, pxPerM) {
  const axis = piece.kind === 'plan' ? piece.box.y : piece.box.z
  const w = piece.metres * pxPerM
  const h = piece.verticalMetres * pxPerM
  const top = datumY - ((axis[1] - 0) / (axis[1] - axis[0])) * h
  const x = centreX - w / 2
  const at = (v) => (Math.round(v * 10) / 10).toString()
  return {
    w,
    h,
    x,
    y: top,
    /** The car's own centre, in the same pixels. */
    centreX,
    svg: `<image x="${at(x)}" y="${at(top)}" width="${at(w)}" height="${at(h)}" href="${piece.href}"/>`,
  }
}
