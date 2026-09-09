# FrameKeep Local

FrameKeep Local is an original, private browser tool for sample-level MP4 patching. The selected video stays on the user's device. The app preserves the original encoded video samples, rebuilds the sample/chunk tables, chronologically interleaves the media, and creates a verified AAC compatibility track.

## Features

- Drag-and-drop MP4/MOV input
- H.264/H.265 and AAC detection
- Lossless chronological audio/video interleaving
- Fast-start MP4 output
- Refuses fragmented, multi-`mdat`, malformed, or unsafe layouts
- Original H.264/H.265 video samples preserved without re-encoding
- Three-track structure and sample-size verification
- Up to five recent outputs in IndexedDB, expiring after three days
- Optional Vercel server function for public TikTok playback-variant inspection
- Responsive desktop/mobile interface

## Run locally

```bash
npm install
npm run dev
```

The optimizer works locally. The TikTok checker is a Vercel-style function and works after deployment; TikTok changes its public page data frequently, so maintain this module separately.

## Test and build

```bash
npm test
npm run build
```

## Deployment

Deploy the project to Vercel as a Vite app. The `api/check-tiktok.js` function is detected automatically. No database, login, payment provider, or video storage is required for this private edition.

## Honest limitations

- Lossless remuxing improves MP4 interleaving and progressive loading, but does not guarantee that TikTok or another platform will preserve source resolution, bitrate, or frame rate.
- The patcher is implemented directly in browser JavaScript; it does not load a transcoder or send video bytes to a server.
- The TikTok checker reads public page state, not an official quality-inspection API, and may require maintenance.
- Use a high-quality H.264/AAC export and upload through the platform's supported workflow.

FrameKeep is not affiliated with TikTok or hdkakloh.
