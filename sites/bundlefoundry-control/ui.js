import {loginUrl} from './epic.js';
const escape = s => String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = x => x ? escape(new Date(x).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})) : '尚未执行';
const labels = {
  not_connected:'等待 Epic 授权',ready:'已连接',login_required:'授权已失效，请重新连接',
  verification_required:'需要在 Epic 官网完成验证',account_action_required:'需要处理 Epic 账号限制或协议',
  checkout_action_required:'Epic 结账页面需要人工处理',order_review_required:'订单待核实，请先检查 Epic 游戏库',
  unsafe_order_rejected:'订单未通过免费检查，已停止',rate_limited:'Epic 限流，等待下次检查',
  epic_unavailable:'Epic 暂时不可用',ownership_unavailable:'游戏库暂时无法核实',
  credential_unreadable:'凭据无法解密，请联系维护者',configuration_required:'服务配置尚未完成'
};
export function page(bundle, epic) {
  const recoveryText=bundle?.automation_state==='needs_authorization'
    ? 'Google 登录需要你完成验证，自动恢复已暂停。'
    : bundle?.session_recovery?.status==='relogged_in' ? '网站会话失效后已自动重新登录，账号核对通过。' : '网站会话失效时，会尝试复用已保存的 Google 登录。';
  const rows=(bundle?.results||[]).map(r=>`<tr><td>${escape(r.bundle_url?.split('/').pop())}</td><td>${escape(({claimed:'已领取',already_owned:'已拥有',sold_out:'免费额度已用完',inactive:'已结束',no_free_tier:'无免费档'})[r.status]||r.status)}</td></tr>`).join('');
  const games = epic?.games || [];
  const receipts = new Map((epic?.results || []).map(x=>[x.namespace+':'+x.id,x]));
  const gameRows = games.map(g=>{
    const r = receipts.get(g.namespace+':'+g.id);
    return `<tr><td>${escape(g.title)}<br><small>截止 ${date(g.ends_at)}</small></td><td>${r?escape(r.status==='claimed'?'已确认入库':'已拥有'):'等待领取'}</td></tr>`;
  }).join('');
  const acceptance = epic?.acceptance;
  return `<!doctype html><html lang="zh-Hans"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>免费领取中心</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23132f27'/%3E%3Cpath d='M8 10h16v14H8zM8 14h16M16 10v14' stroke='%23b4e3a9' stroke-width='2' fill='none'/%3E%3C/svg%3E"><style>
  body{margin:0;background:#f4f5ef;color:#193b30;font:16px/1.6 system-ui}main{max-width:900px;margin:48px auto;padding:24px}h1{font-size:32px;margin:0}h2{font-size:22px;margin-top:0}.intro{color:#52685d;margin-bottom:28px}.card{background:#fff;padding:28px;border:1px solid #d5dfd5;border-radius:14px;margin-bottom:20px}.badge{display:inline-block;background:#e2f0dd;border-radius:20px;padding:4px 14px;font-size:14px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:14px 8px;border-bottom:1px solid #e2e8dd}small{color:#52685d}a{color:#245e49}button,.button{display:inline-block;border:0;border-radius:8px;background:#193b30;color:#fff;padding:10px 16px;font:inherit;cursor:pointer;text-decoration:none;margin:6px 8px 6px 0}button.secondary{background:#eef2e8;color:#193b30}button:disabled{opacity:.5;cursor:wait}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #bacbbb;border-radius:8px;font:inherit}label{display:block;margin:16px 0 6px}.notice{padding:12px 16px;background:#fff5de;border-radius:8px}#message{white-space:pre-wrap}details{margin-top:18px}summary{cursor:pointer}code{font-size:14px}ol{padding-left:24px}@media(max-width:600px){main{margin:16px auto;padding:16px}.card{padding:20px}td{overflow-wrap:anywhere}}</style><script src="/client.js" defer></script></head><body><main>
  <h1>免费领取中心</h1><p class="intro">仅你可访问 · 只领取免费档和限免游戏</p>
  <p id="message" role="status" aria-live="polite"></p>
  <section class="card"><h2>Epic 每周免费游戏</h2><p><small>每周五台北时间 09:00 自动领取；授权令牌单独续期。</small></p><span class="badge">${escape(labels[epic?.status] || '等待 Epic 授权')}</span>
  ${epic?.connected?`<p>账号：<strong>${escape(epic.account.display_name)}</strong> · 地区：${escape(epic.account.country)}</p><small>最近检查：${date(epic.last_success_at)}<br>授权续期：${date(epic.refreshed_at)}</small>`:'<p>连接一次 Epic 账号，服务会复用加密令牌并自动续期。密码和两步验证码只在 Epic 官网输入。</p>'}
  ${epic?.refresh_interval_warning?'<p class="notice">Epic 返回的续期有效期不足 13 小时，当前每天两次的凭据续期间隔可能不够。该账号的持续运行尚需调整续期频率。</p>':''}
  ${epic?.connected && epic.status!=='ready'?'<p class="notice">请在 Epic 官网处理验证或账号提示。订单待核实时可先检查游戏库，再点击下方按钮核验；服务不会盲目重复提交订单。重新授权可恢复其他游戏的尝试。</p>':''}
  <button id="epic-run" type="button">${epic?.connected?'检查并领取':'刷新本周免费游戏'}</button>${epic?.connected?'<button id="epic-disconnect" class="secondary" type="button">断开 Epic 授权</button>':''}
  ${acceptance?`<p>首次领取已核实：<strong>${escape(acceptance.title)}</strong><br><small>核实时间：${date(acceptance.verified_at)} · 依据：Epic 账号的有效游戏权益</small></p>`:'<p><small>验收目标：发现一款尚未拥有的限免游戏 → 免费订单 → Epic 权益核验。当前尚未完成真实账号领取验收。</small></p>'}
  ${gameRows?`<table><thead><tr><th>当前限免游戏${epic?.connected?'':'（台湾地区预览）'}</th><th>结果</th></tr></thead><tbody>${gameRows}</tbody></table>`:'<p>点击检查后显示当前限免游戏。</p>'}
  <details ${epic?.connected?'':'open'}><summary>${epic?.connected?'重新授权 Epic':'连接 Epic 账号'}</summary><ol><li><a href="${escape(loginUrl())}" target="_blank" rel="noopener noreferrer">打开 Epic 官方登录</a>，完成登录和账号验证。</li><li>官方页面会显示一次性 <code>authorizationCode</code>。只将该代码或包含它的 JSON 粘贴到下方。</li><li>提交后开始检查和领取；代码会立即清除，不保存到数据库。</li></ol>
  <form id="epic-connect"><label for="epic-code">Epic 一次性授权代码</label><input id="epic-code" type="password" autocomplete="off" maxlength="2000" required spellcheck="false"><button type="submit">授权并开始领取</button></form></details>
  </section>
  <section class="card"><h2>BundleFoundry 免费资产包</h2><span class="badge">${bundle?.project_acceptance_complete?'首次领取已核实':'等待首次领取'}</span><p>每天检查两次 Gmail，自动领取通知中的免费档。</p><p>${escape(recoveryText)}</p><small>最近完成：${date(bundle?.last_success_at)}</small>${bundle?.acceptance?`<p>已确认拥有：<strong>${escape(bundle.acceptance.bundle_title)}</strong></p>`:''}${rows?`<table><thead><tr><th>资产包</th><th>结果</th></tr></thead><tbody>${rows}</tbody></table>`:''}</section>
  </main></body></html>`;
}

