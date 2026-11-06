// Chrome compositor recording. Actual frame timestamps are retained; FFmpeg
// converts the resulting variable-rate recording to the delivery frame rate.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

export async function connectRecorder(port) {
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const tab = tabs.find(t => t.type === 'page' && t.url.startsWith('http://127.0.0.1:'))
  if (!tab) throw new Error('Game capture tab missing')
  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((ok, bad) => { ws.addEventListener('open', ok, { once: true }); ws.addEventListener('error', bad, { once: true }) })
  let next = 1, sink = null
  const pending = new Map()
  const send = (method, params = {}) => new Promise((ok, bad) => {
    const id = next++, timer = setTimeout(() => { pending.delete(id); bad(new Error(`Recorder timeout: ${method}`)) }, 15000)
    pending.set(id, { ok, bad, timer }); ws.send(JSON.stringify({ id, method, params }))
  })
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer)
      m.error ? p.bad(new Error(m.error.message)) : p.ok(m.result)
    }
    if (m.method === 'Page.screencastFrame') {
      try { sink?.(m.params) } finally { send('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {}) }
    }
  })
  await send('Page.enable')
  return {
    async still({ output, width, height, render }) {
      let timer
      const frame = new Promise((ok, bad) => {
        timer = setTimeout(() => bad(new Error('Compositor still timed out')), 15000)
        sink = p => { clearTimeout(timer); ok(Buffer.from(p.data, 'base64')) }
      })
      // Use the same compositor path as the movie. Full-surface PNG readback can
      // stall on Windows hardware WebGL at 1440p, even while frames render.
      try {
        await send('Page.startScreencast', { format: 'jpeg', quality: 100, maxWidth: width, maxHeight: height, everyNthFrame: 1 })
        await render()
        writeFileSync(output, await frame)
      } finally {
        clearTimeout(timer)
        await send('Page.stopScreencast')
        sink = null
      }
    },
    async take({ directory, seconds, width, height, action }) {
      mkdirSync(directory, { recursive: true })
      const frames = []
      sink = p => {
        const file = `frame-${String(frames.length).padStart(5, '0')}.jpg`
        writeFileSync(resolve(directory, file), Buffer.from(p.data, 'base64'))
        frames.push({ file, timestamp: p.metadata.timestamp })
      }
      await send('Page.startScreencast', { format: 'jpeg', quality: 94, maxWidth: width, maxHeight: height, everyNthFrame: 1 })
      const started = performance.now()
      try {
        await action(started)
        await sleep(Math.max(0, seconds * 1000 - (performance.now() - started)))
      } finally {
        await send('Page.stopScreencast')
        sink = null
      }
      if (frames.length < 2) throw new Error('Recording produced fewer than two real frames')
      const first = frames[0].timestamp
      const rows = []
      for (let i = 0; i < frames.length; i++) {
        const begin = i === 0 ? 0 : frames[i].timestamp - first
        if (begin >= seconds) break
        const end = Math.min(seconds, frames[i + 1] ? frames[i + 1].timestamp - first : seconds)
        rows.push(`file '${frames[i].file}'`, `duration ${Math.max(.001, end - begin).toFixed(6)}`)
      }
      rows.push(`file '${frames.at(-1).file}'`)
      writeFileSync(resolve(directory, 'frames.ffconcat'), 'ffconcat version 1.0\n' + rows.join('\n') + '\n')
      writeFileSync(resolve(directory,'frames.json'),JSON.stringify(frames,null,2))
      const gaps = frames.slice(1).map((f, i) => f.timestamp - frames[i].timestamp).sort((a, b) => a - b)
      return { frames: frames.length, capturedSeconds: frames.at(-1).timestamp - first,
        medianFrameInterval: gaps[Math.floor(gaps.length / 2)], maxFrameInterval: gaps.at(-1) }
    },
    close() {
      for (const p of pending.values()) { clearTimeout(p.timer); p.bad(new Error('Recorder closed')) }
      pending.clear(); ws.close()
    },
  }
}
