import {navigation, workspaceCSS, workspaceEnd, commonScript} from './workspace-ui.js'

// Architecture design overview — how Cabinet, Friday, Connections, Coder,
// and the supporting packages fit together end to end.

const FRIDAY_API = (process.env.FRIDAY_API || 'http://app-synthesize-neural-bandwidth-csj4qo:8080').replace(/\/$/, '')
const FRIDAY_API_TOKEN = process.env.FRIDAY_API_TOKEN || ''

async function friday(path) {
  const res = await fetch(`${FRIDAY_API}${path}`, {
    headers: {Authorization: `Bearer ${FRIDAY_API_TOKEN}`},
    signal: AbortSignal.timeout(15000),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = {message: text.slice(0, 200)} }
  if (!res.ok) throw new Error(data?.message || `Friday ${res.status}`)
  return data
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]))

const CSS = `
.wrap{max-width:1100px;margin:0 auto;padding:18px}
.hero{margin-bottom:8px}
.hero h2{margin:0 0 8px;font-size:28px;letter-spacing:-.03em}
.panel{background:#151b23;border:1px solid #232b36;border-radius:14px;padding:18px 20px;margin:16px 0}
.panel h3{margin:0 0 10px;font-size:15px;color:#e8ecf1}
.panel h4{margin:16px 0 8px;font-size:13px;color:#8fa3bd;text-transform:uppercase;letter-spacing:.08em;font-weight:600}
.panel p,.panel li{color:#aab6c8;font-size:14px;line-height:1.6}
.panel ul{margin:0;padding-left:1.2em}
.panel li{margin:4px 0}
.muted{color:#8b95a3}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;white-space:pre-wrap;color:#c9d1d9;background:#0e1116;border:1px solid #232b36;border-radius:10px;padding:14px;overflow-x:auto}
.flow{display:grid;gap:10px;margin:12px 0}
.flow-step{display:grid;grid-template-columns:36px 1fr;gap:12px;align-items:start}
.flow-num{width:36px;height:36px;border-radius:10px;background:#25354e;color:#a5c1ff;display:grid;place-items:center;font-weight:650;font-size:14px}
.flow-step strong{color:#e8ecf1;display:block;margin-bottom:2px}
.grid2{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.card{background:#0e1116;border:1px solid #232b36;border-radius:12px;padding:14px}
.card h4{margin:0 0 6px;font-size:14px;color:#e8ecf1;text-transform:none;letter-spacing:0}
.card p{margin:0;font-size:13px}
.pill{display:inline-flex;align-items:center;gap:4px;background:#1d2632;border-radius:6px;padding:2px 8px;font-size:11px;color:#8fa3bd;margin:2px 4px 2px 0}
.pill.on{color:#8ad9bd;background:#1a2e28}
.pill.off{color:#ffd18d}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #1d2632;vertical-align:top}
th{color:#8b95a3;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.toc{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 4px}
.toc a{font-size:13px;color:#a5c1ff;text-decoration:none;padding:6px 10px;background:#1a2230;border-radius:8px;border:1px solid #2a3548}
.toc a:hover{border-color:#426ce8}
.err-banner{margin:10px 0;background:#3a1d1d;border:1px solid #5a2a2a;color:#ffb4ae;border-radius:8px;padding:8px 12px;font-size:13px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
`

const ROLE_BLURBS = {
  friday: 'Orchestrator / last resort before you. Same brain, many mouths.',
  cto: 'Owns infra, reliability, coder fleet. Decomposes work; starts Coder jobs.',
  architect: 'Boundaries, data shape, what must not sprawl.',
  product: 'What to build and why it is worth your time.',
  backend: 'APIs, services, durable server / Drift data work.',
  web: 'Web UI and front-end slices.',
  mobile: 'Flutter / iOS / Android apps.',
  tester: 'Prove it works: regressions, receipts, gaps.',
  reviewer: 'Independent second read before merge.',
  cfo: 'Money, expenses, budgets.',
  family: 'Home calendar, chores, meals, people.',
  mentor: 'Judgment, long-horizon coaching.',
  researcher: 'Markets, filings, deep research.',
  content: 'Publishing drafts and next posts.',
  home: 'Home Assistant / device control.',
  health: 'Health, food, mood logs.',
  media: 'Library / plex-style media.',
  travel: 'Trips and lists.',
  legal: 'Calendar-backed legal reminders.',
  faith: 'Journal and calendar for faith practice.',
  coach: 'Journal, mood, calendar.',
  chief: 'Board updates and calendar.',
  advisor: 'Long-term investing and big decisions.',
  program: 'Program / portfolio coordination.',
  fetcher: 'Fetch and summarize the open web.',
}

