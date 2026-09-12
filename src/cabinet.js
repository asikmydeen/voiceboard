// Cabinet console — the board's view of Asik's persistent agents.
// Friday owns the data (charters, runs, schedules, onboarding); this module
// renders it and proxies actions to Friday's /api/cabinet/* over the internal
// Docker network. Same login as the board (cookie / Basic), no new secrets in
// the browser.
const FRIDAY_API = (process.env.FRIDAY_API || 'http://app-synthesize-neural-bandwidth-csj4qo:8080').replace(/\/$/, '')
const FRIDAY_API_TOKEN = process.env.FRIDAY_API_TOKEN || ''
const CODER_URL = process.env.CODER_URL || 'https://code.asikmydeen.com'

async function friday(path, { method = 'GET', body, form } = {}) {
  const headers = { Authorization: `Bearer ${FRIDAY_API_TOKEN}` }
  let payload
  if (form) payload = form
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
  const res = await fetch(`${FRIDAY_API}${path}`, { method, headers, body: payload, signal: AbortSignal.timeout(method === 'GET' ? 15000 : 200000) })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { message: text.slice(0, 200) } }
  if (!res.ok && !(data && typeof data.message === 'string')) throw new Error(`Friday ${res.status}: ${text.slice(0, 160)}`)
  return data
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
const when = (ts) => ts ? new Date(ts * 1000).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
const whenIso = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const STATUS = { delivered: '#4ade80', done: '#4ade80', silent: '#8b95a3', running: '#7ab7ff', failed: '#ff8a80' }
const dot = (s) => `<span class="dot" style="background:${STATUS[s] || '#5c6675'}" title="${esc(s)}"></span>`
const md = (s) => esc(s).replace(/^- (.*)$/gm, '<li>$1</li>').replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`).replace(/\n{2,}/g, '<br>')

const CSS = `
.nav{display:flex;gap:14px;align-items:center}
.nav a{color:#7ab7ff;text-decoration:none;font-size:13px}.nav a.on{color:#e8ecf1;font-weight:600}
.wrap{max-width:1180px;margin:0 auto;padding:14px 18px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.agent{background:#151b23;border:1px solid #232b36;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.agent.paused{opacity:.55}
.agent .name{display:flex;justify-content:space-between;align-items:center;font-weight:600;color:#e8ecf1}
.agent .name a{color:inherit;text-decoration:none}
.agent .role{color:#9aa5b1;font-size:13px}
.kv{display:flex;justify-content:space-between;font-size:12px;color:#8b95a3;gap:8px}
.kv b{color:#c9d1d9;font-weight:500;text-align:right}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
.bar{height:6px;background:#232b36;border-radius:3px;overflow:hidden}.bar i{display:block;height:100%;background:#2563eb}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.panel{background:#151b23;border:1px solid #232b36;border-radius:12px;padding:14px 16px;margin:12px 0}
.panel h3{margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#8b95a3}
.panel input,.panel textarea,.panel select{background:#0e1116;border:1px solid #232b36;color:#d7dce3;border-radius:7px;padding:8px;font-size:14px}
.panel textarea{width:100%;min-height:70px}
.panel input[type=text],.panel input[type=password]{flex:1;min-width:140px}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:7px 8px;border-bottom:1px solid #1d2632;text-align:left;vertical-align:top}th{color:#8b95a3;font-weight:500;font-size:12px}
.mono{white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;color:#c9d1d9}
.pill{background:#1d2632;border-radius:6px;padding:2px 7px;font-size:11px;color:#8fa3bd}
.check{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #1d2632}
.check .q{flex:1}.check .q small{display:block;color:#5c6675}
.ok{color:#4ade80}.muted{color:#5c6675}
details.sec summary{cursor:pointer;color:#7ab7ff;font-size:13px;padding:6px 0}
ul{margin:4px 0 4px 18px;padding:0}li{margin:2px 0}
button.mini{min-height:32px;padding:5px 10px}
`

function shell(title, active, body, style, flash = '') {
  const tabs = [['/cabinet', 'Agents'], ['/cabinet/schedule', 'Schedule'], ['/cabinet/activity', 'Activity'], ['/', 'Board']]
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · cabinet</title><link rel="icon" href="/icon.svg" type="image/svg+xml"><meta name="theme-color" content="#0e1116">
<style>${style}${CSS}</style></head><body>
<h1>🏛 cabinet <span class="nav">${tabs.map(([h, l]) => `<a href="${h}" class="${h === active ? 'on' : ''}">${l}</a>`).join('')}</span></h1>
${flash}${body}</body></html>`
}

const flash = (c) => {
  const m = c.req.query('m')
  const e = c.req.query('e')
  if (e) return `<div class="err-banner" role="alert">${esc(e)}</div>`
  return m ? `<div class="flash" role="status">${esc(m)}</div>` : ''
}
const back = (c, path, msg, err) => c.redirect(`${path}?${err ? 'e' : 'm'}=${encodeURIComponent(msg || '')}`)

export function mountCabinet(app, { style }) {
  // ── Agents (roster + brief everyone) ──────────────────────────────────────
  app.get('/cabinet', async (c) => {
    let agents = []
    let err = ''
    try { agents = await friday('/api/cabinet/agents') } catch (e) { err = e.message }
    const cards = agents.map((a) => {
      const pct = a.setup.total ? Math.round(100 * a.setup.done / a.setup.total) : 100
      return `<div class="agent ${a.active ? '' : 'paused'}">
  <div class="name"><a href="/cabinet/${a.id}">${esc(a.name)}</a><span class="pill">@${a.id}</span></div>
  <div class="role">${esc(a.title)}</div>
  <div class="kv"><span>Next</span><b>${a.next ? `${esc(a.next.label)} · ${whenIso(a.next.at)}` : (a.active ? 'on request' : 'paused')}</b></div>
  <div class="kv"><span>Last</span><b>${a.last ? `${dot(a.last.status)}${esc(a.last.label)} · ${when(a.last.started)}` : '—'}</b></div>
  <div class="kv"><span>Setup ${a.setup.done}/${a.setup.total}${a.setup.docs ? ` · ${a.setup.docs} docs` : ''}</span><b>${a.workspace ? `<a href="${CODER_URL}/@asik/${esc(a.workspace)}" style="color:#7ab7ff">${esc(a.workspace)}</a>` : ''}</b></div>
  <div class="bar"><i style="width:${pct}%"></i></div>
  <div class="row"><a class="go" style="min-height:32px;padding:5px 10px;font-size:12px" href="/cabinet/${a.id}">Open</a>
    <form method="post" action="/cabinet/${a.id}/run"><button class="mini">Run now</button></form>
    <form method="post" action="/cabinet/${a.id}/active"><input type="hidden" name="active" value="${a.active ? '0' : '1'}"><button class="mini">${a.active ? 'Pause' : 'Resume'}</button></form></div>
</div>`
    }).join('')
    const body = `<div class="wrap">
${err ? `<div class="err-banner">Friday API unreachable: ${esc(err)}</div>` : ''}
<div class="panel"><h3>Brief the cabinet</h3>
<form method="post" action="/cabinet/assign">
<textarea name="text" placeholder="e.g. It's Q4 planning. From your seat, give me the one thing you want me to decide this month and why." required></textarea>
<div class="row" style="margin-top:8px">${agents.filter((a) => a.active).map((a) => `<label class="pill"><input type="checkbox" name="agents" value="${a.id}" checked> ${esc(a.name)}</label>`).join('')}</div>
<div class="row" style="margin-top:8px"><button>Send to selected</button><label class="pill"><input type="checkbox" name="deliver" value="1"> also send answers to WhatsApp</label><span class="muted">Answers appear under Activity as each agent finishes.</span></div>
</form></div>
<div class="grid">${cards || '<div class="empty">No agents yet.</div>'}</div>
<div class="panel"><h3>New agent</h3>
<form method="post" action="/cabinet/create" class="row"><input type="text" name="name" placeholder="Name, e.g. Garden Planner" required><input type="text" name="mission" placeholder="Mission in one or two sentences" required style="flex:3"><button>Create</button></form>
<div class="muted" style="margin-top:6px;font-size:12px">Creates soul/agents/&lt;id&gt;.md with standard tools and no schedule; refine it on the agent page.</div></div>
</div>`
    return c.html(shell('Agents', '/cabinet', body, style, flash(c)))
  })

  app.post('/cabinet/assign', async (c) => {
    const f = await c.req.formData()
    const agents = f.getAll('agents')
    try {
      const r = await friday('/api/cabinet/assign', { method: 'POST', body: { text: f.get('text'), agents: agents.length ? agents : 'all', deliver: f.get('deliver') === '1' } })
      return back(c, '/cabinet/activity', r.message || 'Sent.', !r.ok)
    } catch (e) { return back(c, '/cabinet', e.message, true) }
  })

  app.post('/cabinet/create', async (c) => {
    const f = await c.req.formData()
    try {
      const r = await friday('/api/cabinet/agents', { method: 'POST', body: { name: f.get('name'), mission: f.get('mission') } })
      return back(c, '/cabinet', r.message, !r.ok)
    } catch (e) { return back(c, '/cabinet', e.message, true) }
  })

  // ── Agent page (onboarding, documents, routines, ask) ─────────────────────
  const agentPage = async (c) => {
    const id = c.req.param('id')
    let a
    try { a = await friday(`/api/cabinet/agents/${encodeURIComponent(id)}`) } catch (e) { return c.html(shell(id, '/cabinet', `<div class="wrap"><div class="err-banner">${esc(e.message)}</div></div>`, style)) }
    if (!a || a.error) return c.text('no such agent', 404)
    const sec = (name) => a.sections[name] || ''
    const setup = a.setup.map((s) => `<div class="check"><span>${s.answered ? '<span class="ok">✓</span>' : '○'}</span><div class="q">${esc(s.question)}${s.default ? `<small>Default: ${esc(s.default)}</small>` : ''}
      ${s.answered ? '' : `<form method="post" action="/cabinet/${a.id}/config" class="row" style="margin-top:6px"><input type="hidden" name="key" value="${esc(s.key)}"><input type="text" name="value" placeholder="${esc(s.default || 'your answer')}" required><button class="mini">Save</button></form>`}
    </div></div>`).join('')
    const config = a.config.map((k) => `<tr><td class="mono">${esc(k.key)}</td><td class="mono">${esc(k.value)}</td><td>${k.secret ? '<span class="pill">secret</span>' : ''}</td><td>${when(k.updated)}</td>
      <td><form method="post" action="/cabinet/${a.id}/config/${encodeURIComponent(k.key)}/delete"><button class="mini danger">remove</button></form></td></tr>`).join('')
    const docs = a.docs.map((d) => `<tr><td>${esc(d.filename)}</td><td class="muted">${esc(d.summary.slice(0, 160))}</td><td>${d.path ? '<span class="pill">in vault</span>' : '<span class="pill" style="color:#ff8a80">not stored</span>'}</td><td>${when(d.created)}</td></tr>`).join('')
    const routines = a.schedules.map((s) => `<tr><td class="mono">${esc(s)}</td>
      <td class="row"><form method="post" action="/cabinet/${a.id}/run"><input type="hidden" name="label" value="${esc(s.split(' ').slice(-1)[0])}"><button class="mini">Run now</button></form>
      <form method="post" action="/cabinet/${a.id}/schedules"><input type="hidden" name="remove" value="${esc(s)}"><button class="mini danger">remove</button></form></td></tr>`).join('')
    const runs = a.runs.map((r) => `<tr><td>${dot(r.status)}${esc(r.status)}</td><td>${esc(r.label)}</td><td>${when(r.started)}</td><td class="mono">${esc((r.summary || '').slice(0, 600))}</td></tr>`).join('')
    const body = `<div class="wrap">
<div class="row" style="justify-content:space-between"><div><div style="font-size:20px;font-weight:600;color:#e8ecf1">${esc(a.name)} <span class="pill">@${a.id}</span> ${a.active ? '' : '<span class="pill" style="color:#ffd479">paused</span>'}</div><div class="muted">${esc(a.title)} · say “@${a.id} …” or “ask my ${esc(a.aliases[0] || a.id)}: …” on WhatsApp/Telegram</div></div>
<div class="row"><form method="post" action="/cabinet/${a.id}/active"><input type="hidden" name="active" value="${a.active ? '0' : '1'}"><button class="mini">${a.active ? 'Pause' : 'Resume'}</button></form>
${a.workspace ? `<a class="go" style="min-height:32px;padding:5px 10px;font-size:12px" href="${CODER_URL}/@asik/${esc(a.workspace)}">Open workspace ${esc(a.workspace)}</a>` : `<form method="post" action="/cabinet/${a.id}/ask"><input type="hidden" name="text" value="give yourself a workspace"><input type="hidden" name="workspace" value="1"><button class="mini" title="Creates a persistent Coder workspace agent-${a.id}">Give workspace</button></form>`}</div></div>

<div class="panel"><h3>Ask ${esc(a.name)}</h3>
<form method="post" action="/cabinet/${a.id}/ask"><textarea name="text" placeholder="One-off instruction or question. The answer lands in Activity (and on WhatsApp if ticked)." required></textarea>
<div class="row" style="margin-top:8px"><button>Send</button><label class="pill"><input type="checkbox" name="deliver" value="1"> also send to WhatsApp</label></div></form></div>

<div class="panel"><h3>Onboarding · ${a.setup.filter((s) => s.answered).length}/${a.setup.length}</h3>
${setup || '<div class="muted">This charter lists nothing to set up.</div>'}
<h3 style="margin-top:14px">Details, preferences and credentials</h3>
<table>${config ? `<tr><th>key</th><th>value</th><th></th><th>updated</th><th></th></tr>${config}` : ''}</table>
<form method="post" action="/cabinet/${a.id}/config" class="row" style="margin-top:8px">
<input type="text" name="key" placeholder="key (home_airport, or PLAID_CLIENT_ID for a secret)" required><input type="password" name="value" placeholder="value" required autocomplete="off">
<label class="pill"><input type="checkbox" name="secret" value="1"> secret (API key, password)</label><button class="mini">Save</button></form>
<div class="muted" style="font-size:12px;margin-top:6px">Plain details are remembered in Friday's memory tagged agent:${a.id} and shown to this agent in every turn. Secrets go to the NAS secrets mount (${a.secrets_available ? 'available' : '<b style="color:#ff8a80">not mounted on this runtime</b>'}) — only the name is ever displayed.</div></div>

<div class="panel"><h3>Documents · ${a.docs.length}</h3>
<table>${docs}</table>
<form method="post" action="/cabinet/${a.id}/docs" enctype="multipart/form-data" class="row" style="margin-top:8px"><input type="file" name="file" required><button class="mini">Upload</button><span class="muted" style="font-size:12px">Stored in the vault, summarized, and listed in the agent's prompt.</span></form></div>

<div class="panel"><h3>Routines</h3>
<table>${routines || '<tr><td class="muted">No schedule — works on request.</td></tr>'}</table>
<form method="post" action="/cabinet/${a.id}/schedules" class="row" style="margin-top:8px"><input type="text" name="add" placeholder="daily 07:00 brief · weekly mon 09:00 plan · monthly 1 08:30 close · hourly ping" required><button class="mini">Add routine</button></form></div>

<div class="panel"><h3>Charter</h3>
${['Mission', 'How you work', 'Boundaries', 'Setup needed', 'Routines'].map((n) => sec(n) ? `<details class="sec" ${n === 'Mission' ? 'open' : ''}><summary>${n}</summary><div style="font-size:13.5px;color:#c9d1d9">${md(sec(n))}</div></details>` : '').join('')}
<div class="muted" style="font-size:12px;margin-top:8px">Tools: ${a.tools.map((t) => `<span class="pill">${esc(t)}</span>`).join(' ')}<br>Edit the charter at soul/agents/${a.id}.md (git: asikmydeen/soul); Friday reloads within a minute.</div></div>

<div class="panel"><h3>Recent runs</h3><table>${runs || '<tr><td class="muted">No runs yet.</td></tr>'}</table></div>
</div>`
    return c.html(shell(a.name, '/cabinet', body, style, flash(c)))
  }

  const proxyForm = (path, build, redirectTo) => async (c) => {
    const id = c.req.param('id')
    const f = await c.req.formData()
    try {
      const r = await friday(path(id, f), { method: 'POST', body: build(f, id) })
      return back(c, redirectTo ? redirectTo(id) : `/cabinet/${id}`, r.message || 'Done.', !r.ok)
    } catch (e) { return back(c, `/cabinet/${id}`, e.message, true) }
  }

  app.post('/cabinet/:id/config', proxyForm((id) => `/api/cabinet/agents/${id}/config`, (f) => ({ key: f.get('key'), value: f.get('value'), secret: f.get('secret') === '1' })))
  app.post('/cabinet/:id/config/:key/delete', async (c) => {
    const { id, key } = c.req.param()
    try { await friday(`/api/cabinet/agents/${id}/config/${encodeURIComponent(key)}`, { method: 'DELETE' }); return back(c, `/cabinet/${id}`, `${key} removed.`) } catch (e) { return back(c, `/cabinet/${id}`, e.message, true) }
  })
  app.post('/cabinet/:id/run', proxyForm((id) => `/api/cabinet/agents/${id}/run`, (f) => ({ label: f.get('label') || '' }), () => '/cabinet/activity'))
  app.post('/cabinet/:id/active', proxyForm((id) => `/api/cabinet/agents/${id}/active`, (f) => ({ active: f.get('active') === '1' }), () => '/cabinet'))
  app.post('/cabinet/:id/schedules', proxyForm((id) => `/api/cabinet/agents/${id}/schedules`, (f) => ({ add: f.get('add') || '', remove: f.get('remove') || '' })))
  app.post('/cabinet/:id/ask', proxyForm((id) => `/api/cabinet/agents/${id}/ask`, (f, id) => ({ text: f.get('workspace') === '1' ? `Use manage_workspace to create a persistent Coder workspace named agent-${id} for yourself (operation create), then confirm the name.` : f.get('text'), deliver: f.get('deliver') === '1' }), () => '/cabinet/activity'))
  app.post('/cabinet/:id/docs', async (c) => {
    const id = c.req.param('id')
    try {
      const f = await c.req.formData()
      const file = f.get('file')
      if (!file || typeof file === 'string') return back(c, `/cabinet/${id}`, 'No file.', true)
      const out = new FormData()
      out.append('file', file, file.name)
      const r = await friday(`/api/cabinet/agents/${id}/docs`, { method: 'POST', form: out })
      return back(c, `/cabinet/${id}`, r.ok ? `${file.name} handed to the agent${r.stored ? ' and stored in the vault' : ' (vault store failed; summary kept)'}.` : (r.message || 'Upload failed'), !r.ok)
    } catch (e) { return back(c, `/cabinet/${id}`, e.message, true) }
  })

  // ── Schedule (7-day view) ────────────────────────────────────────────────
  app.get('/cabinet/schedule', async (c) => {
    let occ = []
    let err = ''
    try { occ = await friday('/api/cabinet/schedule?days=7') } catch (e) { err = e.message }
    const byDay = {}
    for (const o of occ) {
      const day = new Date(o.at).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', month: 'short', day: 'numeric' })
      ;(byDay[day] ||= []).push(o)
    }
    const body = `<div class="wrap">${err ? `<div class="err-banner">${esc(err)}</div>` : ''}
<div class="muted" style="margin-bottom:8px">Every routine due in the next 7 days (America/Los_Angeles). Each runs once; a run may stay silent when there is nothing worth your attention. Add or remove routines on an agent's page.</div>
${Object.entries(byDay).map(([day, list]) => `<div class="panel"><h3>${esc(day)}</h3><table>${list.map((o) => `<tr><td style="width:90px">${new Date(o.at).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' })}</td><td><a href="/cabinet/${o.agent}" style="color:#7ab7ff;text-decoration:none">@${esc(o.agent)}</a></td><td>${esc(o.label)}</td><td class="muted mono">${esc(o.spec)}</td>
<td><form method="post" action="/cabinet/${o.agent}/run"><input type="hidden" name="label" value="${esc(o.label)}"><button class="mini">Run now</button></form></td></tr>`).join('')}</table></div>`).join('') || '<div class="empty">Nothing scheduled.</div>'}
</div>`
    return c.html(shell('Schedule', '/cabinet/schedule', body, style, flash(c)))
  })

  // ── Activity (all runs, live) ────────────────────────────────────────────
  app.get('/cabinet/activity', async (c) => {
    let runs = []
    let err = ''
    try { runs = await friday('/api/cabinet/runs?limit=80') } catch (e) { err = e.message }
    const rows = runs.map((r) => `<tr><td style="white-space:nowrap">${dot(r.status)}${esc(r.status)}</td><td><a href="/cabinet/${r.agent}" style="color:#7ab7ff;text-decoration:none">@${esc(r.agent)}</a></td><td>${esc(r.label)}</td><td style="white-space:nowrap">${when(r.started)}</td><td class="mono">${esc((r.summary || '').slice(0, 900))}</td></tr>`).join('')
    const body = `<div class="wrap">${err ? `<div class="err-banner">${esc(err)}</div>` : ''}
<div class="muted" style="margin-bottom:8px">Every routine, “Run now”, question and brief, newest first. Refreshes every 20 s while something is running.</div>
<div class="panel"><table><tr><th>status</th><th>agent</th><th>what</th><th>when</th><th>result</th></tr>${rows || '<tr><td class="muted" colspan="5">No runs yet.</td></tr>'}</table></div></div>
<script>${runs.some((r) => r.status === 'running') ? 'setTimeout(()=>location.replace(location.pathname),20000);' : ''}</script>`
    return c.html(shell('Activity', '/cabinet/activity', body, style, flash(c)))
  })

  app.get('/cabinet/:id', agentPage)
}
