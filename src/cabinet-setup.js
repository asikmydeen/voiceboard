// A single setup workspace, shared by global and per-advisor entry points.
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))
const date = n => n ? new Date(n * 1000).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}) : ''
const statusName = {answered:'Answered',later:'Later',not_applicable:'Not applicable',on_request:'Only when I ask',removed:'Not set'}
const json = v => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

export const setupCSS = `
.setup{max-width:1180px;margin:auto;padding:24px 20px 80px;color:#e8ecf1;font-size:16px;line-height:1.55}
.setup *{box-sizing:border-box}.setup h2{font-size:28px;margin:0}.setup h3{font-size:19px;margin:0}.setup p{margin:6px 0 16px}
.setup .subtle{color:#aab8c9;font-size:14px}.setup a{color:#94c9ff}.setup button,.setup input,.setup select,.setup textarea{font:inherit}
.setup button{min-height:44px;padding:9px 14px;border-radius:8px;border:1px solid #46556b;background:#243249;color:#eef5ff;cursor:pointer}
.setup button.primary{background:#366be8;border-color:#588afa}.setup button[disabled]{opacity:.6;cursor:wait}.setup button:hover{border-color:#a9c8ff}
.setup input,.setup select,.setup textarea{width:100%;padding:10px 12px;border:1px solid #53647a;border-radius:8px;background:#101722;color:#f0f5fc;min-height:46px}
.setup input[type=checkbox]{width:20px;min-height:20px;accent-color:#6995ff}.setup textarea{resize:vertical;min-height:100px}
.setup :focus-visible{outline:3px solid #a8ccff;outline-offset:3px}.setup [hidden]{display:none!important}
.setup .topline{display:flex;justify-content:space-between;gap:24px;align-items:start}.setup .progress{min-width:200px;border-left:3px solid #6fa1ff;padding-left:18px}
.setup .progress strong{display:block;font-size:22px}.setup .toolbar{position:sticky;top:0;z-index:3;background:#0e1116;padding:16px 0;border-bottom:1px solid #354256;margin:14px 0 24px}
.setup .filters{display:grid;grid-template-columns:2fr 1fr 1fr;gap:14px}.setup label{display:block;font-size:14px;font-weight:600;margin-bottom:6px}.setup .filters label{color:#becbdd}
.setup .actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.setup .outcomes{display:flex;gap:8px;overflow:auto;padding:8px 0 16px}.setup .outcomes button{white-space:nowrap;font-size:14px}
.setup [aria-pressed=true]{background:#284b83;border-color:#8cb7ff}.setup .layout{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:28px;align-items:start}
.setup .rail{position:sticky;top:194px}.setup .rail section{border-top:1px solid #354256;padding:16px 0}.setup .rail h3{font-size:16px}.setup .rail p{font-size:14px;color:#aab8c9}
.setup .advisor{border:1px solid #3d4c61;border-radius:12px;margin-bottom:18px;background:#151e2a;overflow:hidden}.setup .advisor>summary{padding:20px;cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:12px;align-items:center}.setup .advisor>summary::after{content:'⌄';font-size:24px;color:#a8c4ed}.setup .advisor[open]>summary{border-bottom:1px solid #344154}.setup .advisor>summary:focus-visible{outline-offset:-4px}
.setup .badge{display:inline-block;border:1px solid #4c627e;border-radius:5px;padding:2px 8px;font-size:12px;color:#c5dbfa}.setup .advisor-body{padding:0 20px 20px}
.setup .question{padding:24px 0;border-bottom:1px solid #344154;scroll-margin-top:200px}.setup .question:last-child{border-bottom:0}.setup .question-title{font-size:17px;line-height:1.45;margin:0 0 6px}.setup .value{white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0;padding:12px 14px;border-left:3px solid #74b7aa;background:#101923;border-radius:3px}
.setup .meta{display:flex;gap:8px;flex-wrap:wrap;font-size:12px;color:#b1c0d3}.setup .help{margin:10px 0;font-size:14px;color:#bbc9dc}.setup .help summary{cursor:pointer;color:#9fc8ff}
.setup .suggestion{background:#1a2b3b;border:1px solid #40617b;border-radius:8px;padding:12px;margin:12px 0;font-size:14px}.setup .suggestion blockquote{margin:4px 0;white-space:pre-wrap;overflow-wrap:anywhere}
.setup .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}.setup .checks{display:flex;flex-wrap:wrap;gap:10px}.setup .checks label{display:flex;align-items:center;gap:8px;font-weight:400;border:1px solid #46556b;padding:8px;border-radius:7px}
.setup .field-help{font-size:12px;color:#b1c0d3;margin:4px 0 12px}.setup .feedback{font-size:14px;margin-top:10px;min-height:22px;overflow-wrap:anywhere}.setup .feedback.error{color:#ffb9b1}.setup .feedback.success{color:#92ddc7}.setup .warning{color:#ffdb9b;border-left:3px solid #e5af50;padding-left:10px;margin:10px 0;font-size:14px}
.setup .record-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;border-bottom:1px solid #46556b;padding:12px 0;margin-bottom:12px;align-items:end}.setup fieldset{border:1px solid #46556b;border-radius:8px;padding:12px;min-width:0}.setup .editor{margin-top:14px}.setup .advanced{margin-top:14px}.setup .advanced summary{cursor:pointer;font-size:14px;color:#bdd4f6}.setup .history-item{font-size:14px;border-top:1px solid #46556b;padding:12px 0}.setup .history-item pre{white-space:pre-wrap;font:inherit;overflow-wrap:anywhere}.setup .preview-result{white-space:pre-wrap;padding:14px;border:1px solid #46607d;border-radius:8px;margin-top:12px;font-size:14px;overflow-wrap:anywhere}
.setup .empty{padding:32px 20px;border:1px dashed #526581;border-radius:12px}.setup .statusline{display:flex;justify-content:space-between;gap:12px;margin:12px 0;font-size:14px}.setup .notice{background:#292a1d;border:1px solid #777144;padding:14px;border-radius:8px;margin:12px 0}
@media(max-width:800px){.setup .layout{grid-template-columns:1fr}.setup .rail{position:static;order:-1}.setup .rail section:first-child{display:flex;gap:12px;align-items:center;justify-content:space-between}.setup .rail section:first-child p{display:none}.setup .rail section:not(:first-child){display:none}.setup .topline{display:block}.setup .progress{margin-top:16px}.setup .filters{grid-template-columns:1fr 1fr}.setup .search-field{grid-column:1/-1}.setup .toolbar{position:static}.setup .form-grid{grid-template-columns:1fr}.setup .question{scroll-margin-top:16px}.setup .advisor>summary{padding:16px}.setup .advisor-body{padding:0 16px 16px}}
@media(prefers-reduced-motion:no-preference){.setup button{transition:background .12s,border-color .12s}}
`

