export function boardClient(){
  const board=document.getElementById('board'), drawer=document.getElementById('task-drawer'), body=document.getElementById('task-content'), feedback=document.getElementById('board-feedback')
  if(!board)return
  let dragging=false, refreshing=false, pending=false, mutations=0, selected=null, opener=null, dirty=false, loading=0
  const reduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const notice=(message,error=false)=>{for(const el of [feedback,...(drawer.open?[document.getElementById('task-feedback')]:[])]){if(!el)continue;el.hidden=false;el.textContent=message;el.classList.toggle('error',error)}}
  const positions=()=>new Map(Array.from(board.querySelectorAll('.card')).map(c=>[c.dataset.id,c.getBoundingClientRect()]))
  function animate(before){if(reduced())return;for(const c of board.querySelectorAll('.card')){const old=before.get(c.dataset.id),next=c.getBoundingClientRect();if(old&&c.animate&&(old.x!==next.x||old.y!==next.y))c.animate([{transform:`translate(${old.x-next.x}px,${old.y-next.y}px)`},{transform:'translate(0,0)'}],{duration:220,easing:'ease-out'})}}
  function filter(){const q=document.getElementById('board-search').value.toLowerCase(),mode=document.getElementById('board-status').value;for(const col of board.querySelectorAll('.col')){let shown=0;col.hidden=mode!=='all'&&mode!==col.dataset.drop;for(const card of col.querySelectorAll('.card')){card.hidden=!card.textContent.toLowerCase().includes(q);if(!card.hidden)shown++}const empty=col.querySelector('.empty');if(empty){empty.hidden=shown>0;empty.textContent=q?'No matching tasks.':'Nothing here yet.'}}}
  function reconcile(doc){
    const fresh=doc.getElementById('board');if(!fresh)throw new Error('The updated board is unavailable. Your current view is preserved.')
    const before=positions(),wanted=new Set(),focused=document.activeElement
    for(const newCol of fresh.querySelectorAll('.col')){
      const col=Array.from(board.querySelectorAll('.col')).find(c=>c.dataset.drop===newCol.dataset.drop);if(!col)continue
      col.querySelector('h2').innerHTML=newCol.querySelector('h2').innerHTML
      for(const incoming of newCol.querySelectorAll('.card')){
        wanted.add(incoming.dataset.id)
        let current=document.getElementById(incoming.id)
        if(current){
          // Preserve an open action control or keyboard focus until it is dismissed.
          const interacting=current.contains(focused)||!!current.querySelector('details[open]')
          if(current.outerHTML!==incoming.outerHTML&&!interacting){current.replaceWith(incoming);current=incoming}
        }else current=incoming
        col.append(current)
      }
    }
    for(const card of board.querySelectorAll('.card'))if(!wanted.has(card.dataset.id))card.remove()
    filter();animate(before)
  }
  async function refresh(){
    if(dragging||mutations||refreshing){pending=true;return}
    refreshing=true;pending=false
    try{const r=await fetch(location.pathname==='/'?location.href:'/',{cache:'no-store'});if(!r.ok)throw new Error('Live update unavailable. Your current board is still here.');reconcile(new DOMParser().parseFromString(await r.text(),'text/html'));document.getElementById('live-label').textContent='Live updates on'}catch(e){document.getElementById('live-label').textContent='Updates paused';notice(e.message,true)}finally{refreshing=false;if(pending&&!mutations&&!dragging){pending=false;setTimeout(refresh,500)}}
  }
  async function move(card,status){
    if(card.dataset.busy)return
    const oldCol=card.parentElement,oldNext=card.nextSibling,oldStatus=card.dataset.status,target=Array.from(board.querySelectorAll('.col')).find(c=>c.dataset.drop===status)
    if(!target||target===oldCol)return
    mutations++;card.dataset.busy='true';card.setAttribute('aria-busy','true');const before=positions();target.append(card);animate(before)
    try{
      const r=await fetch(`/items/${encodeURIComponent(card.dataset.id)}/move`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status,expected_status:oldStatus})}),d=await r.json()
      if(!r.ok||!d.ok)throw new Error(d.message||'Could not move this task.')
      card.dataset.status=status;notice(`Moved “${card.querySelector('.title').textContent}”.`)
    }catch(e){oldCol.insertBefore(card,oldNext?.isConnected?oldNext:null);notice(`${e.message} The task returned to its previous column.`,true)}finally{delete card.dataset.busy;card.removeAttribute('aria-busy');mutations--;await refresh()}
  }
  async function openTask(url,trigger){
    if(dirty&&!confirm('Discard your unsaved task edits?'))return
    const token=++loading;if(selected!==url){const message=document.getElementById('task-feedback');if(message)message.hidden=true}selected=url;opener=trigger;dirty=false
    if(!drawer.open)drawer.showModal();body.textContent='Loading task…'
    try{const r=await fetch(url+'?panel=1');if(!r.ok)throw new Error('This task could not load.');const html=await r.text();if(token!==loading||!drawer.open)return;body.innerHTML=html;document.getElementById('task-full-page').href=url}catch(e){if(token===loading){body.textContent=e.message;notice(e.message,true)}}
  }
  function close(){if(dirty&&!confirm('Discard your unsaved task edits?'))return;drawer.close()}
  drawer.addEventListener('cancel',e=>{e.preventDefault();close()})
  drawer.querySelector('[data-task-close]').addEventListener('click',close)
  drawer.addEventListener('close',()=>{loading++;const href=selected;selected=null;dirty=false;(opener?.isConnected?opener:Array.from(board.querySelectorAll('[data-task-link]')).find(a=>a.getAttribute('href')===href)||document.getElementById('board-search')).focus()})
  body.addEventListener('input',()=>{dirty=true})
  window.addEventListener('beforeunload',e=>{if(dirty||document.querySelector('.quick-add input').value.trim()){e.preventDefault();e.returnValue=''}})
  document.addEventListener('click',e=>{
    const link=e.target.closest('[data-task-link]');if(link&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey){e.preventDefault();openTask(link.getAttribute('href'),link)}
    if(e.target.closest('[data-refresh-board]'))refresh()
  })
  document.getElementById('board-search').addEventListener('input',filter);document.getElementById('board-status').addEventListener('change',filter)
  document.addEventListener('submit',async e=>{
    if(e.defaultPrevented)return
    const form=e.target;if(form.matches('[data-move-form]')){e.preventDefault();await move(form.closest('.card'),form.elements.status.value);return}
    if(!form.matches('.quick-add')&&!form.closest('#task-content')&&!form.matches('[data-board-action]'))return
    e.preventDefault();if(e.defaultPrevented&&form.dataset.busy)return
    form.dataset.busy='true';mutations++;const buttons=Array.from(form.querySelectorAll('button'));buttons.forEach(b=>b.disabled=true)
    try{
      const r=await fetch(form.action,{method:'POST',body:new FormData(form)})
      if(!r.ok)throw new Error((await r.text()).slice(0,220)||'Could not save. Your edits are still here.')
      if(form.matches('.quick-add'))form.reset()
      if(form.closest('#task-content')){dirty=false;notice(form.action.endsWith('/edit')?'Task saved.':'Task updated.');if(selected)await openTask(selected,opener)}else notice(form.matches('.quick-add')?'Task added to Inbox.':'Task updated.')
    }catch(err){notice(`${err.message} Check the current state before retrying.`,true)}finally{delete form.dataset.busy;buttons.forEach(b=>b.disabled=false);mutations--;await refresh()}
  })
  board.addEventListener('dragstart',e=>{const card=e.target.closest('.card');if(!card||e.target.closest('a,button,input,textarea,select,summary')||card.dataset.busy){e.preventDefault();return}dragging=true;card.classList.add('dragging');e.dataTransfer.setData('text/plain',card.dataset.id);e.dataTransfer.effectAllowed='move'})
  board.addEventListener('dragend',e=>{dragging=false;e.target.closest('.card')?.classList.remove('dragging');board.querySelectorAll('.drag-over').forEach(c=>c.classList.remove('drag-over'));if(pending)refresh()})
  board.addEventListener('dragover',e=>{const col=e.target.closest('.col');if(col){e.preventDefault();col.classList.add('drag-over');e.dataTransfer.dropEffect='move'}})
  board.addEventListener('dragleave',e=>{const col=e.target.closest('.col');if(col&&!col.contains(e.relatedTarget))col.classList.remove('drag-over')})
  board.addEventListener('drop',e=>{e.preventDefault();const col=e.target.closest('.col'),card=document.getElementById('c-'+e.dataTransfer.getData('text/plain'));dragging=false;if(col&&card){col.classList.remove('drag-over');move(card,col.dataset.drop)}})
  try{const es=new EventSource('/events');es.addEventListener('board',refresh);es.onerror=()=>{document.getElementById('live-label').textContent='Reconnecting…'};window.addEventListener('pagehide',()=>es.close(),{once:true})}catch{}
  const poll=setInterval(()=>{if(!document.hidden)refresh()},30000);window.addEventListener('pagehide',()=>clearInterval(poll),{once:true})
  filter()
}
