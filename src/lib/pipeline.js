// Voice pipeline: uploaded audio -> STT -> GLM extraction -> board item -> Qdrant
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import { pgr, storageDownload, storageDelete, setSyncState } from './db.js'
import { notify } from './notify.js'

const execFileAsync = promisify(execFile)
const FFMPEG = ffmpegInstaller.path

const OPENAI_KEY = process.env.OPENAI_WHISPER_KEY
const OLLAMA_URL = process.env.OLLAMA_URL
const QDRANT_URL = process.env.QDRANT_URL
const GLM_BASE = process.env.ANTHROPIC_BASE_URL || 'https://open.bigmodel.cn/api/anthropic'
const GLM_KEY = process.env.ANTHROPIC_AUTH_TOKEN
const MAX_ATTEMPTS = 3
const UUID_NS = crypto.createHash('sha256').update('voiceboard:qdrant:v1').digest().subarray(0, 16)

const EXTRACT_SYSTEM = `You turn rambling voice transcripts into structured work items.
The speaker is Asik, a solo dev who runs a fleet of small self-hosted apps (Dokploy, Supabase, Qdrant, Termux, Flutter).
Respond with ONE json object and nothing else — no prose, no markdown fence.
Schema:
{"kind":"idea|app|improvement|task|note",
 "title":"<=60 chars, imperative, standalone",
 "summary":"1-2 sentences: what he actually meant (translated, not transcribed)",
 "details":"the concrete buildable specifics he described; preserve named projects, URLs, commands; empty string if none",
 "tags":["<=5 short lowercase tags"],
 "project_guess":"exact GitHub repo name under asikmydeen, or empty string if genuinely new",
 "buildable":true}
Rules: "buildable" is true only if a coding agent could start today from the description alone.
Discard filler, self-corrections, mid-sentence abandonments. If the clip contains SEVERAL distinct
items, pick the dominant one and append " (+N more in transcript)" to the summary.
If the clip is pure noise ("test", "hello", mic rustle), kind="note", buildable=false.`

// repos under asikmydeen, refreshed daily, injected into the extraction prompt
let repoCache = { at: 0, list: '' }
async function repoList() {
  if (Date.now() - repoCache.at < 24 * 3600e3) return repoCache.list
  try {
    const r = await fetch('https://api.github.com/users/asikmydeen/repos?per_page=100&sort=pushed', {
      headers: { 'User-Agent': 'voiceboard', Accept: 'application/vnd.github+json' },
    })
    if (r.ok) {
      const names = (await r.json()).map(x => x.name).filter(n => !n.startsWith('.'))
      repoCache = { at: Date.now(), list: names.join(', ') }
    }
  } catch { /* keep old cache */ }
  return repoCache.list
}

function uuidFromKey(key) {
  const hex = crypto.createHash('sha256').update(key).digest('hex').replace(/[^0-9a-f]/g, '').padEnd(32, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

async function claimNext() {
  // atomic: UPDATE voice_notes SET status='processing' WHERE status='uploaded' ... —
  // Postgres row-lock re-checks the WHERE, so exactly one concurrent caller wins.
  const rows = await pgr(
    `voice_notes?status=eq.uploaded&attempts=lt.${MAX_ATTEMPTS}&order=captured_at.asc&limit=1`,
    { method: 'PATCH', prefer: 'return=representation', body: { status: 'processing' } },
  )
  return rows[0] || null
}

async function opusToWav(buf) {
  const { stdout } = await execFileAsync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error',
    '-i', '-', '-ar', '16000', '-ac', '1', '-f', 'wav', '-',
  ], { input: buf, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' })
  return stdout
}

async function transcribe(note) {
  const buf = await storageDownload(note.audio_path)
  if (process.env.STT_PROVIDER !== 'openai') {
    // GLM ASR (fleet billing) — wants wav/mp3, so convert the Opus first
    const wav = await opusToWav(buf)
    const fd = new FormData()
    fd.append('file', new Blob([wav], { type: 'audio/wav' }), `${note.dedup_key}.wav`)
    fd.append('model', process.env.GLM_ASR_MODEL || 'glm-asr')
    const r = await fetch('https://open.bigmodel.cn/api/paas/v4/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${GLM_KEY}` }, body: fd,
      signal: AbortSignal.timeout(120000),
    })
    if (!r.ok) {
      const retryable = r.status >= 500 || r.status === 429
      throw Object.assign(new Error(`glm-asr ${r.status}: ${(await r.text()).slice(0, 200)}`), { retryable })
    }
    const j = await r.json()
    return String(j.text || '').trim()
  }
  // OpenAI path (gpt-4o-transcribe / whisper-1)
  const fd = new FormData()
  fd.append('file', new Blob([buf], { type: 'audio/opus' }), `${note.dedup_key}.opus`)
  fd.append('model', process.env.STT_MODEL || 'gpt-4o-transcribe')
  fd.append('response_format', 'json')
  fd.append('temperature', '0')
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}` }, body: fd,
  })
  if (!r.ok) {
    const retryable = r.status >= 500 || r.status === 429
    throw Object.assign(new Error(`stt ${r.status}: ${(await r.text()).slice(0, 200)}`), { retryable })
  }
  const { text } = await r.json()
  return (text || '').trim()
}

function parseExtraction(txt) {
  let s = txt.replace(/```(?:json)?/gi, '').trim()
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a >= 0 && b > a) s = s.slice(a, b + 1)
  const d = JSON.parse(s)
  const kinds = ['idea', 'app', 'improvement', 'task', 'note']
  return {
    kind: kinds.includes(d.kind) ? d.kind : 'note',
    title: String(d.title || '').slice(0, 120) || 'Untitled voice note',
    summary: String(d.summary || '').slice(0, 500),
    details: String(d.details || '').slice(0, 4000),
    tags: Array.isArray(d.tags) ? d.tags.slice(0, 5).map(t => String(t).toLowerCase().slice(0, 24)) : [],
    project_guess: String(d.project_guess || '').trim().slice(0, 100),
    buildable: Boolean(d.buildable),
  }
}

