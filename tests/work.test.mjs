import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {JSDOM} from 'jsdom'
import {Hono} from 'hono'
import {mountWork, renderWorkPage, renderWorkDetail} from '../src/work.js'
import {mountCabinet} from '../src/cabinet.js'
import {navigation} from '../src/workspace-ui.js'

const root={id:'obl_root1',title:'Ship Color Rhythm scroll fix',goal:'Ship Color Rhythm scroll fix end to end',acceptance:'PR merged',advisor:'cto',holder_advisor:'web',status:'blocked',display_state:'needs_you',needs_owner:true,paused:false,is_root:true,parent_id:'',chain_path:'cto',breadcrumb:['cto'],depth:0,kind:'coding',batch_id:'fleet_abc',priority:0,source:'chat',attempt:3,max_attempts:12,blocker:'Need GITHUB_PAT on agent web, or approve public fork workflow',blocker_kind:'secret',claim:'',summary:'Need GITHUB_PAT',task_id:'',task_status:'',task_url:'',children_summary:{done:1,blocked:1},children_open:1,channel:'whatsapp',created:1789600000,updated:1789680000,next_at:1789690000,due:false,age_s:3600,pulse_s:120,actions:[{id:'secrets',label:'Open web secrets',href:'/cabinet/web?tab=details'},{id:'nudge',label:'Mark resolved & nudge'},{id:'reply',label:'Reply'},{id:'cancel',label:'Cancel'}]}
const web={...root,id:'obl_web1',title:'Implement the scroll fix',advisor:'web',holder_advisor:'web',display_state:'blocked',needs_owner:false,is_root:false,parent_id:'obl_root1',chain_path:'cto/web',breadcrumb:['cto','web'],depth:1,task_id:'task_abc',task_status:'failed',task_url:'https://code.asikmydeen.com/?task=task_abc',children_summary:{},children_open:0,actions:[{id:'reply',label:'Reply'}]}
const arch={...web,id:'obl_arch1',title:'Design <b>boundary</b>',advisor:'architect',status:'done',display_state:'done',chain_path:'cto/architect',breadcrumb:['cto','architect'],task_id:'',task_url:'',blocker:'',blocker_kind:'',actions:[]}
const attention={counts:{needs_you:1,blocked:1,in_progress:0,queued:0,open:2},needs_you:[root],blocked:[web]}
const agents=[{id:'cto',name:'CTO'},{id:'web',name:'Web'}]
const tester={...arch,id:'obl_test1',title:'Prove the scroll fix',advisor:'tester',status:'open',display_state:'waiting_dep',depends_on:['obl_web1'],waiting_on:[{id:'obl_web1',advisor:'web',status:'blocked',title:'Implement the scroll fix'}],chain_path:'cto/tester',breadcrumb:['cto','tester']}
const detail={...root,task_id:'task_abc',task_status:'failed',task_url:'https://code.asikmydeen.com/?task=task_abc',root_id:'obl_root1',holder_id:'obl_web1',parent:null,children:[arch,web,tester],tree:[root,arch,web,tester],bus:[{id:'bus1',kind:'ask',body:'Which branch?',answer:'main',status:'answered',task_id:'task_abc',depth:0,created:1789670000,updated:1789670100},{id:'bus2',kind:'escalate',body:'CI red on lint',answer:'',status:'open',task_id:'task_abc',created:1789671000,updated:1789671000}],events:[{id:'e1',kind:'created',body:'cto: Ship',actor:'chat',created:1789600000},{id:'e2',kind:'blocked',body:'Need GITHUB_PAT',actor:'cto',created:1789680000}],task:{id:'task_abc',status:'failed',engine:'claude-code',project:'grid_planner',ci_status:'red',error:'lint failed'},needed:{kind:'secret',text:root.blocker,from:'cto',to:'owner',open_asks:[],resolves_by:'Add the named secret on the advisor\u2019s Details tab, then nudge.'}}