const COMMON_CAPABILITIES = [
  'now, recall, remember',
  'soul_read / soul_propose',
  'gmail, browser, fetch_url, research',
  'list_board, capture_action, manage_reminder',
  'fetch_file, read_document',
  'own_work, delegate_work, obligation_status',
  'memory_promote, charter_propose',
]

const PACKAGES = [
  ['Friday core', 'asikmydeen/friday', 'Jarvis, Cabinet, obligations, Connections API, WhatsApp/Telegram/Mattermost'],
  ['Board (Voiceboard)', 'asikmydeen/voiceboard', 'This UI — Board, Cabinet console, Connections, Architecture'],
  ['Taskrunner', 'asikmydeen/taskrunner (friday-study)', 'Dispatches Coder jobs; injects Cabinet bus MCP + agent secrets'],
  ['Ship MCP', 'ship-mcp', 'ship_task_submit / work status bridge'],
  ['Memory MCP', 'memory-mcp', 'Qdrant knowledge, soul, hub_search'],
  ['Life MCP', 'life-mcp', 'context_now, family mood'],
  ['Serena MCP', 'serena (NAS)', 'Code intelligence for Coder workspaces'],
  ['Soul', 'asikmydeen/soul', 'Charters under agents/<id>.md — identity of each advisor'],
  ['Coder', 'code.asikmydeen.com', 'Claude Code / Codex / Grok engines in workspaces'],
]

function shell(title, active, body, style) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Friday</title><link rel="icon" href="/icon.svg" type="image/svg+xml"><meta name="theme-color" content="#101318">
<style>${style}${CSS}${workspaceCSS}</style></head><body>${navigation(active, title)}${body}${workspaceEnd}${commonScript}</body></html>`
}

function agentCard(a) {
  const blur = ROLE_BLURBS[a.id] || a.title || ''
  const tools = (a.tools || []).slice(0, 8)
  const more = (a.tools || []).length > 8 ? ` +${(a.tools || []).length - 8}` : ''
  return `<article class="card">
    <h4>${esc(a.name)} <span class="pill">${esc(a.id)}</span>${a.active ? '<span class="pill on">active</span>' : '<span class="pill off">paused</span>'}</h4>
    <p>${esc(blur)}</p>
    <div style="margin-top:8px">${tools.map((t) => `<span class="pill">${esc(t)}</span>`).join('')}${more ? `<span class="pill">${esc(more)}</span>` : ''}</div>
  </article>`
}

export function mountArchitecture(app, {style}) {
  app.get('/cabinet/architecture', async (c) => {
    let agents = []
    let conn = null
    let err = ''
    try {
      const roster = await friday('/api/cabinet/agents')
      agents = Array.isArray(roster) ? roster : (roster?.agents || [])
    } catch (e) {
      err = e.message
    }
    try {
      conn = await friday('/api/cabinet/connections/accounts')
    } catch {
      conn = null
    }

    const active = agents.filter((a) => a.active)
    const codingIds = ['cto', 'architect', 'product', 'backend', 'web', 'mobile', 'tester', 'reviewer']
    const coding = codingIds.map((id) => agents.find((a) => a.id === id)).filter(Boolean)
    const others = agents.filter((a) => !codingIds.includes(a.id))
    const servers = (conn && conn.servers) || []

    const body = `<div class="wrap">
${err ? `<div class="err-banner">${esc(err)}</div>` : ''}
<div class="hero">
  <div class="eyebrow">Design overview</div>
  <h2>Cabinet architecture</h2>
  <p class="muted">How Friday, your advisors, Connections, Coder, and the supporting packages fit together — end to end.</p>
