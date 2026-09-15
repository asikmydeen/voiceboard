import {test,beforeEach} from 'node:test'
import assert from 'node:assert/strict'
process.env.SUPABASE_URL='https://db.test'
process.env.SUPABASE_SERVICE_KEY='test'
process.env.TASKRUNNER_URL='https://tasks.test'
process.env.FRIDAY_BOARD_TOKEN='test-service-token'
const {Hono}=await import('hono')
const {mountBoardService}=await import('../src/board-service.js')
const {dispatchItem}=await import('../src/lib/taskrunner.js')
let rows,dispatches
const json=(body,status=200)=>new Response(JSON.stringify(body),{status})
beforeEach(()=>{
  rows=new Map();dispatches=0
  global.fetch=async(url,options={})=>{
    const u=new URL(url)
    if(u.host==='tasks.test'){dispatches++;return json({id:'job-1',status:'queued'})}
    assert.equal(u.host,'db.test')
    const id=u.searchParams.get('id')?.slice(3)
    if(options.method==='POST'){
      const [row]=JSON.parse(options.body)
      if(!rows.has(row.id))rows.set(row.id,{...row,updated_at:'2026-09-14T00:00:00Z'})
      return json([])
    }
    let found=rows.has(id)?[rows.get(id)]:[]
    const status=u.searchParams.get('status')?.slice(3)
    const updated=u.searchParams.get('updated_at')?.slice(3)
    if(status)found=found.filter(r=>r.status===status)
    if(updated)found=found.filter(r=>r.updated_at===updated)
    if(u.searchParams.get('task_id')==='is.null')found=found.filter(r=>!r.task_id)
    if(options.method==='PATCH')for(const row of found)Object.assign(row,JSON.parse(options.body))
    return json(found)
  }
})
function app(){const a=new Hono();mountBoardService(a);return a}
function request(a,path,body,token='test-service-token'){
  return a.request('/service/board'+path,{method:body?'POST':'GET',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})
}
test('service rejects absent or wrong authentication',async()=>{
  const response=await request(app(),'/items/123',undefined,'wrong')
  assert.equal(response.status,401)
})
test('create request is idempotent and conflicting content fails',async()=>{
  const a=app(),body={request_id:'mm:one',title:'Test task'}
  assert.equal((await request(a,'/items',body)).status,201)
  assert.equal((await request(a,'/items',body)).status,200)
  assert.equal((await request(a,'/items',{...body,title:'Different'})).status,409)
  assert.equal(rows.size,1);assert.equal(dispatches,0)
})
test('two competing starts dispatch exactly once',async()=>{
  const a=app()
  const created=await (await request(a,'/items',{request_id:'mm:race',title:'Race task'})).json()
  Object.assign(rows.get(created.id),{buildable:true,project_guess:'friday'})
  const item={...rows.get(created.id)}
  const results=await Promise.allSettled([dispatchItem(item,''),dispatchItem(item,'')])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  assert.equal(dispatches,1)
  assert.equal(rows.get(item.id).task_id,'job-1')
})
test('stale move and start require current state',async()=>{
  const a=app()
  const item=await (await request(a,'/items',{request_id:'mm:stale',title:'Stale task'})).json()
  assert.equal((await request(a,`/items/${item.id}/move`,{status:'done',expected_status:'failed'})).status,409)
  assert.equal((await request(a,`/items/${item.id}/start`,{expected_status:'inbox',expected_updated_at:'old'})).status,409)
  assert.equal(dispatches,0)
})
test('ambiguous dispatch remains claimed and cannot submit again',async()=>{
  const a=app()
  const item=await (await request(a,'/items',{request_id:'mm:uncertain',title:'Uncertain task'})).json()
  const fetch=global.fetch
  global.fetch=async(url,opts)=>{if(new URL(url).host==='tasks.test'){dispatches++;throw new Error('timeout')}return fetch(url,opts)}
  await assert.rejects(dispatchItem(item,''))
  await assert.rejects(dispatchItem(item,''))
  assert.equal(dispatches,1)
  assert.equal(rows.get(item.id).status,'queued')
  assert.equal(rows.get(item.id).task_id,undefined)
})
