const textDecoder = new TextDecoder('latin1');

function u32(view, offset) { return view.getUint32(offset, false); }
function setU32(view, offset, value) { view.setUint32(offset, value, false); }
function u64(view, offset) {
  return (BigInt(view.getUint32(offset, false)) << 32n) | BigInt(view.getUint32(offset + 4, false));
}
function setU64(view, offset, value) {
  view.setUint32(offset, Number((value >> 32n) & 0xffffffffn), false);
  view.setUint32(offset + 4, Number(value & 0xffffffffn), false);
}
function fourcc(bytes, offset) { return textDecoder.decode(bytes.subarray(offset, offset + 4)); }

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB']; let n = bytes; let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

async function readHeader(file, offset) {
  const head = new Uint8Array(await file.slice(offset, Math.min(file.size, offset + 16)).arrayBuffer());
  if (head.length < 8) throw new Error('Incomplete MP4 box header.');
  let size = u32(new DataView(head.buffer, head.byteOffset), 0); const type = fourcc(head, 4); let headerSize = 8;
  if (size === 1) { if (head.length < 16) throw new Error('Incomplete extended MP4 box header.'); size = Number(u64(new DataView(head.buffer, head.byteOffset), 8)); headerSize = 16; }
  if (size === 0) size = file.size - offset;
  if (!Number.isSafeInteger(size) || size < headerSize || offset + size > file.size) throw new Error(`Invalid ${type || 'unknown'} box size.`);
  return { type, start: offset, size, end: offset + size, headerSize };
}

export async function inspectMp4(file) {
  if (!file || file.size < 24) throw new Error('This file is too small to be a valid MP4/MOV video.');
  const boxes = []; let offset = 0; let trailingBytes = 0;
  while (offset < file.size) { try { const box = await readHeader(file, offset); boxes.push(box); offset = box.end; if (boxes.length > 256) throw new Error('Unusually complex top-level MP4 layout.'); } catch (error) { if (boxes.some(box => box.type === 'moov') && boxes.some(box => box.type === 'mdat')) { trailingBytes=file.size-offset; break; } throw error; } }
  const moovs = boxes.filter(b => b.type === 'moov'); const mdats = boxes.filter(b => b.type === 'mdat'); const ftyp = boxes.find(b => b.type === 'ftyp');
  if (!ftyp || moovs.length !== 1 || mdats.length !== 1) throw new Error('FrameKeep supports files with one ftyp, one moov, and one mdat box. No changes were made.');
  if (moovs[0].size > 128 * 1024 * 1024) throw new Error('The MP4 index is unexpectedly large. No changes were made.');
  const moovBytes = new Uint8Array(await file.slice(moovs[0].start, moovs[0].end).arrayBuffer());
  const signature = textDecoder.decode(moovBytes);
  const videoCodec = signature.includes('avc1') || signature.includes('avc3') ? 'H.264' : signature.includes('hvc1') || signature.includes('hev1') ? 'H.265 / HEVC' : 'Other';
  const audioCodec = signature.includes('mp4a') ? 'AAC' : signature.includes('Opus') ? 'Opus' : 'Not detected';
  const fastStart = moovs[0].start < mdats[0].start;
  return { file, boxes, ftyp, moov: moovs[0], mdat: mdats[0], moovBytes, videoCodec, audioCodec, fastStart, trailingBytes };
}

function walkBoxes(bytes, start, end, visit) {
  let offset = start;
  while (offset + 8 <= end) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let size = u32(view, offset); const type = fourcc(bytes, offset + 4); let header = 8;
    if (size === 1) { if (offset + 16 > end) return; size = Number(u64(view, offset + 8)); header = 16; }
    if (size === 0) size = end - offset;
    if (!Number.isSafeInteger(size) || size < header || offset + size > end) return;
    visit({ type, start: offset, size, header, end: offset + size });
    const containers = new Set(['moov','trak','mdia','minf','stbl','edts','dinf','mvex','moof','traf','mfra','udta','meta','ilst']);
    if (containers.has(type)) walkBoxes(bytes, offset + header + (type === 'meta' ? 4 : 0), offset + size, visit);
    offset += size;
  }
}

function patchChunkOffsets(moovBytes, delta, oldMdat) {
  const out = moovBytes.slice(); const view = new DataView(out.buffer, out.byteOffset, out.byteLength); let entries = 0;
  walkBoxes(out, 0, out.length, box => {
    if (box.type !== 'stco' && box.type !== 'co64') return;
    const countAt = box.start + box.header + 4; if (countAt + 4 > box.end) throw new Error('Damaged chunk offset table.');
    const count = u32(view, countAt); const width = box.type === 'stco' ? 4 : 8; let at = countAt + 4;
    if (at + count * width > box.end) throw new Error('Damaged chunk offset table.');
    for (let i = 0; i < count; i++, at += width) {
      const old = width === 4 ? BigInt(u32(view, at)) : u64(view, at);
      const inMedia = old >= BigInt(oldMdat.start) && old < BigInt(oldMdat.end);
      if (!inMedia) throw new Error('A media chunk points outside the supported mdat range. No changes were made.');
      const next = old + BigInt(delta);
      if (next < 0n || (width === 4 && next > 0xffffffffn)) throw new Error('Chunk offsets exceed this MP4 table format. No changes were made.');
      width === 4 ? setU32(view, at, Number(next)) : setU64(view, at, next); entries++;
    }
  });
  if (!entries) throw new Error('No MP4 chunk table was found. Fragmented MP4 files are not modified.');
  return { bytes: out, entries };
}

export async function optimizeMp4(inspection) {
  if (inspection.fastStart) return { blob: inspection.file, changed: false, entries: 0, outputBoxes: inspection.boxes };
  const ordered = [inspection.ftyp, inspection.moov, ...inspection.boxes.filter(b => b !== inspection.ftyp && b !== inspection.moov)];
  let cursor = 0; const newStarts = new Map(); for (const box of ordered) { newStarts.set(box, cursor); cursor += box.size; }
  const delta = newStarts.get(inspection.mdat) - inspection.mdat.start;
  const patched = patchChunkOffsets(inspection.moovBytes, delta, inspection.mdat);
  const parts = ordered.map(box => box === inspection.moov ? patched.bytes : inspection.file.slice(box.start, box.end));
  const blob = new Blob(parts, { type: inspection.file.type || 'video/mp4' });
  if (blob.size !== inspection.file.size) throw new Error('Output size mismatch; the result was discarded.');
  return { blob, changed: true, entries: patched.entries, outputBoxes: ordered.map(b => ({...b,start:newStarts.get(b),end:newStarts.get(b)+b.size})) };
}

export async function verifyMediaIdentity(original, output, inspection, result) {
  const newMdat = result.outputBoxes.find(b => b.type === 'mdat');
  if (!newMdat || newMdat.size !== inspection.mdat.size || output.size !== original.size) return false;
  const payloadOffset = inspection.mdat.headerSize; const sample = 64 * 1024;
  const points = [0, Math.max(0, inspection.mdat.size / 2 - sample / 2), Math.max(0, inspection.mdat.size - payloadOffset - sample)].map(Math.floor);
  for (const point of points) {
    const length = Math.min(sample, inspection.mdat.size - payloadOffset - point);
    const a = new Uint8Array(await original.slice(inspection.mdat.start + payloadOffset + point, inspection.mdat.start + payloadOffset + point + length).arrayBuffer());
    const b = new Uint8Array(await output.slice(newMdat.start + payloadOffset + point, newMdat.start + payloadOffset + point + length).arrayBuffer());
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) return false;
  }
  return true;
}
