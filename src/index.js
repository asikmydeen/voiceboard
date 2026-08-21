// voiceboard — speak → board → agent → shipped
import crypto from 'node:crypto'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { pgr, storageUpload, storageSignUrl } from './lib/db.js'
import { tick, purgeOldAudio } from './lib/pipeline.js'
import { dispatchItem, pollTasks } from './lib/taskrunner.js'

const PORT = parseInt(process.env.PORT || '3000')
const INGEST_TOKEN = process.env.INGEST_TOKEN
const FEED_USER = process.env.FEED_USER || 'asik'
const FEED_PASS = process.env.FEED_PASS
const COOKIE_VAL = crypto.createHash('sha256').update(`vb:${FEED_USER}:${FEED_PASS}`).digest('hex')
const MAX_UPLOAD = 8 * 1024 * 1024

const app = new Hono()

// ---------- health (public) ----------
let migrated = null
async function checkMigrated() {
  try { await pgr('voice_notes?select=id&limit=1'); migrated = true } catch { migrated = false }
}
checkMigrated()
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
    }],
  })
  return c.json({ id: rows[0]?.id, dedup_key: dedupKey, duplicate: !!(rows[0] && rows[0].id && rows.length && (await pgr(`voice_notes?dedup_key=eq.${dedupKey}&select=processed_at`))[0]?.processed_at) }, 202)
})

// ---------- feed auth (Basic or vb_auth cookie) ----------
app.use('*', async (c, next) => {
  const cookie = c.req.header('Cookie') || ''
  if (cookie.includes(`vb_auth=${COOKIE_VAL}`)) return next()
  const url = new URL(c.req.url)
  const key = url.searchParams.get('key')
  if (key === FEED_PASS || key === `${FEED_USER}:${FEED_PASS}`) return next()
  const auth = c.req.header('Authorization')
  if (auth?.startsWith('Basic ')) {
    const [u, p] = Buffer.from(auth.slice(6), 'base64').toString().split(':')
    if (u === FEED_USER && p === FEED_PASS) {
      c.header('Set-Cookie', `vb_auth=${COOKIE_VAL}; Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Lax`)
      return next()
    }
  }
  c.header('WWW-Authenticate', 'Basic realm="voiceboard"')
  return c.text('auth required — or open /?key=<pass>', 401)
})

// ---------- data helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
const KIND_ICON = { idea: '💡', app: '📱', improvement: '🔧', task: '✅', note: '📝' }

async function itemsFor(statuses) {
  return pgr(`board_items?status=in.(${statuses.join(',')})&order=created_at.desc&limit=60&select=*`)
}

async function withAudio(item) {
  if (!item.voice_note_id) return item
  const [note] = await pgr(`voice_notes?id=eq.${item.voice_note_id}&select=transcript,audio_path,duration_s,extraction,captured_at`)
  item._note = note || {}
  item._audio_url = note?.audio_path ? await storageSignUrl(note.audio_path) : null
  return item
}