function displayValue(q,value){
 if(q.kind!=='records')return value
 try{return JSON.parse(value).map(row=>q.fields.map(f=>`${f.label}: ${row[f.key]||'—'}`).join(' · ')).join('\n')}catch{return value}
}
function recordRow(q,row={},index=0){
 return `<div data-record-row class="record-row">${q.fields.map(f=>`<label>${esc(f.label)}${f.type==='weekday'?`<select data-field="${f.key}"><option value="">Choose a day</option>${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(d=>`<option ${row[f.key]===d?'selected':''}>${d}</option>`).join('')}</select>`:`<input data-field="${f.key}" type="${['date','time'].includes(f.type)?f.type:['number','day_number'].includes(f.type)?'number':'text'}" ${f.type==='day_number'?'min="1" max="31" step="1"':f.type==='number'?'min="0" step="any"':''} value="${esc(row[f.key]||'')}" maxlength="1000">`}</label>`).join('')}<button type="button" data-action="remove-row" aria-label="Remove row ${index+1}">Remove row</button></div>`
}
function input(q,value){
 const id=`answer-${q.agent}-${q.key}`
 if(q.kind==='records'){let rows=[];try{rows=JSON.parse(value)}catch{};return `<fieldset data-records aria-labelledby="label-${q.agent}-${q.key}"><legend class="field-help">One item per row</legend><div data-record-list>${(Array.isArray(rows)&&rows.length?rows:[{}]).map((r,i)=>recordRow(q,r,i)).join('')}</div><button type="button" data-action="add-row">Add another row</button></fieldset>`}
 if(['multi','days'].includes(q.kind)){
  const opts=q.kind==='days'?['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']:q.options
  return `<fieldset class="checks" data-value-group><legend class="field-help">Choose all that apply</legend>${opts.map(o=>`<label><input type="checkbox" name="choice" value="${esc(o)}" ${value.split('\n').includes(o)?'checked':''}>${esc(o)}</label>`).join('')}</fieldset>`
 }
 if(q.kind==='select')return `<select id="${id}" name="value"><option value="">Choose an answer</option>${q.options.map(o=>`<option ${value===o?'selected':''} value="${esc(o)}">${esc(o)}</option>`).join('')}</select>`
 if(['textarea','list','ranges'].includes(q.kind))return `<textarea id="${id}" name="value" maxlength="8000" rows="${q.kind==='textarea'?4:3}">${esc(value)}</textarea>`
 return `<input id="${id}" name="value" type="${['money','number'].includes(q.kind)?'number':'text'}" ${['money','number'].includes(q.kind)?'min="0" step="any"':''} maxlength="8000" value="${esc(value)}" ${q.kind==='airport'?'pattern="[A-Za-z]{3}"':''}>`
}

