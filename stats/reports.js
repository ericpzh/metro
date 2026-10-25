import { REPORTS_PER_DAY, REPORT_VOTES_PER_DAY, REPORT_PAGE_SIZE, REPORT_MAX_BODY } from './limits.js'

const PUBLIC_FIELDS = `id, type, title, details, created_at AS createdAt, votes,
  EXISTS (SELECT 1 FROM report_votes v WHERE v.report_id = reports.id AND v.ip_hash = ?) AS voted`

function publicIssue(row) {
  return { ...row, votes: Number(row.votes), voted: Boolean(row.voted) }
}

// Daily limits are checked inside each INSERT, so concurrent requests cannot
// pass an advisory count together. No browser identity or raw address is stored.
export async function handleReports(request, db, route, helpers) {
  const { json, readPayload, submitAllowed, clientIpHash, isBlocked, env, cors } = helpers
  const reply = (body, status = 200, headers = {}) => json(body, { status, headers: { ...cors, ...headers } })
  const url = new URL(request.url)
  const voteMatch = /^\/v1\/reports\/([0-9a-f-]{36})\/vote$/.exec(route)
  const isList = route === '/v1/reports'
  if (!isList && !voteMatch) return reply({ ok: false, error: 'not found' }, 404)
  const allowed = isList ? ['GET', 'POST'] : ['POST']
  if (!allowed.includes(request.method)) return reply({ ok: false, error: 'method not allowed' }, 405, { Allow: allowed.join(', ') })

  if (request.method === 'GET') {
    const sort = url.searchParams.get('sort') || 'top'
    const type = url.searchParams.get('type') || 'all'
    const offsetText = url.searchParams.get('offset') || '0'
    if (!['top', 'new'].includes(sort) || !['all', 'bug', 'feature'].includes(type)
      || !/^\d{1,7}$/.test(offsetText)) return reply({ ok: false, error: 'invalid query' }, 400)
    const hash = await clientIpHash(request, env)
    const where = type === 'all' ? '' : 'WHERE type = ?'
    const order = sort === 'new' ? 'created_at DESC, id DESC' : 'votes DESC, created_at DESC, id DESC'
    const args = [hash || '', ...(type === 'all' ? [] : [type]), REPORT_PAGE_SIZE + 1, Number(offsetText)]
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
    if (!['bug', 'feature'].includes(type) || title.length < 3 || title.length > 160 || details.length < 10 || details.length > 3000) {
      return reply({ ok: false, error: 'invalid report' }, 400)
    }
    const id = crypto.randomUUID()
    const result = await db.prepare(`INSERT INTO reports (id, type, title, details, ip_hash, created_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE
      (SELECT COUNT(*) FROM reports WHERE ip_hash = ? AND created_at >= ?) < ?`
    ).bind(id, type, title, details, hash, timestamp, hash, dayStart, REPORTS_PER_DAY).run()
    if (Number(result.meta?.changes) !== 1) return limited()
    return reply({ ok: true, issue: { id, type, title, details, createdAt: timestamp, votes: 0, voted: false } }, 201)
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
