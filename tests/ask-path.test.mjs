import test from 'node:test'
import { after } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'

// env before the modules read it (mock inbox, deterministic ask URL + notify topic)
process.env.VOICEBOARD_DEV_MOCK = '1'
process.env.ASK_URL = 'https://voiceboard.test/ingest/ask'
process.env.NTFY_URL = 'https://ntfy.test'
process.env.NTFY_TOPIC = 'test-topic'

const posted = []
const originalFetch = global.fetch
global.fetch = async (url, options = {}) => { posted.push([String(url), options]); return new Response('{}', { status: 200 }) }

const { mountAsk } = await import('../src/lib/ask.js')
const { buildBrief, parkQuestion } = await import('../src/lib/taskrunner.js')
const { convertToWork, getItem } = await import('../src/lib/inbox.js')

after(() => { global.fetch = originalFetch })

const TOKEN = 'test-ask-token'
const app = new Hono()
mountAsk(app, { token: TOKEN })
const ask = (body, headers = {}) => app.request('/ingest/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

test('parkQuestion keeps one block — a new ask replaces the old one', () => {
  const once = parkQuestion({ summary: 'original summary' }, 'Ship\n\n   A or B?')
  assert.equal(once, '❓ NEEDS ANSWER: Ship A or B?\n\noriginal summary')
  const twice = parkQuestion({ summary: once }, 'Different question?')
  assert.equal(twice, '❓ NEEDS ANSWER: Different question?\n\noriginal summary')
  assert.ok(!twice.includes('A or B?'))
  assert.equal((twice.match(/NEEDS ANSWER/g) || []).length, 1)
  assert.equal(parkQuestion({ summary: '' }, 'x'.repeat(900)).length, '❓ NEEDS ANSWER: '.length + 800)
  // re-asking on a summary that ends with the block (no trailing content) must not stack either
  const lone = parkQuestion({ summary: '' }, 'First?')
  assert.equal(parkQuestion({ summary: lone }, 'Second?'), '❓ NEEDS ANSWER: Second?')
})

test('ask endpoint is bearer-only', async () => {
  assert.equal((await ask({ task_id: 'task_mock', question: 'hi' }, { Authorization: 'Bearer wrong' })).status, 401)
  assert.equal((await ask({ task_id: 'task_mock', question: 'hi' }, { Authorization: '' })).status, 401)
})

test('ask endpoint validates the payload and the task', async () => {
  assert.equal((await ask({ question: 'no task' })).status, 400)
  assert.equal((await ask({ task_id: 'task_mock' })).status, 400)
  const missing = await ask({ task_id: 'task_nope', question: 'Anyone there?' })
  assert.equal(missing.status, 404)
  assert.match(JSON.stringify(await missing.json()), /no board item for task task_nope/)
})

test('a dispatched agent can ask mid-task: card flagged, owner notified with /answer', async () => {
  const item = await getItem('44444444-4444-4444-4444-444444444444')
  await convertToWork(item) // mock dispatch → status queued, task_id task_mock
  posted.length = 0
  const res = await ask({ task_id: 'task_mock', question: 'Ship the dark toggle\n\nor wait for the redesign?' })
  assert.equal(res.status, 202)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.task_id, 'task_mock')
  const parked = await getItem(item.id)
  assert.match(parked.summary, /^❓ NEEDS ANSWER: Ship the dark toggle or wait for the redesign\?\n\n/)
  assert.equal((parked.summary.match(/NEEDS ANSWER/g) || []).length, 1)
  const [url, options] = posted.at(-1)
  assert.ok(url.startsWith('https://ntfy.test/test-topic'))
  assert.equal(options.headers.Title, '❓ agent asks: Fix voiceboard inbox actions')
  assert.match(options.body, /Answer in Telegram: \/answer task_mock <your answer>/)
  assert.match(options.body, /Ship the dark toggle or wait for the redesign\?/)
  // a second ask replaces the parked question instead of stacking
  await ask({ task_id: 'task_mock', question: 'Actually: light mode first?' })
  const again = await getItem(item.id)
  assert.equal((again.summary.match(/NEEDS ANSWER/g) || []).length, 1)
  assert.match(again.summary, /light mode first\?/)
})

test('ask endpoint accepts a form-encoded body (curl default)', async () => {
  await convertToWork(await getItem('44444444-4444-4444-4444-444444444444')) // ensure task_mock exists
  const res = await app.request('/ingest/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${TOKEN}` },
    body: 'task_id=task_mock&question=Form+ask+works%3F',
  })
  assert.equal(res.status, 202)
  assert.match((await getItem('44444444-4444-4444-4444-444444444444')).summary, /Form ask works\?/)
})

test('the dispatch brief teaches the live ask path and keeps the QUESTION.md fallback', () => {
  const brief = buildBrief({ title: 'Test item', tags: [] }, '')
  assert.match(brief, /POST \{"task_id": "<your task id>", "question": "<one paragraph>"\} to https:\/\/voiceboard\.test\/ingest\/ask/)
  assert.match(brief, /\$VOICEBOARD_ASK_TOKEN/)
  assert.match(brief, /QUESTION\.md/)
})
