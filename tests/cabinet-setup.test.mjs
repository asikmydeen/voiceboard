import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {Hono} from 'hono'
import {renderSetup} from '../src/cabinet-setup.js'
import {mountCabinet,returnPath} from '../src/cabinet.js'
const q={agent:'cto',key:'interruptions',name:'CTO',question:'Which failures?',kind:'textarea',default:'Outages',effect:'Escalate failures',why:'Protect attention',options:[],priority:1,review_days:90,answer:{status:'answered',value:'Delivery failures',scope:'advisor',updated:1,source:'Your answer'},revision:2,history_count:2,suggestions:[],draft:null}
const data={agents:[{id:'cto',name:'CTO',title:'Reliability',active:true,state:'Needs your input',total:1,pending:0,items:[q]}],outcomes:[]}
test('renders current answers, labeled fields, history and safe script data',()=>{
 const html=renderSetup(data,{status:'done'})
 assert.match(html,/Delivery failures/);assert.match(html,/Answer history and undo/)
 assert.match(html,/for="answer-cto-interruptions"/);assert.match(html,/id="answer-cto-interruptions"/)
 for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script[1])
 const evil=structuredClone(data);evil.agents[0].items[0].answer.value='</script><script>alert(1)</script>'
 const escaped=renderSetup(evil);assert.ok(!escaped.includes('<script>alert(1)</script>'))
 assert.ok(escaped.includes('\\u003c/script>'))
})
test('redirect retains filters, encodes receipts and rejects external destinations',()=>{
 const url=new URL(returnPath('/cabinet/setup?status=done&agent=cto','Saved & verified'), 'https://board.test')
 assert.equal(url.searchParams.get('status'),'done');assert.equal(url.searchParams.get('agent'),'cto');assert.equal(url.searchParams.get('m'),'Saved & verified')
 assert.ok(returnPath('//attacker.test/steal','x').startsWith('/cabinet?'))
 assert.ok(returnPath('https://attacker.test','x').startsWith('/cabinet?'))
})
test('setup route has recoverable errors and does not treat HTTP errors as data',async()=>{
 const app=new Hono();mountCabinet(app,{style:''});const original=global.fetch
 try{
  global.fetch=async()=>new Response(JSON.stringify({message:'Service temporarily unavailable'}),{status:503})
  const failed=await app.request('/cabinet/setup');assert.equal(failed.status,503);assert.match(await failed.text(),/Try again/)
  global.fetch=async()=>Response.json({message:'not an array'})
  const invalid=await app.request('/cabinet/setup');assert.equal(invalid.status,503)
  global.fetch=async()=>Response.json(data)
  const good=await app.request('/cabinet/setup?agent=cto&status=done');assert.equal(good.status,200);assert.match(await good.text(),/Delivery failures/)
 }finally{global.fetch=original}
})
test('setup mutations reject a cross-origin request',async()=>{
 const app=new Hono();mountCabinet(app,{style:''})
 const response=await app.request('https://board.test/cabinet/setup/api/cto/interruptions/answer',{method:'POST',headers:{Origin:'https://attacker.test','Content-Type':'application/json'},body:'{}'})
 assert.equal(response.status,403)
})

const {JSDOM}=await import('jsdom')
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10))}assert.fail('UI did not reach the expected state')}
test('saving one answer preserves the other draft through the refreshed view',async()=>{
 const state=structuredClone(data);state.agents[0].items.push({...structuredClone(q),key:'second',question:'Another question',answer:null,revision:0,history_count:0});state.agents[0].total=2
 const calls=[]
 const dom=new JSDOM('<!doctype html><body>'+renderSetup(state,{status:'all'})+'</body>',{url:'https://board.test/cabinet/setup?status=all',runScripts:'dangerously',beforeParse(w){
  w.scrollTo=()=>{};w.alert=message=>{throw new Error(message)}
  w.fetch=async(path,options={})=>{
   calls.push([String(path),options]);const body=options.body?JSON.parse(options.body):null
   if(String(path).endsWith('/draft')){state.agents[0].items[1].draft={value:body.value};return Response.json({ok:true})}
   if(String(path).endsWith('/answer')){const answer={...state.agents[0].items[0].answer,value:body.value,revision:3,status:'answered'};state.agents[0].items[0].answer=answer;state.agents[0].items[0].revision=3;return Response.json({ok:true,answer,message:'Saved.',receipt:body.request_id})}
   return new Response('<!doctype html><body>'+renderSetup(state,{status:'all'})+'</body>')
  }
 }})
 const d=dom.window.document,second=d.querySelector('[data-key=second] textarea');second.value='Keep this unfinished answer';second.dispatchEvent(new dom.window.Event('input',{bubbles:true}))
 const first=d.querySelector('[data-key=interruptions] textarea');first.value='Only delivery failures';first.dispatchEvent(new dom.window.Event('input',{bubbles:true}));first.closest('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}))
 await until(()=>d.getElementById('setup-receipt').textContent.includes('Saved.'))
 assert.equal(d.querySelector('[data-key=second] textarea').value,'Keep this unfinished answer')
 assert.equal(d.querySelector('[data-key=interruptions] .value').textContent,'Only delivery failures')
 assert.equal(calls.filter(([url])=>url.endsWith('/answer')).length,1)
 assert.equal(calls.filter(([url])=>url.endsWith('/draft')).length,1)
 dom.window.close()
})
test('failed save keeps editable text and gives field-level recovery feedback',async()=>{
 const dom=new JSDOM('<!doctype html><body>'+renderSetup(data,{status:'all'})+'</body>',{url:'https://board.test/cabinet/setup?status=all',runScripts:'dangerously',beforeParse(w){w.fetch=async()=>Response.json({ok:false,message:'This answer changed in another tab.'},{status:409})}})
 const d=dom.window.document,field=d.querySelector('textarea');field.value='My unsaved answer';field.closest('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}))
 await until(()=>d.querySelector('.feedback').textContent.includes('another tab'))
 assert.equal(field.value,'My unsaved answer');assert.equal(field.closest('form').querySelector('button').disabled,false)
 dom.window.close()
})
test('structured rows serialize the actual dates and amounts from their controls',async()=>{
 const state=structuredClone(data);state.agents[0].items=[{...structuredClone(q),key:'bills',kind:'records',answer:null,revision:0,fields:[{key:'bill',label:'Bill',type:'text'},{key:'amount',label:'Amount',type:'number'},{key:'due_day',label:'Day of month',type:'day_number'}]}]
 let submitted
 const dom=new JSDOM('<!doctype html><body>'+renderSetup(state,{status:'all'})+'</body>',{url:'https://board.test/cabinet/setup?status=all',runScripts:'dangerously',beforeParse(w){w.fetch=async(path,opt)=>{submitted=JSON.parse(opt.body);return Response.json({ok:false,message:'Test receipt held'},{status:400})}}})
 const d=dom.window.document;d.querySelector('[data-field=bill]').value='Water';d.querySelector('[data-field=amount]').value='35.50';d.querySelector('[data-field=due_day]').value='12'
 d.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!!submitted)
 assert.deepEqual(JSON.parse(submitted.value),[{bill:'Water',amount:'35.50',due_day:'12'}])
 dom.window.close()
})
