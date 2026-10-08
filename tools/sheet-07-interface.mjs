// Concept 07 — the interface.
//
// Every picture on this sheet is a **photograph of the shipping game**, taken by
// `tools/render-ui-shots.mjs` in headless Chrome: the whole window, each chrome
// region cropped to its own bounding box, and the states a player gets by folding a
// folder open or pressing the clock card. So the rail's tiles, the inspector's
// read-outs and the crowd at the turnstiles are the ones the game draws, at the size
// it draws them, rather than a mock of them.
//
// The region names and the colours are the game's own too. The accents below are the
// custom properties at the top of `game/src/styles.css` (`--accent`, `--ink`, `--muted`,
// `--panel`, `--line`), so the sheet is drawn in the palette the interface wears, and
// the boxes the numbered outlines sit on are the ones the capture measured off the DOM.
//
// What is left for this file is the reading layer: the numbered key, the region
// captions, and the vocabulary — which keys the tiles carry, which folders live in
// which column, and what the twelve read-outs are. Nothing here invents a control.
//
// It does not move. An interface sheet is a reference, and a panel that animated
// would read as a demo of the game rather than as the game's own chrome.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { T, n, sheet, title } from './iso.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
/** Where `node tools/render-ui-shots.mjs` leaves its pixels and its index. */
const SHOTS = resolve(repo, process.env.UI_SHOTS_DIR ?? join('.preview', 'ui-shots'))

/**
 * The game's own palette, from the custom properties at the top of
 * `game/src/styles.css`. The sheet is drawn in the colours the interface wears, so a
 * screenshot does not sit in a frame that belongs to a different design.
 */
const G = {
  bg: '#06111d',
  panel: '#0b1b2c',
  line: '#1d3b58',
  text: '#d6e7f7',
  muted: '#7ea6c9',
  accent: '#55b6ff',
  ink: '#8fc4ee',
  good: '#4fd6a3',
  warn: '#ffc861',
  danger: '#ff7d5c',
}

const W = 1600
/**
 * The captured shots, or a clear failure.
 *
 * The render needs a browser and the game's build, so it is a separate step by
 * design (`tools/render-ui-shots.mjs`); a sheet that silently drew nothing would be
 * worse than one that stops.
 */
function loadShots() {
  const indexPath = join(SHOTS, 'index.json')
  if (!existsSync(indexPath)) {
    throw new Error(
      `no photographed interface in ${SHOTS} — run:\n  npm run build:game\n  node tools/render-ui-shots.mjs`,
    )
  }
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  const byShot = new Map()
  for (const shot of index.shots) {
    const crops = new Map()
    for (const crop of shot.crops) {
      const file = join(SHOTS, crop.file)
      if (!existsSync(file)) throw new Error(`interface image is missing: ${crop.file}`)
      crops.set(crop.name, { ...crop, href: `data:image/png;base64,${readFileSync(file).toString('base64')}` })
    }
    byShot.set(shot.id, { ...shot, crops })
  }
  return { window: { width: index.width, height: index.height }, byShot }
}

/* ------------------------------------------------------------------ helpers */

/** One crop, by the state it was photographed in and the region it is. */
const cropOf = (shots, shot, name) => {
  const c = shots.byShot.get(shot)?.crops.get(name)
  if (!c) throw new Error(`the capture has no \`${shot}.${name}\` — re-run tools/render-ui-shots.mjs`)
  return c
}

/**
 * A crop placed at the size the sheet wants, which is usually the **logical** size it
 * was measured at: the capture supersamples a region at 2× so the sheet can carry it
 * 1:1 and the browser downsamples the pixels. The hero also carries a 2×
 * capture, preserving the interface and 3D scene when the sheet is zoomed.
 */
const image = (crop, x, y, w = crop.rect.width, h = crop.rect.height) =>
  `<image x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" href="${crop.href}"/>`

/* -------------------------------------------------------------------- sheet */

export function artInterface() {
  const shots = loadShots()
  const g = [title(48, 62, '边搭边看，哪里挤就改哪里', '左边选工具，右边调设置，底栏看排队和滞留。')]
  const win = cropOf(shots, 'played', 'window')
  const w = 1504, h = w * shots.window.height / shots.window.width
  g.push(image(win, 48, 140, w, h))
  const items = [
    ['建造', '选择方块和设备，逐层搭出车站。'],
    ['调整', '在信息栏设置出入口、线路和客流。'],
    ['观察', '运行后看排队与滞留，再回到工地修改。'],
  ]
  const y = 140 + h + 48
  items.forEach(([name, note], i) => {
    const x = 48 + i * 508
    g.push(T(x, y, `${i + 1}  ${name}`, { size: 23, weight: 800, fill: G.accent }))
    g.push(T(x, y + 34, note, { size: 17, fill: G.text }))
  })
  return sheet(W, Math.ceil(y + 78), g.join(''))
}
