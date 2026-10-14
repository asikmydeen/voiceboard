// Mid-task ask path — a running coding agent parks a question on its card and
// the owner is told immediately (ntfy → Telegram /answer). QUESTION.md on the
// PR stays the fallback for agents that finish without asking live.
import crypto from 'node:crypto'
import { itemByTaskId, patchItem } from './inbox.js'
import { notifyQuestion, parkQuestion } from './taskrunner.js'
import { publish } from './bus.js'

export function mountAsk(app, { token }) {
  app.post('/ingest/ask', async (c) => {
    // bearer-only, like the rest of /ingest — safe even if mounted outside that block
    const auth = c.req.header('Authorization') || ''
    const expect = `Bearer ${token}`
    const a = Buffer.from(auth), b = Buffer.from(expect)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return c.json({ error: 'Unauthorized' }, 401)
    const ct = c.req.header('Content-Type') || ''
    let body = {}
    try { body = ct.includes('application/json') ? await c.req.json() : await c.req.parseBody() } catch { /* empty body fails the check below */ }
    const taskId = String(body.task_id || '').trim()
    const question = String(body.question || '').replace(/\s+/g, ' ').trim()
    if (!taskId || !question) return c.json({ error: 'task_id and question required' }, 400)
    const item = await itemByTaskId(taskId)
    if (!item) return c.json({ error: `no board item for task ${taskId}` }, 404)
    await patchItem(item.id, { summary: parkQuestion(item, question), updated_at: new Date().toISOString() })
    publish('task') // refresh open boards
    await notifyQuestion(item, question) // no-ops without a notify topic configured
    return c.json({ ok: true, id: item.id, task_id: taskId, status: item.status }, 202)
  })
}
