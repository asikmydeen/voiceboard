import {navigation, workspaceCSS, workspaceEnd, commonScript} from './workspace-ui.js'
import {workListClient, workDetailClient} from './work-client.js'
import {getItem, itemUrl} from './lib/inbox.js'

// Work — the live ops console for Cabinet obligations (fleet plan §7).
// Chat notifications are the pager; this page is the console: where every
// job sits, who holds it, what needs Asik, and how to unblock it. Friday owns
// the data (/api/cabinet/obligations, /work/attention, /fleet); this module
// renders it and proxies actions over the internal Docker network.

const FRIDAY_API = (process.env.FRIDAY_API || 'http://app-synthesize-neural-bandwidth-csj4qo:8080').replace(/\/$/, '')
const FRIDAY_API_TOKEN = process.env.FRIDAY_API_TOKEN || ''

async function friday(path, {method = 'GET', body} = {}) {
  const headers = {Authorization: `Bearer ${FRIDAY_API_TOKEN}`}
  let payload
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
  const res = await fetch(`${FRIDAY_API}${path}`, {method, headers, body: payload, signal: AbortSignal.timeout(method === 'GET' ? 15000 : 60000)})
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = {message: text.slice(0, 200)} }
  if (!res.ok) { const e = new Error(data?.message || data?.reason || data?.error || `Friday ${res.status}`); e.status = res.status; e.data = data; throw e }
  return data
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]))
const jsonInline = (v) => JSON.stringify(v ?? null).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e')

export const CSS = `
.wrap{max-width:1280px;margin:0 auto;padding:18px}
.hero{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
.hero h2{margin:0;font-size:24px;color:#e8ecf1;font-weight:650}
.wcounts{color:#aab6c8;font-size:14px;margin-top:6px}.wcounts b{color:#e8ecf1;font-size:18px}
.panel{background:#151b23;border:1px solid #232b36;border-radius:14px;padding:16px 18px;margin:14px 0}
.panel h3{margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:#8b95a3}
.attention{border-left:3px solid var(--warn)}
.attention h3{color:#ffd18d}
.wcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr));gap:12px}
.wcard{background:#0e1116;border:1px solid #232b36;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;min-width:0}
.wcard.needs_you{border-color:#5a4a1f}
.wcard h4{margin:0;font-size:15px}.wcard h4 a{color:#e8ecf1;text-decoration:none}
.wcard-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:#8b95a3}
.wage{margin-left:auto}
.wkind{color:#ffd18d}
.wblocker{margin:0;color:#c9d1d9;font-size:13px;line-height:1.5;max-height:6.2em;overflow:hidden}
.wblocker-cell{max-width:320px;color:#aab6c8}
.wacts{display:flex;gap:6px;flex-wrap:wrap;margin-top:auto}
.wacts .mini,.wacts button{min-height:32px;padding:4px 10px;font-size:12px}
.wreply textarea{width:100%;margin-top:6px}
.wstate{display:inline-flex;align-items:center;font-size:11px;padding:2px 8px;border-radius:20px;border:1px solid #3a485d;background:#242e3d;color:#aab6c8;white-space:nowrap}
.wstate.needs_you{color:#2a1e05;background:var(--warn);border-color:var(--warn);font-weight:650}
.wstate.blocked{color:#ffd18d;border-color:#5a4a1f}
.wstate.running{color:#a5c1ff;border-color:#2f4a7a}
.wstate.waiting_coder,.wstate.waiting_advisor{color:#a5c1ff}
.wstate.done{color:#8ad9bd}.wstate.cancelled{color:#8b95a3}.wstate.paused{color:#c9b6ff}
.crumb{color:#a5c1ff;text-decoration:none;font-size:13px}.crumb.holder{font-weight:650;text-decoration:underline}
.sep{color:#5c6675;margin:0 4px}
.wchain{font-size:13px;color:#8fa3bd;display:flex;gap:4px;align-items:center;flex-wrap:wrap}
.pill{background:#1d2632;border-radius:6px;padding:2px 8px;font-size:11px;color:#8fa3bd;display:inline-flex;align-items:center;gap:5px;text-decoration:none}
.pill.holder-pill{color:#ffd18d}
.wfilters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0 8px}
.wfilters button{min-height:34px;padding:4px 12px;font-size:13px;background:#151b23;border:1px solid #232b36;color:#aab6c8;border-radius:20px}
.wfilters button[aria-pressed=true]{background:#25354e;color:#dae7ff;border-color:#426ce8}
.wfilters input,.wfilters select{min-height:34px;padding:4px 10px;font-size:13px}
.wfilters .spacer{flex:1}
table.wlist{width:100%;border-collapse:collapse;font-size:13px}
.wlist th,.wlist td{padding:9px 8px;border-bottom:1px solid #1d2632;text-align:left;vertical-align:top}
.wlist th{color:#8b95a3;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.wlist tr.needs_you td:first-child{border-left:3px solid var(--warn)}
.wlist a{text-decoration:none}
.small{font-size:12px}.muted{color:#8b95a3}.empty{padding:14px 0}
.local-feedback{min-height:22px;font-size:13px;color:var(--good)}.local-feedback.error{color:var(--danger)}
.wtree{list-style:none;margin:0;padding-left:18px;border-left:1px dashed #303946}
.wtree>li{margin:8px 0}.wnode{padding:6px 10px;border-radius:8px}
.wtree li.holder>.wnode{background:#2a2410;border:1px solid #5a4a1f}
.wtree li.me>.wnode{outline:1px solid #426ce8}
.wbus{padding:10px 0;border-bottom:1px solid #1d2632}.wbus p{margin:6px 0 0;white-space:pre-wrap;font-size:13px}
.wbus.owner_reply{background:#12211c;border-radius:8px;padding:10px}
.wanswer{color:#8ad9bd}
.wneed{white-space:pre-wrap;color:#e8ecf1;background:#0e1116;border:1px solid #232b36;border-radius:10px;padding:10px;font-size:14px}
.wtimeline{margin:0;padding-left:0;list-style:none}.wtimeline li{padding:8px 0;border-bottom:1px solid #1d2632;font-size:13px}
button.danger{border-color:#5a2a2a;color:#ffaaa4}
.detail-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(300px,1fr);gap:16px}.detail-grid>.panel{margin:0}
@media(max-width:1000px){.detail-grid{grid-template-columns:1fr}}
tr.unsure td{background:#2a2410}
.err-banner{margin:10px 0;background:#3a1d1d;border:1px solid #5a2a2a;color:#ffb4ae;border-radius:8px;padding:8px 12px;font-size:13px}
`

