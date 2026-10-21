/* ==================================================================
   検索エンジン向けに、ページごとの HTML ファイルをつくるスクリプト。

   いまのサイトは index.html 1つで全ページを描いています。そのままだと
   Google からは「1ページだけのサイト」に見えてしまうため、
   /about/index.html のように実在するファイルを書き出しておきます。

   中身は index.html と同じで、違うのは次の4つだけです。
     ・<title> と説明文（そのページのもの）
     ・canonical と OGP の URL
     ・<main> の中に、そのページの内容をあらかじめ入れておく
     ・そのページ用の構造化データ（トップ以外はイベント情報を外す）

   使い方（index.html を直したら毎回）:
     python3 -m http.server 8905   （別のターミナルで、このフォルダで）
     node build_pages.js
   そのあと python3 csp_fix.py は不要です（このスクリプトが中でやります）。
   ================================================================== */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");

const DIR = __dirname;
const ORIGIN = "https://buzzbase.net";
const SERVE = "http://127.0.0.1:8905";

/* 書き出すページ（URL と置き場所）。
   タイトルと説明文は index.html の SEO という表から読みます。
   文言を変えるときは index.html の SEO だけを直してください。 */
const PAGES = [
  { route:"/numbers", dir:"numbers" },
  { route:"/about",   dir:"about"   },
  { route:"/report",  dir:"report"  },
  { route:"/program", dir:"program" },
  { route:"/crew",    dir:"crew"    },
  { route:"/guests",  dir:"guests"  },
  { route:"/ticket",  dir:"ticket"  },
  { route:"/access",  dir:"access"  },
  { route:"/company", dir:"company" },
  { route:"/entry",   dir:"entry"   },
  { route:"/privacy", dir:"privacy" },
  { route:"/notice",  dir:"notice"  }
];

/* トップ以外から外す構造化データ（イベントと協賛各社はトップにだけ置く） */
const HOME_ONLY = ["Event"];

function csp(html){
  const bodies = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const hashes = bodies
    .map(b => "'sha256-" + crypto.createHash("sha256").update(b, "utf8").digest("base64") + "'")
    .join(" ");
  return html.replace(
    /(<meta http-equiv="content-security-policy" content="[^"]*?script-src )[^;]*(;)/,
    (_, a, b) => a + hashes + b);
}

function swapMeta(html, attr, name, value){
  const re = new RegExp(`(<meta ${attr}="${name}" content=")[^"]*(">)`);
  return html.replace(re, (_, a, b) => a + value.replace(/"/g, "&quot;") + b);
}

function pageGraph(html, route, title, desc){
  const re = /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/;
  const m = html.match(re);
  if (!m) return html;
  const data = JSON.parse(m[2]);
  const graph = data["@graph"].filter(n => {
    const t = Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]];
    return !t.some(x => HOME_ONLY.includes(x));
  });
  graph.push({
    "@type": "WebPage",
    "@id": ORIGIN + route + "/#page",
    "url": ORIGIN + route + "/",
    "name": title,
    "description": desc,
    "isPartOf": { "@id": ORIGIN + "/#site" },
    "about": { "@id": ORIGIN + "/#org" },
    "inLanguage": "ja"
  });
  graph.push({
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", position: 1, name: "BUZZ BASE", item: ORIGIN + "/" },
      { "@type": "ListItem", position: 2, name: title.split("｜")[0], item: ORIGIN + route + "/" }
    ]
  });
  return html.replace(re, (_, a, __, c) =>
    a + JSON.stringify({ "@context": "https://schema.org", "@graph": graph }) + c);
}

/* よくある質問を、検索エンジンが読める形（FAQPage）でトップに足します。
   文面は index.html の FAQ から自動で拾うので、二重に書く必要はありません。 */
function withFaq(html, faq){
  if (!faq || !faq.length) return html;
  const re = /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/;
  const m = html.match(re);
  if (!m) return html;
  const data = JSON.parse(m[2]);
  data["@graph"] = data["@graph"].filter(n => n["@type"] !== "FAQPage");
  data["@graph"].push({
    "@type": "FAQPage",
    "@id": ORIGIN + "/#faq",
    "mainEntity": faq.map(f => ({
      "@type": "Question",
      "name": f.q,
      "acceptedAnswer": { "@type": "Answer", "text": f.a }
    }))
  });
  return html.replace(re, (_, a, __, c) => a + JSON.stringify(data) + c);
}

