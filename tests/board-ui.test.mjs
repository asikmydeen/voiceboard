// Board UI verification — owner-facing card view: auth wall, populated/empty
// board, card detail, and how each degrades when the database is unreachable.
// Boots the real server over HTTP (mock inbox / no-DB) rather than calling
// handlers directly, so auth cookies, redirects and status codes are real.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INBOX_ITEM = '11111111-1111-1111-1111-111111111111'
const ALL_ITEMS = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555555']

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
  })
}

async function startBoard(t, { mock = true } = {}) {
  const port = await freePort()
  const env = { ...process.env, PORT: String(port), FEED_USER: 'asik', FEED_PASS: 'test-pass' }
  if (mock) env.VOICEBOARD_DEV_MOCK = '1'
  else { delete env.VOICEBOARD_DEV_MOCK; delete env.SUPABASE_URL; delete env.SUPABASE_SERVICE_KEY }
  const child = spawn(process.execPath, [path.join(ROOT, 'src/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let bootErr = ''
  child.stderr.on('data', d => { bootErr += d })
  t.after(() => child.kill())
  const base = `http://127.0.0.1:${port}`
  const auth = { Authorization: `Basic ${Buffer.from('asik:test-pass').toString('base64')}` }
  let up = false
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await fetch(`${base}/health`)).ok } catch { await new Promise(r => setTimeout(r, 100)) }
  }
  if (!up) assert.fail(`board did not start on ${base} (mock=${mock}): ${bootErr.slice(0, 400) || 'no output'}`)
  const get = async (p) => fetch(base + p, { headers: auth })
  const post = async (p, body) => fetch(base + p, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  return { base, get, post }
}

test('board is behind the login but PWA assets stay public', async (t) => {
  const { base, get } = await startBoard(t)
  const wall = await fetch(base + '/')
  assert.equal(wall.status, 401)
  assert.match(wall.headers.get('www-authenticate') || '', /Basic realm="voiceboard"/)
  assert.equal((await fetch(base + '/api/items')).status, 401)
  for (const asset of ['/manifest.webmanifest', '/icon.svg', '/sw.js']) {
    const r = await fetch(base + asset)
    assert.equal(r.status, 200, `${asset} should be fetchable without credentials`)
  }
  assert.equal((await get('/')).status, 200)
})

test('populated board renders five columns, cards and mobile viewport setup', async (t) => {
  const { get } = await startBoard(t)
  const r = await get('/')
  assert.equal(r.status, 200)
  const html = await r.text()
  assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1">/)
  // one column per drop target, in board order
  const drops = [...html.matchAll(/data-drop="([a-z_]+)"/g)].map(m => m[1])
  assert.deepEqual(drops, ['inbox', 'queued', 'review_pr', 'done', 'failed'])
  assert.equal((html.match(/class="card /g) || []).length, 4)
  // empty columns carry copy rather than rendering nothing
  assert.equal((html.match(/Drop a card here\./g) || []).length, 3)
  assert.match(html, /quick add a task/)
  // grid collapses to a single column on phones; touch targets stay tappable
  assert.match(html, /\.board\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(270px,1fr\)\)/)
  assert.match(html, /button,\.go\{[^}]*min-height:40px/)
  assert.match(html, /\.menu summary\{[^}]*min-height:40px/)
  // text inputs at 16px so iOS Safari does not zoom on focus
  assert.match(html, /\.add input\{[^}]*font-size:16px/)
  assert.match(html, /\.detail input,\.detail textarea,\.detail select\{[^}]*font-size:16px/)
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1])
})

test('card detail, unknown ids, the JSON feed and drag-to-move', async (t) => {
  const { get, post } = await startBoard(t)
  const detail = await get(`/items/${INBOX_ITEM}`)
  assert.equal(detail.status, 200)
  const dhtml = await detail.text()
  assert.match(dhtml, /← board/)
  assert.match(dhtml, /<label>title<\/label>/)
  assert.equal((await get('/items/00000000-0000-0000-0000-000000000000')).status, 404)
  const items = await (await get('/api/items?status=inbox')).json()
  assert.equal(items.length, 3)
  assert.deepEqual(await (await get('/api/items?status=review_pr')).json(), [])
  const moved = await post(`/items/${INBOX_ITEM}/move`, { status: 'queued' })
  assert.equal(moved.status, 200)
  assert.deepEqual(await moved.json(), { ok: true, id: INBOX_ITEM, status: 'queued' })
  const html = await (await get('/')).text()
  assert.ok(html.indexOf('data-drop="queued"') < html.indexOf(`c-${INBOX_ITEM}`), 'card sits in Building after the move')
  assert.ok(html.indexOf(`c-${INBOX_ITEM}`) < html.indexOf('data-drop="review_pr"'), 'card left Inbox')
  assert.equal((await post(`/items/${INBOX_ITEM}/move`, { status: 'teleported' })).status, 400)
})

test('empty board keeps its copy, quick-add and the action flash', async (t) => {
  const { get, post } = await startBoard(t)
  for (const id of ALL_ITEMS) assert.ok((await post(`/items/${id}/archive`)).redirected, 'archive bounces back to the board')
  const html = await (await get('/?ok=archived')).text()
  assert.equal((html.match(/class="card /g) || []).length, 0)
  assert.equal((html.match(/Drop a card here\./g) || []).length, 4)
  assert.equal((html.match(/Nothing to review\./g) || []).length, 1)
  assert.match(html, /quick add a task/)
  assert.match(html, /<div class="flash" role="status">Archived\./)
  assert.deepEqual(await (await get('/api/items')).json(), [])
})

test('database outage shows a friendly board and card page, not a stack dump', async (t) => {
  const { get } = await startBoard(t, { mock: false })
  const health = await (await get('/health')).json()
  assert.equal(health.migrated, false)
  const board = await (await get('/')).text()
  const banner = board.match(/<div class="err-banner"[^>]*>([^<]*)</)?.[1] || ''
  assert.match(banner, /Could not load the board\. Try refreshing\./)
  assert.doesNotMatch(banner, /rest\/v1|pgr |select=|-> \d+/)
  assert.match(board, /<details class="err-detail"><summary>technical detail<\/summary>/)
  assert.match(board, /rest\/v1/, 'diagnostic stays available, just collapsed')
  const card = await get(`/items/${INBOX_ITEM}`)
  assert.equal(card.status, 503)
  const chtml = await card.text()
  assert.match(chtml, /Could not load this card\. Try refreshing\./)
  assert.match(chtml, /← board/)
  assert.doesNotMatch(chtml, /Internal Server Error/)
})
