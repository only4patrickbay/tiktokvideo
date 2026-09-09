const latin1 = new TextDecoder('latin1');
const GHOSTS_PER_AUDIO_SAMPLE = 9;
const GHOST_SAMPLE = Uint8Array.from([0, 0, 0, 4, 0, 0, 0, 0]);

const read32 = (bytes, at) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, false);
const write32 = (bytes, at, value) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(at, value >>> 0, false);
function read64(bytes, at) { return Number((BigInt(read32(bytes, at)) << 32n) | BigInt(read32(bytes, at + 4))); }
function write64(bytes, at, value) { const n=BigInt(value);write32(bytes,at,Number(n>>32n));write32(bytes,at+4,Number(n&0xffffffffn)); }
const typeAt = (bytes, at) => latin1.decode(bytes.subarray(at + 4, at + 8));

function boxes(bytes, start, end) {
  const result=[]; let at=start;
  while(at+8<=end){let size=read32(bytes,at),header=8;const type=typeAt(bytes,at);if(size===1){if(at+16>end)break;size=read64(bytes,at+8);header=16}else if(size===0)size=end-at;if(!Number.isSafeInteger(size)||size<header||at+size>end)break;result.push({type,start:at,end:at+size,size,header,dataStart:at+header+(type==='meta'?4:0)});at+=size}
  return result;
}
const children=(bytes,parent)=>boxes(bytes,parent.dataStart,parent.end);
const child=(bytes,parent,type)=>children(bytes,parent).find(item=>item.type===type)||null;
function path(bytes,parent,names){let current=parent;for(const name of names){current=child(bytes,current,name);if(!current)return null}return current}

function join(parts){const size=parts.reduce((sum,part)=>sum+part.length,0),out=new Uint8Array(size);let at=0;for(const part of parts){out.set(part,at);at+=part.length}return out}
function makeBox(type,...payload){const body=join(payload),out=new Uint8Array(body.length+8);write32(out,0,out.length);for(let i=0;i<4;i++)out[4+i]=type.charCodeAt(i);out.set(body,8);return out}
function fullBox(type,values){const body=new Uint8Array(4+values.length*4);for(let i=0;i<values.length;i++)write32(body,4+i*4,values[i]);return makeBox(type,body)}

function parseStts(bytes,box){const count=read32(bytes,box.dataStart+4),out=[];for(let i=0;i<count;i++)out.push({count:read32(bytes,box.dataStart+8+i*8),delta:read32(bytes,box.dataStart+12+i*8)});return out}
function parseStsc(bytes,box){const count=read32(bytes,box.dataStart+4),out=[];for(let i=0;i<count;i++)out.push({first:read32(bytes,box.dataStart+8+i*12),samples:read32(bytes,box.dataStart+12+i*12),description:read32(bytes,box.dataStart+16+i*12)});return out}
function parseStsz(bytes,box){const fixed=read32(bytes,box.dataStart+4),count=read32(bytes,box.dataStart+8);if(fixed)return new Array(count).fill(fixed);const out=[];for(let i=0;i<count;i++)out.push(read32(bytes,box.dataStart+12+i*4));return out}
function parseOffsets(bytes,box){const count=read32(bytes,box.dataStart+4),wide=box.type==='co64',out=[];for(let i=0;i<count;i++)out.push(wide?read64(bytes,box.dataStart+8+i*8):read32(bytes,box.dataStart+8+i*4));return out}
function sampleTimes(entries,timescale,count){const out=new Array(count);let sample=0,clock=0;for(const entry of entries)for(let i=0;i<entry.count&&sample<count;i++){out[sample++]=clock/timescale;clock+=entry.delta}const fallback=entries.at(-1)?.delta||1;while(sample<count){out[sample++]=clock/timescale;clock+=fallback}return out}
function sampleOffsets(stsc,chunkOffsets,sizes){const out=new Array(sizes.length);let sample=0,entryIndex=0;for(let chunk=1;chunk<=chunkOffsets.length&&sample<sizes.length;chunk++){while(entryIndex+1<stsc.length&&stsc[entryIndex+1].first<=chunk)entryIndex++;let at=chunkOffsets[chunk-1];for(let i=0;i<stsc[entryIndex].samples&&sample<sizes.length;i++){out[sample]=at;at+=sizes[sample++]}}if(sample!==sizes.length)throw new Error('The MP4 sample-to-chunk table is incomplete.');return out}

