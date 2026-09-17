import {navigation, workspaceCSS, workspaceEnd, commonScript} from './workspace-ui.js'
import {connectionsClient} from './connections-client.js'

// Connections workspace — Discover / Accounts / Runners / Activity.
// Proxies Friday /api/cabinet/connections/* with the same bearer as Cabinet.
const FRIDAY_API = (process.env.FRIDAY_API || 'http://app-synthesize-neural-bandwidth-csj4qo:8080').replace(/\/$/, '')
const FRIDAY_API_TOKEN = process.env.FRIDAY_API_TOKEN || ''

async function friday(path, {method = 'GET', body, soft = false, timeoutMs} = {}) {
  const headers = {Authorization: `Bearer ${FRIDAY_API_TOKEN}`}
  let payload
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  // Catalog hits the public MCP registry — 15s was aborting and looked like Connections-off.
  const ms = timeoutMs ?? (method === 'GET'
    ? (path.includes('/catalog') ? 60000 : 30000)
    : 200000)
  let res
  try {
    res = await fetch(`${FRIDAY_API}${path}`, {
      method,
      headers,
      body: payload,
      signal: AbortSignal.timeout(ms),
    })
  } catch (e) {
    const aborted = e?.name === 'TimeoutError' || e?.name === 'AbortError'
    const msg = aborted
      ? `Friday timed out after ${Math.round(ms / 1000)}s (${path}).`
      : (e.message || 'Friday request failed')
    if (soft) return {ok: false, message: msg, status: 'timeout'}
    throw new Error(msg)
  }
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = {message: text.slice(0, 200)} }
  if (!res.ok) {
    const msg = data?.message || `Friday could not complete this request (${res.status}).`
    if (soft) return {ok: false, message: msg, status: res.status, ...(data || {})}
    throw new Error(msg)
  }
  if (data?.ok === false && !soft) {
    throw new Error(data.message || 'Friday could not complete this request.')
  }
  return data
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]))
const when = (ts) => ts
  ? new Date(ts * 1000).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  : '—'

const CSS = `
.conn-tabs{display:flex;gap:4px;border-bottom:1px solid #232b36;margin:8px 0 0;overflow:auto}
.conn-tabs a{color:#8b95a3;text-decoration:none;font-size:13px;padding:10px 14px;border-radius:8px 8px 0 0;white-space:nowrap}
.conn-tabs a.on{color:#e8ecf1;background:#151b23;border:1px solid #232b36;border-bottom-color:#151b23;margin-bottom:-1px}
.wrap{max-width:1180px;margin:0 auto;padding:18px}
.panel{background:#151b23;border:1px solid #232b36;border-radius:14px;padding:16px 18px;margin:14px 0}
.panel h3{margin:0 0 10px;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#8b95a3}
.hero{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:4px}
.hero h2{margin:0;font-size:22px;color:#e8ecf1;font-weight:650}
.muted{color:#5c6675}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.pill{background:#1d2632;border-radius:6px;padding:2px 8px;font-size:11px;color:#8fa3bd;display:inline-flex;align-items:center;gap:5px}
.err-banner{margin:10px 18px 0;background:#3a1d1d;border:1px solid #5a2a2a;color:#ffb4ae;border-radius:8px;padding:8px 12px;font-size:13px}
.flash{margin:10px 18px 0;background:#1a2b3d;border:1px solid #2a4a6a;color:#cfe4ff;border-radius:8px;padding:8px 12px;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:8px 8px;border-bottom:1px solid #1d2632;text-align:left;vertical-align:top}th{color:#8b95a3;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.mono{white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;color:#c9d1d9}
.panel input,.panel textarea,.panel select{background:#0e1116;border:1px solid #232b36;color:#d7dce3;border-radius:8px;padding:8px 10px;font-size:14px;flex:1;min-width:160px}
.catalog-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.catalog-card{background:#0e1116;border:1px solid #232b36;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px}
.catalog-card h4{margin:0;font-size:15px;color:#e8ecf1}
.catalog-card p{margin:0;font-size:13px;color:#8b95a3}
.state-ok{color:#4ade80}.state-warn{color:#ffd479}.state-bad{color:#ff8a80}
.agent-pills{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.agent-pills label{display:inline-flex;gap:6px;align-items:center;background:#0e1116;border:1px solid #232b36;border-radius:8px;padding:6px 10px;font-size:13px;color:#c9d1d9}
.conn-acc{border:1px solid #232b36;border-radius:12px;margin:10px 0;overflow:hidden;background:#0e1116}
.conn-acc>summary{list-style:none;cursor:pointer;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 14px;color:#e8ecf1;font-size:14px}
.conn-acc>summary::-webkit-details-marker{display:none}
.conn-acc>summary::before{content:'▸';color:#8b95a3;width:1em}
.conn-acc[open]>summary::before{content:'▾'}
.conn-acc .acc-body{padding:0 14px 14px;border-top:1px solid #1d2632}
.conn-acc .acc-meta{color:#8b95a3;font-size:12px;margin-left:auto}
.conn-acc .acc-section{margin-top:12px}
.conn-acc .acc-section h4{margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#8b95a3;font-weight:500}
`

