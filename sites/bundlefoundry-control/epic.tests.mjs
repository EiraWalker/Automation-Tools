import test from 'node:test';
import assert from 'node:assert/strict';
import {EpicAPI,EpicService,EpicError,freeGames,assertFreeOrder,seal,unseal,owns} from './epic.js';
import worker from './worker.js';
import {page,clientScript} from './ui.js';
import {DatabaseSync} from 'node:sqlite';

const key=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
const account={id:'account-test',display_name:'Test owner',country:'TW'};
const game={id:'offer',namespace:'ns',items:['item'],title:'Test free game',country:'TW',
  starts_at:new Date(Date.now()-86400000).toISOString(),ends_at:new Date(Date.now()+86400000).toISOString()};
const session={account_id:account.id,access_token:'TEST_ACCESS',refresh_token:'TEST_REFRESH',
  expires_at:new Date(Date.now()+86400000).toISOString(),refresh_expires_at:new Date(Date.now()+30*86400000).toISOString()};
const entitlement={namespace:'ns',catalogItemId:'item',status:'ACTIVE',accountId:account.id};
const preview=()=>({namespace:'ns',country:'TW',offers:['offer'],syncToken:'test-sync',orderResponse:{
  epicAccountId:account.id,isFree:true,totalPrice:0,walletPaymentAmount:0,billingPaymentAmount:0,
  totalTax:0,convenienceFee:0,orderStatus:'PREVIEW'}});
function fixture() {
  const repo={encrypted:null,snapshot:null,saves:[],read:async()=>repo.encrypted,
    save:async(enc,view)=>{repo.encrypted=enc;repo.snapshot=view;repo.saves.push({enc,view});}};
  let owned=[]; let confirms=0; let previews=0;
  const api={token:async()=>({...session}),profile:async()=>({...account}),catalog:async()=>[{...game}],
    entitlements:async()=>owned,preview:async()=>{previews++; return {preview:preview(),purchaseToken:'test-purchase'};},
    confirm:async()=>{assert.ok((await unseal(repo.encrypted,key)).pending['ns:offer']);confirms++;owned=[entitlement];}};
  return {repo,api,service:new EpicService(repo,key,api),setOwned:x=>owned=x,confirms:()=>confirms,previews:()=>previews};
}

test('AES-GCM uses distinct IVs, rejects tampering and wrong keys',async()=>{
  const a=await seal(session,key),b=await seal(session,key);
  assert.notEqual(a.iv,b.iv);assert.notEqual(a.ciphertext,b.ciphertext);
  assert.deepEqual(await unseal(a,key),session);
  const tampered={...a,ciphertext:(a.ciphertext[0]==='A'?'B':'A')+a.ciphertext.slice(1)};
  await assert.rejects(unseal(tampered,key));
  await assert.rejects(unseal(a,Buffer.alloc(32,1).toString('base64')));
});

test('catalog excludes paid, permanent free, upcoming, expired and non-base-game offers',()=>{
  const offer={id:'offer',namespace:'ns',title:'Game',offerType:'BASE_GAME',items:[{id:'item',namespace:'ns'}],
    price:{totalPrice:{discountPrice:0,originalPrice:100}},promotions:{promotionalOffers:[{promotionalOffers:[{
      startDate:game.starts_at,endDate:game.ends_at,discountSetting:{discountPercentage:0}}]}]}};
  const variants=[offer,{...offer,id:'paid',price:{totalPrice:{discountPrice:1,originalPrice:100}}},
    {...offer,id:'permanent',price:{totalPrice:{discountPrice:0,originalPrice:0}}},
    {...offer,id:'dlc',offerType:'DLC'},{...offer,id:'missing',promotions:null},
    {...offer,id:'foreign',items:[{id:'item',namespace:'other'}]},
    {...offer,id:'upcoming',promotions:{promotionalOffers:[{promotionalOffers:[{startDate:game.ends_at,endDate:'2099-01-01',discountSetting:{discountPercentage:0}}]}]}},
    {...offer,id:'expired',promotions:{promotionalOffers:[{promotionalOffers:[{startDate:'2020-01-01',endDate:'2020-02-01',discountSetting:{discountPercentage:0}}]}]}}];
  assert.deepEqual(freeGames({data:{Catalog:{searchStore:{elements:variants}}}},'TW').map(x=>x.id),['offer']);
});

