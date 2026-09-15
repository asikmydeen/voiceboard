export function cabinetClient(){
  const feed=document.querySelector('[data-run-feed]')
  if(!feed)return
  const agent=feed.dataset.runFeed, status=document.getElementById('run-feedback'), entries=new Map()
  let reading=false, posting=false
  const labels={running:'Running',done:'Complete',failed:'Failed',silent:'No action needed',queued:'Delivery queued',delivered:'Delivery requested'}
  function content(el,text){
    el.replaceChildren();for(const part of String(text||'').split(/(https?:\/\/[^\s<>"']+)/g)){if(/^https?:\/\//.test(part)){const a=document.createElement('a');a.href=part;a.textContent=part.includes('/items/')?'Open related task ↗':part.includes('/pull/')?'Review PR ↗':part;a.target='_blank';a.rel='noopener';el.append(a)}else el.append(document.createTextNode(part))}
  }
  function show(r){
    let el=entries.get(r.id)
    if(!el){el=document.createElement('article');el.className='run-entry';el.innerHTML='<div class="row"><span class="state"></span><time class="dialog-note"></time></div><h4></h4><div class="run-steps"></div><div class="run-result"></div><details><summary>Receipt details</summary><p class="dialog-note"></p></details>';entries.set(r.id,el);feed.prepend(el)}
    if(el.dataset.version===JSON.stringify(r))return
    el.dataset.version=JSON.stringify(r)
    el.querySelector('.state').textContent=labels[r.status]||r.status;el.querySelector('.state').className='state '+r.status
    el.querySelector('h4').textContent=agent?(r.label==='ask'?'Your request':r.label):`${r.agent} · ${r.label}`
    el.querySelector('time').textContent=r.started?new Date(r.started*1000).toLocaleString():''
    const steps=el.querySelector('.run-steps');steps.replaceChildren()
    for(const label of ['Running',r.status==='failed'?'Failed':'Complete']){const span=document.createElement('span');span.textContent=label;if(label===(r.status==='running'?'Running':r.status==='failed'?'Failed':'Complete'))span.className='current';steps.append(span)}
    content(el.querySelector('.run-result'),r.summary||r.reply||'The advisor is working on your request.')
    el.querySelector('details p').textContent=`Run ${r.id}${['queued','delivered'].includes(r.status)?' · A delivery was requested. This run status does not confirm the message reached WhatsApp.':''}`
  }
  async function poll(){
    if(reading||document.hidden)return;reading=true
    try{const res=await fetch('/cabinet/live'+(agent?'?agent='+encodeURIComponent(agent):''),{cache:'no-store'});if(!res.ok)throw new Error();const runs=await res.json();feed.querySelector('.run-empty')?.remove();for(const r of [...runs].reverse())show(r);if(!runs.length&&!entries.size){const p=document.createElement('p');p.className='run-empty dialog-note';p.textContent='No runs yet. Your advisor’s responses will appear here.';feed.append(p)}if(!posting){status.textContent='Up to date';status.classList.remove('error')}}catch{if(!posting){status.textContent='Live activity is temporarily unavailable. Existing results are preserved.';status.classList.add('error')}}finally{reading=false}
  }
  const ask=document.querySelector('[data-inline-ask]')
  ask?.addEventListener('submit',async e=>{
    e.preventDefault();if(posting)return;posting=true;const button=ask.querySelector('button[type=submit]'),field=ask.elements.text;button.disabled=true;field.readOnly=true;const oldLabel=button.textContent;button.textContent='Awaiting response…';status.textContent='Request submitted. Waiting for the advisor’s response…';status.classList.remove('error')
    try{const r=await fetch(`/cabinet/${encodeURIComponent(agent)}/ask-live`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:field.value,deliver:ask.elements.deliver.checked})});const result=await r.json();if(!r.ok||!result.ok)throw new Error(result.message||'The response could not be confirmed.');feed.querySelector('.run-empty')?.remove();show({...result,agent,label:'ask',summary:result.reply});status.textContent=result.status==='failed'?'The advisor could not finish. See the run below.':'Response received. Your result is below.';if(result.status!=='failed')field.value=''}catch(err){status.textContent=`${err.message} Your request text is preserved. Check Activity before sending again.`;status.classList.add('error')}finally{posting=false;field.readOnly=false;button.disabled=false;button.textContent=oldLabel;field.focus();poll()}
  })
  document.querySelector('[data-refresh-runs]')?.addEventListener('click',poll)
  poll();const timer=setInterval(poll,5000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true})
}
