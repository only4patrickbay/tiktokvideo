import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectMp4 } from '../src/mp4.js';
import { patchMp4 } from '../src/patch.js';

const box=(type,...parts)=>{const size=8+parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(size),view=new DataView(out.buffer);view.setUint32(0,size);out.set([...type].map(c=>c.charCodeAt(0)),4);let at=8;for(const part of parts){out.set(part,at);at+=part.length}return out};
const words=(...values)=>{const out=new Uint8Array(values.length*4),view=new DataView(out.buffer);values.forEach((v,i)=>view.setUint32(i*4,v));return out};
const full=(type,...values)=>box(type,new Uint8Array(4),words(...values));

function track(handler,codec,timescale,duration,sizes,chunkOffset,id,width=0,height=0){
  const tkhdBody=new Uint8Array(84),tkhdView=new DataView(tkhdBody.buffer);tkhdView.setUint32(12,id);tkhdView.setUint32(76,width<<16);tkhdView.setUint32(80,height<<16);
  const mdhdBody=new Uint8Array(24),mdhdView=new DataView(mdhdBody.buffer);mdhdView.setUint32(12,timescale);mdhdView.setUint32(16,duration);
  const hdlrBody=new Uint8Array(24);hdlrBody.set([...handler].map(c=>c.charCodeAt(0)),8);
  const sampleEntry=box(codec,new Uint8Array(8));
  const stsd=box('stsd',new Uint8Array(4),words(1),sampleEntry);
  const stbl=box('stbl',stsd,full('stts',1,sizes.length,1),full('stsc',1,1,sizes.length,1),full('stsz',0,sizes.length,...sizes),full('stco',1,chunkOffset));
  return box('trak',box('tkhd',tkhdBody),box('mdia',box('mdhd',mdhdBody),box('hdlr',hdlrBody),box('minf',stbl)));
}

function fixture(){
  const ftyp=box('ftyp',new TextEncoder().encode('isom0000')),video=Uint8Array.from([10,11,12,13]),audio=Uint8Array.from([20,21,22]),mdat=box('mdat',video,audio);
  const videoOffset=ftyp.length+8,audioOffset=videoOffset+video.length,mvhdBody=new Uint8Array(100);new DataView(mvhdBody.buffer).setUint32(96,3);
  const moov=box('moov',box('mvhd',mvhdBody),track('vide','avc1',2,2,[2,2],videoOffset,1,1080,1920),track('soun','mp4a',2,2,[1,2],audioOffset,2));
  return new File([ftyp,mdat,moov],'fixture.mp4',{type:'video/mp4'});
}

test('builds the verified three-track compatibility structure',async()=>{
  const source=fixture(),inspection=await inspectMp4(source),result=await patchMp4(source,inspection);
  assert.equal(result.videoSamples,2);assert.equal(result.audioSamples,2);assert.equal(result.ghostSamples,18);assert.equal(result.tracks,3);
  const output=await inspectMp4(result.blob);assert.equal(output.fastStart,true);assert.equal(output.trailingBytes,18*8);
  await assert.rejects(()=>patchMp4(result.blob,output),/already been patched/);
});
