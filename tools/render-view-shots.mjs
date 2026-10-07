// Photographs the demo station from each of the game's own views.
//
//   node tools/render-view-shots.mjs [--out .preview/view-shots] [--scale 2] [--port 4198]
//
// Sheet 09 is about the camera, and the only honest way to draw what a view looks
// like is to let the game take it: this boots the built game — which loads the
// shipped demo station, 动物园 — drives the camera through the real presets
// (`CameraSystem.setPreset`, the same call the 1–5 keys and the nav cube make) and
// writes one PNG per view, cropped to the station's own ink.
//
// Nothing about a view is stated here or on the sheet. The directions are the game's
// (`setPreset`), the projection is whatever the preset sets (iso is perspective, the
// flat views are orthographic), the cut is the game's own 剖切 and the view with no
// lattice is the game's own 隐藏UI — so a change to any of them moves the pictures.
// The one thing this does is take the page's **chrome** (the rail, the panels, the
// bars, the 视图 widget) out of a view's frame, because a picture of a station is not a
// picture of its own toolbars (`setChrome`); the widget is put back for its own card.
//
// The crop is measured, not guessed: the raw frame is handed back to the page, drawn
// into a canvas there and scanned for the box that holds every pixel that is not the
// clear colour, so each card is the station rather than the stage.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const DIST = join(repo, 'game', 'dist')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const outDir = resolve(repo, arg('out', join('.preview', 'view-shots')))
const scale = Number(arg('scale', 1))
/**
 * The widest pixel frame kept for a card, in image pixels. A card shows its view
 * about 470 sheet-units wide, so this is a little over 1.5× that: enough that the
 * picture stays crisp when a reader opens the sheet, and not so much that eight of
 * them weigh more than the rest of the sheets put together.
 */
const MAX_W = Number(arg('max-w', 720))
const PORT = Number(arg('port', 4198))
const DEBUG_PORT = Number(arg('debug-port', 9337))
const WIDTH = 1600
const HEIGHT = 1000

/**
 * The views, in the order the sheet reads them.
 *
 * `preset` is the game's own name for the camera direction — the one `1`/`2`/`4`/`5`
 * dispatch, and `custom` means "leave the camera where the last state put it". `cut`
 * turns the game's 剖切 on and turns it a quarter; `bare` turns 隐藏UI on, which is
 * the station with the lattice, the slice and the chrome off it. `ground` **keeps**
 * the street plane, which every view here hides (`隐藏地面`) — a station is mostly
 * underground, and the plane is a lid over it.
 *
 * `eye` is the **interior** shot, and the one view with no preset to copy: the game
 * has no "stand in the concourse" key. The page finds it — a storey with air over its
 * floor and a cell whose longest clear run is worth looking down (`MOUNT_JS`) — and
 * stands there at head height.
 *
 * Every view is taken from the **same storey**, `depth` metres (`-12`, the hall the
 * demo's gates, ticket machines and calligraphy stand on): the station builds in
 * chunks and a chunk message re-anchors the edited storey behind the page's back, so
 * the depth is re-asserted once the page has settled. The widget's own capture then
 * shows that storey's dot on its 高度 rail.
 *
 * `aim` points the camera at the **active storey's contents** rather than at the
 * middle of the station's bounds, which a hundred and sixty metres of track drags off
 * the concourse and onto a roof slab. `aimAt` names a point outright.
 *
 * **`hotspot` is where a cut goes.** The platform edge and the middle of the bounds are
 * both arbitrary; the fullest 8 m bin of the active storey's modules is the concourse,
 * and that is what a section is for. It anchors the cut there *and* aims the frame at
 * it, so the tile holds the part of the station with the most in it. `tilt` is the
 * other half of a readable cut: it drops the eye from the preset's 30° to whatever
 * `z`-component it names, because a vertical cut read from 30° up is mostly the roof
 * slabs the cut left standing.
 *
 * `zoom` is how much closer than the preset framing the shot is taken: 3 means the
 * station fills the frame three times larger, so the tile shows its middle rather than
 * a hundred and sixty metres of platform end. `fov` is a lens other than the game's
 * own 45°.
 */
const VIEWS = [
  { id: 'iso', label: '等轴测建造视图', preset: 'iso', zoom: 3 },
  { id: 'plan', label: '平面 / 俯视', preset: 'plan', zoom: 4 },
  // **The cutaway.** `cut: 1` is the quarter turn that matters: the plane's normal is
  // `+x` at 90°, so the half it keeps is the station west of the anchor and the camera —
  // east of it and above — looks straight into the rooms the cut has opened. Left at the
  // default (normal `+y`) the same camera sees the outside of the south wall, which is
  // the pale slab this tile used to be.
  //
  // `tilt` then drops the eye from the preset's 30° to about 17°. A *vertical* cut read
  // from 30° up is mostly a picture of the roof slabs the cut left standing — 剖切 does
  // not lift ceilings, so the slab over each room is still there to be looked at — and
  // `zoom` closes on the concourse once `hotspot` has put the cut through it.
  { id: 'section', label: '剖切 · 收起剖切面', preset: 'iso', cut: 1, surface: false, hotspot: true, aim: true, tilt: 0.3, zoom: 4, pan: 12 },
  // **The flat one**, and the only view that says how the storeys stack: the station cut
  // through its length and photographed from the south, square on. `front` alone is a
  // picture of the outside of the south wall — the cut is what makes it a section, and
  // `bare` (隐藏UI) is what keeps every storey drawn as itself rather than ghosted.
  { id: 'elevation', label: '正交 X-Z 剖面', preset: 'front', bare: true, cut: 2, surface: false, hotspot: true, zoom: 3 },
  { id: 'eye', label: '站厅 · 平视', preset: 'custom', bare: true, eye: true, fov: 74 },
  // The control itself, photographed from the page instead of redrawn on the sheet. It
  // comes last so its depth rail shows the storey the last view stood on, and it is
  // snapped to a **corner of the nav cube** — the same call clicking one makes — so its
  // cube reads as a box rather than as a flat face-on square. **Captured at 2× density**:
  // the sheet draws it into the same window every view gets, which is smaller than the
  // widget stands on screen, and a UI handed to the sheet at its own pixels would come
  // out soft once scaled. `deviceScaleFactor` is set for this pass and put back, so the
  // view tiles keep the pixels they have always had.
  { id: 'widget', label: '视图控件', preset: 'custom', corner: [1, -1, 1], ui: '.viewNav', density: 2 },
]

