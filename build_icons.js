/* ==================================================================
   ファビコンとホーム画面用アイコンをつくるスクリプト。

   ロゴの色（地 #11080C ／ 文字 #E20020）で "B" のマークを描き、
   favicon.ico / icon-192.png / icon-512.png / apple-touch-icon.png
   を書き出します。ロゴの色を変えたときだけ実行すれば十分です。

     node build_icons.js
   ================================================================== */
const fs = require("fs");
const path = require("path");
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");

const DIR = __dirname;
const BG = "#11080C";
const FG = "#E20020";

/* size: 書き出す大きさ / radius: 角の丸み（0 なら四角） */
const JOBS = [
  { file: "icon-512.png",        size: 512, radius: 96 },
  { file: "icon-192.png",        size: 192, radius: 36 },
  { file: "apple-touch-icon.png", size: 180, radius: 0 },
  { file: "favicon-48.png",      size: 48,  radius: 0 },
  { file: "favicon-32.png",      size: 32,  radius: 0 },
  { file: "favicon-16.png",      size: 16,  radius: 0 }
];

const page = (size, radius) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jost:wght@700&display=block">
<style>
  html,body{margin:0;padding:0;background:transparent}
  .m{width:${size}px;height:${size}px;border-radius:${radius}px;background:${BG};
     display:flex;align-items:center;justify-content:center;overflow:hidden}
  .m span{font-family:"Jost",Helvetica,Arial,sans-serif;font-weight:700;color:${FG};
     font-size:${Math.round(size * 0.74)}px;line-height:1;letter-spacing:-0.02em;
     transform:translateY(${size * 0.012}px)}
</style></head><body><div class="m"><span>B</span></div></body></html>`;

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  for (const j of JOBS) {
    const tab = await browser.newPage({
      viewport: { width: j.size, height: j.size },
      deviceScaleFactor: 1
    });
    await tab.setContent(page(j.size, j.radius), { waitUntil: "load" });
    try { await tab.evaluate(() => document.fonts.ready); } catch (e) {}
    await tab.waitForTimeout(500);
    await tab.locator(".m").screenshot({
      path: path.join(DIR, j.file),
      omitBackground: j.radius > 0
    });
    await tab.close();
    console.log("書き出し:", j.file, fs.statSync(path.join(DIR, j.file)).size + "B");
  }
  await browser.close();
})();
