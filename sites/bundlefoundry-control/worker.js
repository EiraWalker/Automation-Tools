const headers = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json = (value, status=200) => Response.json(value,{status,headers});
const escape = s => String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

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

async function update(request, env) {
  const origin=request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({error:'origin_rejected'},403);
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
    const upstream=await fetch(new URL('/internal/run',origin),{method:'POST',redirect:'manual',headers:{'Authorization':'Bearer '+env.AUTOMATION_SERVICE_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({source_account:body.source_account,messages:body.messages,checkpoint_encrypted:checkpoint}),signal:AbortSignal.timeout(180000)});
    if(!upstream.ok) throw Error('backend unavailable');
    const result=await upstream.json();
    if(typeof result.checkpoint_encrypted!=='string' || !Array.isArray(result.results) || typeof result.project_acceptance_complete!=='boolean') throw Error('invalid result');
    const snapshot={last_success_at:new Date().toISOString(),pending_messages:result.pending_messages,project_acceptance_complete:result.project_acceptance_complete,acceptance:result.acceptance,results:result.results};
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

function page(snapshot) {
  const rows=(snapshot?.results||[]).map(r=>`<tr><td>${escape(r.bundle_url.split('/').pop())}</td><td>${escape(({claimed:'已领取',already_owned:'已拥有',sold_out:'免费额度已用完',inactive:'已结束',no_free_tier:'无免费档'})[r.status]||r.status)}</td></tr>`).join('');
  const receipt=snapshot?.acceptance;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BundleFoundry 免費領取</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23132f27'/%3E%3Cpath d='M8 10h16v14H8zM8 14h16M16 10v14' stroke='%23b4e3a9' stroke-width='2' fill='none'/%3E%3C/svg%3E"><style>body{margin:0;background:#f4f5ef;color:#193b30;font:16px/1.6 system-ui}main{max-width:850px;margin:64px auto;padding:24px}h1{font-size:32px;margin:0 0 28px}.card{background:#fff;padding:28px;border:1px solid #d5dfd5;border-radius:14px;margin-bottom:20px}.badge{display:inline-block;background:#e2f0dd;border-radius:20px;padding:4px 14px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:14px 8px;border-bottom:1px solid #e2e8dd}small{color:#52685d}a{color:inherit}h2{font-size:20px}@media(max-width:600px){main{margin:20px auto;padding:16px}.card{padding:20px}td{overflow-wrap:anywhere}}</style></head><body><main><h1>BundleFoundry 免費領取</h1><section class="card"><span class="badge">私人任務</span><h2>${snapshot?.project_acceptance_complete?'已完成首次領取驗證':'等待首次領取驗證'}</h2><p>每天檢查兩次郵件，只領取免費檔。</p><small>最近完成：${snapshot?.last_success_at?escape(new Date(snapshot.last_success_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})):'尚未執行'}</small>${receipt?`<p>已確認擁有：<strong>${escape(receipt.bundle_title)}</strong></p>`:''}</section><section class="card"><h2>領取紀錄</h2>${rows?`<table><thead><tr><th>資產包</th><th>結果</th></tr></thead><tbody>${rows}</tbody></table>`:'<p>第一次檢查完成後，紀錄會顯示在這裡。</p>'}</section></main></body></html>`;
}

export default {
  async fetch(request,env) {
    if(!authorize(request,env)) return json({error:'forbidden'},403);
    const path=new URL(request.url).pathname;
    try {
      if(path==='/api/update' && request.method==='POST') return await update(request,env);
      if(path==='/api/status' && request.method==='GET') return json(await read(env,'snapshot') || {project_acceptance_complete:false,results:[]});
      if(path==='/' && request.method==='GET') return new Response(page(await read(env,'snapshot')),{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self' https://chatgpt.com"}});
      return json({error:'not_found'},404);
    } catch { return json({error:'temporarily_unavailable'},503); }
  }
};
