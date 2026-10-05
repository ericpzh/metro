// Headless perf probe: drives the running dev server through the Chrome
// DevTools Protocol and prints the live frame counters. Throwaway diagnostic.
const CDP_PORT = process.env.CDP_PORT ?? '9222'
const URL = process.env.PROBE_URL ?? 'http://localhost:5173/'

async function targets() {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
  return r.json()
}

function connect(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl)
    ws.onopen = () => res(ws)
    ws.onerror = (e) => rej(new Error('ws error ' + (e?.message ?? '')))
  })
}

let nextId = 1
function call(ws, method, params = {}) {
  const id = nextId++
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error(`timeout ${method}`)), 20000)
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id !== id) return
      clearTimeout(to)
      ws.removeEventListener('message', onMsg)
      if (m.error) rej(new Error(`${method}: ${JSON.stringify(m.error)}`))
      else res(m.result)
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(ws, expression) {
  const r = await call(ws, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) throw new Error('eval threw: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails))
  return r.result.value
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await targets()
const page = list.find((t) => t.type === 'page')
if (!page) {
  console.error('no page target; targets:', list.map((t) => `${t.type} ${t.url}`))
  process.exit(1)
}
const ws = await connect(page.webSocketDebuggerUrl)
await call(ws, 'Runtime.enable')
await call(ws, 'Log.enable')
call(ws, 'Page.navigate', { url: URL }).catch(() => {})

// Wait for the scene handle to appear (the app boots three.js lazily).
let ready = false
for (let i = 0; i < 120; i++) {
  await sleep(500)
  const ok = await evaluate(ws, 'typeof window.__scene === "object" && window.__scene !== null').catch(() => false)
  if (ok === true) {
    ready = true
    break
  }
}
if (!ready) {
  console.error('scene never appeared at', URL)
  const txt = await evaluate(ws, 'document.body.innerText.slice(0,500)').catch((e) => String(e))
  console.error('body:', txt)
  process.exit(2)
}

// Track rAF deltas from inside the page, so the number is the page's own.
await evaluate(
  ws,
  `(() => {
     window.__frameTimes = [];
     let last = performance.now();
     const tick = (now) => { window.__frameTimes.push(now - last); last = now; if (window.__frameTimes.length > 600) window.__frameTimes.shift(); requestAnimationFrame(tick); };
     requestAnimationFrame(tick);
     return true;
   })()`,
)

const sample = async (label) => {
  await evaluate(ws, 'window.__frameTimes.length = 0')
  await sleep(4000)
  const r = await evaluate(
    ws,
    `(() => {
       const f = window.__frameTimes.slice().sort((a,b) => a-b);
       const s = window.__scene;
       const h = s.__hud ?? null;
       const med = f.length ? f[Math.floor(f.length/2)] : 0;
       const p95 = f.length ? f[Math.floor(f.length*0.95)] : 0;
       return { frames: f.length, medianMs: +med.toFixed(2), p95Ms: +p95.toFixed(2), fps: med > 0 ? +(1000/med).toFixed(1) : 0 };
     })()`,
  )
  console.log(label, JSON.stringify(r))
}

console.log('--- baseline (as loaded) ---')
await sample('idle  ')

const stats = await evaluate(
  ws,
  `(() => {
      const s = window.__scene;
      const out = {};
      for (const k of Object.keys(s)) if (typeof s[k] !== 'object' || s[k] === null) out[k] = s[k];
      return out;
   })()`,
)
console.log('scene scalars:', JSON.stringify(stats))

ws.close()
