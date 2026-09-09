# FrameKeep Local

FrameKeep Local is an original, private browser tool for inspecting and losslessly remuxing MP4/MOV files. The selected video stays on the user's device. FFmpeg WebAssembly copies the encoded streams without re-encoding, chronologically interleaves audio/video packets, moves the `moov` index forward, and verifies per-stream SHA-256 hashes before download.

## Features

- Drag-and-drop MP4/MOV input
- H.264/H.265 and AAC detection
- Lossless chronological audio/video interleaving
- Fast-start MP4 output
- Refuses fragmented, multi-`mdat`, malformed, or unsafe layouts
- H.264/H.265 and AAC streams copied without re-encoding
- Full per-stream SHA-256 verification
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
- The first remux loads the FFmpeg WebAssembly core from jsDelivr. Video bytes remain in the browser and are not sent to that service.
- The TikTok checker reads public page state, not an official quality-inspection API, and may require maintenance.
- Use a high-quality H.264/AAC export and upload through the platform's supported workflow.

FrameKeep is not affiliated with TikTok or hdkakloh.
