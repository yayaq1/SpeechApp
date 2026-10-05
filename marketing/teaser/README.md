# Orator launch teaser

A 19.6 second, 1080×1920, 60 fps teaser built from HTML recreations of the real SwiftUI screens. The recreations follow `ios/App/Screens/*.swift`, and the live orb is the app's own `ios/App/Orb/voice-orb.html`.

## Render

Requires Node 20+, ffmpeg, and Google Chrome (set `CHROME_PATH` if it is not at `/usr/local/bin/google-chrome`).

```bash
cd marketing/teaser
npm install
npm run fonts           # downloads Inter and Source Serif 4 into fonts/
node render.mjs         # out/orator-teaser-9x16.mp4 (ambient) and -silent.mp4
```

Options:

- `--fps 30` renders a lighter version.
- `--still 4.0,6.5` writes PNG stills to `out/stills/` instead of a video.
- `--remux` rebuilds only the ambient audio on the existing silent MP4.
- `--out <dir>` changes the output folder.

To preview in a browser, serve the repo root (for example `npx http-server ../.. -p 8080`), open `/marketing/teaser/teaser.html`, and run `await teaser.ready(); teaser.seek(6)` in the console. The orbs run in real time there; only the renderer puts them on the frame clock.

## How it works

- `teaser.html` and `teaser.css` lay out the stage at 720×1280 CSS px with 1 px = 1 iOS pt. The phone screen is 402×874 pt. Chrome renders at 1.5× for 1080×1920.
- `teaser.js` holds the timeline (`T`). `seek(t)` sets every style from `t` alone.
- `virtual-time.js` runs `requestAnimationFrame`, `performance.now` and `Date.now` on a clock that the renderer advances one frame at a time. This makes the WebGL orb deterministic.
- `render.mjs` serves the repo, screenshots each frame with puppeteer-core, pipes the frames to ffmpeg (H.264, CRF 15), then muxes a soft synthesized pad.

## Type and color

| Role | App | Teaser stand-in |
| --- | --- | --- |
| Headings (h1–h4), wordmark | Instrument Serif (`font/`) | Same file |
| UI text | SF Pro (system) | Inter |
| Passage, topic, captions (`design: .serif`) | New York (system) | Source Serif 4 |

The colors are the iOS dark appearance, which the app forces with `.preferredColorScheme(.dark)`. Label text is `#FFF`, secondary text is `rgba(235,235,245,.6)`, the accent is the system blue `#0A84FF`, and stop is `#FF453A`. The screen background is a black-to-`#0F0F10` gradient. The stage around the phone is black, and supporting text is `#86868B` or `#98989D`.