async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5))}assert.fail('Expected UI state did not arrive')}
function browser(html,fetch){return new JSDOM(html,{url:'https://board.test/cabinet/work',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.fetch=fetch;w.confirm=()=>true;w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))}}})}
const submit=(w,form)=>form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}))
const page=(over={})=>`<!doctype html><html><body>${navigation('/cabinet/work','Work')}${renderWorkPage({attention,obligations:[root,web],agents,...over})}</body></html>`

test('work page embeds escaped JSON and valid scripts; nav has Work + badge slot',()=>{
 const html=page({obligations:[root,web,{...arch,title:'</script><script>alert(1)</script>'}]})
 assert.ok(!html.includes('</script><script>alert(1)'))
 for(const s of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(s[1])
 assert.match(html,/href="\/cabinet\/work"[^>]*aria-current="page"/)
 assert.match(html,/data-work-badge/)
})

test('list renders attention cards, rows, counts, and badge from inline data',async()=>{
 const dom=browser(page(),async()=>Response.json({attention,obligations:[root,web]}))
 const d=dom.window.document
 assert.equal(d.querySelectorAll('#work-needs .wcard').length,1,'renders synchronously from inline JSON before the first poll')
 await until(()=>d.getElementById('work-live').textContent==='Live updates on')
 const card=d.querySelector('#work-needs .wcard')
 assert.match(card.textContent,/Needs you/);assert.match(card.textContent,/needs a secret/);assert.match(card.textContent,/GITHUB_PAT/)
 assert.ok(card.querySelector('a[href="/cabinet/web?tab=details"]'),'secrets CTA rendered')
 assert.ok(card.querySelector('button[data-act="reply"]'))
 assert.equal(d.querySelectorAll('#work-rows tr').length,2)
 assert.match(d.querySelector('#work-rows tr').textContent,/cto/)
 assert.match(d.getElementById('work-counts').textContent,/1 need you · 1 blocked/)
 assert.match(d.querySelector('#work-blocked summary').textContent,/1 blocked in-chain/)
 assert.equal(d.querySelector('[data-work-badge]').textContent,'1')
 assert.equal(d.querySelector('[data-work-badge]').hidden,false)
 const coder=d.querySelector('#work-rows tr[data-row="obl_web1"] a[href^="https://code.asikmydeen.com"]')
 assert.ok(coder,'Coder deep link present');assert.match(coder.textContent,/task_abc · failed/)
 dom.window.close()
})

test('reply from an attention card posts to the reply proxy and re-polls',async()=>{
 const calls=[]
 let replied=false
 const dom=browser(page(),async(url,opt)=>{calls.push([String(url),opt?.method||'GET']);if(opt?.method==='POST'){replied=true;assert.deepEqual(JSON.parse(opt.body),{text:'PAT added on web'});return Response.json({ok:true,woken:['obl_root1','obl_web1'],answered_asks:0})}
  return Response.json(replied?{attention:{counts:{needs_you:0,blocked:0,in_progress:2,queued:0,open:2},needs_you:[],blocked:[]},obligations:[{...root,display_state:'running'},{...web,display_state:'waiting_coder'}]}:{attention,obligations:[root,web]})})
 const w=dom.window,d=w.document
 await until(()=>d.getElementById('work-live').textContent==='Live updates on')
 d.querySelector('button[data-act="reply"]').click()
 const form=d.querySelector('form[data-reply="obl_root1"]');assert.equal(form.hidden,false)
 form.elements.text.value='PAT added on web';submit(w,form)
 await until(()=>d.getElementById('work-feedback').textContent.includes('2 nodes woken'))
 await until(()=>d.getElementById('work-counts').textContent.includes('0 need you'))
 assert.ok(calls.some(([u,m])=>u.endsWith('/cabinet/work/obl_root1/reply')&&m==='POST'))
 assert.match(d.getElementById('work-needs').textContent,/Nothing is waiting on you/)
 assert.equal(d.querySelector('[data-work-badge]').hidden,true)
 dom.window.close()
})

test('display filter buttons change the live query, even while a poll is in flight',async()=>{
 const urls=[]
 const dom=browser(page(),async(url)=>{urls.push(String(url));await new Promise(r=>setTimeout(r,30));return Response.json({attention,obligations:[root]})})
 const d=dom.window.document
 await until(()=>urls.length>=1)            // first poll started, not finished
 d.querySelector('[data-filter-display="needs_you"]').click()
 await until(()=>urls.some(u=>u.includes('display=needs_you')))
 assert.equal(d.querySelector('[data-filter-display="needs_you"]').getAttribute('aria-pressed'),'true')
 dom.window.close()
})

test('detail renders the chain tree with holder, what-is-needed, bus, task and actions; cancel cascades',async()=>{
 const posts=[]
 const html=`<!doctype html><html><body>${navigation('/cabinet/work','Work')}${renderWorkDetail(detail)}</body></html>`
 for(const s of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(s[1])
 const dom=browser(html,async(url,opt)=>{if(opt?.method==='POST'){posts.push([String(url),JSON.parse(opt.body)]);return Response.json({ok:true,cancelled:['obl_root1','obl_web1']})}return Response.json(detail)})
 const d=dom.window.document
 try{
 await until(()=>d.querySelectorAll('#wd-tree li').length===4&&d.getElementById('work-live').textContent==='Live updates on')
 assert.match(d.getElementById('wd-tree').textContent,/Waiting on siblings/,'depends_on state has a label, not the raw key');assert.ok(!d.getElementById('wd-tree').textContent.includes('waiting_dep'))
 const holder=d.querySelector('#wd-tree li.holder');assert.ok(holder);assert.match(holder.textContent,/Implement the scroll fix/);assert.match(holder.textContent,/holds the ball/)
 assert.match(d.getElementById('wd-needed').textContent,/Needs a secret — from cto to owner/)
 assert.ok(d.querySelector('#wd-needed a[href="/cabinet/cto/configure"]'))
 assert.match(d.getElementById('wd-bus').textContent,/Which branch\?/);assert.match(d.getElementById('wd-bus').textContent,/→ main/)
 assert.match(d.getElementById('wd-task').textContent,/lint failed/);assert.ok(d.querySelector('#wd-task a[href="https://code.asikmydeen.com/?task=task_abc"]'))
 assert.match(d.getElementById('wd-events').textContent,/blocked/)
 assert.ok(!d.getElementById('wd-tree').innerHTML.includes('<b>boundary</b>'),'titles are escaped')
 d.querySelector('#wd-actions button[data-act="cancel"]').click()
 await until(()=>posts.length===1)
 assert.equal(posts[0][0],'/cabinet/work/obl_root1/action');assert.deepEqual(posts[0][1],{action:'cancel',cascade:true})
 }finally{dom.window.close()}
})

test('board cards: inbox tasks offer Take this work; linked cards point at Work; notes and linked cards do not offer Take',async()=>{
 const {boardHtml,canTake,obligationIdOf,renderDetail}=await import('../src/board-ui.js')
 const inboxTask={id:'c1',title:'the board login is not working',kind:'task',status:'inbox',tags:['friday'],created_at:'2026-09-17T10:00:00Z'}
 const note={...inboxTask,id:'c2',kind:'note'}
 const linked={...inboxTask,id:'c3',status:'review_pr',tags:['friday','obl:obl_abc'],summary:'Needs you — cto: Need FEED_PASS\nhttps://board/cabinet/work/obl_abc'}
 const building={...linked,id:'c4',status:'building'}
 assert.equal(canTake(inboxTask),true);assert.equal(canTake(note),false);assert.equal(canTake({...inboxTask,tags:['obl:x']}),false)
 assert.equal(obligationIdOf(linked),'obl_abc')
 const html=boardHtml({'📥 Inbox':[inboxTask,note],'👀 Needs review':[linked],'🔨 Building':[building]})
 assert.match(html,/action="\/items\/c1\/take"/);assert.ok(!/action="\/items\/c2\/take"/.test(html));assert.ok(!/action="\/items\/c3\/take"/.test(html))
 assert.match(html,/href="\/cabinet\/work\/obl_abc"[^>]*>Needs you — open in Work/)
 assert.ok(!html.includes('>obl:obl_abc<'),'obl tag is not shown as a raw pill');assert.match(html,/>in Work</)
 assert.match(renderDetail(linked),/Cabinet obligation obl_abc/)
})

test('POST /items/:id/take hands the card to Friday and redirects with a flash',async()=>{
 const seen=[];const realFetch=globalThis.fetch
 globalThis.fetch=async(url,opt)=>{const u=String(url);seen.push([u,opt?.method||'GET',opt?.body]);if(u.endsWith('/api/cabinet/obligations/from-board'))return Response.json({ok:true,obligation_id:'obl_new1',advisor:'cto',existing:false});return Response.json({ok:false,message:'unexpected '+u},{status:500})}
 try{
  const app=new Hono();mountWork(app,{style:''})
  const body=new URLSearchParams({title:'the board login is not working',summary:'401 after the LAN move',url:'https://board.asikmydeen.com',kind:'task'})
  const r=await app.request('/items/11111111-2222-3333-4444-555555555555/take',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:body.toString(),redirect:'manual'})
  assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/?ok=taken')
  const post=seen.find(([u,m])=>u.endsWith('/from-board')&&m==='POST');assert.ok(post)
  const sent=JSON.parse(post[2]);assert.equal(sent.board_id,'11111111-2222-3333-4444-555555555555');assert.equal(sent.title,'the board login is not working');assert.equal(sent.url,'https://board.asikmydeen.com')
  const j=await app.request('/items/11111111-2222-3333-4444-555555555555/take',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:body.toString()})
  assert.equal((await j.json()).obligation_id,'obl_new1')
  const bad=await app.request('/items/x/take',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'title='});assert.equal(bad.status,422)
 }finally{globalThis.fetch=realFetch}
})

