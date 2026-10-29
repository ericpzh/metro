// The report view shares the stats shell and PAGE_COPY catalogue in page.js.
function html(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

export const REPORT_STYLE = `
  .reports { max-width: 960px; margin: 0 auto; padding: 52px 32px 80px; }
  .reports h1 { font-size: clamp(2rem, 5vw, 3.6rem); line-height: 1.15; margin: 22px 0 16px; }
  .reports p { color: var(--muted); }
  .reports a { color: var(--amber); }
  .report-tools { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: 30px 0 18px; }
  .reports button, .reports select, .reports input, .reports textarea { font: inherit; color: var(--ink); background: var(--bg-2); border: 1px solid var(--line-2); border-radius: 8px; padding: 10px 14px; }
  .reports button { cursor: pointer; }
  .reports button:hover { border-color: var(--amber); }
  .reports :focus-visible { outline: 2px solid var(--amber); outline-offset: 3px; }
  .reports button:disabled { cursor: default; opacity: .55; }
  .reports .primary { color: var(--bg); background: var(--amber); border-color: var(--amber); font-weight: 650; }
  .report-tools .primary { margin-left: auto; }
  .report-form { padding: 24px; border: 1px solid var(--line-2); border-radius: 12px; margin: 24px 0; background: var(--sheet-top); }
  .report-form label { display: block; margin-bottom: 16px; }
  .report-form input, .report-form textarea, .report-form select { display: block; width: 100%; margin-top: 6px; }
  .report-form textarea { resize: vertical; min-height: 130px; }
  .report-form p { font-size: .85rem; }
  .report-list { list-style: none; padding: 0; margin: 0 0 24px; }
  .report-row { display: flex; align-items: flex-start; gap: 20px; padding: 24px 0; border-top: 1px solid var(--line); }
  .report-row .vote { display: flex; flex-direction: column; align-items: center; min-width: 76px; font-size: .8rem; gap: 3px; }
  .report-row .vote strong { font-size: 1.3rem; }
  .report-row .vote[aria-pressed="true"] { color: var(--amber); border-color: var(--amber); opacity: 1; }
  .report-body { min-width: 0; flex: 1; overflow-wrap: anywhere; }
  .report-body h2 { margin: 8px 0; font-size: 1.1rem; line-height: 1.5; }
  .report-body p { white-space: pre-wrap; margin: 0; color: var(--ink-2); font-size: .95rem; }
  .report-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; color: var(--muted); font-size: .78rem; }
  .report-kind { color: var(--amber); }
  #report-status { min-height: 1.6em; }
  @media (max-width: 600px) { .reports { padding: 32px 20px 60px; } .report-tools .primary { margin-left: 0; } .report-row { gap: 12px; } .report-form { padding: 16px; } }
`

export function renderReportContent(c, statsPath, statsLabel) {
  return `<section class="reports" aria-labelledby="report-title">
    <a href="${html(statsPath)}">← ${html(statsLabel)}</a>
    <h1 id="report-title">${html(c.title)}<span class="accent">.</span></h1>
    <p>${html(c.description)}</p>
    <div class="report-tools">
      <label>${html(c.sort)} <select id="report-sort"><option value="top">${html(c.top)}</option><option value="new">${html(c.newest)}</option></select></label>
      <select id="report-filter" aria-label="${html(c.type)}"><option value="all">${html(c.all)}</option><option value="bug">${html(c.bug)}</option><option value="feature">${html(c.feature)}</option><option value="share">${html(c.share)}</option></select>
      <button type="button" class="primary" id="report-add" aria-expanded="false" aria-controls="report-form">＋ ${html(c.add)}</button>
      <button type="button" id="report-share">${html(c.shareButton)}</button>
    </div>
    <form class="report-form" id="report-form" hidden>
      <label>${html(c.type)}<select name="type"><option value="bug">${html(c.bug)}</option><option value="feature">${html(c.feature)}</option><option value="share">${html(c.share)}</option></select></label>
      <label>${html(c.subject)}<input name="title" required minlength="3" maxlength="160"></label>
      <label>${html(c.detail)}<textarea name="details" required minlength="10" maxlength="3000" rows="5"></textarea></label>
      <label>${html(c.saveLabel)}<input type="file" name="saveFile" accept=".json,application/json"></label>
      <p>${html(c.savePublic)}</p>
      <p>${html(c.privacy)}</p>
      <button type="submit" class="primary">${html(c.submit)}</button> <button type="button" id="report-cancel">${html(c.cancel)}</button>
    </form>
    <p id="report-status" role="status" aria-live="polite">${html(c.loading)}</p>
    <button type="button" id="report-retry" hidden>${html(c.retry)}</button>
    <ul class="report-list" id="report-list" aria-busy="true"></ul>
    <button type="button" id="report-more" hidden>${html(c.more)}</button>
  </section>`
}

// Keep browser source literal: Wrangler's function-name instrumentation adds
// Worker-only helpers to Function.toString(), which cannot run in the browser.
const REPORT_CLIENT = String.raw`function reportClient(copy, locale) {
  const api = '/stats/api/v1/reports'
  const list = document.getElementById('report-list')
  const status = document.getElementById('report-status')
  const form = document.getElementById('report-form')
  const add = document.getElementById('report-add')
  const more = document.getElementById('report-more')
  const retry = document.getElementById('report-retry')
  const sort = document.getElementById('report-sort')
  const filter = document.getElementById('report-filter')
  let offset = 0
  let generation = 0
  function showForm(open) {
    form.hidden = !open
    add.setAttribute('aria-expanded', String(open))
    if (open) form.elements.title.focus()
    else add.focus()
  }
  function message(error) {
    return error.status === 429 ? copy.limited : error.status === 503 ? copy.unavailable : copy.error
  }
  async function request(path, body) {
    const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw Object.assign(new Error(data.error), { status: response.status })
    return data
  }
  function element(tag, text, className) {
    const el = document.createElement(tag)
    el.textContent = text
    if (className) el.className = className
    return el
  }
  function row(issue) {
    const li = element('li', '', 'report-row')
    const vote = element('button', '', 'vote')
    vote.type = 'button'
    vote.setAttribute('aria-pressed', String(issue.voted))
    vote.setAttribute('aria-label', (issue.voted ? copy.voted : copy.vote) + ': ' + issue.title)
    vote.disabled = issue.voted
    vote.append(element('span', '▲'), element('strong', Number(issue.votes).toLocaleString(locale)), element('span', issue.voted ? copy.voted : copy.vote))
    vote.addEventListener('click', async () => {
      vote.disabled = true
      try {
        const data = await request(api + '/' + issue.id + '/vote', {})
        li.replaceWith(row(data.issue))
        // A changed score may move this issue under the current sort.
        await load(true)
      } catch (error) { status.textContent = message(error); vote.disabled = false }
    })
    const body = element('div', '', 'report-body')
    const meta = element('div', '', 'report-meta')
    const date = element('time', new Date(issue.createdAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }))
    date.dateTime = issue.createdAt
    meta.append(element('span', issue.type === 'bug' ? copy.bug : issue.type === 'share' ? copy.share : copy.feature, 'report-kind'), date)
    body.append(meta, element('h2', issue.title), element('p', issue.details))
    if (issue.hasSave) {
      const link = element('a', copy.download)
      link.href = api + '/' + issue.id + '/save'
      link.setAttribute('download', '')
      body.append(link)
      if (issue.saveName && Number.isFinite(issue.saveSize)) body.append(element('span', ' · ' + issue.saveName + ' (' + (issue.saveSize / 1048576).toFixed(2) + ' MiB)', 'report-meta'))
    }
    li.append(vote, body)
    return li
  }
  async function load(reset) {
    const run = ++generation
    if (reset) { offset = 0; list.replaceChildren() }
    list.setAttribute('aria-busy', 'true')
    status.textContent = copy.loading
    more.hidden = true
    retry.hidden = true
    try {
      const data = await request(api + '?' + new URLSearchParams({ sort: sort.value, type: filter.value, offset: String(offset) }))
      if (run !== generation) return
      list.append(...data.issues.map(row))
      offset += data.issues.length
      status.textContent = offset ? '' : copy.empty
      more.hidden = !data.hasMore
      return true
    } catch (error) {
      if (run === generation) { status.textContent = message(error); retry.hidden = false }
      return false
    } finally { if (run === generation) list.setAttribute('aria-busy', 'false') }
  }
  add.addEventListener('click', () => showForm(form.hidden))
  document.getElementById('report-share').addEventListener('click', () => { showForm(true); form.elements.type.value = 'share'; form.elements.saveFile.required = true })
  form.elements.type.addEventListener('change', () => { form.elements.saveFile.required = form.elements.type.value === 'share' })
  document.getElementById('report-cancel').addEventListener('click', () => showForm(false))
  sort.addEventListener('change', () => load(true))
  filter.addEventListener('change', () => load(true))
  more.addEventListener('click', () => load(false))
  retry.addEventListener('click', () => load(true))
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const submit = form.querySelector('[type="submit"]')
    submit.disabled = true
    try {
      const file = form.elements.saveFile.files[0]
      const payload = { type: form.elements.type.value, title: form.elements.title.value, details: form.elements.details.value }
      if (file) {
        if (file.size > 32 * 1024 * 1024) throw new Error(copy.invalidSave)
        const save = await file.text()
        try { const doc = JSON.parse(save); if (!doc || doc.format !== 'metro-save' || !Number.isInteger(doc.formatVersion) || !doc.static || !Array.isArray(doc.static.cells) || !Array.isArray(doc.static.modules) || !Array.isArray(doc.static.lines)) throw new Error() } catch { throw new Error(copy.invalidSave) }
        payload.save = save
        payload.saveName = file.name
      }
      await request(api, payload)
      form.reset()
      form.elements.saveFile.required = false
      showForm(false)
      if (await load(true)) status.textContent = copy.success
    } catch (error) { status.textContent = error.message === copy.invalidSave ? copy.invalidSave : message(error) }
    finally { submit.disabled = false }
  })
  load(true)
}`

export function reportScript(copy, locale) {
  const args = JSON.stringify([copy, locale]).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return `(${REPORT_CLIENT})(...${args});`
}
