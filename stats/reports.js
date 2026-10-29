import { REPORTS_PER_DAY, REPORT_VOTES_PER_DAY, REPORT_PAGE_SIZE, REPORT_MAX_BODY, REPORT_SAVE_MAX_BYTES } from './limits.js'

const PUBLIC_FIELDS = `id, type, title, details, created_at AS createdAt, votes,
  EXISTS (SELECT 1 FROM report_saves s WHERE s.report_id = reports.id) AS hasSave,
  (SELECT filename FROM report_save_names n WHERE n.report_id = reports.id) AS saveName,
  (SELECT size_bytes FROM report_save_names n WHERE n.report_id = reports.id) AS saveSize,
  EXISTS (SELECT 1 FROM report_saves s WHERE s.report_id = reports.id AND s.is_share = 1) AS isShare,
  EXISTS (SELECT 1 FROM report_votes v WHERE v.report_id = reports.id AND v.ip_hash = ?) AS voted`

function publicIssue(row) {
  return { ...row, type: row.isShare ? 'share' : row.type, hasSave: Boolean(row.hasSave), isShare: undefined, votes: Number(row.votes), voted: Boolean(row.voted) }
}

// Daily limits are checked inside each INSERT, so concurrent requests cannot
// pass an advisory count together. No browser identity or raw address is stored.
export async function handleReports(request, db, route, helpers) {
  const { json, readPayload, submitAllowed, clientIpHash, isBlocked, env, cors } = helpers
  const reply = (body, status = 200, headers = {}) => json(body, { status, headers: { ...cors, ...headers } })
  const url = new URL(request.url)
  const voteMatch = /^\/v1\/reports\/([0-9a-f-]{36})\/vote$/.exec(route)
  const saveMatch = /^\/v1\/reports\/([0-9a-f-]{36})\/save$/.exec(route)
  const isList = route === '/v1/reports'
  if (!isList && !voteMatch && !saveMatch) return reply({ ok: false, error: 'not found' }, 404)
  const allowed = isList ? ['GET', 'POST'] : saveMatch ? ['GET'] : ['POST']
  if (!allowed.includes(request.method)) return reply({ ok: false, error: 'method not allowed' }, 405, { Allow: allowed.join(', ') })

  if (saveMatch) {
    const save = await db.prepare('SELECT content FROM report_save_chunks WHERE report_id = ? ORDER BY part').bind(saveMatch[1]).all()
    if (!save.results.length) return reply({ ok: false, error: 'not found' }, 404)
    const name = await db.prepare('SELECT filename FROM report_save_names WHERE report_id = ?').bind(saveMatch[1]).first()
    const filename = name?.filename || 'station-save.json'
    const encoded = encodeURIComponent(filename).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    return new Response(save.results.map(part => part.content).join(''), { headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="station-save.json"; filename*=UTF-8''${encoded}`, 'X-Content-Type-Options': 'nosniff' } })
  }
  if (request.method === 'GET') {
    const sort = url.searchParams.get('sort') || 'top'
    const type = url.searchParams.get('type') || 'all'
    const offsetText = url.searchParams.get('offset') || '0'
    if (!['top', 'new'].includes(sort) || !['all', 'bug', 'feature', 'share'].includes(type)
      || !/^\d{1,7}$/.test(offsetText)) return reply({ ok: false, error: 'invalid query' }, 400)
    const hash = await clientIpHash(request, env)
    const where = type === 'all' ? '' : type === 'share' ? 'WHERE EXISTS (SELECT 1 FROM report_saves s WHERE s.report_id = reports.id AND s.is_share = 1)' : 'WHERE type = ? AND NOT EXISTS (SELECT 1 FROM report_saves s WHERE s.report_id = reports.id AND s.is_share = 1)'
    const order = sort === 'new' ? 'created_at DESC, id DESC' : 'votes DESC, created_at DESC, id DESC'
    const args = [hash || '', ...(['all', 'share'].includes(type) ? [] : [type]), REPORT_PAGE_SIZE + 1, Number(offsetText)]
    const rows = await db.prepare(`SELECT ${PUBLIC_FIELDS} FROM reports ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...args).all()
    return reply({ ok: true, issues: rows.results.slice(0, REPORT_PAGE_SIZE).map(publicIssue), hasMore: rows.results.length > REPORT_PAGE_SIZE })
  }

  if (!submitAllowed(request)) return reply({ ok: false, error: 'forbidden' }, 403)
  const hash = await clientIpHash(request, env)
  // Feedback must never fall back to unlimited writes when hashing is missing.
  if (!hash) return reply({ ok: false, error: 'IP rate limiting unavailable' }, 503)
  if (await isBlocked(db, hash)) return reply({ ok: false, error: 'forbidden' }, 403)
  const timestamp = new Date().toISOString()
  const dayStart = timestamp.slice(0, 10) + 'T00:00:00.000Z'
  const retryAfter = Math.max(1, Math.ceil((Date.parse(dayStart) + 86400000 - Date.now()) / 1000))
  const limited = () => reply({ ok: false, error: 'rate limited' }, 429, { 'Retry-After': String(retryAfter) })

  if (isList) {
    const payload = await readPayload(request, cors, REPORT_MAX_BODY)
    if (payload.response) return payload.response
    const { type } = payload.body
    const title = typeof payload.body.title === 'string' ? payload.body.title.trim() : ''
    const details = typeof payload.body.details === 'string' ? payload.body.details.trim() : ''
    if (!['bug', 'feature', 'share'].includes(type) || title.length < 3 || title.length > 160 || details.length < 10 || details.length > 3000) {
      return reply({ ok: false, error: 'invalid report' }, 400)
    }
    const save = payload.body.save
    if (save !== undefined) {
      if (typeof save !== 'string' || new TextEncoder().encode(save).length > REPORT_SAVE_MAX_BYTES) return reply({ ok: false, error: 'invalid save' }, 400)
      try {
        const doc = JSON.parse(save)
        if (!doc || doc.format !== 'metro-save' || !Number.isInteger(doc.formatVersion) || !doc.static || !Array.isArray(doc.static.cells) || !Array.isArray(doc.static.modules) || !Array.isArray(doc.static.lines)) throw new Error('invalid')
      } catch { return reply({ ok: false, error: 'invalid save' }, 400) }
    }
    const filename = payload.body.saveName
    if (filename !== undefined && (save === undefined || typeof filename !== 'string' || filename.length < 1 || filename.length > 255 || /[\x00-\x1f\x7f\/\\]/.test(filename) || !filename.isWellFormed())) return reply({ ok: false, error: 'invalid filename' }, 400)
    if (type === 'share' && save === undefined) return reply({ ok: false, error: 'save required' }, 400)
    const id = crypto.randomUUID()
    const insert = db.prepare(`INSERT INTO reports (id, type, title, details, ip_hash, created_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE
      (SELECT COUNT(*) FROM reports WHERE ip_hash = ? AND created_at >= ?) < ?`
    ).bind(id, type === 'share' ? 'feature' : type, title, details, hash, timestamp, hash, dayStart, REPORTS_PER_DAY)
    let result
    if (save !== undefined) {
      const attachment = db.prepare(`INSERT INTO report_saves (report_id, is_share)
        SELECT ?, ? WHERE EXISTS (SELECT 1 FROM reports WHERE id = ?)`)
        .bind(id, type === 'share' ? 1 : 0, id)
      // Split on UTF-8 boundaries, keeping each D1 row below 2,000,000 bytes.
      const bytes = new TextEncoder().encode(save)
      const decoder = new TextDecoder()
      const chunks = []
      for (let offset = 0, part = 0; offset < bytes.length; part++) {
        let end = Math.min(offset + 1500000, bytes.length)
        while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
        const content = decoder.decode(bytes.subarray(offset, end))
        chunks.push(db.prepare(`INSERT INTO report_save_chunks (report_id, part, content)
          SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM report_saves WHERE report_id = ?)`)
          .bind(id, part, content, id))
        offset = end
      }
      const names = filename === undefined ? [] : [db.prepare(`INSERT INTO report_save_names (report_id, filename, size_bytes)
        SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM report_saves WHERE report_id = ?)`).bind(id, filename, bytes.length, id)]
      ;[result] = await db.batch([insert, attachment, ...names, ...chunks])
    } else result = await insert.run()
    if (Number(result.meta?.changes) !== 1) return limited()
    return reply({ ok: true, issue: { id, type, title, details, hasSave: save !== undefined, saveName: filename ?? null, saveSize: save !== undefined && filename !== undefined ? new TextEncoder().encode(save).length : null, createdAt: timestamp, votes: 0, voted: false } }, 201)
  }

  const id = voteMatch[1]
  const readIssue = async () => db.prepare(`SELECT ${PUBLIC_FIELDS} FROM reports WHERE id = ?`).bind(hash, id).first()
  const issue = await readIssue()
  if (!issue) return reply({ ok: false, error: 'not found' }, 404)
  // Repeated votes are idempotent, including after the daily budget is used.
  if (issue.voted) return reply({ ok: true, issue: publicIssue(issue) })
  const result = await db.prepare(`INSERT OR IGNORE INTO report_votes (report_id, ip_hash, created_at)
    SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM reports WHERE id = ?) AND
    (SELECT COUNT(*) FROM report_votes WHERE ip_hash = ? AND created_at >= ?) < ?`
  ).bind(id, hash, timestamp, id, hash, dayStart, REPORT_VOTES_PER_DAY).run()
  const updated = await readIssue()
  if (!updated) return reply({ ok: false, error: 'not found' }, 404)
  if (Number(result.meta?.changes) !== 1 && !updated.voted) return limited()
  return reply({ ok: true, issue: publicIssue(updated) })
}
