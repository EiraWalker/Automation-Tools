// Public catalogue only. No Epic login, credential storage, or order APIs.
export const catalogueUrl = 'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=TW&allowCountries=TW';
export const freeGamesUrl = 'https://store.epicgames.com/zh-Hant/free-games';

export function productUrl(offer) {
  const candidates = [
    ...(offer.offerMappings || []).map(x=>x.pageSlug),
    ...(offer.catalogNs?.mappings || []).map(x=>x.pageSlug),
    offer.productSlug?.replace(/\/home$/, ''),
    /^[a-f0-9]{32}$/i.test(offer.urlSlug || '') ? null : offer.urlSlug
  ];
  const slug = candidates.find(x=>typeof x==='string' && /^[a-z0-9][a-z0-9-]{0,199}$/i.test(x));
  return slug ? 'https://store.epicgames.com/zh-Hant/p/'+slug : freeGamesUrl;
}

export function freeGames(data, now=Date.now()) {
  const offers=data?.data?.Catalog?.searchStore?.elements;
  if(!Array.isArray(offers)) throw Error('invalid_catalogue');
  const games=new Map();
  for(const offer of offers) {
    const price=offer.price?.totalPrice;
    if(!['BASE_GAME','BUNDLE'].includes(offer.offerType) || price?.discountPrice!==0 || !(price.originalPrice>0)) continue;
    if(typeof offer.id!=='string' || typeof offer.namespace!=='string' || typeof offer.title!=='string') continue;
    const active=(offer.promotions?.promotionalOffers || []).flatMap(x=>x.promotionalOffers || [])
      .filter(p=>p.discountSetting?.discountPercentage===0 && Date.parse(p.startDate)<=now && now<Date.parse(p.endDate))
      .sort((a,b)=>Date.parse(a.endDate)-Date.parse(b.endDate))[0];
    if(!active) continue;
    const url=productUrl(offer);
    games.set(offer.namespace+':'+offer.id,{
      id:offer.id,namespace:offer.namespace,title:offer.title.slice(0,300),url,
      link_type:url===freeGamesUrl?'catalogue':'product',
      starts_at:new Date(active.startDate).toISOString(),ends_at:new Date(active.endDate).toISOString()
    });
  }
  return [...games.values()].sort((a,b)=>a.title.localeCompare(b.title));
}

function catalogueError(code) { const error=new Error(code);error.code=code;return error; }
export async function fetchCatalogue(fetcher=fetch) {
  let response;
  try {
    // Workers supports manual redirect handling; reject redirects explicitly.
    response=await fetcher.call(globalThis,catalogueUrl,{
      method:'GET',redirect:'manual',headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)
    });
  } catch {throw catalogueError('network_error');}
  if(!response.ok) throw catalogueError('upstream_http_'+response.status);
  if(Number(response.headers.get('Content-Length') || 0)>3000000) throw catalogueError('response_too_large');
  const reader=response.body?.getReader(),chunks=[];let length=0;
  if(reader) {
    try {
      while(true) {
        const {done,value}=await reader.read();if(done)break;
        length+=value.length;
        if(length>3000000){await reader.cancel();throw catalogueError('response_too_large');}
        chunks.push(value);
      }
    } catch(error) {throw error.code==='response_too_large'?error:catalogueError('response_read_failed');}
  }
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let data;try {data=JSON.parse(new TextDecoder().decode(bytes));}catch {throw catalogueError('invalid_json');}
  const now=Date.now();let games;
  try {games=freeGames(data,now);}catch {throw catalogueError('invalid_catalogue');}
  return {mode:'manual',country:'TW',updated_at:new Date(now).toISOString(),games};
}

export function linksStatus(snapshot,error=null,now=Date.now()) {
  const games=(snapshot?.games || []).filter(g=>Date.parse(g.starts_at)<=now && now<Date.parse(g.ends_at));
  return {
    mode:'manual',country:'TW',updated_at:snapshot?.updated_at || null,games,
    status:error?'update_failed':!snapshot?'not_updated':games.length?'ready':snapshot.games?.length?'expired':'no_games',
    ...(error?{last_error_at:error.at}:{})
  };
}