function trackInfo(bytes,trak){
  const hdlr=path(bytes,trak,['mdia','hdlr']),mdhd=path(bytes,trak,['mdia','mdhd']),stbl=path(bytes,trak,['mdia','minf','stbl']);
  if(!hdlr||!mdhd||!stbl)throw new Error('An MP4 track is missing required metadata.');
  const handler=latin1.decode(bytes.subarray(hdlr.dataStart+8,hdlr.dataStart+12));
  if(handler!=='vide'&&handler!=='soun')throw new Error(`Unsupported ${handler||'unknown'} track found.`);
  const stsd=child(bytes,stbl,'stsd'),stts=child(bytes,stbl,'stts'),stscBox=child(bytes,stbl,'stsc'),stsz=child(bytes,stbl,'stsz'),offsetBox=child(bytes,stbl,'stco')||child(bytes,stbl,'co64');
  if(!stsd||!stts||!stscBox||!stsz||!offsetBox)throw new Error('An MP4 track has incomplete sample tables.');
  const codec=latin1.decode(bytes.subarray(stsd.dataStart+12,stsd.dataStart+16));
  const version=bytes[mdhd.dataStart],timescale=read32(bytes,mdhd.dataStart+(version===0?12:20));
  const sizes=parseStsz(bytes,stsz),stsc=parseStsc(bytes,stscBox),chunkOffsets=parseOffsets(bytes,offsetBox);
  return {trak,handler,codec,mdhd,stbl,stscBox,offsetBox,sizes,stsc,chunkOffsets,offsets:sampleOffsets(stsc,chunkOffsets,sizes),times:sampleTimes(parseStts(bytes,stts),timescale,sizes.length)};
}

function analyze(bytes){
  const root={start:0,end:bytes.length,header:8,dataStart:8},tracks=children(bytes,root).filter(box=>box.type==='trak').map(box=>trackInfo(bytes,box));
  const videos=tracks.filter(track=>track.handler==='vide'),audios=tracks.filter(track=>track.handler==='soun');
  if(videos.length!==1)throw new Error('Exactly one video track is required.');
  if(audios.length!==1){if(audios.length>1)throw new Error('This video appears to have already been patched. Start again from the original file.');throw new Error('An AAC audio track is required, even if it is silent.')}
  if(!['avc1','avc3','hvc1','hev1'].includes(videos[0].codec))throw new Error('Only H.264 or H.265 video is supported.');
  if(audios[0].codec!=='mp4a')throw new Error('The audio track must use AAC.');
  return {root,tracks,video:videos[0],audio:audios[0]};
}

function makeStts(entries){return fullBox('stts',[entries.length,...entries.flatMap(entry=>[entry.count,entry.delta])])}
function makeStsc(entries){return fullBox('stsc',[entries.length,...entries.flatMap(entry=>[entry.first,entry.samples,entry.description])])}
function makeStsz(sizes){return fullBox('stsz',[0,sizes.length,...sizes])}
function makeOffsets(offsets,forceWide=false){
  const wide=forceWide||offsets.some(value=>value>0xffffffff);
  if(!wide)return fullBox('stco',[offsets.length,...offsets]);
  const body=new Uint8Array(8+offsets.length*8);write32(body,4,offsets.length);offsets.forEach((value,index)=>write64(body,8+index*8,value));return makeBox('co64',body);
}

function replaceContainer(bytes,parent,replacements){return makeBox(parent.type,...children(bytes,parent).map(box=>replacements.get(box.start)||bytes.subarray(box.start,box.end)))}
function rebuildTrack(bytes,track,newOffsets){
  const stbl=replaceContainer(bytes,track.stbl,new Map([
    [track.stscBox.start,makeStsc([{first:1,samples:1,description:1}])],
    [track.offsetBox.start,makeOffsets(newOffsets,track.offsetBox.type==='co64')]
  ]));
  const minf=path(bytes,track.trak,['mdia','minf']),mdia=path(bytes,track.trak,['mdia']);
  const rebuiltMinf=replaceContainer(bytes,minf,new Map([[track.stbl.start,stbl]]));
  const rebuiltMdia=replaceContainer(bytes,mdia,new Map([[minf.start,rebuiltMinf]]));
  return replaceContainer(bytes,track.trak,new Map([[mdia.start,rebuiltMdia]]));
}

