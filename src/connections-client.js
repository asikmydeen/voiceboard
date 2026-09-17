/** Browser helpers for Connections ask threads (conversation_id + history). */
export function connectionsClient() {
  const form = document.querySelector('[data-inline-ask]')
  const thread = document.querySelector('[data-conversation]')
  if (!form || !thread) return

  const agent = thread.dataset.conversation
  const status = document.getElementById('ask-thread-status')
  const feed = document.querySelector('[data-message-feed]')
  const cidInput = form.querySelector('[name="conversation_id"]')
  let conversationId = cidInput?.value || ''
  let posting = false

  function appendBubble(role, content) {
    if (!feed) return
    const el = document.createElement('article')
    el.className = 'run-entry'
    el.innerHTML = `<div class="row"><span class="state ${role === 'user' ? 'ready' : 'done'}">${role === 'user' ? 'You' : 'Advisor'}</span></div><div class="run-result"></div>`
    el.querySelector('.run-result').textContent = content || ''
    feed.append(el)
    feed.scrollTop = feed.scrollHeight
  }

  async function loadHistory(cid) {
    if (!cid || !feed) return
    try {
      const res = await fetch(`/cabinet/${encodeURIComponent(agent)}/conversations/${encodeURIComponent(cid)}`, {cache: 'no-store'})
      if (!res.ok) return
      const data = await res.json()
      feed.replaceChildren()
      for (const m of data.messages || []) {
        if (m.role === 'user' || m.role === 'assistant') appendBubble(m.role, m.content)
      }
    } catch {
      if (status) {
        status.textContent = 'Could not load earlier messages.'
        status.classList.add('error')
      }
    }
  }

  if (conversationId) loadHistory(conversationId)

  form.addEventListener('submit', async (e) => {
    if (!form.hasAttribute('data-thread-ask')) return
    e.preventDefault()
    if (posting) return
    posting = true
    const button = form.querySelector('button[type=submit]')
    const field = form.elements.text
    const deliver = form.elements.deliver?.checked === true
    button.disabled = true
    field.readOnly = true
    const old = button.textContent
    button.textContent = 'Awaiting response…'
    if (status) {
      status.textContent = 'Request submitted…'
      status.classList.remove('error')
    }
    appendBubble('user', field.value)
    try {
      const body = {text: field.value, deliver, wait: true}
      if (conversationId) body.conversation_id = conversationId
      const res = await fetch(`/cabinet/${encodeURIComponent(agent)}/ask-live`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      })
      const result = await res.json()
      if (!res.ok || result.ok === false) throw new Error(result.message || 'Ask failed')
      if (result.conversation_id) {
        conversationId = result.conversation_id
        if (cidInput) cidInput.value = conversationId
        const url = new URL(window.location.href)
        url.searchParams.set('conversation', conversationId)
        history.replaceState({}, '', url)
      }
      appendBubble('assistant', result.reply || '')
      if (status) status.textContent = result.status === 'failed' ? 'Advisor could not finish.' : 'Response received.'
      if (result.status !== 'failed') field.value = ''
    } catch (err) {
      if (status) {
        status.textContent = `${err.message} Your text is preserved.`
        status.classList.add('error')
      }
    } finally {
      posting = false
      field.readOnly = false
      button.disabled = false
      button.textContent = old
      field.focus()
    }
  })

  document.querySelector('[data-new-conversation]')?.addEventListener('click', () => {
    conversationId = ''
    if (cidInput) cidInput.value = ''
    feed?.replaceChildren()
    const url = new URL(window.location.href)
    url.searchParams.delete('conversation')
    history.replaceState({}, '', url)
    if (status) {
      status.textContent = 'New conversation. Send a request to begin.'
      status.classList.remove('error')
    }
  })
}