function card(q){
 const a=q.answer, answered=a?.status==='answered', isClosed=a && !['removed'].includes(a.status) && !q.due
 const v=q.draft?.value??(answered?a.value:'')
 const id=`${q.agent}:${q.key}`, scope=q.draft?.metadata?.scope||a?.scope||(q.agent==='shared'?'owner':'advisor')
 return `<article class="question" id="q-${q.agent}-${q.key}" data-id="${id}" data-agent="${q.agent}" data-key="${q.key}" data-pending="${!isClosed}" data-search="${esc([q.question,q.name,a?.value].join(' ').toLowerCase())}">
 <h4 class="question-title" id="label-${q.agent}-${q.key}">${esc(q.question)}</h4><div class="meta"><span>${esc(a?statusName[a.status]:'Not set')}</span>${q.inherited?'<span>Using shared preference</span>':''}${q.due?'<span>Review due</span>':''}${a?.updated?`<span>Updated ${date(a.updated)}</span>`:''}${q.draft?'<span>Draft available</span>':''}</div>
 <p class="help">${esc(q.effect)}</p>
 ${answered?`<div class="value">${esc(displayValue(q,a.value))}</div><div class="meta">${esc(a.source)} · ${esc(a.scope==='advisor'?'This advisor only':a.scope==='family_safe'?'Family-safe':'Owner Cabinet')} ${a.review_at?`· Review ${date(a.review_at)}`:''}</div>`:''}
 ${q.sync?.state==='pending'?`<div class="warning">Your current answer is saved. Older memory copies still need reconciliation; their former visibility may persist until this finishes. <button type="button" data-action="sync" data-agent="${q.agent}">Retry reconciliation</button></div>`:''}
 ${q.conflict?`<div class="warning">This advisor overrides the shared preference: “${esc(q.shared_answer.value)}”. <button type="button" data-action="inherit">Use shared preference</button></div>`:''}
 <details class="help"><summary>Why this matters and who uses it</summary><p>${esc(q.why)}</p><p>${q.shared?'A shared preference can answer this question; an advisor answer overrides it.':'This answer guides this advisor’s work.'} Saving preferences does not grant access to devices, accounts, or recipients.</p></details>
 ${isClosed&&!q.draft?'<button type="button" data-action="edit">Edit answer or decision</button>':''}
 <form class="editor" data-source="${esc(q.draft?.metadata?.source||'')}" ${isClosed&&!q.draft?'hidden':''}>
 ${q.kind!=='records'?`<label for="answer-${q.agent}-${q.key}">Your answer${q.kind==='money'?' (USD per month)':''}</label>`:''}${input(q,v)}
 <div class="field-help">${q.kind==='ranges'?'One range per line, in 24-hour time. Overnight ranges are supported.':q.kind==='list'?'One item per line.':q.kind==='timezone'?'For example America/Los_Angeles.':'Up to 8,000 characters. Drafts stay private until saved.'}</div>
 <div class="suggestions">${!answered&&q.default?`<div class="suggestion"><strong>Suggested answer</strong><blockquote>${esc(q.default)}</blockquote><button type="button" data-action="default">Use suggestion in draft</button></div>`:''}${q.suggestions.map((s,i)=>`<div class="suggestion"><strong>Previous answer · ${date(s.date)}</strong><blockquote>${esc(s.value)}</blockquote><p class="subtle">${esc(s.source)}</p><button type="button" data-action="legacy" data-index="${i}">Review in draft</button></div>`).join('')}</div>
 <div class="form-grid"><div><label>Who may use this answer?<select name="scope">${q.agent!=='shared'?`<option value="advisor" ${scope==='advisor'?'selected':''}>This advisor only</option>`:''}<option value="owner" ${scope==='owner'?'selected':''}>Friday and my owner Cabinet</option><option value="family_safe" ${scope==='family_safe'?'selected':''}>Family-safe information</option></select></label></div><div><label>Review again on<input name="review_date" type="date" value="${esc(q.draft?.metadata?.review_date||'')}" min="${new Date(Date.now()+86400000).toISOString().slice(0,10)}"></label></div></div>
 <p class="field-help">Family-safe answers may be used in family conversations. Keep finances, private documents, and information about other people advisor-only.</p>
 <div class="actions"><button class="primary" type="submit">Save answer</button><button type="button" data-action="draft">Save draft</button><button type="button" data-action="suggest">Check what Friday knows</button></div>
 ${q.attachment?`<div class="advanced"><label>Attach a schedule, photo, or document<input type="file" name="document" accept="image/*,.pdf,.txt,.csv,.docx"></label><button type="button" data-action="document">Extract for review</button><p class="field-help">Review extracted details before saving. Uploading here does not give the document to an advisor.</p></div>`:''}
 <details class="advanced"><summary>Other decisions</summary><div class="actions"><button type="button" data-action="later">Later (one week)</button><button type="button" data-action="not_applicable">Not applicable</button><button type="button" data-action="on_request">Only when I ask</button>${a?'<button type="button" data-action="removed">Remove answer</button>':''}</div></details>
 </form>
 <div class="feedback" role="status" aria-live="polite"></div>
 ${q.history_count?'<details class="advanced"><summary data-action="history">Answer history and undo</summary><div class="history"></div></details>':''}
 </article>`
}

