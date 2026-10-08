// Concept sheet 02 — the vertical section.
//
// The building in it is drawn: a section through a stack of levels is a diagram, and the
// game has no station shaped like this one to photograph. The **cars** are not drawn —
// each is the game's own `buildTrain`, rendered square on (`side-` for the two lines the
// section runs along, `front-` for the one it cuts across) and placed at this sheet's own
// 26 px per metre, on the datum `sim/stock.ts` gives: a consist's origin rides the track
// bed half a metre under the platform, so a door sill lands a hand's width over it.
import {
  C, PCOL, TW, TH, ZU, boxSvg, rboxSvg, quadSvg, faceSvg, rampSvg, Scene, px, py, P, pstr, poly,
  T, MUL, tag, legend, title, sheet, callout, leader, rng, shade, n,
  amT, sway, breathe, spin, dashFlow, mover, group,
} from './iso.mjs';
import { carImage, trainCard } from './train-cards.mjs';
import { FINISH_LIST } from '../game/src/sim/finishes.ts';
import { PSD_FULL_HEIGHT } from '../game/src/sim/constants.ts';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PIECES_DIR = resolve(here, '..', process.env.PIECE_ELEVATIONS_DIR ?? join('.preview', 'piece-elevations'));

/**
 * The game's own pieces, seen square on.
 *
 * `tools/render-piece-elevations.mjs` frames each at one scale with its base on the
 * picture's bottom edge, so a piece is placed by putting that edge on a floor line — and
 * the metres it covers are its own pixels over `pxPerMetre * scale`, which is why the
 * index does not have to repeat them.
 */
let pieceCache = null;
function loadPieces() {
  if (pieceCache) return pieceCache;
  const indexPath = join(PIECES_DIR, 'index.json');
  if (!existsSync(indexPath)) {
    throw new Error(
      `no piece elevations in ${PIECES_DIR} — run:\n  npm run build:game\n  node tools/render-piece-elevations.mjs`,
    );
  }
  const data = JSON.parse(readFileSync(indexPath, 'utf8'));
  pieceCache = new Map(
    data.pieces.map((p) => [
      p.id,
      { ...p, href: `data:image/png;base64,${readFileSync(join(PIECES_DIR, p.file)).toString('base64')}` },
    ]),
  );
  return pieceCache;
}

/**
 * A piece's elevation at the sheet's own scale, standing on `floorY`.
 *
 * The picture's bottom edge is the piece's base — that is the contract the pass frames
 * to — so placing it is putting that edge on a floor line, and nothing has to be nudged.
 */
function pieceAt(id, x, floorY) {
  const p = loadPieces().get(id);
  if (!p) throw new Error(`the piece pass has no \`${id}\` — re-run tools/render-piece-elevations.mjs`);
  const w = p.metres * S;
  const h = p.verticalMetres * S;
  return {
    w,
    h,
    svg: `<image x="${n(x)}" y="${n(floorY - h)}" width="${n(w)}" height="${n(h)}" href="${p.href}"/>`,
  };
}

/** The sheet's own scale: 26 px to the metre, the same one the section is drawn at. */
const S = 26;
const CONCRETE = '#' + FINISH_LIST.find(f => f.id === 'floor.concrete').tint.toString(16).padStart(6, '0');

/** Front elevation figures share the sheet's metre scale with the photographed models. */
function passenger(x, floor, color, phase = 0, bag = false) {
  const body = `<g data-model="passenger" transform="translate(${n(x)},${n(floor)})">`
    + '<ellipse cx="0" cy="0" rx="7" ry="2" fill="#23313c" opacity=".2"/>'
    + `<rect x="-5" y="-30" width="10" height="30" rx="4" fill="${color}"/>`
    + '<circle cx="0" cy="-35" r="5.5" fill="#c58e65"/>'
    + '<path d="M-5.5,-36 A5.5,5.5 0 0 1 5.5,-36" fill="#26303b"/>'
    + (bag ? '<rect x="5" y="-23" width="6" height="9" rx="2" fill="#efb735" stroke="#26303b"/>' : '')
    + '</g>';
  return group(body, amT('0 0;3 0;0 0', '', '10s', undefined, `${-phase}s`));
}
/** The game's datum — `sim/stock.ts`: the consist origin rides half a metre under the platform. */
const ORIGIN_BELOW_PLATFORM = 0.5;

