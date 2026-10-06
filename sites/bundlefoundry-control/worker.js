import {fetchCatalogue,linksStatus} from './epic.js';
import {page,clientScript} from './ui.js';
import {googleAuthorizationPage,googleAuthorizationScript,localExporter} from './google-authorization.js';
import {googleSignInPage,googleSignInScript} from './google-signin.js';
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

async function epicStatus(env) {
  return linksStatus(await read(env,'epic_links_snapshot'),await read(env,'epic_links_error'));
}

async function epicRoute(request,env,path) {
  if(path==='/api/epic/status' && request.method==='GET') return json(await epicStatus(env));
  // Retired endpoints cannot decrypt credentials, authenticate, or submit orders.
  if(['/api/epic/connect','/api/epic/disconnect','/api/epic/import','/api/epic/refresh'].includes(path))
    return json({error:'epic_automation_disabled',mode:'manual'},410);
  if(request.method!=='POST' || !['/api/epic/update','/api/epic/run'].includes(path)) return json({error:'not_found'},404);
  const origin=request.headers.get('Origin');
  if((isOwner(request,env) && !origin) || (origin && origin!==new URL(request.url).origin)) return json({error:'origin_rejected'},403);
  if(request.headers.get('Content-Type')?.split(';')[0].toLowerCase()!=='application/json') return json({error:'invalid_content_type'},415);
  if(Number(request.headers.get('Content-Length') || 0)>4096) return json({error:'body_too_large'},413);
  const text=await request.text();
  if(text.length>4096) return json({error:'body_too_large'},413);
  let body;try {body=JSON.parse(text);}catch {return json({error:'invalid_json'},400);}
  if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length) return json({error:'invalid_body'},400);
  const lease=crypto.randomUUID(),now=Date.now();
  const acquired=await env.DB.prepare('INSERT INTO automation_state (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE automation_state.updated_at<?').bind('epic_links_lease',JSON.stringify(lease),now,now-60000).run();
  if(!acquired.meta.changes) return json({error:'run_in_progress'},409);
  try {
    const snapshot=await fetchCatalogue();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO automation_state (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind('epic_links_snapshot',JSON.stringify(snapshot),Date.now()),
      env.DB.prepare('DELETE FROM automation_state WHERE key=?').bind('epic_links_error')
    ]);
    return json(linksStatus(snapshot));
  } catch(error) {
    const reason=/^(network_error|upstream_http_[0-9]{3}|response_too_large|response_read_failed|invalid_json|invalid_catalogue)$/.test(error.code || '')?error.code:'storage_error';
    await write(env,'epic_links_error',{at:new Date().toISOString()});
    return json({error:'catalogue_update_failed',mode:'manual',reason},503);
  } finally {
    await env.DB.prepare('DELETE FROM automation_state WHERE key=? AND value=?').bind('epic_links_lease',JSON.stringify(lease)).run();
  }
}

