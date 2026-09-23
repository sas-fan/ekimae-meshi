#!/usr/bin/env python3
"""駅前ビルの店を1店ずつネットで調べるための作業キュー。

調べた結果は in/enrich_ekimae.csv にたまり、tools/enrich.py で stores.json に入る。
途中で止まっても、CSV にある店は飛ばして続きから再開できる。

  python3 tools/research_queue.py stat         # 進み具合
  python3 tools/research_queue.py next 8       # まだ調べていない次の8店（検索クエリつき）
  python3 tools/research_queue.py add < x.json # 調べた結果を CSV に書く（id が同じ行は上書き）

add に渡す JSON は店ごとのオブジェクトの配列:

  [{"id": "b1-B2-ba19d5", "判定": "採用",
    "営業時間": "11:30-23:30", "定休日": ["日"], "予算": "ランチ~1000/ディナー2000-3000",
    "タグ": ["喫煙可"], "電話": "06-...", "公式サイト": "https://...",
    "別名": ["屯舎 喜酔"], "出典": "https://...", "メモ": "土日の時間など"}]

判定の決め方（ここが一番大事）:
  採用   … 同じビル・同じ階の同じ店だと言える情報が見つかり、営業時間まで分かった
  一部   … 同じ店だとは言えるが、営業時間が分からない・情報源で食い違う等で一部だけ
  要確認 … 同じビルに同じ名前の支店があって区別できない、閉店の疑いがある等
  見送り … 見つからない
  対象外 … 飲食店ではなかった

  ・駅前ビルは同じ系列の店が同じビルの別の階に何店もある（第3ビルの徳田酒店は3店）。
    `next` の twins に同じビルの似た名前の店を出すので、そのときは階まで一致したものだけ採る
  ・営業時間は「平日」の時間を入れる（hours は1通りしか持てないため）。土日の時間はメモへ
  ・情報源どうしで食い違うときは入れずにメモに残す。推測で埋めない
  ・店名や階が公式フロア案内と違って見えても、stores.json の店名・階は変えない（ID が変わる）。
    ネット上の表記は「別名」に、場所の食い違いは「メモ」に書く
"""
from __future__ import annotations

import csv
import json
import re
import sys
import unicodedata
from collections import Counter
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ekimae_data as E

CSV_PATH = E.DATA_PATH.parent.parent / "in" / "enrich_ekimae.csv"
COLS = ["id", "店名", "ビル", "階", "区画", "判定", "業種", "営業時間", "定休日", "予算", "タグ",
        "電話", "公式サイト", "別名", "出典", "確認日", "メモ"]
VERDICTS = ["採用", "一部", "要確認", "見送り", "対象外"]
FLOOR_JP = {"B2": "地下2階", "B1": "地下1階", "1F": "1階", "2F": "2階"}
# 系列店を見分けるときに邪魔になるありふれた語
COMMON = {"居酒屋", "酒場", "大衆酒場", "立ち飲み", "立呑み", "食堂", "串カツ", "焼鳥", "中華料理",
          "インド料理", "スタンド", "ROOM"}


def targets() -> list[dict]:
    return [s for s in E.load()["stores"] if str(s["building"]) in ("1", "2", "3", "4")]


def load_rows() -> dict[str, dict]:
    if not CSV_PATH.exists():
        return {}
    return {r["id"]: r for r in csv.DictReader(open(CSV_PATH, encoding="utf-8"))}


def save_rows(rows: dict[str, dict]) -> None:
    order = {s["id"]: i for i, s in enumerate(targets())}
    with open(CSV_PATH, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        for r in sorted(rows.values(), key=lambda r: order.get(r["id"], 9999)):
            w.writerow({k: r.get(k, "") for k in COLS})


def twins(s: dict, pool: list[dict]) -> list[str]:
    """同じビルにある、名前の芯が同じ店（支店の取り違えを防ぐための注意書き）。"""
    toks = [t for t in re.split(r"[\s　・]+", unicodedata.normalize("NFKC", s["name"]))
            if len(t) >= 2 and t not in COMMON and not re.search(r"ビル|店$", t)]
    out = []
    for o in pool:
        if o is s or o["building"] != s["building"]:
            continue
        if any(t in unicodedata.normalize("NFKC", o["name"]) for t in toks):
            out.append(f"{o['floor']}-{o['block']} {o['name']}")
    return out


def cmd_next(n: int) -> None:
    done = load_rows()
    pool = targets()
    for s in [s for s in pool if s["id"] not in done][:n]:
        print(json.dumps({
            "id": s["id"], "name": s["name"], "building": s["building"], "floor": s["floor"],
            "block": s["block"], "category": s["category"],
            "query": f"{s['name']} 大阪駅前第{s['building']}ビル {FLOOR_JP.get(s['floor'], s['floor'])} "
                     "営業時間 定休日 予算 喫煙",
            "twins": twins(s, pool),
        }, ensure_ascii=False))


def cmd_add() -> None:
    rows = load_rows()
    by_id = {s["id"]: s for s in targets()}
    for r in json.load(sys.stdin):
        s = by_id[r["id"]]
        if r.get("判定") not in VERDICTS:
            raise SystemExit(f"{r['id']}: 判定は {VERDICTS} のどれか")
        r.setdefault("店名", s["name"])
        r.setdefault("ビル", s["building"])
        r.setdefault("階", s["floor"])
        r.setdefault("区画", s["block"])
        r.setdefault("確認日", date.today().isoformat())
        for k in ("定休日", "タグ", "別名"):
            if isinstance(r.get(k), list):
                r[k] = "|".join(r[k])
        rows[r["id"]] = r
    save_rows(rows)
    print(f"記録 {len(rows)} / {len(by_id)}")


def cmd_stat() -> None:
    rows = load_rows()
    pool = targets()
    print(f"調査済み {len(rows)} / {len(pool)}")
    for b in ("1", "2", "3", "4"):
        mine = [s for s in pool if str(s["building"]) == b]
        c = Counter(rows[s["id"]]["判定"] for s in mine if s["id"] in rows)
        print(f"  第{b}ビル {sum(c.values()):3d} / {len(mine):3d}  " + "  ".join(f"{v}{c[v]}" for v in VERDICTS if c[v]))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "stat"
    if cmd == "next":
        cmd_next(int(sys.argv[2]) if len(sys.argv) > 2 else 8)
    elif cmd == "add":
        cmd_add()
    else:
        cmd_stat()
