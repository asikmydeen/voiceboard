// Voice pipeline: uploaded audio -> STT -> GLM extraction -> board item -> Qdrant
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import { pgr, storageDownload, storageDelete, setSyncState } from './db.js'
import { notify } from './notify.js'
import { publish } from './bus.js'

const execFileAsync = promisify(execFile)
const FFMPEG = ffmpegInstaller.path

const OPENAI_KEY = process.env.OPENAI_WHISPER_KEY
const OLLAMA_URL = process.env.OLLAMA_URL
const QDRANT_URL = process.env.QDRANT_URL
const GLM_BASE = process.env.ANTHROPIC_BASE_URL || 'https://open.bigmodel.cn/api/anthropic'
const GLM_KEY = process.env.ANTHROPIC_AUTH_TOKEN
// ASR lives on api.z.ai under its own key/model (bigmodel key lacks ASR credit)
const ASR_BASE = process.env.GLM_ASR_BASE || 'https://api.z.ai/api/paas/v4'
const ASR_KEY = process.env.GLM_ASR_KEY || GLM_KEY
const MAX_ATTEMPTS = 3
const UUID_NS = crypto.createHash('sha256').update('voiceboard:qdrant:v1').digest().subarray(0, 16)

const EXTRACT_SYSTEM = `You turn rambling voice transcripts into structured work items.
The speaker is Asik, a solo dev who runs a fleet of small self-hosted apps (Dokploy, Supabase, Qdrant, Termux, Flutter).
Respond with ONE json object and nothing else — no prose, no markdown fence.
Schema:
{"items":[
 {"kind":"idea|app|improvement|task|note",
  "title":"<=60 chars, imperative, standalone",
  "summary":"1-2 sentences: what he actually meant (translated, not transcribed)",
  "details":"the concrete buildable specifics he described; preserve named projects, URLs, commands; empty string if none",
  "tags":["<=5 short lowercase tags"],
  "project_hint":"the project he is talking about, IN HIS OWN WORDS from the transcript (e.g. 'horizon tv', 'messages hub', 'help hero'), empty string if no project is mentioned",
  "buildable":true}
]}
Rules: one item per DISTINCT idea — a ramble with three ideas yields three items (max 5; drop the weakest).
"buildable" is true only if a coding agent could start today from the description alone.
Discard filler, self-corrections, mid-sentence abandonments.
If the clip is pure noise ("test", "hello", mic rustle), one item with kind="note", buildable=false.`