export function renderSetup(data, params={}){
 const agents=data.agents
 const total=agents.filter(a=>a.active).reduce((n,a)=>n+a.total,0)
 const pending=agents.filter(a=>a.active).reduce((n,a)=>n+a.pending,0)
 return `<main class="setup" id="setup"><div class="topline"><div><h2>Teach your Cabinet</h2><p class="subtle">Set what matters, review what each advisor understands, and try an example.</p></div><div class="progress"><strong>${total-pending} of ${total} decisions set</strong><span class="subtle">Across active advisors and shared preferences</span></div></div>
 <div id="setup-receipt" role="status" class="notice" hidden></div>
 <div class="outcomes" aria-label="Choose an outcome"><button data-outcome="" aria-pressed="true">Everything</button>${data.outcomes.map(o=>`<button data-outcome="${o.id}" aria-pressed="false">${esc(o.label)}</button>`).join('')}</div>
 <div class="toolbar"><div class="filters"><div class="search-field"><label for="setup-search">Find a question or saved answer</label><input id="setup-search" type="search" placeholder="Search your Cabinet"></div><div><label for="setup-agent">Advisor</label><select id="setup-agent"><option value="">Every advisor</option>${agents.map(a=>`<option value="${a.id}" ${params.agent===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select></div><div><label for="setup-status">Show</label><select id="setup-status"><option value="left">Needs attention</option><option value="done">Decisions made</option><option value="all">All questions</option><option value="review">Review due</option><option value="conflicts">Overrides to review</option></select></div></div>
 <div class="statusline"><label class="actions"><input type="checkbox" id="include-paused"> Include paused advisors</label><span id="shown-count" role="status"></span></div></div>
 <div class="layout"><div class="questions"><div class="notice" id="session-notice" hidden><span id="session-progress"></span> <button data-action="end-session">Show all questions</button></div>
 ${agents.map(a=>`<details class="advisor" data-advisor="${a.id}" ${a.id==='shared'||params.agent===a.id?'open':''}><summary><div><h3>${esc(a.name)}</h3><span class="subtle">${esc(a.title)}</span><div><span class="badge">${esc(a.state)}</span> <span class="subtle">${a.pending} of ${a.total} need attention</span></div></div></summary><div class="advisor-body">${a.items.map(card).join('')}${a.id!=='shared'?`<section class="advanced"><h4>Review what ${esc(a.name)} understands</h4><div class="actions"><button data-action="preview" data-agent="${a.id}">Show current understanding</button><a href="/cabinet/${a.id}/configure">Access and connections</a><a href="/cabinet/${a.id}/onboard">Credentials and documents</a></div><div class="preview-result" data-preview="${a.id}" hidden></div><label for="example-${a.id}" style="margin-top:14px">Try a situation this advisor should handle</label><textarea id="example-${a.id}" maxlength="2000" placeholder="Describe an example you care about"></textarea><button data-action="example" data-agent="${a.id}">Try example without taking action</button><div class="preview-result" data-example="${a.id}" hidden></div><button data-action="accept" data-agent="${a.id}" hidden>This interpretation is right</button><div class="feedback" data-agent-feedback="${a.id}" role="status"></div></section>`:''}</div></details>`).join('')}
 <div class="empty" id="setup-empty" hidden><h3>No questions match this view</h3><p>Try another advisor, include paused advisors, or review your saved decisions.</p><button data-action="reset">Show all questions</button></div></div>
 <aside class="rail"><section><h3>Make a little progress</h3><p>Start with three decisions that unlock useful help. You can return to the rest later.</p><button class="primary" data-action="session">Answer three questions</button><p id="next-reason"></p></section><section><h3>Shared, with exceptions</h3><p>Set protected hours, priorities, and delivery preferences once. An advisor can have an explicit override.</p><button data-action="shared">Review shared preferences</button></section><section><h3>A saved answer has a receipt</h3><p>Advisors read your current answers directly. Drafts and history remain private to this console.</p><p>Verified means you reviewed an example and its checked connections were available. It does not prove a real-world action succeeded.</p></section><section><h3>Preferences and access</h3><p>Device rules and recipient choices guide behavior. Access remains controlled in each advisor’s configuration.</p></section></aside></div>
 <script type="application/json" id="setup-data">${json({...data,params})}</script><script>(${setupClient.toString()})();</script></main>`
}

function setupClient(resume={}){
 const root=document.getElementById('setup'), data=JSON.parse(document.getElementById('setup-data').textContent)
 const items=new Map(data.agents.flatMap(a=>a.items.map(q=>[`${q.agent}:${q.key}`,q])))
 const search=document.getElementById('setup-search'), agent=document.getElementById('setup-agent'), status=document.getElementById('setup-status'), paused=document.getElementById('include-paused')
 status.value=['left','done','all','review','conflicts'].includes(data.params.status)?data.params.status:'left'
 let outcome=resume.outcome||'', session=resume.session||null, completed=resume.completed||0
 const dirty=new Set(), requestIds=new Map(), inflight=new Map(), previews=new Map()
 const msg=(el,text,error=false)=>{el.textContent=text;el.className='feedback '+(error?'error':'success')}
 const value=form=>form.querySelector('[data-records]')?JSON.stringify(Array.from(form.querySelectorAll('[data-record-row]')).map(row=>Object.fromEntries(Array.from(row.querySelectorAll('[data-field]')).map(f=>[f.dataset.field,f.value])))):form.querySelector('[data-value-group]')?Array.from(form.querySelectorAll('[name=choice]:checked')).map(e=>e.value).join('\n'):form.elements.value.value
 function putValue(form,v){if(form.querySelector('[data-records]')){let rows;try{rows=JSON.parse(v)}catch{throw new Error('This older answer is free text. Use it as a reference to fill the rows below.')}if(!Array.isArray(rows))throw new Error('Expected rows.');const list=form.querySelector('[data-record-list]');list.replaceChildren();for(const row of rows)addRow(form,row)}else if(form.querySelector('[data-value-group]')){for(const c of form.querySelectorAll('[name=choice]'))c.checked=v.split('\n').includes(c.value)}else form.elements.value.value=v}
 function addRow(form,record={}){
  const q=items.get(form.closest('.question').dataset.id),list=form.querySelector('[data-record-list]');if(list.children.length>=50)throw new Error('Use at most 50 rows.')
  const row=document.createElement('div');row.className='record-row';row.setAttribute('data-record-row','')
  for(const field of q.fields){const label=document.createElement('label');label.textContent=field.label;const input=document.createElement(field.type==='weekday'?'select':'input');input.dataset.field=field.key
   if(field.type==='weekday'){for(const d of ['','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']){const o=document.createElement('option');o.value=d;o.textContent=d||'Choose a day';input.append(o)}}else{input.type=['date','time'].includes(field.type)?field.type:['number','day_number'].includes(field.type)?'number':'text';input.maxLength=1000;if(field.type==='number'){input.min='0';input.step='any'}if(field.type==='day_number'){input.min='1';input.max='31';input.step='1'}}
   input.value=record[field.key]||'';label.append(input);row.append(label)
  }
  const remove=document.createElement('button');remove.type='button';remove.dataset.action='remove-row';remove.textContent='Remove row';row.append(remove);list.append(row)
 }
 async function api(path, body, method='POST'){
  const r=await fetch('/cabinet/setup/api/'+path,{method,headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:method==='GET'?undefined:body instanceof FormData?body:JSON.stringify(body)})
  let d;try{d=await r.json()}catch{throw new Error('The server could not confirm this request. Your draft is still here.')}
  if(!r.ok||d.ok===false)throw new Error(d.message||'The request failed. Your draft is still here.')
  return d
 }
 function updateFilters(){
  let count=0
  const allowed=outcome?data.outcomes.find(o=>o.id===outcome).agents:null
  for(const box of root.querySelectorAll('.advisor')){
   const a=data.agents.find(a=>a.id===box.dataset.advisor)
   let shown=0
   for(const card of box.querySelectorAll('.question')){
    const q=items.get(card.dataset.id), ans=q.answer, decided=ans&&ans.status!=='removed'&&!q.due
    const visible=(!agent.value||a.id===agent.value)&&(paused.checked||a.active||agent.value===a.id)&&(!allowed||allowed.includes(a.id)||a.id==='shared')&&card.dataset.search.includes(search.value.toLowerCase())&&(status.value==='all'||status.value==='left'&&!decided||status.value==='done'&&decided||status.value==='review'&&q.due||status.value==='conflicts'&&q.conflict)&&(!session||session.includes(card.dataset.id))
    card.hidden=!visible;if(visible){shown++;count++}
   }
   box.hidden=shown===0;if(agent.value||session||search.value)box.open=shown>0
  }
  document.getElementById('setup-empty').hidden=count>0
  document.getElementById('shown-count').textContent=`${count} questions in this view`
  const next=Array.from(items.values()).filter(q=>(!q.answer||q.due)&&data.agents.find(a=>a.id===q.agent).active).sort((a,b)=>a.priority-b.priority)[0]
  document.getElementById('next-reason').textContent=next?`Suggested next: ${next.question} ${next.effect}`:'Your decisions are set. Try an advisor example to check its understanding.'
  const u=new URL(location.href);u.searchParams.set('status',status.value);agent.value?u.searchParams.set('agent',agent.value):u.searchParams.delete('agent');history.replaceState(null,'',u)
 }
 for(const e of [search,agent,status,paused])e.addEventListener('input',()=>{session=null;document.getElementById('session-notice').hidden=true;updateFilters()})
 root.addEventListener('input',e=>{const c=e.target.closest('.question');if(c){dirty.add(c.dataset.id);requestIds.delete(c.dataset.id)}})
 window.onbeforeunload=e=>{if(dirty.size){e.preventDefault();e.returnValue=''}}
 async function draft(card){
  const form=card.querySelector('form'),q=items.get(card.dataset.id)
  const r=await api(`${q.agent}/${q.key}/draft`,{value:value(form),answer_revision:q.revision,draft_version:q.draft?.version||0,metadata:{scope:form.elements.scope.value,review_date:form.elements.review_date.value,source:form.dataset.source||''}});q.draft={...(q.draft||{}),version:r.version};dirty.delete(card.dataset.id)
 }
 async function save(card,decision='answered',extra={}){
  const q=items.get(card.dataset.id), form=card.querySelector('form'), feedback=card.querySelector('.feedback')
  if(inflight.has(card.dataset.id))return
  const payload={value:value(form),status:decision,scope:form.elements.scope.value,revision:q.revision,review_date:form.elements.review_date.value,source:form.dataset.source||'Your answer',...extra}
  const fingerprint=JSON.stringify(payload), cached=requestIds.get(card.dataset.id)
  payload.request_id=cached?.fingerprint===fingerprint?cached.id:crypto.randomUUID();requestIds.set(card.dataset.id,{fingerprint,id:payload.request_id})
  inflight.set(card.dataset.id,true);form.querySelectorAll('button').forEach(b=>b.disabled=true);msg(feedback,'Saving…')
  try{
   const result=await api(`${q.agent}/${q.key}/answer`,payload)
   q.answer=result.answer;q.revision=result.answer.revision;q.due=false;dirty.delete(card.dataset.id)
   let shown=card.querySelector('.value');if(!shown){shown=document.createElement('div');shown.className='value';card.querySelector('.help').before(shown)}
   shown.textContent=result.answer.status==='answered'?result.answer.value:({later:'Deferred for one week',not_applicable:'Not applicable',on_request:'Only when I ask',removed:'Answer removed'}[result.answer.status])
   card.dataset.search=[q.question,q.name,q.answer.value].join(' ').toLowerCase()
   msg(feedback,`${result.message} Receipt ${result.receipt.slice(0,8)}. ${q.effect}`)
   if(session){completed++;document.getElementById('session-progress').textContent=`${completed} of ${session.length} decisions saved. ${completed>=session.length?'Session complete.':''}`}
   inflight.delete(card.dataset.id)
   if(!inflight.size)await refresh(`${result.message} Receipt ${result.receipt.slice(0,8)}.${result.legacy_sync==='pending'?' Older memory copies are being reconciled.':''}`)
  }catch(e){msg(feedback,e.message,true)}finally{inflight.delete(card.dataset.id);form.querySelectorAll('button').forEach(b=>b.disabled=false)}
 }
 async function refresh(receipt){
  const edits={};for(const id of dirty){const c=Array.from(root.querySelectorAll('.question')).find(c=>c.dataset.id===id),f=c.querySelector('form');edits[id]={scope:f.elements.scope.value,review_date:f.elements.review_date.value,source:f.dataset.source||''}}
  await preserveDrafts()
  const r=await fetch(location.href,{headers:{'Accept':'text/html'}});if(!r.ok)throw new Error('Saved, but the refreshed view is unavailable. Reload when ready.')
  const doc=new DOMParser().parseFromString(await r.text(),'text/html'),replacement=doc.getElementById('setup');if(!replacement)throw new Error('Saved. Reload to see updated readiness.')
  const scroll=window.scrollY;replacement.querySelectorAll('script:not([type="application/json"])').forEach(s=>s.remove());root.replaceWith(replacement)
  setupClient({outcome,session,completed,search:search.value,paused:paused.checked,edits,receipt});window.scrollTo(0,scroll)
 }
 async function preserveDrafts(){await Promise.all(Array.from(dirty).map(id=>draft(Array.from(root.querySelectorAll('.question')).find(c=>c.dataset.id===id))))}
 root.addEventListener('submit',e=>{if(e.target.matches('.editor')){e.preventDefault();save(e.target.closest('.question'))}})
 root.addEventListener('click',async e=>{
  const b=e.target.closest('button,[data-action=history]');if(!b)return
  const card=b.closest('.question'), q=card?items.get(card.dataset.id):null, form=card?.querySelector('form'), feedback=card?.querySelector('.feedback')
  if(b.dataset.outcome!==undefined){outcome=b.dataset.outcome;session=null;document.getElementById('session-notice').hidden=true;root.querySelectorAll('[data-outcome]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));updateFilters();return}
  const action=b.dataset.action;if(!action)return
  try{
   if(action==='edit'){form.hidden=false;form.querySelector('input,textarea,select')?.focus()}
   else if(['default','legacy'].includes(action)){putValue(form,action==='default'?q.default:q.suggestions[Number(b.dataset.index)].value);form.dataset.source=action==='default'?'Suggested default, reviewed by you':'Previous setup answer, reviewed by you';dirty.add(card.dataset.id);msg(feedback,'In your draft. Review the answer and visibility, then save.')}
   else if(action==='add-row'){addRow(form);dirty.add(card.dataset.id)}
   else if(action==='remove-row'){b.closest('[data-record-row]').remove();dirty.add(card.dataset.id)}
   else if(action==='draft'){await draft(card);msg(feedback,'Draft saved privately. It will be here when you return.')}
   else if(['later','not_applicable','on_request','removed'].includes(action)){await save(card,action)}
   else if(action==='inherit'){await save(card,'removed')}
   else if(action==='suggest'){
    b.disabled=true;msg(feedback,'Checking existing information…');const r=await api(`${q.agent}/${q.key}/suggest`,{})
    const target=card.querySelector('.suggestions');for(const s of r.suggestions||[]){const box=document.createElement('div');box.className='suggestion';const text=document.createElement('blockquote');text.textContent=s.value;const cite=document.createElement('p');cite.textContent=`${s.source} · ${s.date} · Evidence: ${s.source_quote}`;const use=document.createElement('button');use.type='button';use.textContent='Review in draft';use.onclick=()=>{putValue(form,s.value);form.dataset.source=`Reviewed suggestion: ${s.source} (${s.date})`;dirty.add(card.dataset.id)};box.append(text,cite,use);target.append(box)}msg(feedback,r.message||'Suggestions need your review before saving.')
   }else if(action==='document'){
    const file=form.elements.document.files[0];if(!file)throw new Error('Choose a document or photo first.');if(file.size>15*1024*1024)throw new Error('Choose a file smaller than 15 MB.');b.disabled=true;const body=new FormData();body.append('file',file);msg(feedback,'Extracting details for your review…');const r=await api(`${q.agent}/${q.key}/document`,body);putValue(form,r.text);form.dataset.source=`Reviewed extraction: ${r.filename}`;dirty.add(card.dataset.id);msg(feedback,r.message+(r.truncated?' Only the first 8,000 characters are shown.':''))
   }else if(action==='sync'){b.disabled=true;const r=await api(`${q.agent}/sync`,{});await refresh(r.message)
   }else if(action==='history'){
    const r=await api(`${q.agent}/${q.key}/history`,null,'GET'),target=card.querySelector('.history');target.replaceChildren();for(const h of r){const item=document.createElement('div');item.className='history-item';const label=document.createElement('strong');label.textContent=`Revision ${h.revision} · ${new Date(h.updated*1000).toLocaleString()} · ${h.scope}`;const val=document.createElement('pre');val.textContent=h.value||h.status;const undo=document.createElement('button');undo.textContent='Restore this revision';undo.type='button';undo.onclick=()=>save(card,'removed',{restore_revision:h.revision});item.append(label,val,undo);target.append(item)}
   }else if(action==='preview'){
    b.disabled=true;const target=root.querySelector(`[data-preview="${b.dataset.agent}"]`);target.hidden=false;target.textContent='Loading current understanding…';const r=await api(`${b.dataset.agent}/preview`,null,'GET');target.textContent=r.text||'No setup answers yet.'
   }else if(action==='example'){
    b.disabled=true;const a=b.dataset.agent,target=root.querySelector(`[data-example="${a}"]`);target.hidden=false;target.textContent='Trying your example without taking action…';const r=await api(`${a}/example`,{scenario:document.getElementById(`example-${a}`).value});previews.set(a,r);target.textContent=`${r.interpretation}\n\n${r.kind}\n\nConnection checks:\n${r.checks.map(c=>`${c.name}: ${c.ok?'available':'unavailable or not checked'} — ${c.detail||''}`).join('\n')}`;root.querySelector(`[data-action=accept][data-agent="${a}"]`).hidden=false
   }else if(action==='accept'){
    const a=b.dataset.agent,r=await api(`${a}/accept`,{fingerprint:previews.get(a)?.fingerprint});msg(root.querySelector(`[data-agent-feedback="${a}"]`),r.message)
   }else if(action==='session'){
    const candidates=Array.from(root.querySelectorAll('.question')).filter(c=>!c.hidden).map(c=>items.get(c.dataset.id)).filter(q=>!q.answer||q.due).sort((a,b)=>a.priority-b.priority)
    session=candidates.slice(0,3).map(q=>`${q.agent}:${q.key}`);completed=0;document.getElementById('session-notice').hidden=false;document.getElementById('session-progress').textContent=session.length?`A short session: ${session.length} decisions.`:'No unanswered questions in this view. Try another filter.';updateFilters()
   }else if(action==='end-session'){session=null;document.getElementById('session-notice').hidden=true;updateFilters()}
   else if(action==='shared'){agent.value='shared';status.value='all';session=null;updateFilters();root.scrollIntoView()}
   else if(action==='reset'){agent.value='';status.value='all';search.value='';outcome='';session=null;updateFilters()}
  }catch(err){const f=feedback||root.querySelector(`[data-agent-feedback="${b.dataset.agent}"]`);if(f)msg(f,err.message,true)}finally{b.disabled=false}
 })
 // Navigating away saves drafts on the authenticated server, never in browser storage.
 root.querySelectorAll('a').forEach(a=>a.addEventListener('click',async e=>{if(dirty.size){e.preventDefault();try{await preserveDrafts();location.href=a.href}catch(err){alert(err.message)}}}))
 search.value=resume.search||'';paused.checked=!!resume.paused
 for(const [id,edit] of Object.entries(resume.edits||{})){const c=Array.from(root.querySelectorAll('.question')).find(c=>c.dataset.id===id);if(c){const f=c.querySelector('form');f.hidden=false;f.elements.scope.value=edit.scope;f.elements.review_date.value=edit.review_date;f.dataset.source=edit.source}}
 if(resume.receipt){const receipt=document.getElementById('setup-receipt');receipt.hidden=false;receipt.textContent=resume.receipt}
 if(session){document.getElementById('session-notice').hidden=false;document.getElementById('session-progress').textContent=`${completed} of ${session.length} decisions saved. ${completed>=session.length?'Session complete.':''}`}
 root.querySelectorAll('[data-outcome]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.outcome===outcome)))
 updateFilters()
}