</div>
<nav class="toc" aria-label="On this page">
  <a href="#e2e">End to end</a>
  <a href="#chain">Coding chain</a>
  <a href="#agents">Agents</a>
  <a href="#capabilities">Capabilities</a>
  <a href="#connections">Connections</a>
  <a href="#packages">Packages</a>
  <a href="#persistence">Persistence</a>
</nav>

<section class="panel" id="e2e">
  <h3>End-to-end design</h3>
  <p>One Friday process; many advisor <em>personas</em> (charters). You never talk to Coder directly — advisors own outcomes and use tools until CLAIM or a real blocker.</p>
  <div class="flow">
    <div class="flow-step"><div class="flow-num">1</div><div><strong>You</strong><span class="muted">WhatsApp, Telegram, Mattermost, Alexa, or this Board</span></div></div>
    <div class="flow-step"><div class="flow-num">2</div><div><strong>Friday</strong><span class="muted">Jarvis converse — routes @advisor or sticky persona; same soul + memory</span></div></div>
    <div class="flow-step"><div class="flow-num">3</div><div><strong>Cabinet advisor</strong><span class="muted">Owns an obligation (own_work). May delegate_work to specialists</span></div></div>
    <div class="flow-step"><div class="flow-num">4</div><div><strong>Tools &amp; Connections</strong><span class="muted">Built-in tools + granted MCP servers from the marketplace</span></div></div>
    <div class="flow-step"><div class="flow-num">5</div><div><strong>Coder (optional)</strong><span class="muted">start_work → taskrunner → workspace; Cabinet bus MCP for ask / report / escalate</span></div></div>
    <div class="flow-step"><div class="flow-num">6</div><div><strong>Receipts</strong><span class="muted">CLAIM up the chain; SQLite obligations + Qdrant memories; you notified only on meaningful state change</span></div></div>
  </div>
  <pre class="mono">You
 └─ Friday (orchestrator)
     └─ Advisor obligation (root)
         ├─ child advisors (delegate_work)
         │    └─ start_work → Coder
         │         └─ cabinet_ask / cabinet_report / cabinet_escalate
         └─ CLAIM or blocked → wake parent → … → you</pre>
</section>

<section class="panel" id="chain">
  <h3>Coding chain (CTO → specialists → Coder)</h3>
  <p>For software work, CTO usually owns the root. Specialists take slices; Coder engines implement and talk back on the bus — never invent owner answers.</p>
  <div class="grid2">
    ${coding.length ? coding.map(agentCard).join('') : '<p class="muted">Coding advisors will appear here when Friday is reachable.</p>'}
  </div>
  <h4>Bus tools (inside Coder)</h4>
  <ul>
    <li><strong>cabinet_ask</strong> — clarifying question to the owning advisor (escalates up the chain if needed)</li>
    <li><strong>cabinet_report</strong> — progress / blocked / claim with evidence</li>
    <li><strong>cabinet_escalate</strong> — hard block; wakes parent or notifies you</li>
  </ul>
  <p class="muted">Auth: NAS <span class="pill">secrets/cabinet/bus.token</span> → Friday <span class="pill">CABINET_BUS_TOKEN</span> → taskrunner injects into the workspace MCP.</p>
</section>

<section class="panel" id="agents">
  <h3>Live Cabinet roster</h3>
  <p class="muted">${active.length} active of ${(agents || []).length} advisors. Charters live in soul <span class="pill">agents/&lt;id&gt;.md</span>.</p>
  <div class="grid2">${(agents || []).map(agentCard).join('') || '<p class="muted">No agents loaded.</p>'}</div>
</section>