function cardHtml(item) {
  const icon = KIND_ICON[item.kind] || '📝'
  const tags = (item.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')
  const badge = item.project_guess ? `<span class="proj">${esc(item.project_guess)}</span>` : ''
  const acts = []
  if (item.status === 'inbox') {
    if (item.buildable && item.project_guess) acts.push(`<form method="post" action="/items/${item.id}/dispatch" onsubmit="return confirm('Send to agent?')"><button class="go">🔨 Build it</button></form>`)
    else acts.push(`<span class="dim">${item.buildable ? 'set a project first' : 'not buildable'}</span>`)
  }
  if (item.status === 'review_pr' && item.pr_url) acts.push(`<a class="go" href="${esc(item.pr_url)}" target="_blank">🔗 PR</a>`)
  if (['inbox', 'failed', 'review_pr', 'done'].includes(item.status)) acts.push(`<form method="post" action="/items/${item.id}/archive"><button class="mini">archive</button></form>`)
  return `<div class="card k-${esc(item.kind)}" id="c-${esc(item.id)}">
    <a class="title" href="/items/${esc(item.id)}">${icon} ${esc(item.title)}</a>
    ${item.summary ? `<div class="sum">${esc(item.summary)}</div>` : ''}
    <div class="meta">${badge} ${tags} <span class="dim">${esc((item.created_at || '').slice(5, 16).replace('T', ' '))}</span></div>
    ${item.task_error ? `<div class="err">${esc(item.task_error.slice(0, 140))}</div>` : ''}
    ${acts.length ? `<div class="acts">${acts.join('')}</div>` : ''}
  </div>`
}

function boardHtml(columns) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>voiceboard</title><style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0e1116;color:#d7dce3;font:15px/1.45 system-ui,-apple-system,sans-serif}
h1{font-size:18px;margin:0;padding:14px 18px;background:#151b23;border-bottom:1px solid #232b36;display:flex;justify-content:space-between;align-items:center}
h1 a{color:#7ab7ff;text-decoration:none;font-size:13px}
.board{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:14px;padding:14px}
.col h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#8b95a3;margin:2px 0 8px 4px;display:flex;justify-content:space-between}
.card{background:#151b23;border:1px solid #232b36;border-radius:10px;padding:10px 12px;margin-bottom:10px}
.card.k-app{border-left:3px solid #7ab7ff}.card.k-improvement{border-left:3px solid #ffd479}.card.k-idea{border-left:3px solid #c792ea}.card.k-task{border-left:3px solid #a5d6a7}
.title{color:#e8ecf1;font-weight:600;text-decoration:none;display:block}
.sum{color:#9aa5b1;font-size:13px;margin-top:4px}
.meta{margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.tag{background:#1d2632;border-radius:5px;padding:1px 6px;font-size:11px;color:#8fa3bd}
.proj{background:#1a2b3d;border-radius:5px;padding:1px 6px;font-size:11px;color:#7ab7ff}
.dim{color:#5c6675;font-size:11px}
.err{color:#ff8a80;font-size:12px;margin-top:6px;white-space:pre-wrap}
.acts{margin-top:8px;display:flex;gap:8px;align-items:center}
button,.go{background:#2563eb;color:#fff;border:0;border-radius:7px;padding:6px 12px;font-size:13px;cursor:pointer;text-decoration:none;display:inline-block}
button.mini{background:#232b36;color:#8b95a3}
.add{padding:0 18px 8px}
.add form{display:flex;gap:8px}
.add input{flex:1;background:#151b23;border:1px solid #232b36;color:#d7dce3;border-radius:7px;padding:7px 10px;font-size:14px}
.detail{max-width:760px;margin:0 auto;padding:18px}
.detail pre{background:#151b23;border:1px solid #232b36;border-radius:10px;padding:12px;white-space:pre-wrap;font-size:13px}
.detail label{display:block;font-size:12px;color:#8b95a3;margin:12px 0 4px}
.detail input,.detail textarea,.detail select{width:100%;background:#151b23;border:1px solid #232b36;color:#d7dce3;border-radius:7px;padding:8px;font-size:14px}
audio{width:100%;margin:10px 0}
</style></head><body>
<h1>🎙 voiceboard <a href="#" onclick="location.reload()">refresh</a></h1>
<div class="add"><form method="post" action="/items"><input name="title" placeholder="quick add a task…" required><button>+</button></form></div>
<div class="board" id="board">
${Object.entries(columns).map(([name, items]) => `<div class="col"><h2>${name} <span>${items.length}</span></h2>${items.map(cardHtml).join('') || '<div class="dim" style="margin-left:4px">—</div>'}</div>`).join('')}
</div><script>setTimeout(()=>location.reload(), 20000)</script></body></html>`
}

// ---------- board UI ----------
app.get('/', async (c) => {
  const columns = {
    '📥 Inbox': await itemsFor(['inbox']),
    '🔨 Building': await itemsFor(['queued', 'building']),
    '👀 Needs review': await itemsFor(['review_pr']),
    '✅ Done': await itemsFor(['done']),
    '❌ Failed': await itemsFor(['failed']),
  }
  return c.html(boardHtml(columns))
})

app.get('/items/:id', async (c) => {
  const [item] = await pgr(`board_items?id=eq.${c.req.param('id')}&select=*`)
  if (!item) return c.text('not found', 404)
  await withAudio(item)
  const note = item._note || {}
  const audio = item._audio_url ? `<audio controls src="${esc(item._audio_url)}"></audio>` : ''
  return c.html(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(item.title)}</title>
<style>body{margin:0;background:#0e1116;color:#d7dce3;font:15px/1.5 system-ui,sans-serif}${boardHtml({}).match(/<style>([\s\S]*)<\/style>/)?.[1] || ''}</style></head><body><div class="detail">
<a href="/">← board</a>
<form method="post" action="/items/${esc(item.id)}/edit">
<label>title</label><input name="title" value="${esc(item.title)}" required>
<label>kind</label><select name="kind">${['idea', 'app', 'improvement', 'task', 'note'].map(k => `<option ${item.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
<label>summary</label><textarea name="summary" rows="2">${esc(item.summary)}</textarea>
<label>details</label><textarea name="details" rows="5">${esc(item.details)}</textarea>
<label>tags (comma)</label><input name="tags" value="${esc((item.tags || []).join(', '))}">
<label>project (asikmydeen repo)</label><input name="project_guess" value="${esc(item.project_guess)}">
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
  await pgr(`board_items?id=eq.${c.req.param('id')}`, {
    method: 'PATCH',
    body: {
      title: String(b.title).slice(0, 200),
      kind: ['idea', 'app', 'improvement', 'task', 'note'].includes(b.kind) ? b.kind : 'note',
      summary: String(b.summary || '').slice(0, 1000),
      details: String(b.details || '').slice(0, 8000),
      tags: String(b.tags || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 8),
      project_guess: String(b.project_guess || '').trim(),
      buildable: b.buildable === 'true',
      updated_at: new Date().toISOString(),
    },
  })
  return c.redirect(`/items/${c.req.param('id')}`)
})

app.post('/items/:id/dispatch', async (c) => {
  const [item] = await pgr(`board_items?id=eq.${c.req.param('id')}&select=*`)
  if (!item) return c.text('not found', 404)
  if (!item.buildable || !item.project_guess) return c.text('mark buildable + set a project first (edit the card)', 422)
  const [note] = item.voice_note_id ? await pgr(`voice_notes?id=eq.${item.voice_note_id}&select=transcript`) : [{}]
  await dispatchItem(item, note?.transcript)
  return c.redirect('/')
})

app.post('/items/:id/archive', async (c) => {
  await pgr(`board_items?id=eq.${c.req.param('id')}`, { method: 'PATCH', body: { status: 'archived', updated_at: new Date().toISOString() } })
  return c.redirect('/')
})

app.post('/items', async (c) => {
  const b = await c.req.parseBody()
  const title = String(b.title || '').trim()
  if (title) await pgr('board_items', {
    method: 'POST',
    body: [{ title: title.slice(0, 200), kind: 'task', buildable: false, summary: '(typed quick-add)' }],
  })
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
setInterval(async () => { try { await tick() } catch { } }, 15000)
setInterval(async () => { try { await pollTasks() } catch { } }, 30000)
setInterval(async () => { try { await purgeOldAudio() } catch (e) { console.error('[purge]', e.message) } }, 6 * 3600e3)

serve({ fetch: app.fetch, port: PORT }, () => console.log(`voiceboard on :${PORT}`))
