"""stores.json の読み書き・正規化・検証を担う共通モジュール。"""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import date
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "stores.json"

FLOORS = ["B2", "B1", "1F", "2F", "3F", "4F", "5F"]
# 店のある場所。1〜4 は大阪駅前第1〜4ビルで、数字のまま残してある。
# 店のIDが「場所＋フロア＋店名のhash」で決まるため、ここを文字列に
# 変えると既存のIDが全部変わり、お気に入りやメモが外れてしまう。
VENUES = {
    1: "大阪駅前第1ビル",
    2: "大阪駅前第2ビル",
    3: "大阪駅前第3ビル",
    4: "大阪駅前第4ビル",
    "kitte": "KITTE大阪 うめよこ",
    "bar03": "イノゲート大阪 バルチカ03",
    "lucua": "ルクア大阪 バルチカ",
}
BUILDINGS = list(VENUES)
VENUE_ORDER = {str(k): i for i, k in enumerate(VENUES)}


def venue_index(building) -> int:
    """VENUES の並び順。app.js の venueIndex() と同じ役割。
    building は 1〜4 の数字と 'kitte' などの文字列が混ざるので str で引く。"""
    return VENUE_ORDER.get(str(building), 99)


def venue_name(building) -> str:
    for k, v in VENUES.items():
        if str(k) == str(building):
            return v
    return str(building)

CATEGORIES = [
    "居酒屋", "立ち飲み", "バー", "串カツ", "焼鳥", "焼肉・ホルモン", "寿司", "海鮮",
    "中華", "洋食", "和食", "ラーメン", "そば・うどん", "お好み焼き・粉もん",
    "カレー", "定食", "喫茶", "スイーツ", "その他",
]

TAGS = [
    "立ち飲み", "座り飲み", "カウンターのみ", "個室あり", "一人OK",
    "ランチあり", "昼飲み", "深夜営業", "行列",
    "現金のみ", "カード可", "予約可", "テイクアウト",
    "喫煙可", "分煙", "禁煙",
]

DOW = list("日月火水木金土") + ["祝"]

# 営業時間・予算・タグなど「店の中身」の出どころ。場所の出どころ（source）とは別に持つ
INFO_SOURCES = ["websearch", "official", "onsite", "manual"]

# 店名からカテゴリを推測する。長いキーワードから順に当てる。
CATEGORY_HINTS = [
    ("お好み焼", "お好み焼き・粉もん"), ("たこ焼", "お好み焼き・粉もん"), ("粉もん", "お好み焼き・粉もん"),
    ("立ち飲み", "立ち飲み"), ("立飲", "立ち飲み"), ("立ち呑", "立ち飲み"), ("立呑", "立ち飲み"), ("角打", "立ち飲み"),
    ("串かつ", "串カツ"), ("串カツ", "串カツ"), ("串揚", "串カツ"),
    ("焼鳥", "焼鳥"), ("焼き鳥", "焼鳥"), ("やきとり", "焼鳥"), ("鳥貴", "焼鳥"),
    ("ホルモン", "焼肉・ホルモン"), ("焼肉", "焼肉・ホルモン"), ("焼にく", "焼肉・ホルモン"),
    ("寿司", "寿司"), ("すし", "寿司"), ("鮨", "寿司"),
    ("海鮮", "海鮮"), ("魚", "海鮮"), ("貝", "海鮮"),
    ("ラーメン", "ラーメン"), ("らーめん", "ラーメン"), ("らあめん", "ラーメン"), ("中華そば", "ラーメン"),
    ("そば", "そば・うどん"), ("蕎麦", "そば・うどん"), ("うどん", "そば・うどん"),
    ("カレー", "カレー"), ("スパイス", "カレー"),
    ("喫茶", "喫茶"), ("珈琲", "喫茶"), ("コーヒー", "喫茶"), ("カフェ", "喫茶"),
    ("定食", "定食"), ("食堂", "定食"),
    ("中華", "中華"), ("餃子", "中華"), ("飯店", "中華"), ("中国", "中華"),
    ("バル", "バー"), ("バー", "バー"), ("BAR", "バー"), ("ビール", "バー"), ("BEER", "バー"), ("酒場", "居酒屋"),
    ("居酒屋", "居酒屋"), ("呑", "居酒屋"), ("酒", "居酒屋"),
    ("洋食", "洋食"), ("グリル", "洋食"), ("ステーキ", "洋食"),
    ("甘", "スイーツ"), ("パフェ", "スイーツ"), ("ケーキ", "スイーツ"),
]

