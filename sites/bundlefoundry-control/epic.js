// Epic business rules live here; only this module handles decrypted tokens.
export const CLIENT_ID = '34a02cf8f4414e29b15921876da36f9a';
const ACCOUNT = 'https://account-public-service-prod03.ol.epicgames.com/account/api';
const ENTITLEMENTS = 'https://entitlement-public-service-prod08.ol.epicgames.com/entitlement/api';
const PAYMENT = 'https://payment-website-pci.ol.epicgames.com/purchase';
const CATALOG = 'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions';
const encoder = new TextEncoder();
const aad = encoder.encode('automation-tools:epic:v1');
const b64 = bytes => btoa(Array.from(bytes, c => String.fromCharCode(c)).join(''));
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const validId = x => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(x);
const timestamp = x => typeof x === 'string' && Number.isFinite(Date.parse(x));

export class EpicError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function loginUrl() {
  const redirect = `https://www.epicgames.com/id/api/redirect?clientId=${CLIENT_ID}&responseType=code`;
  return 'https://www.epicgames.com/id/login?redirectUrl=' + encodeURIComponent(redirect);
}

async function encryptionKey(value) {
  let bytes;
  try { bytes = unb64(value); } catch { throw new EpicError('configuration_required'); }
  if (bytes.length !== 32) throw new EpicError('configuration_required');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(value, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:aad},
    await encryptionKey(key), encoder.encode(JSON.stringify(value)));
  return {version:1, iv:b64(iv), ciphertext:b64(new Uint8Array(ciphertext))};
}
export async function unseal(value, key) {
  try {
    if (value.version !== 1 || unb64(value.iv).length !== 12) throw Error();
    const plaintext = await crypto.subtle.decrypt({name:'AES-GCM', iv:unb64(value.iv), additionalData:aad},
      await encryptionKey(key), unb64(value.ciphertext));
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch { throw new EpicError('credential_unreadable'); }
}

export function freeGames(data, country, now = Date.now()) {
  const elements = data?.data?.Catalog?.searchStore?.elements;
  if (!Array.isArray(elements)) throw new EpicError('catalog_unavailable');
  const games = new Map();
  for (const offer of elements) {
    const price = offer.price?.totalPrice;
    const windows = offer.promotions?.promotionalOffers?.flatMap(x => x.promotionalOffers || []) || [];
    const active = windows.find(x => timestamp(x.startDate) && timestamp(x.endDate) &&
      Date.parse(x.startDate) <= now && now < Date.parse(x.endDate) &&
      x.discountSetting?.discountPercentage === 0);
    if (!active || offer.offerType !== 'BASE_GAME' || price?.discountPrice !== 0 ||
        !Number.isSafeInteger(price?.originalPrice) || price.originalPrice <= 0 ||
        !validId(offer.id) || !validId(offer.namespace) || !Array.isArray(offer.items) ||
        !offer.items.length || !offer.items.every(x => validId(x.id) && x.namespace === offer.namespace)) continue;
    games.set(`${offer.namespace}:${offer.id}`, {
      id:offer.id, namespace:offer.namespace, items:offer.items.map(x => x.id),
      title:String(offer.title || offer.id).slice(0,300), country,
      starts_at:active.startDate, ends_at:active.endDate,
      url:'https://store.epicgames.com/'
    });
  }
  return [...games.values()].slice(0,20);
}

export function owns(game, entitlements, accountId, now = Date.now()) {
  return game.items.every(id => entitlements.some(e => e.namespace === game.namespace &&
    e.catalogItemId === id && e.status === 'ACTIVE' && (!e.accountId || e.accountId === accountId) &&
    (!e.endDate || (timestamp(e.endDate) && Date.parse(e.endDate) > now))));
}

// Reject missing/ambiguous amounts as well as nonzero amounts. Never select a
// stored card, wallet balance, quickPurchase, or a paid order endpoint.
export function assertFreeOrder(preview, game, accountId, now = Date.now()) {
  const order = preview?.orderResponse;
  const offers = preview?.offers?.map(o => typeof o === 'string' ? o : o?.id || o?.offerId);
  const required = ['totalPrice','walletPaymentAmount','billingPaymentAmount'];
  const optional = ['totalTax','convenienceFee'];
  if (!order || order.error || order.isFree !== true || order.epicAccountId !== accountId ||
      order.orderStatus !== 'PREVIEW' || required.some(k => order[k] !== 0) ||
      optional.some(k => order[k] !== undefined && order[k] !== 0) ||
      preview.namespace !== game.namespace || preview.country !== game.country ||
      !Array.isArray(offers) || offers.length !== 1 || offers[0] !== game.id ||
      typeof preview.syncToken !== 'string' || !preview.syncToken ||
      now >= Date.parse(game.ends_at)) throw new EpicError('unsafe_order_rejected');
}

function classify(response, body) {
  const code = String(body?.errorCode || body?.error || body?.orderResponse?.error || '').toLowerCase();
  if (/captcha|challenge|fraud/.test(code)) return 'verification_required';
  if (/eula|consent|age|parental|region|country/.test(code)) return 'account_action_required';
  if (/invalid_grant|invalid.*token|authentication_failed|token_verification_failed/.test(code) || response.status === 401) return 'login_required';
  return response.status === 429 ? 'rate_limited' : 'epic_unavailable';
}

export class EpicAPI {
  constructor(secret, fetcher = fetch) { this.secret = secret; this.fetcher = fetcher; this.deadline=Date.now()+150000; }
  async request(url, options = {}, html = false) {
    let response;
    const remaining=this.deadline-Date.now();
    if(remaining<=0) throw new EpicError('epic_unavailable');
    try {
      // Worker host functions need their global receiver; invoking a saved
      // native fetch as this.fetcher(...) can fail with Illegal invocation.
      response = await this.fetcher.call(globalThis,url, {...options, redirect:'manual', signal:AbortSignal.timeout(Math.min(20000,remaining))});
    } catch { throw new EpicError('epic_unavailable'); }
    if (response.status >= 300 && response.status < 400) throw new EpicError('verification_required');
    if (Number(response.headers.get('Content-Length') || 0) > 3000000) throw new EpicError('epic_unavailable');
    // Bound streamed bodies too; an absent Content-Length does not relax the cap.
    const reader = response.body?.getReader();
    const chunks = []; let length = 0;
    if (reader) {
      try {
        while (true) {
          const {done,value} = await reader.read(); if (done) break;
          length += value.length;
          if (length > 3000000) { await reader.cancel(); throw Error(); }
          chunks.push(value);
        }
      } catch { throw new EpicError('epic_unavailable'); }
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
    const text = new TextDecoder().decode(bytes);
    let body;
    if (!html) { try { body = JSON.parse(text); } catch { throw new EpicError('epic_unavailable'); } }
    if (!response.ok || body?.errorCode || body?.error || body?.orderResponse?.error) throw new EpicError(classify(response, body));
    return html ? text : body;
  }
  async token(grant, value) {
    if (!this.secret) throw new EpicError('configuration_required');
    const form = new URLSearchParams({grant_type:grant,token_type:'eg1'});
    form.set(grant === 'refresh_token' ? 'refresh_token' : 'code', value);
    const data = await this.request(ACCOUNT+'/oauth/token', {
      method:'POST', headers:{Authorization:'Basic '+btoa(CLIENT_ID+':'+this.secret),
        'Content-Type':'application/x-www-form-urlencoded'}, body:form.toString()
    });
    if (!validId(data.account_id) || typeof data.access_token !== 'string' || !data.access_token ||
        typeof data.refresh_token !== 'string' || !data.refresh_token || !timestamp(data.expires_at) ||
        Date.parse(data.expires_at) <= Date.now()+60000 || !timestamp(data.refresh_expires_at) ||
        Date.parse(data.refresh_expires_at) <= Date.now()+60000) throw new EpicError('login_required');
    return {account_id:data.account_id, access_token:data.access_token, refresh_token:data.refresh_token,
      expires_at:data.expires_at, refresh_expires_at:data.refresh_expires_at};
  }
  auth(session) { return {Authorization:'Bearer '+session.access_token}; }
  async profile(session) {
    const p = await this.request(ACCOUNT+'/public/account/'+session.account_id, {headers:this.auth(session)});
    if (p.id !== session.account_id || !/^[A-Z]{2}$/.test(p.country)) throw new EpicError('account_action_required');
    return {id:p.id, display_name:String(p.displayName || 'Epic account').slice(0,120), country:p.country};
  }
  async catalog(country) {
    if (!/^[A-Z]{2}$/.test(country)) throw new EpicError('account_action_required');
    const url = new URL(CATALOG);
    url.search = new URLSearchParams({locale:'en-US',country,allowCountries:country});
    return freeGames(await this.request(url.href), country);
  }
  async entitlements(session) {
    const all = [];
    for (let start=0; start<50000; start+=1000) {
      const rows = await this.request(`${ENTITLEMENTS}/account/${session.account_id}/entitlements?start=${start}&count=1000`, {headers:this.auth(session)});
      if (!Array.isArray(rows)) throw new EpicError('ownership_unavailable');
      all.push(...rows);
      if (rows.length < 1000) return all;
    }
    throw new EpicError('ownership_unavailable');
  }
  async preview(session, game) {
    const url = new URL('https://ue-launcher-website-prod.ol.epicgames.com/purchase');
    url.search = new URLSearchParams({showNavigation:'true',namespace:game.namespace,offers:game.id});
    const html = await this.request(url.href,{headers:this.auth(session)},true);
    const input = html.match(/<input\b[^>]*\bid=["']purchaseToken["'][^>]*>/i)?.[0];
    const purchaseToken = input?.match(/\bvalue=["']([^"']+)["']/i)?.[1];
    if (!purchaseToken || !/^[A-Za-z0-9._~+\/-]{1,2048}$/.test(purchaseToken)) throw new EpicError('checkout_action_required');
    const headers = {...this.auth(session),'Content-Type':'application/json','x-requested-with':purchaseToken};
    const preview = await this.request(PAYMENT+'/order-preview',{method:'POST',headers,body:JSON.stringify({
      useDefault:true,setDefault:false,namespace:game.namespace,country:null,countryName:null,
      orderId:null,orderComplete:null,orderError:null,orderPending:null,offers:[game.id],offerPrice:''
    })});
    assertFreeOrder(preview, game, session.account_id);
    return {preview,purchaseToken};
  }
  async confirm(session, game, checkout) {
    assertFreeOrder(checkout.preview,game,session.account_id);
    const p = checkout.preview;
    const result=await this.request(PAYMENT+'/confirm-order',{method:'POST',
      headers:{...this.auth(session),'Content-Type':'application/json','x-requested-with':checkout.purchaseToken},
      body:JSON.stringify({useDefault:true,setDefault:false,namespace:game.namespace,country:game.country,
        countryName:p.countryName,orderId:null,orderComplete:null,orderError:null,orderPending:null,
        offers:p.offers,includeAccountBalance:false,totalAmount:0,affiliateId:'',creatorSource:'',syncToken:p.syncToken})
    });
    if(result.confirmation!==true && !validId(result.confirmation?.orderId)) throw new EpicError('order_review_required');
    return {confirmed:true,order_id:validId(result.confirmation?.orderId)?result.confirmation.orderId:null};
  }
}

export function configuredTargets(env) {
  let targets;
  try { targets=JSON.parse(env.EPIC_ACCEPTANCE_TARGETS || '[]'); } catch { throw new EpicError('configuration_required'); }
  if(!Array.isArray(targets) || targets.length>20 || !targets.every(g=>validId(g.id) && validId(g.namespace) &&
    typeof g.title==='string' && g.title.length<=300 && Array.isArray(g.items) && g.items.length &&
    g.items.every(validId) && timestamp(g.ends_at))) throw new EpicError('configuration_required');
  if(new Set(targets.map(g=>g.namespace+':'+g.id)).size!==targets.length) throw new EpicError('configuration_required');
  return targets;
}

export function summary(state,targets=[]) {
  const goal=targets.map(g=>{
    const result=state?.results?.[g.namespace+':'+g.id];
    const complete=result?.status==='claimed' && result.free_order_verified===true && result.confirmation_received===true;
    return {id:g.id,namespace:g.namespace,title:g.title,ends_at:g.ends_at,
      status:complete?'claimed':result?.status || 'pending',verified_at:result?.verified_at || null};
  });
  const completed=goal.filter(g=>g.status==='claimed').length;
  const acceptance_progress={completed_count:completed,required_count:goal.length,targets:goal};
  const project_acceptance_complete=goal.length>0 && completed===goal.length;
  if (!state) return {connected:false,status:'not_connected',games:[],results:[],project_acceptance_complete,acceptance_progress};
  return {connected:true,status:state.status || 'ready',
    account:{display_name:state.account.display_name,country:state.account.country},
    last_success_at:state.last_success_at || null, refreshed_at:state.refreshed_at || null,
    refresh_expires_at:state.session.refresh_expires_at,
    refresh_interval_warning:Date.parse(state.session.refresh_expires_at)-Date.now()<13*3600000,
    games:state.games || [], results:Object.values(state.results || {}).slice(-100),
    project_acceptance_complete,acceptance_progress,acceptance:state.acceptance || null};
}

// Repository.save atomically persists the encrypted state and safe UI snapshot.
// Caller must hold the shared D1 lease for connect, run, and disconnect.
export class EpicService {
  constructor(repository, key, api, targets=[]) { this.repository=repository; this.key=key; this.api=api;this.targets=targets; }
  view(state) { return summary(state,this.targets); }
  async load() {
    const encrypted = await this.repository.read();
    return encrypted ? unseal(encrypted,this.key) : null;
  }
  async save(state) { await this.repository.save(state ? await seal(state,this.key) : null,this.view(state)); }
  async connect(code) {
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(code)) throw new EpicError('invalid_code');
    const previous = await this.load();
    const session = await this.api.token('authorization_code',code);
    const account = await this.api.profile(session);
    const state = previous?.account.id === account.id ? previous : {results:{},pending:{}};
    Object.assign(state,{account,session,status:'ready',refreshed_at:new Date().toISOString()});
    await this.save(state);
    return this.view(state);
  }
  async disconnect() { await this.save(null); return this.view(null); }
  async renew(state) {
    if (Date.parse(state.session.refresh_expires_at) <= Date.now()) throw new EpicError('login_required');
    const session=await this.api.token('refresh_token',state.session.refresh_token);
    if(session.account_id!==state.account.id) throw new EpicError('login_required');
    state.session=session;state.refreshed_at=new Date().toISOString();
    await this.save(state);
    return session;
  }
  async refresh() {
    const state=await this.load();
    if(!state) return this.view(null);
    try { await this.renew(state); }
    catch(error) { state.status=error instanceof EpicError?error.code:'epic_unavailable';await this.save(state); }
    return this.view(state);
  }
  recordOwned(state, game, attempt) {
    const key = `${game.namespace}:${game.id}`;
    const at = new Date().toISOString();
    const automatic=attempt?.free_order_verified===true && attempt.confirmation?.confirmed===true;
    const receipt = {title:game.title,id:game.id,namespace:game.namespace,items:game.items,
      status:automatic?'claimed':attempt?'ownership_verified_unconfirmed':'already_owned',verified_at:at,
      proof:'active_account_entitlements',free_order_verified:attempt?.free_order_verified===true,
      confirmation_received:automatic,order_id:attempt?.confirmation?.order_id || null,
      requested_at:attempt?.submitted_at || null,confirmed_at:attempt?.confirmation?.at || null};
    // Keep the original newly-claimed receipt on subsequent ownership checks.
    if (!['claimed','ownership_verified_unconfirmed'].includes(state.results[key]?.status)) state.results[key] = receipt;
    if (automatic && !state.acceptance) state.acceptance = {...receipt,amount:0,country:state.account.country};
    delete state.pending[key];
  }
  async run() {
    let state = await this.load();
    if (!state) {
      const view = {...this.view(null),games:await this.api.catalog('TW'),checked_at:new Date().toISOString()};
      await this.repository.save(null,view); return view;
    }
    try {
      // Always rotate before the weekly claim, persisting new refresh tokens
      // before any subsequent request can fail.
      const session=await this.renew(state);
      state.account = await this.api.profile(session);
      state.games = await this.api.catalog(state.account.country);
      let owned = await this.api.entitlements(session);
      // Resolve interrupted submissions first, including games no longer on sale.
      for (const pending of Object.values(state.pending)) {
        if (owns(pending.game,owned,state.account.id)) this.recordOwned(state,pending.game,pending);
      }
      if(Object.keys(state.pending).length || Object.values(state.results).some(r=>r.status==='ownership_verified_unconfirmed')) state.status='order_review_required';
      else if(['epic_unavailable','rate_limited','ownership_unavailable','order_review_required'].includes(state.status)) state.status='ready';
      await this.save(state);
      for (const game of state.games) {
        const key = `${game.namespace}:${game.id}`;
        if (owns(game,owned,state.account.id)) {
          this.recordOwned(state,game,state.pending[key]);
          continue;
        }
        if (state.pending[key]) { state.status='order_review_required'; continue; }
        // Human-required errors are rechecked for ownership but never blindly
        // retried. Reconnect after official verification to resume submissions.
        if (state.status !== 'ready' && state.status !== 'epic_unavailable' && state.status !== 'rate_limited') continue;
        const checkout = await this.api.preview(session,game);
        assertFreeOrder(checkout.preview,game,state.account.id);
        state.pending[key] = {game,submitted_at:new Date().toISOString(),free_order_verified:true};
        await this.save(state); // Durable journal BEFORE the mutating request.
        const confirmation=await this.api.confirm(session,game,checkout);
        if(confirmation?.confirmed!==true) throw new EpicError('order_review_required');
        state.pending[key].confirmation={...confirmation,at:new Date().toISOString()};
        await this.save(state);
        owned = await this.api.entitlements(session);
        if (!owns(game,owned,state.account.id)) {
          state.status='order_review_required';
          await this.save(state); continue;
        }
        this.recordOwned(state,game,state.pending[key]);
        await this.save(state);
      }
      if (Object.keys(state.pending).length) state.status='order_review_required';
      state.last_success_at = new Date().toISOString();
      await this.save(state);
      return this.view(state);
    } catch (error) {
      state.status = error instanceof EpicError ? error.code : 'epic_unavailable';
      await this.save(state);
      return this.view(state);
    }
  }
}