function shell(title, active, body, style) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Friday</title><link rel="icon" href="/icon.svg" type="image/svg+xml"><meta name="theme-color" content="#101318">
<style>${style}${CSS}${workspaceCSS}</style></head><body>${navigation(active, title)}${body}${workspaceEnd}${commonScript}</body></html>`
}

const DISPLAY_FILTERS = [['', 'All open'], ['needs_you', 'Needs you'], ['blocked', 'Blocked'], ['running,waiting_coder,waiting_advisor', 'In progress'], ['queued', 'Queued'], ['paused', 'Paused']]

export function renderWorkPage({attention, obligations, agents = [], filters = {}, err = ''}) {
  const f = {display: '', advisor: '', batch: '', q: '', closed: false, ...filters}
  const initial = jsonInline({attention, obligations})
  const advisorOpts = ['<option value="">Any advisor</option>'].concat(agents.map((a) => `<option value="${esc(a.id)}" ${a.id === f.advisor ? 'selected' : ''}>${esc(a.name || a.id)}</option>`)).join('')
  return `<div class="wrap" id="work-root" data-display="${esc(f.display)}" data-advisor="${esc(f.advisor)}" data-batch="${esc(f.batch)}" data-q="${esc(f.q)}" data-closed="${f.closed ? '1' : '0'}">