function cloneAudioTrack(bytes,audio,realOffsets,fillerOffset,newTrackId,ghostCount){
  const originalStts=parseStts(bytes,child(bytes,audio.stbl,'stts'));
  const stbl=replaceContainer(bytes,audio.stbl,new Map([
    [child(bytes,audio.stbl,'stts').start,makeStts([...originalStts,{count:ghostCount,delta:1}])],
    [audio.stscBox.start,makeStsc([{first:1,samples:1,description:1},{first:audio.sizes.length+1,samples:ghostCount,description:1}])],
    [child(bytes,audio.stbl,'stsz').start,makeStsz([...audio.sizes,...new Array(ghostCount).fill(GHOST_SAMPLE.length)])],
    [audio.offsetBox.start,makeOffsets([...realOffsets,fillerOffset],audio.offsetBox.type==='co64')]
  ]));
  const minf=path(bytes,audio.trak,['mdia','minf']),mdia=path(bytes,audio.trak,['mdia']);
  const rebuiltMinf=replaceContainer(bytes,minf,new Map([[audio.stbl.start,stbl]]));
  const mdhd=bytes.slice(audio.mdhd.start,audio.mdhd.end),version=mdhd[audio.mdhd.header];
  if(version===0){const at=audio.mdhd.header+16;write32(mdhd,at,read32(mdhd,at)+ghostCount)}else{const at=audio.mdhd.header+24;write64(mdhd,at,read64(mdhd,at)+ghostCount)}
  const rebuiltMdia=replaceContainer(bytes,mdia,new Map([[minf.start,rebuiltMinf],[audio.mdhd.start,mdhd]]));
  const tkhd=child(bytes,audio.trak,'tkhd'),newTkhd=bytes.slice(tkhd.start,tkhd.end),idAt=tkhd.header+(newTkhd[tkhd.header]===0?12:20);write32(newTkhd,idAt,newTrackId);
  // The compatibility track intentionally contains only tkhd + mdia. Reusing the
  // source edit list would clamp its visible duration back to the original track.
  return makeBox('trak',newTkhd,rebuiltMdia);
}

function rebuildMoov(bytes,info,trackOffsets,fillerOffset,newTrackId,ghostCount){
  const replacements=new Map();
  for(let i=0;i<info.tracks.length;i++)replacements.set(info.tracks[i].trak.start,rebuildTrack(bytes,info.tracks[i],trackOffsets[i]));
  const mvhd=child(bytes,info.root,'mvhd'),newMvhd=bytes.slice(mvhd.start,mvhd.end);write32(newMvhd,newMvhd.length-4,newTrackId+1);replacements.set(mvhd.start,newMvhd);
  const clone=cloneAudioTrack(bytes,info.audio,trackOffsets[info.tracks.indexOf(info.audio)],fillerOffset,newTrackId,ghostCount);
  const parts=[];let inserted=false;
  for(const box of children(bytes,info.root)){if(box.type==='udta'&&!inserted){parts.push(clone);inserted=true}parts.push(replacements.get(box.start)||bytes.subarray(box.start,box.end))}
  if(!inserted)parts.push(clone);
  return makeBox('moov',...parts);
}

function interleave(tracks,start,onProgress){
  const cursors=tracks.map(()=>0),total=tracks.reduce((sum,track)=>sum+track.sizes.length,0),slices=[],offsets=tracks.map(track=>new Array(track.sizes.length));let outputAt=start;
  for(let done=0;done<total;done++){
    let selected=-1,best=Infinity;
    for(let i=0;i<tracks.length;i++){const sample=cursors[i];if(sample>=tracks[i].sizes.length)continue;const time=tracks[i].times[sample];if(time<best-1e-9||(Math.abs(time-best)<=1e-9&&tracks[i].handler==='vide'&&(selected<0||tracks[selected].handler!=='vide'))){selected=i;best=time}}
    const sample=cursors[selected]++,size=tracks[selected].sizes[sample];slices.push({src:tracks[selected].offsets[sample],size});offsets[selected][sample]=outputAt;outputAt+=size;if(done%100===0)onProgress?.(done/total)
  }
  return {slices,offsets,end:outputAt};
}