<section class="panel" id="capabilities">
  <h3>Capabilities model</h3>
  <p>Every advisor gets the common tool set. Role extras come from <span class="pill">ROLE_TOOLS</span> in Friday; charters can add tools or <span class="pill">deny_tools</span>. Connections can grant additional MCP tools per advisor.</p>
  <h4>Common (all advisors)</h4>
  <div>${COMMON_CAPABILITIES.map((t) => `<span class="pill">${esc(t)}</span>`).join('')}</div>
  <h4>Obligation loop</h4>
  <ul>
    <li><strong>own_work</strong> — create a durable obligation you drive until CLAIM</li>
    <li><strong>delegate_work</strong> — child obligation under another advisor (depth capped)</li>
    <li><strong>obligation_status</strong> — inspect open work / children</li>
    <li><strong>start_work</strong> — dispatch Coder; links <span class="pill">obligation_id</span> (prefers open untasked child after delegate)</li>
  </ul>
  <h4>Other roles (examples)</h4>
  <div class="grid2">
    ${(others.length ? others : []).slice(0, 12).map(agentCard).join('') || '<p class="muted">—</p>'}
  </div>
</section>

<section class="panel" id="connections">
  <h3>Connections (capability marketplace)</h3>
  <p>Discover MCP servers, store secrets by reference on the NAS, grant tools to advisors, run local/stdio via runners. Flag: <span class="pill">FRIDAY_CONNECTIONS_ENABLED</span>.</p>
  <table>
    <tr><th>Server</th><th>Source</th><th>Status</th><th>Transport</th></tr>
    ${servers.length ? servers.map((s) => `<tr>
      <td>${esc(s.name)}</td>
      <td><span class="pill">${esc(s.source || '—')}</span></td>
      <td>${esc(s.status || '—')}</td>
      <td class="muted">${esc(s.transport || '—')}</td>
    </tr>`).join('') : '<tr><td class="muted" colspan="4">No connected servers yet — open Connections to discover.</td></tr>'}
  </table>
  <div class="row" style="margin-top:12px"><a class="go secondary" href="/connections">Open Connections</a><a class="go secondary" href="/cabinet">Cabinet</a></div>
</section>