const server = await serveDir(DIST, PORT)
const session = await withPage({
  url: `http://127.0.0.1:${PORT}/`,
  profile: join(repo, '.preview', `.chrome-view-shots-${process.pid}`),
  debugPort: DEBUG_PORT,
  windowSize: `${WIDTH},${HEIGHT}`,
  verbose: Boolean(process.env.VIEWS_VERBOSE),
})

/**
 * The page side of `mount`, as a **plain string**: the comments in here name the
 * game's own functions, and a template literal would be closed by the first
 * backtick in one of them. `__BARE__`, `__CUT__`, `__PRESET__` and `__TURNS__` are
 * filled in per view.
 */
const MOUNT_JS = [
  '(() => {',
  '  const s = window.__metro.getState()',
  '  s.setTimePanel(false)',
  '  s.setPlaying(false)',
  '  s.setSpeed(1)',
  '  s.setHideUI(__BARE__)',
  '  s.setCutaway(__CUT__)',
  '  // 隐藏地面: the street plane is a lid over a station that is mostly underground, so',
  '  // every view on this sheet takes it away.',
  '  s.setHideGround(!__GROUND__)',
  '  // 隐藏剖切面: keep the cut, take its sheet and grab handle away, so the slice',
  '  // itself is what the picture shows.',
  '  s.setHideSectionSurface(!__SURFACE__)',
  '  // 隐藏墙壁: every wall and every platform screen door drawn translucent. An',
  '  // elevation of a station is otherwise a picture of its own facade.',
  '  s.setHideWalls(__WALLS__)',
  '  // **剖切 anchored on the platform.** The cut is a **horizontal** plane: the game',
  '  // anchors it at the storey you are standing on (`SceneRenderer.defaultSection`), so',
  '  // left alone it slices the plaza a storey above the station and the picture shows a',
  '  // lid rather than a platform. The 站台边 piece is the one that says where the platform',
  '  // is, so the plane is taken through that piece\'s own storey.',
  '  if (__CUT_PLATFORM__) {',
  '    const edge = s.station.modules.filter((m) => m.type === "platform-edge")',
  '    if (edge.length) {',
  '      let mx = 0, my = 0, top = -Infinity',
  '      for (const m of edge) {',
  '        mx += m.x + (m.w || 1) / 2',
  '        my += m.y + 0.5',
  '        if (m.z > top) top = m.z',
  '      }',
  '      s.placeSection([mx / edge.length, my / edge.length, top])',
  '      // `placeSection` writes the store, and the renderer only re-reads it when the',
  '      // station rebuilds — which a section move does not do. Hand it over directly, so',
  '      // the plane the picture is taken with is the one that was just chosen.',
  '      window.__scene.setSection(s.section, true)',
  '    }',
  '  }',
  '  // A view may name the exact spot its cut is placed at, instead of the platform.',
  '  if (__SECTION_AT__) {',
  '    s.placeSection(__SECTION_AT__)',
  '    window.__scene.setSection(s.section, true)',
  '  }',
  '  // The storey the camera stands on, which is what the game slices the station to:',
  '  // a view of a station the player is not standing in comes back as its ceiling.',
  '  // The platform is the deepest storey the demo builds, and the most interesting',
  '  // section of it.',
  '  s.setActiveZ(__DEPTH__)',
  '  // **Cut where the station is busiest.** Not at the platform edge and not at the middle',
  '  // of the bounds, which a hundred and sixty metres of track drags off everything: the',
  '  // densest clump of the storey being drawn — the concourse, where the gates, the ticket',
  '  // machines, the shops and the signs all are. Modules are binned into 8 m squares and',
  '  // the fullest bin wins; the cut goes through its middle, so what the camera looks into',
  '  // is the part of the station with the most in it, and the framing is aimed there too.',
  '  let hotspot = null',
  '  if (__HOTSPOT__) {',
  '    const z = s.activeZ',
  '    const bins = new Map()',
  '    for (const m of s.station.modules) {',
  '      if (m.z !== z) continue',
  '      const k = Math.floor((m.x + 0.5) / 8) + "," + Math.floor((m.y + 0.5) / 8)',
  '      const b = bins.get(k) || { n: 0, x: 0, y: 0 }',
  '      b.n++; b.x += m.x; b.y += m.y',
  '      bins.set(k, b)',
  '    }',
  '    let best = null',
  '    for (const b of bins.values()) if (!best || b.n > best.n) best = b',
  '    if (best) {',
  '      hotspot = [best.x / best.n, best.y / best.n, z]',
  '      s.placeSection(hotspot)',
  '      window.__scene.setSection(s.section, true)',
  '    }',
  '  }',
  '  const preset = __PRESET__',
  '  const cs = window.__scene.cameraSys',
  '  const cam = cs.camera',
  '  if (preset !== "custom") cs.setPreset(preset)',
  '  // The wheel keeps its own orthographic zoom; reset it so no flat view is left',
  '  // closer or further than the others.',
  '  cs.orthoZoom = 1',
  '  cs.syncOrtho()',
  '  // **Snap to a corner of the nav cube**, which is what clicking one does (`ViewCube`\'s',
  '  // `corner:` action: `setViewDirection(vertex, false)`, back to perspective). The',
  '  // widget draws its cube from the camera\'s own quaternion, so with a corner named the',
  '  // cube comes out a **box with three faces on it** rather than the flat projection a',
  '  // level camera leaves it in — and the pan arrows and the depth rail come with it.',
  '  if (__CORNER__) {',
  '    const THREE = cs.camera.position.constructor',
  '    cs.setViewDirection(new THREE(__CORNER__[0], __CORNER__[1], __CORNER__[2]).normalize(), false)',
  '    cs.setOrtho(false)',
  '    s.setOrtho(false)',
  '  }',
  '  // **Only a view with a cut touches the cut.** `setSection` is what makes the renderer',
  '  // re-read the plane — and it also puts the cut\'s direction arrow on the stage, so a',
  '  // view with no 剖切 that called it would photograph a green arrow standing in the hall.',
  '  if (__CUT__) {',
  '    // **The quarter turn is a counter, not an angle.** `rotateSection` steps it 90° and',
  '    // the store keeps whatever the last view left, so a view that asks for two turns gets',
  '    // two more than the view before it. Step it to the angle this view names rather than',
  '    // to a number of presses, so each tile\'s cut is the one its card describes.',
  '    for (let i = 0; i < 4 && s.section.orientation.azimuth !== __CUT_AZ__; i++) s.rotateSection()',
  '    // The renderer keeps the plane it was last handed, so without this the turn above',
  '    // changes the card\'s key and nothing else, and all four turns photograph one cut.',
  '    window.__scene.setSection(s.section, true)',
  '  }',
  '  cs.pointerInside = false',
  '',
  '  // **The interior shot.** The game has no key for "stand in the concourse", so the',
  '  // place is found rather than asked for: the storey with the most open floor, then',
  '  // the cell on it with the longest clear run in any of the four directions, taken at',
  '  // head height and looking down that run. Nothing is named — a station with a',
  '  // different shape, or none of this level, lands wherever its own open floor is.',
  '  let eye = null',
  '  if (__EYE__) {',
  '    const cells = s.station.cells',
  '    const solid = new Set(cells.map((c) => c.x + "," + c.y + "," + c.z))',
  '    const solidAt = (x, y, z) => solid.has(x + "," + y + "," + z)',
  '    const byZ = new Map()',
  '    for (const c of cells) {',
  '      if (!byZ.has(c.z)) byZ.set(c.z, [])',
  '      byZ.get(c.z).push(c)',
  '    }',
  '    // Where a storey\'s **contents** are: the middle of the modules standing on it. A',
  '    // camera is aimed here, because the pieces are what a station is made of and the',
  '    // cells are only the shell around them — and it is **that storey\'s** pieces rather',
  '    // than the whole station\'s, or a hall two levels down drags the aim, and the camera',
  '    // with it, off the floor the camera is standing on.',
  '    const centreOf = (z) => {',
  '      let cx = 0, cy = 0, n = 0',
  '      for (const m of s.station.modules) if (m.z === z) { cx += m.x; cy += m.y; n++ }',
  '      return n ? { x: cx / n, y: cy / n } : null',
  '    }',
  '    // The storeys worth standing on: the four with the most air over their floor (see',
  '    // the undercroft note above). The one whose busiest cell has the most room around',
  '    // it wins, so a mezzanine under a slab is passed over for the hall above it.',
  '    const openOver = (z) => {',
  '      let n = 0',
  '      for (const c of byZ.get(z) || []) for (let dz = 1; dz <= 4; dz++) if (!solidAt(c.x, c.y, z + dz)) n++',
  '      return n',
  '    }',
  '    const roomAround = (x, y, z) => {',
  '      let n = 0',
  '      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {',
  '        for (const k of [1, 3, 6]) if (!solidAt(x + dx * k, y + dy * k, z)) n++',
  '      }',
  '      return n',
  '    }',
  '    // **The storey the sheet is shot from comes first.** Every view here is taken from',
  '    // the active storey (`__DEPTH__`), so the interior shot belongs to the same storey as',
  '    // the rest of the card — a camera dropped onto whichever storey this ranking happened',
  '    // to like is a picture of somewhere else. A storey with no open floor of its own',
  '    // simply falls through to the ranking.',
  '    const ranked = [...byZ.keys()].sort((a, b) => openOver(b) - openOver(a))',
  '    const shortlist = (byZ.has(s.activeZ) ? [s.activeZ, ...ranked.filter((z) => z !== s.activeZ)] : ranked).slice(0, 4)',
  '    let pick = null',
  '    for (const z of shortlist) {',
  '      const centre = centreOf(z)',
  '      if (!centre) continue',
  '      const zEye = z + 2',
  '      for (const c of byZ.get(z) || []) {',
  '        if (solidAt(c.x, c.y, zEye)) continue',
  '        const room = roomAround(c.x, c.y, zEye)',
  '        if (room < 9) continue',
  '        // How much of this storey this cell can see: its modules within 40 m along the',
  '        // straight line to the middle of the contents. A cell whose view to the middle',
  '        // is walled off scores 0 however roomy it is, which is what keeps the camera',
  '        // off the station\'s rim, looking out at the street.',
  '        let seen = 0',
  '        for (const m of s.station.modules) {',
  '          if (m.z !== z) continue',
  '          const dx = m.x - c.x, dy = m.y - c.y',
  '          const d = Math.hypot(dx, dy)',
  '          if (d < 2 || d > 40) continue',
  '          const ux = dx / d, uy = dy / d',
  '          const toCore = Math.abs((centre.x - c.x) * uy - (centre.y - c.y) * ux)',
  '          if (toCore > 8) continue',
  '          let clear = true',
  '          for (let t = 2; t < d; t += 2) {',
  '            if (solidAt(Math.round(c.x + ux * t), Math.round(c.y + uy * t), zEye)) { clear = false; break }',
  '          }',
  '          if (clear) seen++',
  '        }',
  '        const score = seen * 1000 + room',
  '        if (seen > 0 && (!pick || score > pick.score))',
  '          pick = { x: c.x, y: c.y, z, zEye, seen, room, score, dx: centre.x - c.x, dy: centre.y - c.y }',
  '      }',
  '    }',
  '    if (pick) {',
  '      const THREE = cs.camera.position.constructor',
  '      const len = Math.hypot(pick.dx, pick.dy) || 1',
  '      const ux = pick.dx / len',
  '      const uy = pick.dy / len',
  '      // **Back off the wall.** The roomiest cell that can see the station can still be',
  '      // the one right in front of a shopfront, and a camera there is a photograph of a',
  '      // window. Step away from the aim until the eye has room all round it, so the',
  '      // frame holds a space rather than a surface.',
  '      let at2 = { x: pick.x, y: pick.y }',
  '      for (let step = 1; step <= 8; step++) {',
  '        const nx = Math.round(pick.x - ux * step)',
  '        const ny = Math.round(pick.y - uy * step)',
  '        if (solidAt(nx, ny, pick.zEye)) break',
  '        let free = 0',
  '        for (let rx = -4; rx <= 4; rx++) for (let ry = -4; ry <= 4; ry++) if (!solidAt(nx + rx, ny + ry, pick.zEye)) free++',
  '        if (free > 46) { at2 = { x: nx, y: ny }; break }',
  '      }',
  '      // **Look down the clearest run.** A camera pointed at the middle of the contents is',
  '      // a camera pointed at the nearest wall whenever the middle of a hall is the back of',
  '      // a shopfront, which is what this shot kept coming back as. The four axis directions',
  '      // are measured instead and the longest open one is the view — a concourse, a hall, a',
  '      // platform, which is what standing in a station actually looks like. Only a cell',
  '      // walled in on all four sides falls back to the contents.',
  '      const runOf = (dx, dy) => {',
  '        let n = 0',
  '        while (n < 60 && !solidAt(Math.round(at2.x + dx * (n + 1)), Math.round(at2.y + dy * (n + 1)), pick.zEye)) n++',
  '        return n',
  '      }',
  '      let runBest = null',
  '      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {',
  '        const run = runOf(dx, dy)',
  '        if (!runBest || run > runBest.run) runBest = { run, dx, dy }',
  '      }',
  '      const toward = runBest && runBest.run >= 12 ? runBest : { dx: ux, dy: uy }',
  '      const at = new THREE(at2.x + 0.5, at2.y + 0.5, pick.z + 2)',
  '      const aim = new THREE(at.x + toward.dx * 45, at.y + toward.dy * 45, at.z)',
  '      cs.setOrtho(false)',
  '      cs.controls.target.copy(aim)',
  '      cam.position.copy(at)',
  '      cam.up.set(0, 0, 1)',
  '      cam.lookAt(aim)',
  '      // OrbitControls re-derives the camera from its target on every frame, so a',
  '      // position written straight onto the camera is undone before the shot. The',
  '      // change has to go through the controls to survive a frame.',
  '      cs.controls.update()',
  '      cs.syncOrtho()',
  '      eye = { storey: pick.z, seen: pick.seen, room: pick.room, run: runBest ? runBest.run : 0, at: [at2.x, at2.y, pick.z], aim: [Math.round(aim.x), Math.round(aim.y)] }',
  '    }',
  '  }',
  '',
  '  // **Aim a view at the storey\'s contents.** The presets frame the whole station, whose',
  '  // bounds are mostly a hundred and sixty metres of track, so an isometric "the concourse,',
  '  // up close" taken straight from the preset lands on whatever the middle of those bounds',
  '  // happens to be — a roof slab, where this station has one. A view may ask to be aimed at',
  '  // the pieces instead: the middle of the modules standing on the active storey, with the',
  '  // camera keeping the direction the preset gave it.',
  '  if (__AIM__) {',
  '    const z = s.activeZ',
  '    let cx = 0, cy = 0, n = 0',
  '    for (const m of s.station.modules) if (m.z === z) { cx += m.x; cy += m.y; n++ }',
  '    // The busiest clump if the view asked for one, otherwise the whole storey\'s middle.',
  '    if (hotspot) { cx = hotspot[0]; cy = hotspot[1]; n = 1 }',
  '    if (n) {',
  '      const THREE = cs.camera.position.constructor',
  '      const aim = new THREE(cx / n + 0.5, cy / n + 0.5, z + 1)',
  '      const off = cam.position.clone().sub(cs.controls.target)',
  '      cs.controls.target.copy(aim)',
  '      cam.position.copy(aim).add(off)',
  '      cs.controls.update()',
  '      cs.syncOrtho()',
  '    }',
  '  }',
  '  // **A view may name what it looks at.** A cut that takes the station\'s east end away',
  '  // leaves nothing where the bounds centre used to be, so the framing has to follow the',
  '  // cut rather than the model.',
  '  if (__AIM_AT__) {',
  '    const THREE = cs.camera.position.constructor',
  '    const aim = new THREE(__AIM_AT__[0], __AIM_AT__[1], __AIM_AT__[2])',
  '    const off = cam.position.clone().sub(cs.controls.target)',
  '    cs.controls.target.copy(aim)',
  '    cam.position.copy(aim).add(off)',
  '    cs.controls.update()',
  '    cs.syncOrtho()',
  '  }',
  '',
  '  // **A lower eye for a section.** The presets look down at 30°, and a *vertical* cut read',
  '  // from 30° up is mostly a picture of the roof slabs the cut left standing — 剖切 does not',
  '  // lift ceilings (`sliceOptions`: a cut is the only thing allowed to hide anything), so',
  '  // the slab over each room is still there to be looked at. `__TILT__` re-aims the same',
  '  // compass direction at a lower elevation, so the cut face is what fills the frame, which',
  '  // is what a section is for.',
  '  if (__TILT__ !== null) {',
  '    const THREE = cs.camera.position.constructor',
  '    const at = cs.controls.target.clone()',
  '    const off = cam.position.clone().sub(at)',
  '    const flat = Math.hypot(off.x, off.y) || 1',
  '    const dir = new THREE(off.x / flat, off.y / flat, __TILT__).normalize()',
  '    cam.position.copy(at).addScaledVector(dir, off.length())',
  '    cam.up.set(0, 0, 1)',
  '    cam.lookAt(at)',
  '    cs.controls.update()',
  '    cs.syncOrtho()',
  '  }',
  '',
  '  // **Pan the view, as `D` does.** A cut placed on the hotspot is still framed by the',
  '  // preset\'s orbit offset, which can leave the station half a frame off the middle — and',
  '  // the ink crop cannot fix that, it only trims what is already there. `pan` slides the',
  '  // camera and its aim together along the screen\'s own right vector, which is exactly',
  '  // what holding D does (`CameraSystem.panCamera`: right = (dir.y, -dir.x, 0)), so the',
  '  // tile is composed rather than cropped. Positive is D, negative is A.',
  '  if (__PAN__) {',
  '    const THREE = cs.camera.position.constructor',
  '    const dir = new THREE()',
  '    cam.getWorldDirection(dir)',
  '    dir.z = 0',
  '    if (dir.lengthSq() > 1e-6) {',
  '      dir.normalize()',
  '      const step = new THREE(dir.y, -dir.x, 0).multiplyScalar(__PAN__)',
  '      cam.position.add(step)',
  '      cs.controls.target.add(step)',
  '      cs.controls.update()',
  '      cs.syncOrtho()',
  '    }',
  '  }',
  '',
  '  // **Fit a flat view to the frame.** The preset places the camera at a fixed',
  '  // multiple of the bounds and `frame()` only re-targets it, so a flat view on its',
  '  // own leaves the station small in the middle of a wide viewport. The orthographic',
  '  // frustum is solved rather than hunted for: project the bounds onto the camera\'s',
  '  // own right/up axes and set the zoom that holds them plus a margin.',
  '  //',
  '  // **`__ZOOM__` is the close-up.** The demo is a long five-level station, so its',
  '  // bounds are mostly platform: a picture that holds all of it is a picture of a',
  '  // strip. A view may ask to be `__ZOOM__` times tighter, which centres the frame on',
  '  // the middle of the station and lets the ends run out of shot — the concourse and',
  '  // the circulating core are what is worth looking at. For a perspective view it',
  '  // shortens the camera distance; for a flat one it scales the frustum.',
  '  const ZOOM = __ZOOM__',
  '  const THREE = cs.camera.position.constructor',
  '  if (cs.orthoOn) {',
  '    // `setOrtho` copies the pose onto the ortho camera once, so sync before measuring:',
  '    // a preset that has moved the perspective camera since leaves it aimed from',
  '    // wherever it was, and measuring through a stale pose runs the zoom to a clamp.',
  '    cs.syncOrtho()',
  '    const bounds = window.__scene.ctx.bounds',
  '    const e = cam.matrixWorld.elements',
  '    const right = new THREE(e[0], e[1], e[2]).normalize()',
  '    const up = new THREE(e[4], e[5], e[6]).normalize()',
  '    const camEye = cam.position.clone()',
  '    let xr = 0',
  '    let yr = 0',
  '    for (const x of [bounds.min.x, bounds.max.x]) {',
  '      for (const y of [bounds.min.y, bounds.max.y]) {',
  '        for (const z of [bounds.min.z, bounds.max.z]) {',
  '          const d = new THREE(x, y, z).sub(camEye)',
  '          xr = Math.max(xr, Math.abs(d.dot(right)))',
  '          yr = Math.max(yr, Math.abs(d.dot(up)))',
  '        }',
  '      }',
  '    }',
  '    // `applyOrtho` builds the frustum from the bounds diagonal and the zoom',
  '    // (base = size.length * 0.7 * zoom), so the zoom that holds both axes is the',
  '    // larger of the two fits against that base.',
  '    const aspect = (cs.canvasW || innerWidth) / (cs.canvasH || innerHeight)',
  '    const base = bounds.getSize(cs.tmpSize ? cs.tmpSize : new THREE()).length() * 0.7',
  '    const fit = Math.max((xr * 1.08) / aspect, yr * 1.08)',
  '    cs.orthoZoom = Math.min(16, Math.max(0.06, fit / base / ZOOM))',
  '    cs.syncOrtho()',
  '  } else if (ZOOM !== 1) {',
  '    const d = cam.position.clone().sub(cs.controls.target)',
  '    cam.position.copy(cs.controls.target).addScaledVector(d, 1 / ZOOM)',
  '    // Through the controls, or the next frame puts the camera back where it was.',
  '    cs.controls.update()',
  '  }',
  '  // The lens: the game opens at 45°, and the interior shot wants a wider one to',
  '  // hold a hall rather than a doorway.',
  '  cs.setFov(__FOV__)',
  '  return {',
  '    ortho: cs.orthoOn,',
  '    cells: s.station.cells.length,',
  '    modules: s.station.modules.length,',
  '    zoom: +cs.orthoZoom.toFixed(3),',
  '    dist: +cam.position.distanceTo(cs.controls.target).toFixed(1),',
  '    fov: __FOV__,',
  '    activeZ: s.activeZ,',
  '    levels: [...new Set(s.station.cells.map((c) => c.z))].sort((a, b) => b - a),',
  '    eye,',
  '  }',
  '})()',
].join('\n')

