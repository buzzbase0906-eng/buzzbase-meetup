#!/usr/bin/env python3
"""index.html の CSP メタを、いまのインラインスクリプトに合わせて作り直します。
使い方: python3 csp_fix.py
  ・<script> ... </script> の中身すべての sha256 を計算して script-src に入れ直す
  ・CSP メタが2つ以上あったら 1 つに整理する（複数あるとブラウザが全部を同時に満たそうとして動かなくなる）
"""
import base64, hashlib, re, sys

PATH = "index.html"
TEMPLATE = (
    "default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; "
    "frame-src 'none'; worker-src 'none'; manifest-src 'none'; "
    "script-src {hashes}; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src https://fonts.gstatic.com; img-src 'self' data:; media-src 'self'; "
    "connect-src 'self'; upgrade-insecure-requests"
)

src = open(PATH, encoding="utf-8").read()

bodies = re.findall(r"<script\b[^>]*>(.*?)</script>", src, re.S)
hashes = " ".join(
    "'sha256-%s'" % base64.b64encode(hashlib.sha256(b.encode()).digest()).decode()
    for b in bodies
)
content = TEMPLATE.format(hashes=hashes)

metas = re.findall(r'[ \t]*<meta http-equiv="content-security-policy"[^>]*>\n?', src)
if not metas:
    sys.exit("CSP メタが見つかりません")
src = src.replace(metas[0], '<meta http-equiv="content-security-policy" content="%s">\n' % content, 1)
for extra in metas[1:]:
    src = src.replace(extra, "", 1)

open(PATH, "w", encoding="utf-8").write(src)
print("インラインスクリプト %d 個のハッシュを設定しました" % len(bodies))
print("CSP メタの数:", len(re.findall(r'<meta http-equiv="content-security-policy"', src)))
