// Renders teaser.html frame by frame in headless Chrome and encodes it with ffmpeg.
//
//   node render.mjs                       full 1080x1920 render, ambient + silent MP4s
//   node render.mjs --fps 30              lighter render
//   node render.mjs --still 3.5,6,10.8    PNG stills at those times (seconds)
//   node render.mjs --out /some/dir       output folder (default ./out)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

const args = parseArgs(process.argv.slice(2));
const fps = Number(args.fps ?? 60);
const outDir = path.resolve(args.out ?? path.join(here, 'out'));
const stills = args.still ? String(args.still).split(',').map(Number) : null;

// The composition is laid out in iOS points (1 CSS px = 1 pt). 720x1280 pt at 1.5x is 1080x1920.
const VIEWPORT = { width: 720, height: 1280, deviceScaleFactor: 1.5 };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    const key = list[i].replace(/^--/, '');
    const next = list[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function serve(root) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function run(cmd, cmdArgs, { stdin } = {}) {
  const child = spawn(cmd, cmdArgs, { stdio: [stdin ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const done = new Promise((resolve, reject) => {
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}\n${stderr.slice(-2000)}`))));
  });
  return { child, done };
}

function write(stream, buffer) {
  return new Promise((resolve) => {
    if (stream.write(buffer)) resolve();
    else stream.once('drain', resolve);
  });
}

// Soft, low pad: an open D chord of slightly detuned sines, filtered and echoed. Sits well under speech.
function ambientFilter(duration) {
  const voice = (f, a, lfo, phase) =>
    `${a}*(sin(2*PI*${f}*t)+sin(2*PI*${(f * 1.0027).toFixed(3)}*t))*(0.72+0.28*sin(2*PI*${lfo}*t+${phase}))`;
  const expr = [
    voice(73.42, 0.5, 0.07, 0),
    voice(146.83, 0.42, 0.09, 1.1),
    voice(220.0, 0.3, 0.12, 2.3),
    voice(329.63, 0.16, 0.1, 0.4),
    voice(440.0, 0.07, 0.13, 1.9),
  ].join('+');
  const fadeOut = Math.max(0, duration - 2.6).toFixed(2);
  return [
    `aevalsrc='0.06*(${expr})':s=48000:d=${duration.toFixed(3)}`,
    'lowpass=f=900',
    'aecho=0.8:0.6:180|370:0.28|0.16',
    'aformat=channel_layouts=stereo',
    'afade=t=in:st=0:d=2.2',
    `afade=t=out:st=${fadeOut}:d=2.6`,
    'volume=0.7',
  ].join(',');
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const server = await serve(repoRoot);
  const { port } = server.address();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? '/usr/local/bin/google-chrome',
    headless: true,
    args: [
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
      '--disable-lcd-text',
    ],
  });

  try {
    const page = await browser.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error('[page]', msg.text());
    });
    page.on('response', (response) => {
      if (response.status() >= 400) console.error('[page]', response.status(), response.url());
    });
    await page.setViewport(VIEWPORT);
    await page.evaluateOnNewDocument(fs.readFileSync(path.join(here, 'virtual-time.js'), 'utf8'));
    await page.goto(`http://127.0.0.1:${port}/marketing/teaser/teaser.html`, { waitUntil: 'load' });
    await page.evaluate(() => window.teaser.ready());
    const duration = await page.evaluate(() => window.teaser.duration);

    const capture = async (t) => {
      await page.evaluate((time) => window.teaser.seek(time), t);
      return page.screenshot({ type: 'png', optimizeForSpeed: true });
    };

    if (stills) {
      const dir = path.join(outDir, 'stills');
      fs.mkdirSync(dir, { recursive: true });
      // Walk the clock up to each still so the orb's motion has history behind it.
      let t = 0;
      for (const target of [...stills].sort((a, b) => a - b)) {
        for (; t < target; t += 1 / fps) {
          await page.evaluate((time) => window.teaser.seek(time), t);
        }
        const png = await capture(target);
        const file = path.join(dir, `still-${target.toFixed(2)}s.png`);
        fs.writeFileSync(file, png);
        console.log(file);
      }
      return;
    }

    const silent = path.join(outDir, 'orator-teaser-9x16-silent.mp4');
    const ambient = path.join(outDir, 'orator-teaser-9x16.mp4');
    const encoder = run('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-tune', 'film',
      '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-movflags', '+faststart',
      silent,
    ], { stdin: true });

    const total = Math.round(duration * fps);
    const started = Date.now();
    for (let i = 0; i < total; i++) {
      const png = await capture(i / fps);
      await write(encoder.child.stdin, png);
      if (i % fps === 0) {
        const rate = (i + 1) / ((Date.now() - started) / 1000);
        process.stdout.write(`frame ${i}/${total} (${rate.toFixed(1)} fps)\n`);
      }
    }
    encoder.child.stdin.end();
    await encoder.done;

    await run('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-i', silent,
      '-f', 'lavfi', '-i', ambientFilter(duration),
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest',
      '-movflags', '+faststart',
      ambient,
    ]).done;
    console.log(ambient);
    console.log(silent);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