// repos under asikmydeen, refreshed daily, injected into the extraction prompt
let repoCache = { at: 0, list: '' }
async function repoList() {
  if (Date.now() - repoCache.at < 24 * 3600e3) return repoCache.list
  const owners = ['asikmydeen', 'horizontv-org', 'SynapseLQ', 'aaraa-ai-inc']
  const names = []
  for (const owner of owners) {
    try {
      const headers = { 'User-Agent': 'voiceboard', Accept: 'application/vnd.github+json' }
      if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
      const r = await fetch(`https://api.github.com/users/${owner}/repos?per_page=100&sort=pushed`, { headers, signal: AbortSignal.timeout(15000) })
      if (r.ok) {
        for (const x of await r.json()) {
          if (x.name.startsWith('.')) continue
          names.push(owner === 'asikmydeen' ? x.name : `${owner}/${x.name}`)
        }
      } else console.error(`[repos] ${owner} -> ${r.status}`)
    } catch (e) { console.error(`[repos] ${owner}: ${e.message}`) }
  }
  if (names.length) {
    repoCache = { at: Date.now(), list: names.join(', ') }
    console.log(`[repos] grounded ${names.length} repos across ${owners.length} owners`)
  }
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

async function audioToWav(buf, filename) {
  // ffmpeg can't sniff container format from a pipe — convert via a temp file
  const inPath = path.join(os.tmpdir(), `vb-${Date.now()}-${path.basename(filename || 'a.opus')}`)
  await writeFile(inPath, buf)
  try {
    const { stdout } = await execFileAsync(FFMPEG, [
      '-hide_banner', '-loglevel', 'error',
      '-i', inPath, '-ar', '16000', '-ac', '1', '-f', 'wav', '-',
    ], { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer', timeout: 60000 })
    return stdout
  } finally { unlink(inPath).catch(() => {}) }
}

async function transcribe(note) {
  const buf = await storageDownload(note.audio_path)
  if (process.env.STT_PROVIDER !== 'openai') {
    // GLM ASR (fleet billing) — wants wav/mp3, so convert the Opus first
    const wav = await audioToWav(buf, note.audio_path)
    const fd = new FormData()
    fd.append('file', new Blob([wav], { type: 'audio/wav' }), `${note.dedup_key}.wav`)
    fd.append('model', process.env.GLM_ASR_MODEL || 'glm-asr-2512')
    // vocabulary priming — measurably fewer mangled proper nouns
    const repos = await repoList()
    if (repos) fd.append('prompt', `Projects: ${repos.split(',').slice(0, 30).join(', ')}. Terms: Dokploy, Supabase, Qdrant, Termux, Cloudflare.`)
    const r = await fetch(`${ASR_BASE}/audio/transcriptions`, {
      method: 'POST', headers: { Authorization: `Bearer ${ASR_KEY}` }, body: fd,
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

// deterministic repo matching — the LLM gives a free-text hint ('horizon tv'),
// we resolve it against the known-repo list. LLMs pick badly from long lists.
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
function matchProject(hint, reposCsv) {
  if (!hint || !reposCsv) return ''
  const h = norm(hint)
  if (!h || h.length < 3) return ''
  let best = ''
  for (const entry of reposCsv.split(',')) {
    const e = entry.trim()
    if (!e) continue
    const base = norm(e.includes('/') ? e.split('/')[1] : e)
    if (!base) continue
    // exact always matches; substring matches need the shorter side >= 5 chars
    const shorter = Math.min(base.length, h.length)
    const hit = base === h || (shorter >= 5 && (base.includes(h) || h.includes(base)))
    if (hit && (!best || base.length < norm(best.split('/').pop() || best).length)) best = e
  }
  return best
}

function parseExtraction(txt) {
  let s = txt.replace(/```(?:json)?/gi, '').trim()
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a >= 0 && b > a) s = s.slice(a, b + 1)
  const d = JSON.parse(s)
  const kinds = ['idea', 'app', 'improvement', 'task', 'note']
  const raw = Array.isArray(d.items) && d.items.length ? d.items : [d] // accept both shapes
  return raw.slice(0, 5).map(x => ({
    kind: kinds.includes(x.kind) ? x.kind : 'note',
    title: String(x.title || '').slice(0, 120) || 'Untitled voice note',
    summary: String(x.summary || '').slice(0, 500),
    details: String(x.details || '').slice(0, 4000),
    tags: Array.isArray(x.tags) ? x.tags.slice(0, 5).map(t => String(t).toLowerCase().slice(0, 24)) : [],
    project_hint: String(x.project_hint || '').trim().slice(0, 100),
    buildable: Boolean(x.buildable),
  }))
}

async function extract(transcript) {
  const repos = await repoList()
  const items = await extractRaw(transcript, repos)
  return items.map(ex => {
    // resolve the project deterministically: model hint, then title, then
    // MULTI-WORD tags only — single generic words like 'flutter' or 'agent'
    // match far too many repos
    let resolved = matchProject(ex.project_hint, repos)
    if (!resolved && norm(ex.title).length >= 5) resolved = matchProject(ex.title, repos)
    if (!resolved) {
      resolved = (ex.tags || [])
        .filter(t => (t.match(/ /g) || []).length >= 1 || norm(t).length >= 10)
        .map(t => matchProject(t, repos))
        .find(Boolean) || ''
    }
    const { project_hint, ...rest } = ex
    return { ...rest, project_guess: resolved }
  })
}

// similar-idea detection: embed title+summary, look for near-dupes among existing voice cards
async function similarCheck(ex) {
  try {
    const text = `${ex.title}\n${ex.summary}`
    const r = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', input: [text] }),
      signal: AbortSignal.timeout(15000),
    })
    if (!r.ok) return null
    const { embeddings } = await r.json()
    const q = await fetch(`${QDRANT_URL}/collections/messages/points/search`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vector: embeddings[0], limit: 1, with_payload: true,
        filter: { must: [{ key: 'type', match: { value: 'voice' } }] },
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!q.ok) return null
    const { result } = await q.json()
    const hit = result?.[0]
    if (hit && hit.score >= 0.85) return { score: hit.score, title: hit.payload?.title || 'earlier note' }
    return null
  } catch { return null }
}

// Central model registry (hub-outbox /models): env wins, registry next,
// built-in default last. One env change at the hub bumps the whole fleet.
let _MODEL = process.env.GLM_MODEL || ''
async function glmModel() {
  if (!_MODEL) {
    try {
      const r = await fetch(process.env.HUB_MODELS_URL || 'https://hub-outbox.asikmydeen.com/models',
        { signal: AbortSignal.timeout(3000) })
      _MODEL = (await r.json()).think || 'glm-5.3'
    } catch { _MODEL = 'glm-5.3' }
  }
  return _MODEL
}

async function extractRaw(transcript, repos) {
  const sys = repos ? `${EXTRACT_SYSTEM}\nKnown repos: ${repos}` : EXTRACT_SYSTEM
  const r = await fetch(`${GLM_BASE.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    signal: AbortSignal.timeout(120000),
    headers: { 'x-api-key': GLM_KEY, Authorization: `Bearer ${GLM_KEY}`, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: await glmModel(), max_tokens: 1200, system: sys,
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
  console.log(`[pipe] claimed ${note.dedup_key} (attempt ${note.attempts + 1})`)
  if (note.next_attempt && new Date(note.next_attempt) > new Date()) {
    // backoff not elapsed yet — release the claim without consuming an attempt
    await pgr(`voice_notes?id=eq.${note.id}`, { method: 'PATCH', body: { status: 'uploaded' } })
    return false
  }
  try {
    const t0 = Date.now()
    const transcript = await transcribe(note)
    console.log(`[pipe] stt done ${note.dedup_key} in ${Date.now() - t0}ms: ${transcript.slice(0, 80)}`)
    if (!transcript) {
      // silence / ambient noise (walk-mode chunks) — discard quietly, not a failure
      await pgr(`voice_notes?id=eq.${note.id}`, { method: 'PATCH', body: { status: 'discarded', processed_at: new Date().toISOString() } })
      console.log(`[pipe] discarded ${note.dedup_key} (no speech)`)
      return true
    }
    // append mode: merge this clip's content into an existing card, no new card
    if (note.append_to) {
      const [ex] = await extract(transcript).catch(() => [{ summary: transcript.slice(0, 300), details: transcript, tags: [] }])
      const [target] = await pgr(`board_items?id=eq.${note.append_to}&select=details,tags,summary,title`)
      if (!target) return failNote(note, `append target ${note.append_to} not found`)
      await pgr(`board_items?id=eq.${note.append_to}`, {
        method: 'PATCH',
        body: {
          details: `${target.details || ''}\n\n--- appended ${new Date().toISOString().slice(0, 10)}:\n${ex.details || ex.summary}`,
          summary: ex.summary || target.summary,
          tags: [...new Set([...(target.tags || []), ...(ex.tags || [])])].slice(0, 8),
          updated_at: new Date().toISOString(),
        },
      })
      await pgr(`voice_notes?id=eq.${note.id}`, {
        method: 'PATCH',
        body: { status: 'boarded', transcript, extraction: { ...ex, appended_to: note.append_to }, processed_at: new Date().toISOString() },
      })
      publish('boarded')
      console.log(`[pipe] appended ${note.dedup_key} -> card ${note.append_to.slice(0, 8)}: ${(ex.summary || '').slice(0, 50)}`)
      return true
    }
    let exs
    try {
      exs = await extract(transcript)
    } catch (e) {
      if (e.retryable) return retryableFail(note, e.message)
      // extraction failed hard: still board the raw transcript so nothing is lost
      exs = [{ kind: 'note', title: transcript.slice(0, 60), summary: '(extraction failed — raw transcript)', details: '', tags: ['raw'], project_guess: '', buildable: false }]
    }
    let firstItemId = null
    for (let i = 0; i < exs.length; i++) {
      const ex = exs[i]
      // near-dupe? flag instead of silently duplicating
      const dupe = await similarCheck(ex)
      if (dupe) {
        ex.summary = `${ex.summary}\n⚠ possibly said before (similar to: "${dupe.title}", score ${dupe.score.toFixed(2)})`
        ex.tags = [...new Set([...ex.tags, 'dupe-check'])]
      }
      const itemId = uuidFromKey(`${note.dedup_key}:${i}`)
      const [item] = await pgr('board_items?on_conflict=id&select=id,title', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=representation',
        body: [{
          id: itemId,
          voice_note_id: note.id, kind: ex.kind, title: ex.title, summary: ex.summary,
          details: ex.details, tags: ex.tags, project_guess: ex.project_guess, buildable: ex.buildable,
        }],
      })
      if (i === 0) firstItemId = item?.id || itemId
      console.log(`[pipe] boarded ${note.dedup_key}[${i}] -> ${ex.kind}/${ex.title.slice(0, 50)}${dupe ? ' (dupe?)' : ''}`)
    }
    await pgr(`voice_notes?id=eq.${note.id}`, {
      method: 'PATCH',
      body: { status: 'boarded', transcript, extraction: exs.length === 1 ? exs[0] : exs, processed_at: new Date().toISOString(), duration_s: note.audio_bytes ? Math.round(note.audio_bytes * 8 / 32000) : null },
    })
    publish('boarded')
    embedToBrain(note, transcript, exs[0].title, firstItemId).catch(() => {})
    return true
  } catch (e) {
    console.error(`[pipe] FAIL ${note.dedup_key}: ${e.message}`)
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
