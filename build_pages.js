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

/* 書き出すページ。説明文はそのページの中身に合わせて書いてください。 */
const PAGES = [
  { route:"/numbers", dir:"numbers",
    title:"イベントデータ｜BUZZ BASE（BUZZBASE MEETUP）",
    desc:"BUZZ BASE の規模を数字で。参加者の累計フォロワー数、開催回数、1回あたりの人数と本編120分。インフルエンサーと経営者が集まる招待制交流会 BUZZBASE MEETUP のイベントデータです。" },
  { route:"/about", dir:"about",
    title:"BUZZ BASE とは｜インフルエンサーと経営者の交流会について",
    desc:"BUZZ BASE（バズベース）は、発信力のあるインフルエンサーと事業を動かす経営者・役員が集まる招待制の交流会です。2026年5月に東京で開始。何のための場で、どなたを招いているのかをご紹介します。" },
  { route:"/report", dir:"report",
    title:"開催レポート VOL.03（2026.9.25 東京・渋谷）｜BUZZ BASE",
    desc:"BUZZBASE MEETUP VOL.03 の開催レポート。2026年9月25日、東京・渋谷におよそ100名のインフルエンサーと経営者が集まった一夜を、当日の流れと仕掛けとあわせてふりかえります。" },
  { route:"/program", dir:"program",
    title:"当日の流れ｜BUZZ BASE（BUZZBASE MEETUP VOL.04）",
    desc:"受付18:30から21:10のクロージングまで、BUZZBASE MEETUP VOL.04 当日の流れ。交流型ビンゴ MONSTER BINGO を使った、はじめてでも輪に入れる120分の進行をご案内します。" },
  { route:"/crew", dir:"crew",
    title:"主催・運営メンバーと協賛｜BUZZ BASE",
    desc:"BUZZ BASE を運営するクルーの紹介と、メインスポンサー Traum、共催の STREET PV、協賛の TOPICO・にいみ農園といったパートナーのご紹介です。" },
  { route:"/guests", dir:"guests",
    title:"出演ゲスト｜BUZZ BASE（BUZZBASE MEETUP）",
    desc:"これまでの BUZZBASE MEETUP にご出演いただいたゲストの皆さま。スポーツ、フィットネス、カルチャー、ビジネスと、畑の違う顔ぶれが一夜に集まります。" },
  { route:"/ticket", dir:"ticket",
    title:"参加費・招待枠｜BUZZ BASE（BUZZBASE MEETUP VOL.04）",
    desc:"インフルエンサー枠と経営者・役員枠の参加費、人数で変わるグループ料金、キャンセルポリシーをまとめています。BUZZBASE MEETUP VOL.04 の参加をご検討の方へ。" },
  { route:"/access", dir:"access",
    title:"開催概要・アクセス（2026.10.30 東京・池尻大橋 BPM）｜BUZZ BASE",
    desc:"BUZZBASE MEETUP VOL.04 の開催日時と会場。2026年10月30日（金）受付18:30／本編19:10〜21:10、会場は BPM（東京都世田谷区池尻2-31-24 信田ビル2F、池尻大橋駅すぐ）です。" },
  { route:"/company", dir:"company",
    title:"会社概要 株式会社紹継｜BUZZ BASE",
    desc:"BUZZ BASE を運営する株式会社紹継の会社概要。日本文化事業・SNS事業・イベント企画・クリエイター支援・コンテンツ制作を手がけています。" },
  { route:"/entry", dir:"entry",
    title:"参加申込｜BUZZ BASE（BUZZBASE MEETUP VOL.04）",
    desc:"BUZZBASE MEETUP VOL.04 の参加申込について。お申し込みは専用フォームから。ご参加が確定した方にのみ、招待コードと当日のご案内をお送りします。" },
  { route:"/privacy", dir:"privacy",
    title:"プライバシーポリシー｜BUZZ BASE",
    desc:"BUZZ BASE（BUZZBASE MEETUP 運営事務局）がお預かりする個人情報の取り扱いについて。" },
  { route:"/notice", dir:"notice",
    title:"会場変更のお知らせ（VOL.03）｜BUZZ BASE",
    desc:"BUZZBASE MEETUP VOL.03 の会場変更についてのお知らせです。" }
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
    await tab.close();
    if (errs.length) { console.error("!! " + p.route + " で JS エラー:", errs[0]); process.exit(1); }
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
    await tab.close();
    if (!main || main.length < 300) { console.error("!! " + extra.route + " の中身が空です"); process.exit(1); }
    let html = base.replace('<main id="main"></main>', '<main id="main">' + main + "</main>");
    if (extra.route === "/404") {
      html = html.replace(/<title>[\s\S]*?<\/title>/, "<title>ページが見つかりません｜BUZZ BASE</title>");
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
