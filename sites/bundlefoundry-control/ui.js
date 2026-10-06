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
    return `<tr><td>${escape(g.title)}<br><small>截止 ${date(g.ends_at)}</small></td><td>${r?escape(({claimed:'已确认入库',already_owned:'已拥有',ownership_verified_unconfirmed:'已入库，自动订单待核实'})[r.status] || r.status):'等待领取'}</td></tr>`;
  }).join('');
  const acceptance = epic?.acceptance;
  const progress=epic?.acceptance_progress;
  const goalRows=progress?.targets?.map(g=>`<li>${escape(g.title)}：${escape(({claimed:'已自动领取并核实',pending:'待领取',already_owned:'已拥有，未计入新领取验收',ownership_verified_unconfirmed:'已拥有，自动订单待核实'})[g.status] || g.status)}</li>`).join('') || '';
  return `<!doctype html><html lang="zh-Hans"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>免费领取中心</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23132f27'/%3E%3Cpath d='M8 10h16v14H8zM8 14h16M16 10v14' stroke='%23b4e3a9' stroke-width='2' fill='none'/%3E%3C/svg%3E"><style>
  body{margin:0;background:#f4f5ef;color:#193b30;font:16px/1.6 system-ui}main{max-width:900px;margin:48px auto;padding:24px}h1{font-size:32px;margin:0}h2{font-size:22px;margin-top:0}.intro{color:#52685d;margin-bottom:28px}.card{background:#fff;padding:28px;border:1px solid #d5dfd5;border-radius:14px;margin-bottom:20px}.badge{display:inline-block;background:#e2f0dd;border-radius:20px;padding:4px 14px;font-size:14px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:14px 8px;border-bottom:1px solid #e2e8dd}small{color:#52685d}a{color:#245e49}button,.button{display:inline-block;border:0;border-radius:8px;background:#193b30;color:#fff;padding:10px 16px;font:inherit;cursor:pointer;text-decoration:none;margin:6px 8px 6px 0}button.secondary{background:#eef2e8;color:#193b30}button:disabled{opacity:.5;cursor:wait}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #bacbbb;border-radius:8px;font:inherit}label{display:block;margin:16px 0 6px}.notice{padding:12px 16px;background:#fff5de;border-radius:8px}#message{white-space:pre-wrap}details{margin-top:18px}summary{cursor:pointer}dialog{box-sizing:border-box;width:min(700px,calc(100% - 32px));max-height:85vh;overflow:auto;border:1px solid #d5dfd5;border-radius:14px;padding:28px;color:#193b30;font:inherit}dialog::backdrop{background:#14291c88}code{font-size:14px}ol{padding-left:24px}@media(max-width:600px){main{margin:16px auto;padding:16px}.card{padding:20px}td{overflow-wrap:anywhere}}</style><script src="/client.js" defer></script></head><body><main>
  <h1>免费领取中心</h1><p class="intro">仅你可访问 · 只领取免费档和限免游戏</p>
  <p id="message" role="status" aria-live="polite"></p>
  <section class="card"><h2>Epic 每周免费游戏</h2><p><small>每周五台北时间 09:00 自动领取；授权令牌单独续期。</small></p><span class="badge">${escape(labels[epic?.status] || '等待 Epic 授权')}</span>
  ${epic?.connected?`<p>账号：<strong>${escape(epic.account.display_name)}</strong> · 地区：${escape(epic.account.country)}</p><small>最近检查：${date(epic.last_success_at)}<br>授权续期：${date(epic.refreshed_at)}</small>`:'<p>连接一次 Epic 账号，服务会复用加密令牌并自动续期。密码和两步验证码只在 Epic 官网输入。</p>'}
  ${epic?.refresh_interval_warning?'<p class="notice">Epic 返回的续期有效期不足 13 小时，当前每天两次的凭据续期间隔可能不够。该账号的持续运行尚需调整续期频率。</p>':''}
  ${epic?.connected && epic.status!=='ready'?'<p class="notice">请在 Epic 官网处理验证或账号提示。订单待核实时可先检查游戏库，再点击下方按钮核验；服务不会盲目重复提交订单。重新授权可恢复其他游戏的尝试。</p>':''}
  <button id="epic-run" type="button">${epic?.connected?'检查并领取':'刷新本周免费游戏'}</button>${epic?.connected?'<button id="epic-disconnect" class="secondary" type="button">断开 Epic 授权</button>':''}
  ${progress?.required_count?`<h3>本周验收：${progress.completed_count} / ${progress.required_count}</h3><p>${epic.project_acceptance_complete?'两款目标游戏均已由系统免费领取，并核实进入账号游戏库。':'需两款目标均由系统免费领取并核实，才算验收完成。'}</p><ul>${goalRows}</ul>`:'<p><small>验收目标尚未配置。</small></p>'}
  ${acceptance?`<small>已核实的自动领取：${escape(acceptance.title)} · ${date(acceptance.verified_at)}</small>`:''}
  ${gameRows?`<table><thead><tr><th>当前限免游戏${epic?.connected?'':'（台湾地区预览）'}</th><th>结果</th></tr></thead><tbody>${gameRows}</tbody></table>`:'<p>点击检查后显示当前限免游戏。</p>'}
  <button id="epic-auth-open" class="secondary" type="button">${epic?.connected?'重新授权 Epic':'连接 Epic 账号'}</button>
  <dialog id="epic-auth" aria-labelledby="epic-auth-title"><h2 id="epic-auth-title">${epic?.connected?'重新授权 Epic':'连接 Epic 账号'}</h2>
  <p>系统会复用已保存的刷新令牌自动续期。仅在 Epic 撤销授权、令牌失效或要求账号验证时，需要重新授权。</p>
  <ol><li><a href="${escape(loginUrl())}" target="_blank" rel="noopener noreferrer">打开 Epic 官方登录</a>。同一浏览器中的有效 Epic 登录 Cookie 可让官网复用登录；如官网要求验证，请在那里完成。</li><li>官方页面返回一次性 <code>authorizationCode</code>。立即将代码或包含它的 JSON 粘贴到下方并提交，不要在聊天中传递。授权码只能使用一次，可能很快过期。</li><li>本站向 Epic 兑换访问令牌和刷新令牌，将它们用 AES-256-GCM 加密保存到数据库。旧授权只在新授权成功后替换，授权码不写入数据库。</li><li>授权成功后立即检查并领取本周免费游戏，再核实游戏库权益。之后每周五台北时间 09:00 领取；每天 09:00、21:00 单独续期令牌，续期不领取游戏。</li></ol>
  <p class="notice">浏览器的 Epic Cookie 保存在 Epic 域名下，本站无法直接读取。本站会复用服务器加密保存的令牌及官方 SSO 网站会话；你浏览器的 Cookie 用于简化官网重新授权。若提示授权码无效、过期或已使用，请重新打开官方链接获取新代码。</p>
  <form id="epic-connect"><label for="epic-code">Epic 一次性授权代码</label><input id="epic-code" type="password" autocomplete="off" maxlength="2000" required spellcheck="false"><button type="submit">重新授权并开始领取</button><button id="epic-auth-close" class="secondary" type="button">关闭</button></form><p id="epic-auth-message" role="status" aria-live="polite"></p></dialog>
  </section>
  <section class="card"><h2>BundleFoundry 免费资产包</h2><span class="badge">${bundle?.project_acceptance_complete?'首次领取已核实':'等待首次领取'}</span><p>每天检查两次 Gmail，自动领取通知中的免费档。</p><p>${escape(recoveryText)}</p><small>最近完成：${date(bundle?.last_success_at)}</small>${bundle?.acceptance?`<p>已确认拥有：<strong>${escape(bundle.acceptance.bundle_title)}</strong></p>`:''}${rows?`<table><thead><tr><th>资产包</th><th>结果</th></tr></thead><tbody>${rows}</tbody></table>`:''}</section>
  </main></body></html>`;
}

