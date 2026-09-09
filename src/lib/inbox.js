// Inbox helpers + optional in-memory mock (VOICEBOARD_DEV_MOCK=1)
import { pgr } from './db.js'
import { dispatchItem } from './taskrunner.js'

export const DEV_MOCK = process.env.VOICEBOARD_DEV_MOCK === '1'

function now() {
  return new Date().toISOString()
}

function seed() {
  return [
    {
      id: '11111111-1111-1111-1111-111111111111',
      title: 'Study fourthcross.tech',
      kind: 'task',
      summary: 'Look at the open-source tool list',
      details: 'url: https://fourthcross.tech/',
      status: 'inbox',
      project_guess: '',
      buildable: false,
      tags: ['friday', 'has-url'],
      created_at: now(),
      task_error: null,
      pr_url: null,
      voice_note_id: null,
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      title: 'Remember cortado order',
      kind: 'note',
      summary: 'Asik prefers cortado',
      details: 'memory_id: 33333333-3333-3333-3333-333333333333',
      status: 'inbox',
      project_guess: '',
      buildable: false,
      tags: ['friday', 'in-memory', 'mem:33333333-3333-3333-3333-333333333333'],
      created_at: now(),
      task_error: null,
      pr_url: null,
      voice_note_id: null,
    },
    {
      id: '44444444-4444-4444-4444-444444444444',
      title: 'Fix voiceboard inbox actions',
      kind: 'improvement',
      summary: 'Make the kanban a real review inbox',
      details: '',
      status: 'inbox',
      project_guess: 'voiceboard',
      buildable: true,
      tags: ['friday'],
      created_at: now(),
      task_error: null,
      pr_url: null,
      voice_note_id: null,
    },
    {
      id: '55555555-5555-5555-5555-555555555555',
      title: 'Shipped reliability notes',
      kind: 'task',
      summary: 'Already landed',
      details: '',
      status: 'done',
      project_guess: 'friday',
      buildable: false,
      tags: ['friday'],
      created_at: now(),
      task_error: null,
      pr_url: null,
      voice_note_id: null,
    },
  ]
}

const mock = {
  items: seed(),
  memories: [
    {
      id: '33333333-3333-3333-3333-333333333333',
      title: 'Remember cortado order',
      content: 'Asik prefers cortado',
      tags: ['friday', 'jarvis'],
    },
  ],
}

export function itemUrl(item) {
  const blob = `${item?.details || ''}\n${item?.summary || ''}\n${item?.title || ''}`
  const m = String(blob).match(/https?:\/\/[^\s)>"']+/i)
  return m ? m[0] : ''
}

export function memoryIdOf(item) {
  const tag = (item?.tags || []).find((t) => String(t).startsWith('mem:'))
  if (tag) return String(tag).slice(4)
  const m = String(item?.details || '').match(/memory_id:\s*([0-9a-f-]{36})/i)
  return m ? m[1] : ''
}

export async function itemsFor(statuses) {
  if (DEV_MOCK) return mock.items.filter((i) => statuses.includes(i.status))
  return pgr(`board_items?status=in.(${statuses.join(',')})&order=created_at.desc&limit=60&select=*`)
}

export async function getItem(id) {
  if (DEV_MOCK) return mock.items.find((i) => i.id === id) || null
  const [item] = await pgr(`board_items?id=eq.${id}&select=*`)
  return item || null
}

export async function patchItem(id, body) {
  if (DEV_MOCK) {
    const item = mock.items.find((i) => i.id === id)
    if (!item) return null
    Object.assign(item, body)
    return item
  }
  await pgr(`board_items?id=eq.${id}`, { method: 'PATCH', body })
  return getItem(id)
}

export async function addQuick(title) {
  const row = {
    title: title.slice(0, 200),
    kind: 'task',
    buildable: false,
    summary: '(typed quick-add)',
    details: '',
    status: 'inbox',
    tags: ['friday'],
    project_guess: '',
    created_at: now(),
    id: crypto.randomUUID(),
  }
  if (DEV_MOCK) {
    mock.items.unshift(row)
    return row
  }
  await pgr('board_items', { method: 'POST', body: [{ title: row.title, kind: 'task', buildable: false, summary: row.summary }] })
  return row
}

export async function persistMemory(item) {
  const content = String(item.summary || item.details || item.title || '').slice(0, 4000)
  const title = String(item.title || 'Untitled').slice(0, 200)
  const category = item.kind === 'note' ? 'general' : 'work'
  if (DEV_MOCK) {
    const id = crypto.randomUUID()
    mock.memories.push({ id, title, content, tags: ['friday', 'jarvis', 'voiceboard'] })
    return id
  }
  const rows = await pgr('memories', {
    method: 'POST',
    prefer: 'return=representation',
    body: [{
      content,
      title,
      tags: ['friday', 'jarvis', 'voiceboard'],
      category,
      pinned: false,
    }],
  })
  return rows?.[0]?.id || ''
}

export async function deleteMemory(id) {
  if (!id) return false
  if (DEV_MOCK) {
    const n = mock.memories.length
    mock.memories = mock.memories.filter((m) => m.id !== id)
    return mock.memories.length < n
  }
  await pgr(`memories?id=eq.${id}`, { method: 'DELETE' })
  return true
}

export function stampMemory(item, memoryId) {
  const tags = (item.tags || []).filter((t) => !String(t).startsWith('mem:') && t !== 'in-memory')
  tags.push('in-memory', `mem:${memoryId}`)
  let details = String(item.details || '')
  details = details.replace(/memory_id:\s*[0-9a-f-]{36}/ig, '').trim()
  details = (`memory_id: ${memoryId}\n${details}`).trim()
  return { tags, details, updated_at: now() }
}

export function unstampMemory(item) {
  const tags = (item.tags || []).filter((t) => !String(t).startsWith('mem:') && t !== 'in-memory')
  const details = String(item.details || '').replace(/memory_id:\s*[0-9a-f-]{36}\n?/ig, '').trim()
  return { tags, details, updated_at: now() }
}

export async function convertToWork(item) {
  const project = (item.project_guess || 'friday').trim()
  const patched = await patchItem(item.id, {
    kind: item.kind === 'note' ? 'task' : item.kind,
    buildable: true,
    project_guess: project,
    status: 'inbox',
    updated_at: now(),
  })
  if (DEV_MOCK) {
    return patchItem(item.id, { status: 'queued', task_id: 'task_mock', updated_at: now() })
  }
  await dispatchItem(patched || { ...item, project_guess: project, buildable: true }, '')
  return getItem(item.id)
}