/** A person that walks a path given in scene-local coordinates. */
const walkLocal = (S, path, col, begin, o = {}) =>
  S.fg.push([o.k ?? 1, mover(path, col, begin, { sprite: o.sprite ?? 'person', ...o })]);

/* =================================================================== *
 * 02  VERTICAL SECTION
 * =================================================================== */
export function artSection() {
  const W = 1600;
  const g = [];
  const GY = 430;
  // The game's storey grid is fixed at **4 m** (`sim/constants.ts`: "every 4 m from
  // +12 down to -32"), so the section's floors sit on it: a drawn storey is a storey,
  // and the depth rail on the left is those floors in metres.
  const SH = 4 * S;
  const B1f = GY + SH, B2f = B1f + SH, B3f = B2f + SH;
  const L1 = '#e5484d', L2 = '#2f7ef2', L3 = '#f2b32c';
  const CORE0 = 1140, CORE1 = 1532;

  g.push(`<rect x="0" y="0" width="${W}" height="${GY}" fill="#101825"/>`);
  g.push(`<rect x="0" y="0" width="${W}" height="${GY}" fill="url(#glow)"/>`);
  g.push(`<rect x="0" y="${GY}" width="${W}" height="${B3f + 160 - GY}" fill="url(#soilHatch)"/>`);
  g.push(`<rect x="0" y="${GY}" width="${W}" height="9" fill="${CONCRETE}"/>`);
  const grain = rng(43);
  g.push('<defs><pattern id="section-concrete-grain" width="64" height="64" patternUnits="userSpaceOnUse">'
    + Array.from({ length: 90 }, (_, i) => `<circle cx="${n(grain() * 64)}" cy="${n(grain() * 64)}" r="${n(.2 + grain() * .6)}" fill="${i % 2 ? '#fff' : '#000'}" opacity=".12"/>`).join('')
    + '</pattern></defs>');
  g.push(title(48, 56, '一座车站，叠了好几层', '动物园站：街面出入口、地下站厅与三条线路，共用一组竖向交通。'));

  /* ---- Line 1 on its viaduct: a real A-type car, wheels on the deck ---- */
  const deckY = GY - 8 * S;
  g.push(`<rect x="180" y="${deckY}" width="800" height="26" fill="#8a939f" stroke="${C.ink}" stroke-width="2.5"/>`);
  for (let x = 250; x <= 900; x += 216) {
    g.push(`<rect x="${x}" y="${deckY + 26}" width="34" height="${GY - deckY - 26}" fill="#6c757f" stroke="${C.ink}" stroke-width="2.5"/>`);
    g.push(`<rect x="${x - 14}" y="${GY - 14}" width="62" height="14" fill="#5b6570"/>`);
  }
  // The car sits on the deck: `z = 0` is its rail line, and an elevated line carries its
  // rail on the deck's own top face.
  g.push(trainRun(carImage(trainCard('side-A'), 580, deckY, S).svg, 24, '14s'));
  // The catenary is the **line's**, not the car's — the game hangs its wire from the
  // track model — so it is still drawn, minus the pantograph a hand-drawn car used to
  // carry: `buildTrain` has no current collector to show.
  g.push(`<path d="M150,${deckY - 130} L1010,${deckY - 130}" stroke="#f0c000" stroke-width="3.5"/>`);
  for (let x = 200; x <= 960; x += 152) g.push(`<path d="M${x},${deckY - 130} L${x},${deckY - 116}" stroke="#f0c000" stroke-width="2"/>`);
  g.push(`<rect x="174" y="${deckY + 40}" width="356" height="42" rx="7" fill="#0b1119" opacity=".82"/>`);
  g.push(T(180, deckY + 56, '1 号线  —  A 型 6 节  —  接触网 1500 V 直流  —  无屏蔽门', { size: 13, fill: L1, weight: 700 }));
  g.push(T(180, deckY + 76, '地面以上：站台敞着，风吹日晒都躲不掉', { size: 12, fill: '#8fa0b3' }));

  const stationBox = (x0, y0, x1, y1) =>
    g.push(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#0d1219" stroke="#2a3542" stroke-width="2"/>`);

  const room = (x0, x1, yTop, yFloor, name, col, sub) => {
    g.push(`<rect x="${x0}" y="${yTop}" width="${x1 - x0}" height="${yFloor - yTop}" fill="${CONCRETE}"/>`);
    g.push(`<rect x="${x0}" y="${yTop}" width="${x1 - x0}" height="${yFloor - yTop}" fill="url(#section-concrete-grain)"/>`);
    g.push(`<rect x="${x0}" y="${yTop}" width="${x1 - x0}" height="${yFloor - yTop}" fill="none" stroke="#39465a" stroke-width="2"/>`);
    g.push(`<rect x="${x0}" y="${yFloor - 18}" width="${x1 - x0}" height="18" fill="#5b6570"/>`);
    g.push(`<rect x="${x0}" y="${yFloor - 18}" width="${x1 - x0}" height="4" fill="#d4d7da"/>`);
    g.push(`<path d="M${x0 + 12},${yTop + 7} H${x1 - 12}" stroke="#e8edf0" stroke-width="3"/>`);
    g.push(T(x0 + 18, yTop + 30, name, { size: 15, weight: 800, fill: col, ls: 1.2 }));
    if (sub) g.push(T(x0 + 18, yTop + 50, sub, { size: 11.5, fill: '#273443' }));
  };

  /* ---- the core first: it is a shaft in its own right ---- */
  stationBox(200, GY, 1140, B3f);
  stationBox(CORE0, GY - 104, CORE1, B3f);
  room(200, 1140, GY, B1f, '', '#8fa3ba', '');
  room(200, 1140, B1f, B2f, 'B2   2 号线站台', '#164b89', 'B 型车 / 第三轨 / 屏蔽门');
  room(200, 1140, B2f, B3f, 'B3   3 号线站台', '#694500', 'C 型车 / 第三轨 / 横断面');
  room(CORE0, CORE1, GY, B3f, '', '#273443', '');

  /* ---- surface: plaza, pavilion over the core, ad board ---- */
  g.push(T(600, 350, '地面   0.0 米', { size: 15, fill: '#cfe0f0', weight: 800, ls: 1.2 }));
  g.push(T(600, 372, '站前广场，公交和出租车停靠，两个出入口', { size: 12.5, fill: '#9fb3c8' }));
  // The entrance is the game's covered 出入口, on the ground and to scale — the box that
  // used to stand here was 12 m wide and 6 m tall, where the piece is 8.4 m by 3.9 m.
  const entry = pieceAt('exit-covered-1', (CORE0 + CORE1) / 2 - (8.35 * S) / 2, GY);
  g.push(entry.svg);
  g.push(T((CORE0 + CORE1) / 2, GY - 3.88 * S - 58, '地铁', { size: 26, weight: 800, fill: '#cfe0f0', anchor: 'middle', ls: 4 }));
  g.push(T((CORE0 + CORE1) / 2, GY - 3.88 * S - 22, '出入口', { size: 11.5, fill: C.exitRed, weight: 800, anchor: 'middle' }));

  /* ---- vertical circulation inside the core ---- */
  const band = (x0, y0, x1, y1, t, col, label) => {
    g.push(`<polygon points="${x0},${y0} ${x1},${y1} ${x1},${y1 + t} ${x0},${y0 + t}" fill="${col}" opacity=".92" stroke="${C.ink}" stroke-width="2"/>`);
    g.push(`<path d="M${x0 + 8},${y0 + (y1 - y0) / 2 + 6} L${x1 - 8},${y1 + (y1 - y0) / 2 + 6}" stroke="#08111a" stroke-width="2" opacity=".3"/>`);
    // the truss carries steps: dashes march along the run, showing which way it moves
    g.push(`<path d="M${x0 + 8},${y0 + t / 2} L${x1 - 8},${y1 + t / 2}" stroke="#08111a" stroke-width="4" stroke-dasharray="9 11" opacity=".55" fill="none" ${dashFlow(20, '1.5s')}/>`);
    if (label) g.push(T((x0 + x1) / 2, (y0 + y1) / 2 + 14, label, { size: 12.5, fill: '#08111a', anchor: 'middle', weight: 800 }));
  };
  // The runs are the game's own pieces, one per floor pair. A piece's picture has its
  // **lower landing on the bottom edge** — that is what the pass frames to — so a run is
  // placed by its lower floor and nothing is nudged. A 扶梯's balustrade stands a metre
  // or so above the floor it arrives at, which lands in the core's own void rather than
  // through a slab: the rooms stop at the core wall.
  for (const floor of [B1f, B2f, B3f]) g.push(pieceAt('escalator', 1150, floor).svg);
  for (const floor of [B2f, B3f]) g.push(pieceAt('stair-straight', 1358, floor).svg);
  // Continuous landing band spans the core on all four levels and covers the run heads.
  for (const y of [GY, B1f, B2f, B3f]) {
    g.push(`<rect data-layer="circulation-landing" x="${CORE0}" y="${y}" width="${CORE1 - CORE0}" height="10" fill="#5b6570"/>`);
    g.push(`<rect x="${CORE0}" y="${y}" width="${CORE1 - CORE0}" height="3" fill="#d4d7da"/>`);
  }
  g.push(T(1150, B3f + 22, '扶梯 ×3', { size: 11.5, fill: C.asc, weight: 800 }));
  g.push(T(1358, B3f + 22, '楼梯 ×2', { size: 11.5, fill: C.yellow, weight: 800 }));
  const shaft = pieceAt('lift-shaft', 1146, B3f);
  // Cutaway treatment retains the game shaft silhouette but exposes the moving cabin.
  g.push(`<g data-layer="lift-shaft-cutaway">`
    + `<rect x="1146" y="${n(B3f - shaft.h)}" width="${n(shaft.w)}" height="${n(shaft.h)}" fill="#17222c"/>`
    + `<g opacity=".24">${shaft.svg}</g>`
    + `<path d="M1148,${n(B3f - shaft.h)} V${B3f} M${n(1146 + shaft.w - 2)},${n(B3f - shaft.h)} V${B3f}" stroke="#a3adb6" stroke-width="2"/>`
    + '</g>');
  // one cab, travelling the shaft: ground down to B3 and back
  // The cabin is the game's too, and its own picture's bottom edge is its floor — so the
  // travel is the shaft's height and no more. (It used to be `B3f - GY - 4` from a cab
  // drawn with its *top* at the ground, which carried the car clean through the floor.)
  const cabin = pieceAt('lift-car', 1152, GY);
  const travel = B3f - GY;
  const visibleCabin = cabin.svg
    + `<rect x="1152" y="${n(GY - cabin.h)}" width="${n(cabin.w)}" height="${n(cabin.h)}" fill="none" stroke="#8ec9e6" stroke-width="1.8"/>`
    + passenger(1167, GY - 5, C.teal, 0)
    + passenger(1183, GY - 5, C.orange, 0);
  g.push(group(visibleCabin,
    amT(`0 0;0 0;0 ${travel};0 ${travel};0 0;0 0`, '0;0.12;0.44;0.76;0.88;1', '13s',
      '0.4 0 0.2 1;0 0 1 1;0.4 0 0.2 1;0 0 1 1;0 0 1 1')));
  g.push(T(1171, GY - 14, '电梯', { size: 11.5, fill: '#9fb3c8', weight: 800, anchor: 'middle' }));
  g.push(T(CORE0 + 6, B3f + 42, '竖向交通核：扶梯、楼梯、电梯各走各的运力', { size: 11.5, fill: '#7d8ea3', weight: 700, ls: 0.6 }));

  /* ---- B1 concourse contents: the game's own pieces, at this sheet's scale ---- */
  // A 闸机 is 1.38 m tall and a 售票机 2 m, so the row is shorter than the boxes that
  // used to stand here (2.4 m and 2.8 m) — which is the point of using the models.
  const gate = pieceAt('gate', 0, 0);
  const gatePitch = 34;
  for (let i = 0; i < 6; i++) g.push(pieceAt('gate', 700 + i * gatePitch, B1f).svg);
  g.push(`<rect x="696" y="${n(B1f - gate.h - 8)}" width="212" height="8" fill="${C.green}"/>`);
  g.push(T(696, n(B1f - gate.h - 18), '闸机 · 付费区边界', { size: 11.5, fill: '#174f35', weight: 700 }));
  const tvm = pieceAt('tvm', 0, 0);
  for (let i = 0; i < 4; i++) g.push(pieceAt('tvm', 400 + i * (tvm.w + 3), B1f).svg);
  g.push(T(396, n(B1f - tvm.h - 12), '自动售票机', { size: 12, fill: C.blue, weight: 800 }));
  // A 商铺 is a painted **area**, not a piece — `RoomModel`: "NO fit-out draws its furniture
  // here: shelves, desks, cubicles and sinks are modules of their own". So the room is
  // drawn and the fit-out is the game's: two 货架 standing inside it, front on, because a
  // shelf's stocked face is the one a shopper walks up to.
  const shopX = 236, shopW = 124;
  g.push(pieceAt('shelf', shopX + 16, B1f).svg);
  g.push(pieceAt('shelf', shopX + 54, B1f).svg);
  g.push(T(shopX + 16, B1f - 64, '货架', { size: 11.5, fill: '#473726', weight: 800 }));
  const vend = pieceAt('vending', 0, 0);
  for (let i = 0; i < 3; i++) g.push(pieceAt('vending', 950 + i * (vend.w + 3), B1f).svg);
  g.push(T(950, n(B1f - vend.h - 12), '自动售货机', { size: 12, fill: '#15514d', weight: 800 }));
  const board = pieceAt('billboard-panorama', 0, 0);
  g.push(pieceAt('billboard-panorama', 604, n(B1f - 0.95 * S)).svg);
  g.push(T(604, n(B1f - 0.95 * S - board.h - 8), '广告', { size: 12, fill: '#67334b', weight: 800 }));
  // B1's own name, last of the concourse's furniture so nothing stands in front of it.
  g.push(T(230, GY + 24, 'B1   水泥站厅', { size: 15, weight: 800, fill: '#273443', ls: 1.2 }));
  const colors = [C.red, C.blue, C.teal, C.purple, C.orange, C.pink, C.green];
  // Wall equipment and the barrier belong to the fixtures band; passengers paint last.
  for (const [id, x] of [['extinguisher', 365], ['bin', 552], ['door-steel-2', 1072]])
    g.push(pieceAt(id, x, B1f).svg);
  for (const x of [664, 914, 1040]) g.push(pieceAt('fence', x, B1f).svg);
  for (let i = 0; i < 19; i++) {
    const x = 300 + i * 40 + (i % 3 - 1) * 5;
    g.push(passenger(x, B1f - 2, colors[i % 7], i * .4, i % 4 === 0));
  }
  for (const x of [540, 786, 1030]) g.push(passenger(x, GY - 2, colors[x % 7], x / 100, true));
  g.push(pieceAt('bin', 1080, GY).svg);

  /* ---- trains on their platforms ---- */
  const plat = (fy, col, line, psd) => {
    const platformY = fy - 24;
    // The screen stands on the platform and is `PSD_FULL_HEIGHT` tall, so it is drawn
    // tall: an under-height screen would be a claim the game does not make.
    // The screen is the game's own 屏蔽门, one run long enough for the platform: it repeats
    // its header down the run and cuts an opening wherever the line's car doors land, so it
    // replaces both the dashed box and the door guides. It is drawn **after** the car,
    // because it stands between the reader and the train — and its panels are glass, so the
    // car's own doors still read through it.
    const psdRun = psd ? pieceAt('platform-edge', 514, platformY) : null;
    // A B-type car on the platform, on the game's own datum: its origin rides half a
    // metre under the platform surface, which is what puts the door sill a hand's width
    // over the edge rather than at it.
    const car = carImage(trainCard(`side-${line === '2' ? 'B' : 'L'}`), 790, platformY + ORIGIN_BELOW_PLATFORM * S, S);
    g.push(trainRun(car.svg, 26, '14s'));
    if (psdRun) g.push(`<g data-layer="b2-screen-doors">${psdRun.svg}</g>`);
    g.push(`<rect x="${n(car.x - 34)}" y="${platformY}" width="${n(car.w + 68)}" height="7" fill="${C.yellow}"/>`);
    for (const ax of [car.x + 100, car.x + 270, car.x + 440]) {
      g.push(`<path d="M${ax},${fy - 36} l0,12 m-6,-7 l6,7 l6,-7" stroke="${C.yellow}" stroke-width="2.5" fill="none"/>`);
      g.push(`<path d="M${ax + 24},${fy - 24} l0,-12 m-6,7 l6,-7 l6,7" stroke="#2fb344" stroke-width="2.5" fill="none"/>`);
    }
  };
  plat(B2f, L2, '2', true);
  for (const [id, x] of [['bench-steel-1', 260], ['bin', 312], ['extinguisher', 460]])
    g.push(pieceAt(id, x, B2f - 18).svg);
  for (let i = 0; i < 16; i++) g.push(passenger(350 + i * 48 + (i % 4 - 1.5) * 4,
    B2f - 18, colors[(i + 2) % 7], i, i % 5 === 0));

  /* ---- Line 3 is perpendicular to the other two, so the section cuts it
     across: the car is drawn end on and its tracks run into the page. ---- */
  const crossStation = (fy, col, line) => {
    const cx = 670;                                // middle of the B3 room
    const wallL = cx - 132, wallR = cx + 132;
    const boxTop = B2f;
    const platTop = fy - 18;                       // continuous with the surrounding B3 platform
    const railY = platTop + ORIGIN_BELOW_PLATFORM * S;
    const floorTop = railY + 19;                   // recessed track bed under the platform

    g.push(`<rect x="${wallL}" y="${boxTop}" width="${wallR - wallL}" height="${floorTop - boxTop}" fill="#0d1219" stroke="#39465a" stroke-width="2"/>`);
    g.push(`<rect x="${wallL}" y="${boxTop}" width="${wallR - wallL}" height="14" fill="#1b2430" stroke="#39465a" stroke-width="2"/>`);
    g.push(`<rect x="${wallL}" y="${boxTop}" width="12" height="${B3f - boxTop}" fill="#2a3542"/>`);
    g.push(`<rect x="${wallR - 12}" y="${boxTop}" width="12" height="${B3f - boxTop}" fill="#2a3542"/>`);

    // side platforms either side of the single track
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? wallL : cx + 38;
      const w = wallR - (cx + 38);
      g.push(`<rect x="${x0}" y="${platTop}" width="${w}" height="${floorTop - platTop}" fill="#5b6570"/>`);
      g.push(`<rect x="${x0}" y="${platTop}" width="${w}" height="4" fill="#d4d7da"/>`);
      g.push(`<rect x="${s < 0 ? cx - 38 - 18 : x0}" y="${platTop}" width="18" height="6" fill="${C.yellow}"/>`);
    }
    // track bed, running rails and third rail, all in cross-section
    g.push(`<rect x="${cx - 38}" y="${railY}" width="76" height="${floorTop - railY}" fill="#1a212b"/>`);
    for (const rx of [cx - 19, cx + 19]) g.push(`<rect x="${rx - 4}" y="${railY - 2}" width="8" height="9" fill="#8a939f" stroke="${C.ink}" stroke-width="1"/>`);
    g.push(`<rect x="${cx + 24}" y="${railY - 4}" width="9" height="10" fill="${C.psu}" stroke="${C.ink}" stroke-width="1"/>`);

    // The car, end on — the game's own C-type, seen square down the track. The station
    // around it (walls, platforms, bed, running rails, third rail) is drawn: it is what
    // the section is of.
    g.push(carImage(trainCard('front-C'), cx, railY, S).svg);
    // End-on section profiles: the PSDs run into the page beside the perpendicular
    // track. Their full height is the game's, rather than a front elevation pasted sideways.
    for (const x of [cx - 44, cx + 38]) {
      const h = PSD_FULL_HEIGHT * S, top = platTop - h;
      g.push(`<g data-layer="b3-screen-door-section">`
        + `<rect x="${x}" y="${n(top)}" width="6" height="${n(h)}" fill="${C.glass}" fill-opacity=".65" stroke="#a7b5bf" stroke-width="1.2"/>`
        + `<rect x="${x - 1}" y="${n(top)}" width="8" height="4" fill="#d4d7da"/>`
        + `<rect x="${x - 1}" y="${n(top + 4)}" width="8" height="2" fill="${C.yellow}"/>`
        + `<rect x="${x - 1}" y="${platTop - 3}" width="8" height="3" fill="#5b6570"/>`
        + '</g>');
    }
    g.push(T(cx, floorTop + 20, '横断面 · 屏蔽门立在两侧站台边缘', { size: 11, fill: '#a9b8c8', anchor: 'middle' }));

  };
  crossStation(B3f, L3, '3');
  for (const [id, x] of [['bench-steel-1', 240], ['bin', 290], ['extinguisher', 490],
    ['bench-steel-1', 850], ['door-steel-2', 1070], ['bin', 1032]])
    g.push(pieceAt(id, x, B3f - 18).svg);
  for (const [i, x] of [330, 362, 399, 430, 468, 837, 895, 929, 967, 1004].entries())
    g.push(passenger(x, B3f - 18, colors[(i + 4) % 7], i * .6, i % 3 === 0));

  /* ---- depth dimensions ---- */
  g.push(`<path d="M120,${deckY} V${B3f}" stroke="${C.yellow}" stroke-width="1.8"/>`);
  for (const [y, text] of [[deckY, '+8 米'], [GY, '0 米'], [B1f, '-4 米'], [B2f, '-8 米'], [B3f, '-12 米']]) {
    g.push(`<path d="M112,${y} H128" stroke="${C.yellow}" stroke-width="2"/>`);
    g.push(`<path d="M136,${y} H180" stroke="${C.yellow}" stroke-width="1" opacity=".35" stroke-dasharray="3 5"/>`);
    g.push(T(104, y + 5, text, { size: 13.5, fill: C.yellow, anchor: 'end', mono: true }));
  }

  /* ---- footnote strip ---- */
  const footY = B3f + 92;
  g.push(`<rect x="48" y="${footY}" width="1504" height="74" rx="12" fill="#0f1620" stroke="#243040"/>`);
  const notes = [
    [C.lineA, '1 号线在地面以上：接触网供电，站台敞着，没屏蔽门。'],
    [C.lineB, '2 号线在 B2 的屏蔽门后面，上车得按门一扇扇来。'],
    [C.lineC, '3 号线在 B3，还跟另外两条成直角：换乘＝竖着走一段，再横着走一段。'],
    [C.asc, '扶梯、楼梯、电梯都要自己摆，运力和速度各不相同。'],
    [C.green, '换乘客都是真人：走路、排队、刷卡、等车、上车。'],
    [C.yellow, '深度不是摆设，它就是步行、排队和站台密度。'],
  ];
  notes.forEach(([col, s], i) => {
    const cx = 70 + Math.floor(i / 3) * 740, cy = footY + 24 + (i % 3) * 18;
    g.push(`<rect x="${cx}" y="${cy - 9}" width="10" height="10" rx="2.5" fill="${col}"/>`);
    g.push(T(cx + 18, cy, s, { size: 11.5, fill: '#a9b8c8' }));
  });
  return sheet(W, footY + 74 + 28, g.join(''));
}

/** Wrap a train and give it the one motion a train has: it arrives, dwells, and leaves
 *  again. `amp` is the horizontal slide in px. The body is the game's own car. */
function trainRun(body, amp = 34, dur = '14s') {
  return group(body, amT(`0 0;0 0;${amp} 0;${amp} 0;0 0`, '0;0.2;0.5;0.7;1', dur,
    '0.4 0 0.6 1;0 0 1 1;0 0 1 1;0.4 0 0.6 1'));
}
