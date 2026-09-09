import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

const CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
const decoder = new TextDecoder();
let enginePromise;
let activeProgress;

function normalizeStreamHashes(text) {
  return text.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean).sort().join('\n');
}

async function getEngine(onPhase) {
  if (!enginePromise) {
    enginePromise = (async () => {
      onPhase?.('Loading the lossless remux engine (first use may take a moment)…');
      const ffmpeg = new FFmpeg();
      ffmpeg.on('progress', event => activeProgress?.(event.progress));
      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm')
      });
      return ffmpeg;
    })().catch(error => {
      enginePromise = undefined;
      throw error;
    });
  }
  return enginePromise;
}

async function streamHashes(ffmpeg, inputName, outputName) {
  const code = await ffmpeg.exec([
    '-y', '-v', 'error', '-i', inputName,
    '-map', '0:v', '-map', '0:a?', '-c', 'copy',
    '-f', 'streamhash', '-hash', 'sha256', outputName
  ]);
  if (code !== 0) throw new Error('The media-stream verification pass failed.');
  const bytes = await ffmpeg.readFile(outputName);
  return normalizeStreamHashes(typeof bytes === 'string' ? bytes : decoder.decode(bytes));
}

export async function remuxMp4(file, { onPhase, onProgress } = {}) {
  const ffmpeg = await getEngine(onPhase);
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inputName = `input-${token}.mp4`;
  const outputName = `output-${token}.mp4`;
  const originalHashName = `original-${token}.sha256`;
  const outputHashName = `output-${token}.sha256`;
  const cleanup = [inputName, outputName, originalHashName, outputHashName];

  try {
    onPhase?.('Loading the video into the private browser workspace…');
    await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));

    onPhase?.('Interleaving audio and video without re-encoding…');
    activeProgress = value => onProgress?.(Math.max(0, Math.min(1, value || 0)));
    const code = await ffmpeg.exec([
      '-y', '-v', 'error', '-i', inputName,
      '-map', '0', '-c', 'copy',
      '-max_interleave_delta', '1000000',
      '-movflags', '+faststart',
      outputName
    ]);
    activeProgress = undefined;
    if (code !== 0) throw new Error('Lossless MP4 remuxing failed. The original file was not changed.');

    onPhase?.('Verifying the video and audio stream hashes…');
    const originalHashes = await streamHashes(ffmpeg, inputName, originalHashName);
    const outputHashes = await streamHashes(ffmpeg, outputName, outputHashName);
    if (!originalHashes || originalHashes !== outputHashes) {
      throw new Error('Media verification failed. The remuxed output was discarded.');
    }

    const data = await ffmpeg.readFile(outputName);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data.slice();
    return {
      blob: new Blob([bytes], { type: 'video/mp4' }),
      streamCount: originalHashes.split('\n').length
    };
  } finally {
    activeProgress = undefined;
    await Promise.all(cleanup.map(name => ffmpeg.deleteFile(name).catch(() => {})));
  }
}

