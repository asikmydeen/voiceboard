// Narrow owner service API. Reuses the canonical Board records and dispatcher.
import crypto from 'node:crypto'
import {pgr} from './lib/db.js'
import {getItem} from './lib/inbox.js'
import {dispatchItem} from './lib/taskrunner.js'

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function operationId(key) {
  const h=crypto.createHash('sha256').update('friday-board:'+key).digest('hex')
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`
}

export function mountBoardService(app) {
  app.use('/service/board/*',async(c,next)=>{
    const secret=process.env.FRIDAY_BOARD_TOKEN
    const supplied=c.req.header('Authorization')||''
    const expected='Bearer '+secret
    if(!secret||supplied.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return c.json({error:'Unauthorized'},401)
    if(Number(c.req.header('Content-Length')||0)>20000)return c.json({error:'Too large'},413)
    await next()
  })
  app.get('/service/board/items/:id',async c=>{
    if(!uuid.test(c.req.param('id')))return c.json({error:'Invalid ID'},400)
    const item=await getItem(c.req.param('id'))
    return item?c.json(item):c.json({error:'Not found'},404)
  })
  app.post('/service/board/items',async c=>{
    const b=await c.req.json()
    if(typeof b.request_id!=='string'||b.request_id.length>250||!b.request_id||typeof b.title!=='string'||!b.title.trim())return c.json({error:'request_id and title required'},400)
    const id=operationId(b.request_id)
    const title=b.title.trim().slice(0,200)
    const origin=String(b.origin||'').slice(0,500)
    if(origin&&!/^https:\/\/mattermost\.asikmydeen\.com\/_redirect\/pl\/[a-z0-9]{26}$/.test(origin))return c.json({error:'Invalid origin'},400)
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify([title,origin])).digest('hex')
    const details=`request_hash: ${fingerprint}\n${origin?'Mattermost: '+origin:''}`
    const old=await getItem(id)
    if(old)return old.details===details?c.json(old):c.json({error:'Request ID conflict'},409)
    await pgr('board_items?on_conflict=id',{method:'POST',prefer:'resolution=ignore-duplicates',body:[{
      id,title,details,kind:'task',status:'inbox',buildable:false,summary:'Created from Friday',tags:['friday','mattermost'],
    }]})
    const item=await getItem(id)
    return item?.details===details?c.json(item,201):c.json({error:'Request conflict'},409)
  })
  app.post('/service/board/items/:id/move',async c=>{
    if(!uuid.test(c.req.param('id')))return c.json({error:'Invalid ID'},400)
    const b=await c.req.json()
    if(!['inbox','done','archived','failed'].includes(b.status)||typeof b.expected_status!=='string')return c.json({error:'status and expected_status required'},400)
    const current=await getItem(c.req.param('id'))
    if(!current)return c.json({error:'Not found'},404)
    if(['queued','building'].includes(current.status)||(current.task_id&&['inbox','failed'].includes(b.status)))return c.json({error:'Inspect or cancel the active task before changing its state'},409)
    const rows=await pgr(`board_items?id=eq.${c.req.param('id')}&status=eq.${encodeURIComponent(b.expected_status)}`,{method:'PATCH',prefer:'return=representation',body:{status:b.status,updated_at:new Date().toISOString()}})
    return rows.length?c.json(rows[0]):c.json({error:'Task changed; reload'},409)
  })
  app.post('/service/board/items/:id/start',async c=>{
    if(!uuid.test(c.req.param('id')))return c.json({error:'Invalid ID'},400)
    const b=await c.req.json()
    const item=await getItem(c.req.param('id'))
    if(!item)return c.json({error:'Not found'},404)
    if(item.status!==b.expected_status||item.updated_at!==b.expected_updated_at)return c.json({error:'Task changed; reload'},409)
    if(!item.project_guess||!item.buildable)return c.json({error:'Set project and mark buildable on Board first'},422)
    try{return c.json(await dispatchItem(item,''),202)}
    catch(e){return c.json({error:e.code==='CONFLICT'?'Task already started or changed':'Dispatch outcome unconfirmed; inspect task before retrying'},e.code==='CONFLICT'?409:502)}
  })
}
