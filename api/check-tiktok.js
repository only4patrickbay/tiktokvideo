const ALLOWED = /(^|\.)tiktok\.com$/i;
function collectVariants(value, out=[], seen=new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return out; seen.add(value);
  if (Array.isArray(value)) { for (const item of value) collectVariants(item,out,seen); return out; }
  const width=Number(value.width||value.Width||0), height=Number(value.height||value.Height||0), bitrate=Number(value.bitrate||value.bitRate||value.Bitrate||0);
  const url=value.url||value.playAddr||value.play_url||value.downloadAddr;
  if ((width||height||bitrate) && (typeof url==='string'||Array.isArray(url))) out.push({width,height,bitrate,codec:value.codecType||value.codec||null});
  for (const child of Object.values(value)) collectVariants(child,out,seen); return out;
}
function extractJson(html,id){const re=new RegExp(`<script[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`,'i');const m=html.match(re);if(!m)return null;try{return JSON.parse(m[1])}catch{return null}}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store'); if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  let target;try{target=new URL(req.query.url);if(target.protocol!=='https:'||!ALLOWED.test(target.hostname))throw new Error()}catch{return res.status(400).json({error:'Use a valid HTTPS TikTok URL'})}
  try{const response=await fetch(target,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36','accept-language':'en-US,en;q=0.9'}});if(!response.ok)throw new Error(`TikTok returned ${response.status}`);const finalUrl=new URL(response.url);if(!ALLOWED.test(finalUrl.hostname))throw new Error('Unexpected redirect');const html=await response.text();if(html.length>8_000_000)throw new Error('Page response is too large');const state=extractJson(html,'__UNIVERSAL_DATA_FOR_REHYDRATION__')||extractJson(html,'SIGI_STATE');if(!state)throw new Error('TikTok did not expose readable public playback data');const variants=collectVariants(state).filter((v,i,a)=>i===a.findIndex(x=>x.width===v.width&&x.height===v.height&&x.bitrate===v.bitrate)).sort((a,b)=>b.bitrate-a.bitrate).slice(0,12);const title=(html.match(/<title>(.*?)<\/title>/i)?.[1]||'TikTok video').replace(/<[^>]+>/g,'').slice(0,180);return res.status(200).json({title,variants});}catch(e){return res.status(502).json({error:e.message||'Could not inspect this public video'})}
}