export const clientScript = `
const message = document.getElementById('message');
const authDialog = document.getElementById('epic-auth');
const authMessage = document.getElementById('epic-auth-message');
document.getElementById('epic-auth-open').addEventListener('click',()=>{ authMessage.textContent=''; authDialog.showModal(); });
document.getElementById('epic-auth-close').addEventListener('click',()=>authDialog.close());
authDialog.addEventListener('close',()=>{ document.getElementById('epic-code').value=''; });
function busy(value) { document.querySelectorAll('button').forEach(b => b.disabled=value); }
async function post(path,body={}) {
  const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'same-origin'});
  const result=await r.json();
  if (!r.ok) throw Error(({forbidden:'请在本站以所有者身份登录。',origin_rejected:'请重新打开本站后提交。',run_in_progress:'已有任务正在运行，请稍后刷新。',invalid_code:'授权代码格式不正确，请从 Epic 官方页面重新获取。',login_required:'授权代码已过期或无效，请重新获取。',epic_unavailable:'Epic 暂时不可用，请稍后再试。'})[result.error] || '操作暂未完成，请稍后重试。');
  return result;
}
async function action(fn) { busy(true); message.textContent='正在处理，领取后会核实游戏权益…'; authMessage.textContent=message.textContent; try { await fn(); location.reload(); } catch(e) { message.textContent=e.message; authMessage.textContent=e.message; busy(false); } }
document.getElementById('epic-run').addEventListener('click',()=>action(()=>post('/api/epic/run')));
document.getElementById('epic-disconnect')?.addEventListener('click',()=>{ if(confirm('断开后删除本站保存的 Epic 授权令牌和历史状态。已领取的游戏仍在 Epic 账号中。')) action(()=>post('/api/epic/disconnect')); });
document.getElementById('epic-connect').addEventListener('submit',event=>{
  event.preventDefault(); const input=document.getElementById('epic-code'); let code=input.value.trim(); input.value='';
  try { if(code.startsWith('{')) code=JSON.parse(code).authorizationCode; } catch { authMessage.textContent='请粘贴正确的 authorizationCode 或 JSON。'; return; }
  action(async()=>{ try { await post('/api/epic/connect',{code}); } finally { code=''; } await post('/api/epic/run'); });
});
`;
