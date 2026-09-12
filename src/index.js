// voiceboard — speak → board → agent → shipped
import crypto from 'node:crypto'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { pgr, storageUpload, storageSignUrl } from './lib/db.js'
import { tick, purgeOldAudio } from './lib/pipeline.js'
import { dispatchItem, pollTasks } from './lib/taskrunner.js'
import { subscribe } from './lib/bus.js'
import { mountCabinet } from './cabinet.js'
import {
  DEV_MOCK,
  addQuick,
  convertToWork,
  deleteMemory,
  getItem,
  itemUrl,
  itemsFor,
  memoryIdOf,
  patchItem,
  persistMemory,
  stampMemory,
  unstampMemory,
} from './lib/inbox.js'

const PORT = parseInt(process.env.PORT || '3000')
const INGEST_TOKEN = process.env.INGEST_TOKEN || (DEV_MOCK ? 'dev-ingest' : undefined)
const FEED_USER = process.env.FEED_USER || 'asik'
const FEED_PASS = process.env.FEED_PASS || (DEV_MOCK ? 'dev' : '')
const COOKIE_VAL = crypto.createHash('sha256').update(`vb:${FEED_USER}:${FEED_PASS}`).digest('hex')
const MAX_UPLOAD = 8 * 1024 * 1024

const app = new Hono()

// ---------- health (public) ----------
let migrated = null
async function checkMigrated() {
  try { await pgr('voice_notes?select=id&limit=1'); migrated = true } catch { migrated = false }
}
if (!DEV_MOCK) checkMigrated()
else migrated = true
app.get('/health', (c) => c.json({ ok: true, migrated, service: 'voiceboard' }))

// ---------- ingest (bearer-only block, BEFORE the feed-auth wrapper) ----------
app.use('/ingest/*', async (c, next) => {
  const auth = c.req.header('Authorization') || ''
  const expect = `Bearer ${INGEST_TOKEN}`
  const a = Buffer.from(auth), b = Buffer.from(expect)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return c.json({ error: 'Unauthorized' }, 401)
  await next()
})

app.post('/ingest/voice', async (c) => {
  const body = await c.req.parseBody()
  const file = body.file
  const dedupKey = String(body.dedup_key || '')
  if (!(file && typeof file === 'object' && typeof file.arrayBuffer === 'function') || !dedupKey) {
    return c.json({ error: 'file (multipart) and dedup_key required' }, 400)
  }
  if (file.size > MAX_UPLOAD) return c.json({ error: 'clip too large (max 8MB)' }, 413)
  // keep the real extension (phone .opus, telegram .ogg) — ffmpeg needs it for format sniffing
  const uploadedName = (file.name || '').toLowerCase()
  const ext = /\.(opus|ogg|m4a|aac|mp3|wav)$/.test(uploadedName) ? uploadedName.slice(uploadedName.lastIndexOf('.')) : '.opus'
  const path = `${dedupKey}${ext}`
  const buf = Buffer.from(await file.arrayBuffer())
  await storageUpload(path, buf, file.type || 'audio/opus')
  const rows = await pgr('voice_notes?on_conflict=dedup_key&select=id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: [{
      dedup_key: dedupKey,
      source: String(body.source || 'phone'),
      mode: String(body.mode || 'rec'),
      audio_path: path,
      audio_bytes: file.size,
      status: 'uploaded',
      ...(body.append_to ? { append_to: String(body.append_to) } : {}),
    }],
  })
  return c.json({ id: rows[0]?.id, dedup_key: dedupKey, duplicate: !!(rows[0] && rows[0].id && rows.length && (await pgr(`voice_notes?dedup_key=eq.${dedupKey}&select=processed_at`))[0]?.processed_at) }, 202)
})

// ---------- PWA assets (PUBLIC — browsers fetch manifest/icons without credentials) ----------
app.get('/manifest.webmanifest', (c) => c.json({
  name: 'voiceboard', short_name: 'voiceboard', start_url: '/', display: 'standalone',
  background_color: '#0e1116', theme_color: '#0e1116',
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
}))

