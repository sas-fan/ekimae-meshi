#!/usr/bin/env python3
"""公式フロア案内などから stores.json を組み立てる取り込みスクリプト。

  # CSV / TSV から（フロア案内のコピペやスプレッドシート想定）
  python3 tools/ingest.py --csv in/ekimae2_b2.csv --building 2 --floor B2 \
      --source official:ekimae2 --verified

  # 駅前ビル以外は --building に場所のキーを渡す
  python3 tools/ingest.py --csv in/kitte_B1.csv --building kitte --floor B1 \
      --source official:kitte --verified

  # 保存した HTML から区画番号と店名の対を拾う（best-effort・要目視）
  python3 tools/ingest.py --html in/ekimae2_b2.html --building 2 --floor B2 \
      --source official:ekimae2 --dry-run

既存の店は id（ビル+フロア+店名から決まる）で突き合わせて更新する。
手で入れた pos やタグを消さないよう、空の値では上書きしない。
"""
from __future__ import annotations

import argparse
import csv
import io
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ekimae_data as E

# CSV のヘッダ名ゆれを吸収する
ALIASES = {
    "name": {"name", "店名", "店舗名", "名称"},
    "block": {"block", "区画", "区画番号", "号", "室"},
    "category": {"category", "業種", "カテゴリ", "ジャンル", "種別"},
    "tags": {"tags", "タグ"},
    "budget": {"budget", "予算"},
    "hours": {"hours", "営業時間", "時間"},
    "closedDays": {"closeddays", "定休日", "休み", "休"},
    "phone": {"phone", "tel", "電話", "電話番号"},
    "url": {"url", "サイト", "ホームページ", "hp"},
    "kana": {"kana", "よみ", "ヨミ", "かな", "読み"},
}

# 明らかに飲食店でない業種は既定で落とす
NON_FOOD = [
    "クリニック", "歯科", "医院", "薬局", "病院", "接骨", "整体", "鍼灸",
    "銀行", "証券", "保険", "信用金庫", "郵便", "金券", "質",
    "理容", "美容", "床屋", "ネイル", "エステ",
    "不動産", "事務所", "旅行", "書店", "文具", "靴", "時計", "眼鏡", "メガネ",
    "クリーニング", "写真", "印鑑", "鍵", "携帯", "リフォーム", "占い",
    "マッサージ", "リラクゼーション",
    # 店名に業種が出ないので名前で落とす（第2ビルB2のリラクゼーションサロン）
    "スマイルハンド",
]


def header_key(raw: str) -> str | None:
    k = unicodedata.normalize("NFKC", (raw or "")).strip().lower()
    for field, names in ALIASES.items():
        if k in names:
            return field
    return None


