#!/usr/bin/env python3
"""各ビルの公式フロア案内をまとめて取得し、ingest.py に流し込む。

  python3 tools/fetch_official.py --list          # 取得先の一覧を見るだけ
  python3 tools/fetch_official.py                 # 取得 → in/ に保存 → dry-run で差分表示
  python3 tools/fetch_official.py --write         # 取り込みまで実行

URL は変わることがある。404 になったら PAGES を直すか、
ブラウザで保存した HTML を in/ に置いて --skip-download を使う。
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ekimae_data as E

HERE = Path(__file__).resolve().parent
IN_DIR = HERE.parent / "in"

# (ビル, フロア, URL, 出どころラベル)
PAGES = [
    (1, "B2", "https://www.1bld.com/floor/floor_b2.html", "official:1bld"),
    (1, "B1", "https://www.1bld.com/floor/floor_b1.html", "official:1bld"),
    (1, "1F", "https://www.1bld.com/floor/floor_01.html", "official:1bld"),
    (1, "2F", "https://www.1bld.com/floor/floor_02.html", "official:1bld"),

    (2, "B2", "https://ekimae2.jp/flg-b2/", "official:ekimae2"),
    (2, "B1", "https://ekimae2.jp/flg-b1/", "official:ekimae2"),
    (2, "1F", "https://ekimae2.jp/flg-1f/", "official:ekimae2"),
    (2, "2F", "https://ekimae2.jp/flg-2f/", "official:ekimae2"),

    (3, "B2", "https://ekimae3.jp/b2f.html", "official:ekimae3"),
    (3, "B1", "https://ekimae3.jp/b1f.html", "official:ekimae3"),
    (3, "1F", "https://ekimae3.jp/1f.html", "official:ekimae3"),
    (3, "2F", "https://ekimae3.jp/2f.html", "official:ekimae3"),

    (4, "B2", "https://www.ekimae4.jp/b2.html", "official:ekimae4"),
    (4, "B1", "https://www.ekimae4.jp/b1.html", "official:ekimae4"),
    (4, "1F", "https://www.ekimae4.jp/1f.html", "official:ekimae4"),
    (4, "2F", "https://www.ekimae4.jp/2f.html", "official:ekimae4"),
]

UA = "Mozilla/5.0 (compatible; ekimae-map/1.0; personal use)"


def local_path(building: int, floor: str) -> Path:
    return IN_DIR / f"b{building}_{floor}.html"


def download(url: str, dest: Path) -> tuple[bool, str]:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            body = res.read()
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except Exception as e:  # 403 by proxy, DNS, timeout ...
        return False, type(e).__name__ + ": " + str(e)[:80]
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(body)
    return True, f"{len(body):,} bytes"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="取得先を表示して終了")
    ap.add_argument("--skip-download", action="store_true", help="in/ にある HTML をそのまま使う")
    ap.add_argument("--write", action="store_true", help="stores.json に書き込む（既定は dry-run）")
    ap.add_argument("--building", type=int, choices=E.BUILDINGS, help="このビルだけ")
    args = ap.parse_args()

    pages = [p for p in PAGES if not args.building or p[0] == args.building]

    if args.list:
        for b, f, url, src in pages:
            print(f"第{b}ビル {f:2}  {url}")
        return 0

    ok, failed = [], []
    for b, f, url, src in pages:
        dest = local_path(b, f)
        if args.skip_download:
            if dest.exists():
                ok.append((b, f, src))
                print(f"第{b}ビル {f:2}  ローカル {dest.name}")
            else:
                failed.append((b, f, url, "ファイルなし"))
                print(f"第{b}ビル {f:2}  ×  {dest.name} がありません")
            continue
        got, msg = download(url, dest)
        print(f"第{b}ビル {f:2}  {'○' if got else '×'}  {msg}  {url}")
        (ok if got else failed).append((b, f, src) if got else (b, f, url, msg))

    if not ok:
        print("\n1ページも取得できませんでした。", file=sys.stderr)
        if failed:
            print("egress で以下のホストが許可されているか確認してください:", file=sys.stderr)
            for b, f, url, msg in failed[:4]:
                print("  " + url, file=sys.stderr)
        return 1

    print(f"\n=== 取り込み（{'書き込み' if args.write else 'dry-run'}）===")
    rc = 0
    for b, f, src in ok:
        cmd = [sys.executable, str(HERE / "ingest.py"), "--html", str(local_path(b, f)),
               "--building", str(b), "--floor", f, "--source", src, "--verified"]
        if not args.write:
            cmd.append("--dry-run")
        print(f"\n--- 第{b}ビル {f} ---")
        rc |= subprocess.call(cmd)

    if failed:
        print(f"\n取得できなかったページ {len(failed)} 件:")
        for b, f, url, msg in failed:
            print(f"  第{b}ビル {f}: {msg}  {url}")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
