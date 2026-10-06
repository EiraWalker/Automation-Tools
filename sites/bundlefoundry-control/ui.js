const escape = s => String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = x => x ? escape(new Date(x).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})) : '尚未执行';
export function page(bundle, epic) {
  const recoveryText=bundle?.automation_state==='needs_authorization'
    ? 'Google 登录需要你完成验证，自动恢复已暂停。'
    : bundle?.session_recovery?.status==='relogged_in' ? '网站会话失效后已自动重新登录，账号核对通过。' : '网站会话失效时，会尝试复用已保存的 Google 登录。';
  const rows=(bundle?.results||[]).map(r=>`<tr><td>${escape(r.bundle_url?.split('/').pop())}</td><td>${escape(({claimed:'已领取',already_owned:'已拥有',sold_out:'免费额度已用完',inactive:'已结束',no_free_tier:'无免费档'})[r.status]||r.status)}</td></tr>`).join('');
  const gameRows=(epic?.games || []).map(g=>`<tr><td>${escape(g.title)}<br><small>截止 ${date(g.ends_at)}</small></td><td><a class="button" href="${escape(g.url)}" target="_blank" rel="noopener noreferrer">${g.link_type==='catalogue'?'打开官方限免目录':'打开游戏页面'}</a></td></tr>`).join('');
  const statusText={ready:'链接已更新',not_updated:'等待首次更新',no_games:'当前没有限免游戏',expired:'上次限免已结束',update_failed:'最近更新失败'}[epic?.status] || '等待更新';
  return `<!doctype html><html lang="zh-Hans"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>免费领取中心</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23132f27'/%3E%3Cpath d='M8 10h16v14H8zM8 14h16M16 10v14' stroke='%23b4e3a9' stroke-width='2' fill='none'/%3E%3C/svg%3E"><style>
  body{margin:0;background:#f4f5ef;color:#193b30;font:16px/1.6 system-ui}main{max-width:900px;margin:48px auto;padding:24px}h1{font-size:32px;margin:0}h2{font-size:22px;margin-top:0}.intro{color:#52685d;margin-bottom:28px}.card{background:#fff;padding:28px;border:1px solid #d5dfd5;border-radius:14px;margin-bottom:20px}.badge{display:inline-block;background:#e2f0dd;border-radius:20px;padding:4px 14px;font-size:14px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:14px 8px;border-bottom:1px solid #e2e8dd}small{color:#52685d}a{color:#245e49}button,.button{display:inline-block;border:0;border-radius:8px;background:#193b30;color:#fff;padding:10px 16px;font:inherit;cursor:pointer;text-decoration:none;margin:6px 8px 6px 0}button.secondary{background:#eef2e8;color:#193b30}button:disabled{opacity:.5;cursor:wait}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #bacbbb;border-radius:8px;font:inherit}label{display:block;margin:16px 0 6px}.notice{padding:12px 16px;background:#fff5de;border-radius:8px}#message{white-space:pre-wrap}details{margin-top:18px}summary{cursor:pointer}dialog{box-sizing:border-box;width:min(700px,calc(100% - 32px));max-height:85vh;overflow:auto;border:1px solid #d5dfd5;border-radius:14px;padding:28px;color:#193b30;font:inherit}dialog::backdrop{background:#14291c88}code{font-size:14px}ol{padding-left:24px}@media(max-width:600px){main{margin:16px auto;padding:16px}.card{padding:20px}td{overflow-wrap:anywhere}}</style><script src="/client.js" defer></script></head><body><main>
  <h1>免费领取中心</h1><p class="intro">仅你可访问 · 资产包自动领取，Epic 游戏本地手动领取</p>
  <p id="message" role="status" aria-live="polite"></p>
  <section class="card"><h2>Epic 每周免费游戏</h2><p><small>每周五台北时间 09:00 更新链接。</small></p><span class="badge">${escape(statusText)}</span>
  <p>点击游戏页面链接，在你的本地浏览器登录 Epic 并手动领取。</p><small>最近更新：${date(epic?.updated_at)} · 台湾地区预览</small>
  ${epic?.status==='update_failed'?'<p class="notice">本次目录更新失败，暂时显示上次保存且尚未过期的链接。请核对官网信息。</p>':''}
  ${gameRows?`<table><thead><tr><th>当前限免游戏</th><th>本地手动领取</th></tr></thead><tbody>${gameRows}</tbody></table>`:'<p>暂无有效的限免游戏链接，可更新列表或查看官方目录。</p>'}
  <button id="epic-update" type="button">更新游戏链接</button><a href="https://store.epicgames.com/zh-Hant/free-games" target="_blank" rel="noopener noreferrer">Epic 官方限免目录</a>
  <p><small>免费资格及截止时间以 Epic 官网和你的账号地区为准。</small></p>
  </section>
  <section class="card"><h2>BundleFoundry 免费资产包</h2><span class="badge">${bundle?.project_acceptance_complete?'首次领取已核实':'等待首次领取'}</span><p>每天检查两次 Gmail，自动领取通知中的免费档。</p><p>${escape(recoveryText)}</p><small>最近完成：${date(bundle?.last_success_at)}</small>${bundle?.acceptance?`<p>已确认拥有：<strong>${escape(bundle.acceptance.bundle_title)}</strong></p>`:''}${rows?`<table><thead><tr><th>资产包</th><th>结果</th></tr></thead><tbody>${rows}</tbody></table>`:''}</section>
  </main></body></html>`;
}

export const clientScript = `
const message=document.getElementById('message');
const button=document.getElementById('epic-update');
button.addEventListener('click',async()=>{
  button.disabled=true;message.textContent='正在更新免费游戏链接…';
  try {
    const r=await fetch('/api/epic/update',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'same-origin'});
    if(!r.ok){const result=await r.json();throw Error(result.error==='run_in_progress'?'已有更新正在运行，请稍后刷新。':'目录更新暂未完成，请稍后再试。');}
    location.reload();
  } catch(e) {message.textContent=e.message;button.disabled=false;}
});
`;
