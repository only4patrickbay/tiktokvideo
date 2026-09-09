import { inspectMp4, formatBytes } from './mp4.js';
import { listHistory, saveHistory, clearHistory } from './history.js';

const $ = id => document.getElementById(id); const input=$('file-input'), drop=$('drop-zone'), job=$('job'), analysis=$('analysis'), message=$('message'), optimize=$('optimize'), download=$('download');
let current=null, outputUrl=null;
const metric=(label,value)=>`<div class="metric"><span>${label}</span><b>${value}</b></div>`;
const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const formatFps=value=>Number.isFinite(Number(value))?`${Number(value).toFixed(Number(value)%1?2:0)} FPS`:'Frame rate unavailable';
function setMessage(text,type=''){message.className=`message ${type}`;message.textContent=text}
function outputName(name){const dot=name.lastIndexOf('.');return `${dot>0?name.slice(0,dot):name}_optimized.mp4`}
async function selectFile(file){
  if(!file)return; if(outputUrl){URL.revokeObjectURL(outputUrl);outputUrl=null} download.classList.add('hidden'); job.classList.remove('hidden'); $('file-name').textContent=file.name; $('file-size').textContent=formatBytes(file.size); optimize.disabled=true; setMessage('Inspecting MP4 structure…'); analysis.innerHTML='';
  try{current=await inspectMp4(file);analysis.innerHTML=metric('VIDEO',current.videoCodec)+metric('AUDIO',current.audioCodec)+metric('INDEX',current.fastStart?'Already forward':'At file end');
    if(current.videoCodec==='Other') throw new Error('No supported H.264 or H.265 video track was detected.');
    if(current.audioCodec==='Not detected') setMessage('An AAC audio track is required, even if it is silent.','error');
    else setMessage('Ready for sample-level patching. The encoded video frames will not be re-encoded.','good'); optimize.disabled=current.audioCodec==='Not detected';
  }catch(e){current=null;setMessage(e.message,'error')}
}
drop.addEventListener('click',()=>input.click()); input.addEventListener('change',()=>selectFile(input.files[0]));
for(const type of ['dragenter','dragover'])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add('drag')});
for(const type of ['dragleave','drop'])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove('drag')});
drop.addEventListener('drop',e=>selectFile(e.dataTransfer.files[0]));
$('reset').addEventListener('click',()=>{current=null;input.value='';job.classList.add('hidden');if(outputUrl)URL.revokeObjectURL(outputUrl)});
optimize.addEventListener('click',async()=>{
  if(!current)return; optimize.disabled=true;$('reset').disabled=true;$('progress-wrap').classList.remove('hidden');$('progress').style.width='5%';setMessage('Preparing the sample-level patch…');
  try{const {patchMp4}=await import('./patch.js');const result=await patchMp4(current.file,current,{onPhase:text=>setMessage(text),onProgress:value=>$('progress').style.width=`${Math.round(12+value*78)}%`});$('progress').style.width='100%';
    const name=outputName(current.file.name);outputUrl=URL.createObjectURL(result.blob);download.href=outputUrl;download.download=name;download.classList.remove('hidden');analysis.innerHTML=metric('VIDEO',`${result.videoSamples} original samples`)+metric('TRACKS',`${result.tracks} verified`)+metric('LAYOUT','Sample-interleaved');setMessage(`Patch complete. Original video frames preserved; ${result.ghostSamples.toLocaleString()} structural audio samples added and verified.`,'good');
    try{await saveHistory(name,result.blob);await renderHistory()}catch{setMessage('Optimization complete. Browser history storage was unavailable; download the file now.','good')}
  }catch(e){setMessage(e.message||'Remuxing failed. No output was created.','error')}finally{optimize.disabled=false;$('reset').disabled=false;setTimeout(()=> $('progress-wrap').classList.add('hidden'),700)}
});

async function renderHistory(){const list=$('history-list');try{const items=await listHistory();if(!items.length){list.innerHTML='<p class="empty">No optimized files yet.</p>';return}list.innerHTML='';for(const item of items){const url=URL.createObjectURL(item.blob);const el=document.createElement('article');el.className='history-card';el.innerHTML=`<div><strong></strong><span>${formatBytes(item.size)} · ${new Date(item.createdAt).toLocaleString()}</span></div><a download>Download</a>`;el.querySelector('strong').textContent=item.name;const a=el.querySelector('a');a.href=url;a.download=item.name;list.append(el)}}catch{list.innerHTML='<p class="empty">Recent-file storage is unavailable in this browser.</p>'}}
$('clear-history').addEventListener('click',async()=>{await clearHistory();await renderHistory()});renderHistory();

$('check-form').addEventListener('submit',async e=>{e.preventDefault();const url=$('tiktok-url').value.trim(), box=$('check-result');let parsed;try{parsed=new URL(url);if(!/(^|\.)tiktok\.com$/i.test(parsed.hostname))throw new Error();}catch{box.innerHTML='<span class="message error">Enter a valid public TikTok URL.</span>';return}box.textContent='Checking resolution, bitrate and frame rate…';try{const res=await fetch(`/api/check-tiktok?url=${encodeURIComponent(url)}`);const data=await res.json();if(!res.ok)throw new Error(data.error||'Check failed');const rows=data.variants?.map(v=>`${v.width||'?'}×${v.height||'?'} · ${v.bitrate?`${(v.bitrate/1e6).toFixed(2)} Mbps`:'bitrate unavailable'} · ${formatFps(v.fps)}`).join('<br>')||'No public variants were exposed.';const summary=data.frameRates?.length?`Detected frame rate: ${data.frameRates.map(formatFps).join(' / ')}`:'TikTok did not expose frame-rate metadata for this post.';box.innerHTML=`<div class="result-card"><b>${escapeHtml(data.title||'TikTok video')}</b><p><strong>${escapeHtml(summary)}</strong><br>${rows}</p><small>Public data only · ${new Date().toLocaleTimeString()}</small></div>`}catch(err){box.innerHTML=`<span class="message error">${escapeHtml(err.message)}. If running locally, deploy the included server function first.</span>`}});