const shoot = async (clip) => {
  const r = await session.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
  })
  if (!r?.data) throw new Error('no pixels came back')
  return r.data
}

try {
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: scale,
    mobile: false,
    screenWidth: WIDTH,
    screenHeight: HEIGHT,
  })

  await waitFor(session.evaluate, '!!window.__scene && !!window.__metro', { what: 'the game' })
  // The demo station builds chunk by chunk; a dressed five-level station takes a
  // few seconds, and a photograph of half of it is worse than a slow one.
  await session.evaluate('new Promise((ok) => setTimeout(ok, 8000))')

  // The pointer rests at (0, 0) in a headless browser, which is inside the canvas
  // and against its edge: the camera's edge pan would walk the station out of frame
  // between the shot and the next one.
  await session.evaluate(`(() => {
    const cs = window.__scene.cameraSys
    cs.pointerX = Math.round(window.innerWidth / 2)
    cs.pointerY = Math.round(window.innerHeight / 2)
    cs.pointerInside = false
    cs.pointerButtons = 0
    return true
  })()`)

  /**
   * Take the page's own chrome out of a view shot — the rail, the panels, the bars, the
   * **view widget** and any toast — without moving anything.
   *
   * The widget sits over the canvas at the top right, so a tile that kept it carries the
   * game's UI in the corner of a picture of a station (and the ink scan then measures the
   * widget as part of the model, which is how the elevation tiles came back mostly empty
   * black). 隐藏UI is not the answer: the game's own 隐藏UI takes the 1 m lattice away and
   * deliberately leaves every panel and tool standing, and the widget has a tile of its
   * own further down the sheet. So the chrome goes `visibility:hidden` — **not**
   * `display:none` — because the canvas must keep the box it was framed in.
   */
  const setChrome = (hide) =>
    session.evaluate(`(() => {
      let style = document.getElementById('shot-chrome')
      if (!style) {
        style = document.createElement('style')
        style.id = 'shot-chrome'
        style.textContent = '[data-shot-hidden]{visibility:hidden !important}'
        document.head.appendChild(style)
      }
      for (const el of document.querySelectorAll('[data-shot-hidden]')) el.removeAttribute('data-shot-hidden')
      if (!${hide}) return 0
      const canvas = document.querySelector('canvas')
      if (!canvas) return 0
      const keep = new Set()
      for (let el = canvas; el; el = el.parentElement) keep.add(el)
      let n = 0
      for (const parent of keep) {
        for (const child of parent.children) {
          if (keep.has(child)) continue
          if (child.tagName === 'STYLE' || child.tagName === 'SCRIPT' || child.tagName === 'LINK') continue
          child.setAttribute('data-shot-hidden', '')
          n++
        }
      }
      return n
    })()`)

  /** Put the page in the state a view names. */
  const mount = async (view) => {
    const st = await session.evaluate(
      MOUNT_JS
        .replace(/__BARE__/g, String(Boolean(view.bare)))
        .replace(/__CUT__/g, String(Boolean(view.cut !== undefined)))
        .replace(/__SURFACE__/g, String(view.surface !== false))
        .replace(/__WALLS__/g, String(Boolean(view.walls)))
        .replace(/__GROUND__/g, String(Boolean(view.ground)))
        .replace(/__CUT_PLATFORM__/g, String(Boolean(view.sectionOnPlatform)))
        .replace(/__HOTSPOT__/g, String(Boolean(view.hotspot)))
        .replace(/__SECTION_AT__/g, view.sectionAt ? JSON.stringify(view.sectionAt) : 'null')
        .replace(/__PRESET__/g, JSON.stringify(view.preset))
        .replace(/__CUT_AZ__/g, String(((view.cut ?? 0) * 90) % 360))
        .replace(/__ZOOM__/g, String(view.zoom ?? 1))
        .replace(/__AIM__/g, String(Boolean(view.aim)))
        .replace(/__TILT__/g, view.tilt === undefined ? 'null' : String(view.tilt))
        .replace(/__PAN__/g, view.pan === undefined ? '0' : String(view.pan))
        .replace(/__CORNER__/g, view.corner ? JSON.stringify(view.corner) : 'null')
        .replace(/__AIM_AT__/g, view.aimAt ? JSON.stringify(view.aimAt) : 'null')
        .replace(/__EYE__/g, String(Boolean(view.eye)))
        .replace(/__DEPTH__/g, String(view.depth ?? -12))
        .replace(/__FOV__/g, String(view.fov ?? 45)),
    )
    // Two frames is a camera that has been installed and drawn; the extra beat is the
    // chunk mesher catching up with a storey the last view took away.
    await session.evaluate('new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ok, 900))))')
    // **Put the depth back.** The station builds in chunks and every chunk message
    // re-anchors the edited storey to the levels the worker reports (`SimSlice`), which
    // can land *after* the depth a view asked for and leave the first tile of a run shot
    // from somewhere else. Re-assert it once the page has settled, and give the slicing a
    // beat of its own if it had actually moved — so all six tiles are one storey.
    const depth = view.depth ?? -12
    const moved = await session.evaluate(`(() => {
      const s = window.__metro.getState()
      if (s.activeZ === ${depth}) return false
      s.setActiveZ(${depth})
      return true
    })()`)
    if (moved) await session.evaluate('new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ok, 900))))')
    // The chrome is off for a view and **on** for the widget's own tile, which is the one
    // card that is supposed to be a picture of the interface.
    await setChrome(!view.ui)
    await session.evaluate('new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ok, 250))))')
    return { ...st, activeZ: await session.evaluate('window.__metro.getState().activeZ') }
  }

  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  const index = { width: 0, height: 0, views: [] }
  let first = null

  for (const view of VIEWS) {
    const mounted = await mount(view)
    // The **widget** is the game's own DOM, so it is photographed rather than drawn: a
    // card cannot be a better picture of a control than the control. Its box is the
    // whole element, with no ink scan — the widget is a panel, and the panel is what
    // the card wants.
    if (view.ui) {
      const rect = await session.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(view.ui)})
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
      })()`)
      if (!rect) throw new Error(`no ${view.ui} on the page`)
      // A UI element wants more pixels than a 3D view does, because the sheet draws it
      // larger than it stands on screen. `deviceScaleFactor` is the lever; the clip stays
      // in CSS pixels and the density comes back in the image's own size.
      if (view.density && view.density !== scale) {
        await session.send('Emulation.setDeviceMetricsOverride', {
          width: WIDTH,
          height: HEIGHT,
          deviceScaleFactor: view.density,
          mobile: false,
          screenWidth: WIDTH,
          screenHeight: HEIGHT,
        })
        await session.evaluate('new Promise((ok) => requestAnimationFrame(() => setTimeout(ok, 400)))')
        const again = await session.evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(view.ui)})
          const r = el.getBoundingClientRect()
          return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
        })()`)
        Object.assign(rect, again)
      }
      const shot = await shoot(rect)
      const png = Buffer.from(shot, 'base64')
      writeFileSync(join(outDir, `${view.id}.png`), png)
      // The image's own pixel size — the clip is CSS pixels and the page renders at
      // `--scale`, so a card that sizes itself from the CSS box would draw the widget
      // small and floating. It is the pixels a card lays out with.
      const px = await session.evaluate(`(async () => {
        const img = new Image()
        await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = 'data:image/png;base64,${shot}' })
        return { width: img.naturalWidth, height: img.naturalHeight }
      })()`)
      index.width = Math.max(index.width, px.width)
      index.height = Math.max(index.height, px.height)
      index.views.push({ id: view.id, label: view.label, file: `${view.id}.png`, width: px.width, height: px.height, ui: view.ui })
      console.log(`ok    ${view.id.padEnd(14)} ${String(px.width).padStart(4)}x${String(px.height).padStart(4)}  ui       ${(png.length / 1024).toFixed(0)} KB`)
      // **Put the density back.** `deviceScaleFactor` belongs to the page, not to this
      // capture: left at 2 the next view's clip is taken at the wrong scale and comes
      // back with a strip of the build rail down its edge — the chrome the inset was
      // there to keep out. The next run's first view would inherit it too.
      await session.send('Emulation.setDeviceMetricsOverride', {
        width: WIDTH,
        height: HEIGHT,
        deviceScaleFactor: scale,
        mobile: false,
        screenWidth: WIDTH,
        screenHeight: HEIGHT,
      })
      await session.evaluate('new Promise((ok) => requestAnimationFrame(() => setTimeout(ok, 400)))')
      continue
    }
    // The WebGL canvas is the page's full-viewport background rather than a column of
    // the layout, and the **rail, the 信息栏, the bars and the 时刻 window are stacked
    // over it** — so the stage's own rectangle runs under all of them and a shot of it
    // catches a strip of the build rail down its left edge. Every panel is measured and
    // the shot is taken of what is left: the view, and nothing the chrome covers.
    const canvas = await session.evaluate(`(() => {
      const el = document.querySelector('.stage') || document.querySelector('canvas')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
    })()`)
    if (!canvas) throw new Error('no stage on the page')
    const chrome = await session.evaluate(`(() => {
      const box = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
      }
      return { rail: box('.rail'), panel: box('.panel'), topbar: box('.topbar'), bottombar: box('.bottombar') }
    })()`)
    // A few pixels of clearance past each panel: the rail draws a 1px border and the
    // widget sits on the right, and a strip of either in a tile is the one thing the
    // crop cannot fix after the fact — the ink scan keeps whatever is not background.
    const GUARD = 6
    const viewport = {
      x: Math.round(chrome?.rail ? Math.max(canvas.x, chrome.rail.right) + GUARD : canvas.x),
      y: Math.round(chrome?.topbar ? Math.max(canvas.y, chrome.topbar.bottom) + GUARD : canvas.y),
      width: 0,
      height: 0,
    }
    viewport.width = Math.round(
      (chrome?.panel ? Math.min(canvas.x + canvas.width, chrome.panel.left) - GUARD : canvas.x + canvas.width) - viewport.x,
    )
    viewport.height = Math.round(
      (chrome?.bottombar ? Math.min(canvas.y + canvas.height, chrome.bottombar.top) - GUARD : canvas.y + canvas.height) - viewport.y,
    )
    // **Shoot the page, crop the pixels in the page.** `Page.captureScreenshot`'s clip
    // is a trap here: with a device-metrics override in force it comes back offset from
    // the rectangle asked for, which is how a strip of the build rail kept appearing
    // along the left of every tile however the insets were computed. The full frame has
    // no such ambiguity, and the page can crop it exactly — it is the same canvas pass
    // that measures the ink below, so both steps share one coordinate space.
    const frame = await shoot()
    if (process.env.VIEWS_GEOMETRY) {
      console.log(`      stage ${JSON.stringify(canvas)} chrome ${JSON.stringify(chrome)} -> viewport ${JSON.stringify(viewport)}`)
    }

    // Crop to the station: the page draws the frame back into a canvas and reports
    // the box holding every pixel that is not the clear colour, so a card is the
    // model and not the empty stage around it.
    const box = await session.evaluate(`(async () => {
      const img = new Image()
      await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = 'data:image/png;base64,${frame}' })
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      // The viewport, in the image's own pixels: the frame is the page at the current
      // density, so the CSS rectangle scales by that density.
      const s = c.width / window.innerWidth
      const vx = Math.round(${viewport.x} * s)
      const vy = Math.round(${viewport.y} * s)
      const vw = Math.round(${viewport.width} * s)
      const vh = Math.round(${viewport.height} * s)
      const d = g.getImageData(vx, vy, vw, vh).data
      // The clear colour is the game's own sky/ground wash; anything a few steps away
      // from it is the station. Compare against the corner pixel rather than a literal,
      // so a palette change does not empty every card.
      const bg = [d[0], d[1], d[2]]
      const near = (i) => Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) < 24
      let x0 = vw, y0 = vh, x1 = -1, y1 = -1
      for (let y = 0; y < vh; y++) {
        for (let x = 0; x < vw; x++) {
          const i = (y * vw + x) * 4
          if (near(i)) continue
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
      }
      if (x1 < 0) return null
      return { x0, y0, x1, y1, w: vw, h: vh, s }
    })()`)

    const w = box ? box.x1 - box.x0 + 1 : 0
    const h = box ? box.y1 - box.y0 + 1 : 0
    // A hair of margin, so the station's own silhouette is not flush with the frame.
    const pad = Math.round(Math.max(w, h) * 0.04)
    // The crop is taken from the **viewport rectangle first**, in the frame's own pixels,
    // and the ink box only trims inside it. Doing it this way round is what keeps the
    // chrome out: the rectangle is the part of the page the panels do not cover, and the
    // ink scan can then only ever cut further in, never reach back out into a panel.
    const inkScale = box?.s ?? 1
    const vx = Math.round(viewport.x * inkScale)
    const vy = Math.round(viewport.y * inkScale)
    const vw = Math.round(viewport.width * inkScale)
    const vh = Math.round(viewport.height * inkScale)
    const crop = box
      ? {
          x: Math.max(0, vx + box.x0 - pad),
          y: Math.max(0, vy + box.y0 - pad),
          width: Math.min(box.w, w + pad * 2),
          height: Math.min(box.h, h + pad * 2),
        }
      : { x: vx, y: vy, width: vw, height: vh }

    // **Downscale to the size the sheet draws at.** A 3D view is the one picture on a
    // sheet that is mostly gradient and texture, so at full size eight of them are
    // megabytes of base64 in the SVG. Handing each frame back to the canvas at the
    // width a card can actually use keeps the sheet small and, because the sampler
    // averages, arguably reads better than a browser scaling it at paint time.
    const width = Math.max(1, Math.round(Math.min(MAX_W, crop.width)))
    const height = Math.max(1, Math.round((crop.height / crop.width) * width))
    const scaled = await session.evaluate(`(async () => {
      const img = new Image()
      await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = 'data:image/png;base64,${frame}' })
      const c = document.createElement('canvas')
      c.width = ${width}
      c.height = ${height}
      const g = c.getContext('2d')
      g.imageSmoothingEnabled = true
      g.imageSmoothingQuality = 'high'
      // Source rectangle in the frame's own pixels: the viewport crop, then the ink.
      g.drawImage(img, ${crop.x}, ${crop.y}, ${crop.width}, ${crop.height}, 0, 0, ${width}, ${height})
      return c.toDataURL('image/png').split(',')[1]
    })()`)
    const png = Buffer.from(scaled, 'base64')
    writeFileSync(join(outDir, `${view.id}.png`), png)

    if (!first) first = { width, height }
    index.width = Math.max(index.width, width)
    index.height = Math.max(index.height, height)
    index.views.push({
      id: view.id,
      label: view.label,
      file: `${view.id}.png`,
      width,
      height,
      ortho: mounted.ortho,
    })
    console.log(
      `ok    ${view.id.padEnd(14)} ${String(width).padStart(4)}x${String(height).padStart(4)}  ` +
        `${mounted.ortho ? 'ortho' : 'persp'}  zoom ${mounted.zoom}  dist ${mounted.dist}  fov ${mounted.fov}  ` +
        `depth ${mounted.activeZ}m` +
        `${mounted.eye ? `  eye ${JSON.stringify(mounted.eye)}` : ''}  ${(png.length / 1024).toFixed(0)} KB`,
    )
  }

  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 1) + '\n')
  console.log(`view shots: ${index.views.length} -> ${outDir}`)
} finally {
  await session.close()
  server.close()
}