test('zero-order guard rejects nonzero, missing, wrong account, country and offers',()=>{
  assert.doesNotThrow(()=>assertFreeOrder(preview(),game,account.id));
  for(const field of ['totalPrice','walletPaymentAmount','billingPaymentAmount','totalTax','convenienceFee']) {
    const p=preview();p.orderResponse[field]=1;assert.throws(()=>assertFreeOrder(p,game,account.id));
  }
  for(const mutate of [p=>delete p.orderResponse.totalPrice,p=>p.orderResponse.isFree=false,
    p=>p.orderResponse.epicAccountId='other',p=>p.namespace='other',p=>p.country='US',
    p=>p.offers=['other'],p=>p.offers=['offer','other'],p=>p.orderResponse.totalPrice='0']) {
    const p=preview();mutate(p);assert.throws(()=>assertFreeOrder(p,game,account.id));
  }
  assert.throws(()=>assertFreeOrder(preview(),{...game,ends_at:'2020-01-01'},account.id));
});

test('connect seals credentials and returns only safe owner-facing data',async()=>{
  const f=fixture();const view=await f.service.connect('a'.repeat(32));
  const stored=JSON.stringify(f.repo),visible=JSON.stringify(view);
  for(const secret of [session.access_token,session.refresh_token]) {
    assert.ok(!stored.includes(secret));assert.ok(!visible.includes(secret));
  }
  assert.equal(view.account.display_name,account.display_name);
  const state=await unseal(f.repo.encrypted,key);assert.equal(state.session.refresh_token,session.refresh_token);
});

test('new free order is journaled before submission and accepted only after entitlement verification',async()=>{
  const f=fixture();await f.service.connect('a'.repeat(32));
  const result=await f.service.run();assert.equal(f.confirms(),1);
  assert.equal(result.project_acceptance_complete,true);assert.equal(result.results[0].status,'claimed');
  assert.equal(result.acceptance.amount,0);assert.equal(result.acceptance.proof,'active_account_entitlements');
  await f.service.run();assert.equal(f.confirms(),1);assert.equal(f.repo.snapshot.results[0].status,'claimed');
});

test('already-owned games never invoke checkout or fulfill new-claim acceptance',async()=>{
  const f=fixture();f.setOwned([entitlement]);await f.service.connect('a'.repeat(32));
  const result=await f.service.run();assert.equal(f.previews(),0);assert.equal(f.confirms(),0);
  assert.equal(result.results[0].status,'already_owned');assert.equal(result.project_acceptance_complete,false);
});

test('daily credential maintenance rotates tokens without catalog, ownership or checkout requests',async()=>{
  const f=fixture();await f.service.connect('a'.repeat(32));
  for(const method of ['catalog','profile','entitlements','preview','confirm']) f.api[method]=async()=>{throw Error('maintenance must not call '+method);};
  f.api.token=async()=>({...session,refresh_token:'MAINTENANCE_REFRESH'});
  const result=await f.service.refresh();assert.equal(result.status,'ready');
  assert.equal((await f.service.load()).session.refresh_token,'MAINTENANCE_REFRESH');
  assert.equal(result.project_acceptance_complete,false);assert.equal(f.confirms(),0);
});

test('unsafe preview prevents confirmation without creating pending mutation',async()=>{
  const f=fixture();await f.service.connect('a'.repeat(32));
  f.api.preview=async()=>{const p=preview();p.orderResponse.totalPrice=99;return {preview:p};};
  const result=await f.service.run();assert.equal(result.status,'unsafe_order_rejected');assert.equal(f.confirms(),0);
  assert.deepEqual((await f.service.load()).pending,{});
});

test('interrupted confirmation survives restart and is never blindly resubmitted',async()=>{
  const f=fixture();await f.service.connect('a'.repeat(32));let attempts=0;
  f.api.confirm=async()=>{attempts++;throw new EpicError('epic_unavailable');};
  await f.service.run();assert.equal(attempts,1);
  const restarted=new EpicService(f.repo,key,f.api);
  const pending=await restarted.run();assert.equal(attempts,1);
  assert.equal(pending.status,'order_review_required');assert.equal(pending.project_acceptance_complete,false);
  f.setOwned([entitlement]);const recovered=await restarted.run();
  assert.equal(attempts,1);assert.equal(recovered.project_acceptance_complete,true);assert.equal(recovered.status,'ready');
});