# 店名から拾えるタグ
TAG_HINTS = [
    (("立ち飲み", "立飲", "立ち呑", "立呑", "角打", "スタンド"), "立ち飲み"),
]


def norm(s: str) -> str:
    """検索とID用の正規化: NFKC → 小文字 → カタカナをひらがな → 記号と空白を除去。"""
    s = unicodedata.normalize("NFKC", s or "").lower()
    s = "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)
    return re.sub(r"[\s　ー・･\-_/()（）「」【】]", "", s)


def make_id(building, floor: str, name: str) -> str:
    h = hashlib.sha1(norm(name).encode("utf-8")).hexdigest()[:6]
    return f"b{building}-{floor}-{h}"


def guess_category(name: str) -> str:
    n = unicodedata.normalize("NFKC", name or "")
    for kw, cat in CATEGORY_HINTS:
        if kw in n or kw.lower() in n.lower():
            return cat
    return ""


def guess_tags(name: str) -> list[str]:
    n = unicodedata.normalize("NFKC", name or "")
    out = []
    for kws, tag in TAG_HINTS:
        if any(k in n for k in kws) and tag not in out:
            out.append(tag)
    return out


def parse_hours(hours: str) -> list[tuple[int, int]]:
    """'11:00-14:00,17:00-23:00' を分に直す。壊れている要素は ValueError。"""
    out = []
    for part in re.split(r"[,、]", hours or ""):
        part = part.strip()
        if not part:
            continue
        m = re.fullmatch(r"(\d{1,2}):(\d{2})\s*[-–~〜]\s*(\d{1,2}):(\d{2})", part)
        if not m:
            raise ValueError(f"営業時間の書式が不正: {part!r}")
        f = int(m[1]) * 60 + int(m[2])
        t = int(m[3]) * 60 + int(m[4])
        if t <= f:
            t += 24 * 60
        out.append((f, t))
    return out


def blank_store(**kw) -> dict:
    s = {
        "id": "", "name": "", "kana": "", "aliases": [],
        "building": 1, "floor": "B1", "block": "", "pos": None,
        "category": "", "tags": [], "budget": "", "hours": "", "closedDays": [],
        "phone": "", "url": "", "gmapsUrl": "",
        "rating": None, "ratingCount": None, "ratingSource": "", "ratingCheckedAt": "",
        "source": "manual", "verified": False, "updatedAt": date.today().isoformat(),
    }
    s.update(kw)
    if not s["id"]:
        s["id"] = make_id(s["building"], s["floor"], s["name"])
    return s


def load(path: Path = DATA_PATH) -> dict:
    if not path.exists():
        return {"version": 2, "updatedAt": date.today().isoformat(),
                "floors": {str(b): FLOORS[:4] for b in BUILDINGS}, "stores": []}
    return json.loads(path.read_text(encoding="utf-8"))


def save(data: dict, path: Path = DATA_PATH) -> None:
    data["updatedAt"] = date.today().isoformat()
    data["stores"].sort(key=lambda s: (venue_index(s.get("building")), FLOORS.index(s["floor"]) if s.get("floor") in FLOORS else 9,
                                       block_key(s.get("block", "")), s.get("name", "")))
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def block_key(block: str):
    """'57-3-1' を数値のタプルにして自然順で並ぶようにする。"""
    parts = re.findall(r"\d+", unicodedata.normalize("NFKC", block or ""))
    return tuple(int(p) for p in parts) if parts else (9999,)


