/* Shared harness for the Milana Source Playwright tests. */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const URL = process.env.APP_URL || 'http://127.0.0.1:8123/index.html';
const SHOTS = path.join(__dirname, 'shots');
const CHROMIUM = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
const FONT_DIR = path.join(__dirname, 'node_modules', '@fontsource', 'noto-sans-sc', 'files');

fs.mkdirSync(SHOTS, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* The cache name the service worker will install — read from the source so
   tests never go stale when it is bumped. */
function swCacheName() {
  const src = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
  const m = /const CACHE = '([^']+)'/.exec(src);
  return m ? m[1] : null;
}

async function launch({ camera = true } = {}) {
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: camera ? [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ] : [],
  });
  const ctx = await browser.newContext({
    viewport: { width: 402, height: 874 },
    isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    permissions: camera ? ['camera', 'microphone'] : [],
  });
  const page = await ctx.newPage();
  return { browser, ctx, page };
}

/* Headless Chromium here has no CJK system font; inline one so canvases used
   to render test cards produce real characters for the OCR to read. */
async function loadCJKFont(page) {
  const b64 = w => fs.readFileSync(path.join(FONT_DIR, `noto-sans-sc-chinese-simplified-${w}-normal.woff2`)).toString('base64');
  await page.addStyleTag({ content: `
    @font-face { font-family: 'TestSC'; font-weight: 400; src: url(data:font/woff2;base64,${b64(400)}) format('woff2'); }
    @font-face { font-family: 'TestSC'; font-weight: 700; src: url(data:font/woff2;base64,${b64(700)}) format('woff2'); }
  ` });
  await page.evaluate(async () => {
    await document.fonts.load('400 48px TestSC', '佛山');
    await document.fonts.load('700 62px TestSC', '佛山');
    await document.fonts.ready;
  });
}

function makeReporter() {
  const errors = [];
  const check = (cond, msg) => { if (!cond) errors.push('[assert] ' + msg); console.log((cond ? 'PASS' : 'FAIL') + ': ' + msg); };
  const section = title => console.log('\n== ' + title + ' ==');
  return { errors, check, section };
}

module.exports = { ROOT, URL, SHOTS, sleep, swCacheName, launch, loadCJKFont, makeReporter };