async function extract(transcript) {
  const repos = await repoList()
  const sys = repos ? `${EXTRACT_SYSTEM}\nKnown repos (use for project_guess, empty string if none match): ${repos}` : EXTRACT_SYSTEM
  const r = await fetch(`${GLM_BASE.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    signal: AbortSignal.timeout(120000),
    headers: { 'x-api-key': GLM_KEY, Authorization: `Bearer ${GLM_KEY}`, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.GLM_MODEL || 'glm-5.3', max_tokens: 1200, system: sys,
      messages: [{ role: 'user', content: `Transcript:\n"""${transcript.slice(0, 12000)}"""` }],
    }),
  })
  if (!r.ok) throw Object.assign(new Error(`glm ${r.status}: ${(await r.text()).slice(0, 200)}`), { retryable: true })
  const j = await r.json()
  const txt = (j.content || []).map(c => c.text || '').join('')
  try { return parseExtraction(txt) } catch { throw Object.assign(new Error(`glm bad json: ${txt.slice(0, 120)}`), { retryable: true }) }
}

async function embedToBrain(note, transcript, title, boardItemId) {
  try {
    const text = (title ? `${title}\n` : '') + transcript.slice(0, 1500)
    const r = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', input: [text] }),
    })
    if (!r.ok) return
    const { embeddings } = await r.json()
    const vector = embeddings[0]
    await fetch(`${QDRANT_URL}/collections/messages/points?wait=true`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: [{
          id: uuidFromKey(note.dedup_key), vector,
          payload: { type: 'voice', text, title, source: 'voiceboard', board_item_id: boardItemId, msg_time: note.captured_at },
        }],
      }),
    })
  } catch { /* brain search is best-effort, never blocks the board */ }
}

async function failNote(note, errMsg) {
  await pgr(`voice_notes?id=eq.${note.id}`, { method: 'PATCH', body: { status: 'failed', error: errMsg.slice(0, 500) } })
  notify({ title: '🎙 voiceboard: clip failed', body: `${errMsg.slice(0, 200)}`, priority: 'high', tags: ['warning'] }).catch(() => {})
}

async function retryableFail(note, errMsg) {
  const attempts = (note.attempts || 0) + 1
  if (attempts >= MAX_ATTEMPTS) return failNote(note, `${errMsg} (after ${attempts} attempts)`)
  const backoff = 60 * 2 ** attempts
  await pgr(`voice_notes?id=eq.${note.id}`, {
    method: 'PATCH',
    body: { status: 'uploaded', attempts, error: errMsg.slice(0, 500), next_attempt: new Date(Date.now() + backoff * 1000).toISOString() },
  })
}

// one pipeline pass — process a single claimed note end to end
async function processNext() {
  const note = await claimNext()
  if (!note) return false
  if (note.next_attempt && new Date(note.next_attempt) > new Date()) {
    // backoff not elapsed yet — release the claim without consuming an attempt
    await pgr(`voice_notes?id=eq.${note.id}`, { method: 'PATCH', body: { status: 'uploaded' } })
    return false
  }
  try {
    const transcript = await transcribe(note)
    if (!transcript) return failNote(note, 'empty transcript')
    let ex
    try {
      ex = await extract(transcript)
    } catch (e) {
      if (e.retryable) return retryableFail(note, e.message)
      // extraction failed hard: still board the raw transcript so nothing is lost
      ex = { kind: 'note', title: transcript.slice(0, 60), summary: '(extraction failed — raw transcript)', details: '', tags: ['raw'], project_guess: '', buildable: false }
    }
    const [item] = await pgr('board_items?on_conflict=voice_note_id&select=id,title', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: [{
        voice_note_id: note.id, kind: ex.kind, title: ex.title, summary: ex.summary,
        details: ex.details, tags: ex.tags, project_guess: ex.project_guess, buildable: ex.buildable,
      }],
    })
    await pgr(`voice_notes?id=eq.${note.id}`, {
      method: 'PATCH',
      body: { status: 'boarded', transcript, extraction: ex, processed_at: new Date().toISOString(), duration_s: note.audio_bytes ? Math.round(note.audio_bytes * 8 / 32000) : null },
    })
    embedToBrain(note, transcript, ex.title, item?.id).catch(() => {})
    return true
  } catch (e) {
    if (e.fatal) return failNote(note, e.message)
    if (e.retryable) return retryableFail(note, e.message)
    return failNote(note, e.message)
  }
}

// 90-day audio purge — transcripts stay forever, blobs don't
export async function purgeOldAudio() {
  const cutoff = new Date(Date.now() - 90 * 86400e3).toISOString()
  const rows = await pgr(`voice_notes?captured_at=lt.${cutoff}&audio_path=not.is.null&select=id,audio_path`)
  for (const r of rows) {
    await storageDelete(r.audio_path)
    await pgr(`voice_notes?id=eq.${r.id}`, { method: 'PATCH', body: { audio_path: null, purged_at: new Date().toISOString() } })
  }
  if (rows.length) await setSyncState('audio_purge_cursor', new Date().toISOString())
  return rows.length
}

export async function tick() {
  try { return await processNext() } catch (e) { console.error('[tick]', e.message); return false }
}