test('HTTP success without entitlement is not a successful claim',async()=>{
  const f=fixture();await f.service.connect('a'.repeat(32));f.api.confirm=async()=>{};
  const result=await f.service.run();assert.equal(result.project_acceptance_complete,false);
  assert.equal(result.status,'order_review_required');assert.deepEqual(result.results,[]);
});

test('captcha pauses submissions and refresh rotation survives subsequent network failure',async()=>{
  const f=fixture();await f.service.connect('a'.repeat(32));
  f.api.token=async()=>({...session,refresh_token:'ROTATED_REFRESH'});
  f.api.preview=async()=>{throw new EpicError('verification_required');};
  const result=await f.service.run();assert.equal(result.status,'verification_required');
  assert.equal((await f.service.load()).session.refresh_token,'ROTATED_REFRESH');assert.equal(f.confirms(),0);
  f.api.preview=async()=>{throw Error('must not run while blocked');};
  assert.equal((await f.service.run()).status,'verification_required');
});

test('account switch isolates pending orders, history, and acceptance',async()=>{
  const f=fixture();await f.service.connect('a'.repeat(32));await f.service.run();
  f.api.token=async()=>({...session,account_id:'new-account'});
  f.api.profile=async()=>({...account,id:'new-account'});
  const view=await f.service.connect('b'.repeat(32));assert.equal(view.project_acceptance_complete,false);
  assert.deepEqual(view.results,[]);assert.deepEqual((await f.service.load()).pending,{});
  await f.service.disconnect();assert.equal(f.repo.encrypted,null);assert.equal(f.repo.snapshot.connected,false);
});

test('ownership rejects another account, wrong namespace, revoked and expired entitlements',()=>{
  assert.equal(owns(game,[entitlement],account.id),true);
  for(const e of [{...entitlement,accountId:'other'},{...entitlement,namespace:'other'},
    {...entitlement,status:'REVOKED'},{...entitlement,endDate:'2020-01-01'}]) assert.equal(owns(game,[e],account.id),false);
});

test('API keeps credentials on fixed Epic hosts, disables redirects and stops challenges',async()=>{
  let captured;
  const api=new EpicAPI('TEST_CLIENT_SECRET',async function(url,options){captured={url,options,receiver:this};return Response.json(session);});
  await api.token('refresh_token','TEST_REFRESH');
  assert.ok(captured.url.startsWith('https://account-public-service-prod03.ol.epicgames.com/'));
  assert.equal(captured.options.redirect,'manual');assert.ok(captured.options.body.includes('grant_type=refresh_token'));
  assert.equal(captured.receiver,globalThis);
  const redirect=new EpicAPI('TEST',async()=>new Response('',{status:302,headers:{Location:'https://evil.example'}}));
  await assert.rejects(redirect.catalog('TW'),e=>e.code==='verification_required');
  const captcha=new EpicAPI('TEST',async()=>Response.json({errorCode:'errors.com.epicgames.captcha_required'},{status:400}));
  await assert.rejects(captcha.catalog('TW'),e=>e.code==='verification_required');
});