def read_table(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8-sig")
    delim = "\t" if text.count("\t") > text.count(",") else ","
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    rows = [r for r in rows if any(c.strip() for c in r)]
    if not rows:
        return []

    mapping = {i: header_key(c) for i, c in enumerate(rows[0])}
    if any(mapping.values()):
        body = rows[1:]
    else:  # ヘッダ無し = 「区画,店名,業種」とみなす
        mapping = {0: "block", 1: "name", 2: "category"}
        body = rows

    out = []
    for r in body:
        rec = {}
        for i, cell in enumerate(r):
            field = mapping.get(i)
            if field and cell.strip():
                rec[field] = cell.strip()
        if rec.get("name"):
            out.append(rec)
    return out


TAG_RE = re.compile(r"<(script|style)\b.*?</\1>|<[^>]+>", re.S | re.I)
# 「68 立呑パーラー西澤商店」のように1行に収まっているケース
SAME_LINE = re.compile(r"^(?:区画\s*)?([0-9０-９]{1,3}(?:[-－ー][0-9０-９]{1,3})*)\s*(?:区画)?[\s:：|]+(.{2,40})$")
# 区画番号だけの独立したセル
BLOCK_ONLY = re.compile(r"^(?:区画\s*)?([0-9０-９]{1,3}(?:[-－ー][0-9０-９]{1,3})*)\s*(?:区画)?$")


def _block(raw: str) -> str:
    return unicodedata.normalize("NFKC", raw).replace("－", "-").replace("ー", "-")


def _plausible_name(s: str) -> bool:
    return 2 <= len(s) <= 40 and not BLOCK_ONLY.match(s) and not s.isdigit()


def read_html(path: Path) -> list[dict]:
    """タグを落としたテキストから「区画番号 → 店名」を拾う。取りこぼす前提で使う。

    フロア案内は <td>68</td><td>店名</td> のようにセルが分かれていることが多いので、
    1行に収まっている場合と、区画番号セルの次が店名セルの場合の両方を見る。
    """
    text = TAG_RE.sub("\n", path.read_text(encoding="utf-8", errors="replace"))
    text = re.sub(r"&nbsp;?", " ", text)
    tokens = [re.sub(r"\s{2,}", " ", l.strip()) for l in text.splitlines()]
    tokens = [t for t in tokens if t and len(t) <= 80]

    out, i = [], 0
    while i < len(tokens):
        tok = tokens[i]
        m = SAME_LINE.match(tok)
        if m and _plausible_name(m[2].strip(" |:：")):
            out.append({"block": _block(m[1]), "name": m[2].strip(" |:：")})
            i += 1
            continue
        m = BLOCK_ONLY.match(tok)
        if m and i + 1 < len(tokens) and _plausible_name(tokens[i + 1]):
            out.append({"block": _block(m[1]), "name": tokens[i + 1]})
            i += 2
            continue
        i += 1
    return out


def looks_non_food(rec: dict) -> bool:
    blob = (rec.get("category", "") + " " + rec.get("name", ""))
    return any(w in blob for w in NON_FOOD)


def build(records, building, floor, source, verified, keep_non_food):
    made = []
    for rec in records:
        if not keep_non_food and looks_non_food(rec):
            continue
        name = rec["name"]
        cat = rec.get("category", "")
        if cat not in E.CATEGORIES:
            cat = E.guess_category(name) or (E.guess_category(cat) if cat else "")
        tags = [t.strip() for t in re.split(r"[|,、]", rec.get("tags", "")) if t.strip()]
        for t in E.guess_tags(name):
            if t not in tags:
                tags.append(t)
        closed = [d.strip() for d in re.split(r"[|,、・]", rec.get("closedDays", "")) if d.strip() in E.DOW]
        made.append(E.blank_store(
            name=name, kana=rec.get("kana", ""), building=building, floor=floor,
            block=rec.get("block", ""), category=cat, tags=tags,
            budget=rec.get("budget", ""), hours=rec.get("hours", ""), closedDays=closed,
            phone=rec.get("phone", ""), url=rec.get("url", ""),
            source=source, verified=verified,
        ))
    return made


# 取り込みで上書きしてよいキー（空なら既存値を残す）
SOFT = ["kana", "block", "category", "budget", "hours", "phone", "url"]


def merge(data, incoming):
    index = {s["id"]: s for s in data["stores"]}
    # 誤字・旧店名を tools/rename_store.py で直した店は、ID が公式の旧表記から作られている。
    # 公式フロア案内のほうが後で正しい店名に直ったときも同じ店として扱えるよう、
    # いまの店名から作った ID でも引けるようにしておく（ID そのものは変えない）
    for s in data["stores"]:
        if s.get("officialName"):
            index.setdefault(E.make_id(s["building"], s["floor"], s["name"]), s)
    added = updated = 0
    for new in incoming:
        old = index.get(new["id"])
        if not old:
            data["stores"].append(new)
            index[new["id"]] = new
            added += 1
            continue
        changed = False
        for k in SOFT:
            # 業種は公式フロア案内のものが間違っていることがある。ネットで調べて直した店
            # （infoSource がある店）は、取り込み直しで元の間違いに戻さない
            if k == "category" and old.get("infoSource"):
                continue
            if new.get(k) and new[k] != old.get(k):
                old[k] = new[k]
                changed = True
        for t in new.get("tags", []):
            if t not in old.setdefault("tags", []):
                old["tags"].append(t)
                changed = True
        if new.get("closedDays") and new["closedDays"] != old.get("closedDays"):
            old["closedDays"] = new["closedDays"]
            changed = True
        # より確かな出どころが来たときだけ source/verified を上げる
        if new.get("verified") and not old.get("verified"):
            old["verified"] = True
            old["source"] = new["source"]
            changed = True
        if changed:
            old["updatedAt"] = date.today().isoformat()
            updated += 1
    return added, updated


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--csv", type=Path, help="CSV / TSV ファイル")
    src.add_argument("--html", type=Path, help="保存した公式フロア案内の HTML")
    # 1〜4 は数字、うめよこ等は文字列キー（kitte / gg03 / lucua）
    ap.add_argument("--building", required=True,
                    type=lambda v: int(v) if v.isdigit() else v,
                    choices=E.BUILDINGS,
                    metavar="{1,2,3,4,kitte,gg03,lucua}")
    ap.add_argument("--floor", required=True, choices=E.FLOORS)
    ap.add_argument("--source", default="manual", help="出どころ（例: official:ekimae2 / onsite）")
    ap.add_argument("--verified", action="store_true", help="裏が取れているものとして取り込む")
    ap.add_argument("--keep-non-food", action="store_true", help="飲食店以外も落とさずに取り込む")
    ap.add_argument("--dry-run", action="store_true", help="書き込まず差分だけ表示")
    args = ap.parse_args()

    path = args.csv or args.html
    if not path.exists():
        print(f"ファイルがありません: {path}", file=sys.stderr)
        return 2

    records = read_table(path) if args.csv else read_html(path)
    if not records:
        print("1件も抽出できませんでした。--html は取りこぼしが多いので CSV を試してください。", file=sys.stderr)
        return 1

    incoming = build(records, args.building, args.floor, args.source, args.verified, args.keep_non_food)
    print(f"抽出 {len(records)} 行 → 取り込み対象 {len(incoming)} 件")
    for s in incoming[:200]:
        print(f"  {s['block'] or '--':>8}  {s['name']}  [{s['category'] or '?'}]"
              + (f"  {'/'.join(s['tags'])}" if s["tags"] else ""))

    data = E.load()
    if data.get("version") != 2:
        data["version"] = 2
    added, updated = merge(data, incoming)
    print(f"\n新規 {added} 件 / 更新 {updated} 件 / 合計 {len(data['stores'])} 件")

    warns: list[str] = []
    errs = E.validate(data, warns)
    if warns:
        print(f"\n注意 {len(warns)} 件:")
        for w in warns[:20]:
            print("  " + w)
    if errs:
        print("\n検証エラー:", file=sys.stderr)
        for e in errs[:50]:
            print("  " + e, file=sys.stderr)
        if not args.dry_run:
            print("\nエラーがあるため書き込みませんでした。", file=sys.stderr)
            return 1

    if args.dry_run:
        print("\n--dry-run のため書き込みませんでした。")
        return 0

    E.save(data)
    print(f"書き込みました: {E.DATA_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
