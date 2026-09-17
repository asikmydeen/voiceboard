import {navigation,workspaceCSS,workspaceEnd,commonScript,escapeHtml,icon} from './workspace-ui.js'
import {cabinetClient} from './cabinet-client.js'
import {connectionsClient} from './connections-client.js'
import { renderSetup, setupCSS } from './cabinet-setup.js'
// Cabinet console — Asik's view of the persistent agents.
// Friday owns the data; this module renders it and posts actions to
// /api/cabinet/* over the internal Docker network. Same board login.
const FRIDAY_API = (process.env.FRIDAY_API || 'http://app-synthesize-neural-bandwidth-csj4qo:8080').replace(/\/$/, '')
const FRIDAY_API_TOKEN = process.env.FRIDAY_API_TOKEN || ''
const CODER_URL = process.env.CODER_URL || 'https://code.asikmydeen.com'

async function friday(path, { method = 'GET', body, form, soft = false } = {}) {
  const headers = { Authorization: `Bearer ${FRIDAY_API_TOKEN}` }
  let payload
  if (form) payload = form
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
  const res = await fetch(`${FRIDAY_API}${path}`, { method, headers, body: payload, signal: AbortSignal.timeout(method === 'GET' ? 15000 : 200000) })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { message: text.slice(0, 200) } }
  if (!res.ok) {
    const msg = data?.message || data?.error || `Friday could not complete this request (${res.status}).`
    if (soft) return { ok: false, message: msg, status: res.status, ...(data || {}) }
    throw new Error(msg)
  }
  if (data?.ok === false && !soft) throw new Error(data.message || 'Friday could not complete this request.')
  return data
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
const when = (ts) => ts ? new Date(ts * 1000).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
const whenIso = (iso) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
const STATUS = { queued: '#ffd479', delivered: '#4ade80', done: '#4ade80', silent: '#8b95a3', running: '#7ab7ff', failed: '#ff8a80' }
const dot = (s) => `<span class="dot" style="background:${STATUS[s] || '#5c6675'}" title="${esc(s)}"></span>`
const md = (s) => esc(s).replace(/^- (.*)$/gm, '<li>$1</li>').replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`).replace(/\n{2,}/g, '<br>')
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const CHANNELS = ['whatsapp', 'telegram', 'alexa']

const CSS = `
.nav{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.nav a{color:#8fa3bd;text-decoration:none;font-size:13px;padding:4px 0;border-bottom:2px solid transparent}
.nav a.on{color:#e8ecf1;font-weight:600;border-bottom-color:#2563eb}
.wrap{max-width:1180px;margin:0 auto;padding:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.agent{background:#151b23;border:1px solid #232b36;border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:8px;transition:border-color .15s}
.agent:hover{border-color:#3a4658}
.agent.paused{opacity:.55}
.agent .name{display:flex;justify-content:space-between;align-items:center;font-weight:600;color:#e8ecf1;font-size:16px}
.agent .name a{color:inherit;text-decoration:none}
.agent .role{color:#9aa5b1;font-size:13px;min-height:2.4em}
.kv{display:flex;justify-content:space-between;font-size:12px;color:#8b95a3;gap:8px}
.kv b{color:#c9d1d9;font-weight:500;text-align:right}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
.bar{height:5px;background:#232b36;border-radius:3px;overflow:hidden}.bar i{display:block;height:100%;background:#2563eb}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.panel{background:#151b23;border:1px solid #232b36;border-radius:14px;padding:16px 18px;margin:14px 0}
.panel h3{margin:0 0 10px;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#8b95a3}
.panel input,.panel textarea,.panel select{background:#0e1116;border:1px solid #232b36;color:#d7dce3;border-radius:8px;padding:8px 10px;font-size:14px}
.panel textarea{width:100%;min-height:80px;font-family:inherit}
.panel input[type=text],.panel input[type=password],.panel input[type=time],.panel input[type=number]{flex:1;min-width:120px}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:8px 8px;border-bottom:1px solid #1d2632;text-align:left;vertical-align:top}th{color:#8b95a3;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.mono{white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;color:#c9d1d9}
.pill{background:#1d2632;border-radius:6px;padding:2px 8px;font-size:11px;color:#8fa3bd;display:inline-flex;align-items:center;gap:5px}
.check{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid #1d2632}
.check .q{flex:1}.check .q small{display:block;color:#5c6675;margin-top:2px}
.ok{color:#4ade80}.muted{color:#5c6675}
.tabs{display:flex;gap:4px;border-bottom:1px solid #232b36;margin:8px 0 0}
.tabs a{color:#8b95a3;text-decoration:none;font-size:13px;padding:10px 14px;border-radius:8px 8px 0 0}
.tabs a.on{color:#e8ecf1;background:#151b23;border:1px solid #232b36;border-bottom-color:#151b23;margin-bottom:-1px}
.hero{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:4px}
.hero h2{margin:0;font-size:22px;color:#e8ecf1;font-weight:650}
.stat{background:#151b23;border:1px solid #232b36;border-radius:12px;padding:12px 14px;min-width:140px}
.stat .n{font-size:22px;font-weight:650;color:#e8ecf1}.stat .l{font-size:11px;color:#8b95a3;text-transform:uppercase;letter-spacing:.08em}
.tools{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:6px}
.tools label{display:flex;gap:8px;align-items:flex-start;background:#0e1116;border:1px solid #232b36;border-radius:8px;padding:8px;font-size:12.5px;color:#c9d1d9}
.tools label.locked{opacity:.7}
.tools small{display:block;color:#5c6675;font-size:11px}
.preview{background:#0e1116;border:1px solid #232b36;border-radius:10px;padding:12px;max-height:420px;overflow:auto;font-size:12.5px;white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;color:#c9d1d9}
.sched-builder{display:flex;flex-wrap:wrap;gap:8px;align-items:end}
.sched-builder label{display:flex;flex-direction:column;gap:4px;font-size:11px;color:#8b95a3}
.err-banner{margin:10px 18px 0;background:#3a1d1d;border:1px solid #5a2a2a;color:#ffb4ae;border-radius:8px;padding:8px 12px;font-size:13px}
.flash{margin:10px 18px 0;background:#1a2b3d;border:1px solid #2a4a6a;color:#cfe4ff;border-radius:8px;padding:8px 12px;font-size:13px}
button.mini{min-height:32px;padding:5px 10px;font-size:12px}
.dep-ok{color:#4ade80}.dep-bad{color:#ff8a80}
`

function shell(title, active, body, style, flashHtml = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Friday</title><link rel="icon" href="/icon.svg" type="image/svg+xml"><meta name="theme-color" content="#101318">
<style>${style}${CSS}${workspaceCSS}</style></head><body>${navigation(active,title)}${flashHtml}${body}${workspaceEnd}${commonScript}</body></html>`
}

const flash = (c) => {
  const m = c.req.query('m')
  const e = c.req.query('e')
  if (e) return `<div class="err-banner" role="alert">${esc(e)}</div>`
  return m ? `<div class="flash" role="status">${esc(m)}</div>` : ''
}
export const returnPath = (path, msg, err) => {
  const url = new URL(path && /^\/cabinet(?:\/|\?|$)/.test(path) ? path : '/cabinet', 'http://board.local')
  url.searchParams.set(err ? 'e' : 'm', msg || '')
  return url.pathname + url.search
}
const back = (c, path, msg, err) => c.redirect(returnPath(path, msg, err))

const agentTabs = (id, on) => {
  const tabs = [['', 'Overview'], ['/configure', 'Configure'], ['/onboard', 'Access & docs'], ['/capabilities', 'Capabilities'], ['/runs', 'Runs']]
  return `<div class="tabs">${tabs.map(([s, l]) => `<a href="/cabinet/${id}${s}" class="${s === on ? 'on' : ''}">${l}</a>`).join('')}</div>`
}

function agentHero(a, tab = '') {
  return `<div class="hero">
    <div><h2>${esc(a.name)} <span class="pill">@${a.id}</span>${a.active ? '' : ' <span class="pill" style="color:#ffd479">paused</span>'}</h2>
      <div class="muted">${esc(a.title)} · WhatsApp / Telegram: “@${a.id} …” or “ask my ${esc((a.aliases && a.aliases[0]) || a.id)}: …”</div></div>
    <div class="row">
      <form method="post" action="/cabinet/${a.id}/active"><input type="hidden" name="active" value="${a.active ? '0' : '1'}"><button class="mini">${a.active ? 'Pause' : 'Resume'}</button></form>
      ${a.workspace ? `<a class="go" style="min-height:32px;padding:5px 10px;font-size:12px" href="${CODER_URL}/@asik/${esc(a.workspace)}">Workspace ${esc(a.workspace)}</a>` : ''}
      <a class="go" style="min-height:32px;padding:5px 10px;font-size:12px" href="/cabinet/${a.id}/configure">Configure</a>
    </div></div>${agentTabs(a.id, tab)}`
}

export function mountCabinet(app, { style }) {
  // ── Roster ────────────────────────────────────────────────────────────────
  app.get('/cabinet', async (c) => {
    let agents = [], err = ''
    try { agents = await friday('/api/cabinet/agents') } catch (e) { err = e.message }
    const due = agents.filter((a) => a.active && a.next).length
    const setupLeft = agents.reduce((n, a) => n + Math.max(0, (a.setup?.total || 0) - (a.setup?.done || 0)), 0)
    const cards = agents.map((a,index) => {
      const total=a.setup?.total||0,done=a.setup?.done||0,pct=total?Math.round(100*done/total):100
      const state=!a.active?'Paused':a.last?.status==='running'?'Running':a.last?.status==='failed'?'Needs attention':done<total?'Needs setup':'Ready'
      const action=state==='Needs setup'?['/cabinet/setup?agent='+a.id,'Continue setup']:state==='Running'?['/cabinet/'+a.id,'Follow progress']:['/cabinet/'+a.id,state==='Needs attention'?'Review issue':'Ask '+a.name]
      const colors=['#a5c1ff','#94d8c5','#d5b9f3','#efc188']
      return `<article class="agent ${a.active?'':'paused'}" style="--agent-color:${colors[index%colors.length]}">
<div class="name"><span class="agent-avatar" aria-hidden="true">${esc(a.name.split(/\s+/).map(w=>w[0]).slice(0,2).join(''))}</span><a href="/cabinet/${a.id}">${esc(a.name)}</a></div>
<div class="role">${esc(a.title)}</div><div><span class="state ${state==='Ready'?'ready':state==='Running'?'running':state.startsWith('Needs')?'attention':''}">${state}</span></div>
<div class="kv"><span>Next</span><b>${a.next?esc(a.next.label)+' · '+whenIso(a.next.at):a.active?'When you ask':'Paused'}</b></div>
<div class="kv"><span>Setup</span><b>${done} of ${total} decisions</b></div><div class="bar" aria-label="Setup ${pct}% complete"><i style="width:${pct}%"></i></div>
<div class="agent-actions"><a class="go secondary" href="${action[0]}">${esc(action[1])}</a><details><summary aria-label="More actions for ${esc(a.name)}">More</summary><div class="menu-list"><a href="/cabinet/${a.id}/configure">Configure</a><a href="/cabinet/${a.id}/onboard">Access & documents</a><a href="/cabinet/${a.id}/capabilities">Capabilities</a><a href="/cabinet/${a.id}/runs">Run history</a><form method="post" action="/cabinet/${a.id}/run"><button class="secondary">Run now</button></form></div></details></div></article>`
    }).join('')
    const failed=agents.filter(a=>a.last?.status==='failed')
    const body = `<div class="wrap">
${err?`<div class="err-banner" role="alert">${esc(err)}</div>`:''}
<div class="hero"><div><div class="eyebrow">Your personal advisors</div><h2>The Cabinet</h2><p class="muted">A clear view of who is ready, what is running, and what needs you.</p></div><div class="row"><button class="secondary" data-open-dialog="new-agent">New agent</button><button data-open-dialog="brief-cabinet">Brief Cabinet</button></div></div>
<section class="panel attention-panel"><div><h3>${setupLeft||failed.length?'Needs your attention':'Your Cabinet is ready'}</h3><p>${setupLeft?setupLeft+' setup decisions left. Start with three that make your advisors more useful.':failed.length?'Review recent issues before starting more work.':'Ask an advisor or give the whole Cabinet a brief.'}</p></div><div class="attention-links">${setupLeft?'<a class="go" href="/cabinet/setup?session=3">Answer three questions</a>':''}${failed.length?`<a class="go secondary" href="/cabinet/activity">Review ${failed.length} issue${failed.length===1?'':'s'}</a>`:''}${!setupLeft&&!failed.length?'<a class="go secondary" href="/cabinet/activity">View activity</a>':''}</div></section>
<div class="stats-inline"><span><b>${agents.filter(a=>a.active).length}</b> active advisors</span><span><b>${due}</b> with an upcoming routine</span><span><b>${agents.filter(a=>a.last?.status==='running').length}</b> running</span></div>
<div class="grid">${cards||'<div class="empty">Create your first advisor to get started.</div>'}</div>
<dialog class="dialog" id="brief-cabinet" aria-labelledby="brief-title"><div class="dialog-head"><h2 id="brief-title">Brief the Cabinet</h2><button class="secondary" data-close-dialog>Close</button></div><div class="dialog-body"><form method="post" action="/cabinet/assign"><label for="cabinet-brief">What would you like help with?</label><textarea id="cabinet-brief" name="text" rows="6" placeholder="From your role, what is the one decision I should make this month?" required></textarea><p class="dialog-note">Choose the advisors who should respond.</p><div class="row">${agents.filter(a=>a.active).map(a=>`<label class="pill"><input type="checkbox" name="agents" value="${a.id}" checked> ${esc(a.name)}</label>`).join('')}</div><div class="row" style="margin-top:24px"><button>Send brief</button><label><input type="checkbox" name="deliver" value="1"> Also send to WhatsApp</label></div><p class="dialog-note">Each response appears in Activity as it finishes.</p></form></div></dialog>
<dialog class="dialog" id="new-agent" aria-labelledby="new-title"><div class="dialog-head"><h2 id="new-title">Create an advisor</h2><button class="secondary" data-close-dialog>Close</button></div><div class="dialog-body"><form method="post" action="/cabinet/create"><label for="agent-name">Name</label><input id="agent-name" type="text" name="name" placeholder="Garden Planner" required><label for="agent-mission">What should this advisor help with?</label><textarea id="agent-mission" name="mission" rows="5" required></textarea><p class="dialog-note">You can configure its access and routines after creating it.</p><button>Create advisor</button></form></div></dialog></div>`
    return c.html(shell('Agents', '/cabinet', body, style, flash(c)))
  })

  app.post('/cabinet/assign', async (c) => {
    const f = await c.req.formData()
    const agents = f.getAll('agents')
    if (!agents.length) return back(c, '/cabinet', 'Choose at least one advisor for this brief.', true)
    try {
      const r = await friday('/api/cabinet/assign', { method: 'POST', body: { text: f.get('text'), agents, deliver: f.get('deliver') === '1' } })
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

  const loadAgent = async (id) => friday(`/api/cabinet/agents/${encodeURIComponent(id)}`)

  // ── Overview ──────────────────────────────────────────────────────────────
  const overview = async (c) => {
    const id = c.req.param('id')
    const conversationId = c.req.query('conversation') || ''
    let a
    try { a = await loadAgent(id) } catch (e) { return c.html(shell(id, '/cabinet', `<div class="wrap"><div class="err-banner">${esc(e.message)}</div></div>`, style)) }
    if (!a || a.error) return c.text('no such agent', 404)
    const runs = (a.runs || []).slice(0, 6).map((r) => `<tr><td>${dot(r.status)}${esc(r.status)}</td><td>${esc(r.label)}</td><td>${when(r.started)}</td><td class="mono">${esc((r.summary || '').slice(0, 280))}</td></tr>`).join('')
    const pending = (a.setup || []).filter((s) => !s.answered)
    const body = `<div class="wrap">${agentHero(a, '')}
<div class="row" style="margin-top:14px">
  <div class="stat"><div class="n">${(a.setup || []).filter((s) => s.answered).length}/${(a.setup || []).length}</div><div class="l">onboarded</div></div>
  <div class="stat"><div class="n">${(a.docs || []).length}</div><div class="l">documents</div></div>
  <div class="stat"><div class="n">${(a.schedules || []).length}</div><div class="l">routines</div></div>
  <div class="stat"><div class="n">${(a.tools || []).length}</div><div class="l">tools</div></div>
</div>
<div class="run-layout"><section class="panel" data-conversation="${esc(a.id)}"><h3>Ask ${esc(a.name)}</h3>
<div class="row" style="margin-bottom:10px"><button type="button" class="secondary mini" data-new-conversation>New conversation</button><a class="go secondary" href="/cabinet/${a.id}/capabilities">Capabilities</a></div>
<div data-message-feed class="mono" style="max-height:280px;overflow:auto;margin-bottom:12px;background:#0e1116;border:1px solid #232b36;border-radius:10px;padding:10px"></div>
<p class="local-feedback" id="ask-thread-status" role="status">Send a request to continue this thread.</p>
<form data-inline-ask data-thread-ask method="post" action="/cabinet/${a.id}/ask"><input type="hidden" name="conversation_id" value="${esc(conversationId)}"><label for="advisor-request">What would you like help with?</label><textarea id="advisor-request" name="text" rows="6" placeholder="Give this advisor a question or a task." required></textarea><div class="row" style="margin-top:16px"><button type="submit">Send request</button><label><input type="checkbox" name="deliver" value="1"> Also WhatsApp</label></div></form><p class="dialog-note">Follow-ups reuse the same conversation when Connections is enabled.</p><a href="/">Open your Board</a></section><section class="panel"><div class="row"><h3>Recent activity</h3><button class="secondary" data-refresh-runs>Refresh</button></div><p class="local-feedback" id="run-feedback" role="status">Loading activity…</p><div data-run-feed="${a.id}"></div></section></div>
${pending.length ? `<div class="panel"><h3>Still to set up</h3>${pending.map((s) => `<div class="check"><span>○</span><div class="q">${esc(s.question)}${s.default ? `<small>Default: ${esc(s.default)}</small>` : ''}</div></div>`).join('')}<div class="row" style="margin-top:10px"><a class="go" href="/cabinet/setup?agent=${a.id}">Continue setup</a></div></div>` : ''}
</div><script>(${cabinetClient.toString()})();(${connectionsClient.toString()})();</script>`
    return c.html(shell(a.name, '/cabinet', body, style, flash(c)))
  }

  // ── Configure ─────────────────────────────────────────────────────────────
  app.get('/cabinet/:id/configure', async (c) => {
    const id = c.req.param('id')
    let a, tools = [], preview = null, err = ''
    try {
      ;[a, tools, preview] = await Promise.all([loadAgent(id), friday('/api/cabinet/tools'), friday(`/api/cabinet/agents/${id}/preview`)])
    } catch (e) { err = e.message }
    if (!a || a.error) return c.text('no such agent', 404)
    const granted = new Set(a.tools || [])
    const toolBoxes = tools.map((t) => `<label class="${t.base ? 'locked' : ''}"><input type="checkbox" name="tools" value="${esc(t.name)}" ${granted.has(t.name) || t.base ? 'checked' : ''} ${t.base ? 'disabled' : ''}><span><b>${esc(t.name)}</b>${t.base ? ' <span class="pill">always</span>' : ''}<small>${esc(t.description)}</small></span></label>`).join('')
    const chans = CHANNELS.map((ch) => `<label class="pill"><input type="checkbox" name="channels" value="${ch}" ${(a.channels || []).includes(ch) ? 'checked' : ''}> ${ch}</label>`).join('')
    const schedRows = (a.schedules || []).map((s) => `<tr><td class="mono">${esc(s)}</td>
      <td class="row"><form method="post" action="/cabinet/${a.id}/run"><input type="hidden" name="label" value="${esc((s.split(' ').pop()) || '')}"><button class="mini">Run now</button></form>
      <form method="post" action="/cabinet/${a.id}/schedules"><input type="hidden" name="remove" value="${esc(s)}"><button class="mini danger">remove</button></form></td></tr>`).join('')
    const body = `<div class="wrap">${err ? `<div class="err-banner">${esc(err)}</div>` : ''}
<div class="hero"><div><h2>Configure ${esc(a.name)}</h2><div class="muted">Changes rewrite the charter through the apply token and take effect within a minute.</div></div></div>
${agentTabs(a.id, '/configure')}

<div class="panel"><h3>Identity and channels</h3>
<form method="post" action="/cabinet/${a.id}/charter">
<div class="row"><label class="muted" style="flex-direction:column;display:flex;gap:4px;font-size:11px">Display name<input type="text" name="name" value="${esc(a.name)}"></label>
<label class="muted" style="flex-direction:column;display:flex;gap:4px;font-size:11px;flex:2">Title<input type="text" name="title" value="${esc(a.title)}"></label>
<label class="muted" style="flex-direction:column;display:flex;gap:4px;font-size:11px;flex:2">Aliases<input type="text" name="aliases" value="${esc((a.aliases || []).join(','))}" placeholder="cfo,money,budget"></label>
<label class="muted" style="flex-direction:column;display:flex;gap:4px;font-size:11px">Workspace<input type="text" name="workspace" value="${esc(a.workspace || '')}" placeholder="agent-${a.id}"></label></div>
<div class="row" style="margin-top:10px">${chans}</div>
<div class="row" style="margin-top:10px"><button>Save identity</button></div>
</form></div>

<div class="panel"><h3>Tools this agent may use</h3>
<form method="post" action="/cabinet/${a.id}/charter">
<div class="tools">${toolBoxes}</div>
<div class="row" style="margin-top:10px"><button>Save tools</button><span class="muted">Base tools (now, recall, soul_read, soul_propose, delivery_status) stay on.</span></div>
</form></div>

<div class="panel"><h3>Routines</h3>
<table>${schedRows || '<tr><td class="muted">No schedule — works on request.</td></tr>'}</table>
<form method="post" action="/cabinet/${a.id}/schedules" class="sched-builder" style="margin-top:12px">
  <label>Kind<select name="kind"><option>daily</option><option>weekly</option><option>monthly</option><option>hourly</option></select></label>
  <label>Day / weekday<input type="text" name="when" placeholder="sun  or  1"></label>
  <label>Time<input type="time" name="time" value="09:00"></label>
  <label>Label<input type="text" name="label" placeholder="money-review" required></label>
  <button class="mini">Add routine</button>
</form>
<div class="muted" style="font-size:12px;margin-top:6px">Kind + day + time + label become <span class="mono">weekly sun 09:00 money-review</span>. Hourly ignores day and time. Each occurrence runs once; a silent reply is recorded, not delivered.</div>
</div>

<div class="panel"><h3>Charter text</h3>
<form method="post" action="/cabinet/${a.id}/charter">
<label class="muted" style="display:block;font-size:11px;margin-bottom:4px">Mission</label>
<textarea name="mission" style="min-height:70px">${esc((a.sections && a.sections.Mission) || '')}</textarea>
<label class="muted" style="display:block;font-size:11px;margin:10px 0 4px">How you work</label>
<textarea name="how_you_work" style="min-height:90px">${esc((a.sections && a.sections['How you work']) || '')}</textarea>
<label class="muted" style="display:block;font-size:11px;margin:10px 0 4px">Boundaries</label>
<textarea name="boundaries">${esc((a.sections && a.sections.Boundaries) || '')}</textarea>
<label class="muted" style="display:block;font-size:11px;margin:10px 0 4px">Setup questions (keep the [id:…] and [legacy:…] tags when rewording)</label>
<textarea name="setup_needed">${esc((a.sections && a.sections['Setup needed']) || '')}</textarea>
<div class="row" style="margin-top:10px"><button>Save charter</button></div>
</form></div>

<div class="panel"><h3>What this agent sees on the next turn</h3>
<div class="muted" style="margin-bottom:8px">Live preview of the persona block plus the config/documents Friday will inject. Use this to confirm onboarding answers and secrets (names only) are actually being read.</div>
<div class="preview">${esc((preview && preview.prompt) || '(empty)')}</div>
<div class="muted" style="margin-top:8px;font-size:12px">Tools: ${(preview && preview.tools || []).map((t) => `<span class="pill">${esc(t)}</span>`).join(' ')} · channels: ${(preview && preview.channels || []).join(', ')} · secrets mount ${preview && preview.secrets_available ? '<span class="ok">available</span>' : '<span class="dep-bad">missing</span>'}</div>
</div>
</div>`
    return c.html(shell(`Configure ${a.name}`, '/cabinet', body, style, flash(c)))
  })

  // ── Onboard ───────────────────────────────────────────────────────────────
  app.get('/cabinet/:id/onboard', async (c) => {
    const id = c.req.param('id')
    let a, preview = null
    try { a = await loadAgent(id); preview = await friday(`/api/cabinet/agents/${id}/preview`) } catch (e) { return c.html(shell(id, '/cabinet', `<div class="wrap"><div class="err-banner">${esc(e.message)}</div></div>`, style)) }
    if (!a || a.error) return c.text('no such agent', 404)
    const setup = (a.setup || []).map((s) => `<div class="check"><span>${s.answered ? '<span class="ok">✓</span>' : '○'}</span><div class="q">${esc(s.question)}${s.default ? `<small>Default: ${esc(s.default)}</small>` : ''}
      <form method="post" action="/cabinet/${a.id}/config" class="row" style="margin-top:6px"><input type="hidden" name="key" value="${esc(s.key)}"><input type="text" name="value" value="${esc((a.config.find((k) => k.key === s.key) || {}).value || '')}" placeholder="${esc(s.default || 'your answer')}" required><button class="mini">${s.answered ? 'Update' : 'Save'}</button></form>
    </div></div>`).join('')
    const config = (a.config || []).map((k) => `<tr><td class="mono">${esc(k.key)}</td><td class="mono">${esc(k.value)}</td><td>${k.secret ? '<span class="pill">secret</span>' : ''}</td><td>${when(k.updated)}</td>
      <td><form method="post" action="/cabinet/${a.id}/config/${encodeURIComponent(k.key)}/delete"><button class="mini danger">remove</button></form></td></tr>`).join('')
    const docs = (a.docs || []).map((d) => `<tr><td>${esc(d.filename)}</td><td class="muted">${esc((d.summary || '').slice(0, 160))}</td><td>${d.path ? '<span class="pill">in vault</span>' : '<span class="pill" style="color:#ff8a80">not stored</span>'}</td><td>${when(d.created)}</td></tr>`).join('')
    const body = `<div class="wrap">
<div class="hero"><div><h2>Details for ${esc(a.name)}</h2><div class="muted">Manage additional details and protected credentials. Setup answers have their own visibility and revision history.</div></div></div>
${agentTabs(a.id, '/onboard')}
<div class="panel"><h3>Setup and preferences</h3><p>Review answers, drafts, shared preferences, and advisor examples in one place.</p><a class="go" href="/cabinet/setup?agent=${a.id}&status=all">Open ${esc(a.name)} setup</a></div>
<div class="panel"><h3>Details and credentials</h3>
<table>${config ? `<tr><th>key</th><th>value</th><th></th><th>updated</th><th></th></tr>${config}` : ''}</table>
<form method="post" action="/cabinet/${a.id}/config" class="row" style="margin-top:10px">
<input type="text" name="key" placeholder="home_airport  or  PLAID_CLIENT_ID" required>
<input type="password" name="value" placeholder="value" required autocomplete="off">
<label class="pill"><input type="checkbox" name="secret" value="1"> secret (API key)</label><button class="mini">Save</button></form>
<div class="muted" style="font-size:12px;margin-top:6px">Secrets go to /mnt/asik_home_8/secrets/agents/${a.id}.env (${a.secrets_available ? '<span class="ok">mounted</span>' : '<b class="dep-bad">not mounted</b>'}) — only the name is ever shown.</div></div>
<div class="panel"><h3>Documents · ${(a.docs || []).length}</h3>
<table>${docs}</table>
<form method="post" action="/cabinet/${a.id}/docs" enctype="multipart/form-data" class="row" style="margin-top:10px"><input type="file" name="file" required><button class="mini">Upload</button><span class="muted" style="font-size:12px">Vault + summary + listed in the prompt.</span></form></div>
<div class="panel"><h3>What ${esc(a.name)} will see from this setup</h3>
<div class="preview">${esc((preview && preview.config_block) || '(nothing configured yet)')}</div></div>
</div>`
    return c.html(shell(`Onboard ${a.name}`, '/cabinet', body, style, flash(c)))
  })

  app.get('/cabinet/:id/runs', async (c) => {
    const id = c.req.param('id')
    let a
    try { a = await loadAgent(id) } catch (e) { return c.html(shell(id, '/cabinet', `<div class="wrap"><div class="err-banner">${esc(e.message)}</div></div>`, style)) }
    if (!a || a.error) return c.text('no such agent', 404)
    const rows = (a.runs || []).map((r) => `<tr><td>${dot(r.status)}${esc(r.status)}</td><td>${esc(r.label)}</td><td>${when(r.started)}</td><td class="mono">${esc((r.summary || '').slice(0, 900))}</td></tr>`).join('')
    const body = `<div class="wrap"><div class="hero"><div><h2>${esc(a.name)} runs</h2></div></div>${agentTabs(a.id, '/runs')}
<div class="panel"><table><tr><th>status</th><th>what</th><th>when</th><th>result</th></tr>${rows || '<tr><td class="muted" colspan="4">No runs yet.</td></tr>'}</table></div></div>`
    return c.html(shell(`${a.name} runs`, '/cabinet', body, style, flash(c)))
  })

  const proxyForm = (path, build, redirectTo) => async (c) => {
    const id = c.req.param('id')
    const f = await c.req.formData()
    try {
      const r = await friday(path(id, f), { method: 'POST', body: build(f, id) })
      return back(c, redirectTo ? redirectTo(id, f) : `/cabinet/${id}`, r.message || 'Done.', !r.ok)
    } catch (e) { return back(c, `/cabinet/${id}`, e.message, true) }
  }

  app.post('/cabinet/:id/config', proxyForm((id) => `/api/cabinet/agents/${id}/config`, (f) => ({ key: f.get('key'), value: f.get('value'), secret: f.get('secret') === '1' }), (id, f) => (f && f.get('next')) || `/cabinet/${id}/onboard`))
  app.post('/cabinet/:id/config/:key/delete', async (c) => {
    const { id, key } = c.req.param()
    try { await friday(`/api/cabinet/agents/${id}/config/${encodeURIComponent(key)}`, { method: 'DELETE' }); return back(c, `/cabinet/${id}/onboard`, `${key} removed.`) } catch (e) { return back(c, `/cabinet/${id}/onboard`, e.message, true) }
  })
  app.post('/cabinet/:id/run', proxyForm((id) => `/api/cabinet/agents/${id}/run`, (f) => ({ label: f.get('label') || '' }), () => '/cabinet/activity'))
  app.post('/cabinet/:id/active', proxyForm((id) => `/api/cabinet/agents/${id}/active`, (f) => ({ active: f.get('active') === '1' }), () => '/cabinet'))
  app.post('/cabinet/:id/schedules', async (c) => {
    const id = c.req.param('id')
    const f = await c.req.formData()
    let add = (f.get('add') || '').trim()
    if (!add && f.get('kind')) {
      const kind = f.get('kind')
      const label = (f.get('label') || '').trim().replace(/\s+/g, '-')
      const time = f.get('time') || '09:00'
      const whenPart = (f.get('when') || '').trim()
      if (kind === 'hourly') add = `hourly ${label}`
      else if (kind === 'daily') add = `daily ${time} ${label}`
      else if (kind === 'weekly') add = `weekly ${(whenPart || 'mon').slice(0, 3).toLowerCase()} ${time} ${label}`
      else if (kind === 'monthly') add = `monthly ${parseInt(whenPart, 10) || 1} ${time} ${label}`
    }
    try {
      const r = await friday(`/api/cabinet/agents/${id}/schedules`, { method: 'POST', body: { add, remove: f.get('remove') || '' } })
      return back(c, `/cabinet/${id}/configure`, r.message || 'Done.', !r.ok)
    } catch (e) { return back(c, `/cabinet/${id}/configure`, e.message, true) }
  })
  app.post('/cabinet/:id/charter', async (c) => {
    const id = c.req.param('id')
    const f = await c.req.formData()
    const patch = {}
    for (const k of ['name', 'title', 'aliases', 'workspace', 'mission', 'how_you_work', 'boundaries', 'setup_needed']) {
      if (f.has(k)) patch[k] = f.get(k)
    }
    const tools = f.getAll('tools')
    if (tools.length) patch.tools = tools
    const channels = f.getAll('channels')
    if (channels.length) patch.channels = channels
    try {
      const r = await friday(`/api/cabinet/agents/${id}/charter`, { method: 'POST', body: patch })
      return back(c, `/cabinet/${id}/configure`, r.message || 'Saved.', !r.ok)
    } catch (e) { return back(c, `/cabinet/${id}/configure`, e.message, true) }
  })
  app.post('/cabinet/:id/ask', proxyForm((id) => `/api/cabinet/agents/${id}/ask`, (f, id) => ({ text: f.get('workspace') === '1' ? `Use manage_workspace to create a persistent Coder workspace named agent-${id} for yourself (operation create), then confirm the name.` : f.get('text'), deliver: f.get('deliver') === '1' }), () => '/cabinet/activity'))
  app.post('/cabinet/:id/docs', async (c) => {
    const id = c.req.param('id')
    try {
      const f = await c.req.formData()
      const file = f.get('file')
      if (!file || typeof file === 'string') return back(c, `/cabinet/${id}/onboard`, 'No file.', true)
      const out = new FormData()
      out.append('file', file, file.name)
      const r = await friday(`/api/cabinet/agents/${id}/docs`, { method: 'POST', form: out })
      return back(c, `/cabinet/${id}/onboard`, r.ok ? `${file.name} handed to the agent${r.stored ? ' and stored in the vault' : ' (vault store failed; summary kept)'}.` : (r.message || 'Upload failed'), !r.ok)
    } catch (e) { return back(c, `/cabinet/${id}/onboard`, e.message, true) }
  })

  // Setup API stays behind the existing Board authentication middleware.
  app.all('/cabinet/setup/api/*', async (c) => {
    const origin = c.req.header('Origin')
    if (c.req.method !== 'GET' && origin && new URL(origin).host !== new URL(c.req.url).host) return c.json({ok:false,message:'Use setup from this Board tab.'}, 403)
    const path = c.req.path.slice('/cabinet/setup/api/'.length)
    if (!/^[a-zA-Z0-9_/-]+$/.test(path)) return c.json({ok:false,message:'Invalid setup action.'},400)
    try {
      let options = {method:c.req.method}
      if (c.req.method !== 'GET') {
        if ((c.req.header('Content-Type') || '').includes('multipart/form-data')) options.form = await c.req.formData()
        else options.body = await c.req.json()
      }
      return c.json(await friday('/api/cabinet/setup/' + path, options))
    } catch (e) { return c.json({ok:false,message:e.message}, 400) }
  })
  app.get('/cabinet/setup', async (c) => {
    try {
      const data = await friday('/api/cabinet/setup/workspace')
      if (!data || !Array.isArray(data.agents)) throw new Error('Setup data is unavailable. Your saved answers are safe.')
      return c.html(shell('Setup', '/cabinet/setup', renderSetup(data, {agent:c.req.query('agent') || '',status:c.req.query('status') || 'left'}), style + setupCSS))
    } catch (e) {
      return c.html(shell('Setup', '/cabinet/setup', `<main class="setup"><h2>Setup could not load</h2><p role="alert">${esc(e.message)}</p><a href="/cabinet/setup">Try again</a> · <a href="/cabinet">Return to Cabinet</a></main>`, style + setupCSS), 503)
    }
  })

  app.get('/cabinet/live', async c => {
    try { const runs=await friday('/api/cabinet/runs?limit=300'); const agent=c.req.query('agent'); c.header('Cache-Control','no-store'); return c.json((agent?runs.filter(r=>r.agent===agent):runs).slice(0,80)) }
    catch(e){return c.json({ok:false,message:e.message},503)}
  })
  app.post('/cabinet/:id/ask-live', async c => {
    const origin=c.req.header('Origin')
    if(origin&&new URL(origin).host!==new URL(c.req.url).host)return c.json({ok:false,message:'Use this action from your Board.'},403)
    try {
      const body=await c.req.json()
      if(!String(body.text||'').trim())return c.json({ok:false,message:'Write a request first.'},400)
      const payload={text:String(body.text).slice(0,8000),deliver:body.deliver===true,wait:true,request_id:body.request_id}
      if(body.conversation_id)payload.conversation_id=String(body.conversation_id)
      return c.json(await friday(`/api/cabinet/agents/${encodeURIComponent(c.req.param('id'))}/ask`,{method:'POST',body:payload}))
    }
    catch(e){return c.json({ok:false,message:e.message},502)}
  })
  app.get('/cabinet/:id/conversations/:cid', async c => {
    try {
      return c.json(await friday(`/api/cabinet/agents/${encodeURIComponent(c.req.param('id'))}/conversations/${encodeURIComponent(c.req.param('cid'))}`))
    } catch (e) { return c.json({ok: false, message: e.message}, 502) }
  })

  // ── Schedule ──────────────────────────────────────────────────────────────
  app.get('/cabinet/schedule', async (c) => {
    let occ = [], err = ''
    try { occ = await friday('/api/cabinet/schedule?days=7') } catch (e) { err = e.message }
    const byDay = {}
    for (const o of occ) {
      const day = new Date(o.at).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', month: 'short', day: 'numeric' })
      ;(byDay[day] ||= []).push(o)
    }
    const body = `<div class="wrap">${err ? `<div class="err-banner">${esc(err)}</div>` : ''}
<div class="hero"><div><h2>Schedule</h2><div class="muted">Every routine due in the next 7 days (America/Los_Angeles). Each occurrence runs once. Add or remove on an agent's Configure page.</div></div>
<div class="stat"><div class="n">${occ.length}</div><div class="l">occurrences</div></div></div>
${Object.entries(byDay).map(([day, list]) => `<div class="panel"><h3>${esc(day)} · ${list.length}</h3><table>${list.map((o) => `<tr><td style="width:90px">${new Date(o.at).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' })}</td><td><a href="/cabinet/${o.agent}" style="color:#7ab7ff;text-decoration:none">@${esc(o.agent)}</a></td><td>${esc(o.label)}</td><td class="muted mono">${esc(o.spec)}</td>
<td><form method="post" action="/cabinet/${o.agent}/run"><input type="hidden" name="label" value="${esc(o.label)}"><button class="mini">Run now</button></form></td></tr>`).join('')}</table></div>`).join('') || '<div class="empty">Nothing scheduled.</div>'}
</div>`
    return c.html(shell('Schedule', '/cabinet/schedule', body, style, flash(c)))
  })

  // ── Activity ──────────────────────────────────────────────────────────────
  app.get('/cabinet/activity', async (c) => {
    const body=`<div class="wrap"><div class="hero"><div><div class="eyebrow">Across your Cabinet</div><h2>Activity</h2><p class="muted">Requests, routines, and results as they happen.</p></div><button class="secondary" data-refresh-runs>Refresh</button></div><section class="panel"><p class="local-feedback" id="run-feedback" role="status">Loading activity…</p><div data-run-feed=""></div></section></div><script>(${cabinetClient.toString()})();</script>`
    return c.html(shell('Activity','/cabinet/activity',body,style,flash(c)))
  })

  // ── System ────────────────────────────────────────────────────────────────
  app.get('/cabinet/system', async (c) => {
    let sys = {}, err = ''
    try { sys = await friday('/api/cabinet/system') } catch (e) { err = e.message }
    const meta = sys.deps_meta || {}
    const raw = sys.dependencies || {}
    const services = (raw.details && typeof raw.details === 'object') ? raw.details : raw
    const skip = new Set(['checked_age_seconds', 'down', 'critical_down', 'details'])
    const deps = Object.entries(services).filter(([k]) => !skip.has(k)).map(([k, v]) => {
      const ok = v && (v.ok === true || v === true)
      const crit = v && v.critical
      return `<tr><td>${esc(k)}${crit ? ' <span class="pill">critical</span>' : ''}</td><td class="${ok ? 'dep-ok' : 'dep-bad'}">${ok ? 'ok' : 'down'}</td><td class="muted mono">${esc(typeof v === 'object' ? (v.detail || v.error || '') : String(v ?? ''))}${v && v.fails ? ` · fails ${v.fails}` : ''}</td></tr>`
    }).join('')
    const runs = Object.entries((sys.health && sys.health.runs_24h) || {}).map(([k, n]) => `<div class="stat"><div class="n">${n}</div><div class="l">${esc(k)} / 24h</div></div>`).join('')
    const age = meta.checked_age_seconds
    const down = meta.down || raw.down || []
    const critDown = meta.critical_down || raw.critical_down || []
    const body = `<div class="wrap">${err ? `<div class="err-banner">${esc(err)}</div>` : ''}
<div class="hero"><div><h2>System</h2><div class="muted">Live Friday health the scheduler and the console depend on.</div></div></div>
<div class="row">
  <div class="stat"><div class="n">${sys.agents ?? '—'}</div><div class="l">agents</div></div>
  <div class="stat"><div class="n">${sys.paused ? 'yes' : 'no'}</div><div class="l">friday paused</div></div>
  <div class="stat"><div class="n" style="font-size:14px">${esc((sys.last_tick || 'never').slice(0, 19))}</div><div class="l">last scheduler tick</div></div>
  <div class="stat"><div class="n">${sys.secrets_available ? 'yes' : 'no'}</div><div class="l">secrets mount</div></div>
  <div class="stat"><div class="n" style="font-size:14px">${age == null ? 'never' : age + 's'}</div><div class="l">deps checked</div></div>
  ${runs}
</div>
<div class="panel"><h3>Dependencies</h3>
<div class="muted" style="margin-bottom:8px">${critDown.length ? `<span class="dep-bad">critical down: ${esc(critDown.join(', '))}</span>` : '<span class="dep-ok">no critical outages</span>'}${down.length && !critDown.length ? ` · non-critical down: ${esc(down.join(', '))}` : ''}</div>
<table><tr><th>service</th><th>status</th><th>detail</th></tr>${deps || '<tr><td class="muted" colspan="3">No snapshot yet — Friday has not probed since start.</td></tr>'}</table></div>
<div class="panel"><h3>Where things live</h3>
<div class="mono">charters  ${esc(sys.soul_dir || '/soul/agents')}
secrets   /mnt/asik_home_8/secrets/agents/&lt;id&gt;.env
receipts  agent_runs in friday.sqlite3
console   https://board.asikmydeen.com/cabinet
friday    /api/cabinet/*  (dashboard token)</div></div>
</div>`
    return c.html(shell('System', '/cabinet/system', body, style, flash(c)))
  })

  app.get('/cabinet/browser', async (c) => {
    let b = {}, err = ''
    try {
      b = await friday('/api/cabinet/browser', {soft: true})
      if (b?.ok === false) err = b.message || 'Owner browser status unavailable.'
    } catch (e) { err = e.message }
    const job = b.job || {}
    const page = b.page || b
    const viewer = b.viewer || 'https://browser.asikmydeen.com'
    const body = `<div class="wrap">${err ? `<div class="err-banner">${esc(err)}</div>` : ''}
<div class="hero"><div><h2>Owner browser</h2><div class="muted">One Chrome. You sign in when it asks. Agents drive the same window.</div></div>
<a class="go" href="${esc(viewer)}" target="_blank" rel="noopener">Open live view</a></div>
<div class="row">
  <div class="stat"><div class="n">${esc(job.state || page.state || (b.ok ? 'idle' : 'offline'))}</div><div class="l">job</div></div>
  <div class="stat"><div class="n" style="font-size:14px">${esc(job.handoff_reason || page.handoff || '—')}</div><div class="l">handoff</div></div>
</div>
<div class="panel"><h3>Current page</h3>
<div class="mono">${esc(page.url || job.url || '—')}\n${esc(page.title || job.title || '')}</div>
<p class="muted">Sign in at the live view, then tap Continue there. Do not paste passwords in chat.</p>
</div></div>`
    return c.html(shell('Browser', '/cabinet/browser', body, style, flash(c)))
  })

  app.get('/cabinet/:id', overview)
}