test('private credential mutations reject service-only access and cross-origin requests before DB',async()=>{
  const env={OWNER_EMAIL:'owner@example.com'};
  const owner={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'};
  for(const path of ['/api/epic/connect','/api/epic/disconnect']) {
    const r=await worker.fetch(new Request('https://private.test'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://private.test'},body:'{}'}),env);
    assert.equal(r.status,403);
    const cross=await worker.fetch(new Request('https://private.test'+path,{method:'POST',headers:{...owner,'Content-Type':'application/json',Origin:'https://evil.test'},body:'{}'}),env);
    assert.equal(cross.status,403);
  }
  const missing=await worker.fetch(new Request('https://private.test/api/epic/connect',{method:'POST',headers:owner,body:'{}'}),env);
  assert.equal(missing.status,403);
  const content=await worker.fetch(new Request('https://private.test/api/epic/run',{method:'POST',body:'{}'}),env);
  assert.equal(content.status,415);
});

test('owner page escapes upstream names and serves code without inline scripts',()=>{
  const html=page(null,{connected:true,status:'ready',account:{display_name:'<script>attack()</script>',country:'TW'},games:[],results:[]});
  assert.ok(!html.includes('<script>attack()'));
  assert.ok(html.includes('&lt;script&gt;attack()&lt;/script&gt;'));
  assert.ok(html.includes('<script src="/client.js" defer>'));
  assert.ok(!clientScript.includes('localStorage'));assert.ok(!clientScript.includes('console.'));
  assert.ok(page({automation_state:'needs_authorization'},null).includes('自动恢复已暂停'));
  assert.ok(page({session_recovery:{status:'relogged_in'}},null).includes('账号核对通过'));
});

test('Worker + real SQLite: owner connect, cloud run, atomic checkpoint, readback and lease conflict',async()=>{
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE automation_state(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL)');
  const adapter={prepare(sql){const statement=db.prepare(sql);return {bind(...args){return {
    first:async()=>statement.get(...args) || null,
    run:async()=>({meta:{changes:Number(statement.run(...args).changes)}})
  };}};},async batch(statements){db.exec('BEGIN');try {for(const s of statements) await s.run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}};
  const env={OWNER_EMAIL:'owner@example.com',DB:adapter,EPIC_CREDENTIAL_KEY:key,EPIC_CLIENT_SECRET:'TEST_CLIENT_SECRET'};
  const originalFetch=globalThis.fetch;let confirmed=false;
  globalThis.fetch=async(url,options)=>{
    if(url.includes('/oauth/token')) return Response.json(session);
    if(url.includes('/public/account/')) return Response.json({...account,displayName:account.display_name});
    if(url.includes('freeGamesPromotions')) return Response.json({data:{Catalog:{searchStore:{elements:[{
      id:game.id,namespace:game.namespace,title:game.title,offerType:'BASE_GAME',items:[{id:'item',namespace:'ns'}],
      price:{totalPrice:{discountPrice:0,originalPrice:100}},promotions:{promotionalOffers:[{promotionalOffers:[{
        startDate:game.starts_at,endDate:game.ends_at,discountSetting:{discountPercentage:0}}]}]}}]}}}});
    if(url.includes('/entitlements?')) return Response.json(confirmed?[entitlement]:[]);
    if(url.includes('ue-launcher-website')) return new Response('<input id="purchaseToken" value="test-purchase">');
    if(url.endsWith('/order-preview')) return Response.json(preview());
    if(url.endsWith('/confirm-order')) {assert.equal(JSON.parse(options.body).totalAmount,0);confirmed=true;return Response.json({confirmation:{orderId:'test-order'}});}
    throw Error('unexpected endpoint');
  };
  const call=(path,body,owner=false)=>worker.fetch(new Request('https://private.test'+path,body===undefined?{}:{
    method:'POST',headers:{'Content-Type':'application/json',...(owner?{Origin:'https://private.test',
      'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'}:{})},body:JSON.stringify(body)}),env);
  try {
    db.prepare('INSERT INTO automation_state VALUES (?,?,?)').run('snapshot',JSON.stringify({project_acceptance_complete:true,results:[],last_success_at:'2026-01-01'}),Date.now());
    assert.equal((await call('/api/epic/connect',{code:'a'.repeat(32)},true)).status,200);
    assert.equal((await call('/api/epic/refresh',{})).status,200);
    assert.equal(confirmed,false);
    const run=await call('/api/epic/run',{});assert.equal(run.status,200);
    assert.equal((await run.json()).project_acceptance_complete,true);
    const stored=db.prepare('SELECT value FROM automation_state WHERE key=?').get('epic_state').value;
    assert.ok(!stored.includes('TEST_ACCESS'));assert.ok(!stored.includes('TEST_REFRESH'));
    assert.equal((await (await call('/api/epic/status')).json()).results[0].status,'claimed');
    assert.equal((await (await call('/api/status')).json()).last_success_at,'2026-01-01');
    const home=await call('/');assert.match(home.headers.get('Content-Security-Policy'),/script-src 'self'/);
    assert.ok((await home.text()).includes('Test free game'));
    const script=await call('/client.js');assert.equal(script.status,200);assert.match(script.headers.get('Cache-Control'),/no-store/);
    db.prepare('INSERT INTO automation_state VALUES (?,?,?)').run('epic_lease','"other-run"',Date.now());
    assert.equal((await call('/api/epic/run',{})).status,409);
    db.prepare('DELETE FROM automation_state WHERE key=?').run('epic_lease');
    assert.equal((await call('/api/epic/disconnect',{},true)).status,200);
    assert.equal((await (await call('/api/epic/status')).json()).connected,false);
  } finally {globalThis.fetch=originalFetch;db.close();}
});
