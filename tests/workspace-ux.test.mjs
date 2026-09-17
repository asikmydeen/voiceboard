import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {JSDOM} from 'jsdom'
import {Hono} from 'hono'
import {boardHtml,renderDetail} from '../src/board-ui.js'
import {renderSetup} from '../src/cabinet-setup.js'
import {mountCabinet} from '../src/cabinet.js'
const task={id:'task-1',title:'Review a release',summary:'Check the changed behaviour',kind:'task',status:'inbox',tags:[],created_at:'2026-09-13T10:00:00Z'}
const board=(items=[task])=>boardHtml({'📥 Inbox':items,'✅ Done':[]})
async function until(fn){for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,5))}assert.fail('Expected UI state did not arrive')}
function browser(html,fetch){return new JSDOM(html,{url:'https://board.test/',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.fetch=fetch;w.matchMedia=()=>({matches:true});w.confirm=()=>true;w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))}}})}
const submit=(w,form)=>form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}))
test('shared shell and all embedded scripts render valid escaped HTML',()=>{
 const evil={...task,title:'</script><script>alert(1)</script>'}
 const html=board([evil]);assert.ok(!html.includes('<script>alert(1)</script>'));assert.match(html,/aria-current="page"/)
 for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script[1])
 assert.match(renderDetail({...task,pr_url:'javascript:alert(1)',status:'review_pr'}),/Task receipt|No agent task receipt/)
 assert.ok(!renderDetail({...task,pr_url:'javascript:alert(1)',status:'review_pr'}).includes('href="javascript:'))
})
test('board refresh preserves quick-add text, focus, and an open move menu',async()=>{
 const dom=browser(board(),async()=>new Response(board([{...task,summary:'Updated summary'}])))
 const w=dom.window,d=w.document,input=d.querySelector('.quick-add input'),card=d.getElementById('c-task-1');input.value='My unfinished task';input.focus();card.querySelector('details').open=true
 d.querySelector('[data-refresh-board]').click();await until(()=>!d.querySelector('[data-refresh-board]').disabled&&d.getElementById('live-label').textContent==='Live updates on');await new Promise(r=>setTimeout(r,15))
 assert.equal(d.getElementById('c-task-1'),card);assert.equal(input.value,'My unfinished task');assert.equal(d.activeElement,input);assert.equal(card.querySelector('details').open,true)
 dom.window.close()
})
test('failed move restores the previous column and shows the error',async()=>{
 let failed=false
 const dom=browser(board(),async(url,opt)=>{if(opt?.method==='POST'){failed=true;return Response.json({ok:false,message:'Connection failed'},{status:503})}return new Response(board())})
 const d=dom.window.document,form=d.querySelector('[data-move-form]');form.elements.status.value='done';submit(dom.window,form)
 await until(()=>failed&&d.getElementById('board-feedback').textContent.includes('returned'))
 assert.equal(d.getElementById('c-task-1').parentElement.dataset.drop,'inbox')
 await new Promise(r=>setTimeout(r,15));dom.window.close()
})
test('task panel loads, saves edits, retains the board, and returns focus on close',async()=>{
 let edited=false
 const dom=browser(board(),async(url,opt)=>{if(opt?.method==='POST'){edited=true;return new Response('')}return new Response(String(url).includes('/items/')?renderDetail({...task,title:edited?'Updated task':task.title}):board())})
 const d=dom.window.document,link=d.querySelector('[data-task-link]');link.click();await until(()=>d.querySelector('#task-content .task-edit'))
 assert.equal(d.getElementById('task-drawer').open,true);const form=d.querySelector('#task-content form[action$="/edit"]');form.elements.title.value='Updated task';submit(dom.window,form)
 await until(()=>d.querySelector('#task-content h2')?.textContent==='Updated task');d.querySelector('[data-task-close]').click();assert.equal(d.getElementById('task-drawer').open,false);assert.equal(d.activeElement,link)
 await new Promise(r=>setTimeout(r,15));dom.window.close()
})
test('cancelled action confirmation never posts',async()=>{
 let posts=0
 const memoryTask={...task,tags:['mem:abc'],details:'memory_id: abc'}
 const dom=browser(board(),async(url,opt)=>{if(opt?.method==='POST')posts++;return new Response(String(url).includes('/items/')?renderDetail(memoryTask):board())})
 dom.window.confirm=()=>false;const d=dom.window.document;d.querySelector('[data-task-link]').click();await until(()=>d.querySelector('form[action$="/forget"]'))
 submit(dom.window,d.querySelector('form[action$="/forget"]'));await new Promise(r=>setTimeout(r,15));assert.equal(posts,0);dom.window.close()
})
function setupFixture(){return {outcomes:[],agents:[{id:'cto',name:'CTO',title:'Technology',state:'Needs input',active:true,total:3,pending:3,items:['one','two','three'].map((key,i)=>({agent:'cto',key,name:'CTO',question:'Question '+(i+1),kind:'textarea',default:'',effect:'Useful outcome '+(i+1),why:'Focus',options:[],priority:i,answer:null,revision:0,suggestions:[],history_count:0,draft:null}))}]}}
function setupBrowser(state,extra={}){
 const history=new Map(),calls=[]
 for(const a of state.agents)for(const q of a.items)if(q.answer)history.set(q.key+':'+q.revision,q.answer)
 const dom=browser('<body>'+renderSetup(state,{agent:'cto',status:'all'})+'</body>',async(url,opt)=>{
  const body=opt?.body?JSON.parse(opt.body):null;calls.push([url,body])
  if(String(url).endsWith('/answer')){const key=String(url).split('/').at(-2),q=state.agents[0].items.find(q=>q.key===key);const previous=body.restore_revision?history.get(key+':'+body.restore_revision):null;q.answer={...body,...previous,revision:q.revision+1};q.revision++;history.set(key+':'+q.revision,q.answer);state.agents[0].pending=state.agents[0].items.filter(q=>!q.answer).length;return Response.json({ok:true,answer:q.answer,message:'Saved.',receipt:body.request_id})}
  if(String(url).endsWith('/draft'))return Response.json({ok:true,version:1})
  return new Response('<body>'+renderSetup(state,{agent:'cto',status:'all'})+'</body>')
 });return {dom,calls}
}
test('guided session shows one question, preserves Back drafts, and completes three decisions',async()=>{
 const {dom}=setupBrowser(setupFixture()),w=dom.window,d=w.document;d.querySelector('[data-action=session]').click()
 assert.equal(d.querySelectorAll('.question:not([hidden])').length,1)
 let field=d.querySelector('.question:not([hidden]) textarea');field.value='First decision';field.dispatchEvent(new w.Event('input',{bubbles:true}));d.querySelector('[data-action=session-next]').click();await until(()=>d.getElementById('session-progress').textContent.includes('2 of 3'))
 d.querySelector('[data-action=session-back]').click();await until(()=>d.getElementById('session-progress').textContent.includes('1 of 3'));assert.equal(field.value,'First decision')
 for(let i=0;i<3;i++){const card=d.querySelector('.question:not([hidden])');card.querySelector('textarea').value='Decision '+i;submit(w,card.querySelector('form'));await until(()=>!card.querySelector('button[type=submit]').disabled&&d.getElementById('session-progress').textContent.includes(i===2?'3 of 3 decisions saved':`${i+2} of 3`))}
 assert.equal(d.getElementById('session-complete').hidden,false);assert.equal(d.getElementById('session-effects').children.length,3);assert.equal(d.activeElement,d.getElementById('session-complete'));dom.window.close()
})
test('saving retains the form node and undo uses an explicit prior revision',async()=>{
 const state=setupFixture();state.agents[0].items[0].answer={status:'answered',value:'Original',scope:'advisor',revision:1};state.agents[0].items[0].revision=1
 const {dom,calls}=setupBrowser(state),w=dom.window,d=w.document,card=d.querySelector('.question'),form=card.querySelector('form');card.querySelector('[data-action=edit]').click();const field=form.querySelector('textarea');field.value='Changed';field.focus();submit(w,form)
 await until(()=>!form.querySelector('button').disabled&&card.querySelector('.value').textContent==='Changed');assert.equal(d.querySelector('.question form'),form);assert.equal(d.querySelector('.question textarea'),field);assert.equal(d.activeElement,field)
 card.querySelector('[data-action=undo]').click();await until(()=>calls.filter(([u])=>String(u).endsWith('/answer')).length===2)
 assert.equal(calls.filter(([u])=>String(u).endsWith('/answer'))[1][1].restore_revision,1);await until(()=>field.value==='Original');assert.equal(card.querySelector('.value').textContent,'Original');await new Promise(r=>setTimeout(r,15));dom.window.close()
})
test('empty Cabinet selection does not broadcast to every agent',async()=>{
 const app=new Hono();mountCabinet(app,{style:''});const old=global.fetch;let contacted=false
 try{global.fetch=async()=>{contacted=true;return Response.json({ok:true})};const r=await app.request('/cabinet/assign',{method:'POST',body:new URLSearchParams({text:'A private brief'})});assert.equal(r.status,302);assert.match(r.headers.get('Location'),/Choose/);assert.equal(contacted,false)}finally{global.fetch=old}
})
test('live activity filters by exact advisor and ask rejects cross-origin requests',async()=>{
 const app=new Hono();mountCabinet(app,{style:''});const old=global.fetch
 try{global.fetch=async()=>Response.json([{id:'a',agent:'cto'},{id:'b',agent:'mentor'}]);const res=await app.request('/cabinet/live?agent=cto');assert.deepEqual(await res.json(),[{id:'a',agent:'cto'}]);assert.equal(res.headers.get('cache-control'),'no-store')
 const blocked=await app.request('https://board.test/cabinet/cto/ask-live',{method:'POST',headers:{Origin:'https://elsewhere.test','Content-Type':'application/json'},body:'{}'});assert.equal(blocked.status,403)}finally{global.fetch=old}
})
