import {itemUrl,memoryIdOf} from './lib/inbox.js'
import {escapeHtml as esc, navigation, workspaceEnd, workspaceCSS, commonScript} from './workspace-ui.js'
import {boardClient} from './board-client.js'
const KIND_ICON={}
function formAct(action, label, cls = 'mini', confirmMsg = '') {
  const on = confirmMsg
    ? ` onsubmit="return confirm('${String(confirmMsg).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')"`
    : ''
  return `<form method="post" action="${esc(action)}"${on}><button class="${cls}" type="submit">${esc(label)}</button></form>`
}

export function actionsHtml(item) {
  const url = itemUrl(item)
  const mid = memoryIdOf(item)
  const id = item.id
  const rows = []
  if (item.kind !== 'task' && ['inbox', 'failed'].includes(item.status)) {
    rows.push(formAct(`/items/${id}/to-task`, 'Convert to task', 'go'))
  }
  if (!mid) rows.push(formAct(`/items/${id}/remember`, 'Persist to memory', 'go'))
  else rows.push(formAct(`/items/${id}/forget`, 'Remove from memory', 'danger', 'Delete this from Friday memory? This cannot be undone.'))
  if (['inbox', 'failed'].includes(item.status)) {
    rows.push(formAct(`/items/${id}/to-work`, 'Convert to coder work', 'go', 'Mark buildable and send to Taskrunner?'))
  }
  if (item.status === 'inbox' && item.buildable && item.project_guess) {
    rows.push(formAct(`/items/${id}/dispatch`, 'Build it', 'go', 'Send to agent?'))
  }
  if (url) rows.push(`<a class="go" href="${esc(url)}" target="_blank" rel="noopener">Open URL</a>`)
  if (item.status === 'review_pr' && /^https?:\/\//i.test(item.pr_url || '')) {
    rows.push(`<a class="go" href="${esc(item.pr_url)}" target="_blank" rel="noopener">Open PR</a>`)
  }
  if (['inbox', 'failed', 'review_pr'].includes(item.status)) {
    rows.push(formAct(`/items/${id}/done`, 'Mark done', 'mini'))
    rows.push(formAct(`/items/${id}/fail`, 'Mark failed', 'mini'))
  }
  if (['inbox', 'failed', 'review_pr', 'done'].includes(item.status)) {
    rows.push(formAct(`/items/${id}/archive`, 'Archive', 'mini'))
  }
  return `<details class="menu"><summary>Actions</summary><div class="menu-list">${rows.join('')}</div></details>`
}

export const COLUMNS = [
  { key: 'inbox', title: '📥 Inbox', statuses: ['inbox'], drop: 'inbox' },
  { key: 'building', title: '🔨 Building', statuses: ['queued', 'building'], drop: 'queued' },
  { key: 'review', title: '👀 Needs review', statuses: ['review_pr'], drop: 'review_pr' },
  { key: 'done', title: '✅ Done', statuses: ['done'], drop: 'done' },
  { key: 'failed', title: '❌ Failed', statuses: ['failed'], drop: 'failed' },
]
export const MOVE_STATUSES = new Set(['inbox', 'queued', 'review_pr', 'done', 'failed'])
const DONE_HIDE_MS = 24 * 60 * 60 * 1000

function doneStamp(item) {
  return Date.parse(item.updated_at || item.created_at || 0) || 0
}

function cardHtml(item) {
  const icon = KIND_ICON[item.kind] || '📝'
  const tags = (item.tags || []).filter(t=>!String(t).startsWith('mem:')).map(t => `<span class="tag">${esc(t)}</span>`).join('')
  const badge = item.project_guess ? `<span class="proj">${esc(item.project_guess)}</span>` : ''
  const url = itemUrl(item)
  return `<div class="card k-${esc(item.kind)}" id="c-${esc(item.id)}" draggable="true" data-id="${esc(item.id)}" data-status="${esc(item.status)}" data-version="${esc(item.updated_at || item.created_at)}">
    <a data-task-link class="title" href="/items/${esc(item.id)}">${esc(item.title)}</a>
    ${item.summary ? `<div class="sum">${esc(item.summary)}</div>` : ''}
    <div class="meta">${badge} ${tags} ${url ? `<span class="tag">link</span>` : ''} <span class="dim">${esc((item.created_at || '').slice(5, 16).replace('T', ' '))}</span></div>
    ${item.task_error ? `<div class="err">${esc(item.task_error.slice(0, 140))}</div>` : ''}
    ${primaryAction(item)}<div class="card-footer"><span class="state">${esc(statusLabel(item.status))}</span><details class="move-menu"><summary>Move to…</summary><form method="post" action="/items/${esc(item.id)}/move" data-move-form><label>Move ${esc(item.title)}<select name="status">${COLUMNS.map(c=>`<option value="${c.drop}" ${c.statuses.includes(item.status)?'selected':''}>${esc(c.title.replace(/^[^A-Za-z]+/,''))}</option>`).join('')}</select></label><button class="secondary" type="submit">Move</button></form></details></div>
  </div>`
}

