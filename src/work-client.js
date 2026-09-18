// Work console client. Both functions are stringified into the page, so they
// must be self-contained: no imports, no closures over module scope.
// Data shapes come from Friday /api/cabinet/obligations (work_view.py).

export function workListClient(){
  const root=document.getElementById('work-root');if(!root)return
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  const LABEL={needs_you:'Needs you',blocked:'Blocked',running:'Running',waiting_advisor:'Waiting on advisor',waiting_coder:'Waiting on Coder',queued:'Queued',paused:'Paused',done:'Done',cancelled:'Cancelled'}
  const KIND={secret:'needs a secret',decision:'needs a decision',approval:'needs approval',info:'needs information',external:'external system',budget:'budget exhausted',other:'blocked'}
  const ago=s=>{s=Number(s||0);if(s<60)return 'just now';if(s<3600)return Math.floor(s/60)+'m';if(s<86400)return Math.floor(s/3600)+'h';return Math.floor(s/86400)+'d'}
  const chip=st=>`<span class="wstate ${esc(st)}">${esc(LABEL[st]||st)}</span>`
  const left=s=>{s=Number(s||0);if(s<3600)return Math.max(1,Math.floor(s/60))+'m left';if(s<86400)return Math.floor(s/3600)+'h left';return Math.floor(s/86400)+'d left'}
  const crumbs=v=>(v.breadcrumb||[]).map((b,i,a)=>`<a href="/cabinet/${esc(b)}" class="crumb${b===v.holder_advisor&&i===a.length-1?' holder':''}">${esc(b)}</a>`).join('<span class="sep">›</span>')
  const initial=JSON.parse(document.getElementById('work-initial')?.textContent||'{}')
  const feedback=document.getElementById('work-feedback'),live=document.getElementById('work-live')
  const state={filters:{display:root.dataset.display||'',advisor:root.dataset.advisor||'',batch:root.dataset.batch||'',q:root.dataset.q||'',closed:root.dataset.closed==='1'},data:initial,busy:new Set()}
  const q=()=>{const p=new URLSearchParams();for(const[k,v]of Object.entries(state.filters))if(v)p.set(k,v===true?'1':v);return p.toString()}
  function card(v){
    const acts=(v.actions||[]).map(a=>a.href?`<a class="go secondary mini" href="${esc(a.href)}">${esc(a.label)}</a>`:`<button class="secondary mini" data-act="${esc(a.id)}" data-id="${esc(v.id)}">${esc(a.label)}</button>`).join('')
    return `<article class="wcard ${esc(v.display_state)}" data-card="${esc(v.id)}">
<div class="wcard-head">${chip(v.display_state)}<span class="wkind">${esc(KIND[v.blocker_kind]||KIND.other)}</span><span class="wage" title="last change">${ago(v.age_s)} ago</span></div>
<h4><a href="/cabinet/work/${esc(v.id)}">${esc(v.title)}</a></h4>
<div class="wchain">${crumbs(v)}${v.batch_id?` <a class="pill" href="/cabinet/work?batch=${esc(v.batch_id)}">${esc(v.batch_id)}</a>`:''}${v.task_id?` <a class="pill" href="${esc(v.task_url)}" target="_blank" rel="noopener">${esc(v.task_id)}</a>`:''}</div>
<p class="wblocker">${esc(v.blocker||v.summary||'')}</p>
<div class="wacts">${acts}<a class="go secondary mini" href="/cabinet/work/${esc(v.id)}">Open</a></div>
<form class="wreply" data-reply="${esc(v.id)}" hidden><textarea name="text" rows="2" placeholder="Your answer — the advisor wakes on the next tick" required></textarea><div class="row"><button type="submit">Send</button><button type="button" class="secondary" data-cancel-reply>Cancel</button></div></form></article>`
  }
  function row(v){
    return `<tr data-row="${esc(v.id)}" class="${esc(v.display_state)}"><td><a href="/cabinet/work/${esc(v.id)}">${esc(v.title)}</a><div class="muted small">${esc(v.id)}${v.kind?' · '+esc(v.kind):''}</div></td><td>${chip(v.display_state)}</td><td class="chain">${crumbs(v)}<div class="muted small">depth ${v.depth}${v.children_open?` · ${v.children_open} open child${v.children_open===1?'':'ren'}`:''}</div></td><td><a href="/cabinet/${esc(v.holder_advisor)}">${esc(v.holder_advisor)}</a></td><td>${v.batch_id?`<a class="pill" href="/cabinet/work?batch=${esc(v.batch_id)}">${esc(v.batch_id)}</a>`:'<span class="muted">—</span>'}</td><td>${v.task_id?`<a class="pill" href="${esc(v.task_url)}" target="_blank" rel="noopener">${esc(v.task_id)}${v.task_status?' · '+esc(v.task_status):''}</a>`:'<span class="muted">—</span>'}</td><td title="${esc(new Date(v.updated*1000).toLocaleString())}">${ago(v.pulse_s)}</td><td>${v.attempt}/${v.max_attempts}${v.priority?` <span class="pill">p${v.priority}</span>`:''}${v.deadline?` <span class="pill ${v.deadline_in_s<0?'over':''}" title="wall-clock budget">⏱ ${v.deadline_in_s<0?'overdue':left(v.deadline_in_s)}</span>`:''}</td><td class="wblocker-cell">${esc((v.blocker||v.summary||'').slice(0,120))}</td></tr>`
  }
  function render(){
    const d=state.data||{},a=d.attention||{counts:{},needs_you:[],blocked:[]},list=d.obligations||[]
    const c=a.counts||{}
    document.getElementById('work-counts').innerHTML=`<b>${c.needs_you||0}</b> need you · <b>${c.blocked||0}</b> blocked · <b>${c.in_progress||0}</b> in progress · <b>${c.queued||0}</b> queued`
    const needs=document.getElementById('work-needs'),blocked=document.getElementById('work-blocked')
    needs.innerHTML=(a.needs_you||[]).length?a.needs_you.map(card).join(''):'<p class="muted empty">Nothing is waiting on you.</p>'
    blocked.innerHTML=(a.blocked||[]).length?`<details><summary>${a.blocked.length} blocked in-chain (waiting on a parent advisor or an external system)</summary><div class="wcards">${a.blocked.map(card).join('')}</div></details>`:''
    const tb=document.getElementById('work-rows')
    tb.innerHTML=list.length?list.map(row).join(''):`<tr><td colspan="9" class="muted empty">${state.filters.q||state.filters.display||state.filters.advisor||state.filters.batch?'No obligations match these filters.':'No open obligations. Hand Friday some work, or use New work above.'}</td></tr>`
    document.getElementById('work-total').textContent=`${list.length} shown`
    for(const b of document.querySelectorAll('[data-filter-display]'))b.setAttribute('aria-pressed',String((b.dataset.filterDisplay||'')===(state.filters.display||'')))
    const badge=document.querySelector('[data-work-badge]');if(badge){const n=c.needs_you||0;badge.textContent=String(n);badge.hidden=!n}
  }
  let polling=false,queued=false
  async function poll(){
    if(document.hidden)return
    if(polling){queued=true;return}
    polling=true
    try{const r=await fetch('/cabinet/work/live?'+q(),{cache:'no-store'});if(!r.ok)throw new Error('live '+r.status);state.data=await r.json();render();live.textContent='Live updates on';live.classList.remove('error')}
    catch(e){live.textContent='Live updates paused — Friday did not answer. Showing the last known state.';live.classList.add('error')}
    finally{polling=false;if(queued){queued=false;poll()}}
  }
  async function act(id,action,extra={}){
    if(state.busy.has(id+action))return;state.busy.add(id+action)
    try{const r=await fetch(`/cabinet/work/${encodeURIComponent(id)}/action`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...extra})});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.reason||d.message||'failed');feedback.textContent=`${action} → ${id} accepted.`;feedback.classList.remove('error');await poll()}
    catch(e){feedback.textContent=`${action} failed: ${e.message}`;feedback.classList.add('error')}
    finally{state.busy.delete(id+action)}
  }
  root.addEventListener('click',async e=>{
    const f=e.target.closest('[data-filter-display]');if(f){state.filters.display=f.dataset.filterDisplay||'';history.replaceState(null,'','/cabinet/work'+(q()?'?'+q():''));await poll();return}
    const b=e.target.closest('button[data-act]');if(!b)return
    const id=b.dataset.id,action=b.dataset.act
    if(action==='reply'){const form=root.querySelector(`[data-reply="${id}"]`);if(form){form.hidden=false;form.querySelector('textarea').focus()}return}
    if(action==='cancel'&&!confirm('Cancel this obligation (and its open children)?'))return
    if(action==='nudge'){await act(id,'nudge',{note:'resolved from Board'});return}
    if(action==='budget'){await act(id,'budget',{attempts:6});return}
    await act(id,action)
  })
  root.addEventListener('submit',async e=>{
    const form=e.target.closest('form[data-reply]');if(!form)return;e.preventDefault()
    const id=form.dataset.reply,text=form.elements.text.value.trim();if(!text)return
    const btn=form.querySelector('button[type=submit]');btn.disabled=true
    try{const r=await fetch(`/cabinet/work/${encodeURIComponent(id)}/reply`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.reason||d.message||'failed');feedback.textContent=`Reply delivered to ${id}; ${d.woken.length} node${d.woken.length===1?'':'s'} woken.`;feedback.classList.remove('error');form.hidden=true;form.reset();await poll()}
    catch(err){feedback.textContent=`Reply failed: ${err.message}. Your text is preserved.`;feedback.classList.add('error');btn.disabled=false}
  })
  root.addEventListener('click',e=>{const c=e.target.closest('[data-cancel-reply]');if(c){const f=c.closest('form');f.hidden=true}})
  const search=document.getElementById('work-search');search?.addEventListener('input',()=>{clearTimeout(search._t);search._t=setTimeout(()=>{state.filters.q=search.value.trim();poll()},250)})
  document.getElementById('work-advisor')?.addEventListener('change',e=>{state.filters.advisor=e.target.value;poll()})
  document.getElementById('work-closed')?.addEventListener('change',e=>{state.filters.closed=e.target.checked;poll()})
  document.querySelector('[data-refresh-work]')?.addEventListener('click',poll)
  // New work (fleet) dialog: plan → confirm → submit
  const fleet=document.getElementById('fleet-form')
  if(fleet){
    const plan=document.getElementById('fleet-plan'),out=document.getElementById('fleet-proposal'),status=document.getElementById('fleet-status')
    let proposal=null
    plan?.addEventListener('click',async()=>{
      status.textContent='Routing…';try{const r=await fetch('/cabinet/work/fleet/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:fleet.elements.text.value})});const d=await r.json();if(!d.ok)throw new Error(d.reason||'plan failed');proposal=d.proposal
        out.innerHTML=`<table><tr><th>#</th><th>Job</th><th>Advisor</th><th>Why</th></tr>${d.proposal.map(p=>`<tr class="${p.confidence==='low'?'unsure':''}"><td>${p.n}</td><td>${esc(p.goal)}</td><td><input name="advisor-${p.n}" value="${esc(p.advisor)}" list="advisor-ids" size="10"></td><td class="muted small">${esc(p.reason)}${p.confidence==='low'?' — please confirm':''}</td></tr>`).join('')}</table>`
        status.textContent=d.unsure.length?`${d.unsure.length} job${d.unsure.length===1?'':'s'} need${d.unsure.length===1?'s':''} a confirmed advisor. Edit and submit.`:'Routing looks clear. Submit to create the roots.'
        fleet.elements.confirm.value='1';document.getElementById('fleet-submit').disabled=false}
      catch(e){status.textContent='Could not plan: '+e.message}
    })
    fleet.addEventListener('submit',async e=>{
      e.preventDefault();const btn=document.getElementById('fleet-submit');btn.disabled=true;status.textContent='Creating durable roots…'
      const goals=proposal?proposal.map(p=>({goal:p.goal,advisor:(fleet.querySelector(`[name="advisor-${p.n}"]`)?.value||p.advisor).trim().toLowerCase(),kind:p.kind})):null
      try{const r=await fetch('/cabinet/work/fleet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:fleet.elements.text.value,goals,confirm:fleet.elements.confirm.value==='1',idempotency_key:fleet.dataset.idem})});const d=await r.json()
        if(d.needs_confirm){proposal=d.proposal;plan.click();return}
        if(!r.ok||!d.ok)throw new Error(d.reason||d.message||'submit failed')
        status.textContent=`Accepted ${d.count} job${d.count===1?'':'s'} as ${d.batch_id}. One receipt sent to Asik.`;location.href='/cabinet/work?batch='+encodeURIComponent(d.batch_id)}
      catch(err){status.textContent='Submit failed: '+err.message;btn.disabled=false}
    })
  }
  render();poll();const timer=setInterval(poll,6000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true})
}

