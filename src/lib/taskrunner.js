// Taskrunner dispatch + status poll + ntfy terminal notifications
import { pgr } from './db.js'
import { notify } from './notify.js'
import { publish } from './bus.js'

const TR_URL = process.env.TASKRUNNER_URL || 'https://taskrunner.asikmydeen.com'
const TR_TOKEN = process.env.TASKRUNNER_TOKEN

async function tr(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${TR_URL}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${TR_TOKEN}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`taskrunner ${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

function buildBrief(item, transcript) {
  const parts = [`# ${item.title}`, '']
  if (item.summary) parts.push(item.summary, '')
  if (item.details) parts.push('## Details', item.details, '')
  if (item.tags?.length) parts.push(`Tags: ${item.tags.join(', ')}`, '')
  if (transcript) parts.push('---', `Source: voice capture. Transcript excerpt:`, transcript.slice(0, 1500))
  return parts.join('\n')
}

export async function dispatchItem(item, transcript) {
  const task = await tr('/tasks', {
    method: 'POST',
    body: {
      project: item.project_guess,
      description: buildBrief(item, transcript),
      engine: process.env.TASK_ENGINE || 'claude-code',
      priority: 'normal',
    },
  })
  await pgr(`board_items?id=eq.${item.id}`, {
    method: 'PATCH',
    body: { status: 'queued', task_id: task.id, task_error: null, updated_at: new Date().toISOString() },
  })
  publish('dispatched')
  return task
}

const STATUS_MAP = {
  queued: 'building', running: 'building',
  pushed: 'review_pr', failed: 'failed', cleaned: 'done',
}

// poll all in-flight board items; notify once on terminal states
export async function pollTasks() {
  const items = await pgr(`board_items?status=in.(queued,building)&task_id=not.is.null&select=id,task_id,title,project_guess,status,notified_at`)
  for (const item of items) {
    let task
    try { task = await tr(`/tasks/${item.task_id}`) } catch (e) {
      if (/404|-> 404/.test(e.message)) {
        await pgr(`board_items?id=eq.${item.id}`, { method: 'PATCH', body: { status: 'failed', task_error: 'task vanished from taskrunner' } })
      }
      continue
    }
    const mapped = STATUS_MAP[task.status] || 'building'
    if (mapped === item.status && task.status !== 'pushed') continue
    const patch = { status: mapped, updated_at: new Date().toISOString() }
    if (task.pr_url) patch.pr_url = task.pr_url
    if (task.ci_status) patch.ci_status = task.ci_status
    if (task.error) patch.task_error = String(task.error).slice(0, 1000)
    await pgr(`board_items?id=eq.${item.id}`, { method: 'PATCH', body: patch })
    publish('task')
    if (['review_pr', 'done', 'failed'].includes(mapped) && !item.notified_at) {
      const ok = mapped !== 'failed'
      notify({
        title: ok ? `✅ built: ${item.title}` : `❌ build failed: ${item.title}`,
        body: `${item.project_guess || '?'}${task.pr_url ? `\n${task.pr_url}` : ''}${task.error ? `\n${String(task.error).slice(0, 250)}` : ''}`,
        priority: ok ? 'default' : 'high',
        tags: [ok ? 'white_check_mark' : 'warning'],
        click: task.pr_url || undefined,
      }).catch(() => {})
      await pgr(`board_items?id=eq.${item.id}`, { method: 'PATCH', body: { notified_at: new Date().toISOString() } })
    }
  }
  return items.length
}
