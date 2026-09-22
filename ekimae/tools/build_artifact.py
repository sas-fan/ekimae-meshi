#!/usr/bin/env python3
"""index.html から Artifact 公開用の artifact.html を生成する。

claude.ai の Artifact はページを独自の骨組みで包むため、
<!doctype>/<html>/<head>/<body> を自分で持ってはいけない。
また :root に safe-area 分の余白が入るので、ヘッダの env() 指定と二重になる。
その差分だけを吸収した1枚を作る。styles.css / app.js / data はそのまま共有する。
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
src = (ROOT / "index.html").read_text(encoding="utf-8")

body = re.search(r"<body[^>]*>(.*)</body>", src, re.S)
if not body:
    raise SystemExit("index.html から <body> を取り出せませんでした")

markup = body.group(1)
# Service Worker と manifest はデプロイ版だけのもの。Artifact では使わない
markup = re.sub(r'\s*<script src="app\.js"></script>', "", markup)

out = """<title>梅田地下メシ</title>
<link rel="stylesheet" href="styles.css">
<style>
  /* Artifact の骨組みが :root に safe-area 分の余白を入れるため、
     ヘッダ側の env() 指定と二重にならないようにする */
  .topbar { padding-top: 8px; }
  html, body { height: auto; }
</style>
""" + markup.strip() + """
<script src="app.js"></script>
"""

dest = ROOT / "artifact.html"
dest.write_text(out, encoding="utf-8")
print(f"書き出しました: {dest} ({len(out):,} bytes)")
