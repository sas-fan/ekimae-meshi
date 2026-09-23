#!/usr/bin/env python3
"""ネットで調べた営業時間・予算・タグなどを stores.json に足す。

  python3 tools/enrich.py --dry-run   # 何が変わるかだけ見る
  python3 tools/enrich.py             # 書き込む

入力は in/enrich_ekimae.csv（1店1行、id で突き合わせる）。
調べ方と CSV の作り方は tools/research_queue.py の冒頭を参照。

ここで足すのは「店の中身」の情報だけ。店の場所（ビル・階・区画）と
その裏取り（source / verified）には触らない。ID も店名も変えない
（ID が変わるとお気に入り・メモ・訪問履歴・仲間のレビューが外れるため）。
ネットで見つけた別表記は aliases に足すだけにする。

どこで調べたかは店ごとに残す:
  infoSource     "websearch"（検索で調べた。現地や公式で確かめたものではない）
  infoCheckedAt  調べた日
  infoUrl        いちばん当てにした出典ページ
  infoNote       土日の時間・情報源どうしの食い違いなどの補足
"""
from __future__ import annotations

import argparse
import csv
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ekimae_data as E

CSV_PATH = E.DATA_PATH.parent.parent / "in" / "enrich_ekimae.csv"

# 中身を反映する判定。「要確認」「見送り」は同名の支店と区別できない等で付けていない行
APPLY = {"採用", "一部"}
# 「対象外」は飲食店ではなかった行（別名も足さない）
SKIP_ALL = {"対象外"}

# 昼から開いていれば「昼飲み」と言ってよい業種（お酒が主役の店）
DRINKING = {"居酒屋", "立ち飲み", "バー", "串カツ", "焼鳥", "焼肉・ホルモン", "海鮮"}


def split(v: str) -> list[str]:
    return [x.strip() for x in (v or "").split("|") if x.strip()]


def derived_tags(store: dict) -> list[str]:
    """営業時間と業種から機械的に決まるタグ。推測で足すのではなく規則で足す。

    ・ランチあり … 予算に「ランチ」がある。またはお酒が主役でない店で、11:30までに開いて13:30まで開いている
      （居酒屋が11時に開いても昼の定食があるとは限らないので、酒場は予算か明記があるときだけ）
    ・昼飲み     … お酒が主役の店で、15:00までに開く
    ・深夜営業   … 24:00以降まで開いている
    """
    try:
        ranges = E.parse_hours(store.get("hours", ""))
    except ValueError:
        return []
    cat = store.get("category", "")
    out = []
    lunch_time = any(f <= 11 * 60 + 30 and t >= 13 * 60 + 30 for f, t in ranges)
    if "ランチ" in store.get("budget", "") or (lunch_time and cat not in DRINKING):
        out.append("ランチあり")
    if cat in DRINKING and any(f <= 15 * 60 for f, _ in ranges):
        out.append("昼飲み")
    if any(t >= 24 * 60 for _, t in ranges):
        out.append("深夜営業")
    return out


def add_unique(dst: list, items) -> bool:
    changed = False
    for x in items:
        if x and x not in dst:
            dst.append(x)
            changed = True
    return changed


def apply_row(s: dict, r: dict) -> list[str]:
    """1店ぶん反映して、変わった項目名を返す。"""
    changed = []
    verdict = r.get("判定", "")
    if verdict in SKIP_ALL:
        return changed

    aliases = s.setdefault("aliases", [])
    if add_unique(aliases, [a for a in split(r.get("別名")) if a != s["name"]]):
        changed.append("aliases")

    if verdict not in APPLY:
        return changed

    for key, col in (("hours", "営業時間"), ("budget", "予算"), ("phone", "電話"), ("url", "公式サイト"),
                     ("category", "業種")):
        v = (r.get(col) or "").strip()
        if v and s.get(key) != v:
            s[key] = v
            changed.append(key)

    closed = [d for d in split(r.get("定休日")) if d in E.DOW]
    if closed and s.get("closedDays") != closed:
        s["closedDays"] = closed
        changed.append("closedDays")

    # 区画は公式フロア案内のものを正とする。空欄のときだけ補う
    blk = (r.get("区画") or "").strip()
    if blk and not s.get("block"):
        s["block"] = blk
        changed.append("block")

    tags = s.setdefault("tags", [])
    if add_unique(tags, [t for t in split(r.get("タグ"))] + derived_tags(s)):
        changed.append("tags")

    prov = {
        "infoSource": "websearch",
        "infoCheckedAt": (r.get("確認日") or "").strip(),
        "infoUrl": (r.get("出典") or "").strip(),
        "infoNote": (r.get("メモ") or "").strip(),
    }
    for k, v in prov.items():
        if s.get(k, "") != v:
            s[k] = v
            if k != "infoNote":
                changed.append(k)
    return changed


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", type=Path, default=CSV_PATH)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    data = E.load()
    by_id = {s["id"]: s for s in data["stores"]}
    rows = list(csv.DictReader(open(a.csv, encoding="utf-8")))

    missing = [r["id"] for r in rows if r["id"] not in by_id]
    if missing:
        print(f"stores.json に無い id が {len(missing)} 件: " + ", ".join(missing[:5]), file=sys.stderr)
        return 1

    touched = 0
    counts: dict[str, int] = {}
    for r in rows:
        s = by_id[r["id"]]
        ch = apply_row(s, r)
        if ch:
            touched += 1
            s["updatedAt"] = date.today().isoformat()
            for k in ch:
                counts[k] = counts.get(k, 0) + 1

    print(f"{a.csv.name}: {len(rows)} 行 → {touched} 店を更新")
    for k in ("hours", "closedDays", "budget", "tags", "phone", "url", "category", "block", "aliases", "infoSource"):
        if k in counts:
            print(f"  {k:12s} {counts[k]:4d} 店")
    if a.dry_run:
        print("--dry-run のため書き込みませんでした。")
        return 0
    E.save(data)
    print(f"書き込みました: {E.DATA_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