export const clientScript = `
const message = document.getElementById('message');
function busy(value) { document.querySelectorAll('button').forEach(b => b.disabled=value); }
async function post(path,body={}) {
  const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'same-origin'});
  const result=await r.json();
  if (!r.ok) throw Error(({forbidden:'请在本站以所有者身份登录。',origin_rejected:'请重新打开本站后提交。',run_in_progress:'已有任务正在运行，请稍后刷新。',invalid_code:'授权代码格式不正确，请从 Epic 官方页面重新获取。',login_required:'授权代码已过期或无效，请重新获取。',epic_unavailable:'Epic 暂时不可用，请稍后再试。'})[result.error] || '操作暂未完成，请稍后重试。');
  return result;
}
async function action(fn) { busy(true); message.textContent='正在处理，领取后会核实游戏权益…'; try { await fn(); location.reload(); } catch(e) { message.textContent=e.message; busy(false); } }
document.getElementById('epic-run').addEventListener('click',()=>action(()=>post('/api/epic/run')));
document.getElementById('epic-disconnect')?.addEventListener('click',()=>{ if(confirm('断开后删除本站保存的 Epic 授权令牌和历史状态。已领取的游戏仍在 Epic 账号中。')) action(()=>post('/api/epic/disconnect')); });
document.getElementById('epic-connect').addEventListener('submit',event=>{
  event.preventDefault(); const input=document.getElementById('epic-code'); let code=input.value.trim(); input.value='';
  try { if(code.startsWith('{')) code=JSON.parse(code).authorizationCode; } catch { message.textContent='请粘贴正确的 authorizationCode 或 JSON。'; return; }
  action(async()=>{ await post('/api/epic/connect',{code}); code=''; await post('/api/epic/run'); });
});
`;
