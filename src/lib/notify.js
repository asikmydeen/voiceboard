const NTFY_URL = process.env.NTFY_URL || 'https://ntfy.sh'
const NTFY_TOPIC = process.env.NTFY_TOPIC

export async function notify({ title, body, priority = 'default', tags = [], click }) {
  if (!NTFY_TOPIC) return
  try {
    await fetch(`${NTFY_URL}/${NTFY_TOPIC}`, {
      method: 'POST',
      headers: {
        Title: String(title).slice(0, 200),
        Priority: priority,
        ...(tags.length ? { Tags: tags.join(',') } : {}),
        ...(click ? { Click: click } : {}),
      },
      body: String(body).slice(0, 1500),
    })
  } catch { /* notification failures never break the pipeline */ }
}
