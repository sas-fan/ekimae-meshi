#!/usr/bin/env python3
"""data/stores.json を検証して要約を出す。CI でも手元でも同じものを使う。"""
from __future__ import annotations

import collections
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ekimae_data as E


def main() -> int:
    data = E.load()
    stores = data.get("stores", [])
    warns: list[str] = []
    errs = E.validate(data, warns)

    print(f"{E.DATA_PATH}: {len(stores)} 件 (version {data.get('version')})")

    per_floor = collections.Counter((s.get("building"), s.get("floor")) for s in stores)
    for (b, f), n in sorted(per_floor.items(), key=lambda kv: (kv[0][0] or 9, E.FLOORS.index(kv[0][1]) if kv[0][1] in E.FLOORS else 9)):
        placed = sum(1 for s in stores if (s.get("building"), s.get("floor")) == (b, f) and s.get("pos"))
        print(f"  第{b}ビル {f}: {n:3d} 件  (座標あり {placed})")

    verified = sum(1 for s in stores if s.get("verified"))
    print(f"\n確認済み {verified} / 未確認 {len(stores) - verified}")
    print("出どころ: " + ", ".join(f"{k}={v}" for k, v in collections.Counter(s.get("source", "?") for s in stores).most_common()))
    no_cat = [s["name"] for s in stores if not s.get("category")]
    if no_cat:
        print(f"カテゴリ未設定 {len(no_cat)} 件: " + "、".join(no_cat[:10]) + ("…" if len(no_cat) > 10 else ""))

    if warns:
        print(f"\n注意 {len(warns)} 件（公式が同じ区画に複数テナントを載せている等）:")
        for w in warns:
            print("  " + w)

    if errs:
        print(f"\nエラー {len(errs)} 件:", file=sys.stderr)
        for e in errs:
            print("  " + e, file=sys.stderr)
        return 1
    print("\n検証OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