def validate(data: dict, warns: list[str] | None = None) -> list[str]:
    """壊れている行をエラーとして返す。

    warns を渡すと、エラーではないが目視したい点をそこに積む。
    公式フロア案内は 1 つの区画番号に複数テナントを載せることが実際にあるので
    （第1ビル B1 の 14 番など）、区画の重複はエラーにせず注意扱いにする。
    """
    errs: list[str] = []
    seen_ids: dict[str, str] = {}
    seen_slots: dict[tuple, str] = {}
    seen_pos: dict[tuple, str] = {}

    for i, s in enumerate(data.get("stores", [])):
        where = f"[{i}] {s.get('name', '(名前なし)')}"
        if not s.get("name"):
            errs.append(f"{where}: name が空")
        sid = s.get("id")
        if not sid:
            errs.append(f"{where}: id が空")
        elif sid in seen_ids:
            errs.append(f"{where}: id が重複 ({sid}) ← {seen_ids[sid]}")
        else:
            seen_ids[sid] = s.get("name", "")

        if s.get("building") not in BUILDINGS:
            errs.append(f"{where}: building が不正 ({s.get('building')!r})")
        if s.get("floor") not in FLOORS:
            errs.append(f"{where}: floor が不正 ({s.get('floor')!r})")
        if s.get("category") and s["category"] not in CATEGORIES:
            errs.append(f"{where}: category が一覧外 ({s['category']!r})")
        for d in s.get("closedDays") or []:
            if d not in DOW:
                errs.append(f"{where}: closedDays が不正 ({d!r})")
        try:
            parse_hours(s.get("hours", ""))
        except ValueError as e:
            errs.append(f"{where}: {e}")

        r = s.get("rating")
        if r is not None and not (isinstance(r, (int, float)) and 0 <= r <= 5):
            errs.append(f"{where}: rating が範囲外 ({r!r})")
        if r is not None and not s.get("ratingCheckedAt"):
            errs.append(f"{where}: rating があるのに ratingCheckedAt が無い")
        # ネットで調べた営業時間などは、星と同じく「いつ・どこで見たか」が無いと信用できない
        if s.get("infoSource"):
            if s["infoSource"] not in INFO_SOURCES:
                errs.append(f"{where}: infoSource が不正 ({s['infoSource']!r})")
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s.get("infoCheckedAt") or ""):
                errs.append(f"{where}: infoSource があるのに infoCheckedAt が日付でない")
        # 店名を直した店は、ID が公式の旧表記から作られたままであること（変わるとお気に入り等が外れる）
        if s.get("officialName"):
            if s["officialName"] == s.get("name"):
                errs.append(f"{where}: officialName が店名と同じ（直していないなら消す）")
            elif sid and sid != make_id(s.get("building"), s.get("floor", ""), s["officialName"]):
                errs.append(f"{where}: id が officialName から作った ID と合わない")
        if not s.get("source"):
            errs.append(f"{where}: source が空")

        blk = (s.get("building"), s.get("floor"), (s.get("block") or "").strip())
        if blk[2] and blk in seen_slots:
            if warns is not None:
                warns.append(f"{where}: 同じ区画に2店 ({blk[0]}/{blk[1]}/{blk[2]}) ← {seen_slots[blk]}")
        elif blk[2]:
            seen_slots[blk] = s.get("name", "")

        p = s.get("pos")
        if p:
            if not (isinstance(p.get("x"), int) and isinstance(p.get("y"), int) and p["x"] > 0 and p["y"] > 0):
                errs.append(f"{where}: pos が不正 ({p!r})")
            else:
                k = (s.get("building"), s.get("floor"), p["x"], p["y"])
                if k in seen_pos:
                    errs.append(f"{where}: マップ座標が衝突 ({k[2]},{k[3]}) ← {seen_pos[k]}")
                else:
                    seen_pos[k] = s.get("name", "")
    return errs