export function flashHtml(ok) {
  const msg = {
    remembered: 'Saved to Friday memory.',
    forgotten: 'Removed from Friday memory.',
    task: 'Converted to a task.',
    work: 'Queued as coder / Taskrunner work.',
    done: 'Marked done.',
    failed: 'Marked failed.',
    archived: 'Archived.',
  }[ok]
  return msg ? `<div class="flash" role="status">${esc(msg)}</div>` : ''
}


export const statusLabel = status => ({inbox:'Inbox',queued:'Queued',building:'Running',review_pr:'Needs review',done:'Done',failed:'Failed',archived:'Archived'}[status] || status)
function primaryAction(item){
 if(item.status==='review_pr'&&item.pr_url&&/^https?:\/\//i.test(item.pr_url))return `<a class="go card-primary" href="${esc(item.pr_url)}" target="_blank" rel="noopener">Review PR ↗</a>`
 if(item.status==='inbox'&&item.buildable&&item.project_guess)return `<form data-board-action method="post" action="/items/${esc(item.id)}/dispatch"><button class="secondary card-primary">Start work</button></form>`
 return `<a class="card-primary detail-link" data-task-link href="/items/${esc(item.id)}">${item.status==='failed'?'Review issue':item.status==='done'?'View result':'View task'} <span aria-hidden="true">↗</span></a>`
}
export function renderDetail(item){
 const note=item._note||{},url=itemUrl(item),s=statusLabel(item.status)
 const mattermost=String(item.details||'').match(/Mattermost: (https:\/\/mattermost\.asikmydeen\.com\/_redirect\/pl\/[a-z0-9]{26})(?:\s|$)/)?.[1]
 return `<article class="task-detail" data-item="${esc(item.id)}"><div class="eyebrow">${esc(item.kind)}${item.project_guess?' / '+esc(item.project_guess):''}</div><h2>${esc(item.title)}</h2><div class="row"><span class="state">${esc(s)}</span>${item.task_id?'<span class="state">Assigned to coding agent</span>':''}</div><div class="task-primary">${primaryAction(item)}</div>
 ${mattermost?`<p><a href="${esc(mattermost)}" target="_blank" rel="noopener">Open in Mattermost ↗</a></p>`:''}
 ${item.summary?`<p>${esc(item.summary)}</p>`:''}
 <section class="task-progress"><h3>Progress</h3><div class="run-steps">${['Inbox','Queued','Running','Needs review','Done'].map(label=>`<span class="${label===s?'current':''}">${label}</span>`).join('')}</div>${item.status==='failed'?'<p class="local-feedback error">This task needs attention.</p>':''}${item.task_id?`<p class="dialog-note">Task receipt: ${esc(item.task_id)}</p>`:'<p class="dialog-note">No agent task receipt yet.</p>'}</section>
 ${item.details?`<details><summary>Brief and context</summary><pre>${esc(item.details)}</pre></details>`:''}
 ${url?`<p><a href="${esc(url)}" target="_blank" rel="noopener">Open original link ↗</a></p>`:''}
 ${item.task_error?`<section class="issue"><h3>What went wrong</h3><p>${esc(item.task_error)}</p></section>`:''}
 <details class="task-edit"><summary>Edit task</summary><form method="post" action="/items/${esc(item.id)}/edit">
 <label for="task-title">Title</label><input id="task-title" name="title" value="${esc(item.title)}" required maxlength="200">
 <label for="task-kind">Kind</label><select id="task-kind" name="kind">${['idea','app','improvement','task','note'].map(k=>`<option ${item.kind===k?'selected':''}>${k}</option>`).join('')}</select>
 <label for="task-summary">Summary</label><textarea id="task-summary" name="summary" rows="3">${esc(item.summary||'')}</textarea>
 <label for="task-details">Details</label><textarea id="task-details" name="details" rows="5">${esc(item.details||'')}</textarea>
 <label for="task-tags">Tags, separated by commas</label><input id="task-tags" name="tags" value="${esc((item.tags||[]).join(', '))}">
 <label for="task-project">Project repository</label><input id="task-project" name="project_guess" value="${esc(item.project_guess||'')}">
 <label for="task-buildable">Can a coding agent build this?</label><select id="task-buildable" name="buildable"><option value="true" ${item.buildable?'selected':''}>Yes</option><option value="false" ${!item.buildable?'selected':''}>No</option></select><button style="margin-top:18px">Save changes</button></form></details>
 ${actionsHtml(item)}${item._audio_url?`<audio controls src="${esc(item._audio_url)}"></audio>`:''}${note.transcript?`<details><summary>Voice transcript</summary><pre>${esc(note.transcript)}</pre></details>`:''}</article>`
}
export const boardCSS=`
.board-wrap{padding:32px;max-width:1900px;margin:auto}.board-heading{display:flex;justify-content:space-between;gap:20px;align-items:center}.board-heading h1{font-size:30px;letter-spacing:-.035em;margin:0 0 6px}.board-heading p{color:var(--muted);margin:0;font-size:14px}.live-note{color:var(--muted);font-size:12px;display:flex;gap:12px;align-items:center}.quick-add{display:flex;gap:10px;margin:28px 0 20px;max-width:650px}.quick-add input{flex:1;min-width:0}.board-toolbar{display:flex;gap:12px;margin-bottom:24px;align-items:center;flex-wrap:wrap}.board-toolbar label{font-size:14px;color:var(--muted);display:flex;gap:10px;align-items:center}.board-toolbar input{width:230px}.board{display:grid;grid-template-columns:repeat(5,minmax(245px,1fr));gap:16px;overflow-x:auto;align-items:start;padding:4px 0 24px}.col{min-height:180px;background:#151a21;border-radius:14px;padding:12px;border:1px solid #242d39;min-width:0}.col h2{display:flex;justify-content:space-between;gap:10px;align-items:center;font-size:14px;font-weight:600;color:var(--muted);margin:0 0 18px;padding:4px}.col h2>span{font-size:12px}.col[data-drop=review_pr] h2{color:var(--warn)}.card{background:var(--surface);border:1px solid #36404f;border-radius:12px;padding:17px;margin-bottom:12px;cursor:grab;overflow-wrap:anywhere}.card:last-child{margin-bottom:0}.card.dragging{opacity:.45}.card[aria-busy=true]{opacity:.65}.col.drag-over{outline:2px solid var(--accent);background:#263448}.title{font-size:15px;color:var(--text);font-weight:600;text-decoration:none;display:block;line-height:1.5}.sum{font-size:14px;color:var(--muted);margin-top:10px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:14px}.tag,.proj{background:#283345;border-radius:5px;padding:2px 6px;color:var(--muted);font-size:12px}.dim{font-size:12px;color:var(--muted)}.card-footer{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-top:14px;flex-wrap:wrap}.card-footer .state{font-size:12px}.card-primary{display:flex;margin-top:14px;min-height:44px;align-items:center;justify-content:space-between;font-size:14px;text-decoration:none}.card-primary.detail-link{border-top:1px solid var(--line);padding-top:8px}.card form .card-primary{width:100%}.move-menu summary{font-size:12px;cursor:pointer;min-height:44px;display:flex;align-items:center;color:var(--accent)}.move-menu[open]{width:100%}.move-menu form{display:grid;gap:8px}.move-menu label{font-size:12px}.move-menu select{width:100%}.empty{font-size:14px;color:var(--muted);padding:10px 4px}.err{font-size:14px;color:var(--danger);margin-top:12px}.board-message{padding:12px 16px;background:#223a35;border:1px solid #45665d;border-radius:10px;margin:16px 0;color:var(--good);font-size:14px}.board-message.error{background:#392626;border-color:#664848;color:var(--danger)}.flash,.err-banner{padding:12px 16px;margin:18px 30px;border-radius:10px;background:#26394a;color:var(--text);font-size:14px}.err-banner{background:#392626;color:var(--danger)}.task-detail h2{font-size:25px;line-height:1.3;letter-spacing:-.02em;margin-top:0}.task-detail h3{font-size:16px}.task-detail p{overflow-wrap:anywhere}.task-detail pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.7 inherit;color:var(--muted)}.task-detail details{padding:16px 0;border-bottom:1px solid var(--line)}.task-detail summary{cursor:pointer;font-size:14px;min-height:28px}.task-detail form>label{display:block;font-size:14px;margin:16px 0 6px}.task-detail input,.task-detail select{width:100%}.menu-list{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}.task-progress{margin:24px 0;border-top:1px solid var(--line);padding-top:12px}.issue{padding:14px;border-radius:10px;background:#352525;color:var(--danger)}.detail-page{max-width:800px;margin:auto;padding:32px}.detail-page .task-primary .detail-link,.task-detail .task-primary .detail-link{display:none}audio{width:100%;margin:18px 0}
@media(prefers-reduced-motion:no-preference){.card{transition:border-color .15s,box-shadow .15s}.card:hover{border-color:#637898;box-shadow:0 5px 20px #0002}.col{transition:background .15s}}
@media(max-width:760px){.board-wrap{padding:24px 16px}.board-heading{align-items:start}.board-heading h1{font-size:27px}.live-note{flex-direction:column;gap:4px;align-items:end}.board-toolbar{display:grid;grid-template-columns:1fr}.board-toolbar label{justify-content:space-between}.board-toolbar input{width:100%;min-width:0}.board-toolbar select{flex:1}.board{grid-template-columns:1fr;overflow:visible}.col{min-height:0}.quick-add button{padding:10px}.detail-page{padding:24px 16px}.card-footer .move-menu summary{font-size:14px}}
`
export function boardHtml(columns,flash='',extras={}){
 const detail=extras.detail
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${detail?esc(detail.title):'Board'} · Friday</title><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icon.svg"><meta name="theme-color" content="#101318"><style>${boardCSS}${workspaceCSS}</style></head><body>${navigation('/',detail?'Task details':'Board')}${flash}${detail?`<main class="detail-page"><a href="/">← Back to Board</a>${renderDetail(detail)}</main>`:`<main class="board-wrap"><div class="board-heading"><div><div class="eyebrow">From thought to finished</div><h1>Your Board</h1><p>Capture an idea. Follow the work. Review the result.</p></div><div class="live-note"><span id="live-label" role="status">Live updates on</span><button class="secondary" data-refresh-board>Refresh</button></div></div><form class="quick-add" method="post" action="/items"><input name="title" aria-label="New task" placeholder="What needs doing?" required maxlength="200"><button>Add task</button></form><div class="board-toolbar"><label>Find<input id="board-search" type="search" placeholder="Search tasks" aria-label="Search tasks"></label><label>View<select id="board-status"> <option value="all">All stages</option>${COLUMNS.map(c=>`<option value="${c.drop}">${esc(c.title.replace(/^[^A-Za-z]+/,''))}</option>`).join('')}</select></label></div><div id="board-feedback" class="board-message" role="status" aria-live="polite" hidden></div><div class="board" id="board">${COLUMNS.map(col=>{const items=columns[col.title]||[];return `<section class="col" data-drop="${col.drop}" aria-label="${esc(col.title.replace(/^[^A-Za-z]+/,''))}"><h2>${esc(col.title.replace(/^[^A-Za-z]+/,''))}<span>${items.length}${col.key==='done'&&extras.doneHidden?` · <a href="${extras.showOlder?'/':'/?done=all'}">${extras.showOlder?'Hide older':extras.doneHidden+' older'}</a>`:''}</span></h2><p class="empty" ${items.length?'hidden':''}>Nothing here yet.</p>${items.map(cardHtml).join('')}</section>`}).join('')}</div><p class="dialog-note">Moving a card changes its stage. Use Start work to send it to a coding agent.</p></main><dialog class="dialog" id="task-drawer" aria-labelledby="task-panel-title"><div class="dialog-head"><h2 id="task-panel-title">Task details</h2><div class="row"><a id="task-full-page" href="/">Full page</a><button class="secondary" data-task-close aria-label="Close task details">Close</button></div></div><p id="task-feedback" class="board-message" role="status" aria-live="polite" hidden></p><div class="dialog-body" id="task-content"></div></dialog><script>(${boardClient.toString()})();</script>`}${workspaceEnd}${commonScript}</body></html>`
}
