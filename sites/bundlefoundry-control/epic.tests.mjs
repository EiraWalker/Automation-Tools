import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {catalogueUrl,freeGamesUrl,productUrl,freeGames,fetchCatalogue,linksStatus} from './epic.js';
import worker from './worker.js';
import {page,clientScript} from './ui.js';

const now=Date.now();
const offer={id:'offer',namespace:'ns',title:'Free game',offerType:'BASE_GAME',
  catalogNs:{mappings:[{pageSlug:'base-game'}]},offerMappings:[{pageSlug:'correct-edition'}],
  price:{totalPrice:{discountPrice:0,originalPrice:100}},
  promotions:{promotionalOffers:[{promotionalOffers:[{startDate:new Date(now-60000).toISOString(),endDate:new Date(now+86400000).toISOString(),discountSetting:{discountPercentage:0}}]}]}};
const catalogue=(elements=[offer])=>({data:{Catalog:{searchStore:{elements}}}});
function database() {
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE automation_state(key TEXT PRIMARY KEY,value TEXT,updated_at INTEGER)');
  const accessed=[];
  const wrapper={prepare(sql){return {bind(...args){accessed.push(args[0]);const stmt=db.prepare(sql);return {
    first:async()=>stmt.get(...args),run:async()=>({meta:{changes:stmt.run(...args).changes}})
  };}};},batch:async xs=>{db.exec('BEGIN');try{const result=[];for(const x of xs)result.push(await x.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
  return {DB:wrapper,db,accessed};
}
const request=(path,body={},headers={})=>new Request('https://private.test'+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});

test('active free games and bundles exclude paid, permanent free, DLC, future and expired offers',()=>{
  const datePromo=(start,end)=>({promotionalOffers:[{promotionalOffers:[{startDate:start,endDate:end,discountSetting:{discountPercentage:0}}]}]});
  const variants=[offer,{...offer,id:'bundle',offerType:'BUNDLE'},
    {...offer,id:'paid',price:{totalPrice:{discountPrice:1,originalPrice:100}}},
    {...offer,id:'permanent',price:{totalPrice:{discountPrice:0,originalPrice:0}}},
    {...offer,id:'dlc',offerType:'ADD_ON'}, {...offer,id:'upcoming',promotions:datePromo('2099-01-01','2099-02-01')},
    {...offer,id:'expired',promotions:datePromo('2020-01-01','2020-02-01')},offer];
  assert.deepEqual(freeGames(catalogue(variants),now).map(x=>x.id).sort(),['bundle','offer']);
  assert.throws(()=>freeGames({}));
});

test('official product mapping takes precedence, and malformed external slugs cannot become links',()=>{
  assert.equal(productUrl(offer),'https://store.epicgames.com/zh-Hant/p/correct-edition');
  assert.equal(productUrl({productSlug:'test-game/home'}),'https://store.epicgames.com/zh-Hant/p/test-game');
  for(const slug of ['https://evil.test','../secret','a?token=secret','a#fragment','" onclick="evil']) {
    assert.equal(productUrl({offerMappings:[{pageSlug:slug}],productSlug:slug,urlSlug:slug}),freeGamesUrl);
  }
  assert.equal(productUrl({urlSlug:'a'.repeat(32)}),freeGamesUrl);
});

test('fetch reads one fixed public URL without Epic cookies, authorization, or redirects',async()=>{
  const calls=[];
  const result=await fetchCatalogue(async(url,options)=>{calls.push({url,options});return Response.json(catalogue());});
  assert.equal(calls.length,1);assert.equal(calls[0].url,catalogueUrl);
  assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.redirect,'error');
  assert.deepEqual(calls[0].options.headers,{Accept:'application/json'});
  assert.equal(result.mode,'manual');assert.equal(result.games.length,1);
  await assert.rejects(fetchCatalogue(async()=>new Response('',{status:503})));
});

test('old authorization and renewal endpoints and local exporter cannot access credentials',async()=>{
  const env={OWNER_EMAIL:'owner@example.com',DB:{prepare(){throw Error('must not access DB');}}};
  for(const path of ['connect','disconnect','import','refresh']) {
    const r=await worker.fetch(request('/api/epic/'+path,{code:'TEST'}),env);
    assert.equal(r.status,410);assert.equal((await r.json()).mode,'manual');
  }
  assert.equal((await worker.fetch(new Request('https://private.test/epic-authorization/export.py'),env)).status,404);
  assert.equal((await worker.fetch(request('/api/epic/update',{cookies:['TEST']}),env)).status,400);
  assert.equal((await worker.fetch(request('/api/epic/update',{}, {Origin:'https://evil.test'}),env)).status,403);
});

test('update and legacy run alias save only public links; failures preserve cache, Bundle state and encrypted legacy state',async(t)=>{
  const f=database();t.after(()=>f.db.close());
  for(const key of ['checkpoint','snapshot','epic_state','epic_snapshot'])f.db.prepare('INSERT INTO automation_state VALUES (?,?,?)').run(key,JSON.stringify({marker:key}),0);
  let fail=false,calls=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls++;assert.equal(url,catalogueUrl);assert.equal(options.method,'GET');if(fail)throw Error('upstream');return Response.json(catalogue());});
  const env={OWNER_EMAIL:'owner@example.com',DB:f.DB};
  for(const path of ['update','run']) {
    const r=await worker.fetch(request('/api/epic/'+path),env);assert.equal(r.status,200);
    const result=await r.json();assert.equal(result.mode,'manual');assert.equal(result.games[0].url,productUrl(offer));
    const saved=await worker.fetch(new Request('https://private.test/api/epic/status'),env);assert.deepEqual(await saved.json(),result);
  }
  fail=true;assert.equal((await worker.fetch(request('/api/epic/update'),env)).status,503);
  const status=await (await worker.fetch(new Request('https://private.test/api/epic/status'),env)).json();
  assert.equal(status.status,'update_failed');assert.equal(status.games.length,1);assert.equal(calls,3);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM automation_state WHERE key=?').get('epic_links_lease').n,0);
  for(const key of ['checkpoint','snapshot','epic_state','epic_snapshot']) {
    assert.deepEqual(JSON.parse(f.db.prepare('SELECT value FROM automation_state WHERE key=?').get(key).value),{marker:key});
    assert.ok(!f.accessed.includes(key));
  }
  fail=false;assert.equal((await worker.fetch(request('/api/epic/update'),env)).status,200);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM automation_state WHERE key=?').get('epic_links_error').n,0);
});