${err ? `<div class="err-banner" role="alert">${esc(err)}</div>` : ''}
<div class="hero"><div><div class="eyebrow">Live ops</div><h2>Work</h2><div class="wcounts" id="work-counts" aria-live="polite">Loading…</div></div>
<div class="row"><button class="secondary" data-refresh-work>Refresh</button><button data-open-dialog="fleet-dialog">New work</button></div></div>
<div class="row" style="justify-content:space-between"><p class="local-feedback" id="work-feedback" role="status"></p><p class="local-feedback muted" id="work-live" aria-live="polite">Connecting…</p></div>
<section class="panel attention" aria-labelledby="needs-h"><h3 id="needs-h">Needs you</h3><div class="wcards" id="work-needs"></div><div id="work-blocked" style="margin-top:10px"></div></section>
<div class="wfilters" role="group" aria-label="Filters">${DISPLAY_FILTERS.map(([v, l]) => `<button type="button" data-filter-display="${esc(v)}" aria-pressed="${v === f.display}">${esc(l)}</button>`).join('')}<span class="spacer"></span><select id="work-advisor" aria-label="Advisor">${advisorOpts}</select><input id="work-search" type="search" placeholder="Search goal, id, task…" value="${esc(f.q)}" aria-label="Search"><label class="small"><input type="checkbox" id="work-closed" ${f.closed ? 'checked' : ''}> show closed</label></div>
${f.batch ? `<p class="muted small">Showing batch <span class="pill">${esc(f.batch)}</span> · <a href="/cabinet/work">clear</a></p>` : ''}
<section class="panel"><div class="row" style="justify-content:space-between"><h3>Every open obligation</h3><span class="muted small" id="work-total"></span></div>
<div style="overflow-x:auto"><table class="wlist"><thead><tr><th>Title</th><th>State</th><th>Chain</th><th>Holder</th><th>Batch</th><th>Coder</th><th>Pulse</th><th>Attempts</th><th>Blocker / last</th></tr></thead><tbody id="work-rows"></tbody></table></div></section>
<dialog class="dialog" id="fleet-dialog"><div class="dialog-head"><h2>New work</h2><button class="secondary mini" data-close-dialog>Close</button></div><div class="dialog-body">
<form id="fleet-form" data-idem="board-${Date.now().toString(36)}"><label for="fleet-text">One job per line. Prefix <code>@advisor</code> to force routing.</label><textarea id="fleet-text" name="text" rows="7" required placeholder="1) Fix Color Rhythm scroll on grid_planner&#10;2) Prep this week's family calendar conflicts&#10;3) Draft AI Herald notes from last week's saved links"></textarea><input type="hidden" name="confirm" value="0">
<div class="row" style="margin-top:12px"><button type="button" class="secondary" id="fleet-plan">Plan routing</button><button type="submit" id="fleet-submit">Submit</button></div><p class="local-feedback" id="fleet-status" role="status">Each job becomes a durable root obligation with its own supervisor loop. You get one receipt.</p><div id="fleet-proposal"></div>
<datalist id="advisor-ids">${agents.map((a) => `<option value="${esc(a.id)}">`).join('')}</datalist></form></div></dialog>
<noscript><p class="err-banner">The Work console needs JavaScript for live updates.</p></noscript>
<script type="application/json" id="work-initial">${initial}</script>
<script>(${workListClient.toString()})();</script>
</div>`
}

export function renderWorkDetail(detail) {
  const d = detail
  return `<div class="wrap" id="work-detail" data-id="${esc(d.id)}">