function mdatHeader(payloadSize){const total=payloadSize+8;if(total<=0xffffffff){const out=new Uint8Array(8);write32(out,0,total);out.set([109,100,97,116],4);return out}const out=new Uint8Array(16);write32(out,0,1);out.set([109,100,97,116],4);write64(out,8,payloadSize+16);return out}
function mergeSlices(file,slices){const parts=[];let start=-1,end=-1;for(const slice of slices){if(slice.src===end){end+=slice.size;continue}if(start>=0)parts.push(file.slice(start,end));start=slice.src;end=slice.src+slice.size}if(start>=0)parts.push(file.slice(start,end));return parts}

export async function patchMp4(file,inspection,{onPhase,onProgress}={}){
  onPhase?.('Reading MP4 tracks and sample tables…');
  const info=analyze(inspection.moovBytes),ghostCount=info.audio.sizes.length*GHOSTS_PER_AUDIO_SAMPLE;
  const realBytes=info.tracks.reduce((sum,track)=>sum+track.sizes.reduce((a,b)=>a+b,0),0),fillerBytes=ghostCount*GHOST_SAMPLE.length;
  // Keep compatibility samples beyond the declared mdat boundary. Their sample
  // offsets remain valid, while the media box describes only the original data.
  const header=mdatHeader(realBytes);
  const ftyp=new Uint8Array(await file.slice(inspection.ftyp.start,inspection.ftyp.end).arrayBuffer()),newTrackId=read32(inspection.moovBytes,child(inspection.moovBytes,info.root,'mvhd').end-4);
  const placeholders=info.tracks.map(track=>new Array(track.sizes.length).fill(0));
  const draftMoov=rebuildMoov(inspection.moovBytes,info,placeholders,0,newTrackId,ghostCount),mediaStart=ftyp.length+draftMoov.length+header.length;
  onPhase?.('Interleaving every video and audio sample…');
  const layout=interleave(info.tracks,mediaStart,onProgress),fillerOffset=layout.end;
  const moov=rebuildMoov(inspection.moovBytes,info,layout.offsets,fillerOffset,newTrackId,ghostCount);
  if(moov.length!==draftMoov.length)throw new Error('The rebuilt MP4 index changed size unexpectedly.');
  onPhase?.('Building and verifying the three-track output…');
  const filler=new Uint8Array(fillerBytes);for(let at=0;at<filler.length;at+=GHOST_SAMPLE.length)filler.set(GHOST_SAMPLE,at);
  const blob=new Blob([ftyp,moov,header,...mergeSlices(file,layout.slices),filler],{type:'video/mp4'});
  const verified=analyzePatchedMoov(moov,info.video.sizes,info.audio.sizes,ghostCount);
  if(!verified)throw new Error('The patched track structure did not pass verification.');
  onProgress?.(1);
  return {blob,videoSamples:info.video.sizes.length,audioSamples:info.audio.sizes.length,ghostSamples:ghostCount,tracks:3};
}

function analyzePatchedMoov(moov,videoSizes,audioSizes,ghostCount){
  const root={start:0,end:moov.length,header:8,dataStart:8},tracks=children(moov,root).filter(box=>box.type==='trak').map(box=>trackInfo(moov,box));
  if(tracks.length!==3)return false;
  const video=tracks.find(track=>track.handler==='vide'),audios=tracks.filter(track=>track.handler==='soun');
  const same=(a,b)=>a.length===b.length&&a.every((value,index)=>value===b[index]);
  return !!video&&audios.length===2&&same(video.sizes,videoSizes)&&same(audios[0].sizes,audioSizes)&&audios[1].sizes.length===audioSizes.length+ghostCount&&same(audios[1].sizes.slice(0,audioSizes.length),audioSizes)&&audios[1].sizes.slice(audioSizes.length).every(size=>size===GHOST_SAMPLE.length);
}
