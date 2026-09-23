#!/usr/bin/env python3
"""公式フロア案内の店名が誤字・旧店名だった店を、正しい店名に直す。

  python3 tools/rename_store.py b3-B2-548b9a "キラメキノトリ 大阪駅前第3ビル店" --why "2026年6月に入れ替わり"
  python3 tools/rename_store.py --list    # これまでに直した店の一覧

ID は変えない。ID は「ビル＋階＋公式フロア案内の店名」から作ったもので、
お気に入り・メモ・訪問履歴・仲間のレビューがこの ID にひもづいているため。
代わりに次の3つを残す:

  officialName  公式フロア案内に載っていた店名（ID の元。最初に直したときだけ入れる）
  aliases       直す前の店名を足す（古い名前で検索しても見つかるように）
  nameNote      なぜ直したか

公式フロア案内を取り込み直したとき（tools/ingest.py）は、ID が同じなので
同じ店として扱われ、直した店名は上書きされない。
"""
from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ekimae_data as E


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("id", nargs="?")
    ap.add_argument("name", nargs="?", help="正しい店名")
    ap.add_argument("--why", default="", help="直した理由（nameNote に入る）")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()

    data = E.load()
    if a.list:
        for s in data["stores"]:
            if s.get("officialName"):
                print(f"{s['id']}  {s['officialName']} → {s['name']}  （{s.get('nameNote', '')}）")
        return 0
    if not (a.id and a.name):
        ap.error("id と 正しい店名 を指定する")

    s = next((x for x in data["stores"] if x["id"] == a.id), None)
    if not s:
        print(f"{a.id} は stores.json に無い", file=sys.stderr)
        return 1
    old = s["name"]
    if old == a.name:
        print("同じ店名なので何もしない")
        return 0
    s.setdefault("officialName", old)
    aliases = s.setdefault("aliases", [])
    if old not in aliases:
        aliases.append(old)
    if a.name in aliases:
        aliases.remove(a.name)
    s["name"] = a.name
    if a.why:
        s["nameNote"] = a.why
    s["updatedAt"] = date.today().isoformat()
    E.save(data)
    print(f"{a.id}: {old} → {a.name}（ID はそのまま）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
