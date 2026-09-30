// Crowd-tick micro-benchmark for Metro Station Designer.
//
// Answers one question: can a single thread (the sim Web Worker, 5 Hz tick)
// step N individual agents with neighbour separation inside the tick budget?
//
// The shape matches GAME-SPEC.md 7.1-7.3: struct-of-arrays agent state, a
// uniform-grid neighbour search, a 2 m personal-space radius, a per-agent
// state machine, and a density speed derate. No dependencies, plain Node.
//
//   node tools/bench-crowd-tick.mjs <agents> <ticks> <allocPerTick> <astarPaths> <spreadM>
//
//   agents        concurrent agents to simulate          (default 3000)
//   ticks         ticks to time                          (default 1000)
//   allocPerTick  1 = allocate N objects per tick (GC)   (default 0)
//   astarPaths    A* calls in the burst test             (default 40)
//   spreadM       metres the crowd occupies; shrink it   (default 200)
//                 to model crush density (0.2 m^2/pax)
//
// Reference results (Node 24, desktop, 2 m grid cells):
//   agents  spread  mean ms/tick   p99     max    % of 200 ms tick
//    3,000     200       0.58      1.24    2.26        0.29%
//    3,000      25       3.92      5.31    6.40        1.96%   <- LOS F crush
//    8,000      42      14.18     19.80   22.26        7.09%   <- crush
//   15,000     200       3.72        --      --        1.86%
//   30,000     200      15.29        --      --        7.65%
//
//   A* burst, 520 uncached searches over a 200x200 grid @20% obstacles:
//     364-666 ms total, ~0.8 ms per search -> ~420 ms for one tick.
//   This is the only measurement that exceeds the budget, and it is the reason
//   the path cache keyed on (from, to, needsClass) in GAME-SPEC 7.2 is
//   load-bearing rather than an optimisation.

import { performance } from 'node:perf_hooks';

const N = Number(process.argv[2] || 3000);
const TICKS = Number(process.argv[3] || 1000);
const ALLOC = Number(process.argv[4] || 0) === 1;
const PATHS = Number(process.argv[5] || 40);
const SPREAD = Number(process.argv[6] || 200);
const HALF = SPREAD / 2;

const DT = 0.2; // 5 Hz

/* ---- agent state: struct of arrays, no per-agent objects ---- */
const pos = new Float32Array(N * 3);
const vel = new Float32Array(N * 3);
const tgt = new Float32Array(N * 3);
const speed = new Float32Array(N);
const timer = new Float32Array(N);
const state = new Uint8Array(N); // 0 = walking, 3 = queuing

/* ---- uniform grid: 2 m cells over a 256 x 256 m footprint ---- */
const CELL = 2.0, GW = 128, GH = 128, NC = GW * GH;
const counts = new Int32Array(NC);
const start = new Int32Array(NC + 1);
const order = new Int32Array(N);

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

for (let i = 0; i < N; i++) {
  const lvl = Math.floor(rnd() * 3) * -4.5;
  pos[i * 3] = rnd() * SPREAD - HALF;
  pos[i * 3 + 1] = rnd() * SPREAD - HALF;
  pos[i * 3 + 2] = lvl;
  tgt[i * 3] = rnd() * SPREAD - HALF;
  tgt[i * 3 + 1] = rnd() * SPREAD - HALF;
  tgt[i * 3 + 2] = lvl;
  speed[i] = 1.34;
  timer[i] = rnd() * 60;
  state[i] = rnd() < 0.5 ? 0 : 3;
}

const gxi = (i) => { const v = ((pos[i * 3] + 128) / CELL) | 0; return v < 0 ? 0 : v > GW - 1 ? GW - 1 : v; };
const gyi = (i) => { const v = ((pos[i * 3 + 1] + 128) / CELL) | 0; return v < 0 ? 0 : v > GH - 1 ? GH - 1 : v; };

let sink = 0;

function tick() {
  /* 1. bucket agents into the grid (counting sort, O(N), no allocation) */
  counts.fill(0);
  for (let i = 0; i < N; i++) counts[gyi(i) * GW + gxi(i)]++;
  let acc = 0;
  for (let c = 0; c < NC; c++) { start[c] = acc; acc += counts[c]; }
  start[NC] = acc;
  const cursor = counts; // reuse counts as the write cursor
  cursor.set(start.subarray(0, NC));
  for (let i = 0; i < N; i++) order[cursor[gyi(i) * GW + gxi(i)]++] = i;

  /* 2. per agent: neighbour separation, state machine, steering, integrate */
  for (let i = 0; i < N; i++) {
    const ix = pos[i * 3], iy = pos[i * 3 + 1];
    const cx = gxi(i), cy = gyi(i);
    let fx = 0, fy = 0;

    for (let oy = -1; oy <= 1; oy++) {
      const yy = cy + oy; if (yy < 0 || yy >= GH) continue;
      for (let ox = -1; ox <= 1; ox++) {
        const xx = cx + ox; if (xx < 0 || xx >= GW) continue;
        const c = yy * GW + xx;
        const s = start[c], e = start[c + 1];
        for (let k = s; k < e; k++) {
          const j = order[k];
          if (j === i) continue;
          const dx = pos[j * 3] - ix, dy = pos[j * 3 + 1] - iy;
          const d2 = dx * dx + dy * dy;
          if (d2 > 0.64 || d2 < 1e-9) continue; // 0.8 m personal space
          const d = Math.sqrt(d2);
          const w = (0.8 - d) / d;
          fx -= dx * w; fy -= dy * w;
        }
      }
    }

    /* the "other half" of a real tick: service and queue timers */
    if (state[i] === 3) {
      timer[i] -= DT;
      if (timer[i] <= 0) { state[i] = 0; timer[i] = 20 + (i & 31); }
    }

    /* head for the target, blended with separation */
    const tx = tgt[i * 3] - ix, ty = tgt[i * 3 + 1] - iy;
    const td = Math.sqrt(tx * tx + ty * ty) || 1e-6;
    let dx = (tx / td) * speed[i] + fx * 1.5;
    let dy = (ty / td) * speed[i] + fy * 1.5;
    const dm = Math.sqrt(dx * dx + dy * dy);
    if (dm > speed[i]) { const k = speed[i] / dm; dx *= k; dy *= k; }

    /* density speed derate, GAME-SPEC 10.3 */
    const derate = (1 + Math.abs(fx) + Math.abs(fy)) > 2 ? 0.55 : 1.0;

    vel[i * 3] = dx * derate;
    vel[i * 3 + 1] = dy * derate;
    pos[i * 3] += vel[i * 3] * DT;
    pos[i * 3 + 1] += vel[i * 3 + 1] * DT;

    if (dx * dx + dy * dy < 2.25) { // reached target, pick a new one
      tgt[i * 3] = rnd() * SPREAD - HALF;
      tgt[i * 3 + 1] = rnd() * SPREAD - HALF;
    }
    sink += pos[i * 3];
  }

  if (ALLOC) {
    const junk = [];
    for (let i = 0; i < N; i++) junk.push({ x: pos[i * 3], y: pos[i * 3 + 1], s: state[i] });
    sink += junk.length;
  }
}

