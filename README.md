# FrameKeep Local

FrameKeep Local is an original, private browser tool for inspecting and optimizing MP4/MOV container layout. The selected video stays on the user's device. The app moves a trailing `moov` index before the single `mdat` payload, updates `stco`/`co64` chunk offsets, spot-checks media bytes, and prepares a downloadable MP4 without transcoding.

## Features

- Drag-and-drop MP4/MOV input
- H.264/H.265 and AAC detection
- Safe fast-start relocation with offset repair
- Refuses fragmented, multi-`mdat`, malformed, or unsafe layouts
- Original media payload reused byte-for-byte
- Structural and sampled-byte verification
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

- Fast-start MP4 layout improves progressive loading and compatibility, but does not guarantee that TikTok or another platform will preserve source bitrate or frame rate.
- The optimizer does not re-interleave already encoded samples. It relocates the index and safely updates chunk offsets.
- The TikTok checker reads public page state, not an official quality-inspection API, and may require maintenance.
- Use a high-quality H.264/AAC export and upload through the platform's supported workflow.

FrameKeep is not affiliated with TikTok or hdkakloh.