app.get('/icon.svg', (c) => c.body(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#151b23"/><text x="50" y="66" font-size="52" text-anchor="middle">🎙</text></svg>`, 200, { 'Content-Type': 'image/svg+xml' }))

app.get('/sw.js', (c) => c.body(
  `self.addEventListener('fetch', () => {});\n` + // network-first no-op — satisfies install criteria only
  `self.addEventListener('install', e => self.skipWaiting());\n`,
  200, { 'Content-Type': 'application/javascript' },
))

// ---------- feed auth (Basic or vb_auth cookie; ingest bearer for phone scripts) ----------
app.use('*', async (c, next) => {
  const authz = c.req.header('Authorization') || ''
  if (authz === `Bearer ${INGEST_TOKEN}`) return next() // server-to-server (phone append picker)
  const cookie = c.req.header('Cookie') || ''
  if (cookie.includes(`vb_auth=${COOKIE_VAL}`)) return next()
  const url = new URL(c.req.url)
  const key = url.searchParams.get('key')
  if (key === FEED_PASS || key === `${FEED_USER}:${FEED_PASS}`) return next()
  const auth = c.req.header('Authorization')
  if (auth?.startsWith('Basic ')) {
    const [u, p] = Buffer.from(auth.slice(6), 'base64').toString().split(':')
    if (u === FEED_USER && p === FEED_PASS) {
      c.header('Set-Cookie', `vb_auth=${COOKIE_VAL}; Max-Age=31536000; Path=/; HttpOnly; ${DEV_MOCK ? '' : 'Secure; '}SameSite=Lax`)
      return next()
    }
  }
  c.header('WWW-Authenticate', 'Basic realm="voiceboard"')
  return c.text('auth required — or open /?key=<pass>', 401)
})

// ---------- data helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
const KIND_ICON = { idea: '💡', app: '📱', improvement: '🔧', task: '✅', note: '📝' }

async function withAudio(item) {
  if (!item.voice_note_id) return item
  const [note] = await pgr(`voice_notes?id=eq.${item.voice_note_id}&select=transcript,audio_path,duration_s,extraction,captured_at`)
  item._note = note || {}
  item._audio_url = note?.audio_path ? await storageSignUrl(note.audio_path) : null
  return item
}

function formAct(action, label, cls = 'mini', confirmMsg = '') {
  const on = confirmMsg
    ? ` onsubmit="return confirm('${String(confirmMsg).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')"`
    : ''
  return `<form method="post" action="${esc(action)}"${on}><button class="${cls}" type="submit">${esc(label)}</button></form>`
}

function actionsHtml(item) {
  const url = itemUrl(item)
  const mid = memoryIdOf(item)
  const id = item.id
  const rows = []
  if (item.kind !== 'task' && ['inbox', 'failed'].includes(item.status)) {
    rows.push(formAct(`/items/${id}/to-task`, 'Convert to task', 'go'))
  }
  if (!mid) rows.push(formAct(`/items/${id}/remember`, 'Persist to memory', 'go'))
  else rows.push(formAct(`/items/${id}/forget`, 'Remove from memory', 'danger', 'Delete this from Friday memory? This cannot be undone.'))
  if (['inbox', 'failed'].includes(item.status)) {
    rows.push(formAct(`/items/${id}/to-work`, 'Convert to coder work', 'go', 'Mark buildable and send to Taskrunner?'))
  }
  if (item.status === 'inbox' && item.buildable && item.project_guess) {
    rows.push(formAct(`/items/${id}/dispatch`, 'Build it', 'go', 'Send to agent?'))
  }
  if (url) rows.push(`<a class="go" href="${esc(url)}" target="_blank" rel="noopener">Open URL</a>`)
  if (item.status === 'review_pr' && item.pr_url) {
    rows.push(`<a class="go" href="${esc(item.pr_url)}" target="_blank" rel="noopener">Open PR</a>`)
  }
  if (['inbox', 'failed', 'review_pr'].includes(item.status)) {
    rows.push(formAct(`/items/${id}/done`, 'Mark done', 'mini'))
    rows.push(formAct(`/items/${id}/fail`, 'Mark failed', 'mini'))
  }
  if (['inbox', 'failed', 'review_pr', 'done'].includes(item.status)) {
    rows.push(formAct(`/items/${id}/archive`, 'Archive', 'mini'))
  }
  return `<details class="menu"><summary>Actions</summary><div class="menu-list">${rows.join('')}</div></details>`
}

const COLUMNS = [
  { key: 'inbox', title: '📥 Inbox', statuses: ['inbox'], drop: 'inbox' },
  { key: 'building', title: '🔨 Building', statuses: ['queued', 'building'], drop: 'queued' },
  { key: 'review', title: '👀 Needs review', statuses: ['review_pr'], drop: 'review_pr' },
  { key: 'done', title: '✅ Done', statuses: ['done'], drop: 'done' },
  { key: 'failed', title: '❌ Failed', statuses: ['failed'], drop: 'failed' },
]
const MOVE_STATUSES = new Set(['inbox', 'queued', 'review_pr', 'done', 'failed'])
const DONE_HIDE_MS = 24 * 60 * 60 * 1000

function doneStamp(item) {
  return Date.parse(item.updated_at || item.created_at || 0) || 0
}

function cardHtml(item) {
  const icon = KIND_ICON[item.kind] || '📝'
  const tags = (item.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')
  const badge = item.project_guess ? `<span class="proj">${esc(item.project_guess)}</span>` : ''
  const url = itemUrl(item)
  return `<div class="card k-${esc(item.kind)}" id="c-${esc(item.id)}" draggable="true" data-id="${esc(item.id)}" data-status="${esc(item.status)}">
    <a class="title" href="/items/${esc(item.id)}">${icon} ${esc(item.title)}</a>
    ${item.summary ? `<div class="sum">${esc(item.summary)}</div>` : ''}
    <div class="meta">${badge} ${tags} ${url ? `<span class="tag">link</span>` : ''} <span class="dim">${esc((item.created_at || '').slice(5, 16).replace('T', ' '))}</span></div>
    ${item.task_error ? `<div class="err">${esc(item.task_error.slice(0, 140))}</div>` : ''}
    ${actionsHtml(item)}
  </div>`
}

function flashHtml(ok) {
  const msg = {
    remembered: 'Saved to Friday memory.',
    forgotten: 'Removed from Friday memory.',
    task: 'Converted to a task.',
    work: 'Queued as coder / Taskrunner work.',
    done: 'Marked done.',
    failed: 'Marked failed.',
    archived: 'Archived.',
  }[ok]
  return msg ? `<div class="flash" role="status">${esc(msg)}</div>` : ''
}

function boardHtml(columns, flash = '', extras = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>voiceboard</title><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icon.svg" type="image/svg+xml"><meta name="theme-color" content="#0e1116"><style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0e1116;color:#d7dce3;font:15px/1.45 system-ui,-apple-system,sans-serif}
h1{font-size:18px;margin:0;padding:14px 18px;background:#151b23;border-bottom:1px solid #232b36;display:flex;justify-content:space-between;align-items:center}
h1 a{color:#7ab7ff;text-decoration:none;font-size:13px}
.board{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:14px;padding:14px}
.col h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#8b95a3;margin:2px 0 8px 4px;display:flex;justify-content:space-between}
.card{background:#151b23;border:1px solid #232b36;border-radius:10px;padding:10px 12px;margin-bottom:10px;cursor:grab}
.card:active{cursor:grabbing}
.card.dragging{opacity:.45}
.col{min-height:120px;border-radius:12px;padding:4px;transition:background .15s,outline .15s}
.col.drag-over{background:#1a2b3d;outline:2px dashed #2563eb}
.card.k-app{border-left:3px solid #7ab7ff}.card.k-improvement{border-left:3px solid #ffd479}.card.k-idea{border-left:3px solid #c792ea}.card.k-task{border-left:3px solid #a5d6a7}
.title{color:#e8ecf1;font-weight:600;text-decoration:none;display:block}
.sum{color:#9aa5b1;font-size:13px;margin-top:4px}
.meta{margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.tag{background:#1d2632;border-radius:5px;padding:1px 6px;font-size:11px;color:#8fa3bd}
.proj{background:#1a2b3d;border-radius:5px;padding:1px 6px;font-size:11px;color:#7ab7ff}
.dim{color:#5c6675;font-size:11px}
.err{color:#ff8a80;font-size:12px;margin-top:6px;white-space:pre-wrap}
.acts{margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
button,.go{background:#2563eb;color:#fff;border:0;border-radius:7px;padding:8px 12px;min-height:40px;font-size:13px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}
button.mini{background:#232b36;color:#8b95a3}
button.danger{background:#3a1d1d;color:#ff8a80}
button:focus,.go:focus,summary:focus{outline:2px solid #7ab7ff;outline-offset:2px}
.menu{margin-top:8px}
.menu summary{cursor:pointer;color:#7ab7ff;font-size:13px;padding:8px 0;min-height:40px;list-style:none}
.menu summary::-webkit-details-marker{display:none}
.menu-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.empty{color:#8b95a3;font-size:13px;margin:4px 4px 10px;line-height:1.45}
.flash{margin:10px 18px 0;background:#1a2b3d;border:1px solid #2a4a6a;color:#cfe4ff;border-radius:8px;padding:8px 12px;font-size:13px}
.err-banner{margin:10px 18px 0;background:#3a1d1d;border:1px solid #5a2a2a;color:#ffb4ae;border-radius:8px;padding:8px 12px;font-size:13px}
.add{padding:0 18px 8px}
.add form{display:flex;gap:8px}
.add input{flex:1;background:#151b23;border:1px solid #232b36;color:#d7dce3;border-radius:7px;padding:7px 10px;font-size:14px}
.detail{max-width:760px;margin:0 auto;padding:18px}
.detail pre{background:#151b23;border:1px solid #232b36;border-radius:10px;padding:12px;white-space:pre-wrap;font-size:13px}
.detail label{display:block;font-size:12px;color:#8b95a3;margin:12px 0 4px}
.detail input,.detail textarea,.detail select{width:100%;background:#151b23;border:1px solid #232b36;color:#d7dce3;border-radius:7px;padding:8px;font-size:14px}
audio{width:100%;margin:10px 0}
</style></head><body>
<h1>🎙 voiceboard <span><a href="/cabinet" style="margin-right:14px">🏛 cabinet</a><a href="#" onclick="location.reload()">refresh</a></span></h1>
${flash || ''}
<div class="add"><form method="post" action="/items"><input name="title" placeholder="quick add a task…" required><button>+</button></form></div>
<div class="board" id="board">
${COLUMNS.map((col) => {
  const items = columns[col.title] || []
  const empty = col.key === 'inbox'
    ? '<div class="empty">Nothing to review. Work asks and remembers from Friday land here — not on famcal.</div>'
    : '<div class="empty">Drop a card here.</div>'
  const older = col.key === 'done' && extras.doneHidden
    ? extras.showOlder
      ? ` <a href="/" style="font-weight:400;text-transform:none;letter-spacing:0">hide older</a>`
      : ` <a href="/?done=all" style="font-weight:400;text-transform:none;letter-spacing:0">${extras.doneHidden} older</a>`
    : ''
  return `<div class="col" data-drop="${col.drop}"><h2>${col.title} <span>${items.length}${older}</span></h2>${items.map(cardHtml).join('') || empty}</div>`
}).join('')}
</div><script>
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
let vbReloadTimer=null, vbDragging=false;
const vbRefresh=()=>{ if(vbDragging) return; if(vbReloadTimer) return; vbReloadTimer=setTimeout(()=>{vbReloadTimer=null;location.reload();},800); };
try {
  const es=new EventSource('/events');
  es.addEventListener('board', vbRefresh);
  es.onerror=()=>{};
}catch(e){}
setTimeout(()=>{ if(!vbDragging) location.reload(); }, 60000);
document.querySelectorAll('.card[draggable]').forEach((card) => {
  card.addEventListener('dragstart', (e) => {
    if (e.target.closest && e.target.closest('a,button,input,textarea,select,summary')) { e.preventDefault(); return; }
    vbDragging = true;
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', card.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend', () => { vbDragging = false; card.classList.remove('dragging'); });
});
document.querySelectorAll('.col[data-drop]').forEach((col) => {
  col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); e.dataTransfer.dropEffect = 'move'; });
  col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
  col.addEventListener('drop', async (e) => {
    e.preventDefault();
    col.classList.remove('drag-over');
    const id = e.dataTransfer.getData('text/plain');
    const status = col.dataset.drop;
    const card = document.getElementById('c-' + id);
    if (!id || !status || !card) return;
    if (card.dataset.status === status || (status === 'queued' && (card.dataset.status === 'queued' || card.dataset.status === 'building'))) return;
    col.appendChild(card);
    try {
      const r = await fetch('/items/' + id + '/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ status }) });
      if (!r.ok) throw new Error('move failed');
      location.reload();
    } catch (err) { location.reload(); }
  });
});
</script></body></html>`
}


// ---------- live updates (authed via vb_auth cookie — EventSource sends same-origin cookies) ----------
app.get('/events', (c) => {
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      const send = (data) => controller.enqueue(enc.encode(data))
      send(`retry: 5000\n\n`)
      const unsubscribe = subscribe((event) => {
        try { send(`event: board\ndata: ${JSON.stringify({ event })}\n\n`) } catch { }
      })
      const ping = setInterval(() => { try { send(`: ping\n\n`) } catch { } }, 25000)
      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(ping)
        unsubscribe()
        try { controller.close() } catch { }
      })
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } })
})

// ---------- cabinet console (agents, schedules, activity) ----------
mountCabinet(app, { style: boardHtml({}).match(/<style>([\s\S]*)<\/style>/)?.[1] || '' })

// ---------- board UI ----------
app.get('/api/items', async (c) => {
  const status = c.req.query('status')
  const limit = Math.min(parseInt(c.req.query('limit') || '60', 10) || 60, 200)
  if (DEV_MOCK) {
    const wanted = status ? status.split(',') : null
    const items = (await itemsFor(wanted || ['inbox', 'queued', 'building', 'review_pr', 'done', 'failed'])).slice(0, limit)
    return c.json(items)
  }
  const filter = status ? `status=in.(${status})&` : ''
  const items = await pgr(`board_items?${filter}order=created_at.desc&limit=${limit}&select=id,title,kind,summary,status,project_guess,buildable,tags,created_at`)
  return c.json(items)
})

app.get('/', async (c) => {
  const showOlder = c.req.query('done') === 'all'
  try {
    const allDone = await itemsFor(['done'])
    const cutoff = Date.now() - DONE_HIDE_MS
    const recentDone = allDone.filter((i) => doneStamp(i) >= cutoff)
    const doneHidden = Math.max(0, allDone.length - recentDone.length)
    const columns = {
      '📥 Inbox': await itemsFor(['inbox']),
      '🔨 Building': await itemsFor(['queued', 'building']),
      '👀 Needs review': await itemsFor(['review_pr']),
      '✅ Done': showOlder ? allDone : recentDone,
      '❌ Failed': await itemsFor(['failed']),
    }
    return c.html(boardHtml(columns, flashHtml(c.req.query('ok')), { doneHidden, showOlder }))
  } catch (e) {
    return c.html(boardHtml({
      '📥 Inbox': [],
      '🔨 Building': [],
      '👀 Needs review': [],
      '✅ Done': [],
      '❌ Failed': [],
    }, `<div class="err-banner" role="alert">Could not load the board. ${esc(e.message || 'unknown error')}</div>`))
  }
})

app.get('/items/:id', async (c) => {
  const item = await getItem(c.req.param('id'))
  if (!item) return c.text('not found', 404)
  await withAudio(item)
  const note = item._note || {}
  const audio = item._audio_url ? `<audio controls src="${esc(item._audio_url)}"></audio>` : ''
  const url = itemUrl(item)
  return c.html(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(item.title)}</title>
<style>body{margin:0;background:#0e1116;color:#d7dce3;font:15px/1.5 system-ui,sans-serif}${boardHtml({}).match(/<style>([\s\S]*)<\/style>/)?.[1] || ''}</style></head><body><div class="detail">
<a href="/">← board</a>
${flashHtml(c.req.query('ok'))}
${actionsHtml(item)}
${url ? `<p><a class="go" href="${esc(url)}" target="_blank" rel="noopener">Open original URL</a></p>` : ''}
<form method="post" action="/items/${esc(item.id)}/edit">
<label>title</label><input name="title" value="${esc(item.title)}" required>
<label>kind</label><select name="kind">${['idea', 'app', 'improvement', 'task', 'note'].map(k => `<option ${item.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
<label>summary</label><textarea name="summary" rows="2">${esc(item.summary || '')}</textarea>
<label>details</label><textarea name="details" rows="5">${esc(item.details || '')}</textarea>
<label>tags (comma)</label><input name="tags" value="${esc((item.tags || []).join(', '))}">
<label>project (asikmydeen repo)</label><input name="project_guess" value="${esc(item.project_guess || '')}">
<label>buildable</label><select name="buildable"><option value="true" ${item.buildable ? 'selected' : ''}>true</option><option value="false" ${!item.buildable ? 'selected' : ''}>false</option></select>
<div class="acts" style="margin-top:14px"><button>save</button></div>
</form>
${audio}
${note.transcript ? `<label>transcript</label><pre>${esc(note.transcript)}</pre>` : ''}
${item.task_error ? `<label>last error</label><pre>${esc(item.task_error)}</pre>` : ''}
<p class="dim">status: ${esc(item.status)} ${item.task_id ? `· task ${esc(item.task_id)}` : ''}</p>
</div></body></html>`)
})

app.post('/items/:id/edit', async (c) => {
  const b = await c.req.parseBody()
  await patchItem(c.req.param('id'), {
    title: String(b.title).slice(0, 200),
    kind: ['idea', 'app', 'improvement', 'task', 'note'].includes(b.kind) ? b.kind : 'note',
    summary: String(b.summary || '').slice(0, 1000),
    details: String(b.details || '').slice(0, 8000),
    tags: String(b.tags || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 8),
    project_guess: String(b.project_guess || '').trim(),
    buildable: b.buildable === 'true',
    updated_at: new Date().toISOString(),
  })
  return c.redirect(`/items/${c.req.param('id')}`)
})

app.post('/items/:id/dispatch', async (c) => {
  const item = await getItem(c.req.param('id'))
  if (!item) return c.text('not found', 404)
  if (!item.buildable || !item.project_guess) return c.text('mark buildable + set a project first (edit the card)', 422)
  if (DEV_MOCK) {
    await patchItem(item.id, { status: 'queued', task_id: 'task_mock', updated_at: new Date().toISOString() })
    return c.redirect('/?ok=work')
  }
  const [note] = item.voice_note_id ? await pgr(`voice_notes?id=eq.${item.voice_note_id}&select=transcript`) : [{}]
  await dispatchItem(item, note?.transcript)
  return c.redirect('/?ok=work')
})

app.post('/items/:id/to-task', async (c) => {
  const item = await getItem(c.req.param('id'))
  if (!item) return c.text('not found', 404)
  await patchItem(item.id, { kind: 'task', status: item.status === 'archived' ? 'inbox' : item.status, updated_at: new Date().toISOString() })
  return c.redirect('/?ok=task')
})

app.post('/items/:id/remember', async (c) => {
  const item = await getItem(c.req.param('id'))
  if (!item) return c.text('not found', 404)
  try {
    const mid = await persistMemory(item)
    if (!mid) return c.text('memory save did not return an id', 502)
    await patchItem(item.id, stampMemory(item, mid))
  } catch (e) {
    return c.text('Could not persist to memory: ' + (e.message || 'error'), 502)
  }
  return c.redirect('/?ok=remembered')
})

app.post('/items/:id/forget', async (c) => {
  const item = await getItem(c.req.param('id'))
  if (!item) return c.text('not found', 404)
  const mid = memoryIdOf(item)
  if (!mid) return c.text('No memory id on this card', 422)
  try {
    await deleteMemory(mid)
    await patchItem(item.id, unstampMemory(item))
  } catch (e) {
    return c.text('Could not remove memory: ' + (e.message || 'error'), 502)
  }
  return c.redirect('/?ok=forgotten')
})

app.post('/items/:id/to-work', async (c) => {
  const item = await getItem(c.req.param('id'))
  if (!item) return c.text('not found', 404)
  try {
    await convertToWork(item)
  } catch (e) {
    return c.text('Could not dispatch coder work: ' + (e.message || 'error'), 502)
  }
  return c.redirect('/?ok=work')
})

app.post('/items/:id/move', async (c) => {
  const id = c.req.param('id')
  let status = ''
  const ct = c.req.header('Content-Type') || ''
  if (ct.includes('application/json')) {
    const body = await c.req.json().catch(() => ({}))
    status = String(body.status || '')
  } else {
    const b = await c.req.parseBody()
    status = String(b.status || '')
  }
  if (!MOVE_STATUSES.has(status)) return c.json({ ok: false, message: 'bad status' }, 400)
  const item = await patchItem(id, { status, updated_at: new Date().toISOString() })
  if (!item) return c.json({ ok: false, message: 'not found' }, 404)
  if (ct.includes('application/json')) return c.json({ ok: true, id, status })
  return c.redirect('/')
})

app.post('/items/:id/done', async (c) => {
  await patchItem(c.req.param('id'), { status: 'done', updated_at: new Date().toISOString() })
  return c.redirect('/?ok=done')
})

app.post('/items/:id/fail', async (c) => {
  await patchItem(c.req.param('id'), { status: 'failed', updated_at: new Date().toISOString() })
  return c.redirect('/?ok=failed')
})

app.post('/items/:id/archive', async (c) => {
  await patchItem(c.req.param('id'), { status: 'archived', updated_at: new Date().toISOString() })
  return c.redirect('/?ok=archived')
})

app.post('/items', async (c) => {
  const b = await c.req.parseBody()
  const title = String(b.title || '').trim()
  if (title) await addQuick(title)
  return c.redirect('/')
})

// ---------- internal ----------
app.post('/internal/tick', async (c) => {
  const auth = c.req.header('Authorization') || ''
  if (auth !== `Bearer ${INGEST_TOKEN}`) return c.json({ error: 'Unauthorized' }, 401)
  const processed = await tick()
  const inflight = await pollTasks()
  return c.json({ processed, inflight })
})

app.get('/internal/stats', async (c) => {
  const notes = await pgr('voice_notes?select=status')
  const items = await pgr('board_items?select=status')
  const count = (rows, s) => rows.filter(r => r.status === s).length
  return c.json({
    voice_notes: notes.reduce((m, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {}),
    board_items: items.reduce((m, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {}),
  })
})

// ---------- loops ----------
// crash recovery: re-queue notes orphaned in 'processing' by a restart
async function recoverOrphans() {
  try {
    const cutoff = new Date(Date.now() - 5 * 60e3).toISOString()
    await pgr(`voice_notes?status=eq.processing&captured_at=lt.${cutoff}`, { method: 'PATCH', body: { status: 'uploaded' } })
  } catch { }
}
if (!DEV_MOCK) {
  recoverOrphans()
  setInterval(async () => { try { await tick() } catch { } }, 15000)
  setInterval(async () => { try { await pollTasks() } catch { } }, 30000)
  setInterval(async () => { try { await purgeOldAudio() } catch (e) { console.error('[purge]', e.message) } }, 6 * 3600e3)
}

serve({ fetch: app.fetch, port: PORT }, () => console.log(`voiceboard on :${PORT}${DEV_MOCK ? ' (mock inbox)' : ''}`))