/* ---- A* burst: a train dumps 520 agents that all re-path in one tick ---- */
const GW2 = 200, GH2 = 200, NC2 = GW2 * GH2;
const blocked = new Uint8Array(NC2);
for (let i = 0; i < NC2; i++) blocked[i] = rnd() < 0.2 ? 1 : 0;
const gScore = new Float32Array(NC2);
const cameFrom = new Int32Array(NC2);
const seen = new Int32Array(NC2);
const hN = new Int32Array(1 << 16), hP = new Float32Array(1 << 16);
let hLen = 0, epoch = 0;

function hPush(n, p) {
  let i = hLen++; hN[i] = n; hP[i] = p;
  while (i > 0) {
    const par = (i - 1) >> 1;
    if (hP[par] <= hP[i]) break;
    const tn = hN[par], tp = hP[par];
    hN[par] = hN[i]; hP[par] = hP[i]; hN[i] = tn; hP[i] = tp; i = par;
  }
}

function hPop() {
  const top = hN[0];
  hLen--;
  if (hLen) {
    hN[0] = hN[hLen]; hP[0] = hP[hLen];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < hLen && hP[l] < hP[m]) m = l;
      if (r < hLen && hP[r] < hP[m]) m = r;
      if (m === i) break;
      const tn = hN[m], tp = hP[m];
      hN[m] = hN[i]; hP[m] = hP[i]; hN[i] = tn; hP[i] = tp; i = m;
    }
  }
  return top;
}

function astar(sx, sy, ex, ey) {
  epoch++; hLen = 0;
  const S = sy * GW2 + sx, E = ey * GW2 + ex;
  gScore[S] = 0; seen[S] = epoch; cameFrom[S] = -1;
  hPush(S, Math.hypot(ex - sx, ey - sy));
  let expanded = 0;
  while (hLen) {
    const cur = hPop(); expanded++;
    if (cur === E) return expanded;
    const cx = cur % GW2, cy = (cur / GW2) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
      const ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= GW2 || ny >= GH2) continue;
      const nb = ny * GW2 + nx;
      if (blocked[nb]) continue;
      const g = gScore[cur] + 1;
      if (seen[nb] === epoch && gScore[nb] <= g) continue;
      seen[nb] = epoch; gScore[nb] = g; cameFrom[nb] = cur;
      hPush(nb, g + Math.hypot(ex - nx, ey - ny));
    }
  }
  return expanded;
}

/* ---------------------------------------------------------------- run */
function timeTicks(iters) {
  tick(); tick(); // warm up
  const samples = new Float64Array(iters);
  for (let t = 0; t < iters; t++) {
    const a = performance.now();
    tick();
    samples[t] = performance.now() - a;
  }
  const sorted = Array.from(samples).sort((x, y) => x - y);
  const q = (p) => sorted[Math.min(iters - 1, Math.floor(p * iters))];
  const total = sorted.reduce((s, v) => s + v, 0);
  return { mean: total / iters, p95: q(0.95), p99: q(0.99), max: sorted[iters - 1] };
}

const r = timeTicks(TICKS);

const t0 = performance.now();
let expanded = 0;
for (let p = 0; p < PATHS; p++) {
  expanded += astar((rnd() * 190) | 0, (rnd() * 190) | 0, (rnd() * 190) | 0, (rnd() * 190) | 0);
}
const astarMs = performance.now() - t0;

console.log(JSON.stringify({
  node: process.version,
  tick: {
    agents: N,
    spreadM: SPREAD,
    allocPerTick: ALLOC,
    meanMs: +r.mean.toFixed(3),
    p95Ms: +r.p95.toFixed(3),
    p99Ms: +r.p99.toFixed(3),
    maxMs: +r.max.toFixed(3),
    jitterMaxOverMean: +(r.max / r.mean).toFixed(1),
    pctOf200msTick: +((r.mean / 200) * 100).toFixed(2),
    headroomVs8msBudget: +(8 / r.mean).toFixed(1),
  },
  astarBurst: {
    paths: PATHS,
    totalMs: +astarMs.toFixed(1),
    msPerPath: +(astarMs / PATHS).toFixed(3),
    avgNodesExpanded: Math.round(expanded / PATHS),
    grid: `${GW2}x${GH2} @20% blocked`,
  },
  sink: Math.round(sink),
}, null, 2));