export function workDetailClient(){
  const root=document.getElementById('work-detail');if(!root)return
  const id=root.dataset.id
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  const LABEL={needs_you:'Needs you',blocked:'Blocked',running:'Running',waiting_advisor:'Waiting on advisor',waiting_coder:'Waiting on Coder',queued:'Queued',paused:'Paused',done:'Done',cancelled:'Cancelled'}
  const KIND={secret:'Needs a secret',decision:'Needs a decision',approval:'Needs approval',info:'Needs information',external:'External system',budget:'Budget exhausted',other:'Blocked'}
  const chip=st=>`<span class="wstate ${esc(st)}">${esc(LABEL[st]||st)}</span>`
  const when=ts=>ts?new Date(ts*1000).toLocaleString():'—'
  const ago=s=>{s=Number(s||0);if(s<60)return 'just now';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago'}
  const left=s=>{s=Number(s||0);if(s<3600)return Math.max(1,Math.floor(s/60))+'m left';if(s<86400)return Math.floor(s/3600)+'h left';return Math.floor(s/86400)+'d left'}
  const feedback=document.getElementById('work-feedback'),live=document.getElementById('work-live')
  let data=JSON.parse(document.getElementById('work-initial')?.textContent||'null')
  function tree(nodes,parentId,holder){
    const kids=nodes.filter(n=>(n.parent_id||'')===(parentId||''))
    if(!kids.length)return ''
    return `<ul class="wtree">${kids.map(n=>`<li class="${n.id===holder?'holder':''} ${n.id===id?'me':''}"><div class="wnode">${chip(n.display_state)} <a href="/cabinet/${esc(n.advisor)}" class="crumb">${esc(n.advisor)}</a> <a href="/cabinet/work/${esc(n.id)}">${esc(n.title)}</a>${n.id===holder?' <span class="pill holder-pill">holds the ball</span>':''}${n.id===id?' <span class="pill">you are here</span>':''}<div class="muted small">${esc(n.summary||'')}${n.task_id?` · <a href="${esc(n.task_url)}" target="_blank" rel="noopener">${esc(n.task_id)}</a>`:''} · ${n.attempt}/${n.max_attempts}</div></div>${tree(nodes,n.id,holder)}</li>`).join('')}</ul>`
  }
  function render(){
    const d=data;if(!d)return
    document.title=`${d.title} · Work · Friday`
    document.getElementById('wd-head').innerHTML=`<div class="wcard-head">${chip(d.display_state)}${d.paused?'<span class="pill">paused</span>':''}<span class="pill">holder: <a href="/cabinet/${esc(d.holder_advisor)}">${esc(d.holder_advisor)}</a></span>${d.batch_id?`<a class="pill" href="/cabinet/work?batch=${esc(d.batch_id)}">${esc(d.batch_id)}</a>`:''}<span class="pill">p${d.priority}</span><span class="pill">attempt ${d.attempt}/${d.max_attempts}</span>${d.budget?`<span class="pill" title="turns used across the whole chain">chain ${d.budget.turns_used}/${d.budget.turns_max} turns · ${d.budget.open_nodes}/${d.budget.nodes} open</span>`:''}${d.budget&&d.budget.deadline?`<span class="pill" style="${d.budget.deadline_in_s<0?'color:#ffaaa4':''}" title="${esc(when(d.budget.deadline))}">⏱ ${d.budget.deadline_in_s<0?'deadline passed':left(d.budget.deadline_in_s)}</span>`:''}${d.thread_url?`<a class="pill" href="${esc(d.thread_url)}" target="_blank" rel="noopener">Mattermost thread ↗</a>`:''}<span class="pill" title="${esc(when(d.created))}">created ${ago(d.age_s)}</span><span class="pill" title="${esc(when(d.updated))}">pulse ${ago(d.pulse_s)}</span></div>
<h2>${esc(d.title)}</h2><div class="wchain">${(d.breadcrumb||[]).map(b=>`<a class="crumb" href="/cabinet/${esc(b)}">${esc(b)}</a>`).join('<span class="sep">›</span>')} <span class="muted small">${esc(d.id)}${d.parent?` · child of <a href="/cabinet/work/${esc(d.parent.id)}">${esc(d.parent.title)}</a>`:' · root'}</span></div>`
    const needed=document.getElementById('wd-needed')
    if(d.needed){const n=d.needed;needed.hidden=false;needed.innerHTML=`<h3>${esc(KIND[n.kind]||KIND.other)} — from ${esc(n.from)} to ${esc(n.to)}</h3><p class="wneed">${esc(n.text||'(no blocker text)')}</p>${n.open_asks?.length?`<ul>${n.open_asks.map(a=>`<li><b>Open ask:</b> ${esc(a.question)} <span class="pill">${esc(a.status)}</span></li>`).join('')}</ul>`:''}<p class="muted">${esc(n.resolves_by)}</p>${n.kind==='secret'?`<a class="go secondary mini" href="/cabinet/${esc(d.advisor)}/configure">Open ${esc(d.advisor)} secrets</a> <a class="go secondary mini" href="/connections">Connections</a>`:''}`}
    else{needed.hidden=true}
    document.getElementById('wd-goal').textContent=d.goal||'';document.getElementById('wd-acc').textContent=d.acceptance||''
    document.getElementById('wd-tree').innerHTML=tree(d.tree||[],'',d.holder_id)||'<p class="muted">No chain yet.</p>'
    const bus=d.bus||[]
    document.getElementById('wd-bus').innerHTML=bus.length?bus.map(b=>`<div class="wbus ${esc(b.kind)}"><div class="row"><span class="pill">${esc(b.kind)}</span><span class="pill">${esc(b.status)}</span>${b.task_id?`<span class="pill">${esc(b.task_id)}</span>`:''}<span class="muted small">${esc(when(b.created))}</span></div><p>${esc(b.body)}</p>${b.answer?`<p class="wanswer">→ ${esc(b.answer)}</p>`:''}</div>`).join(''):'<p class="muted">No bus traffic yet. Coder asks, reports and escalations land here.</p>'
    const t=d.task||{}
    document.getElementById('wd-task').innerHTML=d.task_id?`<div class="row"><a class="pill" href="${esc(d.task_url)}" target="_blank" rel="noopener">${esc(d.task_id)} ↗</a>${t.status?`<span class="pill">${esc(t.status)}</span>`:''}${t.engine?`<span class="pill">${esc(t.engine)}</span>`:''}${t.project?`<span class="pill">${esc(t.project)}</span>`:''}${t.ci_status?`<span class="pill">CI ${esc(t.ci_status)}</span>`:''}</div>${t.pr_url?`<p><a href="${esc(t.pr_url)}" target="_blank" rel="noopener">Pull request ↗</a></p>`:''}${t.error?`<p class="wneed">${esc(String(t.error).slice(0,400))}</p>`:''}`:'<p class="muted">No Coder task linked.</p>'
    const ev=d.events||[]
    document.getElementById('wd-events').innerHTML=ev.length?`<ol class="wtimeline">${ev.slice().reverse().map(e=>`<li><span class="pill">${esc(e.kind)}</span> <span class="muted small">${esc(when(e.created))}${e.actor?' · '+esc(e.actor):''}</span><div>${esc(e.body||'')}</div></li>`).join('')}</ol>`:'<p class="muted">No events yet.</p>'
    const closed=['done','cancelled'].includes(d.status)
    document.getElementById('wd-actions').innerHTML=closed?`<span class="muted">This obligation is ${esc(d.status)}.</span>`:`<button data-act="nudge">Nudge</button><button class="secondary" data-act="bump">Bump priority</button><button class="secondary" data-act="${d.paused?'resume':'pause'}">${d.paused?'Resume':'Pause'}</button><button class="secondary" data-act="budget">Raise budget +6</button><button class="secondary" data-act="deadline">Deadline +24h</button>${d.budget&&d.budget.deadline?'<button class="secondary" data-act="deadline-clear">Clear deadline</button>':''}${d.is_root?`<button class="secondary danger" data-act="cancel" data-cascade="1">Cancel root (cascades)</button>`:`<button class="secondary danger" data-act="cancel" data-cascade="0">Cancel this node only</button>`}<a class="go secondary" href="/cabinet/${esc(d.advisor)}">Open ${esc(d.advisor)}</a>`
    document.getElementById('wd-reply').hidden=closed
  }
  let polling=false,queued=false
  async function poll(){if(document.hidden)return;if(polling){queued=true;return}polling=true;try{const r=await fetch(`/cabinet/work/${encodeURIComponent(id)}/live`,{cache:'no-store'});if(!r.ok)throw new Error('live '+r.status);data=await r.json();render();live.textContent='Live updates on';live.classList.remove('error')}catch(e){live.textContent='Live updates paused — Friday did not answer.';live.classList.add('error')}finally{polling=false;if(queued){queued=false;poll()}}}
  async function act(action,extra={}){
    try{const r=await fetch(`/cabinet/work/${encodeURIComponent(id)}/action`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...extra})});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.reason||d.message||'failed');feedback.textContent=`${action} accepted.`;feedback.classList.remove('error');await poll()}
    catch(e){feedback.textContent=`${action} failed: ${e.message}`;feedback.classList.add('error')}
  }
  root.addEventListener('click',async e=>{
    const b=e.target.closest('button[data-act]');if(!b)return
    const action=b.dataset.act
    if(action==='cancel'){if(!confirm(b.dataset.cascade==='1'?'Cancel this root and all its open children?':'Cancel only this node?'))return;await act('cancel',{cascade:b.dataset.cascade==='1'});return}
    if(action==='budget'){await act('budget',{attempts:6});return}
    if(action==='deadline'){await act('deadline',{hours:24});return}
    if(action==='deadline-clear'){await act('deadline',{clear:true});return}
    if(action==='nudge'){await act('nudge',{note:'nudged from Board'});return}
    await act(action)
  })
  document.getElementById('wd-reply')?.addEventListener('submit',async e=>{
    e.preventDefault();const form=e.target,text=form.elements.text.value.trim();if(!text)return;const btn=form.querySelector('button[type=submit]');btn.disabled=true
    try{const r=await fetch(`/cabinet/work/${encodeURIComponent(id)}/reply`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.reason||d.message||'failed');feedback.textContent=`Reply delivered; ${d.woken.length} node${d.woken.length===1?'':'s'} woken. The advisor picks it up on the next tick.`;feedback.classList.remove('error');form.reset();await poll()}
    catch(err){feedback.textContent=`Reply failed: ${err.message}. Your text is preserved.`;feedback.classList.add('error')}
    finally{btn.disabled=false}
  })
  document.getElementById('wd-edit')?.addEventListener('submit',async e=>{
    e.preventDefault();const f=e.target;const goal=f.elements.goal.value.trim(),acceptance=f.elements.acceptance.value.trim();if(!goal&&!acceptance)return
    await act('edit',{goal,acceptance});f.closest('details').open=false
  })
  render();poll();const timer=setInterval(poll,6000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true})
}
