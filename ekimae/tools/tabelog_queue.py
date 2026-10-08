#!/usr/bin/env python3
"""食べログの点を1店ずつ調べるための作業キュー（tools/research_queue.py の評価版）。

調べた結果は in/ratings_tabelog.csv にたまり、apply で stores.json の
tabelogRating / tabelogCheckedAt / tabelogUrl に入る。途中で止まっても続きから再開できる。

  python3 tools/tabelog_queue.py stat                  # 進み具合
  python3 tools/tabelog_queue.py next 8 居酒屋 立ち飲み  # 次の8店（業種をしぼれる）
  python3 tools/tabelog_queue.py add < x.json          # 結果を CSV に書く（id が同じ行は上書き）
  python3 tools/tabelog_queue.py apply                 # CSV を stores.json に反映

add に渡す JSON:  [{"id": "...", "判定": "採用", "点": 3.45, "出典": "https://...", "メモ": "..."}]

判定:
  採用   … 同じビルの同じ店だと言える食べログの点が見つかった
  要確認 … 同じビルに同名の支店があって区別できない、点が情報源で食い違う等
  見送り … 見つからない（食べログに載っていない小さな店もある）

食べログは Google の星と尺度が違う（3.5で高評価）。rating には入れない。
"""
from __future__ import annotations

import csv
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ekimae_data as E

CSV_PATH = E.DATA_PATH.parent.parent / "in" / "ratings_tabelog.csv"
COLS = ["id", "店名", "ビル", "階", "区画", "業種", "判定", "点", "出典", "確認日", "メモ"]
VERDICTS = ["採用", "要確認", "見送り"]
FLOOR_JP = {"B2": "地下2階", "B1": "地下1階", "1F": "1階", "2F": "2階"}


def targets(cats: list[str] | None = None) -> list[dict]:
    out = [s for s in E.load()["stores"] if str(s["building"]) in ("1", "2", "3", "4")]
    return [s for s in out if not cats or s.get("category") in cats]


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


def cmd_next(n: int, cats: list[str]) -> None:
    done = load_rows()
    for s in [s for s in targets(cats) if s["id"] not in done][:n]:
        print(json.dumps({
            "id": s["id"], "name": s["name"], "aliases": s.get("aliases", [])[:2],
            "where": f"第{s['building']}ビル {s['floor']}-{s['block']}", "category": s.get("category", ""),
            "query": f"{s['name']} 大阪駅前第{s['building']}ビル {FLOOR_JP.get(s['floor'], s['floor'])} 食べログ 評価",
        }, ensure_ascii=False))


def cmd_add() -> None:
    rows = load_rows()
    by_id = {s["id"]: s for s in targets()}
    for r in json.load(sys.stdin):
        s = by_id[r["id"]]
        if r.get("判定") not in VERDICTS:
            raise SystemExit(f"{r['id']}: 判定は {VERDICTS} のどれか")
        if r["判定"] == "採用" and not (0 < float(r.get("点") or 0) <= 5):
            raise SystemExit(f"{r['id']}: 採用なのに点が無い")
        r.update({"店名": s["name"], "ビル": s["building"], "階": s["floor"], "区画": s["block"],
                  "業種": s.get("category", "")})
        r.setdefault("確認日", date.today().isoformat())
        rows[r["id"]] = r
    save_rows(rows)
    print(f"記録 {len(rows)} 行")


def cmd_stat(cats: list[str]) -> None:
    rows = load_rows()
    pool = targets(cats)
    got = [s for s in pool if s["id"] in rows]
    c = {v: sum(rows[s["id"]]["判定"] == v for s in got) for v in VERDICTS}
    print(f"調査済み {len(got)} / {len(pool)}  " + "  ".join(f"{k}{v}" for k, v in c.items()))


def cmd_apply() -> None:
    data = E.load()
    by_id = {s["id"]: s for s in data["stores"]}
    n = 0
    for r in load_rows().values():
        s = by_id.get(r["id"])
        if not s or r["判定"] != "採用":
            continue
        new = {"tabelogRating": round(float(r["点"]), 2), "tabelogCheckedAt": r["確認日"], "tabelogUrl": r.get("出典", "")}
        if any(s.get(k) != v for k, v in new.items()):
            s.update(new)
            n += 1
    E.save(data)
    print(f"食べログの点を {n} 店に反映")


if __name__ == "__main__":
    a = sys.argv[1:] or ["stat"]
    if a[0] == "next":
        cmd_next(int(a[1]) if len(a) > 1 else 8, a[2:])
    elif a[0] == "add":
        cmd_add()
    elif a[0] == "apply":
        cmd_apply()
    else:
        cmd_stat(a[1:])