test('routes: /cabinet/work is served by Work, not swallowed by /cabinet/:id; proxies pass filters',async()=>{
 const seen=[]
 const realFetch=globalThis.fetch
 globalThis.fetch=async(url,opt)=>{const u=String(url);seen.push([u,opt?.method||'GET',opt?.body]);
  if(u.includes('/api/cabinet/work/attention'))return Response.json({ok:true,...attention})
  if(u.includes('/api/cabinet/obligations/obl_root1/reply'))return Response.json({ok:true,woken:['obl_root1'],answered_asks:0})
  if(u.includes('/api/cabinet/obligations/obl_root1'))return Response.json({ok:true,...detail})
  if(u.includes('/api/cabinet/obligations'))return Response.json({ok:true,count:2,obligations:[root,web],generated:1})
  if(u.includes('/api/cabinet/fleet/plan'))return Response.json({ok:true,proposal:[{n:1,goal:'fix the scroll bug',advisor:'cto',kind:'coding',confidence:'high',reason:'fix'}],unsure:[]})
  if(u.includes('/api/cabinet/fleet'))return Response.json({ok:true,batch_id:'fleet_new',count:1,roots:[]})
  if(u.includes('/api/cabinet/agents'))return Response.json(agents)
  return Response.json({ok:false,message:'unexpected '+u},{status:500})}
 try{
  const app=new Hono();mountWork(app,{style:''});mountCabinet(app,{style:''})
  const r=await app.request('/cabinet/work?display=needs_you&advisor=web&q=scroll')
  assert.equal(r.status,200);const html=await r.text();assert.match(html,/id="work-root"/);assert.match(html,/data-display="needs_you"/)
  assert.ok(seen.some(([u])=>u.includes('/api/cabinet/obligations?')&&u.includes('display=needs_you')&&u.includes('advisor=web')&&u.includes('q=scroll')))
  const live=await app.request('/cabinet/work/live?batch=fleet_abc');assert.equal(live.status,200);const lj=await live.json();assert.equal(lj.obligations.length,2)
  assert.ok(seen.some(([u])=>u.includes('batch_id=fleet_abc')||u.includes('batch=fleet_abc')))
  const badge=await app.request('/cabinet/work/badge');assert.deepEqual(await badge.json(),{needs_you:1,blocked:1})
  const det=await app.request('/cabinet/work/obl_root1');assert.equal(det.status,200);assert.match(await det.text(),/id="work-detail" data-id="obl_root1"/)
  const rep=await app.request('/cabinet/work/obl_root1/reply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'go'})})
  assert.equal(rep.status,200);assert.equal((await rep.json()).ok,true)
  const post=seen.find(([u,m])=>u.endsWith('/reply')&&m==='POST');assert.deepEqual(JSON.parse(post[2]),{text:'go',actor:'owner'})
  const fleet=await app.request('/cabinet/work/fleet',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'fix the scroll bug',confirm:true,idempotency_key:'k1'})})
  assert.equal((await fleet.json()).batch_id,'fleet_new')
  const fpost=seen.find(([u,m])=>u.endsWith('/api/cabinet/fleet')&&m==='POST');assert.equal(JSON.parse(fpost[2]).source,'board');assert.equal(JSON.parse(fpost[2]).idempotency_key,'k1')
 }finally{globalThis.fetch=realFetch}
})

