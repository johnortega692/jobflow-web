import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const ACCENT = "#4f8cff";
const PAGE_BG = "#12151c";

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

function findChrome() {
  return CHROME_CANDIDATES.find((p) => existsSync(p));
}

function badgeHtml({ size, pad = 0, pageBg = "transparent" }) {
  const inner = size - pad * 2;
  const radius = (inner * 8) / 36;
  const fontSize = (inner * 16) / 36;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        width: ${size}px;
        height: ${size}px;
        background: ${pageBg};
        overflow: hidden;
      }
      .brand-mark {
        position: absolute;
        left: ${pad}px;
        top: ${pad}px;
        width: ${inner}px;
        height: ${inner}px;
        border-radius: ${radius}px;
        background: ${ACCENT};
        color: #fff;
        display: grid;
        place-items: center;
        font-family: "Segoe UI", system-ui, sans-serif;
        font-weight: 700;
        font-size: ${fontSize}px;
        line-height: 1.5;
        -webkit-font-smoothing: antialiased;
      }
    </style>
  </head>
  <body>
    <div class="brand-mark">JF</div>
  </body>
</html>`;
}

function renderPng(chrome, html, outPath, size) {
  const dir = mkdtempSync(join(tmpdir(), "jobflow-pwa-"));
  const htmlPath = join(dir, "icon.html");
  writeFileSync(htmlPath, html, "utf8");
  const result = spawnSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--default-background-color=00000000",
      `--window-size=${size},${size}`,
      `--screenshot=${outPath}`,
      pathToFileURL(htmlPath).href,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `chrome exited ${result.status}`);
  }
  if (!existsSync(outPath) || readFileSync(outPath).length < 100) {
    throw new Error(`screenshot missing: ${outPath}`);
  }
}

const chrome = findChrome();
if (!chrome) {
  throw new Error("Chrome or Edge is required to render Segoe UI PWA icons");
}

const jobs = [
  ["pwa-192.png", { size: 192 }],
  ["pwa-512.png", { size: 512 }],
  ["pwa-512-maskable.png", { size: 512, pad: Math.round(512 * 0.12), pageBg: PAGE_BG }],
  ["apple-touch-icon.png", { size: 180 }],
];

for (const [name, opts] of jobs) {
  const outPath = join(PUBLIC, name);
  renderPng(chrome, badgeHtml(opts), outPath, opts.size);
  console.log(`wrote public/${name} (${readFileSync(outPath).length} bytes)`);
}
