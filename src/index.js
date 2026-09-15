// voiceboard — speak → board → agent → shipped
import crypto from 'node:crypto'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { pgr, storageUpload, storageSignUrl } from './lib/db.js'
import { tick, purgeOldAudio } from './lib/pipeline.js'
import { dispatchItem, pollTasks } from './lib/taskrunner.js'
import { subscribe } from './lib/bus.js'
import { mountCabinet } from './cabinet.js'
import {boardHtml,actionsHtml,flashHtml,MOVE_STATUSES,renderDetail} from './board-ui.js'
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
  name: 'Friday Board', short_name: 'Friday', start_url: '/', display: 'standalone',
  background_color: '#0e1116', theme_color: '#0e1116',
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
}))

app.get('/icon.svg', (c) => c.body(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="26" fill="#a5c1ff"/><text x="50" y="73" fill="#13233d" font-family="Georgia,serif" font-size="84" text-anchor="middle">f.</text></svg>`, 200, { 'Content-Type': 'image/svg+xml' }))

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
  if (key === FEED_PASS || key === `${FEED_USER}:${FEED_PASS}`) {
    c.header('Set-Cookie', `vb_auth=${COOKIE_VAL}; Max-Age=31536000; Path=/; HttpOnly; ${DEV_MOCK ? '' : 'Secure; '}SameSite=Lax`)
    return next()
  }
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

const DONE_HIDE_MS = 24 * 60 * 60 * 1000
const doneStamp = item => Date.parse(item.updated_at || item.created_at || 0) || 0
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
    }, `<div class="err-banner" role="alert">Could not load the board. ${esc(e.message || 'unknown error')}</div>`), 503)
  }
})

app.get('/items/:id', async (c) => {
  const item = await getItem(c.req.param('id'))
  if (!item) return c.text('not found', 404)
  await withAudio(item)
  return c.html(c.req.query('panel') === '1' ? renderDetail(item) : boardHtml({}, '', {detail:item}))
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
  let expectedStatus
  const ct = c.req.header('Content-Type') || ''
  if (ct.includes('application/json')) {
    const body = await c.req.json().catch(() => ({}))
    status = String(body.status || '')
    expectedStatus = body.expected_status
  } else {
    const b = await c.req.parseBody()
    status = String(b.status || '')
  }
  if (!MOVE_STATUSES.has(status)) return c.json({ ok: false, message: 'bad status' }, 400)
  const before = await getItem(id)
  if (!before) return c.json({ok:false,message:'Task not found.'},404)
  if (expectedStatus !== undefined && before.status !== expectedStatus) return c.json({ok:false,message:'This task moved elsewhere. The board will refresh.'},409)
  let item
  if (expectedStatus !== undefined && !DEV_MOCK) {
    const rows=await pgr(`board_items?id=eq.${encodeURIComponent(id)}&status=eq.${encodeURIComponent(expectedStatus)}`,{method:'PATCH',prefer:'return=representation',body:{status,updated_at:new Date().toISOString()}})
    if(!rows.length)return c.json({ok:false,message:'This task changed while moving. The board will refresh.'},409)
    item=rows[0]
  } else item = await patchItem(id, { status, updated_at: new Date().toISOString() })
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