<section class="panel" id="packages">
  <h3>Packages &amp; services involved</h3>
  <table>
    <tr><th>Piece</th><th>Repo / service</th><th>Role</th></tr>
    ${PACKAGES.map(([name, repo, role]) => `<tr>
      <td>${esc(name)}</td>
      <td class="muted mono" style="background:none;border:0;padding:8px 6px">${esc(repo)}</td>
      <td>${esc(role)}</td>
    </tr>`).join('')}
  </table>
  <h4>Runtime topology (NAS)</h4>
  <pre class="mono">Board (voiceboard) ──► Friday :8080  /api/cabinet/*
                         │
                         ├─ SQLite /data/friday.sqlite3  (obligations, bus, config, runs)
                         ├─ Soul mount /soul/agents/*.md
                         ├─ Secrets /secrets/agents/*.env + /secrets/connections/
                         ├─ Memory / Life / Ship MCP
                         ├─ Serena MCP (code intel)
                         └─ Taskrunner ──► Coder workspaces
                                           └─ Cabinet bus MCP → Friday</pre>
</section>

<section class="panel" id="persistence">
  <h3>Persistence &amp; knowledge</h3>
  <ul>
    <li><strong>SQLite</strong> — obligations, obligation_bus, agent_config, agent_docs, agent_runs, MCP registry tables</li>
    <li><strong>NAS secrets files</strong> — credential values only (never in the DB); Board writes via secret config</li>
    <li><strong>Qdrant via Memory MCP</strong> — remember_fact, CLAIM receipts, setup answers tagged <span class="pill">agent:&lt;id&gt;</span></li>
    <li><strong>Soul</strong> — character + advisor charters (git); agents propose, you approve</li>
  </ul>
  <p class="muted">System health and dependency probes live on the <a href="/cabinet/system">System</a> page. This page is the design map.</p>
  <h4>Fleet scale (in progress)</h4>
  <p>Many independent obligation lifecycles with fair concurrent supervision, a Board <strong>Work</strong> live ops view (chain position, HITL “needs you”, blockers + resolve CTAs), and fleet intake are specified in <span class="pill">CABINET_FLEET_AUTONOMOUS_PLAN_2026-09-17</span>. Phase 1 (intake + read APIs) is in Friday: <span class="pill">fleet_submit</span> creates one root per job with a single receipt; <span class="pill">POST /api/cabinet/fleet</span>, <span class="pill">GET /api/cabinet/obligations</span>, <span class="pill">GET /api/cabinet/work/attention</span> expose derived display states (<em>needs_you · blocked · running · waiting_coder · waiting_advisor · queued · paused</em>), chain breadcrumbs, holder and blocker kind. The <a href="/cabinet/work">Work</a> page is the live console: attention strip (what needs you, with reply / secrets / nudge), every open obligation with chain position and Coder link, and a per-chain detail with tree, bus thread, timeline and owner actions (reply, nudge, bump, pause, cancel, raise budget). Activity stays run logs; System shows scheduler health.</p>
  <h4>Display states (derived, shared by API and Board)</h4>
  <table>
    <tr><th>State</th><th>Rule</th></tr>
    <tr><td><span class="pill">needs_you</span></td><td>blocked ∧ (needs_owner ∨ root). A blocked root has nobody above it but you; Coder escalations nobody in the chain can answer latch the root too.</td></tr>
    <tr><td><span class="pill">blocked</span></td><td>blocked child waiting on its parent advisor or an external system.</td></tr>
    <tr><td><span class="pill">running</span></td><td>supervisor turn in flight (lock held).</td></tr>
    <tr><td><span class="pill">waiting_advisor</span> / <span class="pill">waiting_coder</span></td><td>open bus ask to an advisor / linked Coder task not terminal.</td></tr>
    <tr><td><span class="pill">queued</span> / <span class="pill">paused</span></td><td>durable, nothing in flight / owner-paused (skipped by the tick).</td></tr>
  </table>
  <p class="muted">Resolving HITL always writes a receipt on the obligation, wakes it, and clears <span class="pill">needs_owner</span>; a reply on the root also answers open Coder asks and wakes blocked descendants so nobody has to repeat the answer down the chain.</p>
  <h4>Honest caps today</h4>
  <table>
    <tr><th>Cap</th><th>Value</th><th>Meaning</th></tr>
    <tr><td><span class="pill">FRIDAY_OBLIGATION_TICK_MAX</span></td><td>8 (live; default 2)</td><td>Due obligations picked per supervisor tick, fair across advisors and batches</td></tr>
    <tr><td><span class="pill">FRIDAY_OBLIGATION_CONCURRENCY</span></td><td>4 (live; default 2)</td><td>Advisor turns run in parallel inside one tick</td></tr>
    <tr><td><span class="pill">FRIDAY_OBLIGATION_TICK_SECONDS</span></td><td>30</td><td>Supervisor cadence (own worker; routines are not delayed by turns)</td></tr>
    <tr><td><span class="pill">FRIDAY_OBLIGATION_TURN_SECONDS</span></td><td>180</td><td>Wall clock per advisor turn</td></tr>
    <tr><td><span class="pill">FRIDAY_OBLIGATION_BUSY_SECONDS</span></td><td>600</td><td>Back-off when the Coder runner is full (no attempt burned)</td></tr>
    <tr><td><span class="pill">FRIDAY_OBLIGATION_MAX_ATTEMPTS</span></td><td>12</td><td>Turns before an obligation auto-blocks with a budget blocker</td></tr>
    <tr><td><span class="pill">FRIDAY_FLEET_MAX_ROOTS</span></td><td>50</td><td>Roots accepted per fleet submit</td></tr>
    <tr><td>Chain depth</td><td>4</td><td>delegate_work nesting limit</td></tr>
    <tr><td>Coder live slots</td><td>≈20</td><td>Taskrunner cap; excess queues</td></tr>
    <tr><td>Friday replicas</td><td>1</td><td>Single SQLite writer; stop-first deploys</td></tr>
  </table>
  <p class="muted">Open obligations ≠ simultaneous LLM turns: 100 open rows means 100 durable lifecycles served by a bounded worker pool. Rehearsed 2026-09-17 with 200 synthetic roots: every root first-touched within 25 ticks, 7 of 8 advisors progressing per tick, attention/list reads under 5 ms. With real 60–90 s turns the live ceiling is roughly 8 turns per (turn-pair + 30 s) ≈ 150–250 turns/hour. Per-root wall-clock deadlines and the 12-attempt budget stop a runaway chain with an owner-visible blocker.</p>
</section>
</div>`

    return c.html(shell('Architecture', '/cabinet/architecture', body, style))
  })
}