function shell(title, active, body, style, flashHtml = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Friday</title><link rel="icon" href="/icon.svg" type="image/svg+xml"><meta name="theme-color" content="#101318">
<style>${style}${CSS}${workspaceCSS}</style></head><body>${navigation(active, title)}${flashHtml}${body}${workspaceEnd}${commonScript}</body></html>`
}

const flash = (c) => {
  const m = c.req.query('m')
  const e = c.req.query('e')
  if (e) return `<div class="err-banner" role="alert">${esc(e)}</div>`
  return m ? `<div class="flash" role="status">${esc(m)}</div>` : ''
}

const views = [
  ['', 'Discover'],
  ['/accounts', 'Connected accounts'],
  ['/runners', 'Local runners'],
  ['/activity', 'Activity'],
]

function connTabs(on) {
  return `<div class="conn-tabs">${views.map(([s, l]) =>
    `<a href="/connections${s}" class="${s === on ? 'on' : ''}">${l}</a>`
  ).join('')}</div>`
}

function disabledBanner(enabled, err = '') {
  // Proxy timeouts default to enabled:false — show the real error, not a false flag warning.
  if (err) return ''
  if (enabled !== false) return ''
  return `<div class="err-banner" role="status">Connections is off on Friday (FRIDAY_CONNECTIONS_ENABLED). Schema and Board still load; enable the flag to use live catalog data.</div>`
}

function back(c, path, message, isError = false) {
  const q = isError ? `e=${encodeURIComponent(message)}` : `m=${encodeURIComponent(message)}`
  return c.redirect(`${path}?${q}`)
}

function agentChecks(agents, selected) {
  const sel = new Set(selected || agents.map((a) => a.id))
  return `<div class="agent-pills">${agents.map((a) =>
    `<label><input type="checkbox" name="agents" value="${esc(a.id)}" ${sel.has(a.id) ? 'checked' : ''}> ${esc(a.name || a.id)}</label>`
  ).join('')}</div>
  <p class="muted" style="margin-top:8px">Leave all checked for every current and future owner advisor. Uncheck to limit this MCP.</p>`
}

async function loadAgents() {
  try {
    const roster = await friday('/api/cabinet/agents')
    const list = Array.isArray(roster) ? roster : (roster.agents || [])
    return list.filter((a) => a && a.id && a.id !== 'family' && a.id !== 'zara')
  } catch {
    return []
  }
}

function parseAgents(f) {
  const raw = f.agents
  if (raw == null) return []
  if (Array.isArray(raw)) return raw.map(String)
  return [String(raw)]
}

async function finishConnect(sid, {discover = true} = {}) {
  const test = await friday(`/api/cabinet/connections/${encodeURIComponent(sid)}/test`, {
    method: 'POST', body: {}, soft: true,
  })
  let disc = {tools: []}
  if (test?.ok) {
    disc = await friday(`/api/cabinet/connections/${encodeURIComponent(sid)}/discover`, {
      method: 'POST', body: {}, soft: true,
    })
    if (disc?.ok !== false) {
      await friday(`/api/cabinet/connections/${encodeURIComponent(sid)}/enable`, {
        method: 'POST', body: {}, soft: true,
      })
      for (const tool of disc.tools || []) {
        if (tool.name) {
          await friday(`/api/cabinet/connections/${encodeURIComponent(sid)}/enable`, {
            method: 'POST', body: {tool_name: tool.name}, soft: true,
          })
        }
      }
    }
  }
  return {test, disc}
}

export function mountConnections(app, {style}) {
  app.post('/connections/add', async (c) => {
    const f = await c.req.parseBody()
    const name = String(f.name || '').trim()
    const endpoint = String(f.endpoint || '').trim()
    const transport = String(f.transport || 'streamable_http').trim()
    const command = String(f.command || '').trim()
    const image = String(f.image || '').trim()
    const authKind = String(f.auth_kind || 'none').trim()
    const secret = String(f.secret || '').trim()
    const agents = parseAgents(f)
    if (!name) return back(c, '/connections', 'Name is required.', true)
    if (transport === 'runner_mediated') {
      if (!command && !image) {
        return back(c, '/connections', 'Local runner MCPs need a command or container image.', true)
      }
    } else if (!endpoint) {
      return back(c, '/connections', 'Name and endpoint are required for remote MCPs.', true)
    }
    if ((authKind === 'api_key' || authKind === 'bearer') && !secret) {
      return back(c, '/connections', 'This MCP needs an API key or bearer token. Paste it before connecting.', true)
    }
    try {
      const created = await friday('/api/cabinet/connections', {
        method: 'POST',
        body: {name, endpoint, transport, command, image, source: 'custom'},
      })
      const sid = created.server?.id
      if (!sid) return back(c, '/connections', created.message || 'Create failed.', true)
      if (authKind !== 'none' && secret) {
        await friday(`/api/cabinet/connections/${encodeURIComponent(sid)}/auth/start`, {
          method: 'POST',
          body: {auth_kind: authKind, value: secret, label: authKind},
        })
      } else if (authKind === 'oauth' || authKind === 'composio') {
        const auth = await friday(`/api/cabinet/connections/${encodeURIComponent(sid)}/auth/start`, {
          method: 'POST',
          body: {auth_kind: authKind, label: authKind},
          soft: true,
        })
        if (auth?.authorization_url) return c.redirect(auth.authorization_url)
      }
      await friday(`/api/cabinet/connections/${encodeURIComponent(sid)}/grants`, {
        method: 'POST',
        body: agents.length ? {agents} : {default_all: true},
      })
      if (transport === 'runner_mediated') {
        return back(
          c,
          '/connections/accounts',
          `${name} saved as a local-runner MCP. Register an online runner under Local runners, then Test → Discover → Enable.`,
        )
      }
      const {test} = await finishConnect(sid)
      if (test?.status === 'login_required' || (!test?.ok && authKind === 'none')) {
        return back(
          c,
          '/connections/accounts',
          `${name} saved, but it needs credentials. Add an API key under Connected accounts, then Test → Discover → Enable.`,
          true,
        )
      }
      if (!test?.ok) {
        return back(
          c,
          '/connections/accounts',
          `${name} saved. Connection check failed: ${test?.message || test?.detail || 'see Activity'}. Fix auth or endpoint, then Test again.`,
          true,
        )
      }
      return back(c, '/connections/accounts', `${name} connected. Advisors you selected can use its tools.`)
    } catch (e) {
      return back(c, '/connections', e.message, true)
    }
  })

  app.post('/connections/:id/action', async (c) => {
    const id = c.req.param('id')
    const f = await c.req.parseBody()
    const action = String(f.action || '').trim()
    try {
      if (action === 'auth') {
        const kind = String(f.auth_kind || 'api_key').trim()
        const value = String(f.secret || '').trim()
        if (!value && kind !== 'oauth' && kind !== 'composio' && kind !== 'none') {
          return back(c, '/connections/accounts', 'Secret value required for this auth kind.', true)
        }
        const r = await friday(`/api/cabinet/connections/${encodeURIComponent(id)}/auth/start`, {
          method: 'POST',
          body: {auth_kind: kind, value, label: kind},
        })
        if (r.authorization_url) return c.redirect(r.authorization_url)
        const {test} = await finishConnect(id)
        if (!test?.ok) {
          return back(c, '/connections/accounts', r.message || 'Auth saved. Test still needs a working key — try again.', true)
        }
        return back(c, '/connections/accounts', 'Auth saved and connection is ready.')
      }
      if (action === 'grants') {
        const agents = parseAgents(f)
        await friday(`/api/cabinet/connections/${encodeURIComponent(id)}/grants`, {
          method: 'POST',
          body: agents.length ? {agents} : {default_all: true},
        })
        return back(c, '/connections/accounts', 'Advisor access updated.')
      }
      if (!['test', 'discover', 'enable', 'disable', 'disconnect'].includes(action)) {
        return back(c, '/connections/accounts', 'Unknown action.', true)
      }
      const r = await friday(`/api/cabinet/connections/${encodeURIComponent(id)}/${action}`, {
        method: 'POST', body: {}, soft: true,
      })
      if (action === 'test' && r?.ok) {
        await finishConnect(id)
        return back(c, '/connections/accounts', 'Test passed; tools refreshed.')
      }
      if (r?.ok === false) {
        const detail = r.message || r.detail || ''
        let msg = detail || `${action} failed.`
        if (r.status === 'runner_offline' || r.wait === 'runner_offline') {
          msg = 'No online local runner. Stdio MCPs need a runner under Local runners — or switch this connection to Streamable HTTP (e.g. Serena on m4).'
        }
        return back(c, '/connections/accounts', msg, true)
      }
      return back(c, '/connections/accounts', r.message || `${action} completed.`)
    } catch (e) {
      return back(c, '/connections/accounts', e.message, true)
    }
  })

  app.get('/connections', async (c) => {
    const q = c.req.query('q') || ''
    const prefill = {
      name: c.req.query('name') || '',
      endpoint: c.req.query('endpoint') || '',
      command: c.req.query('command') || '',
      image: c.req.query('image') || '',
      transport: c.req.query('transport') || 'streamable_http',
      auth_kind: c.req.query('auth_kind') || 'none',
    }
    let data = {results: [], enabled: false}, err = '', agents = []
    try {
      ;[data, agents] = await Promise.all([
        friday(`/api/cabinet/connections/catalog?q=${encodeURIComponent(q)}`, {soft: true}),
        loadAgents(),
      ])
      if (data?.ok === false || data?.status === 'timeout') {
        err = data.message || 'Catalog request failed'
        data = {results: [], enabled: true}
      }
    } catch (e) {
      err = e.message
      data = {results: [], enabled: true}
    }
    const cards = (data.results || []).map((item) => {
      const remote = (item.remotes && item.remotes[0] && (item.remotes[0].url || item.remotes[0])) || ''
      const endpoint = typeof remote === 'string' ? remote : ''
      const install = item.install || null
      let href = ''
      let cta = ''
      if (endpoint) {
        href = `/connections?name=${encodeURIComponent(item.title || item.name || '')}&endpoint=${encodeURIComponent(endpoint)}&transport=streamable_http&auth_kind=none#add`
        cta = 'Configure & add'
      } else if (install && (install.command || install.image)) {
        const params = new URLSearchParams({
          name: item.title || item.name || '',
          transport: 'runner_mediated',
          auth_kind: 'none',
        })
        if (install.command) params.set('command', install.command)
        if (install.image) params.set('image', install.image)
        href = `/connections?${params.toString()}#add`
        cta = 'Add via local runner'
      }
      const installHint = install?.hint
        ? `<div class="muted mono" style="margin-top:6px">${esc(install.hint)}</div>`
        : ''
      return `<article class="catalog-card">
      <div class="row"><span class="pill">${esc(item.source_label || item.source || 'catalog')}</span>${item.stub ? '<span class="pill">stub</span>' : ''}${!endpoint && install ? '<span class="pill">stdio / local</span>' : ''}${item.custodian ? `<span class="pill">${esc(item.custodian)}</span>` : ''}</div>
      <h4>${esc(item.title || item.name)}</h4>
      <p>${esc(item.description || '')}</p>
      <div class="muted mono">${esc(item.name || '')}${item.version ? ' · ' + esc(item.version) : ''}</div>
      ${installHint}
      ${href ? `<a class="go secondary mini" href="${href}" style="margin-top:8px;align-self:flex-start">${esc(cta)}</a>` : '<span class="muted">No remote URL or install package in registry — paste manually below</span>'}
    </article>`
    }).join('')
    const body = `<div class="wrap">
${err ? `<div class="err-banner">${esc(err)}</div>` : ''}
${disabledBanner(data.enabled, err)}
<div class="hero"><div><div class="eyebrow">Capability marketplace</div><h2>Connections</h2><p class="muted">Add an MCP once, choose which advisors may use it, then sign in if it needs a key. Stdio packages (Serena, etc.) run on a local runner — not inside Board.</p></div></div>
${connTabs('')}
<div class="panel"><h3>Discover</h3>
<form method="get" action="/connections" class="row"><input type="search" name="q" value="${esc(q)}" placeholder="Search registry, Docker catalog, Composio…"><button>Search</button></form>
<div class="catalog-grid" style="margin-top:14px">${cards || '<p class="muted">No results yet. Try a search when Connections is enabled.</p>'}</div>
</div>
<div class="panel" id="add"><h3>Add MCP</h3>
<form method="post" action="/connections/add">
<div class="row" style="margin-bottom:10px">
<input name="name" placeholder="Name" value="${esc(prefill.name)}" required>
<input name="endpoint" placeholder="https://…/mcp (remote only)" value="${esc(prefill.endpoint)}" style="flex:2">
<select name="transport">
<option value="streamable_http" ${prefill.transport === 'streamable_http' ? 'selected' : ''}>Streamable HTTP</option>
<option value="sse" ${prefill.transport === 'sse' ? 'selected' : ''}>SSE</option>
<option value="runner_mediated" ${prefill.transport === 'runner_mediated' ? 'selected' : ''}>Runner (stdio)</option>
</select>
</div>
<div class="row" style="margin-bottom:10px">
<input name="command" placeholder="Local command (uvx … / serena …)" value="${esc(prefill.command)}" style="flex:2">
<input name="image" placeholder="Container image (optional)" value="${esc(prefill.image)}">
</div>
<div class="row" style="margin-bottom:10px">
<select name="auth_kind">
<option value="none" ${prefill.auth_kind === 'none' ? 'selected' : ''}>No auth (free / open)</option>
<option value="api_key" ${prefill.auth_kind === 'api_key' ? 'selected' : ''}>API key</option>
<option value="bearer" ${prefill.auth_kind === 'bearer' ? 'selected' : ''}>Bearer</option>
<option value="oauth">OAuth</option>
<option value="composio">Composio</option>
</select>
<input name="secret" type="password" placeholder="API key / token (stored on NAS — never shown again)" autocomplete="off">
</div>
<h3 style="margin-top:16px">Which advisors may use this?</h3>
${agentChecks(agents)}
<div class="row" style="margin-top:16px"><button type="submit">Save connection</button></div>
<p class="muted" style="margin-top:10px">Remote MCPs need an endpoint. Stdio packages need a local runner online under Local runners. If a remote server needs a key and you leave it blank, the connection is still saved.</p>
</form>
</div></div>`
    return c.html(shell('Connections', '/connections', body, style, flash(c)))
  })

  app.get('/connections/accounts', async (c) => {
    let data = {accounts: [], servers: [], enabled: false}, err = '', agents = []
    try {
      ;[data, agents] = await Promise.all([
        friday('/api/cabinet/connections/accounts'),
        loadAgents(),
      ])
    } catch (e) { err = e.message }
    const serverName = Object.fromEntries((data.servers || []).map((s) => [s.id, s.name]))
    const rows = (data.accounts || []).map((a) => `<tr>
      <td>${esc(a.label || a.id)}</td>
      <td>${esc(serverName[a.server_id] || a.server_id)}</td>
      <td><span class="pill">${esc(a.auth_kind || '—')}</span></td>
      <td class="mono">${esc(a.secret_ref || '—')}</td>
      <td class="${a.status === 'ready' || a.status === 'connected' ? 'state-ok' : 'state-warn'}">${esc(a.status)}</td>
      <td class="muted">${when(a.updated || a.created)}</td>
    </tr>`).join('')
    const servers = (data.servers || []).map((s) => {
      const statusCls = s.status === 'ready' || s.status === 'enabled' ? 'state-ok'
        : s.status === 'login_required' || s.status === 'runner_offline' ? 'state-warn' : 'state-bad'
      const endpoint = s.endpoint || s.image || s.command || '—'
      return `<details class="conn-acc">
      <summary>
        <strong>${esc(s.name)}</strong>
        <span class="pill">${esc(s.transport)}</span>
        <span class="${statusCls}">${esc(s.status)}</span>
        <span class="acc-meta mono">${esc(String(endpoint).slice(0, 64))}${String(endpoint).length > 64 ? '…' : ''}</span>
      </summary>
      <div class="acc-body">
        <div class="acc-section">
          <h4>Quick actions</h4>
          <div class="row">
            <form method="post" action="/connections/${esc(s.id)}/action"><input type="hidden" name="action" value="test"><button class="mini secondary" type="submit">Test</button></form>
            <form method="post" action="/connections/${esc(s.id)}/action"><input type="hidden" name="action" value="discover"><button class="mini secondary" type="submit">Discover</button></form>
            <form method="post" action="/connections/${esc(s.id)}/action"><input type="hidden" name="action" value="enable"><button class="mini" type="submit">Enable</button></form>
            <form method="post" action="/connections/${esc(s.id)}/action"><input type="hidden" name="action" value="disable"><button class="mini secondary" type="submit">Disable</button></form>
          </div>
        </div>
        <details class="conn-acc" style="margin-top:12px">
          <summary><span>Credentials</span><span class="acc-meta">API key / OAuth</span></summary>
          <div class="acc-body">
            <form method="post" action="/connections/${esc(s.id)}/action" class="row">
              <input type="hidden" name="action" value="auth">
              <select name="auth_kind"><option value="api_key">API key</option><option value="bearer">Bearer</option><option value="oauth">OAuth</option><option value="composio">Composio</option></select>
              <input name="secret" type="password" placeholder="Paste API key / token" autocomplete="off">
              <button class="mini" type="submit">Save key & retest</button>
            </form>
          </div>
        </details>
        <details class="conn-acc" style="margin-top:12px">
          <summary><span>Advisor access</span><span class="acc-meta">who may use this MCP</span></summary>
          <div class="acc-body">
            <form method="post" action="/connections/${esc(s.id)}/action">
              <input type="hidden" name="action" value="grants">
              ${agentChecks(agents)}
              <div class="row" style="margin-top:10px"><button class="mini secondary" type="submit">Update advisor access</button></div>
            </form>
          </div>
        </details>
      </div>
    </details>`
    }).join('')
    const body = `<div class="wrap">
${err ? `<div class="err-banner">${esc(err)}</div>` : ''}
${disabledBanner(data.enabled)}
<div class="hero"><div><h2>Connected accounts</h2><p class="muted">Open a server to test, set credentials, or pick advisors. Secret values stay on NAS.</p></div>
<a class="go" href="/connections#add">Add MCP</a></div>
${connTabs('/accounts')}
<div class="panel"><h3>Accounts</h3>
<table><tr><th>Label</th><th>Server</th><th>Auth</th><th>Secret ref</th><th>Status</th><th>Updated</th></tr>
${rows || '<tr><td class="muted" colspan="6">No accounts yet.</td></tr>'}</table></div>
<div class="panel"><h3>Servers</h3>
${servers || '<p class="muted">No servers registered.</p>'}
</div>
</div>`
    return c.html(shell('Connected accounts', '/connections', body, style, flash(c)))
  })

  app.get('/connections/runners', async (c) => {
    let data = {runners: [], enabled: false}, err = ''
    try { data = await friday('/api/cabinet/connections/runners') } catch (e) { err = e.message }
    const rows = (data.runners || []).map((r) => {
      const stale = r.last_heartbeat && (Date.now() / 1000 - r.last_heartbeat) > 120
      const cls = r.status === 'online' && !stale ? 'state-ok' : 'state-warn'
      return `<tr>
        <td>${esc(r.label || r.id)}</td>
        <td><span class="pill">${esc(r.kind)}</span></td>
        <td class="mono">${esc(r.identity || '—')}</td>
        <td class="${cls}">${esc(r.status)}${stale ? ' · stale' : ''}</td>
        <td class="muted">${when(r.last_heartbeat)}</td>
      </tr>`
    }).join('')
    const body = `<div class="wrap">
${err ? `<div class="err-banner">${esc(err)}</div>` : ''}
${disabledBanner(data.enabled)}
<div class="hero"><div><h2>Local runners</h2><p class="muted">NAS containers and m4 companions. Offline runners pause work — no silent failover.</p></div></div>
${connTabs('/runners')}
<div class="panel"><h3>Registered runners</h3>
<table><tr><th>Label</th><th>Kind</th><th>Identity</th><th>Status</th><th>Heartbeat</th></tr>
${rows || '<tr><td class="muted" colspan="5">No runners registered yet.</td></tr>'}</table></div>
</div>`
    return c.html(shell('Local runners', '/connections', body, style, flash(c)))
  })

  app.get('/connections/activity', async (c) => {
    let data = {events: [], enabled: false}, err = ''
    try { data = await friday('/api/cabinet/connections/activity?limit=80') } catch (e) { err = e.message }
    const rows = (data.events || []).map((e) => {
      const cls = e.state === 'ready' ? 'state-ok'
        : e.state === 'login_required' || e.state === 'runner_offline' ? 'state-warn'
          : e.state === 'configuration_error' || e.state === 'disabled' ? 'state-bad' : ''
      return `<tr>
        <td class="${cls}">${esc(e.state)}</td>
        <td class="mono">${esc(e.server_id || '—')}</td>
        <td>${esc(e.detail || '')}</td>
        <td class="muted">${when(e.created)}</td>
      </tr>`
    }).join('')
    const body = `<div class="wrap">
${err ? `<div class="err-banner">${esc(err)}</div>` : ''}
${disabledBanner(data.enabled)}
<div class="hero"><div><h2>Connection activity</h2><p class="muted">Connecting, ready, login required, runner offline, errors.</p></div></div>
${connTabs('/activity')}
<div class="panel"><h3>Recent events</h3>
<table><tr><th>State</th><th>Server</th><th>Detail</th><th>When</th></tr>
${rows || '<tr><td class="muted" colspan="4">No connection events yet.</td></tr>'}</table></div>
</div>`
    return c.html(shell('Connection activity', '/connections', body, style, flash(c)))
  })

  app.get('/cabinet/:id/capabilities', async (c) => {
    const id = c.req.param('id')
    let caps = null, agent = null, err = ''
    try {
      ;[agent, caps] = await Promise.all([
        friday(`/api/cabinet/agents/${encodeURIComponent(id)}`),
        friday(`/api/cabinet/connections/agents/${encodeURIComponent(id)}/capabilities`),
      ])
    } catch (e) { err = e.message }
    if (!agent || agent.error) return c.text('no such agent', 404)
    const limits = caps?.limits || {}
    const limitPills = Object.keys(limits).length
      ? Object.entries(limits).map(([k, v]) => `<span class="pill">${esc(k)}: ${esc(v)}</span>`).join(' ')
      : '<span class="muted">No worker limits set</span>'
    const servers = (caps?.servers || []).map((block) => {
      const tools = (block.tools || []).slice(0, 24).map((t) =>
        `<span class="pill">${esc(t.name)}${t.enabled ? '' : ' · off'}</span>`
      ).join(' ') || '<span class="muted">No tools discovered</span>'
      const accounts = (block.accounts || []).map((a) =>
        `<div class="row"><span>${esc(a.label || a.id)}</span><span class="pill">${esc(a.status)}</span><span class="mono muted">${esc(a.secret_ref || '')}</span></div>`
      ).join('') || '<p class="muted">No accounts</p>'
      return `<div class="panel"><h3>${esc(block.server?.name || 'server')} ${block.allowed ? '<span class="state-ok">allowed</span>' : '<span class="state-warn">not granted</span>'}</h3>
        <p class="muted">${esc(block.server?.source || '')} · ${esc(block.server?.status || '')}</p>
        <h3 style="margin-top:14px">Accounts</h3>${accounts}
        <h3 style="margin-top:14px">Tools</h3><div class="row">${tools}</div></div>`
    }).join('')
    const body = `<div class="wrap">
${err ? `<div class="err-banner">${esc(err)}</div>` : ''}
<div class="hero"><div><h2>Capabilities · ${esc(agent.name)}</h2>
<p class="muted">What @${esc(agent.id)} can use. Assign MCPs under Connected accounts → advisor checkboxes.</p></div>
<div class="row"><a class="go secondary" href="/cabinet/${esc(agent.id)}">Back to advisor</a><a class="go" href="/connections/accounts">Manage access</a><a class="go secondary" href="/connections#add">Add MCP</a></div></div>
${caps?.blocked ? `<div class="err-banner">${esc(caps.message || 'Blocked')}</div>` : ''}
<div class="panel"><h3>Worker limits</h3><div class="row">${limitPills}</div></div>
${servers || '<div class="panel"><p class="muted">No Connections grants for this advisor yet. Add an MCP, then tick this advisor under Connected accounts.</p></div>'}
</div>`
    return c.html(shell(`Capabilities · ${agent.name}`, '/cabinet', body, style, flash(c)))
  })
}