async function update(request, env, sessionTest=false, sessionImport=false, browserCommit=false) {
  const origin=request.headers.get('Origin');
  if((sessionImport||browserCommit) && (!isOwner(request,env) || origin!==new URL(request.url).origin)) return json({error:'forbidden'},403);
  if(sessionImport && request.headers.get('Content-Type')?.split(';')[0].toLowerCase()!=='application/json') return json({error:'invalid_content_type'},415);
  if(sessionImport && Number(request.headers.get('Content-Length')||0)>250000) return json({error:'batch_too_large'},413);
  if (origin && origin !== new URL(request.url).origin) return json({error:'origin_rejected'},403);
  if(sessionTest && env.SESSION_RECOVERY_TEST_ENABLED!=='true') return json({error:'session_test_disabled'},403);
  if (Number(request.headers.get('Content-Length') || 0)>3500000) return json({error:'batch_too_large'},413);
  const text=await request.text();
  if (text.length>3500000) return json({error:'batch_too_large'},413);
  let body;
  try { body=JSON.parse(text); } catch { return json({error:'invalid_json'},400); }
  if(browserCommit)body={source_account:env.OWNER_EMAIL,messages:[]};
  if (!Array.isArray(body.messages) || body.messages.length>25 || typeof body.source_account!=='string' || body.source_account.toLowerCase()!==env.OWNER_EMAIL.toLowerCase()) return json({error:'invalid_batch'},400);
  if(sessionImport && (text.length>250000 || body.messages.length || body.google_session_import?.version!==1 || body.google_session_import?.account?.toLowerCase()!==env.OWNER_EMAIL.toLowerCase())) return json({error:'invalid_batch'},400);
  const now=Date.now();
  const lease=crypto.randomUUID();
  const acquired=await env.DB.prepare('INSERT INTO automation_state (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE automation_state.updated_at<?').bind('lease',JSON.stringify(lease),now,now-10*60*1000).run();
  if (!acquired.meta.changes) return json({error:'run_in_progress'},409);
  try {
    const checkpoint=await read(env,'checkpoint');
    const origin=new URL(env.RENDER_ORIGIN);
    if(origin.protocol!=='https:' || origin.username || origin.password || origin.pathname!=='/') throw Error('invalid backend origin');
    const upstream=await fetch(new URL(browserCommit?'/internal/google-browser/commit':'/internal/run',origin),{method:'POST',redirect:'manual',headers:{'Authorization':'Bearer '+env.AUTOMATION_SERVICE_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({source_account:body.source_account,messages:sessionTest?[]:body.messages,checkpoint_encrypted:checkpoint,...(sessionTest?{session_recovery_test:true}:{}),...(sessionImport?{google_session_import:body.google_session_import}:{})}),signal:AbortSignal.timeout(180000)});
    if(!upstream.ok) throw Error('backend unavailable');
    const result=await upstream.json();
    if(typeof result.checkpoint_encrypted!=='string' || !Array.isArray(result.results) || typeof result.project_acceptance_complete!=='boolean') throw Error('invalid result');
    if(sessionTest && result.session_recovery_test?.site_session_valid_after_login!==true) throw Error('session test incomplete');
    if((sessionImport||browserCommit) && result.google_session_imported!==true) throw Error('session import incomplete');
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

async function googleBrowserRoute(request,env,path){
  if(!isOwner(request,env))return json({error:'forbidden'},403);
  const action=path.split('/').pop();
  if(request.method==='POST'&&request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'forbidden'},403);
  if(action==='commit'&&request.method==='POST')return update(request,env,false,false,true);
  if(action==='test'&&request.method==='POST'){
    const next=new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify({source_account:env.OWNER_EMAIL,messages:[]})});
    return update(next,env,true);
  }
  if(!((action==='state'&&request.method==='GET')||(['signin','input'].includes(action)&&request.method==='POST')))return json({error:'not_found'},404);
  const text=request.method==='POST'?await request.text():null;
  if(text&&text.length>8192)return json({error:'body_too_large'},413);
  if(request.method==='POST'){
    if(request.headers.get('Content-Type')?.split(';')[0].toLowerCase()!=='application/json')return json({error:'invalid_content_type'},415);
    let body;try{body=JSON.parse(text);}catch{return json({error:'invalid_json'},400);}
    if(action==='input'&&body.operation!=='cancel')return json({error:'not_found'},404);
    if(action==='signin'&&(typeof body.account!=='string'||body.account.toLowerCase()!==env.OWNER_EMAIL.toLowerCase()))return json({error:'account_mismatch'},400);
  }
  const origin=new URL(env.RENDER_ORIGIN);
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/')throw Error('invalid backend origin');
  const upstream=await fetch(new URL('/internal/google-browser/'+action,origin),{method:request.method,redirect:'manual',headers:{Authorization:'Bearer '+env.AUTOMATION_SERVICE_TOKEN,'Content-Type':'application/json'},...(text===null?{}:{body:text}),signal:AbortSignal.timeout(30000)});
  return new Response(await upstream.arrayBuffer(),{status:upstream.status,headers:{...headers,'Content-Type':'application/json'}});
}

export default {
  async fetch(request,env) {
    if(!authorize(request,env)) return json({error:'forbidden'},403);
    const path=new URL(request.url).pathname;
    try {
      if(path.startsWith('/api/epic/')) return await epicRoute(request,env,path);
      if(path.startsWith('/api/google-browser/'))return await googleBrowserRoute(request,env,path);
      if(path==='/google-authorization' && request.method==='GET') return new Response(googleSignInPage(),{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; style-src 'unsafe-inline'; frame-ancestors 'self' https://chatgpt.com"}});
      if(path==='/google-authorization/local' && request.method==='GET')return new Response(googleAuthorizationPage(),{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; style-src 'unsafe-inline'; frame-ancestors 'self' https://chatgpt.com"}});
      if(path==='/google-authorization/signin.js' && request.method==='GET')return new Response(googleSignInScript,{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
      if(path==='/google-authorization/client.js' && request.method==='GET') return new Response(googleAuthorizationScript,{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
      if(path==='/google-authorization/export.py' && request.method==='GET') return new Response(localExporter,{headers:{...headers,'Content-Type':'text/x-python; charset=utf-8','Content-Disposition':'attachment; filename="google-local-auth.py"'}});
      if(path==='/api/google/import' && request.method==='POST') return await update(request,env,false,true);
      if(path==='/client.js' && request.method==='GET') return new Response(clientScript,{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
      if(path==='/api/update' && request.method==='POST') return await update(request,env);
      if(path==='/api/session-recovery/test' && request.method==='POST') return await update(request,env,true);
      if(path==='/api/status' && request.method==='GET') return json(await read(env,'snapshot') || {project_acceptance_complete:false,results:[]});
      if(path==='/' && request.method==='GET') return new Response(page(await read(env,'snapshot'),await epicStatus(env)),{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self' https://chatgpt.com"}});
      return json({error:'not_found'},404);
    } catch { return json({error:'temporarily_unavailable'},503); }
  }
};
