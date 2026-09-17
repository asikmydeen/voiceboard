// Isolated, disposable UX fixture. Never connects to Friday or production data.
import {Hono} from 'hono'
import {serve} from '@hono/node-server'
import {spawn} from 'node:child_process'
const roles=[['shared','Shared preferences','A foundation for every advisor'],['cto','CTO','Technology, reliability, and the work worth building'],['mentor','Mentor','Direction, learning, and thoughtful decisions'],['family','Family Coordinator','Keep the week manageable for everyone'],['research','Research Advisor','Find the useful signal and keep the evidence']]
const q=(agent,key,question,priority,extra={})=>({agent,key,name:roles.find(r=>r[0]===agent)[1],question,kind:'textarea',default:'',effect:'Your advisor can tailor its next response to this decision.',why:'This helps the advisor focus on what matters to you.',options:[],priority,answer:null,revision:0,history_count:0,suggestions:[],draft:null,...extra})
const agents=roles.map(([id,name,title],index)=>({id,name,title,active:true,state:'Needs your input',total:3,pending:3,items:[q(id,'priorities','What should I help you make progress on?',1+index,{default:'Focus on one important outcome this week.'}),q(id,'timing','When is a good time to check in?',10+index,{kind:'select',options:['Morning','Afternoon','Only when I ask']}),q(id,'boundaries','What should always stay in your hands?',20+index)]}))
const history=new Map(),runs=[]
let sequence=0
function workspace(){for(const a of agents){a.pending=a.items.filter(q=>!q.answer||q.answer.status==='removed').length;a.state=a.pending?'Needs your input':'Ready to try'}return {agents,outcomes:[{id:'focus',label:'Protect my focus',agents:['cto','mentor']},{id:'family',label:'A calmer week',agents:['family']}]}}
function roster(){workspace();return agents.filter(a=>a.id!=='shared').map((a,i)=>({...a,setup:{total:a.total,done:a.total-a.pending,pending:a.items.filter(q=>!q.answer).map(q=>q.key),docs:0},next:i?null:{label:'Weekly review',at:new Date(Date.now()+86400000).toISOString()},last:runs.find(r=>r.agent===a.id),workspace:null}))}
const api=new Hono()
api.get('/api/cabinet/setup/workspace',c=>c.json(workspace()))
api.get('/api/cabinet/agents',c=>c.json(roster()))
api.get('/api/cabinet/runs',c=>c.json(runs))
api.get('/api/cabinet/tools',c=>c.json([{name:'read_board',description:'Read the current task board',base:true}]))
api.get('/api/cabinet/schedule',c=>c.json([]))
api.get('/api/cabinet/system',c=>c.json({agents:4,paused:false,dependencies:{preview:{ok:true,detail:'Isolated development fixture'}},deps_meta:{checked_age_seconds:0}}))
api.get('/api/cabinet/agents/:id',c=>{const a=agents.find(a=>a.id===c.req.param('id'));return a?c.json({...a,setup:a.items.map(q=>({...q,answered:!!q.answer})),config:[],docs:[],schedules:[],tools:['read_board'],channels:['whatsapp'],runs:runs.filter(r=>r.agent===a.id),aliases:[a.id],mission:a.title}):c.json({error:'not found'},404)})
api.get('/api/cabinet/agents/:id/preview',c=>c.json({prompt:'Preview advisor context',tools:['read_board'],channels:['whatsapp']}))
api.post('/api/cabinet/agents/:id/ask',async c=>{const body=await c.req.json(),r={id:'preview-'+(++sequence),agent:c.req.param('id'),label:'ask',status:'running',started:Date.now()/1000,summary:'› '+body.text};runs.unshift(r);await new Promise(r=>setTimeout(r,1800));r.status='done';r.summary+='\n\nStart with the smallest useful outcome. Review the task on your Board: http://localhost:3137/items/44444444-4444-4444-4444-444444444444';return c.json({ok:true,...r,reply:r.summary})})
api.get('/api/cabinet/setup/:agent/:key/history',c=>c.json(history.get(c.req.param('agent')+':'+c.req.param('key'))||[]))
api.post('/api/cabinet/setup/:agent/:key/:action',async c=>{const {agent,key,action}=c.req.param(),item=agents.find(a=>a.id===agent)?.items.find(q=>q.key===key),body=await c.req.json();if(!item)return c.json({ok:false,message:'Missing question'},404)
 if(action==='draft'){item.draft={...body,version:(item.draft?.version||0)+1};return c.json({ok:true,version:item.draft.version})}
 if(action==='answer'){if(body.revision!==item.revision)return c.json({ok:false,message:'This answer changed in another tab.'},409);let prior=body.restore_revision?(history.get(agent+':'+key)||[]).find(h=>h.revision===body.restore_revision):null;const answer={...body,...prior,revision:++item.revision,updated:Date.now()/1000};item.answer=answer;item.draft=null;item.history_count++;history.set(agent+':'+key,[...(history.get(agent+':'+key)||[]),answer]);return c.json({ok:true,answer,receipt:body.request_id,message:'Saved.'})}
 return c.json({ok:true,suggestions:[],message:'No prior information in this preview.'})
})
const server=serve({fetch:api.fetch,port:3138,hostname:'127.0.0.1'})
const child=spawn(process.execPath,['--watch','src/index.js'],{stdio:'inherit',env:{...process.env,PORT:'3137',VOICEBOARD_DEV_MOCK:'1',FEED_USER:'preview',FEED_PASS:'preview',FRIDAY_API:'http://127.0.0.1:3138',FRIDAY_API_TOKEN:'preview'}})
console.log('Isolated preview: http://localhost:3137/?key=preview (preview / preview)')
function stop(){child.kill('SIGTERM');server.close()}
process.on('SIGINT',stop);process.on('SIGTERM',stop);child.on('exit',()=>server.close())