test('card detail shows the Cabinet conversation and a reply form when linked',async()=>{
 const {renderDetail}=await import('../src/board-ui.js')
 const linked={id:'c9',title:'Fix login',kind:'task',status:'review_pr',tags:['friday','obl:obl_9'],created_at:'2026-09-17T10:00:00Z',
  _obligation:{display_state:'needs_you',holder_advisor:'web',chain_path:'cto/web',attempt:2,max_attempts:12,needed:{from:'cto',to:'owner',text:'Which branch?'},
   bus:[{id:'b1',kind:'ask',body:'Which branch?',answer:'',status:'escalated_owner',task_id:'task_1',created:1789600000},{id:'b2',kind:'owner_note',body:'Use main; keep old spacing.',answer:'',status:'delivered',task_id:'',created:1789600100}]}}
 const html=renderDetail(linked)
 assert.match(html,/Cabinet conversation/);assert.match(html,/Coder asked/);assert.match(html,/<b>You<\/b>/);assert.match(html,/Use main; keep old spacing\./)
 assert.match(html,/needs you: Which branch\?/)
 assert.match(html,/data-conv-live="obl_9"/)
 assert.match(html,/action="\/cabinet\/work\/obl_9\/reply"/);assert.match(html,/name="back" value="\/items\/c9"/)
 const withThread=renderDetail({...linked,_obligation:{...linked._obligation,thread_url:'https://mattermost.test/friday/pl/aaaaaaaaaaaaaaaaaaaaaaaaaa'}})
 assert.match(withThread,/Mattermost thread/)
 const plain=renderDetail({...linked,_obligation:null});assert.match(plain,/Linked to obligation obl_9/)
 assert.match(plain,/data-conv-live="obl_9"/)
 const none=renderDetail({...linked,tags:['friday']});assert.ok(!none.includes('Cabinet conversation'))
})

test('POST /cabinet/work/:id/reply accepts a Board form post and redirects back to the card',async()=>{
 const seen=[];const realFetch=globalThis.fetch
 globalThis.fetch=async(url,opt)=>{seen.push([String(url),opt?.body]);return Response.json({ok:true,woken:['obl_9'],answered_asks:1})}
 try{
  const app=new Hono();mountWork(app,{style:''})
  const r=await app.request('/cabinet/work/obl_9/reply',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({text:'Use main',back:'/items/c9'}).toString(),redirect:'manual'})
  assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/items/c9')
  assert.deepEqual(JSON.parse(seen[0][1]),{text:'Use main',actor:'owner (board)'})
  const evil=await app.request('/cabinet/work/obl_9/reply',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({text:'x',back:'https://evil.example/'}).toString(),redirect:'manual'})
  assert.equal(evil.headers.get('location'),'/cabinet/work')
 }finally{globalThis.fetch=realFetch}
})
