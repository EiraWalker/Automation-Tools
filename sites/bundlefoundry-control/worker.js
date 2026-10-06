import {EpicAPI,EpicService,EpicError,summary,configuredTargets} from './epic.js';
import {page,clientScript} from './ui.js';
const headers = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json = (value, status=200) => Response.json(value,{status,headers});

export function authorize(request, env) {
  // Dispatch rejects anonymous requests to this owner-private Site. Identity-less
  // platform service access is explicitly supported for the shared cloud updater.
  const id = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  return !(id || email) || Boolean(id && email?.toLowerCase() === env.OWNER_EMAIL?.toLowerCase());
}

async function read(env, key) {
  const row = await env.DB.prepare('SELECT value FROM automation_state WHERE key=?').bind(key).first();
  return row ? JSON.parse(row.value) : null;
}
async function write(env, key, value) {
  return env.DB.prepare('INSERT INTO automation_state (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').bind(key,JSON.stringify(value),Date.now()).run();
}

function isOwner(request,env) {
  return Boolean(request.headers.get('oai-authenticated-user-id') &&
    request.headers.get('oai-authenticated-user-email')?.toLowerCase() === env.OWNER_EMAIL?.toLowerCase());
}

async function epicRoute(request,env,path) {
  if(path==='/api/epic/status' && request.method==='GET') return json(await read(env,'epic_snapshot') || summary(null,configuredTargets(env)));
  if(request.method!=='POST' || !['/api/epic/connect','/api/epic/disconnect','/api/epic/run','/api/epic/refresh'].includes(path)) return json({error:'not_found'},404);
  const interactive = ['/api/epic/connect','/api/epic/disconnect'].includes(path);
  // Credential changes require a real Sites-authenticated owner, never merely
  // an identity-less cloud service request. Dispatch supplies these headers.
  if(interactive && !isOwner(request,env)) return json({error:'forbidden'},403);
  const origin=request.headers.get('Origin');
  if((interactive || isOwner(request,env)) && origin !== new URL(request.url).origin) return json({error:'origin_rejected'},403);
  if(origin && origin !== new URL(request.url).origin) return json({error:'origin_rejected'},403);
  if(request.headers.get('Content-Type')?.split(';')[0].toLowerCase() !== 'application/json') return json({error:'invalid_content_type'},415);
  if(Number(request.headers.get('Content-Length') || 0)>4096) return json({error:'body_too_large'},413);
  const text=await request.text();
  if(text.length>4096) return json({error:'body_too_large'},413);
  let body; try { body=JSON.parse(text); } catch { return json({error:'invalid_json'},400); }
  if(!body || typeof body!=='object' || Array.isArray(body)) return json({error:'invalid_json'},400);
  const lease=crypto.randomUUID(), now=Date.now();
  const acquired=await env.DB.prepare('INSERT INTO automation_state (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE automation_state.updated_at<?').bind('epic_lease',JSON.stringify(lease),now,now-10*60*1000).run();
  if(!acquired.meta.changes) return json({error:'run_in_progress'},409);
  const repository={
    read:()=>read(env,'epic_state'),
    save:(encrypted,snapshot)=>env.DB.batch([
      env.DB.prepare('INSERT INTO automation_state (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind('epic_state',JSON.stringify(encrypted),Date.now()),
      env.DB.prepare('INSERT INTO automation_state (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind('epic_snapshot',JSON.stringify(snapshot),Date.now())
    ])
  };
  try {
    const browserSession=async exchangeCode=>{
      const origin=new URL(env.RENDER_ORIGIN);
      if(origin.protocol!=='https:' || origin.username || origin.password || origin.pathname!=='/')throw new EpicError('configuration_required');
      const response=await fetch(new URL('/internal/epic/web-session',origin),{method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+env.AUTOMATION_SERVICE_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({exchange_code:exchangeCode}),signal:AbortSignal.timeout(60000)});
      if(response.status>=300 && response.status<400 || Number(response.headers.get('Content-Length') || 0)>128000)throw new EpicError('checkout_action_required');
      const text=await response.text();if(text.length>128000)throw new EpicError('checkout_action_required');
      let result;try {result=JSON.parse(text);}catch{throw new EpicError('checkout_action_required');}
      if(!response.ok)throw new EpicError(['verification_required','run_in_progress'].includes(result.error)?result.error==='run_in_progress'?'epic_unavailable':'verification_required':'checkout_action_required');
      return result.cookies;
    };
    const service=new EpicService(repository,env.EPIC_CREDENTIAL_KEY,new EpicAPI(env.EPIC_CLIENT_SECRET,fetch,browserSession),configuredTargets(env));
    if(path==='/api/epic/connect') return json(await service.connect(body.code));
    if(path==='/api/epic/disconnect') return json(await service.disconnect());
    if(path==='/api/epic/refresh') return json(await service.refresh());
    return json(await service.run());
  } catch(error) {
    const code=error instanceof EpicError?error.code:'epic_unavailable';
    return json({error:code},code==='invalid_code'?400:503);
  } finally {
    await env.DB.prepare('DELETE FROM automation_state WHERE key=? AND value=?').bind('epic_lease',JSON.stringify(lease)).run();
  }
}

async function update(request, env, sessionTest=false) {
  const origin=request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({error:'origin_rejected'},403);
  if(sessionTest && env.SESSION_RECOVERY_TEST_ENABLED!=='true') return json({error:'session_test_disabled'},403);
  if (Number(request.headers.get('Content-Length') || 0)>3500000) return json({error:'batch_too_large'},413);
  const text=await request.text();
  if (text.length>3500000) return json({error:'batch_too_large'},413);
  let body;
  try { body=JSON.parse(text); } catch { return json({error:'invalid_json'},400); }
  if (!Array.isArray(body.messages) || body.messages.length>25 || typeof body.source_account!=='string' || body.source_account.toLowerCase()!==env.OWNER_EMAIL.toLowerCase()) return json({error:'invalid_batch'},400);
  const now=Date.now();
  const lease=crypto.randomUUID();
  const acquired=await env.DB.prepare('INSERT INTO automation_state (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE automation_state.updated_at<?').bind('lease',JSON.stringify(lease),now,now-10*60*1000).run();
  if (!acquired.meta.changes) return json({error:'run_in_progress'},409);
  try {
    const checkpoint=await read(env,'checkpoint');
    const origin=new URL(env.RENDER_ORIGIN);
    if(origin.protocol!=='https:' || origin.username || origin.password || origin.pathname!=='/') throw Error('invalid backend origin');
    const upstream=await fetch(new URL('/internal/run',origin),{method:'POST',redirect:'manual',headers:{'Authorization':'Bearer '+env.AUTOMATION_SERVICE_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({source_account:body.source_account,messages:sessionTest?[]:body.messages,checkpoint_encrypted:checkpoint,...(sessionTest?{session_recovery_test:true}:{})}),signal:AbortSignal.timeout(180000)});
    if(!upstream.ok) throw Error('backend unavailable');
    const result=await upstream.json();
    if(typeof result.checkpoint_encrypted!=='string' || !Array.isArray(result.results) || typeof result.project_acceptance_complete!=='boolean') throw Error('invalid result');
    if(sessionTest && result.session_recovery_test?.site_session_valid_after_login!==true) throw Error('session test incomplete');
    const previous=await read(env,'snapshot');
    const snapshot={...previous,last_success_at:result.automation_state==='needs_authorization'?previous?.last_success_at:new Date().toISOString(),automation_state:result.automation_state||'running',session_recovery:result.session_recovery||{},pending_messages:result.pending_messages,project_acceptance_complete:result.project_acceptance_complete,acceptance:result.acceptance,results:result.results,...(sessionTest?{session_recovery_test:result.session_recovery_test}:{})};
    await env.DB.batch([
      env.DB.prepare('INSERT INTO automation_state (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind('checkpoint',JSON.stringify(result.checkpoint_encrypted),Date.now()),
      env.DB.prepare('INSERT INTO automation_state (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind('snapshot',JSON.stringify(snapshot),Date.now())
    ]);
    return json(snapshot);
  } catch {
    await write(env,'last_error',{at:new Date().toISOString(),message:'领取服务暂时未完成，请在下一次检查时核实并重试。'});
    return json({error:'upstream_run_incomplete'},503);
  } finally {
    await env.DB.prepare('DELETE FROM automation_state WHERE key=? AND value=?').bind('lease',JSON.stringify(lease)).run();
  }
}

export default {
  async fetch(request,env) {
    if(!authorize(request,env)) return json({error:'forbidden'},403);
    const path=new URL(request.url).pathname;
    try {
      if(path.startsWith('/api/epic/')) return await epicRoute(request,env,path);
      if(path==='/client.js' && request.method==='GET') return new Response(clientScript,{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
      if(path==='/api/update' && request.method==='POST') return await update(request,env);
      if(path==='/api/session-recovery/test' && request.method==='POST') return await update(request,env,true);
      if(path==='/api/status' && request.method==='GET') return json(await read(env,'snapshot') || {project_acceptance_complete:false,results:[]});
      if(path==='/' && request.method==='GET') return new Response(page(await read(env,'snapshot'),await read(env,'epic_snapshot') || summary(null,configuredTargets(env))),{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self' https://chatgpt.com"}});
      return json({error:'not_found'},404);
    } catch { return json({error:'temporarily_unavailable'},503); }
  }
};
