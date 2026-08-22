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
  parts.push('## If you need a human decision')
  parts.push('If you genuinely cannot proceed without one, create QUESTION.md at the repo root containing ONLY the question (one paragraph), commit it on your branch, and finish normally. The question will be relayed to the owner.', '')
  if (transcript) parts.push('---', `Source: voice capture. Transcript excerpt:`, transcript.slice(0, 1500))
  return parts.join('\n')
}

// QUESTION.md protocol: agents that need a decision commit QUESTION.md on the PR branch
async function checkForQuestion(item, task) {
  try {
    const gh = { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'User-Agent': 'voiceboard', Accept: 'application/vnd.github+json' }
    const prNum = (task.pr_url || '').match(/\/pull\/(\d+)/)?.[1]
    const repo = (item.project_guess || '').includes('/') ? item.project_guess : `asikmydeen/${item.project_guess || ''}`
    if (!prNum || !item.project_guess) return null
    const fr = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNum}/files?per_page=100`, { headers: gh, signal: AbortSignal.timeout(15000) })
    if (!fr.ok) return null
    const files = await fr.json()
    if (!files.some(f => f.filename === 'QUESTION.md')) return null
    const cr = await fetch(`https://raw.githubusercontent.com/${repo}/${task.branch || `pull/${prNum}/head`}/QUESTION.md`, { headers: gh, signal: AbortSignal.timeout(15000) })
    if (!cr.ok) return null
    return (await cr.text()).trim().slice(0, 800)
  } catch { return null }
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
      // did the agent park a question for us on the PR?
      const question = mapped === 'review_pr' ? await checkForQuestion(item, task) : null
      if (question) {
        await pgr(`board_items?id=eq.${item.id}`, {
          method: 'PATCH',
          body: { summary: `❓ NEEDS ANSWER: ${question}\n\n${item.summary || ''}`, updated_at: new Date().toISOString() },
        })
      }
      notify({
        title: question ? `❓ agent asks: ${item.title}` : ok ? `✅ built: ${item.title}` : `❌ build failed: ${item.title}`,
        body: `${question ? `${question}\n—\nAnswer in Telegram: /answer ${item.task_id} <your answer>\n` : ''}${item.project_guess || '?'}${task.pr_url ? `\n${task.pr_url}` : ''}${task.error ? `\n${String(task.error).slice(0, 250)}` : ''}`,
        priority: 'high',
        tags: [question ? 'question' : ok ? 'white_check_mark' : 'warning'],
        click: task.pr_url || undefined,
      }).catch(() => {})
      await pgr(`board_items?id=eq.${item.id}`, { method: 'PATCH', body: { notified_at: new Date().toISOString() } })
    }
  }
  return items.length
}