<p class="muted small"><a href="/cabinet/work">← Work</a>${d.root_id && d.root_id !== d.id ? ` · <a href="/cabinet/work/${esc(d.root_id)}">root</a>` : ''}</p>
<div id="wd-head"></div>
<div class="row" style="justify-content:space-between"><p class="local-feedback" id="work-feedback" role="status"></p><p class="local-feedback muted" id="work-live" aria-live="polite">Connecting…</p></div>
<section class="panel attention" id="wd-needed" hidden></section>
<section class="panel"><h3>Reply to this chain</h3><form id="wd-reply"><textarea name="text" rows="3" required placeholder="Answer the question, supply the decision, or say what changed. The holder wakes on the next tick; blocked children get the answer too."></textarea><div class="row" style="margin-top:10px"><button type="submit">Send reply</button></div></form></section>
<div class="detail-grid">
<div>
<section class="panel"><h3>Goal &amp; acceptance</h3><p id="wd-goal" style="white-space:pre-wrap;color:#e8ecf1"></p><p class="muted small">Acceptance</p><p id="wd-acc" style="white-space:pre-wrap"></p><details><summary class="muted small">Edit (wakes the advisor)</summary><form id="wd-edit"><label class="small">Goal</label><textarea name="goal" rows="3">${esc(d.goal || '')}</textarea><label class="small">Acceptance</label><textarea name="acceptance" rows="2">${esc(d.acceptance || '')}</textarea><div class="row" style="margin-top:8px"><button type="submit" class="secondary mini">Save &amp; wake</button></div></form></details></section>
<section class="panel"><h3>Chain</h3><div id="wd-tree"></div></section>
<section class="panel"><h3>Bus thread</h3><div id="wd-bus"></div></section>
</div>
<div>
<section class="panel"><h3>Actions</h3><div class="row" id="wd-actions"></div></section>
<section class="panel"><h3>Coder / engine</h3><div id="wd-task"></div></section>
<section class="panel"><h3>Timeline</h3><div id="wd-events"></div></section>
</div></div>
<script type="application/json" id="work-initial">${jsonInline(d)}</script>
<script>(${workDetailClient.toString()})();</script>
</div>`
}

function filtersFrom(c) {
  return {
    display: c.req.query('display') || '',
    advisor: c.req.query('advisor') || '',
    batch: c.req.query('batch') || '',
    q: c.req.query('q') || '',
    closed: c.req.query('closed') === '1',
  }
}

function listQuery(f) {
  const p = new URLSearchParams()
  if (f.display) p.set('display', f.display)
  if (f.advisor) p.set('advisor', f.advisor)
  if (f.batch) p.set('batch', f.batch)
  if (f.q) p.set('q', f.q)
  if (f.closed) p.set('closed', '1')
  p.set('limit', '200')
  return p.toString()
}

async function liveData(f) {
  const [attention, list] = await Promise.all([
    friday('/api/cabinet/work/attention'),
    friday('/api/cabinet/obligations?' + listQuery(f)),
  ])
  return {attention, obligations: list.obligations || [], generated: list.generated}
}

export async function obligationDetail(id) {
  if (!id) return null
  try { return await friday(`/api/cabinet/obligations/${encodeURIComponent(id)}`) } catch { return null }
}

const jsonErr = (c, e) => c.json({ok: false, message: e.message, reason: e.data?.reason || e.data?.error || ''}, e.status && e.status >= 400 && e.status < 600 ? e.status : 503)

export function mountWork(app, {style}) {
  // Register the fixed paths before /cabinet/work/:id (route-order lesson from /cabinet/architecture).
  app.get('/cabinet/work', async (c) => {
    const f = filtersFrom(c)
    let data = {attention: {counts: {}, needs_you: [], blocked: []}, obligations: []}, agents = [], err = ''
    try { data = await liveData(f) } catch (e) { err = e.message }
    try { const roster = await friday('/api/cabinet/agents'); agents = Array.isArray(roster) ? roster : (roster?.agents || []) } catch { }
    return c.html(shell('Work', '/cabinet/work', renderWorkPage({...data, agents, filters: f, err}), style))
  })
  app.get('/cabinet/work/live', async (c) => {
    try { c.header('Cache-Control', 'no-store'); return c.json(await liveData(filtersFrom(c))) } catch (e) { return jsonErr(c, e) }
  })
  app.get('/cabinet/work/badge', async (c) => {
    try { const a = await friday('/api/cabinet/work/attention'); c.header('Cache-Control', 'no-store'); return c.json({needs_you: a.counts?.needs_you || 0, blocked: a.counts?.blocked || 0}) } catch (e) { return jsonErr(c, e) }
  })
  app.post('/cabinet/work/fleet/plan', async (c) => {
    try { const body = await c.req.json(); return c.json(await friday('/api/cabinet/fleet/plan', {method: 'POST', body: {text: body.text || '', goals: body.goals || undefined, default_advisor: body.default_advisor || ''}})) } catch (e) { return jsonErr(c, e) }
  })
  app.post('/cabinet/work/fleet', async (c) => {
    let body
    const ct = c.req.header('content-type') || ''
    if (ct.includes('application/json')) body = await c.req.json()
    else { const f = await c.req.parseBody(); body = {text: f.text, confirm: f.confirm === '1'} }
    try {
      const res = await friday('/api/cabinet/fleet', {method: 'POST', body: {text: body.text || '', goals: body.goals || undefined, confirm: !!body.confirm, source: 'board', idempotency_key: body.idempotency_key || '', default_advisor: body.default_advisor || ''}})
      if (!ct.includes('application/json')) return c.redirect(res.ok ? `/cabinet/work?batch=${encodeURIComponent(res.batch_id)}` : '/cabinet/work')
      return c.json(res)
    } catch (e) { return jsonErr(c, e) }
  })
  // Board card → Cabinet obligation ("Take this work"). Friday owns the card's
  // state from here: it mirrors the obligation onto board_items.status and
  // tags the card obl:<id> so the Board renders "Open in Work".
  app.post('/items/:id/take', async (c) => {
    const id = c.req.param('id')
    const f = await c.req.parseBody().catch(() => ({}))
    let item = null
    try { item = await getItem(id) } catch { item = null }
    const payload = {
      board_id: id,
      title: String(item?.title || f.title || '').trim(),
      summary: String(item?.summary || f.summary || '').trim(),
      url: String((item && itemUrl(item)) || f.url || '').trim(),
      kind: String(item?.kind || f.kind || 'task'),
    }
    if (!payload.title) return c.text('This card has no title to take.', 422)
    try {
      const res = await friday('/api/cabinet/obligations/from-board', {method: 'POST', body: payload})
      if (!res.ok) return c.text(res.reason || 'Friday did not accept this card.', 502)
      const wantsJson = (c.req.header('accept') || '').includes('application/json')
      return wantsJson ? c.json(res) : c.redirect(`/?ok=taken`)
    } catch (e) { return c.text('Could not hand this to the Cabinet: ' + e.message, 502) }
  })
  app.get('/cabinet/work/:id/live', async (c) => {
    try { c.header('Cache-Control', 'no-store'); return c.json(await friday(`/api/cabinet/obligations/${encodeURIComponent(c.req.param('id'))}`)) } catch (e) { return jsonErr(c, e) }
  })
  app.post('/cabinet/work/:id/reply', async (c) => {
    const ct = c.req.header('content-type') || ''
    let body
    try { body = ct.includes('application/json') ? await c.req.json() : await c.req.parseBody() } catch { body = {} }
    try {
      const res = await friday(`/api/cabinet/obligations/${encodeURIComponent(c.req.param('id'))}/reply`, {method: 'POST', body: {text: String(body.text || ''), actor: String(body.actor || (ct.includes('application/json') ? 'owner' : 'owner (board)'))}})
      if (!ct.includes('application/json') && body.back) return c.redirect(String(body.back).startsWith('/') ? String(body.back) : '/cabinet/work')
      return c.json(res)
    } catch (e) { return jsonErr(c, e) }
  })
  app.post('/cabinet/work/:id/action', async (c) => {
    try { const body = await c.req.json(); return c.json(await friday(`/api/cabinet/obligations/${encodeURIComponent(c.req.param('id'))}/action`, {method: 'POST', body: {...body, actor: 'owner'}})) } catch (e) { return jsonErr(c, e) }
  })
  app.get('/cabinet/work/:id', async (c) => {
    const id = c.req.param('id')
    let d
    try { d = await friday(`/api/cabinet/obligations/${encodeURIComponent(id)}`) } catch (e) {
      if (e.status === 404) return c.html(shell('Work', '/cabinet/work', `<div class="wrap"><div class="err-banner">No obligation ${esc(id)}.</div><a href="/cabinet/work">Back to Work</a></div>`, style), 404)
      return c.html(shell('Work', '/cabinet/work', `<div class="wrap"><div class="err-banner">${esc(e.message)}</div><a href="/cabinet/work">Back to Work</a></div>`, style), 503)
    }
    return c.html(shell(`${d.title} · Work`, '/cabinet/work', renderWorkDetail(d), style))
  })
}
