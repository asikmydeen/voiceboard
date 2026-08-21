// Supabase PostgREST + Storage helpers (service key — server-side only)
const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_KEY
const BUCKET = 'voice-raw'

function authed(extra = {}) {
  return { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, ...extra }
}

export async function pgr(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: authed({
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    throw new Error(`pgr ${method} ${String(path).slice(0, 80)} -> ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  const txt = await res.text()
  if (!txt) return []
  try { return JSON.parse(txt) } catch { return txt }
}

export async function getSyncState(key) {
  const r = await pgr(`sync_state?key=eq.${encodeURIComponent(key)}&select=value`)
  return r[0]?.value ?? null
}

export async function setSyncState(key, value) {
  await pgr('sync_state', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates',
    body: [{ key, value: String(value) }],
  })
}

// ---------- storage ----------

export async function storageUpload(path, buf, contentType = 'audio/opus') {
  const res = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: authed({ 'Content-Type': contentType, 'x-upsert': 'true' }),
    body: buf,
  })
  // 409 = object already exists — fine: paths are content-derived (dedup keys)
  if (!res.ok && res.status !== 409) throw new Error(`storage upload -> ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

export async function storageDownload(path) {
  const res = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, { headers: authed() })
  if (!res.ok) throw new Error(`storage download -> ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

export async function storageSignUrl(path, expiresIn = 3600) {
  try {
    const res = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
      method: 'POST',
      headers: authed({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn }),
    })
    if (!res.ok) return null
    const { signedURL } = await res.json()
    return `${SB_URL}/storage/v1${signedURL}`
  } catch { return null }
}

export async function storageDelete(path) {
  try {
    const res = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'DELETE', headers: authed(),
    })
    return res.ok
  } catch { return false }
}
