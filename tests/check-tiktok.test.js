import test from 'node:test';
import assert from 'node:assert/strict';
import { collectVariants } from '../api/check-tiktok.js';

test('collects frame rates from TikTok playback metadata formats', () => {
  const state = {
    playback: [
      { Width: 1080, Height: 1920, Bitrate: 4_000_000, FPS: 60, UrlList: ['https://example.test/a.mp4'] },
      { width: 720, height: 1280, bitrate: 1_500_000, frameRate: '29.97', playAddr: 'https://example.test/b.mp4' }
    ]
  };
  const variants = collectVariants(state);
  assert.deepEqual(variants.map(({ width, height, fps }) => ({ width, height, fps })), [
    { width: 1080, height: 1920, fps: 60 },
    { width: 720, height: 1280, fps: 29.97 }
  ]);
});

test('rejects implausible frame-rate metadata instead of guessing', () => {
  const variants = collectVariants({ width: 1080, height: 1920, fps: 1000, url: 'https://example.test/video.mp4' });
  assert.equal(variants[0].fps, null);
});