(async () => {
  /* 前回の書き出しが入っていても、まっさらな状態から組み直します。 */
  const base = fs.readFileSync(path.join(DIR, "index.html"), "utf8")
    .replace(/<main id="main">[\s\S]*?<\/main>/, '<main id="main"></main>');
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const written = [];

  for (const p of PAGES) {
    const tab = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    const errs = [];
    tab.on("pageerror", e => errs.push(String(e)));
    await tab.goto(SERVE + "/index.html#" + p.route, { waitUntil: "load" });
    await tab.keyboard.press("Escape");
    await tab.waitForTimeout(2600);
    const main = await tab.evaluate(() => document.getElementById("main").innerHTML);
    const seo = await tab.evaluate(r => SEO[r] || null, p.route);
    await tab.close();
    if (errs.length) { console.error("!! " + p.route + " で JS エラー:", errs[0]); process.exit(1); }
    if (!seo) { console.error("!! index.html の SEO に " + p.route + " がありません"); process.exit(1); }
    p.title = seo.title; p.desc = seo.desc;
    if (!main || main.length < 400) { console.error("!! " + p.route + " の中身が空です"); process.exit(1); }

    let html = base;
    html = html.replace(/<title>[\s\S]*?<\/title>/, "<title>" + p.title + "</title>");
    html = swapMeta(html, "name", "description", p.desc);
    html = swapMeta(html, "property", "og:title", p.title);
    html = swapMeta(html, "property", "og:description", p.desc);
    html = swapMeta(html, "property", "og:url", ORIGIN + p.route + "/");
    html = swapMeta(html, "name", "twitter:title", p.title);
    html = swapMeta(html, "name", "twitter:description", p.desc);
    html = html.replace(/<link rel="canonical" href="[^"]*">/,
                        '<link rel="canonical" href="' + ORIGIN + p.route + '/">');
    html = pageGraph(html, p.route, p.title, p.desc);
    html = html.replace('<main id="main"></main>', '<main id="main">' + main + "</main>");
    /* トップの大きな写真はこのページには出ないので、先読みを外します
       （出ない画像を読みにいくと、本文の表示がそのぶん遅くなります）。 */
    html = html.replace(/[ \t]*<link rel="preload" as="image"[^>]*>\n/g, "");
    html = csp(html);

    fs.mkdirSync(path.join(DIR, p.dir), { recursive: true });
    fs.writeFileSync(path.join(DIR, p.dir, "index.html"), html);
    written.push(p.route);
    console.log("書き出し:", p.route + "/  (" + Math.round(html.length / 1024) + "KB)");
  }

  /* トップページと 404 ページも、中身をあらかじめ入れておきます。
     トップは検索でいちばん見られるページなので、JavaScript が動かなくても
     本文が読める状態にしておきます。 */
  for (const extra of [{ route:"/", file:"index.html" }, { route:"/404", file:"404.html" }]) {
    const tab = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    await tab.goto(SERVE + "/index.html#" + extra.route, { waitUntil: "load" });
    await tab.keyboard.press("Escape");
    await tab.waitForTimeout(2600);
    const main = await tab.evaluate(() => document.getElementById("main").innerHTML);
    const seo404 = await tab.evaluate(() => SEO["/404"] || null);
    const faq = await tab.evaluate(() => (typeof FAQ !== "undefined" ? FAQ : []));
    await tab.close();
    if (!main || main.length < 300) { console.error("!! " + extra.route + " の中身が空です"); process.exit(1); }
    let html = base.replace('<main id="main"></main>', '<main id="main">' + main + "</main>");
    if (extra.route === "/") html = withFaq(html, faq);
    if (extra.route === "/404") {
      html = html.replace(/[ \t]*<link rel="preload" as="image"[^>]*>\n/g, "");
      html = html.replace(/<title>[\s\S]*?<\/title>/, "<title>" + (seo404 ? seo404.title : "ページが見つかりません｜BUZZ BASE") + "</title>");
      html = html.replace(/<meta name="robots" content="[^"]*">/,
                          '<meta name="robots" content="noindex, follow">');
    }
    html = csp(html);
    fs.writeFileSync(path.join(DIR, extra.file), html);
    console.log("書き出し:", extra.file + "  (" + Math.round(html.length / 1024) + "KB)");
  }

  await browser.close();

  /* sitemap.xml も合わせて書き直す */
  const today = new Date().toISOString().slice(0, 10);
  const urls = ["/"].concat(written.map(r => r + "/"));
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u =>
      "  <url>\n    <loc>" + ORIGIN + u + "</loc>\n" +
      "    <lastmod>" + today + "</lastmod>\n" +
      "    <changefreq>" + (u === "/" ? "daily" : "weekly") + "</changefreq>\n" +
      "    <priority>" + (u === "/" ? "1.0" : "0.8") + "</priority>\n  </url>").join("\n") +
    "\n</urlset>\n";
  fs.writeFileSync(path.join(DIR, "sitemap.xml"), xml);
  console.log("書き出し: sitemap.xml（" + urls.length + " ページ）");
})();