test('lease stops concurrent catalogue requests before any upstream read',async(t)=>{
  const f=database();t.after(()=>f.db.close());
  f.db.prepare('INSERT INTO automation_state VALUES (?,?,?)').run('epic_links_lease',JSON.stringify('busy'),Date.now());
  t.mock.method(globalThis,'fetch',()=>{throw Error('must not fetch');});
  assert.equal((await worker.fetch(request('/api/epic/update'),{DB:f.DB})).status,409);
});

test('expired games disappear and UI only offers official links and catalogue updates',()=>{
  const snapshot={updated_at:new Date(now).toISOString(),games:freeGames(catalogue(),now)};
  const expired=linksStatus(snapshot,null,now+2*86400000);assert.equal(expired.status,'expired');assert.equal(expired.games.length,0);
  const html=page({project_acceptance_complete:true,acceptance:{bundle_title:'Asset owned'}},linksStatus(snapshot));
  assert.match(html,/每周五台北时间 09:00 更新链接/);assert.match(html,/Asset owned/);
  assert.ok(html.includes(productUrl(offer)));assert.match(html,/本地手动领取/);assert.match(html,/截止/);
  for(const text of ['epic-auth','epic-code','epic-file','本周验收','重新授权 Epic','Cookie'])assert.ok(!html.includes(text));
  assert.ok(!clientScript.includes('/api/epic/run'));assert.ok(!clientScript.includes('/connect'));assert.ok(!clientScript.includes('localStorage'));
  const escaped=page(null,{games:[{...snapshot.games[0],title:'<script>bad</script>'}]});
  assert.ok(!escaped.includes('<script>bad</script>'));assert.ok(escaped.includes('&lt;script&gt;'));
});
