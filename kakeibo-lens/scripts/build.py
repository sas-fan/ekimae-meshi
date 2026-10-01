#!/usr/bin/env python3
"""src/dashboard.html（claude.ai Artifact 用の本文）から、単体で開ける index.html を作る。"""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
body = (root / "src" / "dashboard.html").read_text(encoding="utf-8")
html = (
    "<!doctype html>\n<html lang=\"ja\">\n<head>\n<meta charset=\"utf-8\">\n"
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n"
    "<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}"
    "body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n"
    "</head>\n<body>\n" + body + "\n</body>\n</html>\n"
)
(root / "index.html").write_text(html, encoding="utf-8")
print("wrote", root / "index.html")
